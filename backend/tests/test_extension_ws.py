"""WebSocket handshake and authentication tests."""

from __future__ import annotations

import json

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import PAIRING_TOKEN


def test_websocket_rejects_an_invalid_token(client):
    with client.websocket_connect("/ws/extension?token=wrong-token") as websocket:
        message = websocket.receive_json()

    assert message["type"] == "auth_error"
    assert message["error"]["code"] == "extension_auth_failed"


def test_websocket_accepts_a_valid_query_token(client):
    with client.websocket_connect(f"/ws/extension?token={PAIRING_TOKEN}") as websocket:
        message = websocket.receive_json()

    assert message["type"] == "auth_ok"
    assert message["session_id"]
    assert message["heartbeat_seconds"] > 0


def test_websocket_accepts_the_auth_message_handshake(client):
    with client.websocket_connect("/ws/extension") as websocket:
        websocket.send_text(
            json.dumps(
                {
                    "type": "auth",
                    "token": PAIRING_TOKEN,
                    "client": {"name": "google-ai-mode-extension", "version": "1.0.0"},
                }
            )
        )
        message = websocket.receive_json()

    assert message["type"] == "auth_ok"


def test_websocket_rejects_a_bad_auth_message(client):
    with client.websocket_connect("/ws/extension") as websocket:
        websocket.send_text(json.dumps({"type": "auth", "token": "nope"}))
        message = websocket.receive_json()

    assert message["type"] == "auth_error"


def test_websocket_requires_authentication_first(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/extension") as websocket:
            websocket.send_text(json.dumps({"type": "ping"}))
            websocket.receive_json()


def test_extension_status_update_is_forwarded(client):
    with client.websocket_connect(f"/ws/extension?token={PAIRING_TOKEN}") as websocket:
        assert websocket.receive_json()["type"] == "auth_ok"
        websocket.send_text(
            json.dumps(
                {
                    "type": "status",
                    "payload": {
                        "ai_mode_tab_open": True,
                        "ai_mode_ready": True,
                        "logged_in": True,
                        "page_url": "https://www.google.com/search?udm=50",
                        "surface": "search_ai_mode",
                    },
                }
            )
        )

        status = client.get("/api/extension/status").json()
        assert status["connected"] is True
        assert status["logged_in"] is True
        assert status["surface"] == "search_ai_mode"


def test_websocket_ping_is_answered_with_a_pong(client):
    with client.websocket_connect(f"/ws/extension?token={PAIRING_TOKEN}") as websocket:
        websocket.receive_json()
        websocket.send_text(json.dumps({"type": "ping"}))

        message = websocket.receive_json()

    assert message["type"] == "pong"
