# Installation

A step by step guide for Windows, macOS and Linux.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.12 or newer | `python --version` |
| Chrome | 116 or newer | Needed so the service worker survives an active WebSocket |
| Node.js | 18+ | *Optional* — only to run the extension unit tests |

Verify:

```bash
python --version
node --version        # optional
```

---

## 2. Backend

### 2.1 Create the virtual environment

```powershell
# Windows (PowerShell)
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
cd backend
python3 -m venv .venv
source .venv/bin/activate
```

> If PowerShell blocks the activation script, run
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` once.

### 2.2 Install the dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 2.3 Configure the environment

```powershell
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

Open `backend/.env` and set at least:

```ini
EXTENSION_PAIRING_TOKEN=choose-a-long-random-string
```

Generate a good token:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Leave `EXTENSION_PAIRING_TOKEN` empty and the backend will generate one on
the first start, write it back into `.env` and print it to the log.

> **CORS** — the frontend dev server runs on `http://127.0.0.1:5173`.  That
> origin is part of the default `CORS_ORIGINS`; if you changed that list, add
> the frontend origin or the browser will block the requests:

> ```ini
> CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
> ```

### 2.4 Start the backend

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Expected output:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
Google AI Mode API 1.0.0 is ready on 127.0.0.1:8000
```

Check it:

```bash
curl http://127.0.0.1:8000/health
```

```json
{"status":"ok","service":"Google AI Mode API","version":"1.0.0", ...}
```

Swagger UI: <http://127.0.0.1:8000/docs>

---

## 3. Chrome extension

### 3.1 Open the extension page

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle in the top right).

### 3.2 Load the extension

1. Click **Load unpacked**.
2. Select the `extension/` folder — the one that contains `manifest.json`
   (not the `backend/` folder).
3. Chrome shows the **Google AI Mode API** card.  Pin it to the toolbar
   (right click the puzzle icon → *Pin*).

> You do **not** need to rebuild anything.  The extension is plain
> JavaScript; the browser loads it directly from disk.

### 3.3 After changing a file

Press the circular **reload** arrow on the extension card in
`chrome://extensions`.  The service worker restarts and reconnects
automatically.

---

## 4. Sign in to Google

The extension drives **your** browser session, so you sign in the normal way:

1. Open <https://www.google.com/search?udm=50> (this is Google AI Mode).
   *If Google AI Mode is not your default mode, click **AI Mode** in the
   "All / Images / Videos / News" row.*
2. Click **Sign in** in the top right and complete the Google sign-in.
3. Keep that tab open.

Alternatively use the extension popup → **Open AI Mode**.

The extension never sees your password — it only looks for a visible
account avatar to decide whether you are signed in.

---

## 5. Connect the extension to the backend

1. Click the extension icon.
2. Fill in the form:

   | Field | Value |
   |---|---|
   | Backend URL | `http://127.0.0.1:8000` |
   | Pairing token | the value of `EXTENSION_PAIRING_TOKEN` from `backend/.env` |
   | Connect automatically | checked |

3. Press **Save & Connect**.

The badge on the extension icon turns green and the popup shows:

```
Backend       http://127.0.0.1:8000     ✔
Extension     connected                  ✔
AI Mode tab   ready                      ✔
Google login  signed in                  ✔
```

The backend reflects this too:

```bash
curl http://127.0.0.1:8000/api/extension/status
```

```json
{
  "connected": true,
  "ai_mode_tab_open": true,
  "ai_mode_ready": true,
  "logged_in": true,
  "login_required": false,
  "message": "The extension is connected and Google AI Mode is ready."
}
```

---

## 6. Send your first request

```bash
curl -X POST http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
        "model": "google-ai-mode",
        "messages": [{"role": "user", "content": "Explain Python in simple terms."}],
        "stream": false
      }'
```

Response (abbreviated):

```json
{
  "id": "chatcmpl-1c2f...",
  "object": "chat.completion",
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
  "usage": {"prompt_tokens": 8, "completion_tokens": 42, "total_tokens": 50}
}
```

---

## 7. Manual verification checklist

The automated tests use a mocked extension.  Verify the **real** extension
with this checklist:

