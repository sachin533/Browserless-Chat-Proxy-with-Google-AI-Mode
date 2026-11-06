/**
 * A small mock of the Chrome extension APIs.
 *
 * It is intentionally minimal: only the APIs the background service worker
 * actually uses are implemented, which keeps the test honest about what the
 * extension depends on.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { EXTENSION_ROOT } = require('./helpers');

class FakeWebSocket {
  constructor(url, registry) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sent = [];
    registry.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code: code || 1000, reason: reason || '' });
  }

  // -- test helpers ---------------------------------------------------
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen({});
  }

  receive(message) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(message) });
  }
}

// The WebSocket ready state constants, exactly like the browser API.
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

/**
 * Create an isolated sandbox that runs the background service worker.
 *
 * @param {object} options
 * @param {object} options.settings   the stored extension settings
 * @param {Array}  options.tabs       the tabs visible to the extension
 * @param {Function} options.onTabMessage  handler for chrome.tabs.sendMessage
 */
function createBackgroundHarness(options = {}) {
  const settings = Object.assign(
    {
      backendUrl: 'http://127.0.0.1:8000',
      pairingToken: 'test-token',
      autoConnect: true,
      surface: 'auto'
    },
    options.settings || {}
  );

  const tabs = options.tabs || [];
  const sockets = [];
  const storage = { gaim_settings: { ...settings } };
  const sessionStorage = {};
  const calls = {
    executeScript: [],
    tabUpdate: [],
    badge: []
  };

  const listeners = {
    message: [],
    alarm: [],
    tabUpdated: [],
    tabRemoved: [],
    tabActivated: [],
    installed: [],
    startup: []
  };

  const onTabMessage = options.onTabMessage || (() => Promise.resolve({ ok: true }));

  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === undefined) return { ...storage };
          if (typeof key === 'string') {
            return storage[key] === undefined ? {} : { [key]: storage[key] };
          }
          const result = {};
          for (const name of key) {
            if (storage[name] !== undefined) result[name] = storage[name];
          }
          return result;
        },
        async set(items) {
          Object.assign(storage, items);
        }
      },
      session: {
        async set(items) {
          Object.assign(sessionStorage, items);
        }
      }
    },

    runtime: {
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      getManifest: () => ({ version: '1.0.0' }),
      async sendMessage() {
        return undefined;
      }
    },

    tabs: {
      async query() {
        return tabs.map((tab) => ({ ...tab }));
      },
      async update(tabId, props) {
        calls.tabUpdate.push({ tabId, props });
        const tab = tabs.find((item) => item.id === tabId);
        if (tab && props.url) tab.url = props.url;
        return tab || {};
      },
      async get(tabId) {
        return tabs.find((item) => item.id === tabId) || { id: tabId, status: 'complete' };
      },
      async sendMessage(tabId, message) {
        return onTabMessage(tabId, message);
      },
      onUpdated: { addListener: (fn) => listeners.tabUpdated.push(fn) },
      onRemoved: { addListener: (fn) => listeners.tabRemoved.push(fn) },
      onActivated: { addListener: (fn) => listeners.tabActivated.push(fn) }
    },

    scripting: {
      async executeScript(injection) {
        calls.executeScript.push(injection);
        return [];
      }
    },

    action: {
      async setBadgeText(details) {
        calls.badge.push(details);
      },
      async setBadgeBackgroundColor(details) {
        calls.badge.push(details);
      }
    },

    alarms: {
      create() {},
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) }
    },

    windows: {
      async getLastFocused() {
        return { id: 1 };
      }
    }
  };

  const sandbox = {
    chrome,
    console,
    WebSocket: class extends FakeWebSocket {
      constructor(url) {
        super(url, sockets);
      }
    },
    navigator: { userAgent: 'node-test' },
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Date,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    Map,
    Set,
    Symbol,
    Proxy,
    Reflect
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const full = path.join(EXTENSION_ROOT, file);
      const source = fs.readFileSync(full, 'utf8');
      vm.runInContext(source, sandbox, { filename: full });
    }
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'background.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'background.js' });

  return {
    sandbox,
    chrome,
    sockets,
    calls,
    listeners,
    storage,
    /** Send a message to the background worker (as the popup would). */
    async send(message) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const timer = setTimeout(() => done(undefined), 3000);

        for (const listener of listeners.message) {
          const outcome = listener(message, {}, (value) => {
            clearTimeout(timer);
            done(value);
          });
          if (outcome && typeof outcome.then === 'function') {
            outcome.then((value) => {
              clearTimeout(timer);
              done(value);
            }).catch(() => undefined);
          } else if (outcome === true) {
            // The listener will answer asynchronously.
          } else if (outcome !== undefined) {
            clearTimeout(timer);
            done(outcome);
          }
        }
      });
    },
    /** Wait for real time to pass (used for timers). */
    wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    /** Let the pending promises settle. */
    async flush(times = 3) {
      for (let index = 0; index < times; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  };
}

module.exports = { createBackgroundHarness, FakeWebSocket };
