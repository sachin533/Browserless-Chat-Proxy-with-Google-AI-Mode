"""Extension status endpoint tests."""

from __future__ import annotations


def test_status_reports_a_disconnected_extension(client):
    response = client.get("/api/extension/status")

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is False
    assert body["session_id"] is None
    assert body["ai_mode_tab_open"] is False
    assert body["ai_mode_ready"] is False
    assert body["logged_in"] is False
    assert body["login_required"] is True
    assert body["pending_requests"] == 0
    assert body["pairing_token_configured"] is True
    assert "not connected" in body["message"]


def test_status_never_leaks_the_pairing_token(client):
    body = client.get("/api/extension/status").json()

    assert "test-pairing-token" not in str(body)
    assert "extension_pairing_token" not in body


async def test_status_reports_the_ready_browser_state(async_client, mock_extension):
    response = await async_client.get("/api/extension/status")

    body = response.json()
    assert body["connected"] is True
    assert body["session_id"]
    assert body["ai_mode_tab_open"] is True
    assert body["ai_mode_ready"] is True
    assert body["logged_in"] is True
    assert body["login_required"] is False
    assert body["page_url"].startswith("https://www.google.com/search")


async def test_status_reports_a_missing_login(async_client, mock_extension):
    mock_extension.set_status(logged_in=False)

    body = (await async_client.get("/api/extension/status")).json()

    assert body["logged_in"] is False
    assert body["login_required"] is True
    assert "sign-in" in body["message"].lower()


async def test_status_reports_a_missing_tab(async_client, mock_extension):
    mock_extension.set_status(ai_mode_tab_open=False)

    body = (await async_client.get("/api/extension/status")).json()

    assert body["ai_mode_tab_open"] is False
    assert "no google ai mode tab" in body["message"].lower()
