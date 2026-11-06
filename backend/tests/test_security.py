"""Security helper tests."""

from __future__ import annotations

from app.core.security import (
    constant_time_equals,
    extract_api_key,
    verify_api_key,
    verify_pairing_token,
)
from tests.conftest import PAIRING_TOKEN


def test_a_matching_pairing_token_is_accepted(settings):
    assert verify_pairing_token(PAIRING_TOKEN, settings) is True


def test_a_wrong_pairing_token_is_rejected(settings):
    assert verify_pairing_token("wrong", settings) is False
    assert verify_pairing_token("", settings) is False
    assert verify_pairing_token(None, settings) is False


def test_no_token_configured_rejects_everything(settings):
    settings.extension_pairing_token = ""

    assert verify_pairing_token("anything", settings) is False


def test_api_keys_are_verified(settings):
    settings.api_keys = "key-one, key-two"

    assert verify_api_key("key-one", settings) is True
    assert verify_api_key("key-two", settings) is True
    assert verify_api_key("key-three", settings) is False
    assert verify_api_key(None, settings) is False


def test_api_keys_can_be_extracted_from_the_headers(settings):
    class FakeRequest:
        def __init__(self, headers):
            self.headers = headers

    assert extract_api_key(FakeRequest({"x-api-key": "abc"})) == "abc"
    assert extract_api_key(FakeRequest({"authorization": "Bearer xyz"})) == "xyz"
    assert extract_api_key(FakeRequest({})) is None


def test_constant_time_comparison():
    assert constant_time_equals("abc", "abc") is True
    assert constant_time_equals("abc", "abd") is False


def test_the_rest_api_is_open_when_no_key_is_required(client):
    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "google-ai-mode",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )

    # It must not fail with 401 - the extension is simply not connected.
    assert response.status_code != 401


async def test_the_rest_api_requires_a_key_when_enabled(async_client, app, settings):
    settings.require_api_key = True
    settings.api_keys = "secret-key"

    response = await async_client.post(
        "/v1/chat/completions",
        json={
            "model": "google-ai-mode",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_failed"

    response = await async_client.post(
        "/v1/chat/completions",
        headers={"X-API-Key": "secret-key"},
        json={
            "model": "google-ai-mode",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert response.status_code == 503
