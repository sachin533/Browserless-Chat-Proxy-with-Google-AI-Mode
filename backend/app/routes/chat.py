"""OpenAI compatible chat completions endpoint."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import get_settings
from app.core.exceptions import AppError, InvalidRequestError
from app.core.logging import get_logger
from app.core.security import require_api_key
from app.schemas.chat import (
    ChatCompletionChoice,
    ChatCompletionChunk,
    ChatCompletionChunkChoice,
    ChatCompletionMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionUsage,
)
from app.services.prompt_builder import build_prompt, build_usage
from app.services.request_manager import DeltaEvent, FinalEvent

logger = get_logger(__name__)

router = APIRouter(
    tags=["chat"],
    dependencies=[Depends(require_api_key)],
    responses={
        400: {"description": "Invalid request"},
        401: {"description": "Authentication failed"},
        429: {"description": "Rate limited or the browser session is busy"},
        502: {"description": "The browser interaction failed"},
        503: {"description": "The extension is not connected"},
        504: {"description": "Timed out waiting for the answer"},
    },
)


@router.post(
    "/v1/chat/completions",
    response_model=None,
    summary="Chat completions backed by Google AI Mode",
)
async def chat_completions(
    body: ChatCompletionRequest,
    request: Request,
) -> Any:
    """Run a chat completion through the user's authenticated AI Mode tab."""
    settings = get_settings()
    service = request.app.state.google_ai_service

    if body.model not in settings.supported_models:
        raise InvalidRequestError(
            f"Unsupported model '{body.model}'. "
            f"Supported models: {', '.join(settings.supported_models)}.",
            param="model",
        )

    prompt = build_prompt(body.messages)
    if not prompt.strip():
        raise InvalidRequestError("The request does not contain a usable prompt.", param="messages")
    if len(prompt) > settings.max_prompt_chars:
        raise InvalidRequestError(
            f"The prompt is too long ({len(prompt)} characters, limit is "
            f"{settings.max_prompt_chars}).",
            param="messages",
        )

    if body.stream:
        # Validate the browser preconditions *before* the response starts so
        # that failures are reported with a proper HTTP status code.
        service.ensure_ready()
        return StreamingResponse(
            _stream_response(service, body, prompt),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    result = await service.complete(prompt, model=body.model)

    response = ChatCompletionResponse(
        id=f"chatcmpl-{result.request_id.replace('req_', '')}",
        created=int(time.time()),
        model=body.model,
        choices=[
            ChatCompletionChoice(
                index=0,
                message=ChatCompletionMessage(role="assistant", content=result.text),
                finish_reason=result.finish_reason,
            )
        ],
        usage=ChatCompletionUsage(**build_usage(prompt, result.text)),
    )
    return JSONResponse(
        content=response.model_dump(),
        headers={
            "X-Google-AI-Mode-Request-Id": result.request_id,
            "X-Google-AI-Mode-Source": result.source_url or "",
            "X-Google-AI-Mode-Duration-Ms": str(result.duration_ms),
        },
    )


async def _stream_response(
    service: Any, body: ChatCompletionRequest, prompt: str
) -> AsyncIterator[str]:
    """Emit OpenAI compatible SSE chunks for a streamed answer."""
    completion_id = f"chatcmpl-{uuid.uuid4().hex}"
    created = int(time.time())
    model = body.model

    def chunk(delta: dict[str, str], finish_reason: str | None = None) -> str:
        payload = ChatCompletionChunk(
            id=completion_id,
            created=created,
            model=model,
            choices=[
                ChatCompletionChunkChoice(index=0, delta=delta, finish_reason=finish_reason)
            ],
        )
        return f"data: {payload.model_dump_json(exclude_none=True)}\n\n"

    finished = False
    try:
        async for event in service.stream(prompt, model=model):
            if isinstance(event, DeltaEvent):
                if event.text:
                    yield chunk({"content": event.text})
            elif isinstance(event, FinalEvent):
                # The final event carries the complete answer; the client has
                # already received the incremental parts.
                yield chunk({}, finish_reason=event.finish_reason or "stop")
                finished = True
    except AppError as exc:
        logger.warning("Streaming request failed: %s", exc.code)
        error_payload = exc.to_payload()["error"]
        yield f"data: {json.dumps({'error': error_payload})}\n\n"
    except Exception:  # pragma: no cover - defensive
        logger.exception("Unexpected streaming failure")
        error_payload = {
            "message": "The streaming request failed unexpectedly.",
            "type": "api_error",
            "code": "internal_error",
            "param": None,
        }
        yield f"data: {json.dumps({'error': error_payload})}\n\n"

    if not finished:
        yield chunk({}, finish_reason="stop")
    yield "data: [DONE]\n\n"
