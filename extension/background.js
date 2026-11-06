/**
 * Background service worker.
 *
 * Owns the WebSocket connection to the FastAPI backend and translates backend
 * jobs into content script commands.
 *
 * The service worker may be terminated by Chrome at any time, therefore the
 * connection state is kept in `chrome.storage.session` and a 30 second alarm
 * wakes the worker up to re-establish the connection when needed.
 */
importScripts('lib/config.js', 'lib/protocol.js');

const AiModeConfig = globalThis.AiModeConfig;
const AiModeProtocol = globalThis.AiModeProtocol;

const KEEPALIVE_ALARM = 'gaim-keepalive';
const STATUS_INTERVAL_MS = 15000;
const CONNECT_TIMEOUT_MS = 10000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];

const AI_MODE_URLS = AiModeProtocol.AI_MODE_URLS;

const runtime = {
  socket: null,
  connecting: null,
  status: 'disconnected', // disconnected | connecting | connected | error
  lastError: null,
  sessionId: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  tabStatus: AiModeConfig.emptyTabStatus(),
  lastStatusSentAt: 0,
  activeJobTabId: null
};

// ----------------------------------------------------------------------
// Storage helpers
// ----------------------------------------------------------------------
async function getSettings() {
  const stored = await chrome.storage.local.get(AiModeConfig.STORAGE_KEY);
  return AiModeConfig.normalise(stored[AiModeConfig.STORAGE_KEY]);
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = AiModeConfig.normalise({ ...current, ...patch });
  await chrome.storage.local.set({ [AiModeConfig.STORAGE_KEY]: next });
  return next;
}

async function persistRuntimeState() {
  try {
    await chrome.storage.session.set({
      gaim_runtime: {
        status: runtime.status,
        sessionId: runtime.sessionId,
        lastError: runtime.lastError,
        tabStatus: runtime.tabStatus
      }
    });
  } catch (err) {
    /* storage.session may be unavailable - not fatal */
  }
}

// ----------------------------------------------------------------------
// Badge
// ----------------------------------------------------------------------
async function updateBadge() {
  const badge = {
    connected: { text: '', color: '#22c55e' },
    connecting: { text: '...', color: '#3b82f6' },
    error: { text: '!', color: '#ef4444' },
    disconnected: { text: '', color: '#6b7280' }
  }[runtime.status] || { text: '', color: '#6b7280' };

  try {
    await chrome.action.setBadgeText({ text: badge.text });
    await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  } catch (err) {
    /* ignore */
  }
}

function setStatus(status, error) {
  runtime.status = status;
  runtime.lastError = error || null;
  updateBadge();
  persistRuntimeState();
  broadcastState();
}

// ----------------------------------------------------------------------
// Popup broadcast
// ----------------------------------------------------------------------
async function broadcastState() {
  try {
    await chrome.runtime.sendMessage({ type: 'state_changed' }).catch(() => undefined);
  } catch (err) {
    /* no popup open */
  }
}

// ----------------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------------
function websocketUrl(backendUrl) {
  return AiModeProtocol.websocketUrl(backendUrl);
}

function sendToBackend(payload) {
  return new Promise((resolve) => {
    if (!runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) {
      resolve(false);
      return;
    }
    try {
      runtime.socket.send(JSON.stringify(payload));
      resolve(true);
    } catch (err) {
      resolve(false);
    }
  });
}

