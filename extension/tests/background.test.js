/**
 * Background service worker tests.
 *
 * The worker is executed inside a sandbox with a mocked `chrome.*` API so
 * that the connection handling, the job routing and the reconnection logic
 * are verified without a real browser.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackgroundHarness } = require('./chrome-mock');
const { loadProtocolModule } = require('./helpers');

const Protocol = loadProtocolModule();

const AI_MODE_TAB = {
  id: 7,
  url: 'https://www.google.com/search?udm=50',
  active: true,
  windowId: 1,
  status: 'complete'
};

// ----------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------
test('the websocket url is derived from the backend url', () => {
  assert.equal(
    Protocol.websocketUrl('http://127.0.0.1:8000'),
    'ws://127.0.0.1:8000/ws/extension'
  );
  assert.equal(
    Protocol.websocketUrl('https://api.example.com/'),
    'wss://api.example.com/ws/extension'
  );
  assert.equal(
    Protocol.websocketUrl('ws://localhost:8000'),
    'ws://localhost:8000/ws/extension'
  );
  assert.equal(Protocol.websocketUrl(''), '');
});

test('the AI Mode urls are recognised', () => {
  assert.ok(Protocol.urlMatchesSurface('https://www.google.com/search?udm=50', 'search_ai_mode'));
  assert.ok(Protocol.urlMatchesSurface('https://www.google.com/search?q=a&udm=50&mstk=x', 'search_ai_mode'));
  assert.ok(!Protocol.urlMatchesSurface('https://www.google.com/search?q=a', 'search_ai_mode'));
  assert.ok(Protocol.urlMatchesSurface('https://gemini.google.com/app', 'gemini'));
  assert.ok(!Protocol.urlMatchesSurface('https://www.google.com/', 'gemini'));
  assert.ok(Protocol.urlMatchesAnySurface('https://gemini.google.com/app'));
  assert.ok(!Protocol.urlMatchesAnySurface('https://example.com/'));
});

// ----------------------------------------------------------------------
// Connection handling
// ----------------------------------------------------------------------
test('the worker connects and authenticates on startup', async () => {
  const harness = createBackgroundHarness({ tabs: [AI_MODE_TAB] });
  await harness.flush();

  assert.equal(harness.sockets.length, 1);
  assert.equal(harness.sockets[0].url, 'ws://127.0.0.1:8000/ws/extension');

  harness.sockets[0].open();
  await harness.flush();

  const auth = harness.sockets[0].sent[0];
  assert.equal(auth.type, 'auth');
  assert.equal(auth.token, 'test-token');
  assert.equal(auth.client.name, 'google-ai-mode-extension');
});

test('no connection is opened without a pairing token', async () => {
  const harness = createBackgroundHarness({
    settings: { pairingToken: '', backendUrl: 'http://127.0.0.1:8000' }
  });
  await harness.flush();

  assert.equal(harness.sockets.length, 0);
  const state = await harness.send({ type: 'get_state' });
  assert.equal(state.state.connectionStatus, 'error');
});

test('auth_ok marks the extension as connected', async () => {
  const harness = createBackgroundHarness({ tabs: [AI_MODE_TAB] });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({ type: 'auth_ok', session_id: 'abc123' });
  await harness.flush();

  const state = await harness.send({ type: 'get_state' });
  assert.equal(state.state.connectionStatus, 'connected');
  assert.equal(state.state.sessionId, 'abc123');
});

test('an auth error is surfaced to the popup', async () => {
  const harness = createBackgroundHarness({ tabs: [AI_MODE_TAB] });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({
    type: 'auth_error',
    error: { code: 'extension_auth_failed', message: 'Invalid pairing token.' }
  });
  await harness.flush();

  const state = await harness.send({ type: 'get_state' });
  assert.equal(state.state.connectionStatus, 'error');
  assert.match(state.state.lastError, /Invalid pairing token/);
});

test('a dropped connection triggers a reconnect', async () => {
  const harness = createBackgroundHarness({ tabs: [AI_MODE_TAB] });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].close(1006);
  await harness.wait(1200);
  await harness.flush();

  assert.equal(harness.sockets.length, 2, 'a new socket must be created');
  assert.equal(harness.sockets[1].url, 'ws://127.0.0.1:8000/ws/extension');
});

test('a ping is answered with a pong', async () => {
  const harness = createBackgroundHarness({ tabs: [AI_MODE_TAB] });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({ type: 'ping' });
  await harness.flush();

  const pong = harness.sockets[0].sent.find((message) => message.type === 'pong');
  assert.ok(pong);
});

// ----------------------------------------------------------------------
// Job routing
// ----------------------------------------------------------------------
test('a job is forwarded to the content script and the result is returned', async () => {
  const seen = [];
  const harness = createBackgroundHarness({
    tabs: [AI_MODE_TAB],
    onTabMessage: async (tabId, message) => {
      seen.push({ tabId, message });
      if (message.type === 'get_status') {
        return { ok: true, payload: { ai_mode_tab_open: true, ai_mode_ready: true, logged_in: true } };
      }
      if (message.type === 'run_prompt') {
        return {
          ok: true,
          text: 'Python is a programming language.',
          finish_reason: 'stop',
          duration_ms: 1234,
          source_url: 'https://www.google.com/search?q=test&udm=50'
        };
      }
      return { ok: true };
    }
  });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();
  harness.sockets[0].receive({ type: 'auth_ok', session_id: 's1' });
  await harness.flush();

  harness.sockets[0].receive({
    type: 'job',
    request_id: 'req_1',
    action: 'run_prompt',
    payload: { prompt: 'Explain Python.', timeout_ms: 60000 }
  });
  await harness.flush(6);

  const runCommand = seen.find((entry) => entry.message.type === 'run_prompt');
  assert.ok(runCommand, 'the content script must receive the prompt');
  assert.equal(runCommand.tabId, AI_MODE_TAB.id);
  assert.equal(runCommand.message.prompt, 'Explain Python.');
  assert.equal(runCommand.message.request_id, 'req_1');

  const result = harness.sockets[0].sent.find((message) => message.type === 'job_result');
  assert.ok(result);
  assert.equal(result.request_id, 'req_1');
  assert.equal(result.ok, true);
  assert.equal(result.payload.text, 'Python is a programming language.');
});

test('a failing content script produces an error result', async () => {
  const harness = createBackgroundHarness({
    tabs: [AI_MODE_TAB],
    onTabMessage: async (tabId, message) => {
      if (message.type === 'get_status') {
        return { ok: true, payload: { ai_mode_tab_open: true, ai_mode_ready: true, logged_in: true } };
      }
      return { ok: false, code: 'prompt_input_unavailable', message: 'No prompt field.' };
    }
  });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({
    type: 'job',
    request_id: 'req_2',
    action: 'run_prompt',
    payload: { prompt: 'Hello' }
  });
  await harness.flush(6);

  const result = harness.sockets[0].sent.find((message) => message.type === 'job_result');
  assert.ok(result);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'prompt_input_unavailable');
});

test('a missing AI Mode tab produces ai_mode_tab_not_found', async () => {
  const harness = createBackgroundHarness({ tabs: [] });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({
    type: 'job',
    request_id: 'req_3',
    action: 'run_prompt',
    payload: { prompt: 'Hello' }
  });
  await harness.flush(6);

  const result = harness.sockets[0].sent.find((message) => message.type === 'job_result');
  assert.ok(result);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ai_mode_tab_not_found');
});

test('a missing content script is injected and the job is retried', async () => {
  let attempts = 0;
  const harness = createBackgroundHarness({
    tabs: [AI_MODE_TAB],
    onTabMessage: async (tabId, message) => {
      if (message.type === 'get_status') {
        return { ok: true, payload: { ai_mode_tab_open: true, ai_mode_ready: true, logged_in: true } };
      }
      attempts += 1;
      if (attempts === 1) throw new Error('Receiving end does not exist');
      return { ok: true, text: 'Recovered answer.', duration_ms: 10 };
    }
  });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({
    type: 'job',
    request_id: 'req_4',
    action: 'run_prompt',
    payload: { prompt: 'Hello' }
  });
  await harness.flush(8);

  assert.equal(harness.calls.executeScript.length, 1);
  assert.equal(
    Array.from(harness.calls.executeScript[0].files).join(','),
    'lib/ai-mode-dom.js,content.js'
  );

  const result = harness.sockets[0].sent.find((message) => message.type === 'job_result');
  assert.ok(result);
  assert.equal(result.ok, true);
  assert.equal(result.payload.text, 'Recovered answer.');
});

test('the conversation is reset before a new prompt', async () => {
  const harness = createBackgroundHarness({
    tabs: [
      {
        ...AI_MODE_TAB,
        url: 'https://www.google.com/search?q=previous&udm=50&mstk=abc'
      }
    ],
    onTabMessage: async (tabId, message) => {
      if (message.type === 'get_status') {
        return { ok: true, payload: { ai_mode_tab_open: true, ai_mode_ready: true, logged_in: true } };
      }
      return { ok: true, text: 'ok', duration_ms: 1 };
    }
  });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();

  harness.sockets[0].receive({
    type: 'job',
    request_id: 'req_5',
    action: 'run_prompt',
    payload: { prompt: 'Hello', reset_conversation: true }
  });
  await harness.flush(8);

  assert.ok(harness.calls.tabUpdate.length >= 1);
  assert.equal(harness.calls.tabUpdate[0].props.url, 'https://www.google.com/search?udm=50');
});

// ----------------------------------------------------------------------
// Status reporting
// ----------------------------------------------------------------------
test('the page status is forwarded to the backend', async () => {
  const harness = createBackgroundHarness({
    tabs: [AI_MODE_TAB],
    onTabMessage: async () => ({
      ok: true,
      payload: {
        ai_mode_tab_open: true,
        ai_mode_ready: true,
        logged_in: true,
        captcha_detected: false,
        page_url: 'https://www.google.com/search?udm=50',
        surface: 'search_ai_mode'
      }
    })
  });
  await harness.flush();
  harness.sockets[0].open();
  await harness.flush();
  harness.sockets[0].receive({ type: 'auth_ok', session_id: 's1' });
  await harness.flush(6);

  const status = harness.sockets[0].sent.find((message) => message.type === 'status');
  assert.ok(status, 'a status message must be sent');
  assert.equal(status.payload.ai_mode_tab_open, true);
  assert.equal(status.payload.logged_in, true);
  assert.equal(status.payload.surface, 'search_ai_mode');
});

test('the popup can save the settings and connect', async () => {
  const harness = createBackgroundHarness({
    settings: { backendUrl: 'http://127.0.0.1:8000', pairingToken: '', autoConnect: false },
    tabs: [AI_MODE_TAB]
  });
  await harness.flush();

  await harness.send({
    type: 'save_settings',
    settings: { backendUrl: 'http://127.0.0.1:9000', pairingToken: 'new-token', autoConnect: true }
  });
  await harness.flush(4);

  assert.equal(harness.storage.gaim_settings.backendUrl, 'http://127.0.0.1:9000');
  assert.equal(harness.storage.gaim_settings.pairingToken, 'new-token');
  assert.ok(harness.sockets.length >= 1);
  assert.equal(harness.sockets[harness.sockets.length - 1].url, 'ws://127.0.0.1:9000/ws/extension');
});

test('the pairing token is never returned in full to the popup', async () => {
  const harness = createBackgroundHarness({ tabs: [AI_MODE_TAB] });
  await harness.flush();

  const state = await harness.send({ type: 'get_state' });

  assert.equal(state.state.hasToken, true);
  assert.ok(!JSON.stringify(state.state).includes('test-token'));
  assert.match(state.state.tokenPreview, /••••/);
});
