/**
 * Content script - runs inside the Google AI Mode / Gemini page.
 *
 * Responsibilities:
 *   1. report the page state (surface, login, readiness) to the background
 *   2. type a prompt into the page's own input and submit it
 *   3. wait until the answer is finished and extract the real text
 *   4. stream incremental updates while the answer is rendered
 *
 * The script never bypasses authentication, CAPTCHA or any access control:
 * if Google shows a CAPTCHA the request fails with a descriptive error and the
 * user solves it manually.
 */
(function () {
  'use strict';

  if (window.__googleAiModeApiLoaded) return;
  window.__googleAiModeApiLoaded = true;

  const Dom = window.AiModeDom;

  const POLL_INTERVAL_MS = 200;
  const STABLE_MS = 1200;
  const SEND_ENABLED_TIMEOUT_MS = 4000;
  const PROMPT_INPUT_TIMEOUT_MS = 10000;
  const MIN_ANSWER_LENGTH = 2;

  const state = {
    surface: null,
    lastStatusFingerprint: ''
  };

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------
  function log(...args) {
    if (localStorage.getItem('gaim.debug') === '1') {
      console.log('[Google AI Mode API]', ...args);
    }
  }

  function currentUrl() {
    return window.location.href;
  }

  function options() {
    return { url: currentUrl() };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nativeInputValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  // ------------------------------------------------------------------
  // Input handling
  // ------------------------------------------------------------------

  function isTextarea(element) {
    return element && element.tagName && element.tagName.toLowerCase() === 'textarea';
  }

  function isContentEditable(element) {
    return element && element.getAttribute &&
      element.getAttribute('contenteditable') !== null &&
      element.getAttribute('contenteditable') !== 'false';
  }

  function clearInput(element) {
    try {
      element.focus();
    } catch (err) {
      /* ignore */
    }
    if (isTextarea(element)) {
      nativeInputValue(element, '');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // contenteditable (Quill and friends)
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (err) {
      element.innerHTML = '';
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  /**
   * Insert text into the prompt field.
   *
   * `document.execCommand('insertText')` is used first because it produces the
   * exact same input events a real user would trigger - that is what the
   * page's framework listens for.  The fallback sets the value directly and
   * dispatches an input event.
   */
  function insertText(element, text) {
    element.focus();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (err) {
      inserted = false;
    }

    if (!inserted) {
      if (isTextarea(element)) {
        nativeInputValue(element, text);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        element.textContent = text;
        element.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    }
  }

  function currentInputValue(element) {
    if (isTextarea(element)) return element.value || '';
    return element.innerText || element.textContent || '';
  }

  // ------------------------------------------------------------------
  // Submission
  // ------------------------------------------------------------------

  async function waitForSendButton(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const button = Dom.findSendButton(document, options(), state.surface);
      if (button && !button.disabled) return button;
      await sleep(POLL_INTERVAL_MS);
    }
    return null;
  }

  async function submitPrompt(prompt) {
    // The page may still be loading (for example right after the extension
    // reset the conversation) - give the prompt field a moment to appear.
    let input = Dom.findPromptInput(document, options(), state.surface);
    if (!input) {
      const deadline = Date.now() + PROMPT_INPUT_TIMEOUT_MS;
      while (!input && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        input = Dom.findPromptInput(document, options(), state.surface);
      }
    }
    if (!input) {
      return { ok: false, code: 'prompt_input_unavailable' };
    }

    clearInput(input);
    await sleep(60);
    insertText(input, prompt);
    await sleep(120);

    const button = await waitForSendButton(SEND_ENABLED_TIMEOUT_MS);
    if (button) {
      button.click();
      return { ok: true, method: 'click' };
    }

    // No usable send button - fall back to the Enter key, exactly like a user.
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keypress', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
    return { ok: true, method: 'enter' };
  }

  // ------------------------------------------------------------------
  // Answer waiting
  // ------------------------------------------------------------------

  function sendDelta(requestId, text, cumulative) {
    try {
      chrome.runtime.sendMessage({
        type: 'job_delta',
        request_id: requestId,
        payload: { text: text, cumulative: cumulative }
      }, () => void chrome.runtime.lastError);
    } catch (err) {
      log('delta failed', err);
    }
  }

  /**
   * Wait for the answer to finish and return its text.
   *
   * The completion signal is the combination of
   *   - no "Stop" button visible any more, and
   *   - the extracted text did not change for `STABLE_MS`.
   */
  async function waitForAnswer(requestId, baselineText, timeoutMs, prompt) {
    const deadline = Date.now() + timeoutMs;
    let lastText = baselineText || '';
    let lastChange = Date.now();
    let emittedUpTo = 0;

    while (Date.now() < deadline) {
      const extraction = Dom.extractAnswerText(document, options(), state.surface);
      const raw = extraction.text;
      // Google echoes the question into the answer container - remove it so
      // that only the answer is streamed and returned.
      const text = prompt ? Dom.stripEchoedPrompt(raw, prompt) : raw;

      if (text && text !== lastText) {
        lastText = text;
        lastChange = Date.now();

        if (text.length > emittedUpTo) {
          sendDelta(requestId, text.slice(emittedUpTo), text);
          emittedUpTo = text.length;
        }
      }

      const generating = Dom.isGenerating(document, options(), state.surface);
      const stableFor = Date.now() - lastChange;

      if (!generating && text && text.trim().length >= MIN_ANSWER_LENGTH &&
          text !== (baselineText || '') && stableFor >= STABLE_MS) {
        return { ok: true, text: text, durationMs: Date.now() - (deadline - timeoutMs) };
      }

      await sleep(POLL_INTERVAL_MS);
    }

    if (lastText && lastText !== (baselineText || '')) {
      // The answer exists but never became "stable" - return what we have.
      return { ok: true, text: lastText, durationMs: timeoutMs, partial: true };
    }
    return { ok: false, code: 'response_timeout' };
  }

  // ------------------------------------------------------------------
  // Status reporting
  // ------------------------------------------------------------------

  function collectStatus() {
    const url = currentUrl();
    const surface = Dom.detectSurface(url, document, options());
    const captcha = Dom.detectCaptcha(url, document);
    const loginState = Dom.detectLogin(document, options());
    const promptInput = Dom.findPromptInput(document, options(), surface);
    const container = Dom.findAnswerContainer(document, options(), surface);

    return {
      ai_mode_tab_open: !!surface,
      ai_mode_ready: !!surface && !!promptInput && !captcha,
      logged_in: loginState !== false,
      captcha_detected: captcha,
      page_url: url,
      surface: surface,
      tab_id: null,
      prompt_input_available: !!promptInput,
      answer_container_available: !!container,
      diagnostics: {
        hostname: Dom.hostnameOf(url),
        login_state: loginState === null ? 'unknown' : (loginState ? 'signed_in' : 'signed_out')
      }
    };
  }

  function reportStatus(force) {
    const status = collectStatus();
    const fingerprint = JSON.stringify([
      status.ai_mode_tab_open,
      status.ai_mode_ready,
      status.logged_in,
      status.captcha_detected,
      status.surface
    ]);
    if (!force && fingerprint === state.lastStatusFingerprint) return;
    state.lastStatusFingerprint = fingerprint;
    try {
      chrome.runtime.sendMessage({ type: 'page_status', payload: status }, () => void chrome.runtime.lastError);
    } catch (err) {
      log('status failed', err);
    }
  }

  // ------------------------------------------------------------------
  // Job execution
  // ------------------------------------------------------------------

  async function runPrompt(job) {
    const started = Date.now();
    const requestId = job.request_id;
    const prompt = String(job.prompt || '').trim();
    const timeoutMs = Number(job.timeout_ms) || 180000;

    if (!prompt) {
      return { ok: false, code: 'invalid_request', message: 'The prompt is empty.' };
    }

    const url = currentUrl();
    state.surface = Dom.detectSurface(url, document, options());

    if (!state.surface) {
      return {
        ok: false,
        code: 'ai_mode_tab_not_found',
        message: 'The current tab is not a Google AI Mode page.'
      };
    }

    if (Dom.detectCaptcha(url, document)) {
      return {
        ok: false,
        code: 'captcha_detected',
        message: 'Google is showing a CAPTCHA. Solve it manually and retry.'
      };
    }

    const loginState = Dom.detectLogin(document, options());
    if (loginState === false) {
      return {
        ok: false,
        code: 'login_required',
        message: 'Log in to your Google account in this tab and retry.'
      };
    }

    const baseline = Dom.extractAnswerText(document, options(), state.surface).text || '';

    const submission = await submitPrompt(prompt);
    if (!submission.ok) {
      return {
        ok: false,
        code: submission.code,
        message: submission.message || 'The prompt could not be submitted.'
      };
    }

    const answer = await waitForAnswer(requestId, baseline, timeoutMs, prompt);
    if (!answer.ok) {
      return {
        ok: false,
        code: answer.code,
        message: 'Google AI Mode did not return an answer in time.'
      };
    }

    // The answer was already stripped from the echoed prompt while waiting.
    const text = answer.text;
    if (!text || text.trim().length < MIN_ANSWER_LENGTH) {
      return {
        ok: false,
        code: 'empty_response',
        message: 'The answer container was empty.'
      };
    }

    reportStatus(true);
    return {
      ok: true,
      text: text,
      finish_reason: 'stop',
      duration_ms: Date.now() - started,
      source_url: currentUrl(),
      partial: !!answer.partial
    };
  }

  function diagnose() {
    const description = Dom.describePage(document, options());
    return {
      ok: true,
      text: JSON.stringify(description, null, 2),
      payload: description,
      source_url: currentUrl()
    };
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return undefined;

    if (message.type === 'run_prompt') {
      runPrompt(message)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({
          ok: false,
          code: 'internal_error',
          message: String((error && error.message) || error)
        }));
      return true; // keep the channel open for the async response
    }

    if (message.type === 'diagnose') {
      try {
        sendResponse(diagnose());
      } catch (error) {
        sendResponse({ ok: false, code: 'internal_error', message: String(error) });
      }
      return true;
    }

    if (message.type === 'get_status') {
      try {
        sendResponse({ ok: true, payload: collectStatus() });
      } catch (error) {
        sendResponse({ ok: false, code: 'internal_error', message: String(error) });
      }
      return true;
    }

    return undefined;
  });

  // Keep the background informed about page state changes.
  const observer = new MutationObserver(() => reportStatus(false));
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (err) {
    log('observer failed', err);
  }

  window.addEventListener('popstate', () => reportStatus(true));
  window.addEventListener('hashchange', () => reportStatus(true));

  reportStatus(true);
  log('content script ready', currentUrl());
})();