async function connect(force) {
  const settings = await getSettings();

  if (!settings.backendUrl) {
    setStatus('error', 'No backend URL configured.');
    return false;
  }
  if (!settings.pairingToken) {
    setStatus('error', 'No pairing token configured.');
    return false;
  }
  if (runtime.status === 'connected' && !force) return true;
  if (runtime.connecting && !force) return runtime.connecting;

  runtime.connecting = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      runtime.connecting = null;
      clearTimeout(timer);
      resolve(value);
    };

    // Never keep the popup waiting forever for a half open socket.
    const timer = setTimeout(() => {
      setStatus('error', 'The backend did not answer in time.');
      finish(false);
    }, CONNECT_TIMEOUT_MS);

    let socket;
    try {
      socket = new WebSocket(websocketUrl(settings.backendUrl));
    } catch (err) {
      setStatus('error', `Could not open a WebSocket: ${err.message}`);
      finish(false);
      return;
    }

    runtime.socket = socket;
    setStatus('connecting');

    socket.onopen = () => {
      sendToBackend({
        type: 'auth',
        token: settings.pairingToken,
        client: {
          name: 'google-ai-mode-extension',
          version: chrome.runtime.getManifest().version,
          user_agent: navigator.userAgent
        }
      });
    };

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      handleBackendMessage(message)
        .then((outcome) => {
          if (outcome === 'authenticated') finish(true);
          if (outcome === 'rejected') finish(false);
        })
        .catch(() => finish(false));
    };

    socket.onerror = () => {
      setStatus('error', 'The WebSocket connection failed.');
    };

    socket.onclose = (event) => {
      runtime.socket = null;
      if (runtime.status !== 'error' || event.code !== 1000) {
        setStatus('disconnected');
      }
      scheduleReconnect();
      finish(false);
    };
  });

  return runtime.connecting;
}

function scheduleReconnect() {
  if (runtime.reconnectTimer) return;
  const delay = RECONNECT_DELAYS[Math.min(runtime.reconnectAttempts, RECONNECT_DELAYS.length - 1)];
  runtime.reconnectAttempts += 1;
  runtime.reconnectTimer = setTimeout(async () => {
    runtime.reconnectTimer = null;
    const settings = await getSettings();
    if (!settings.autoConnect) return;
    await connect(false);
  }, delay);
}

function resetReconnectBackoff() {
  runtime.reconnectAttempts = 0;
}

async function handleBackendMessage(message) {
  switch (message.type) {
    case 'auth_ok':
      runtime.sessionId = message.session_id;
      resetReconnectBackoff();
      setStatus('connected');
      await pushStatus(true);
      return 'authenticated';

    case 'auth_error':
      setStatus('error', message.error && message.error.message
        ? message.error.message
        : 'Authentication failed.');
      return 'rejected';

    case 'job':
      await handleJob(message);
      return 'ignored';

    case 'ping':
      await sendToBackend({ type: 'pong', timestamp: Date.now() / 1000 });
      return 'ignored';

    default:
      return 'ignored';
  }
}

// ----------------------------------------------------------------------
// Tab handling
// ----------------------------------------------------------------------
function urlMatchesSurface(url, surface) {
  return AiModeProtocol.urlMatchesSurface(url, surface);
}

function urlMatchesAnySurface(url) {
  return AiModeProtocol.urlMatchesAnySurface(url);
}

async function findAiModeTab(surface) {
  const wanted = surface && surface !== 'auto' ? surface : null;
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((tab) => {
    if (!tab.url) return false;
    if (wanted) return urlMatchesSurface(tab.url, wanted);
    return urlMatchesAnySurface(tab.url);
  });
  if (!candidates.length) return null;

  // Prefer the tab in the most recently focused window.
  const lastFocused = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  candidates.sort((a, b) => {
    const aActive = lastFocused && a.windowId === lastFocused.id ? 0 : 1;
    const bActive = lastFocused && b.windowId === lastFocused.id ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (a.active ? 0 : 1) - (b.active ? 0 : 1);
  });
  return candidates[0];
}

/** Navigate the tab back to the AI Mode home so answers never inherit context. */
async function resetConversation(tab, surface) {
  const base = AI_MODE_URLS[surface] || AI_MODE_URLS.search_ai_mode;
  try {
    const current = new URL(tab.url);
    const target = new URL(base);
    const hasQuery = current.searchParams.has('q');
    const sameSurface = urlMatchesSurface(tab.url, surface);
    if (!hasQuery || !sameSurface) return false;
    if (current.pathname === target.pathname && current.search === target.search) return false;
  } catch (err) {
    return false;
  }

  await chrome.tabs.update(tab.id, { url: base });
  await waitForTabReady(tab.id);
  return true;
}

