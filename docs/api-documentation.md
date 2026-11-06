# API documentation

Base URL (local): `http://127.0.0.1:8000`
OpenAPI schema: <http://127.0.0.1:8000/openapi.json>

---

## 1. `GET /health`

Liveness of the backend.

**200 OK**

```json
{
  "status": "ok",
  "service": "Google AI Mode API",
  "version": "1.0.0",
  "environment": "development",
  "timestamp": 1793880089.8449216,
  "extension_connected": true,
  "pending_requests": 0
}
```

---

## 2. `GET /api/extension/status`

Reports whether the extension is connected and whether the browser is ready to
serve prompts.

**200 OK**

```json
{
  "connected": true,
  "session_id": "9c4f1b2e8a7d4c6f9e0a1b2c3d4e5f60",
  "ai_mode_tab_open": true,
  "ai_mode_ready": true,
  "logged_in": true,
  "login_required": false,
  "captcha_detected": false,
  "page_url": "https://www.google.com/search?udm=50",
  "surface": "search_ai_mode",
  "pending_requests": 0,
  "last_seen_at": 1793880089.1,
  "connected_at": 1793880000.4,
  "pairing_token_configured": true,
  "message": "The extension is connected and Google AI Mode is ready."
}
```

| Field | Type | Meaning |
|---|---|---|
| `connected` | bool | The extension holds an authenticated WebSocket |
| `session_id` | string \| null | Id of the current extension session |
| `ai_mode_tab_open` | bool | A Google AI Mode / Gemini tab is open |
| `ai_mode_ready` | bool | The prompt input was found on that page |
| `logged_in` | bool | Google considers the session authenticated |
| `login_required` | bool | `!logged_in` |
| `captcha_detected` | bool | Google is challenging the session |
| `page_url` | string \| null | URL of the AI Mode tab |
| `surface` | string \| null | `search_ai_mode` or `gemini` |
| `pending_requests` | int | Requests currently in flight |
| `pairing_token_configured` | bool | Whether a pairing token exists (never the value) |

The endpoint never returns the pairing token or any page content.

---

## 3. `POST /v1/chat/completions`

An OpenAI compatible chat completion, answered by Google AI Mode.

### Request

```jsonc
{
  "model": "google-ai-mode",          // optional, default "google-ai-mode"
  "messages": [                       // required, at least one
    {"role": "system",  "content": "Be brief."},           // optional
    {"role": "user",    "content": "Explain Python."}       // required
  ],
  "stream": false,                    // optional
  "temperature": 0.7,                 // accepted and ignored
  "max_tokens": 512,                  // accepted and ignored
  "top_p": 0.9,                       // accepted and ignored
  "stop": ["\n\n"],                   // accepted and ignored
  "user": "my-app"                    // optional, accepted and ignored
}
```

`role` may be `system`, `user`, `assistant`, `tool` or `function`.
`content` may be a string or a list of `{type, text}` parts.

**Model names** — controlled by `SUPPORTED_MODELS`.  The default list is:

```
google-ai-mode, ai-mode, google-ai, gemini, gpt-4o-mini, gpt-4o
```

The alias names exist so that OpenAI SDK clients that insist on a familiar
model id keep working.  The requested model name is echoed back in the
response.

**Multi turn conversations** — Google AI Mode accepts one prompt per turn, so
a multi turn conversation is flattened into a transcript:

```
User: Hi
Assistant: Hello!
User: What is Python?
```

A `system` message is placed before the conversation.

### Response (200, `stream: false`)

```json
{
  "id": "chatcmpl-9c096dd49ad840958cde98d0c4d59f0f",
  "object": "chat.completion",
  "created": 1793880089,
  "model": "google-ai-mode",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Python is a popular, beginner-friendly programming language..."
      },
      "finish_reason": "stop",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 76,
    "total_tokens": 85
  },
  "system_fingerprint": null
}
```

> **About `usage`** — the browser pipeline cannot report the model's real
> token counts.  The values are character based estimates (~4 characters per
> token) and are provided for compatibility only.

### Response headers

| Header | Example |
|---|---|
| `X-Google-AI-Mode-Request-Id` | `req_9c096dd49ad840958cde98d0c4d59f0f` |
| `X-Google-AI-Mode-Source` | `https://www.google.com/search?udm=50&q=websocket` |
| `X-Google-AI-Mode-Duration-Ms` | `4084` |
| `X-Request-Id` | `7b0c…` |

### Response (200, `stream: true`)

Server-Sent Events.  Each chunk is an OpenAI compatible
`chat.completion.chunk`:

