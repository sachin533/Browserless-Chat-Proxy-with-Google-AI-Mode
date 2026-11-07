/**
 * Thin client for the Google AI Mode API backend.
 *
 * Everything the frontend knows about the backend lives here: the endpoint
 * paths, the request shape and the response shape.  No secret is ever baked
 * into the bundle - an optional API key is supplied at runtime by the user
 * and kept in sessionStorage.
 */

const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

/** Base URL of the FastAPI backend, without a trailing slash. */
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');

/** Model identifier used for chat completions. */
export const MODEL = import.meta.env.VITE_MODEL || 'google-ai-mode';

/** Whether Server-Sent Events may be used. */
export const STREAMING_ENABLED = import.meta.env.VITE_ENABLE_STREAMING !== 'false';

/**
 * Resolve the base URL for a request.
 *
 * The runtime value from the settings panel wins over the build time
 * environment variable so the backend can be repointed without a rebuild.
 */
export function resolveBaseUrl(override) {
  const raw = String(override || RAW_BASE_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

/** Storage key for a runtime supplied API key (never bundled). */
const API_KEY_STORAGE = 'gaim.apiKey';

/** Error carrying the structured backend error payload. */
export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code || 'unknown_error';
    this.type = options.type || 'api_error';
    this.status = options.status ?? 0;
    this.param = options.param ?? null;
    this.details = options.details || null;
    this.isNetworkError = Boolean(options.isNetworkError);
  }
}

/* ------------------------------------------------------------------ */
/* API key handling                                                     */
/* ------------------------------------------------------------------ */

/** Read the runtime API key from sessionStorage. */
export function getApiKey() {
  try {
    return window.sessionStorage.getItem(API_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

/** Persist the runtime API key in sessionStorage. */
export function setApiKey(value) {
  try {
    if (value) {
      window.sessionStorage.setItem(API_KEY_STORAGE, value);
    } else {
      window.sessionStorage.removeItem(API_KEY_STORAGE);
    }
  } catch {
    /* storage may be unavailable - the key simply is not persisted */
  }
}

function buildHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

/* ------------------------------------------------------------------ */
/* Error helpers                                                        */
/* ------------------------------------------------------------------ */

function parseErrorPayload(payload, status) {
  const error = payload && payload.error ? payload.error : null;
  if (error) {
    return new ApiError(error.message || 'The request failed.', {
      code: error.code,
      type: error.type,
      status,
      param: error.param,
      details: error.details,
    });
  }
  return new ApiError(
    `The backend returned HTTP ${status}.`,
    { code: `http_${status}`, status },
  );
}

function toNetworkError(error, baseUrl) {
  if (error instanceof ApiError) return error;
  return new ApiError(
    `Could not reach the backend at ${baseUrl}. Is it running? (${error.message})`,
    { code: 'network_error', type: 'network_error', isNetworkError: true },
  );
}

/* ------------------------------------------------------------------ */
/* Status endpoints                                                     */
/* ------------------------------------------------------------------ */

/** GET /health - liveness of the backend. */
export async function fetchHealth({ signal, baseUrl } = {}) {
  const url = resolveBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${url}/health`, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw toNetworkError(error, url);
  }
  if (!response.ok) {
    throw parseErrorPayload(await safeJson(response), response.status);
  }
  return response.json();
}

/** GET /api/extension/status - extension, tab and login state. */
export async function fetchExtensionStatus({ signal, baseUrl } = {}) {
  const url = resolveBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${url}/api/extension/status`, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw toNetworkError(error, url);
  }
  if (!response.ok) {
    throw parseErrorPayload(await safeJson(response), response.status);
  }
  return response.json();
}

/** POST /api/extension/diagnose - live page diagnostics. */
export async function fetchDiagnostics({ signal, baseUrl } = {}) {
  const url = resolveBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${url}/api/extension/diagnose`, {
      method: 'POST',
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw toNetworkError(error, url);
  }
  if (!response.ok) {
    throw parseErrorPayload(await safeJson(response), response.status);
  }
  return response.json();
}

/* ------------------------------------------------------------------ */
/* Chat completions                                                     */
/* ------------------------------------------------------------------ */

/**
 * POST /v1/chat/completions (non streaming).
 *
 * @returns {Promise<{content: string, raw: object, meta: object}>}
 */
export async function sendChatCompletion({
  messages,
  model = MODEL,
  apiKey,
  signal,
  baseUrl,
}) {
  const url = resolveBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({ model, messages, stream: false }),
      signal,
    });
  } catch (error) {
    throw toNetworkError(error, url);
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    throw parseErrorPayload(payload, response.status);
  }

  const choice = payload?.choices?.[0];
  const content = choice?.message?.content ?? '';

  return {
    content,
    raw: payload,
    meta: {
      requestId: response.headers.get('x-google-ai-mode-request-id') || null,
      durationMs: toNumber(response.headers.get('x-google-ai-mode-duration-ms')),
      sourceUrl: response.headers.get('x-google-ai-mode-source') || null,
      model: payload?.model || model,
      finishReason: choice?.finish_reason || null,
      usage: payload?.usage || null,
      streamed: false,
    },
  };
}

/**
 * POST /v1/chat/completions with `stream: true`.
 *
 * The backend answers with `text/event-stream`.  `onDelta` is called with
 * every content fragment, `onDone` with the accumulated metadata.
 *
 * @returns {Promise<{content: string, meta: object}>}
 */
export async function sendChatCompletionStream({
  messages,
  model = MODEL,
  apiKey,
  signal,
  baseUrl,
  onDelta,
}) {
  const url = resolveBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
  } catch (error) {
    throw toNetworkError(error, url);
  }

  if (!response.ok) {
    const payload = await safeJson(response);
    throw parseErrorPayload(payload, response.status);
  }

  if (!response.body) {
    throw new ApiError('The backend did not return a readable stream.', {
      code: 'stream_not_readable',
      status: response.status,
    });
  }

  const meta = {
    requestId: response.headers.get('x-google-ai-mode-request-id') || null,
    durationMs: toNumber(response.headers.get('x-google-ai-mode-duration-ms')),
    sourceUrl: response.headers.get('x-google-ai-mode-source') || null,
    model,
    finishReason: null,
    usage: null,
    streamed: true,
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const handleEvent = (rawEvent) => {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) return;

    for (const data of dataLines) {
      if (data === '[DONE]') return;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed.error) {
        throw new ApiError(parsed.error.message || 'The stream failed.', {
          code: parsed.error.code,
          type: parsed.error.type,
          status: response.status,
          param: parsed.error.param,
          details: parsed.error.details,
        });
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta;
        onDelta?.(delta, content);
      }
      if (choice?.finish_reason) {
        meta.finishReason = choice.finish_reason;
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        if (event.trim()) handleEvent(event);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (error) {
    throw toNetworkError(error, url);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* the reader may already be released */
    }
  }

  if (!meta.finishReason) {
    meta.finishReason = 'stop';
  }
  return { content, meta };
}

/* ------------------------------------------------------------------ */
/* Utilities                                                            */
/* ------------------------------------------------------------------ */

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