function waitForTabReady(tabId, timeoutMs) {
  const timeout = timeoutMs || 20000;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(value);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete') finish(true);
    }).catch(() => finish(false));
  });
}

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // The content script is missing (the tab was opened before the extension
    // was installed or reloaded) - inject it and try again.
    await injectContentScript(tabId);
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/ai-mode-dom.js', 'content.js']
  });
}

// ----------------------------------------------------------------------
// Jobs
// ----------------------------------------------------------------------
async function handleJob(job) {
  const requestId = job.request_id;
  const action = job.action || 'run_prompt';
  const payload = job.payload || {};
  const settings = await getSettings();

  try {
    const tab = await findAiModeTab(settings.surface);
    if (!tab) {
      await respondError(requestId, 'ai_mode_tab_not_found',
        'No Google AI Mode tab is open in this browser.');
      return;
    }

    runtime.activeJobTabId = tab.id;

    if (action === 'diagnose') {
      const result = await sendToContentScript(tab.id, { type: 'diagnose', request_id: requestId });
      if (!result || !result.ok) {
        await respondError(requestId, 'diagnose_failed',
          (result && result.message) || 'The page could not be inspected.');
        return;
      }
      await respondSuccess(requestId, {
        text: result.text,
        source_url: result.source_url,
        payload: result.payload
      });
      return;
    }

    if (payload.reset_conversation) {
      await resetConversation(tab, settings.surface === 'auto'
        ? (urlMatchesSurface(tab.url, 'gemini') ? 'gemini' : 'search_ai_mode')
        : settings.surface);
    }

    const result = await sendToContentScript(tab.id, {
      type: 'run_prompt',
      request_id: requestId,
      prompt: payload.prompt,
      timeout_ms: payload.timeout_ms
    });

    if (!result) {
      await respondError(requestId, 'empty_response',
        'The content script did not return a result.');
      return;
    }
    if (!result.ok) {
      await respondError(requestId, result.code || 'upstream_error',
        result.message || 'The browser interaction failed.', result.details);
      return;
    }

    await respondSuccess(requestId, {
      text: result.text,
      finish_reason: result.finish_reason || 'stop',
      duration_ms: result.duration_ms || 0,
      source_url: result.source_url || null
    });
  } catch (err) {
    await respondError(requestId, 'internal_error', String((err && err.message) || err));
  } finally {
    runtime.activeJobTabId = null;
  }
}

async function respondSuccess(requestId, payload) {
  await sendToBackend({
    type: 'job_result',
    request_id: requestId,
    ok: true,
    payload
  });
}

async function respondError(requestId, code, message, details) {
  await sendToBackend({
    type: 'job_result',
    request_id: requestId,
    ok: false,
    error: { code, message, details: details || {} }
  });
}

// ----------------------------------------------------------------------
// Status
// ----------------------------------------------------------------------
async function collectTabStatus() {
  const settings = await getSettings();
  const tab = await findAiModeTab(settings.surface);
  if (!tab) {
    return { ...AiModeConfig.emptyTabStatus(), page_url: null };
  }

  let payload = null;
  try {
    const response = await sendToContentScript(tab.id, { type: 'get_status' });
    if (response && response.ok) payload = response.payload;
  } catch (err) {
    payload = null;
  }

  if (!payload) {
    // The content script is not reachable - at least report the tab itself.
    return {
      ...AiModeConfig.emptyTabStatus(),
      ai_mode_tab_open: true,
      page_url: tab.url,
      tab_id: tab.id,
      surface: urlMatchesSurface(tab.url, 'gemini') ? 'gemini' : 'search_ai_mode'
    };
  }

  return { ...payload, tab_id: tab.id };
}

