# Architecture

This document explains how the pieces fit together and *why* they are split
the way they are.

---

## 1. The core constraint

Everything in this project follows from one fact:

> The only thing that can produce a Google AI Mode answer is a **rendered
> Google AI Mode page in a browser that is signed in to Google.**

So the system has three parts, each owning exactly one responsibility:

| Part | Responsibility | Never does |
|---|---|---|
| **FastAPI backend** | Accept requests, validate them, serialise them, match responses | Touch a browser, render HTML, talk to Google |
| **Extension background worker** | Own the WebSocket, find the tab, route jobs | Know anything about the DOM |
| **Extension content script** | Drive the page, extract the text | Talk to the network |

The backend has **no** browser automation code, and the extension has **no**
knowledge of HTTP request formats.  The only shared contract is the WebSocket
protocol.

---

## 2. Component map

```
backend/app/
├── main.py                    app factory, middleware, exception handlers
├── core/
│   ├── config.py              Settings (pydantic-settings, env driven)
│   ├── security.py            constant time token / API key verification
│   ├── exceptions.py          AppError hierarchy -> JSON error envelope
│   ├── rate_limit.py          in-process token bucket
│   ├── bootstrap.py           first-run pairing token generation
│   └── logging.py             privacy aware logging
├── routes/
│   ├── health.py              GET  /health
│   ├── extension.py           GET  /api/extension/status
│   │                          POST /api/extension/diagnose
│   │                          WS   /ws/extension
│   └── chat.py                POST /v1/chat/completions
├── services/
│   ├── extension_manager.py   the single active extension connection
│   ├── extension_protocol.py  inbound message routing
│   ├── request_manager.py     pending request registry + matching
│   ├── google_ai_service.py   the orchestration
│   └── prompt_builder.py      messages -> one browser prompt
└── schemas/                   pydantic models

extension/
├── manifest.json              MV3
├── background.js              service worker
├── content.js                 page automation
├── lib/
│   ├── ai-mode-dom.js         ALL page knowledge lives here
│   ├── config.js              settings + token masking
│   └── protocol.js            URL / WebSocket helpers
└── popup.*                    status UI
```

---

## 3. The request lifecycle

```
Client                FastAPI                     Extension              Page
  │                      │                           │                    │
  │ POST /v1/chat/…      │                           │                    │
  ├─────────────────────▶│                           │                    │
  │                      │ validate body/model      │                    │
  │                      │ build prompt             │                    │
  │                      │ create req_ id           │                    │
  │                      │ check extension + tab    │                    │
  │                      │ acquire tab lock ────┐   │                    │
  │                      │ register pending    │   │                    │
  │                      │ send job ───────────┼──▶│ find AI Mode tab   │
  │                      │                     │   │ (chrome.tabs.query)│
  │                      │                     │   ├───────────────────▶│
  │                      │                     │   │  reset conversation│
  │                      │                     │   │  type prompt       │
  │                      │                     │   │  click send        │
  │                      │                     │   │  wait for answer   │
  │                      │◀── job_delta ──────────┤◀────────────────────┤
  │◀── SSE chunk ────────┤ (stream=true only)    │                    │
  │                      │                     │   │  extract answer    │
  │                      │◀── job_result ────────┤◀────────────────────┤
  │                      │ match by request id    │                    │
  │                      │ release tab lock ──┘   │                    │
  │◀── 200 JSON ─────────┤                       │                    │
```

### 3.1 Request identification

Every request gets a unique id `req_<32 hex chars>`
(`RequestManager.new_request_id`).  The id travels:

```
FastAPI  --job{request_id}-->  Extension  --job_result{request_id}-->  FastAPI
```

The response is matched **by id**, never by arrival order.  A result for an
unknown id is logged and dropped, a duplicate result is ignored.

### 3.2 The tab lock

`GoogleAIService` holds a single `asyncio.Semaphore(1)`.  A request must own
the lock before a job is dispatched and releases it when the answer arrives,
fails or times out.  This guarantees that two requests never type into the
same input box at the same time.

`MAX_CONCURRENT_REQUESTS` exists for future use (for example multiple AI Mode
tabs), but the default of `1` is correct for a single browser session.

### 3.3 Timeouts

Two independent timeouts:

