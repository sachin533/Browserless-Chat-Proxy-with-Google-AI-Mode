# Google AI Mode API

Turn the **Google AI Mode** web interface into a programmatically accessible
**REST API** — using a real Chrome extension that drives **your own** browser
session.

No official Gemini API. No paid AI API. No Playwright. No credential
harvesting. The answers you get back are produced by Google AI Mode in the
browser you are already logged into.

```
   HTTP client                FastAPI backend              Chrome extension
  ┌────────────┐            ┌─────────────────┐          ┌──────────────────┐
  │  POST      │            │  /v1/chat/      │  WebSocket│  background.js   │
  │  /v1/chat/  │──────────▶ │  completions    │◀────────▶│  service worker  │
  │  completions│            │                 │          └────────┬─────────┘
  └────────────┘            │  request mgr    │                   │ chrome.tabs
                             │  (one prompt    │                   ▼
                             │   at a time)    │          ┌──────────────────┐
                             └─────────────────┘          │  content.js      │
                                                            └────────┬─────────┘
                                                                     │ real DOM
                                                                     ▼
                                                          ┌──────────────────┐
                                                          │ Google AI Mode   │
                                                          │ (your tab, your  │
                                                          │  Google session) │
                                                          └──────────────────┘
```

---

## Table of contents

