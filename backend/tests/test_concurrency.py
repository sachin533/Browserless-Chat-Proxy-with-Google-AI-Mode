"""Concurrency protection tests.

The browser tab is a single shared resource, so only one request may control
it at a time.  These tests verify that a second request waits instead of
interfering with the first one.
"""

from __future__ import annotations

import asyncio

from tests.conftest import MockExtension

CHAT_URL = "/v1/chat/completions"


def _payload(prompt: str) -> dict:
    return {
        "model": "google-ai-mode",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }


async def _answer(extension: MockExtension, text: str, index: int = 1) -> None:
    """Answer the job that the extension is currently waiting for."""
    job = await extension.wait_for_job(index)
    await extension.deliver(
        {
            "type": "job_result",
            "request_id": job["request_id"],
            "ok": True,
            "payload": {"text": text},
        }
    )


async def test_only_one_job_controls_the_tab_at_a_time(async_client, app):
    extension = MockExtension(
        app.state.extension_manager, app.state.request_manager, auto_answer=False
    )
    await extension.start()

    try:
        first = asyncio.create_task(async_client.post(CHAT_URL, json=_payload("first")))
        second = asyncio.create_task(async_client.post(CHAT_URL, json=_payload("second")))

        # Give the first request time to grab the tab lock.
        await asyncio.sleep(0.3)
        assert len(extension.received_jobs) == 1

        await _answer(extension, "first answer")

        # Only now may the second request reach the browser.
        await asyncio.sleep(0.3)
        assert len(extension.received_jobs) == 2

        await _answer(extension, "second answer", index=2)

        first_response, second_response = await asyncio.gather(first, second)
    finally:
        await extension.stop()

    assert first_response.json()["choices"][0]["message"]["content"] == "first answer"
    assert second_response.json()["choices"][0]["message"]["content"] == "second answer"


async def test_the_tab_lock_is_released_after_a_failure(async_client, app):
    extension = MockExtension(
        app.state.extension_manager, app.state.request_manager, auto_answer=False
    )
    await extension.start()

    try:
        first = asyncio.create_task(async_client.post(CHAT_URL, json=_payload("first")))
        await asyncio.sleep(0.3)

        job = await extension.wait_for_job()
        await extension.deliver(
            {
                "type": "job_result",
                "request_id": job["request_id"],
                "ok": False,
                "error": {"code": "prompt_submission_failed", "message": "nope"},
            }
        )

        first_response = await first
        assert first_response.status_code == 502

        # The lock must be free again, so a follow-up request can run.
        second = asyncio.create_task(async_client.post(CHAT_URL, json=_payload("second")))
        await asyncio.sleep(0.3)
        assert len(extension.received_jobs) == 2

        await _answer(extension, "second answer", index=2)
        second_response = await second
    finally:
        await extension.stop()

    assert second_response.status_code == 200


async def test_the_extension_disconnect_fails_pending_requests(async_client, app):
    extension = MockExtension(
        app.state.extension_manager, app.state.request_manager, auto_answer=False
    )
    await extension.start()

    try:
        pending_request = asyncio.create_task(async_client.post(CHAT_URL, json=_payload("x")))
        await asyncio.sleep(0.3)

        # Simulate the extension dropping the connection.
        await app.state.extension_manager.unregister(extension.socket)
        app.state.request_manager.fail_all(
            "extension_disconnected", "The Chrome extension disconnected."
        )

        response = await pending_request
    finally:
        await extension.stop()

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "extension_disconnected"
