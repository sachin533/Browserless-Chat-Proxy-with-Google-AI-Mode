# Deployment

The local setup is the primary target.  This document covers exposing the
backend to the internet so that a browser *anywhere* (still with your own
Google session) can drive it.

---

## 1. The deployment model

```
   Your browser (with the extension)          The server
   ┌────────────────────────────┐             ┌──────────────────────┐
   │  Google AI Mode tab        │             │  FastAPI backend     │
   │  (your Google session)     │             │  /v1/chat/completions│
   │        ▲                  │             │        ▲             │
   │        │ DOM              │   WSS       │        │ HTTP(S)    │
   │  ┌─────┴──────┐           │◀────────────┼────────┘             │
   │  │ extension  │───────────┼─────────────┼──────────────────────┘
   │  └────────────┘           │  (initiated │
   └────────────────────────────┘   by the      │
                                    extension)   │
                                                   ▼
                                          Public HTTPS endpoint
```

**Critical:** a public backend URL does **not** give the server access to
your browser.  The extension opens its **own** WebSocket to that public URL.
If the extension cannot reach the backend, nothing works — and the backend
cannot drive a browser it has no connection to.

---

## 2. Security checklist before going public

| # | Item | How |
|---|---|---|
| 1 | TLS for HTTP and WebSocket | Use `https://` / `wss://` only |
| 2 | Disable insecure transport | `ALLOW_INSECURE_TRANSPORT=false` |
| 3 | Rotate the pairing token | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| 4 | Require REST API keys | `REQUIRE_API_KEY=true`, `API_KEYS=...` |
| 5 | Restrict CORS | `CORS_ORIGINS=https://your-frontend.example` |
| 6 | Set `ENVIRONMENT=production` | Cosmetic but useful in `/health` |
| 7 | Lower the rate limit | e.g. `RATE_LIMIT_REQUESTS=30` |
| 8 | Never expose the token | It lives only in `chrome.storage.local` |
| 9 | Do not enable browser debugging ports | Chrome's remote debugging port is a full account takeover vector — keep it closed |
| 10 | Never require the Google password in FastAPI | The backend has no login form for Google at all |

---

## 3. Option A — Cloudflare Tunnel (recommended)

No inbound firewall rule, no public IP, TLS is automatic.

### 3.1 Install cloudflared

```bash
# Windows
winget install --id Cloudflare.cloudflared
# macOS: brew install cloudflared
# Linux: see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### 3.2 Create a tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create gaim-api
```

### 3.3 Point the tunnel at the backend

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: gaim-api
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: gaim-api.example.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

> Cloudflare Tunnel proxies WebSockets automatically — no extra configuration
> is needed.

### 3.4 Route the hostname and start the backend

```bash
cloudflared tunnel route dns gaim-api gaim-api.example.com
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
cloudflared tunnel run gaim-api
```

### 3.5 Configure the extension

```
Backend URL   : https://gaim-api.example.com
Pairing token : <the token from backend/.env>
```

The extension converts `https://` to `wss://` automatically.

> The popup requests the backend origin as an **optional** host permission
> when you press **Save & Connect**, so no manifest edit is required.

---

## 4. Option B — ngrok

```bash
ngrok http 8000
# Forwarding https://xxxx-xxxx.ngrok-free.app -> http://127.0.0.1:8000
```

Use the printed HTTPS URL as the backend URL in the popup.  ngrok supports
WebSockets on the free tier.

---

