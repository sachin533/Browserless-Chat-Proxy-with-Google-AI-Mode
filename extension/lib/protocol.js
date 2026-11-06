/**
 * Protocol helpers shared by the background worker and the test suite.
 *
 * Loaded with `importScripts` in the service worker and required as a
 * CommonJS module in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AiModeProtocol = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AI_MODE_URLS = {
    search_ai_mode: 'https://www.google.com/search?udm=50',
    gemini: 'https://gemini.google.com/app'
  };

  const SURFACES = ['auto', 'search_ai_mode', 'gemini'];

  /**
   * Convert a backend base URL into the WebSocket URL of the control channel.
   */
  function websocketUrl(backendUrl) {
    const url = String(backendUrl || '').trim();
    if (!url) return '';
    let normalised = url;
    if (/^https:\/\//i.test(normalised)) {
      normalised = `wss://${normalised.slice('https://'.length)}`;
    } else if (/^http:\/\//i.test(normalised)) {
      normalised = `ws://${normalised.slice('http://'.length)}`;
    } else if (!/^wss?:\/\//i.test(normalised)) {
      normalised = `ws://${normalised}`;
    }
    return `${normalised.replace(/\/+$/, '')}/ws/extension`;
  }

  /** True when the URL points at the given AI surface. */
  function urlMatchesSurface(url, surface) {
    if (!url) return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();

    if (surface === 'gemini') {
      return host === 'gemini.google.com' || host.endsWith('.gemini.google.com');
    }
    if (surface === 'search_ai_mode') {
      const isGoogle = host === 'google.com' || host.endsWith('.google.com');
      if (!isGoogle) return false;
      return parsed.searchParams.get('udm') === '50';
    }
    return false;
  }

  /** True when the URL points at any supported AI surface. */
  function urlMatchesAnySurface(url) {
    return SURFACES.some((surface) => surface !== 'auto' && urlMatchesSurface(url, surface));
  }

  /** True when the tab already shows a submitted conversation. */
  function hasSubmittedQuery(url) {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.has('q');
    } catch (err) {
      return false;
    }
  }

  return {
    AI_MODE_URLS,
    SURFACES,
    websocketUrl,
    urlMatchesSurface,
    urlMatchesAnySurface,
    hasSubmittedQuery
  };
});
