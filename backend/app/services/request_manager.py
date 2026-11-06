"""Request tracking, timeouts and response matching.

Every REST request is turned into a *pending request* with a unique id.  The
extension reports the answer with exactly that id, which is how the response
is matched to the caller - there is no guessing based on ordering.

The browser tab is a single shared resource, so only one request may control
it at a time.  The actual serialisation happens in
:mod:`app.services.google_ai_service`; this module owns the bookkeeping.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ----------------------------------------------------------------------
# Events delivered to the waiting service call
# ----------------------------------------------------------------------
@dataclass
class DeltaEvent:
    """An incremental update of the answer as it is rendered in the page."""

    text: str


@dataclass
class FinalEvent:
    """The completed answer."""

    text: str
    finish_reason: str = "stop"
    duration_ms: int = 0
    source_url: str | None = None


@dataclass
class ErrorEvent:
    """A terminal failure."""

    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


StreamEvent = DeltaEvent | FinalEvent | ErrorEvent


@dataclass
class PendingRequest:
    """State of a single in-flight request."""

    request_id: str
    created_at: float
    timeout: float
    events: asyncio.Queue[StreamEvent]
    finished: bool = False
    model: str | None = None
    prompt_chars: int = 0
    completed_at: float | None = None

    @property
    def age_seconds(self) -> float:
        return time.time() - self.created_at


class RequestManager:
    """Registry of pending requests awaiting an answer from the browser."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._pending: dict[str, PendingRequest] = {}

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def new_request_id(self) -> str:
        """Return a globally unique request id."""
        return f"req_{uuid.uuid4().hex}"

    def create(
        self,
        request_id: str | None = None,
        *,
        timeout: float | None = None,
        model: str | None = None,
        prompt_chars: int = 0,
    ) -> PendingRequest:
        """Register a new pending request."""
        if len(self._pending) >= self._settings.max_pending_requests:
            from app.core.exceptions import ServiceBusyError

            raise ServiceBusyError(
                f"Too many pending requests ({len(self._pending)}). "
                "The browser session can only serve a limited number of "
                "concurrent prompts."
            )

        request_id = request_id or self.new_request_id()
        pending = PendingRequest(
            request_id=request_id,
            created_at=time.time(),
            timeout=timeout if timeout is not None else self._settings.request_timeout_seconds,
            events=asyncio.Queue(),
            model=model,
            prompt_chars=prompt_chars,
        )
        self._pending[request_id] = pending
        logger.info(
            "Request %s registered (model=%s, prompt_chars=%d, pending=%d)",
            request_id,
            model,
            prompt_chars,
            len(self._pending),
        )
        return pending

    def get(self, request_id: str) -> PendingRequest | None:
        return self._pending.get(request_id)

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    @property
    def pending_ids(self) -> list[str]:
        return list(self._pending.keys())

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------
    def resolve(
        self,
        request_id: str,
        text: str,
        *,
        finish_reason: str = "stop",
        duration_ms: int = 0,
        source_url: str | None = None,
    ) -> bool:
        """Deliver the final answer for *request_id*."""
        pending = self._pending.get(request_id)
        if pending is None:
            logger.warning("Received a result for unknown request %s", request_id)
            return False
        if pending.finished:
            logger.warning("Received a duplicate result for request %s", request_id)
            return False
        pending.finished = True
        pending.completed_at = time.time()
        pending.events.put_nowait(
            FinalEvent(
                text=text,
                finish_reason=finish_reason,
                duration_ms=duration_ms,
                source_url=source_url,
            )
        )
        logger.info("Request %s resolved (%d chars)", request_id, len(text))
        return True

    def delta(self, request_id: str, text: str) -> bool:
        """Deliver an incremental answer update for *request_id*."""
        pending = self._pending.get(request_id)
        if pending is None or pending.finished:
            return False
        pending.events.put_nowait(DeltaEvent(text=text))
        return True

    def fail(
        self,
        request_id: str,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> bool:
        """Deliver a terminal error for *request_id*."""
        pending = self._pending.get(request_id)
        if pending is None:
            logger.warning("Received an error for unknown request %s", request_id)
            return False
        if pending.finished:
            return False
        pending.finished = True
        pending.completed_at = time.time()
        pending.events.put_nowait(
            ErrorEvent(code=code, message=message, details=details or {})
        )
        logger.info("Request %s failed (%s)", request_id, code)
        return True

    def fail_all(self, code: str, message: str) -> int:
        """Fail every pending request - used when the extension drops."""
        count = 0
        for request_id in list(self._pending.keys()):
            if self.fail(request_id, code, message):
                count += 1
        return count

    def cancel(self, request_id: str) -> bool:
        """Cancel a pending request (client disconnected or user aborted)."""
        pending = self._pending.get(request_id)
        if pending is None or pending.finished:
            return False
        pending.finished = True
        pending.completed_at = time.time()
        pending.events.put_nowait(
            ErrorEvent(code="request_cancelled", message="The request was cancelled.")
        )
        logger.info("Request %s cancelled", request_id)
        return True

    def discard(self, request_id: str) -> None:
        """Remove a request from the registry."""
        self._pending.pop(request_id, None)

    # ------------------------------------------------------------------
    # Waiting
    # ------------------------------------------------------------------
    async def wait_for_event(
        self, pending: PendingRequest, deadline: float
    ) -> StreamEvent:
        """Wait for the next event of *pending* until *deadline*."""
        timeout = deadline - time.time()
        if timeout <= 0:
            raise asyncio.TimeoutError
        return await asyncio.wait_for(pending.events.get(), timeout=timeout)
