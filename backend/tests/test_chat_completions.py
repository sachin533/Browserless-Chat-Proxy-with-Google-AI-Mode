"""Chat completion tests (request validation, formatting, error handling)."""

from __future__ import annotations

from tests.conftest import MockExtension

CHAT_URL = "/v1/chat/completions"


def _payload(prompt: str = "Explain Python in simple terms.") -> dict:
    return {
        "model": "google-ai-mode",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }


# ----------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------
def test_missing_messages_is_rejected(client):
    response = client.post(CHAT_URL, json={"model": "google-ai-mode"})

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["type"] == "invalid_request_error"
    assert body["error"]["code"] == "invalid_request"


def test_empty_messages_list_is_rejected(client):
    response = client.post(CHAT_URL, json={"model": "google-ai-mode", "messages": []})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_message_without_text_is_rejected(client):
    response = client.post(
        CHAT_URL,
        json={"model": "google-ai-mode", "messages": [{"role": "user", "content": "  "}]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_unsupported_model_is_rejected(client):
    response = client.post(CHAT_URL, json={**_payload(), "model": "not-a-model"})

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "invalid_request"
    assert body["error"]["param"] == "model"


def test_oversized_prompt_is_rejected(client):
    response = client.post(CHAT_URL, json=_payload("x" * 9000))

    assert response.status_code == 400
    assert response.json()["error"]["param"] == "messages"


# ----------------------------------------------------------------------
# Browser unavailable
# ----------------------------------------------------------------------
def test_request_without_a_connected_extension_fails(client):
    response = client.post(CHAT_URL, json=_payload())

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "extension_not_connected"
    assert body["error"]["type"] == "service_unavailable"


# ----------------------------------------------------------------------
# Happy path
# ----------------------------------------------------------------------
async def test_chat_completion_returns_the_real_extension_answer(
    async_client, mock_extension
):
    mock_extension.answer = "Python is a popular, beginner-friendly language."

    response = await async_client.post(CHAT_URL, json=_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "chat.completion"
    assert body["model"] == "google-ai-mode"
    assert body["id"].startswith("chatcmpl-")
    assert body["choices"][0]["index"] == 0
    assert body["choices"][0]["finish_reason"] == "stop"
    assert body["choices"][0]["message"]["role"] == "assistant"
    assert body["choices"][0]["message"]["content"] == mock_extension.answer
    assert body["usage"]["total_tokens"] > 0
    assert response.headers["X-Google-AI-Mode-Request-Id"].startswith("req_")


async def test_the_job_carries_the_prompt_and_a_request_id(async_client, mock_extension):
    await async_client.post(CHAT_URL, json=_payload("What is FastAPI?"))

    assert len(mock_extension.received_jobs) == 1
    job = mock_extension.received_jobs[0]
    assert job["action"] == "run_prompt"
    assert job["request_id"].startswith("req_")
    assert job["payload"]["prompt"] == "What is FastAPI?"
    assert job["payload"]["timeout_ms"] > 0


async def test_a_multi_turn_conversation_is_flattened_into_one_prompt(
    async_client, mock_extension
):
    await async_client.post(
        CHAT_URL,
        json={
            "model": "google-ai-mode",
            "messages": [
                {"role": "system", "content": "Be brief."},
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello!"},
                {"role": "user", "content": "What is Python?"},
            ],
        },
    )

    prompt = mock_extension.received_jobs[0]["payload"]["prompt"]
    assert "User: Hi" in prompt
    assert "Assistant: Hello!" in prompt
    assert prompt.rstrip().endswith("User: What is Python?")


async def test_the_request_id_is_unique_per_request(async_client, mock_extension):
    await async_client.post(CHAT_URL, json=_payload("one"))
    await async_client.post(CHAT_URL, json=_payload("two"))

    ids = [job["request_id"] for job in mock_extension.received_jobs]
    assert len(ids) == 2
    assert ids[0] != ids[1]


async def test_login_required_is_reported(async_client, app, mock_extension):
    mock_extension.set_status(logged_in=False)

    response = await async_client.post(CHAT_URL, json=_payload())

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "login_required"


async def test_missing_ai_mode_tab_is_reported(async_client, mock_extension):
    mock_extension.set_status(ai_mode_tab_open=False)

    response = await async_client.post(CHAT_URL, json=_payload())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_mode_tab_not_found"


async def test_extension_failure_is_propagated(async_client, app):
    extension = MockExtension(
        app.state.extension_manager, app.state.request_manager, auto_answer=False
    )
    await extension.start()
    try:

        async def fail_job():
            job = await extension.wait_for_job()
            await extension.deliver(
                {
                    "type": "job_result",
                    "request_id": job["request_id"],
                    "ok": False,
                    "error": {
                        "code": "response_extraction_failed",
                        "message": "Could not find the answer container.",
                    },
                }
            )

        import asyncio

        task = asyncio.create_task(fail_job())
        response = await async_client.post(CHAT_URL, json=_payload())
        await task
    finally:
        await extension.stop()

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "response_extraction_failed"


async def test_a_response_timeout_is_reported(async_client, app):
    extension = MockExtension(
        app.state.extension_manager, app.state.request_manager, auto_answer=False
    )
    await extension.start()
    try:
        import asyncio

        task = asyncio.create_task(async_client.post(CHAT_URL, json=_payload()))
        await asyncio.sleep(0.3)
        # Simulate the extension never answering: fail the pending request
        # with the same code the service uses on a real timeout.
        for pending in list(app.state.request_manager._pending.values()):
            app.state.request_manager.fail(
                pending.request_id,
                "response_timeout",
                "Timed out while waiting for the Google AI Mode response.",
            )
        response = await task
    finally:
        await extension.stop()

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "response_timeout"


# ----------------------------------------------------------------------
# Streaming
# ----------------------------------------------------------------------
async def test_streaming_returns_sse_chunks(async_client, app):
    extension = MockExtension(
        app.state.extension_manager, app.state.request_manager, auto_answer=False
    )
    await extension.start()

    import asyncio

    async def stream_answer():
        job = await extension.wait_for_job()
        await extension.deliver(
            {
                "type": "job_delta",
                "request_id": job["request_id"],
                "payload": {"text": "Python is "},
            }
        )
        await extension.deliver(
            {
                "type": "job_delta",
                "request_id": job["request_id"],
                "payload": {"text": "a programming language."},
            }
        )
        await extension.deliver(
            {
                "type": "job_result",
                "request_id": job["request_id"],
                "ok": True,
                "payload": {"text": "Python is a programming language."},
            }
        )

    try:
        task = asyncio.create_task(stream_answer())
        response = await async_client.post(CHAT_URL, json={**_payload(), "stream": True})
        await task
    finally:
        await extension.stop()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = response.text
    assert "data: [DONE]" in body
    assert "chat.completion.chunk" in body
    assert "Python is " in body
    assert "a programming language." in body
