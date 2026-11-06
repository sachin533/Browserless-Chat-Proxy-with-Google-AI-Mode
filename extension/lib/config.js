/**
 * Shared configuration helpers for the extension.
 *
 * Loaded both as a classic script (`importScripts`) in the service worker and
 * as a CommonJS module in the Node test suite.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = { AiModeConfig: api };
  }
  if (root) {
    root.AiModeConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'gaim_settings';

  const DEFAULTS = {
    backendUrl: 'http://127.0.0.1:8000',
    pairingToken: '',
    autoConnect: true,
    surface: 'auto'
  };

  const SURFACES = ['auto', 'search_ai_mode', 'gemini'];

  function normalise(settings) {
    const source = settings || {};
    return {
      backendUrl: String(source.backendUrl || DEFAULTS.backendUrl).trim(),
      pairingToken: String(source.pairingToken || '').trim(),
      autoConnect: source.autoConnect === undefined ? DEFAULTS.autoConnect : !!source.autoConnect,
      surface: SURFACES.indexOf(source.surface) === -1 ? DEFAULTS.surface : source.surface
    };
  }

  function emptyTabStatus() {
    return {
      ai_mode_tab_open: false,
      ai_mode_ready: false,
      logged_in: false,
      captcha_detected: false,
      page_url: null,
      surface: null,
      tab_id: null,
      prompt_input_available: false,
      answer_container_available: false,
      diagnostics: {}
    };
  }

  /** Mask a token so it can be shown in the popup without leaking it. */
  function maskToken(token) {
    const value = String(token || '');
    if (!value) return '';
    if (value.length <= 8) return '•'.repeat(value.length);
    return `${value.slice(0, 3)}••••${value.slice(-3)}`;
  }

  /** Settings that may safely be returned to the popup. */
  function publicSettings(settings) {
    const value = normalise(settings);
    return {
      backendUrl: value.backendUrl,
      autoConnect: value.autoConnect,
      surface: value.surface,
      hasToken: !!value.pairingToken,
      tokenPreview: maskToken(value.pairingToken)
    };
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    SURFACES,
    normalise,
    emptyTabStatus,
    maskToken,
    publicSettings
  };
});