async function pushStatus(force) {
  if (runtime.status !== 'connected') return;
  const now = Date.now();
  if (!force && now - runtime.lastStatusSentAt < STATUS_INTERVAL_MS) return;

  try {
    runtime.tabStatus = await collectTabStatus();
    runtime.lastStatusSentAt = now;
    await sendToBackend({ type: 'status', payload: runtime.tabStatus });
    persistRuntimeState();
    broadcastState();
  } catch (err) {
    /* ignore transient failures */
  }
}

// ----------------------------------------------------------------------
// Message handling (popup + content script)
// ----------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return undefined;

  switch (message.type) {
    case 'page_status': {
      runtime.tabStatus = { ...runtime.tabStatus, ...(message.payload || {}) };
      pushStatus(true);
      sendResponse({ ok: true });
      return undefined;
    }

    case 'job_delta': {
      sendToBackend({
        type: 'job_delta',
        request_id: message.request_id,
        payload: message.payload || {}
      });
      sendResponse({ ok: true });
      return undefined;
    }

    case 'get_state': {
      getSettings().then((settings) => {
        sendResponse({
          ok: true,
          state: {
            backendUrl: settings.backendUrl,
            hasToken: !!settings.pairingToken,
            tokenPreview: AiModeConfig.maskToken(settings.pairingToken),
            autoConnect: settings.autoConnect,
            surface: settings.surface,
            connectionStatus: runtime.status,
            lastError: runtime.lastError,
            sessionId: runtime.sessionId,
            tabStatus: runtime.tabStatus
          }
        });
      });
      return true;
    }

    case 'save_settings': {
      saveSettings(message.settings || {}).then(async (settings) => {
        broadcastState();
        // Answer the popup first - connecting may take a moment.
        sendResponse({ ok: true, settings: AiModeConfig.publicSettings(settings) });
        if (settings.autoConnect && runtime.status !== 'connected') {
          await connect(true);
        } else if (!settings.autoConnect && runtime.socket) {
          runtime.socket.close();
        }
      });
      return true;
    }

    case 'connect': {
      connect(true).then((ok) => {
        sendResponse({ ok });
        if (ok) pushStatus(true);
      });
      return true;
    }

    case 'disconnect': {
      if (runtime.socket) {
        runtime.socket.close(1000, 'closed by user');
      }
      setStatus('disconnected');
      sendResponse({ ok: true });
      return undefined;
    }

    case 'open_ai_mode': {
      const url = message.url || AI_MODE_URLS.search_ai_mode;
      chrome.tabs.create({ url }).then(() => {
        sendResponse({ ok: true });
        setTimeout(() => pushStatus(true), 1500);
      });
      return true;
    }

    case 'refresh_status': {
      pushStatus(true).then(() => {
        sendResponse({ ok: true, tabStatus: runtime.tabStatus });
      });
      return true;
    }

    default:
      return undefined;
  }
});

// ----------------------------------------------------------------------
// Tab lifecycle
// ----------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(() => {
  pushStatus(true);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && runtime.activeJobTabId === tabId) {
    // A real navigation during a job - the content script is gone.
    respondError('page_navigated', 'page_navigated',
      'The Google AI Mode page navigated away while the request was running.');
    return;
  }
  if (changeInfo.status === 'complete' || changeInfo.url) {
    pushStatus(true);
  }
});

chrome.tabs.onActivated.addListener(() => {
  pushStatus(true);
});

// ----------------------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  const settings = await getSettings();
  if (settings.autoConnect) connect(false);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  const settings = await getSettings();
  if (settings.autoConnect) connect(false);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  const settings = await getSettings();
  if (!settings.autoConnect) return;
  if (runtime.status !== 'connected') {
    await connect(false);
  } else {
    await pushStatus(true);
  }
});

// Make sure the alarm exists after a service worker restart.
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
getSettings().then((settings) => {
  if (settings.autoConnect) connect(false);
});