```
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","created":1793880248,"model":"google-ai-mode","choices":[{"index":0,"delta":{"content":"Python "}}]}

data: {"id":"chatcmpl-…","object":"chat.completion.chunk","created":1793880248,"model":"google-ai-mode","choices":[{"index":0,"delta":{"content":"is a programming language."}}]}

data: {"id":"chatcmpl-…","object":"chat.completion.chunk","created":1793880248,"model":"google-ai-mode","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

> **About streaming** — the chunks are the *rendered* answer as it appears in
> the page, not the model's token stream.  Google does not expose a token
> stream to the page, so the granularity is the browser's render
> granularity.  The data is genuinely incremental, but it is not token-exact.

If the browser becomes unavailable **before** the stream starts, a normal
HTTP error is returned (for example `503 extension_not_connected`).  If the
failure happens mid-stream, an error object is emitted as an SSE event:

```
data: {"error":{"message":"…","type":"upstream_error","code":"response_timeout","param":null}}
```

### Errors

```json
{
  "error": {
    "message": "The Chrome extension is not connected to the backend. Open the extension popup and click Connect.",
    "type": "service_unavailable",
    "code": "extension_not_connected",
    "param": null
  }
}
```

`error.details` is included when there is additional context.

| HTTP | `code` | When |
|---|---|---|
| 400 | `invalid_request` | Unknown model, empty prompt, prompt too long |
| 401 | `authentication_failed` | `REQUIRE_API_KEY=true` and the key is missing/wrong |
| 401 | `login_required` | The browser is not signed in to Google |
| 403 | `captcha_detected` | Google shows a CAPTCHA |
| 413 | `payload_too_large` | Body exceeds `MAX_REQUEST_BYTES` |
| 422 | `invalid_request` | Body validation failed |
| 429 | `rate_limit_exceeded` | Rate limit hit |
| 429 | `service_busy` | The browser session is busy and the queue is full |
| 502 | `prompt_input_unavailable` | The prompt field could not be found |
| 502 | `prompt_submission_failed` | The prompt could not be submitted |
| 502 | `response_extraction_failed` | The answer could not be read |
| 502 | `empty_response` | Google returned nothing |
| 502 | `extension_disconnected` | The extension dropped mid-request |
| 503 | `extension_not_connected` | No extension |
| 503 | `ai_mode_tab_not_found` | No usable AI Mode tab |
| 504 | `response_timeout` | No answer within `REQUEST_TIMEOUT_SECONDS` |

---

## 4. `POST /api/extension/diagnose`

Asks the extension to report what it sees on the live page.  Use this when
Google changes the layout.

**200 OK**

```json
{
  "diagnostics": "{\n  \"url\": \"https://www.google.com/search?udm=50\",\n  \"surface\": \"search_ai_mode\",\n  …\n}",
  "source_url": "https://www.google.com/search?udm=50"
}
```

The `diagnostics` string is a JSON document containing:

| Key | Meaning |
|---|---|
| `surface` | `search_ai_mode`, `gemini` or `null` |
| `hostname` | Hostname of the page |
| `captcha` | Whether a CAPTCHA was detected |
| `loggedIn` | `true`, `false` or `null` (unknown) |
| `promptInputFound` | Whether the prompt field was located |
| `promptInputAriaLabel` | The `aria-label` of the matched element |
| `sendButtonFound` / `sendButtonDisabled` | State of the send button |
| `answerContainerFound` | Whether an answer container exists |
| `generating` | Whether the model is still generating |
| `candidates` | The selector lists that were tried |

---

## 5. `WebSocket /ws/extension`

The extension control channel.  Only the extension uses it.

### Handshake

The token may be sent in the `X-Extension-Token` header, in the `?token=`
query parameter, or in the first message:

```json
{
  "type": "auth",
  "token": "…",
  "client": {"name": "google-ai-mode-extension", "version": "1.0.0"}
}
```

Success:

```json
{"type": "auth_ok", "session_id": "…", "server_time": 1793880000.4, "heartbeat_seconds": 30}
```

Failure (then the socket is closed with code `1008`):

```json
{"type": "auth_error", "error": {"code": "extension_auth_failed", "message": "Invalid pairing token."}}
```

### Message types

| Direction | Type | Purpose |
|---|---|---|
| ext → srv | `auth` | Handshake |
| ext → srv | `status` | Browser state snapshot (every ~15 s and on tab changes) |
| ext → srv | `job_delta` | Incremental answer text |
| ext → srv | `job_result` | Terminal success or failure |
| ext → srv | `ping` | Keep alive |
| srv → ext | `auth_ok` / `auth_error` | Handshake result |
| srv → ext | `job` | A browser interaction to perform |
| srv → ext | `ping` | Keep alive |

### Job actions

`run_prompt`:

```json
{
  "type": "job",
  "request_id": "req_9c096dd4…",
  "action": "run_prompt",
  "payload": {
    "prompt": "Explain Python in simple terms.",
    "timeout_ms": 180000,
    "reset_conversation": true
  }
}
```

`diagnose`:

```json
{"type": "job", "request_id": "req_…", "action": "diagnose", "payload": {"timeout_ms": 20000}}
```

### Result

```json
{
  "type": "job_result",
  "request_id": "req_9c096dd4…",
  "ok": true,
  "payload": {
    "text": "…",
    "finish_reason": "stop",
    "duration_ms": 4084,
    "source_url": "https://www.google.com/search?udm=50&q=…"
  }
}
```

```json
{
  "type": "job_result",
  "request_id": "req_9c096dd4…",
  "ok": false,
  "error": {"code": "prompt_input_unavailable", "message": "…", "details": {}}
}
```

---

## 6. Authentication for the REST API

Optional. Enable it with `REQUIRE_API_KEY=true` and `API_KEYS=key-one,key-two`.

```bash
curl -X POST http://127.0.0.1:8000/v1/chat/completions \
  -H "X-API-Key: key-one" \
  -H "Content-Type: application/json" \
  -d '{"model":"google-ai-mode","messages":[{"role":"user","content":"hi"}]}'
```

`Authorization: Bearer key-one` works as well.  A missing or wrong key
returns `401` with `code: "authentication_failed"`.

---

## 7. Rate limits and limits

| Limit | Variable | Default |
|---|---|---|
| Requests per window | `RATE_LIMIT_REQUESTS` | 60 |
| Window length | `RATE_LIMIT_WINDOW_SECONDS` | 60 s |
| Maximum body | `MAX_REQUEST_BYTES` | 1 MiB |
| Maximum prompt | `MAX_PROMPT_CHARS` | 8000 |
| Maximum queued requests | `MAX_PENDING_REQUESTS` | 20 |
| Browser interaction timeout | `REQUEST_TIMEOUT_SECONDS` | 180 s |

Rate limited responses carry a `Retry-After` header.