| # | Step | Expected result |
|---|---|---|
| 1 | Backend running, extension loaded | Extension card shows no errors |
| 2 | Extension popup → **Save & Connect** | Badge turns green, popup shows *connected* |
| 3 | `GET /api/extension/status` | `"connected": true` |
| 4 | No AI Mode tab open | Popup shows *AI Mode tab: not open* |
| 5 | Open AI Mode, stay signed out | Popup shows *Google login: sign-in needed* |
| 6 | Sign in to Google | Popup shows *Google login: signed in* |
| 7 | `POST /v1/chat/completions` | Real answer from Google AI Mode |
| 8 | Same request with `"stream": true` | SSE chunks arrive incrementally |
| 9 | Close the AI Mode tab, send a request | `503` with `ai_mode_tab_not_found` |
| 10 | Stop the backend, wait 30 s | Extension reconnects automatically when the backend returns |
| 11 | `POST /api/extension/diagnose` | JSON describing the live page |

---

## 8. Optional: run the test suites

```bash
# Backend (60 tests)
cd backend
.\.venv\Scripts\python.exe -m pytest

# Extension (48 tests)
cd extension
npm install
npm test

# Frontend (lint + production build)
cd frontend
npm install
npm run lint
npm run build
```

---

## 8b. The chat playground (frontend)

The playground is a separate Vite application that talks to the same public
API as any other client.

```bash
cd frontend
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
npm run dev
```

Open **<http://127.0.0.1:5173/>**.

`frontend/.env.local`:

```ini
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MODEL=google-ai-mode
VITE_STATUS_POLL_MS=5000
VITE_ENABLE_STREAMING=true
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Backend base URL |
| `VITE_MODEL` | `google-ai-mode` | Model name sent with each request |
| `VITE_STATUS_POLL_MS` | `5000` | Poll interval for the status indicators |
| `VITE_ENABLE_STREAMING` | `true` | `false` disables Server-Sent Events |

> The frontend never contains a secret.  When the backend runs with
> `REQUIRE_API_KEY=true`, open **Settings** (gear icon in the header) and
> paste the key — it is kept in `sessionStorage` for the current browser
> session and is sent as the `X-API-Key` header.

### Playground checklist

| # | Step | Expected result |
|---|---|---|
| 1 | Start the backend and the frontend | The page loads, no console errors |
| 2 | Click the four status dots in the header | A panel with Backend / Extension / AI Mode tab / Login details |
| 3 | Extension not connected | The extension dot is grey or red, a hint above the composer explains what to do |
| 4 | AI Mode tab open, signed out | The login dot is red |
| 5 | Everything ready | All four dots are green |
| 6 | Click an example card | The prompt is sent and the answer appears |
| 7 | Type a prompt and press Enter | The answer streams in and renders as Markdown |
| 8 | Send an empty prompt | The send button stays disabled |
| 9 | Open the inspector (panel icon) | Endpoint, method, model, duration, request id, source URL and a cURL command |
| 10 | Collapse the sidebar | A slim icon rail appears; the expand button restores it |
| 11 | Rename / delete a conversation | The title changes, the conversation disappears |
| 12 | Stop the backend | The backend dot turns red, requests fail with a clear message |
| 13 | Click **Retry** on a failed message | The failed exchange is replaced by a new attempt |

---

## 9. Optional: live end-to-end check

With the backend running, a script verifies the complete chain over a real
WebSocket:

```bash
cd backend
.\.venv\Scripts\python.exe scripts\e2e_check.py \
    --backend http://127.0.0.1:8000 \
    --token "<your pairing token>"
```

Expected output:

```
[1] handshake           -> auth_ok
[2] extension status    -> connected=True tab=True logged_in=True
[3] job dispatched      -> id=req_9c096dd4… prompt='In two sentences, what is a WebSocket?'
[4] chat completion     -> HTTP 200
[5] second request      -> 'A close frame terminates the connection.'

E2E OK - the full chain works.
```

---

## 10. Troubleshooting quick reference

| Symptom | Fix |
|---|---|
| `extension_not_connected` | Open the popup and press **Reconnect** |
| `ai_mode_tab_not_found` | Open <https://www.google.com/search?udm=50> and keep it open |
| `login_required` | Sign in to Google in the AI Mode tab |
| `captcha_detected` | Solve the CAPTCHA manually in the tab, then retry |
| `prompt_input_unavailable` | Run `POST /api/extension/diagnose` — Google probably changed the layout |
| `response_timeout` | Raise `REQUEST_TIMEOUT_SECONDS`, or use a simpler prompt |
| Extension badge shows `!` | The backend is unreachable or the token is wrong |
| Swagger shows "Disconnected" | The WebSocket is only used by the extension, not by Swagger |

Full details: [`troubleshooting.md`](troubleshooting.md).
