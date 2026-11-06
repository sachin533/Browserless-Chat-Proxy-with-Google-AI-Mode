# Troubleshooting

Find the symptom, then follow the matching section.

---

## Quick diagnosis

```bash
# 1. Is the backend alive?
curl http://127.0.0.1:8000/health

# 2. Is the extension connected and is the browser ready?
curl http://127.0.0.1:8000/api/extension/status

# 3. What does the extension see on the live page?
curl -X POST http://127.0.0.1:8000/api/extension/diagnose

# 4. The backend log
#    (the terminal where uvicorn runs)
```

---

## 1. The extension does not connect

**Symptom** — the popup shows *Extension: error*, the badge shows `!`, or
`/api/extension/status` reports `"connected": false`.

| Cause | Fix |
|---|---|
| The backend is not running | Start it: `uvicorn app.main:app --host 127.0.0.1 --port 8000` |
| Wrong backend URL | The popup must contain `http://127.0.0.1:8000` (no trailing path) |
| Wrong pairing token | Copy `EXTENSION_PAIRING_TOKEN` from `backend/.env`; the popup shows a masked preview, clear the field and paste the new token |
| The service worker is asleep | Press **Reconnect** in the popup |
| A stale service worker | `chrome://extensions` → reload the extension |

The backend log shows the reason:

```
Rejected an extension with an invalid pairing token
Extension connected (session=…, client=google-ai-mode-extension)
```

> **A public backend URL does not give the server access to your browser.**
> The extension must be able to reach the backend *from your machine*.  For a
> remote deployment test it from the browser first.

---

## 2. `extension_not_connected` (503)

The backend has no extension.  Open the popup and press **Reconnect**, then
check `/api/extension/status`.

---

## 3. `ai_mode_tab_not_found` (503)

No usable Google AI Mode tab is open.

1. Open <https://www.google.com/search?udm=50>.
   If the page opens in normal search mode, click **AI Mode** in the
   "All / Images / Videos / News" row.
2. Keep the tab open.
3. The popup must show *AI Mode tab: ready*.

The extension only recognises:

* `google.com` **with** the `udm=50` query parameter, and
* `gemini.google.com`.

A plain `google.com/search?q=…` tab is normal search, not AI Mode.

---

## 4. `login_required` (401)

The tab is not signed in to Google.

1. Click **Sign in** in the Google page and complete the sign-in.
2. Wait for the account avatar to appear.
3. The popup must show *Google login: signed in*.

Detection looks for a visible account avatar, a visible "Sign in" control or
a visible password form.  If Google renders a different chrome than
expected, run `POST /api/extension/diagnose` and look at `loggedIn`.

---

## 5. `captcha_detected` (403)

Google is challenging the session (usually "unusual traffic" from a shared
or datacenter IP).

**The extension never bypasses a CAPTCHA.**  Solve it manually in the tab,
then retry.  If the challenge keeps coming back, your IP is rate limited by
Google — use a residential connection.

---

## 6. `prompt_input_unavailable` (502)

The extension could not find the prompt field.  Google most likely changed
the layout.

**Diagnose:**

```bash
curl -X POST http://127.0.0.1:8000/api/extension/diagnose
```

Look at `promptInputFound` and `candidates.promptInput`.  Then:

1. Open `extension/lib/ai-mode-dom.js`.
2. Add the new selector to the top of the relevant list, e.g.

   ```js
   promptInput: [
     'textarea[aria-label="Ask AI anything"]',   // ← new
     'textarea[aria-label="Ask anything"]',
     …
   ]
   ```

3. Reload the extension in `chrome://extensions`.
4. Run the diagnose command again.

The same procedure applies to `sendButton`, `stopButton`, `answerContainer`
and `answerProse`.

---

## 7. `response_extraction_failed` (502) or `empty_response` (502)

The answer was produced but could not be read.

* Run `POST /api/extension/diagnose` and check `answerContainerFound`.
* Google sometimes renders the answer in a different container for the first
  answer of a conversation than for follow-up questions — try the request
  again, the second attempt often uses the standard layout.

---

## 8. `response_timeout` (504)

No answer arrived in time.

