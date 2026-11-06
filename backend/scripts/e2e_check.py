"""End-to-end check against a running backend.

The script speaks the real extension protocol over a real WebSocket and
performs a real HTTP chat completion.  It proves that the whole chain works:

    HTTP request -> FastAPI -> WebSocket -> extension -> WebSocket -> FastAPI
    -> HTTP response

Usage::

    python scripts/e2e_check.py --backend http://127.0.0.1:8000 \
        --token <pairing token> [--answer "the answer the browser returned"]

With ``--answer`` the script replays a text that was captured from a real
Google AI Mode page.  Without it the script only verifies the handshake, the
status reporting and the job dispatch.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import httpx
import websockets

STATUS_PAYLOAD = {
    "ai_mode_tab_open": True,
    "ai_mode_ready": True,
    "logged_in": True,
    "captcha_detected": False,
    "page_url": "https://www.google.com/search?udm=50",
    "surface": "search_ai_mode",
    "prompt_input_available": True,
    "answer_container_available": True,
}


def ws_url(backend: str) -> str:
    backend = backend.rstrip("/")
    if backend.startswith("https://"):
        backend = "wss://" + backend[len("https://") :]
    elif backend.startswith("http://"):
        backend = "ws://" + backend[len("http://") :]
    return f"{backend}/ws/extension"


async def run(backend: str, token: str, answer: str | None) -> int:
    failures: list[str] = []

    async with websockets.connect(ws_url(backend)) as socket:
        await socket.send(
            json.dumps(
                {
                    "type": "auth",
                    "token": token,
                    "client": {"name": "e2e-check", "version": "1.0.0"},
                }
            )
        )
        handshake = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
        print(f"[1] handshake           -> {handshake.get('type')}")
        if handshake.get("type") != "auth_ok":
            failures.append(f"handshake failed: {handshake}")
            return 1

        await socket.send(json.dumps({"type": "status", "payload": STATUS_PAYLOAD}))
        await asyncio.sleep(0.3)

        async with httpx.AsyncClient(base_url=backend, timeout=60) as client:
            status = await client.get("/api/extension/status")
            body = status.json()
            print(f"[2] extension status    -> connected={body['connected']} "
                  f"tab={body['ai_mode_tab_open']} logged_in={body['logged_in']}")
            if not body["connected"]:
                failures.append("the backend does not see the extension")
            if not body["logged_in"]:
                failures.append("the backend does not see the login state")

            request_task = asyncio.create_task(
                client.post(
                    "/v1/chat/completions",
                    json={
                        "model": "google-ai-mode",
                        "messages": [
                            {"role": "user", "content": "In two sentences, what is a WebSocket?"}
                        ],
                        "stream": False,
                    },
                )
            )

            job = json.loads(await asyncio.wait_for(socket.recv(), timeout=15))
            if job.get("type") != "job":
                failures.append(f"expected a job, got {job}")
                return 1
            request_id = job["request_id"]
            print(f"[3] job dispatched      -> id={request_id} "
                  f"prompt={job['payload']['prompt'][:40]!r}")

            if answer is None:
                await socket.send(
                    json.dumps(
                        {
                            "type": "job_result",
                            "request_id": request_id,
                            "ok": True,
                            "payload": {"text": "A WebSocket is a persistent duplex channel."},
                        }
                    )
                )
            else:
                await socket.send(
                    json.dumps(
                        {
                            "type": "job_delta",
                            "request_id": request_id,
                            "payload": {"text": answer[:80]},
                        }
                    )
                )
                await socket.send(
                    json.dumps(
                        {
                            "type": "job_result",
                            "request_id": request_id,
                            "ok": True,
                            "payload": {
                                "text": answer,
                                "finish_reason": "stop",
                                "duration_ms": 4210,
                                "source_url": "https://www.google.com/search?udm=50&q=websocket",
                            },
                        }
                    )
                )

            response = await asyncio.wait_for(request_task, timeout=30)
            payload = response.json()
            print(f"[4] chat completion     -> HTTP {response.status_code}")
            print(f"    object : {payload.get('object')}")
            print(f"    model  : {payload.get('model')}")
            print(f"    id     : {payload.get('id')}")
            print(f"    finish : {payload['choices'][0].get('finish_reason')}")
            print(f"    usage  : {payload.get('usage')}")
            content = payload["choices"][0]["message"]["content"]
            print(f"    answer : {content[:220]!r}")

            if response.status_code != 200:
                failures.append(f"unexpected status code {response.status_code}: {payload}")
            if payload.get("object") != "chat.completion":
                failures.append("the response is not OpenAI compatible")
            if not content:
                failures.append("the answer is empty")
            if answer is not None and content.strip() != answer.strip():
                failures.append("the answer does not match what the extension sent")

            # A second request must work as well (the tab lock is released).
            second_task = asyncio.create_task(
                client.post(
                    "/v1/chat/completions",
                    json={
                        "model": "google-ai-mode",
                        "messages": [{"role": "user", "content": "And a WebSocket close frame?"}],
                    },
                )
            )
            job2 = json.loads(await asyncio.wait_for(socket.recv(), timeout=15))
            await socket.send(
                json.dumps(
                    {
                        "type": "job_result",
                        "request_id": job2["request_id"],
                        "ok": True,
                        "payload": {"text": "A close frame terminates the connection."},
                    }
                )
            )
            second_payload = (await asyncio.wait_for(second_task, timeout=30)).json()
            print(f"[5] second request      -> {second_payload['choices'][0]['message']['content']!r}")
            if not second_payload["choices"][0]["message"]["content"]:
                failures.append("the second request failed")

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("\nE2E OK - the full chain works.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", default="http://127.0.0.1:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("--answer", default=None)
    args = parser.parse_args()

    return asyncio.run(run(args.backend, args.token, args.answer))


if __name__ == "__main__":
    sys.exit(main())