## 5. Option C — Reverse proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name gaim-api.example.com;

    ssl_certificate     /etc/letsencrypt/live/gaim-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gaim-api.example.com/privkey.pem;

    # Chat completions can take a long time.
    proxy_read_timeout   300s;
    proxy_send_timeout   300s;

    location / {
        proxy_pass http://127.0.0.1:8000;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade - required for /ws/extension
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

If you terminate TLS in front of the backend, also set:

```ini
ROOT_PATH=
ALLOW_INSECURE_TRANSPORT=false
```

---

## 6. Running the backend as a service

### systemd (Linux)

`/etc/systemd/system/gaim-api.service`:

```ini
[Unit]
Description=Google AI Mode API
After=network.target

[Service]
Type=simple
User=gaim
WorkingDirectory=/opt/gaim/backend
EnvironmentFile=/opt/gaim/backend/.env
ExecStart=/opt/gaim/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gaim-api
sudo journalctl -u gaim-api -f
```

### Windows (NSSM)

```powershell
nssm install GoogleAiModeApi "C:\gaim\backend\.venv\Scripts\python.exe" `
    "-m" "uvicorn" "app.main:app" "--host" "127.0.0.1" "--port" "8000"
nssm set GoogleAiModeApi AppDirectory C:\gaim\backend
nssm set GoogleAiModeApi AppEnvironmentExtra "APP_ENV=production"
nssm start GoogleAiModeApi
```

---

## 7. Docker (optional)

`backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t gaim-api backend/
docker run -d --name gaim-api --env-file backend/.env -p 127.0.0.1:8000:8000 gaim-api
```

Bind to `127.0.0.1` and let the tunnel or the reverse proxy publish it.

---

## 8. Production environment file

```ini
APP_NAME=Google AI Mode API
VERSION=1.0.0
ENVIRONMENT=production
DEBUG=false
LOG_LEVEL=INFO

HOST=0.0.0.0
PORT=8000

EXTENSION_PAIRING_TOKEN=<32+ random characters>
AUTO_GENERATE_PAIRING_TOKEN=false

API_KEYS=<key-one>,<key-two>
REQUIRE_API_KEY=true
ALLOW_INSECURE_TRANSPORT=false

CORS_ORIGINS=https://your-frontend.example
CORS_ALLOW_CREDENTIALS=false

REQUEST_TIMEOUT_SECONDS=300
QUEUE_WAIT_TIMEOUT_SECONDS=120
MAX_CONCURRENT_REQUESTS=1
MAX_PENDING_REQUESTS=20
RATE_LIMIT_REQUESTS=30
RATE_LIMIT_WINDOW_SECONDS=60
```

---

## 9. Post-deployment verification

```bash
# 1. Health over TLS
curl https://gaim-api.example.com/health

# 2. The extension must be able to reach the WebSocket
#    (from the browser's network, not from the server)
wscat -c wss://gaim-api.example.com/ws/extension

# 3. Configure the extension and check the status
curl -H "X-API-Key: <key>" https://gaim-api.example.com/api/extension/status

# 4. A real request
curl -X POST https://gaim-api.example.com/v1/chat/completions \
  -H "X-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"google-ai-mode","messages":[{"role":"user","content":"Hello"}]}'
```

If step 4 fails with `extension_not_connected`, the extension cannot reach
the public URL — check the firewall, the tunnel and the popup's backend URL.

---

## 10. Operational notes

* **One extension, one browser.** The backend keeps a single extension
  connection; a second extension replaces the first.  Run one browser profile
  per deployment.
* **The Google session never leaves the browser.** The server only receives
  the answer text.
* **Scaling.** The backend is stateless apart from the extension registry, so
  you can run several instances behind a load balancer — but only one of them
  will hold the extension connection.  Use sticky routing or a single instance
  unless you implement a shared registry.
* **Monitoring.** Watch `/health` and the `extension_connected` field.  A
  `false` value means no browser is attached and every request will fail with
  `503`.
* **Logs.** Prompts and answers are never logged.  Only ids, sizes and
  timings are.
* **CAPTCHA.** If the server's IP is used for nothing but this API, the
  browser's IP is what talks to Google — so CAPTCHA challenges appear when
  *your* browser's IP is rate limited, not the server's.

---

## 11. Hardening the extension for distribution

If you distribute the extension (for example through the Chrome Web Store):

* Remove `optional_host_permissions` if the backend URL is fixed, and put the
  exact origin into `host_permissions`.
* Keep the pairing token out of the package: the user enters it in the popup.
* Consider `chrome.storage.session` for the token so it disappears when the
  browser closes.
* Review the `content_scripts` `matches` list — it should contain only the
  Google domains you actually drive.
* Publish with the same versioning discipline as the backend: the extension
  and the backend must agree on the WebSocket protocol.
