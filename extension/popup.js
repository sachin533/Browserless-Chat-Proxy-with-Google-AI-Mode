/**
 * Popup logic.
 *
 * The popup never talks to the backend directly - it only talks to the
 * background service worker, which owns the WebSocket connection.  The
 * pairing token is stored in `chrome.storage.local` and is never exposed to
 * any web page.
 */
(function () {
  'use strict';

  const els = {
    dot: document.getElementById('status-dot'),
    connectionLabel: document.getElementById('connection-label'),
    backendStatus: document.getElementById('backend-status'),
    extensionStatus: document.getElementById('extension-status'),
    tabStatus: document.getElementById('tab-status'),
    loginStatus: document.getElementById('login-status'),
    backendUrl: document.getElementById('backend-url'),
    pairingToken: document.getElementById('pairing-token'),
    autoConnect: document.getElementById('auto-connect'),
    saveButton: document.getElementById('save-button'),
    reconnectButton: document.getElementById('reconnect-button'),
    openButton: document.getElementById('open-button'),
    hint: document.getElementById('hint')
  };

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function setStatusValue(element, text, tone) {
    element.textContent = text;
    element.className = `status-value${tone ? ` ${tone}` : ''}`;
  }

  function originPattern(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/*`;
    } catch (err) {
      return null;
    }
  }

  async function requestBackendPermission(url) {
    const pattern = originPattern(url);
    if (!pattern) return true;
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      return !!granted;
    } catch (err) {
      // The permission is optional - the WebSocket works without it.
      return true;
    }
  }

  function render(state) {
    if (!state) return;

    els.backendUrl.value = state.backendUrl || '';
    els.autoConnect.checked = !!state.autoConnect;
    if (!els.pairingToken.value && state.hasToken) {
      els.pairingToken.value = '';
      els.pairingToken.placeholder = `Saved (${state.tokenPreview || '••••'}) - leave empty to keep`;
    }

    const status = state.connectionStatus || 'disconnected';
    els.dot.className = 'dot';
    if (status === 'connected') {
      els.dot.classList.add('connected');
    } else if (status === 'connecting') {
      els.dot.classList.add('connecting');
    } else if (status === 'error') {
      els.dot.classList.add('error');
    }

    setStatusValue(els.backendStatus, state.backendUrl || 'not configured',
      state.backendUrl ? 'ok' : 'bad');
    setStatusValue(els.extensionStatus, status, {
      connected: 'ok',
      connecting: 'warn',
      error: 'bad',
      disconnected: 'bad'
    }[status] || '');

    const tab = state.tabStatus || {};
    if (!tab.ai_mode_tab_open) {
      setStatusValue(els.tabStatus, 'not open', 'bad');
    } else if (tab.captcha_detected) {
      setStatusValue(els.tabStatus, 'CAPTCHA', 'bad');
    } else if (tab.ai_mode_ready) {
      setStatusValue(els.tabStatus, 'ready', 'ok');
    } else {
      setStatusValue(els.tabStatus, 'loading', 'warn');
    }

    if (tab.captcha_detected) {
      setStatusValue(els.loginStatus, 'CAPTCHA', 'bad');
    } else if (tab.logged_in) {
      setStatusValue(els.loginStatus, 'signed in', 'ok');
    } else if (tab.ai_mode_tab_open) {
      setStatusValue(els.loginStatus, 'sign-in needed', 'warn');
    } else {
      setStatusValue(els.loginStatus, 'unknown', '');
    }

    els.connectionLabel.textContent = state.lastError
      ? state.lastError
      : {
        connected: 'Connected to the backend',
        connecting: 'Connecting to the backend…',
        error: 'Connection error',
        disconnected: 'Not connected'
      }[status] || 'Unknown state';

    if (tab.captcha_detected) {
      els.hint.textContent =
        'Google is showing a CAPTCHA in the AI Mode tab. Solve it manually in the tab, then retry - the extension never bypasses it.';
    } else if (tab.ai_mode_tab_open && !tab.logged_in) {
      els.hint.textContent =
        'Sign in to your Google account in the AI Mode tab, then press Reconnect. The extension never handles your Google password.';
    } else {
      els.hint.textContent =
        'Sign in to Google in the AI Mode tab, then keep it open. Requests are answered by Google AI Mode in your own browser session.';
    }
  }

  async function refresh() {
    const response = await send({ type: 'get_state' });
    if (response && response.ok) {
      render(response.state);
    } else {
      els.connectionLabel.textContent = 'The background worker is not reachable.';
    }
  }

  els.saveButton.addEventListener('click', async () => {
    els.saveButton.disabled = true;
    const backendUrl = els.backendUrl.value.trim();
    const pairingToken = els.pairingToken.value.trim();

    await requestBackendPermission(backendUrl);

    const settings = { backendUrl, autoConnect: els.autoConnect.checked };
    if (pairingToken) settings.pairingToken = pairingToken;

    const response = await send({ type: 'save_settings', settings });
    if (response && response.ok) {
      els.pairingToken.value = '';
      els.hint.textContent = 'Settings saved.';
    } else {
      els.hint.textContent = `Could not save the settings: ${(response && response.error) || 'unknown error'}`;
    }
    els.saveButton.disabled = false;
    await refresh();
  });

  els.reconnectButton.addEventListener('click', async () => {
    els.reconnectButton.disabled = true;
    await send({ type: 'connect' });
    await refresh();
    els.reconnectButton.disabled = false;
  });

  els.openButton.addEventListener('click', async () => {
    await send({ type: 'open_ai_mode' });
    setTimeout(refresh, 1200);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'state_changed') refresh();
  });

  refresh();
  setInterval(refresh, 2000);
})();
