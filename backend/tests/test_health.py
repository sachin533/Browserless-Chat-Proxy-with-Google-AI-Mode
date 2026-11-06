"""Health endpoint tests."""

from __future__ import annotations


def test_health_returns_service_metadata(client):
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "Google AI Mode API"
    assert body["version"]
    assert "timestamp" in body


def test_health_reports_extension_state(client):
    body = client.get("/health").json()

    assert body["extension_connected"] is False
    assert body["pending_requests"] == 0


def test_root_endpoint_points_at_the_documentation(client):
    body = client.get("/").json()

    assert body["docs"] == "/docs"
    assert body["health"] == "/health"
    assert body["extension_status"] == "/api/extension/status"


def test_openapi_schema_is_served(client):
    schema = client.get("/openapi.json").json()

    assert "/v1/chat/completions" in schema["paths"]
    assert "/api/extension/status" in schema["paths"]
    assert "/health" in schema["paths"]
