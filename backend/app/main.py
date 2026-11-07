"""FastAPI application factory for the Google AI Mode API."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.bootstrap import ensure_pairing_token
from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, PayloadTooLargeError, RateLimitError
from app.core.logging import configure_logging, get_logger
from app.core.rate_limit import RateLimiter
from app.routes import chat, extension, health
from app.services.extension_manager import ExtensionManager
from app.services.google_ai_service import GoogleAIService
from app.services.request_manager import RequestManager

logger = get_logger(__name__)

DESCRIPTION = """
Turn the Google AI Mode web interface into a REST API.

A Chrome extension (running in **your** browser, on **your** Google session)
drives the Google AI Mode tab.  The backend talks to that extension over a
WebSocket, so the answers are produced by Google AI Mode itself - no official
or paid AI API is involved and no credentials ever leave your machine.
"""

TAGS_METADATA = [
    {"name": "health", "description": "Liveness of the backend."},
    {"name": "extension", "description": "Chrome extension bridge status and control."},
    {"name": "chat", "description": "OpenAI compatible chat completions."},
]


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request id and enforce the maximum request body size."""

    def __init__(self, app: Any, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = request_id

        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
            except ValueError:
                size = 0
            if size > self._settings.max_request_bytes:
                error = PayloadTooLargeError(
                    f"The request body is larger than the allowed "
                    f"{self._settings.max_request_bytes} bytes."
                )
                return JSONResponse(status_code=error.status_code, content=error.to_payload())

        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple token bucket rate limit for the public REST endpoints."""

    def __init__(self, app: Any, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings
        self._limiter = RateLimiter(
            limit=settings.rate_limit_requests, window_seconds=settings.rate_limit_window_seconds
        )

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        path = request.url.path
        if path.startswith("/v1/") and request.method == "POST":
            api_key = request.headers.get("x-api-key") or (
                request.headers.get("authorization") or ""
            )
            client = request.client.host if request.client else "unknown"
            key = api_key or client
            allowed, retry_after = self._limiter.check(key)
            if not allowed:
                error = RateLimitError(
                    f"Rate limit of {self._settings.rate_limit_requests} requests per "
                    f"{self._settings.rate_limit_window_seconds:.0f}s exceeded."
                )
                response = JSONResponse(
                    status_code=error.status_code, content=error.to_payload()
                )
                response.headers["Retry-After"] = str(retry_after)
                return response
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings)

    ensure_pairing_token(settings)

    extension_manager = ExtensionManager(settings)
    request_manager = RequestManager(settings)
    google_ai_service = GoogleAIService(extension_manager, request_manager, settings)

    app.state.settings = settings
    app.state.extension_manager = extension_manager
    app.state.request_manager = request_manager
    app.state.google_ai_service = google_ai_service

    logger.info("%s %s is ready on %s:%s", settings.app_name, settings.version, settings.host, settings.port)
    try:
        yield
    finally:
        await extension_manager.unregister()
        logger.info("Shutdown complete")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application."""
    settings = settings or get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description=DESCRIPTION,
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
        root_path=settings.root_path,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(RequestContextMiddleware, settings=settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        # The provenance headers must be exposed explicitly, otherwise a
        # browser cannot read them from a cross origin response.
        expose_headers=[
            "X-Request-Id",
            "X-Google-AI-Mode-Request-Id",
            "X-Google-AI-Mode-Source",
            "X-Google-AI-Mode-Duration-Ms",
        ],
    )

    _register_exception_handlers(app)

    app.include_router(health.router)
    app.include_router(extension.router)
    app.include_router(chat.router)
    app.include_router(extension.ws_router)

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, Any]:
        return {
            "service": settings.app_name,
            "version": settings.version,
            "docs": "/docs",
            "health": "/health",
            "extension_status": "/api/extension/status",
        }

    return app


def _safe_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Return JSON serialisable validation errors.

    Pydantic embeds the original exception object in ``ctx`` which is not
    JSON serialisable - it is converted to its string representation.
    """
    from fastapi.encoders import jsonable_encoder

    try:
        return jsonable_encoder(exc.errors(), custom_encoder={Exception: str})
    except Exception:  # pragma: no cover - defensive
        return [{"msg": str(exc)}]


def _register_exception_handlers(app: FastAPI) -> None:
    """Render every failure as a structured, OpenAI compatible JSON error."""

    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        logger.warning("%s on %s: %s", exc.code, request.url.path, exc.message)
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", []) if part != "body")
        message = first.get("msg", "The request payload is invalid.")
        payload = {
            "error": {
                "message": f"{location}: {message}" if location else message,
                "type": "invalid_request_error",
                "code": "invalid_request",
                "param": location or None,
                "details": {"errors": _safe_errors(exc)},
            }
        }
        logger.warning("Validation error on %s: %s", request.url.path, message)
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        payload = {
            "error": {
                "message": str(exc.detail),
                "type": "invalid_request_error" if exc.status_code < 500 else "api_error",
                "code": f"http_{exc.status_code}",
                "param": None,
            }
        }
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(Exception)
    async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s", request.url.path)
        payload = {
            "error": {
                "message": "An unexpected internal error occurred.",
                "type": "api_error",
                "code": "internal_error",
                "param": None,
            }
        }
        return JSONResponse(status_code=500, content=payload)


app = create_app()

__all__ = ["app", "create_app", "lifespan"]