1. [What this is](#what-this-is)
2. [Architecture](#architecture)
3. [Technology stack](#technology-stack)
4. [Project structure](#project-structure)
5. [Installation](#installation)
6. [Running the backend](#running-the-backend)
7. [Installing the Chrome extension](#installing-the-chrome-extension)
8. [Logging in to Google](#logging-in-to-google)
9. [Connecting the extension to the backend](#connecting-the-extension-to-the-backend)
10. [Testing the API](#testing-the-api)
11. [API reference](#api-reference)
12. [Configuration](#configuration)
13. [Security model](#security-model)
14. [Running the tests](#running-the-tests)
15. [Deployment](#deployment)
16. [Limitations and honest notes](#limitations-and-honest-notes)

---

## What this is

A FastAPI service that exposes an OpenAI-compatible
`POST /v1/chat/completions` endpoint.  When a request arrives, the backend
sends a job over a WebSocket to a Chrome extension running **in your browser**.
The extension finds your Google AI Mode tab, types the prompt into the page's
own input, clicks the page's own send button, waits for Google to finish
answering, extracts the real answer text from the DOM and sends it back.

The Google session stays where it belongs: in your browser.  The backend never
sees your Google password, never talks to Google's private APIs and never
bypasses a CAPTCHA — if Google shows one, the request fails with a clear
error and you solve it manually.

---

## Architecture

The full request lifecycle (every step is error-handled):

| # | Component | Action |
|---|-----------|--------|
| 1 | Client | `POST /v1/chat/completions` with OpenAI-style `messages` |
| 2 | FastAPI | Validates the body, model id and prompt length |
| 3 | FastAPI | Creates a unique request id (`req_<hex>`) |
| 4 | FastAPI | Checks that the extension is connected and the browser is ready |
| 5 | FastAPI | Acquires the **tab lock** — only one prompt may run at a time |
| 6 | FastAPI | Sends `{"type":"job", ...}` over the WebSocket |
| 7 | Extension | Finds the Google AI Mode tab (`chrome.tabs.query`) |
| 8 | Extension | Optionally resets the conversation to a fresh AI Mode page |
| 9 | Content script | Detects the surface, the login state and a possible CAPTCHA |
| 10 | Content script | Types the prompt into the page's own textarea / Quill editor |
| 11 | Content script | Clicks the page's own send button |
| 12 | Content script | Waits until the answer stops changing and no stop button is visible |
| 13 | Content script | Extracts the real answer text and streams incremental updates |
| 14 | Extension | Forwards `job_result` / `job_delta` to the backend |
| 15 | FastAPI | Matches the response by request id and returns OpenAI-compatible JSON |

Detailed design notes: [`docs/architecture.md`](docs/architecture.md).

---

## Technology stack

**Backend** — Python 3.12+, FastAPI, Uvicorn, Pydantic v2, pydantic-settings,
WebSockets, asyncio, python-dotenv, pytest, httpx.

**Extension** — Chrome Manifest V3, background service worker, content
scripts, `chrome.runtime` messaging, `chrome.tabs`, `chrome.scripting`,
`chrome.storage`, `chrome.alarms`, native WebSocket API.

**Frontend** — React 19, Vite 8, Tailwind CSS 4, lucide-react. A chat
playground that drives the backend over HTTP and renders the real Google AI
Mode answers.

**Testing** — pytest + FastAPI `TestClient`/`httpx.ASGITransport` for the
backend, `node --test` for the extension, `oxlint` + `vite build` for the
frontend.

---

## Project structure

```
google-ai-mode-api/
├── backend/
│   ├── app/
│   │   ├── main.py                     # app factory, middleware, error handlers
│   │   ├── core/
│   │   │   ├── config.py               # pydantic-settings, all env vars
│   │   │   ├── security.py             # token / API key verification
│   │   │   ├── exceptions.py           # typed errors -> structured JSON
│   │   │   ├── rate_limit.py           # in-process token bucket
│   │   │   ├── bootstrap.py            # first-run pairing token generation
│   │   │   └── logging.py              # privacy aware logging
│   │   ├── routes/
│   │   │   ├── health.py               # GET /health
│   │   │   ├── extension.py            # status + diagnose + WebSocket
│   │   │   └── chat.py                 # POST /v1/chat/completions
│   │   ├── services/
│   │   │   ├── extension_manager.py    # the single active extension connection
│   │   │   ├── extension_protocol.py   # inbound message handling
│   │   │   ├── request_manager.py      # pending requests, timeouts, matching
│   │   │   ├── google_ai_service.py    # the orchestration described above
│   │   │   └── prompt_builder.py       # messages -> single browser prompt
│   │   └── schemas/                    # pydantic request/response models
│   ├── scripts/e2e_check.py            # live end-to-end check against a server
│   ├── tests/                          # 60 pytest tests
│   ├── requirements.txt
│   ├── .env.example
│   └── pytest.ini
├── extension/
│   ├── manifest.json                   # Manifest V3
│   ├── background.js                   # service worker: WebSocket + job routing
│   ├── content.js                      # page automation: type, submit, extract
│   ├── lib/
│   │   ├── ai-mode-dom.js              # all page knowledge (selectors)
│   │   ├── config.js                   # settings + token masking
│   │   └── protocol.js                 # URL / WebSocket helpers
│   ├── popup.html / popup.css / popup.js
│   ├── icons/                          # generated PNGs
│   ├── tools/generate_icons.py
│   ├── tests/                          # 48 node:test tests
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── vite.config.js                  # Vite + React + Tailwind v4
│   ├── package.json
│   ├── .env.example                    # VITE_API_BASE_URL, VITE_MODEL, …
│   └── src/
│       ├── main.jsx                    # entry point + error boundary
│       ├── App.jsx                     # layout, state, actions
│       ├── index.css                   # Tailwind theme + animations
│       ├── api/client.js               # the only place that knows the API
│       ├── hooks/
│       │   ├── useConnection.js        # polls /health + /api/extension/status
│       │   ├── useConversations.js     # history + rename + localStorage
│       │   ├── useChat.js              # send / stream / retry / cancel
│       │   └── useAppSettings.js       # runtime base URL, model, API key
│       └── components/
│           ├── Sidebar.jsx             # history, search, rename, collapsed rail
│           ├── ChatHeader.jsx          # title + compact status indicator
│           ├── StatusIndicator.jsx     # four live dots + detail popover
│           ├── MessageList.jsx         # 850px reading column
│           ├── MessageBubble.jsx       # user / assistant / error bubbles
│           ├── Markdown.jsx            # dependency free Markdown renderer
│           ├── Composer.jsx            # prompt input + send + stop
│           ├── InspectorDrawer.jsx     # slide-over request inspector
│           ├── ApiInfoPanel.jsx        # request details + cURL
│           ├── SettingsPanel.jsx       # base URL, model, key, diagnostics
│           ├── Logo.jsx                # inline SVG brand mark
│           ├── EmptyState.jsx          # welcome screen + example cards
│           ├── ToastHost.jsx           # transient notifications
│           └── ErrorBoundary.jsx       # keeps a render fault from blanking the page
├── docs/
│   ├── architecture.md
│   ├── installation.md
│   ├── api-documentation.md
│   ├── troubleshooting.md
│   └── deployment.md
├── .gitignore
└── README.md
```

---

## Installation

Prerequisites: **Python 3.12+**, **Node 18+** (for the extension and frontend
tooling), and **Chrome 116+**.

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # Windows
# source .venv/bin/activate             # macOS / Linux

pip install -r requirements.txt
copy .env.example .env                 # Windows
# cp .env.example .env                 # macOS / Linux
```

Set at least one secret in `backend/.env`:

```ini
EXTENSION_PAIRING_TOKEN=paste-a-long-random-string-here
```

If you leave `EXTENSION_PAIRING_TOKEN` empty and
`AUTO_GENERATE_PAIRING_TOKEN=true`, the backend generates a strong token on
first start, writes it back into `.env` and prints it to the log.

### 2. Extension

```powershell
cd extension
npm install          # optional: only needed to run the extension unit tests
```

### 3. Frontend

```powershell
cd frontend
npm install
copy .env.example .env.local          # Windows
# cp .env.example .env.local          # macOS / Linux
```

`frontend/.env.local`:

```ini
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MODEL=google-ai-mode
VITE_STATUS_POLL_MS=5000
VITE_ENABLE_STREAMING=true
```

These are only the **defaults**.  The API base URL, the model and the
streaming mode can be changed at runtime in the playground's **Settings**
panel — the values are stored in `localStorage`, so the backend can be
repointed without a rebuild.

> The backend must allow the frontend origin.  `http://localhost:5173` and
> `http://127.0.0.1:5173` are already in the default `CORS_ORIGINS` of
> `backend/.env.example`; if you changed that list, add the frontend origin
> there as well.

---

## Running the backend

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Then open <http://127.0.0.1:8000/docs> for the interactive Swagger UI.

---

## Running the frontend

```powershell
cd frontend
npm install
npm run dev
```

The playground is served at **<http://127.0.0.1:5173/>**.

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server with hot reload on port 5173 |
| `npm run build` | Production build into `frontend/dist` |
| `npm run preview` | Serve the production build on port 4173 |
| `npm run lint` | `oxlint` static analysis |

### Using the playground

1. Start the backend and the extension (see above).
2. Open <http://127.0.0.1:5173/>.
3. The header shows a compact status indicator — four dots for **Backend**,
   **Extension**, **AI Mode tab** and **Login**.  Click it for the details.
   Every value comes from `GET /health` and `GET /api/extension/status`; no
   status is ever hard coded.
4. Pick one of the four example cards or type your own prompt, then press
   **Enter** (or **Shift+Enter** for a new line).
5. The answer from Google AI Mode streams in and is rendered as Markdown.
6. **New chat** starts a fresh conversation, **Clear** empties the current
   one, **Copy** copies an answer, **Retry** re-runs a failed prompt, and the
   inspector (the panel icon in the header) shows the endpoint, duration,
   request id, source URL and a ready-to-run cURL command.

**Keyboard shortcuts** — `Ctrl/Cmd + K` focuses the prompt, `/` focuses it
from anywhere else.

**Sidebar** — search conversations, rename a conversation (pencil icon on
hover), delete it (bin icon on hover), and collapse the sidebar to a slim icon
rail with the chevron in the header.  On a phone the sidebar slides in from
the left.

The conversation history is stored in the browser's `localStorage`, so a
refresh keeps it.

> The frontend never contains a secret.  If the backend runs with
> `REQUIRE_API_KEY=true`, open **Settings** in the header and paste the key —
> it is kept in `sessionStorage` for the current browser session only.  The
> extension pairing token is never used by this page.

---

## Installing the Chrome extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked**.
4. Select the `extension/` folder of this project (the one containing
   `manifest.json`).
5. The extension **Google AI Mode API** appears in the toolbar. Pin it.

> After changing any file in `extension/`, press the reload arrow on the
> extension card in `chrome://extensions`.

Full guide with screenshots and troubleshooting:
[`docs/installation.md`](docs/installation.md).

---

## Logging in to Google

The extension uses **your** browser session, so you sign in exactly the way
you normally would:

1. Click **Open AI Mode** in the extension popup (or open
   <https://www.google.com/search?udm=50> yourself).
2. Click **Sign in** in the Google page and complete the Google sign-in.
3. Keep that tab open.

The extension **never** asks for, stores or forwards your Google password.
It only checks whether a *signed-in* indicator is visible in the page.

---

## Connecting the extension to the backend

1. Click the extension icon → the popup opens.
2. Under **Backend URL** enter e.g. `http://127.0.0.1:8000`.
3. Under **Pairing token** paste the token from `backend/.env`
   (or from the backend log).
4. Press **Save & Connect**.

The popup turns green when the extension is connected.  It also shows:

* **Backend** — the configured backend URL
* **Extension** — `connected` / `connecting` / `error`
* **AI Mode tab** — whether a usable AI Mode tab is open
* **Google login** — whether the tab is signed in

---

## Testing the API

### Through Swagger

Open <http://127.0.0.1:8000/docs>, expand **POST /v1/chat/completions**, press
**Try it out** and **Execute**.

### Through cURL

```bash
curl -X POST http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
        "model": "google-ai-mode",
        "messages": [{"role": "user", "content": "Explain Python in simple terms."}],
        "stream": false
      }'
```

### With the OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="not-needed")

completion = client.chat.completions.create(
    model="google-ai-mode",
    messages=[{"role": "user", "content": "Explain Python in simple terms."}],
)
print(completion.choices[0].message.content)
```

### Streaming

```bash
curl -N -X POST http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"google-ai-mode","stream":true,
       "messages":[{"role":"user","content":"Explain Python in simple terms."}]}'
```

---

## API reference

### `GET /health`

```json
{
  "status": "ok",
  "service": "Google AI Mode API",
  "version": "1.0.0",
  "environment": "development",
  "timestamp": 1793880089.84,
  "extension_connected": true,
  "pending_requests": 0
}
```

### `GET /api/extension/status`

```json
{
  "connected": true,
  "session_id": "9f2c...",
  "ai_mode_tab_open": true,
  "ai_mode_ready": true,
  "logged_in": true,
  "login_required": false,
  "captcha_detected": false,
  "page_url": "https://www.google.com/search?udm=50",
  "surface": "search_ai_mode",
  "pending_requests": 0,
  "last_seen_at": 1793880089.1,
  "connected_at": 1793880000.0,
  "pairing_token_configured": true,
  "message": "The extension is connected and Google AI Mode is ready."
}
```

### `POST /v1/chat/completions`

Request (OpenAI compatible):

```json
{
  "model": "google-ai-mode",
  "messages": [
    {"role": "system", "content": "Be brief."},
    {"role": "user", "content": "Explain Python in simple terms."}
  ],
  "stream": false
}
```

Response:

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
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 9, "completion_tokens": 76, "total_tokens": 85}
}
```

Provenance headers are added to the response:

| Header | Meaning |
|---|---|
| `X-Google-AI-Mode-Request-Id` | The internal request id (`req_...`) |
| `X-Google-AI-Mode-Source` | The URL of the page that produced the answer |
| `X-Google-AI-Mode-Duration-Ms` | How long the browser interaction took |
| `X-Request-Id` | Correlation id of the HTTP request |

### `POST /api/extension/diagnose`

Asks the extension to dump what it sees on the live page (surface, login
state, which selectors matched).  This is the tool to use when Google changes
the layout — see [`docs/troubleshooting.md`](docs/troubleshooting.md).

### `WebSocket /ws/extension`

The extension control channel.  See
[`docs/api-documentation.md`](docs/api-documentation.md) for the full
protocol.

### Errors

Every error is a structured, OpenAI compatible envelope:

```json
{
  "error": {
    "message": "The Chrome extension is not connected to the backend. ...",
    "type": "service_unavailable",
    "code": "extension_not_connected",
    "param": null
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_request` | 400 / 422 | The body is invalid |
| `authentication_failed` | 401 | Missing or wrong API key |
| `login_required` | 401 | Not signed in to Google |
| `captcha_detected` | 403 | Google shows a CAPTCHA — solve it manually |
| `payload_too_large` | 413 | Body exceeds `MAX_REQUEST_BYTES` |
| `extension_not_connected` | 503 | The extension is not connected |
| `ai_mode_tab_not_found` | 503 | No usable AI Mode tab |
| `prompt_input_unavailable` | 502 | The prompt field could not be found |
| `prompt_submission_failed` | 502 | The prompt could not be submitted |
| `response_extraction_failed` | 502 | The answer could not be extracted |
| `empty_response` | 502 | Google returned nothing |
| `response_timeout` | 504 | No answer in time |
| `service_busy` | 429 | The browser session is busy and the queue is full |
| `rate_limit_exceeded` | 429 | Too many requests |

---

## Configuration

All settings live in `backend/.env` (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `Google AI Mode API` | Service name in `/health` and the OpenAPI title |
| `VERSION` | `1.0.0` | Reported version |
| `HOST` / `PORT` | `127.0.0.1` / `8000` | Bind address |
| `ROOT_PATH` | – | Sub path when behind a reverse proxy |
| `EXTENSION_PAIRING_TOKEN` | *(generated)* | Shared secret between extension and backend |
| `AUTO_GENERATE_PAIRING_TOKEN` | `true` | Generate a token when none is configured |
| `API_KEYS` | – | Comma separated REST API keys |
| `REQUIRE_API_KEY` | `false` | Require an API key on `/v1/*` |
| `ALLOW_INSECURE_TRANSPORT` | `true` | Allow plain `ws://` to non-loopback hosts |
| `CORS_ORIGINS` | localhost dev origins | Allowed browser origins |
| `CORS_ALLOW_CREDENTIALS` | `false` | Cookie support for CORS |
| `REQUEST_TIMEOUT_SECONDS` | `180` | Hard limit for one browser interaction |
| `QUEUE_WAIT_TIMEOUT_SECONDS` | `60` | How long a request waits for the tab |
| `MAX_CONCURRENT_REQUESTS` | `1` | **Keep at 1** — the tab is a single resource |
| `MAX_PENDING_REQUESTS` | `20` | Maximum queued requests |
| `MAX_PROMPT_CHARS` | `8000` | Maximum prompt length |
| `MAX_REQUEST_BYTES` | `1048576` | Maximum HTTP body size |
| `RATE_LIMIT_REQUESTS` | `60` | Requests per window (REST API) |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate limit window |
| `SUPPORTED_MODELS` | `google-ai-mode,ai-mode,…` | Accepted `model` values |
| `RESET_CONVERSATION_PER_REQUEST` | `true` | Start a fresh AI Mode conversation per request |

Extension side (stored in `chrome.storage.local`, entered via the popup):

| Setting | Default | Purpose |
|---|---|---|
| Backend URL | `http://127.0.0.1:8000` | Where to open the WebSocket |
| Pairing token | – | Shared secret |
| Auto connect | `true` | Reconnect automatically after a drop |
| Surface | `auto` | `auto`, `search_ai_mode` or `gemini` |

---

## Security model

* **Shared pairing token** — the extension proves its identity with a
  256-bit token.  It is stored in `chrome.storage.local` and never appears in
  any web page context, never in the URL of a REST call and never in a log.
* **No secret in the frontend** — the playground only ever shows a masked
  preview of an API key (`abc••••xyz`) and never stores the extension pairing
  token.  An API key entered in the playground lives in `sessionStorage` for
  the current browser session only.
* **Constant time comparison** for every token check.
* **Optional REST API keys** (`X-API-Key` header or `Bearer` token) — the
  backend fails closed if `REQUIRE_API_KEY=true` but no key is configured.
* **CORS** is restricted to the configured origins.
* **Rate limiting** and a **request size limit** protect the public surface.
* **Privacy** — prompts and answers are never logged; only ids, sizes and
  timings are.  The extension reports booleans, never page content.
* **TLS** — for remote deployments use `https://` / `wss://` and set
  `ALLOW_INSECURE_TRANSPORT=false`.

---

## Running the tests

```powershell
# Backend - 60 tests
cd backend
.\.venv\Scripts\python.exe -m pytest

# Extension - 48 tests
cd extension
npm install
npm test

# Frontend - lint + production build
cd frontend
npm install
npm run lint
npm run build
```

The backend suite uses a **mock extension** so the orchestration can be
verified without a browser.  The real extension is verified separately — see
[`docs/installation.md`](docs/installation.md#manual-verification-checklist)
for the manual checklist.

A live end-to-end check against a running server is available:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\e2e_check.py --backend http://127.0.0.1:8000 --token "<token>"
```

---

## Deployment

Local use is the primary target.  For remote deployment the backend needs a
public HTTPS endpoint — Cloudflare Tunnel, ngrok or a reverse proxy all work.
The important part: **the extension initiates its own WebSocket connection to
that public URL**; a public backend URL does *not* give the server any access
to your browser.

See [`docs/deployment.md`](docs/deployment.md) for the complete checklist.

---

## Limitations and honest notes

* **One prompt at a time.** A single browser tab is a single resource.  The
  backend serialises every request; a second request waits in the queue.
* **Real token streaming is not available.** The model does not expose a token
  stream to the page, so `stream: true` delivers the *rendered* text as it
  appears in the DOM.  The granularity is the browser's render granularity,
  not the model's token granularity.  This is real incremental data — it is
  simply not token-exact.
* **Token usage is an estimate.** `usage` is computed from character counts
  (`~4` characters per token) because the browser pipeline cannot report real
  model token counts.
* **The answer is the rendered answer.** Source attributions and "related
  questions" that Google renders as part of the response are included.
* **Google can change the layout.** The selectors live in one file
  (`extension/lib/ai-mode-dom.js`) and `POST /api/extension/diagnose` tells you
  exactly what the page looks like right now.
* **CAPTCHAs are never bypassed.** If Google challenges you, the request fails
  with `captcha_detected` and you solve it manually.
* **Verified against** Google AI Mode (`?udm=50`) and Gemini
  (`gemini.google.com`).  Both surfaces are supported by the same code path.
* **One browser session at a time.** The backend keeps a single extension
  connection — a second extension (for example a test double) replaces the
  first one.  See `backend/scripts/fake_extension.py` for a labelled test
  double that speaks the extension protocol without a browser.
* **The playground is a client of the same public API.** It uses no privileged
  endpoint and no mock: every answer it renders came from the backend, which
  got it from the browser tab that the extension controls.

---

## License

Provided as-is for educational and internal use.  You are responsible for
complying with Google's Terms of Service when automating a logged-in browser
session.
