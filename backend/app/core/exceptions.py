"""Structured application errors.

Every failure surfaced to a client is an :class:`AppError` so that the HTTP
layer can render a predictable, OpenAI compatible JSON error body::

    {"error": {"message": "...", "type": "...", "code": "...", "param": null}}
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base class for every error raised by the application."""

    code: str = "internal_error"
    status_code: int = 500
    error_type: str = "api_error"
    message: str = "An unexpected error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        error_type: str | None = None,
        param: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.error_type = error_type or self.error_type
        self.param = param
        self.details = details or {}
        super().__init__(self.message)

    def to_payload(self) -> dict[str, Any]:
        error: dict[str, Any] = {
            "message": self.message,
            "type": self.error_type,
            "code": self.code,
            "param": self.param,
        }
        if self.details:
            error["details"] = self.details
        return {"error": error}


# ----------------------------------------------------------------------
# Authentication / authorisation
# ----------------------------------------------------------------------
class AuthenticationError(AppError):
    code = "authentication_failed"
    status_code = 401
    error_type = "authentication_error"
    message = "Invalid or missing authentication credentials."


class AuthorizationError(AppError):
    code = "forbidden"
    status_code = 403
    error_type = "permission_error"
    message = "You do not have permission to perform this operation."


class RateLimitError(AppError):
    code = "rate_limit_exceeded"
    status_code = 429
    error_type = "rate_limit_error"
    message = "Rate limit exceeded. Please retry later."


class PayloadTooLargeError(AppError):
    code = "payload_too_large"
    status_code = 413
    error_type = "invalid_request_error"
    message = "Request payload is too large."


# ----------------------------------------------------------------------
# Request validation
# ----------------------------------------------------------------------
class InvalidRequestError(AppError):
    code = "invalid_request"
    status_code = 400
    error_type = "invalid_request_error"
    message = "The request payload is invalid."


class StreamingNotSupportedError(AppError):
    code = "streaming_not_supported"
    status_code = 400
    error_type = "invalid_request_error"
    message = (
        "Streaming is not available for this request. Retry with \"stream\": false."
    )


# ----------------------------------------------------------------------
# Extension / browser errors
# ----------------------------------------------------------------------
class ExtensionNotConnectedError(AppError):
    code = "extension_not_connected"
    status_code = 503
    error_type = "service_unavailable"
    message = (
        "The Chrome extension is not connected to the backend. "
        "Open the extension popup and click Connect."
    )


class ExtensionAuthError(AppError):
    code = "extension_auth_failed"
    status_code = 401
    error_type = "authentication_error"
    message = "The extension failed to authenticate with the backend."


class AiModeTabNotFoundError(AppError):
    code = "ai_mode_tab_not_found"
    status_code = 503
    error_type = "service_unavailable"
    message = (
        "No Google AI Mode tab is available in the browser. "
        "Open https://www.google.com/search?udm=50 and sign in to Google."
    )


class LoginRequiredError(AppError):
    code = "login_required"
    status_code = 401
    error_type = "authentication_error"
    message = (
        "Google sign-in is required. Log in to your Google account in the "
        "Google AI Mode tab and retry."
    )


class PromptInputUnavailableError(AppError):
    code = "prompt_input_unavailable"
    status_code = 502
    error_type = "upstream_error"
    message = (
        "The Google AI Mode prompt input could not be located on the page. "
        "The page layout may have changed - use the Diagnose command to inspect it."
    )


class PromptSubmissionError(AppError):
    code = "prompt_submission_failed"
    status_code = 502
    error_type = "upstream_error"
    message = "The prompt could not be submitted to Google AI Mode."


class ResponseTimeoutError(AppError):
    code = "response_timeout"
    status_code = 504
    error_type = "timeout_error"
    message = "Timed out while waiting for the Google AI Mode response."


class EmptyResponseError(AppError):
    code = "empty_response"
    status_code = 502
    error_type = "upstream_error"
    message = "Google AI Mode returned an empty response."


class ResponseExtractionError(AppError):
    code = "response_extraction_failed"
    status_code = 502
    error_type = "upstream_error"
    message = (
        "The response could not be extracted from the Google AI Mode page. "
        "The page layout may have changed."
    )


class PageNavigatedError(AppError):
    code = "page_navigated"
    status_code = 502
    error_type = "upstream_error"
    message = "The Google AI Mode page navigated away while the request was running."


class CaptchaDetectedError(AppError):
    code = "captcha_detected"
    status_code = 403
    error_type = "upstream_error"
    message = (
        "Google is showing a CAPTCHA / unusual-traffic page. "
        "Solve it manually in the browser tab and retry."
    )


class ServiceBusyError(AppError):
    code = "service_busy"
    status_code = 429
    error_type = "rate_limit_error"
    message = (
        "The browser session is busy with another request and the queue is full. "
        "Retry shortly."
    )


class RequestCancelledError(AppError):
    code = "request_cancelled"
    status_code = 499
    error_type = "cancelled_error"
    message = "The request was cancelled."


class BackendUnavailableError(AppError):
    code = "backend_unavailable"
    status_code = 503
    error_type = "service_unavailable"
    message = "The backend is currently unavailable."