| Cause | Fix |
|---|---|
| The prompt is very long or complex | Raise `REQUEST_TIMEOUT_SECONDS` (e.g. 300) |
| AI Mode is showing a "thinking" state that never finishes | Retry, or use a simpler prompt |
| The tab was closed mid-request | Keep the tab open and watch the badge |

The extension's own deadline is `timeout_ms`, which the backend derives from
`REQUEST_TIMEOUT_SECONDS`, so the two never disagree.

---

## 9. `service_busy` (429) / requests queue up

The browser tab can only handle one prompt at a time, so requests are
serialised.  A second request waits for the tab.

* Increase `MAX_PENDING_REQUESTS` to allow a longer queue.
* Increase `QUEUE_WAIT_TIMEOUT_SECONDS` to let requests wait longer.
* Keep `MAX_CONCURRENT_REQUESTS=1` — raising it would let two prompts fight
  over the same input box.

---

## 10. `invalid_request` (400 / 422)

| Message | Fix |
|---|---|
| `Unsupported model '…'` | Use one of the `SUPPORTED_MODELS` values |
| `The prompt is too long` | Shorten the prompt or raise `MAX_PROMPT_CHARS` |
| `at least one message must contain non-empty text` | Add a user message with content |
| `messages` field required | Send a `messages` array |

---

## 11. `authentication_failed` (401) on the REST API

`REQUIRE_API_KEY=true` is enabled but the key is missing or wrong.

```bash
curl … -H "X-API-Key: your-key"
```

Check `API_KEYS` in `backend/.env` (comma separated) and restart the backend
after changing it.

---

## 12. The connection drops repeatedly

| Cause | Fix |
|---|---|
| The backend restarts (e.g. `--reload`) | The extension reconnects automatically within ~30 s |
| A proxy closes idle WebSockets | Configure a longer idle timeout, or rely on the 30 s heartbeat |
| The service worker is terminated | Chrome 116+ keeps it alive while the WebSocket is active; the `chrome.alarms` keep alive is the fallback |

The badge shows `!` while the extension is offline.

---

## 13. The answer contains extra text

Google's AI Mode renders source attributions ("W3Schools +1"), follow-up
suggestions ("Would you like to know…") and "Try without personalization"
inside the answer container.  They are part of the rendered answer and are
returned verbatim.

If you want the prose only, tighten the `answerProse` selector list in
`extension/lib/ai-mode-dom.js` — for example
`[jsname="CS7uPe"] [jsname="KFl8ub"] > div:first-child` excludes the sibling
blocks that hold the sources.

---

## 14. The prompt is submitted twice

The extension clicks the send button and, if the button cannot be found,
falls back to pressing `Enter`.  If both happen the prompt would be sent
twice.  The code returns after the first successful path, so this should not
happen — if you observe it, check whether the page has *two* send buttons
(the AI Mode page renders a mobile and a desktop variant).  The extension
always picks the **visible** one.

---

## 15. The extension never sees the tab

`chrome.tabs.query` only returns URLs for tabs the extension has host
permission for.  The manifest requests `https://*.google.com/*`, which covers
`www.google.com` and `gemini.google.com`.  If Google moves AI Mode to another
domain, add it to `host_permissions` and reload the extension.

---

## 16. Backend fails to start

| Message | Fix |
|---|---|
| `Address already in use` | Another process uses port 8000 — stop it or use `--port 8001` |
| `ModuleNotFoundError: No module named 'app'` | Run uvicorn **from the `backend/` directory** |
| `ValidationError` for a setting | The value in `.env` has the wrong type (e.g. `REQUEST_TIMEOUT_SECONDS=abc`) |
| The backend generates a token on every start | Set `AUTO_GENERATE_PAIRING_TOKEN=false` and configure the token explicitly |

---

## 17. Useful environment variables for debugging

```ini
LOG_LEVEL=DEBUG
REQUEST_TIMEOUT_SECONDS=300
QUEUE_WAIT_TIMEOUT_SECONDS=120
MAX_PROMPT_CHARS=20000
```

The backend logs the request id, the prompt length and the duration — never
the prompt itself.

---

## 18. Collecting a bug report

Please include:

1. The output of `GET /api/extension/status`.
2. The output of `POST /api/extension/diagnose`.
3. The backend log lines around the failed request.
4. The Chrome version (`chrome://version`) and the extension version.
5. The exact request you sent (with the prompt redacted).