| Timeout | Default | Scope |
|---|---|---|
| `REQUEST_TIMEOUT_SECONDS` | 180 s | The whole browser interaction |
| `QUEUE_WAIT_TIMEOUT_SECONDS` | 60 s | Waiting for the tab lock |

The extension also receives `timeout_ms` and enforces its own deadline, so a
stuck page cannot hold the pipeline forever.  When the backend times out it
also fails the pending request, so the extension's late answer is discarded
instead of leaking into a later request.

### 3.4 Cancellation and disconnects

* If the HTTP client disconnects, the pending request is cancelled and the
  extension's late answer is ignored.
* If the extension disconnects, **all** pending requests fail immediately
  with `extension_disconnected` — the client gets an error in milliseconds
  instead of waiting for the timeout.

---

## 4. The WebSocket protocol

Transport: JSON text frames over `ws://` or `wss://`.

### 4.1 Extension → backend

| Type | Payload | Meaning |
|---|---|---|
| `auth` | `token`, `client` | Handshake (only if no token was in the URL/header) |
| `status` | `payload` | Periodic browser state snapshot |
| `job_delta` | `request_id`, `payload.text` | Incremental answer update |
| `job_result` | `request_id`, `ok`, `payload` / `error` | Terminal result |
| `ping` | – | Keep alive |

```jsonc
// status
{
  "type": "status",
  "payload": {
    "ai_mode_tab_open": true,
    "ai_mode_ready": true,
    "logged_in": true,
    "captcha_detected": false,
    "page_url": "https://www.google.com/search?udm=50",
    "surface": "search_ai_mode",
    "prompt_input_available": true,
    "answer_container_available": true
  }
}

// job_result (success)
{
  "type": "job_result",
  "request_id": "req_9c096dd4…",
  "ok": true,
  "payload": {
    "text": "A WebSocket is a communication protocol…",
    "finish_reason": "stop",
    "duration_ms": 4084,
    "source_url": "https://www.google.com/search?udm=50&q=websocket"
  }
}

// job_result (failure)
{
  "type": "job_result",
  "request_id": "req_9c096dd4…",
  "ok": false,
  "error": { "code": "prompt_input_unavailable", "message": "…", "details": {} }
}
```

### 4.2 Backend → extension

| Type | Payload | Meaning |
|---|---|---|
| `auth_ok` | `session_id`, `heartbeat_seconds` | Handshake accepted |
| `auth_error` | `error` | Handshake rejected |
| `job` | `request_id`, `action`, `payload` | Browser interaction |
| `ping` | – | Keep alive |

```jsonc
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

`action` is either `run_prompt` or `diagnose`.

### 4.3 Authentication

The token may be provided in three ways, checked in this order:

1. `X-Extension-Token` header
2. `?token=` query parameter
3. The first `auth` message

All comparisons use `hmac.compare_digest`.  A rejected connection receives an
`auth_error` frame and is closed with code `1008`.

---

## 5. Extension internals

### 5.1 Service worker lifecycle

Manifest V3 service workers are terminated after ~30 s of inactivity, so:

* The WebSocket URL, token and status are kept in `chrome.storage.local` /
  `chrome.storage.session`.
* A `chrome.alarms` alarm with a 30 s period wakes the worker; if the socket
  is not open it reconnects and pushes a status update.
* Reconnection uses exponential backoff: 1 s → 2 s → 5 s → 10 s → 30 s → 60 s.
* Chrome 116+ keeps the worker alive while the WebSocket is active; the alarm
  is the safety net for older behaviour and for crashed sockets.

### 5.2 Finding the tab

`chrome.tabs.query({})` is filtered by URL:

* `search_ai_mode` — hostname `google.com` **and** query parameter `udm=50`
* `gemini` — hostname `gemini.google.com`

The tab in the most recently focused window is preferred.

### 5.3 Conversation reset

If `reset_conversation` is enabled and the tab already shows a submitted
conversation (`?q=` present), the worker navigates the tab back to
`https://www.google.com/search?udm=50` and waits for the load to complete.
This guarantees that every API request starts from a clean AI Mode state and
that answers never inherit earlier context.

### 5.4 Content script injection

