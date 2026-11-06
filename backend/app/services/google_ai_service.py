"""High level orchestration of a Google AI Mode interaction.

The service is the only place that knows the full order of operations:

1. validate that the extension is connected and the browser is usable
2. take exclusive ownership of the single AI Mode tab
3. register a pending request and dispatch a job to the extension
4. wait for the real answer extracted from the page
5. release the tab and return the result

No response is ever synthesised locally - if the browser does not deliver an
answer the request fails with a structured error.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from app.core.config import Settings, get_settings
from app.core.exceptions import (
    AiModeTabNotFoundError,
    CaptchaDetectedError,
    EmptyResponseError,
    ExtensionNotConnectedError,
    LoginRequiredError,
    PromptInputUnavailableError,
    ResponseExtractionError,
    ResponseTimeoutError,
    ServiceBusyError,
)
from app.core.logging import get_logger
from app.services.extension_manager import ExtensionManager
from app.services.request_manager import (
    DeltaEvent,
    ErrorEvent,
    FinalEvent,
    RequestManager,
    StreamEvent,
)

logger = get_logger(__name__)


@dataclass
class CompletionResult:
    """The outcome of a completed browser interaction."""

    request_id: str
    text: str
    finish_reason: str = "stop"
    duration_ms: int = 0
    source_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class GoogleAIService:
    """Drives the extension and produces real Google AI Mode answers."""

    def __init__(
        self,
        extension_manager: ExtensionManager,
        request_manager: RequestManager,
        settings: Settings | None = None,
    ) -> None:
        self._extensions = extension_manager
        self._requests = request_manager
        self._settings = settings or get_settings()
        # The AI Mode tab is a single shared resource -> one prompt at a time.
        self._tab_lock = asyncio.Semaphore(max(1, self._settings.max_concurrent_requests))

    # ------------------------------------------------------------------
    # Preconditions
    # ------------------------------------------------------------------
    def _ensure_ready(self) -> None:
        """Raise a descriptive error when the browser cannot serve a prompt."""
        if not self._extensions.is_connected:
            raise ExtensionNotConnectedError()

        tab = self._extensions.tab_status
        if tab.captcha_detected:
            raise CaptchaDetectedError()
        if not tab.ai_mode_tab_open:
            raise AiModeTabNotFoundError()
        if not tab.logged_in:
            raise LoginRequiredError()
        if not tab.ai_mode_ready:
            raise PromptInputUnavailableError()

    def ensure_ready(self) -> None:
        """Public precondition check.

        Used by the streaming route so that a failure is reported with a real
        HTTP status code instead of an error event inside the SSE stream.
        """
        self._ensure_ready()

    async def _acquire_tab(self, timeout: float) -> None:
        try:
            await asyncio.wait_for(
                self._tab_lock.acquire(), timeout=self._settings.queue_wait_timeout_seconds
            )
        except asyncio.TimeoutError as exc:
            raise ServiceBusyError(
                "The browser session did not become available in time. "
                "Another request is still running."
            ) from exc

    def _release_tab(self) -> None:
        try:
            self._tab_lock.release()
        except ValueError:  # pragma: no cover - defensive
            pass

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------
    async def _execute(
        self,
        prompt: str,
        *,
        model: str,
        timeout: float,
        request_id: str,
    ) -> AsyncIterator[StreamEvent]:
        """Run one browser interaction and yield the streamed events."""
        self._ensure_ready()
        await self._acquire_tab(timeout)

        pending = self._requests.create(
            request_id=request_id,
            timeout=timeout,
            model=model,
            prompt_chars=len(prompt),
        )
        deadline = time.time() + timeout
        try:
            delivered = await self._extensions.send(
                {
                    "type": "job",
                    "request_id": request_id,
                    "action": "run_prompt",
                    "payload": {
                        "prompt": prompt,
                        "timeout_ms": int(timeout * 1000),
                        "reset_conversation": self._settings.reset_conversation_per_request,
                    },
                }
            )
            if not delivered:
                raise ExtensionNotConnectedError(
                    "The extension connection dropped before the job could be sent."
                )

            while True:
                try:
                    event = await self._requests.wait_for_event(pending, deadline)
                except asyncio.TimeoutError as exc:
                    self._requests.fail(
                        request_id,
                        "response_timeout",
                        "Timed out while waiting for the Google AI Mode response.",
                    )
                    raise ResponseTimeoutError(
                        f"No answer was received within {timeout:.0f} seconds."
                    ) from exc

                yield event

                if isinstance(event, (FinalEvent, ErrorEvent)):
                    return
        finally:
            self._requests.discard(request_id)
            self._release_tab()

    async def complete(
        self,
        prompt: str,
        *,
        model: str = "google-ai-mode",
        timeout: float | None = None,
    ) -> CompletionResult:
        """Execute a prompt and return the complete answer."""
        timeout = timeout if timeout is not None else self._settings.request_timeout_seconds
        request_id = self._requests.new_request_id()
        answer_parts: list[str] = []
        final: FinalEvent | None = None

        async for event in self._execute(
            prompt, model=model, timeout=timeout, request_id=request_id
        ):
            if isinstance(event, DeltaEvent):
                answer_parts.append(event.text)
            elif isinstance(event, FinalEvent):
                final = event
            elif isinstance(event, ErrorEvent):
                raise self._build_error(event)

        if final is None:
            raise EmptyResponseError()

        text = final.text
        if not text.strip():
            raise EmptyResponseError()

        return CompletionResult(
            request_id=request_id,
            text=text,
            finish_reason=final.finish_reason,
            duration_ms=final.duration_ms,
            source_url=final.source_url,
            metadata={"streamed_chunks": len(answer_parts)},
        )

    async def stream(
        self,
        prompt: str,
        *,
        model: str = "google-ai-mode",
        timeout: float | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Execute a prompt and yield incremental events as they arrive."""
        timeout = timeout if timeout is not None else self._settings.request_timeout_seconds
        request_id = self._requests.new_request_id()
        async for event in self._execute(
            prompt, model=model, timeout=timeout, request_id=request_id
        ):
            if isinstance(event, ErrorEvent):
                raise self._build_error(event)
            yield event

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    async def diagnose(self, timeout: float = 20.0) -> dict[str, Any]:
        """Ask the extension to dump page diagnostics (selectors, readiness)."""
        if not self._extensions.is_connected:
            raise ExtensionNotConnectedError()

        pending = self._requests.create(timeout=timeout, model="diagnose", prompt_chars=0)
        request_id = pending.request_id
        deadline = time.time() + timeout
        try:
            delivered = await self._extensions.send(
                {
                    "type": "job",
                    "request_id": request_id,
                    "action": "diagnose",
                    "payload": {"timeout_ms": int(timeout * 1000)},
                }
            )
            if not delivered:
                raise ExtensionNotConnectedError()

            while True:
                try:
                    event = await self._requests.wait_for_event(pending, deadline)
                except asyncio.TimeoutError as exc:
                    raise ResponseTimeoutError(
                        "The extension did not report diagnostics in time."
                    ) from exc

                if isinstance(event, FinalEvent):
                    return {
                        "diagnostics": event.text,
                        "source_url": event.source_url,
                    }
                if isinstance(event, ErrorEvent):
                    raise self._build_error(event)
        finally:
            self._requests.discard(request_id)

    # ------------------------------------------------------------------
    # Error mapping
    # ------------------------------------------------------------------
    @staticmethod
    def _build_error(event: ErrorEvent) -> Exception:
        """Translate an extension error into a typed backend exception."""
        from app.core.exceptions import AppError

        code = event.code or "upstream_error"
        message = event.message or "The browser interaction failed."
        details = event.details or {}

        special_cases: dict[str, type[AppError]] = {
            "login_required": LoginRequiredError,
            "captcha_detected": CaptchaDetectedError,
            "prompt_input_unavailable": PromptInputUnavailableError,
            "response_extraction_failed": ResponseExtractionError,
            "empty_response": EmptyResponseError,
            "response_timeout": ResponseTimeoutError,
            "page_navigated": AiModeTabNotFoundError,
            "ai_mode_tab_not_found": AiModeTabNotFoundError,
        }
        error_cls = special_cases.get(code)
        if error_cls is not None:
            return error_cls(message, details=details or None)
        return AppError(message, code=code, status_code=502, error_type="upstream_error", details=details or None)
