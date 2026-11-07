"""Test double for the Chrome extension - FOR TESTING ONLY.

This script speaks the real extension WebSocket protocol so that the backend
and the frontend can be exercised **without** a browser tab.  It is a test
double: it does not talk to Google and it does not produce AI answers.

It is useful for:

* verifying the frontend against a running backend during development
* automated integration tests
* demoing the API surface without disturbing the user's real browser session

The answer text can be supplied with ``--answer`` (or ``--answer-file``) so
that a **real** Google AI Mode response can be replayed through the whole
chain.

Usage::

    python scripts/fake_extension.py --token <pairing token> \
        --answer "a real Google AI Mode answer"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

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


def chunk_text(text: str, size: int = 60) -> list[str]:
    """Split an answer into stream sized chunks."""
    return [text[index : index + size] for index in range(0, len(text), size)] or [""]


async def session(backend: str, token: str, answer: str, delay: float) -> None:
    url = backend.rstrip("/")
    if url.startswith("https://"):
        url = "wss://" + url[len("https://") :]
    elif url.startswith("http://"):
        url = "ws://" + url[len("http://") :]
    url = f"{url}/ws/extension"

    async with websockets.connect(url) as socket:
        await socket.send(
            json.dumps(
                {
                    "type": "auth",
                    "token": token,
                    "client": {"name": "fake-extension", "version": "1.0.0"},
                }
            )
        )
        handshake = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
        print(f"handshake: {handshake.get('type')}")
        if handshake.get("type") != "auth_ok":
            print(f"authentication failed: {handshake}", file=sys.stderr)
            return

        await socket.send(json.dumps({"type": "status", "payload": STATUS_PAYLOAD}))
        print("status: reported")

        async def send_heartbeat() -> None:
            while True:
                await asyncio.sleep(10)
                await socket.send(json.dumps({"type": "status", "payload": STATUS_PAYLOAD}))

        heartbeat = asyncio.create_task(send_heartbeat())

        try:
            async for raw in socket:
                message = json.loads(raw)
                if message.get("type") != "job":
                    continue

                request_id = message.get("request_id")
                prompt = (message.get("payload") or {}).get("prompt", "")
                print(f"job {request_id}: {prompt[:70]}")

                for piece in chunk_text(answer):
                    await socket.send(
                        json.dumps(
                            {
                                "type": "job_delta",
                                "request_id": request_id,
                                "payload": {"text": piece},
                            }
                        )
                    )
                    if delay:
                        await asyncio.sleep(delay)

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
                                "source_url": (
                                    "https://www.google.com/search?"
                                    "q=Explain+Java+OOP+concepts+in+simple+terms.&udm=50"
                                ),
                            },
                        }
                    )
                )
                print(f"job {request_id}: answered")
        finally:
            heartbeat.cancel()


async def run(backend: str, token: str, answer: str, delay: float) -> int:
    """Keep the session alive - only one extension can be attached at a time."""
    attempt = 0
    while True:
        attempt += 1
        try:
            await session(backend, token, answer, delay)
        except Exception as exc:  # pragma: no cover - transport churn
            print(f"session ended ({exc}); reconnecting")
        await asyncio.sleep(2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", default="http://127.0.0.1:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("--answer", default="(no answer configured)")
    parser.add_argument("--answer-file", type=Path, default=None)
    parser.add_argument("--delay", type=float, default=0.05)
    parser.add_argument("--once", action="store_true", help="do not reconnect")
    args = parser.parse_args()

    answer = args.answer
    if args.answer_file:
        answer = args.answer_file.read_text(encoding="utf-8-sig").strip()

    if args.once:
        return asyncio.run(session(args.backend, args.token, answer, args.delay) or 0)

    try:
        asyncio.run(run(args.backend, args.token, answer, args.delay))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
