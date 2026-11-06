"""Schemas describing the extension channel and its status."""

from __future__ import annotations

import time
from typing import Any, Literal

from pydantic import BaseModel, Field


class ExtensionClientInfo(BaseModel):
    """Identity advertised by the extension during the handshake."""

    name: str = "google-ai-mode-extension"
    version: str = "unknown"
    user_agent: str | None = None


class ExtensionTabStatus(BaseModel):
    """State of the Google AI Mode tab inside the user's browser."""

    ai_mode_tab_open: bool = False
    ai_mode_ready: bool = False
    logged_in: bool = False
    captcha_detected: bool = False
    page_url: str | None = None
    surface: str | None = None
    tab_id: int | None = None
    prompt_input_available: bool = False
    answer_container_available: bool = False
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class ExtensionStatus(BaseModel):
    """Full status snapshot of the extension connection."""

    connected: bool = False
    session_id: str | None = None
    client: ExtensionClientInfo | None = None
    connected_at: float | None = None
    last_seen_at: float | None = None
    last_message_at: float | None = None
    pending_requests: int = 0
    tab: ExtensionTabStatus = Field(default_factory=ExtensionTabStatus)
    login_required: bool = True
    message: str = "The Chrome extension is not connected."


class ExtensionStatusResponse(BaseModel):
    """Response body of ``GET /api/extension/status``."""

    connected: bool
    session_id: str | None = None
    ai_mode_tab_open: bool
    ai_mode_ready: bool
    logged_in: bool
    login_required: bool
    captcha_detected: bool
    page_url: str | None = None
    surface: str | None = None
    pending_requests: int
    last_seen_at: float | None = None
    connected_at: float | None = None
    pairing_token_configured: bool
    message: str


class ExtensionAuthMessage(BaseModel):
    """Handshake message sent by the extension."""

    type: Literal["auth"] = "auth"
    token: str
    client: ExtensionClientInfo = Field(default_factory=ExtensionClientInfo)


class ExtensionStatusMessage(BaseModel):
    """Periodic status update sent by the extension."""

    type: Literal["status"] = "status"
    payload: ExtensionTabStatus = Field(default_factory=ExtensionTabStatus)


class ExtensionResultMessage(BaseModel):
    """Terminal result for a browser interaction job."""

    type: Literal["job_result"] = "job_result"
    request_id: str
    ok: bool = True
    payload: dict[str, Any] = Field(default_factory=dict)
    error: dict[str, Any] | None = None


class ExtensionDeltaMessage(BaseModel):
    """Incremental answer update sent while the answer is being rendered."""

    type: Literal["job_delta"] = "job_delta"
    request_id: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ExtensionPingMessage(BaseModel):
    """Keep alive ping/pong."""

    type: Literal["ping", "pong"]
    timestamp: float = Field(default_factory=time.time)


class JobPayload(BaseModel):
    """Payload of a browser interaction job."""

    prompt: str
    timeout_ms: int = 180_000
    reset_conversation: bool = True
    surface: str | None = None


class JobMessage(BaseModel):
    """Job dispatched from the backend to the extension."""

    type: Literal["job"] = "job"
    request_id: str
    action: Literal["run_prompt"] = "run_prompt"
    payload: JobPayload


class StatusRequestMessage(BaseModel):
    """Ask the extension for an immediate status update."""

    type: Literal["status_request"] = "status_request"


class ServerPingMessage(BaseModel):
    """Server keep alive ping."""

    type: Literal["ping"] = "ping"
    timestamp: float = Field(default_factory=time.time)


class AuthOkMessage(BaseModel):
    """Successful handshake response."""

    type: Literal["auth_ok"] = "auth_ok"
    session_id: str
    server_time: float = Field(default_factory=time.time)
    heartbeat_seconds: int = 30


class AuthErrorMessage(BaseModel):
    """Failed handshake response."""

    type: Literal["auth_error"] = "auth_error"
    error: dict[str, Any]
