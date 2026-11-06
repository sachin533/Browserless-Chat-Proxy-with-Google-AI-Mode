"""Shared pytest fixtures.

The backend tests use a *mocked* extension: a fake WebSocket that behaves
like the Chrome extension so the orchestration can be verified without a
browser.  The real extension is verified separately by hand - see
``docs/installation.md``.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import pytest

# The environment must be configured before the settings singleton is built.
os.environ["EXTENSION_PAIRING_TOKEN"] = "test-pairing-token"
os.environ["AUTO_GENERATE_PAIRING_TOKEN"] = "false"
os.environ["REQUIRE_API_KEY"] = "false"
os.environ["RATE_LIMIT_REQUESTS"] = "100000"
os.environ["LOG_LEVEL"] = "WARNING"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import Settings, get_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.extension_protocol import handle_extension_message  # noqa: E402

PAIRING_TOKEN = "test-pairing-token"


@pytest.fixture
def settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()


@pytest.fixture
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def async_client(app):
    """An async HTTP client that shares the test's event loop.

    Required by the tests that drive the mock extension: the extension and
    the application must live in the same event loop.
    """
    import httpx

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as http_client:
            yield http_client


class FakeWebSocket:
    """Minimal stand-in for a Starlette WebSocket.

    ``send_text`` models the server -> extension direction and ``receive_text``
    the extension -> server direction.
    """

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed = False
        self.close_code: int | None = None
        self.accepted = False
        self._outbox: asyncio.Queue[str] = asyncio.Queue()
        self._inbox: asyncio.Queue[str] = asyncio.Queue()

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, data: str) -> None:
        self.sent.append(json.loads(data))
        self._outbox.put_nowait(data)

    async def receive_text(self) -> str:
        return await self._inbox.get()

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True
        self.close_code = code

    # -- test helpers ---------------------------------------------------
    def push(self, payload: dict[str, Any]) -> None:
        """Queue a message that the server will read."""
        self._inbox.put_nowait(json.dumps(payload))

    def push_text(self, raw: str) -> None:
        self._inbox.put_nowait(raw)

    async def next_sent(self) -> dict[str, Any]:
        """Await the next message sent by the server."""
        return json.loads(await self._outbox.get())

    def last(self, message_type: str) -> dict[str, Any] | None:
        for message in reversed(self.sent):
            if message.get("type") == message_type:
                return message
        return None


class MockExtension:
    """A scripted stand-in for the Chrome extension.

    It answers ``run_prompt`` jobs with a configurable answer and keeps track
    of every job it received, which makes request-id matching observable.

    Replies travel through the very same
    :func:`app.services.extension_protocol.handle_extension_message` function
    the real WebSocket route uses, so the test exercises production code.
    """

    def __init__(
        self,
        extension_manager,
        request_manager,
        *,
        answer: str = "Python is a programming language.",
        delay: float = 0.0,
        auto_answer: bool = True,
        logged_in: bool = True,
        ai_mode_tab_open: bool = True,
        ai_mode_ready: bool = True,
    ) -> None:
        self.socket = FakeWebSocket()
        self.answer = answer
        self.delay = delay
        self.auto_answer = auto_answer
        self.received_jobs: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None
        self._extension_manager = extension_manager
        self._request_manager = request_manager
        self._tab_status = {
            "ai_mode_tab_open": ai_mode_tab_open,
            "ai_mode_ready": ai_mode_ready,
            "logged_in": logged_in,
            "captcha_detected": False,
            "page_url": "https://www.google.com/search?udm=50",
            "surface": "search_ai_mode",
            "prompt_input_available": ai_mode_ready,
            "answer_container_available": ai_mode_ready,
        }

    async def start(self) -> None:
        await self._extension_manager.register(self.socket, _client_info())
        self._extension_manager.update_tab_status(_tab_status(self._tab_status))
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        await self._extension_manager.unregister(self.socket)

    async def deliver(self, message: dict[str, Any]) -> None:
        """Push a message from the extension into the backend."""
        await handle_extension_message(message, self._extension_manager, self._request_manager)

    async def wait_for_job(self, count: int = 1, timeout: float = 5.0) -> dict[str, Any]:
        """Wait until *count* jobs have been dispatched and return the last one."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while len(self.received_jobs) < count:
            if loop.time() > deadline:
                raise AssertionError(
                    f"Expected {count} job(s), got {len(self.received_jobs)}"
                )
            await asyncio.sleep(0.01)
        return self.received_jobs[count - 1]

    async def _run(self) -> None:
        while True:
            raw = await self.socket._outbox.get()
            payload = json.loads(raw)
            if payload.get("type") != "job":
                continue
            self.received_jobs.append(payload)
            if not self.auto_answer:
                continue
            if self.delay:
                await asyncio.sleep(self.delay)
            await self.deliver(
                {
                    "type": "job_result",
                    "request_id": payload.get("request_id"),
                    "ok": True,
                    "payload": {
                        "text": self.answer,
                        "finish_reason": "stop",
                        "duration_ms": 42,
                        "source_url": "https://www.google.com/search?udm=50&q=test",
                    },
                }
            )

    # -- test helpers ---------------------------------------------------
    def set_status(self, **overrides: Any) -> None:
        self._tab_status.update(overrides)
        self._extension_manager.update_tab_status(_tab_status(self._tab_status))


def _client_info():
    from app.schemas.extension import ExtensionClientInfo

    return ExtensionClientInfo(name="mock-extension", version="1.0.0")


def _tab_status(payload: dict[str, Any]):
    from app.schemas.extension import ExtensionTabStatus

    return ExtensionTabStatus(**payload)


@pytest.fixture
async def mock_extension(async_client, app):
    """Register a mock extension with the running application."""
    extension = MockExtension(app.state.extension_manager, app.state.request_manager)
    await extension.start()
    try:
        yield extension
    finally:
        await extension.stop()
