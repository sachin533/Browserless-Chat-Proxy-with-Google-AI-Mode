"""OpenAI compatible chat schemas."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Role = Literal["system", "user", "assistant", "tool", "function"]


class ChatMessageContentPart(BaseModel):
    """A single structured content part of a message."""

    model_config = ConfigDict(extra="allow")

    type: str = "text"
    text: str | None = None


class ChatMessage(BaseModel):
    """A single chat message."""

    model_config = ConfigDict(extra="allow")

    role: Role
    content: str | list[ChatMessageContentPart] | None = None
    name: str | None = None

    @field_validator("content", mode="before")
    @classmethod
    def _normalise_content(cls, value: Any) -> Any:
        if value is None:
            return ""
        if isinstance(value, (str, list)):
            return value
        return str(value)

    def text(self) -> str:
        """Return the plain text of the message."""
        if self.content is None:
            return ""
        if isinstance(self.content, str):
            return self.content
        parts: list[str] = []
        for part in self.content:
            if isinstance(part, ChatMessageContentPart):
                if part.text:
                    parts.append(part.text)
            elif isinstance(part, dict):
                text = part.get("text")
                if text:
                    parts.append(str(text))
        return "\n".join(parts)


class ChatCompletionRequest(BaseModel):
    """OpenAI compatible ``/v1/chat/completions`` request body."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    model: str = "google-ai-mode"
    messages: list[ChatMessage] = Field(..., min_length=1)
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    n: int | None = Field(default=None, ge=1, le=1)
    max_tokens: int | None = Field(default=None, ge=1)
    stop: str | list[str] | None = None
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    seed: int | None = None
    user: str | None = None
    response_format: dict[str, Any] | None = None

    @field_validator("messages")
    @classmethod
    def _messages_not_empty(cls, value: list[ChatMessage]) -> list[ChatMessage]:
        if not value:
            raise ValueError("'messages' must contain at least one message")
        return value

    @model_validator(mode="after")
    def _must_contain_user_content(self) -> "ChatCompletionRequest":
        if not any(message.text().strip() for message in self.messages):
            raise ValueError("at least one message must contain non-empty text")
        return self


class ChatCompletionMessage(BaseModel):
    """The assistant message inside a completion choice."""

    role: Literal["assistant"] = "assistant"
    content: str
    refusal: str | None = None


class ChatCompletionChoice(BaseModel):
    """A single completion choice."""

    index: int = 0
    message: ChatCompletionMessage
    finish_reason: str | None = "stop"
    logprobs: None = None


class ChatCompletionUsage(BaseModel):
    """Token usage estimate.

    The browser based pipeline cannot report real model token counts, so these
    values are character based estimates and are documented as such.
    """

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatCompletionResponse(BaseModel):
    """OpenAI compatible completion response."""

    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4().hex}")
    object: Literal["chat.completion"] = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str = "google-ai-mode"
    choices: list[ChatCompletionChoice]
    usage: ChatCompletionUsage = Field(default_factory=ChatCompletionUsage)
    system_fingerprint: str | None = None


class ChatCompletionChunkChoice(BaseModel):
    """A single streaming choice delta."""

    index: int = 0
    delta: dict[str, str] = Field(default_factory=dict)
    finish_reason: str | None = None


class ChatCompletionChunk(BaseModel):
    """OpenAI compatible streaming chunk."""

    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str = "google-ai-mode"
    choices: list[ChatCompletionChunkChoice] = Field(default_factory=list)


class ErrorDetail(BaseModel):
    """Structured error payload."""

    message: str
    type: str = "api_error"
    code: str | None = None
    param: str | None = None
    details: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    """OpenAI compatible error envelope."""

    error: ErrorDetail