Content scripts are declared for `https://*.google.com/*`, but a tab that was
already open when the extension was installed or reloaded has no content
script.  In that case the worker injects the files with
`chrome.scripting.executeScript` and retries the message — a tab that was
open before the extension loaded therefore still works.

### 5.5 Page knowledge (`lib/ai-mode-dom.js`)

All selectors live in one table so a layout change only requires editing one
file:

```js
const SURFACES = {
  search_ai_mode: {
    promptInput:    ['textarea[aria-label="Ask anything"]', …],
    sendButton:     ['button[aria-label="Send"]', …],
    stopButton:     ['button[aria-label="Stop"]', …],
    answerContainer:['[jsname="CS7uPe"]', 'div.CKgc1d'],
    answerProse:    ['[jsname="CS7uPe"] [jsname="KFl8ub"] > div', …]
  },
  gemini: { … }
};
```

Each list is ordered from most to least specific.  Lookups prefer **visible**
elements; hidden elements are only used as a fallback (except for the stop
button, where a hidden button must be ignored — Google keeps it in the DOM
after the answer is finished).

### 5.6 Answer extraction

| Surface | Answer prose | Label to strip |
|---|---|---|
| AI Mode | `[jsname="CS7uPe"] [jsname="KFl8ub"]` | `h3` “AI Mode reply for …” |
| Gemini | `model-response message-content` | `Gemini said` (visually hidden) |

The label is removed and the echoed question is stripped, so the API returns
the answer only.

### 5.7 Completion detection

The answer is considered finished when **all** of these hold:

1. the extracted text is non-empty,
2. it is different from the text that was there before the prompt,
3. no visible *Stop* button is present,
4. the text has not changed for 1.2 s.

The text is polled every 200 ms; each change is emitted as a `job_delta`, so
`stream: true` really does deliver incremental content.

---

## 6. Security

| Threat | Mitigation |
|---|---|
| Someone calls the REST API | Optional API keys, rate limiting, CORS allow list |
| Someone impersonates the extension | 256-bit pairing token, constant time comparison |
| Token leakage in logs | Tokens are never logged; the popup shows a masked preview |
| Token leakage via the URL | The token may be sent in a header or the first message instead |
| Prompt/answer leakage | Only ids, sizes and timings are logged |
| Oversized requests | `MAX_REQUEST_BYTES` middleware check |
| Browser control abuse | The backend can only ever ask for a prompt in AI Mode |
| Credential harvesting | The extension has no access to cookies, passwords or private APIs |

The extension's permissions are deliberately minimal:

```json
"permissions": ["storage", "scripting", "alarms"],
"host_permissions": ["https://*.google.com/*"],
"optional_host_permissions": ["http://*/*", "https://*/*"]
```

The backend origin is requested at runtime (only for the URL the user
configures) instead of being granted up front.

---

## 7. Error taxonomy

Every failure carries a stable `code`:

```
invalid_request              400 / 422   bad body or model
authentication_failed        401         missing/invalid API key
login_required               401         not signed in to Google
captcha_detected             403         Google challenges the session
payload_too_large            413         body too big
rate_limit_exceeded          429         too many requests
service_busy                 429         queue full
extension_not_connected      503         no extension
ai_mode_tab_not_found        503         no usable tab
prompt_input_unavailable     502         prompt field not found
prompt_submission_failed     502         could not submit
response_extraction_failed   502         could not read the answer
empty_response               502         Google answered nothing
response_timeout             504         no answer in time
extension_disconnected       502         the extension dropped mid-request
page_navigated               502         the tab navigated away
internal_error               500         unexpected failure
```

Extension side codes are mapped onto typed backend exceptions in
`GoogleAIService._build_error`, so the HTTP layer always produces a
consistent envelope.

---

## 8. Extension points

| I want to… | Change |
|---|---|
| Support another AI surface | Add an entry to `SURFACES` in `lib/ai-mode-dom.js` |
| Fix a layout change | Update the selector lists, then run `POST /api/extension/diagnose` |
| Change the timeout | `REQUEST_TIMEOUT_SECONDS` |
| Allow parallel prompts on several tabs | Raise `MAX_CONCURRENT_REQUESTS` and give each request its own tab |
| Add a new REST endpoint | Add a router in `app/routes/` and include it in `main.py` |
| Change the prompt layout | `services/prompt_builder.py` |
