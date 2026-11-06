/**
 * Google AI Mode DOM layer.
 *
 * Everything that knows about the structure of the Google AI Mode / Gemini
 * pages lives in this file.  The selectors were verified against the live
 * pages and are kept in one table so they can be adjusted in a single place
 * when Google changes the layout.
 *
 * The module is deliberately free of any `chrome.*` API so that it can be
 * unit tested in Node (see `extension/tests/`).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AiModeDom = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Selector table for the supported surfaces.
   *
   * Every list is ordered from the most specific to the most generic selector
   * so that a layout change only requires adding a new entry at the top.
   */
  const SURFACES = {
    search_ai_mode: {
      id: 'search_ai_mode',
      label: 'Google AI Mode (Search)',
      hosts: ['www.google.com', 'google.com'],
      urlMarkers: ['udm=50'],
      promptInput: [
        'textarea[aria-label="Ask anything"]',
        'textarea[placeholder="Ask anything"]',
        'textarea[aria-label*="Ask anything"]',
        'textarea[aria-label^="Ask"]'
      ],
      sendButton: [
        'button[aria-label="Send"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]'
      ],
      stopButton: [
        'button[aria-label="Stop"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label*="Stop"]'
      ],
      answerContainer: [
        '[jsname="CS7uPe"]',
        'div.CKgc1d'
      ],
      answerProse: [
        '[jsname="CS7uPe"] [jsname="KFl8ub"] > div',
        '[jsname="CS7uPe"] [jsname="KFl8ub"]',
        '[jsname="CS7uPe"] .pWvJNd',
        '[jsname="CS7uPe"]'
      ],
      answerLabelPattern: /^AI Mode reply for/i,
      answerLabelInline: /AI Mode reply for[^\n]*/i
    },

    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      hosts: ['gemini.google.com'],
      urlMarkers: [],
      promptInput: [
        'div[role="textbox"][contenteditable="true"]',
        'rich-textarea .ql-editor[contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        'textarea[aria-label*="prompt" i]',
        'textarea[aria-label*="Enter a prompt"]'
      ],
      sendButton: [
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]'
      ],
      stopButton: [
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop"]',
        'button[aria-label*="Stop"]'
      ],
      answerContainer: [
        'model-response',
        'model-response-content',
        '[class*="response-container"]'
      ],
      answerProse: [
        'model-response message-content',
        'model-response .response-content message-content',
        'model-response-content message-content',
        'model-response .response-content',
        'model-response'
      ],
      answerLabelPattern: /^Gemini said$/i,
      answerLabelInline: /Gemini said/i
    }
  };

  /** Ordered list of surfaces used by {@link detectSurface}. */
  const SURFACE_ORDER = ['search_ai_mode', 'gemini'];

  const CAPTCHA_SELECTORS = [
    'form[action*="sorry"]',
    '#captcha-form',
    'div#recaptcha',
    'iframe[src*="recaptcha"]',
    'iframe[title*="recaptcha" i]',
    '[data-captcha]'
  ];

  const CAPTCHA_TEXT = [
    'our systems have detected unusual traffic',
    'unusual traffic from your computer network',
    "confirm you're not a robot",
    'i am not a robot'
  ];

  const SIGNED_OUT_SELECTORS = [
    'button[aria-label="Sign in"]',
    'a[aria-label="Sign in"]',
    'a[href*="accounts.google.com/ServiceLogin"]',
    'a[href*="accounts.google.com/Logout"]'
  ];

  const SIGNED_IN_SELECTORS = [
    'img[alt*="Google Account" i]',
    'a[aria-label*="Google Account" i]',
    'a[aria-label*="Your profile" i]',
    '.sidenav-mavatar-footer',
    '[jsname="gwtfbb"] img[src*="googleusercontent.com"]',
    'button[aria-label*="Google Account" i]'
  ];

  /** A Google sign-in form means the session is not authenticated. */
  const SIGN_IN_FORM_SELECTORS = [
    'form[action*="accounts.google.com/ServiceLogin"]',
    'input[type="password"][name*="Pass"]',
    'input[type="password"][autocomplete="current-password"]'
  ];

  const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figcaption',
    'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
    'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul'
  ]);

  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg']);

  // ------------------------------------------------------------------
  // Generic helpers
  // ------------------------------------------------------------------

  function defaultIsVisible(element) {
    if (!element) return false;
    if (typeof element.getClientRects === 'function') {
      try {
        if (element.getClientRects().length === 0) return false;
      } catch (err) {
        /* ignore - detached node */
      }
    }
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      try {
        const style = view.getComputedStyle(element);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
          return false;
        }
      } catch (err) {
        /* ignore */
      }
    }
    return true;
  }

  function isVisible(element, options) {
    const checker = (options && options.isVisible) || defaultIsVisible;
    try {
      return !!checker(element);
    } catch (err) {
      return false;
    }
  }

  /**
   * Query the first element matching any selector.
   *
   * Visible elements win.  When `options.visibleOnly` is set, hidden
   * elements are ignored completely - this matters for the "Stop" button,
   * which Google keeps in the DOM after the answer is finished.
   */
  function queryFirst(root, selectors, options) {
    if (!root || typeof root.querySelector !== 'function') return null;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const visibleOnly = !!(options && options.visibleOnly);
    let fallback = null;
    for (const selector of list) {
      let found;
      try {
        found = root.querySelector(selector);
      } catch (err) {
        continue;
      }
      if (!found) continue;
      if (isVisible(found, options)) return found;
      if (!fallback && !visibleOnly) fallback = found;
    }
    return fallback;
  }

  /** Query every element matching any selector (de-duplicated). */
  function queryAll(root, selectors, options) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const result = [];
    for (const selector of list) {
      let found;
      try {
        found = Array.from(root.querySelectorAll(selector));
      } catch (err) {
        continue;
      }
      for (const element of found) {
        if (result.indexOf(element) === -1 && isVisible(element, options)) {
          result.push(element);
        }
      }
    }
    return result;
  }

  function normalizeText(text) {
    if (!text) return '';
    return String(text)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
      .join('\n')
      .trim();
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (err) {
      return '';
    }
  }

  function searchParams(url) {
    try {
      return new URL(url).searchParams;
    } catch (err) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Surface detection
  // ------------------------------------------------------------------

  /**
   * Detect which AI surface the given page is.
   *
   * @returns {string|null} the surface id or null when the page is not supported
   */
  function detectSurface(url, doc, options) {
    const host = hostnameOf(url);
    if (!host) return null;

    for (const surfaceId of SURFACE_ORDER) {
      const surface = SURFACES[surfaceId];
      if (surface.hosts.indexOf(host) === -1 && !host.endsWith('.' + surface.hosts[0])) {
        continue;
      }

      const params = searchParams(url);
      const markerHit = surface.urlMarkers.some((marker) => {
        if (params) {
          for (const [, value] of params.entries()) {
            if (value === marker) return true;
          }
        }
        return String(url).indexOf(marker) !== -1;
      });

      if (markerHit) return surfaceId;

      // Fall back to a DOM check: the prompt input only exists on the
      // supported surfaces.
      if (doc && findPromptInput(doc, options, surfaceId)) {
        return surfaceId;
      }
    }
    return null;
  }

  function surfaceConfig(surfaceId) {
    return SURFACES[surfaceId] || null;
  }

  // ------------------------------------------------------------------
  // Element lookups
  // ------------------------------------------------------------------

  function findPromptInput(doc, options, surfaceId) {
    const surface = surfaceConfig(surfaceId || detectSurface(options && options.url, doc, options));
    if (!surface) return null;
    return queryFirst(doc, surface.promptInput, options);
  }

  function findSendButton(doc, options, surfaceId) {
    const surface = surfaceConfig(surfaceId || detectSurface(options && options.url, doc, options));
    if (!surface) return null;
    return queryFirst(doc, surface.sendButton, options);
  }

  function findStopButton(doc, options, surfaceId) {
    const surface = surfaceConfig(surfaceId || detectSurface(options && options.url, doc, options));
    if (!surface) return null;
    // Only a *visible* stop button means the model is still generating -
    // Google keeps the button in the DOM after the answer is finished.
    return queryFirst(doc, surface.stopButton, { ...(options || {}), visibleOnly: true });
  }

  function findAnswerContainer(doc, options, surfaceId) {
    const surface = surfaceConfig(surfaceId || detectSurface(options && options.url, doc, options));
    if (!surface) return null;
    return queryFirst(doc, surface.answerContainer, options);
  }

  function findAnswerProse(doc, options, surfaceId) {
    const surface = surfaceConfig(surfaceId || detectSurface(options && options.url, doc, options));
    if (!surface) return null;
    return queryFirst(doc, surface.answerProse, options);
  }

  // ------------------------------------------------------------------
  // State detection
  // ------------------------------------------------------------------

  /** True when Google shows a CAPTCHA / unusual traffic page. */
  function detectCaptcha(url, doc) {
    const href = String(url || '');
    if (href.indexOf('/sorry/') !== -1) return true;
    if (doc) {
      if (queryFirst(doc, CAPTCHA_SELECTORS, { visibleOnly: true })) return true;
      const bodyText = (doc.body && doc.body.innerText) || '';
      const lowered = String(bodyText).toLowerCase();
      if (CAPTCHA_TEXT.some((needle) => lowered.indexOf(needle) !== -1)) return true;
    }
    return false;
  }

  /**
   * Detect the Google login state.
   *
   * Only *visible* elements are considered: Google keeps hidden sign-in
   * widgets in the DOM even for authenticated sessions.
   *
   * @returns {boolean|null} true = signed in, false = signed out, null = unknown
   */
  function detectLogin(doc, options) {
    if (!doc) return null;
    const visible = { ...(options || {}), visibleOnly: true };

    if (queryFirst(doc, SIGNED_OUT_SELECTORS, visible)) return false;
    if (queryFirst(doc, SIGN_IN_FORM_SELECTORS, visible)) return false;
    if (queryFirst(doc, SIGNED_IN_SELECTORS, visible)) return true;
    return null;
  }

  /** True while the model is still generating an answer. */
  function isGenerating(doc, options, surfaceId) {
    if (findStopButton(doc, options, surfaceId)) return true;
    if (!doc) return false;

    const visible = { ...(options || {}), visibleOnly: true };

    // Gemini marks a finished response with `complete` on the footer.
    const footer = queryFirst(doc, ['.response-footer.complete', '.response-footer.gap.complete'], visible);
    if (footer) return false;

    const spinner = queryFirst(doc, [
      '.response-container-header-processing-state:not(:empty)',
      'mat-progress-spinner',
      '[aria-busy="true"]'
    ], visible);
    return !!spinner;
  }

  // ------------------------------------------------------------------
  // Text extraction
  // ------------------------------------------------------------------

  /** Read the rendered text of an element. */
  function readText(element) {
    if (!element) return '';
    if (typeof element.innerText === 'string' && element.innerText.length) {
      return element.innerText;
    }
    if (typeof element.textContent === 'string') return element.textContent;
    return '';
  }

  /**
   * Extract the answer text from the page.
   *
   * @returns {{text: string, found: boolean, source: string}}
   */
  function extractAnswerText(doc, options, surfaceId) {
    const surface = surfaceConfig(surfaceId || detectSurface(options && options.url, doc, options));
    if (!surface || !doc) return { text: '', found: false, source: 'none' };

    const prose = findAnswerProse(doc, options, surface.id);
    if (prose) {
      const text = normalizeText(readText(prose));
      if (text) {
        return { text: stripLabel(text, surface), found: true, source: 'prose' };
      }
    }

    const container = findAnswerContainer(doc, options, surface.id);
    if (container) {
      const text = normalizeText(readText(container));
      if (text) {
        return { text: stripLabel(text, surface), found: true, source: 'container' };
      }
    }
    return { text: '', found: false, source: 'none' };
  }

  /** Remove the accessible label ("AI Mode reply for ...") from the text. */
  function stripLabel(text, surface) {
    if (!text) return '';
    const pattern = surface && surface.answerLabelPattern;
    if (!pattern) return text;

    const lines = text.split('\n');
    const kept = lines.filter((line) => !pattern.test(line.trim()));
    if (kept.length !== lines.length) {
      return kept.join('\n').trim();
    }
    // The label may be inline - remove exactly that label and nothing else.
    const inline = surface.answerLabelInline;
    if (inline) return text.replace(inline, '').trim();
    return text;
  }

  /**
   * Remove the prompt that was echoed back by the page (if any).
   *
   * Google sometimes repeats the question inside the answer container, so
   * every leading repetition is removed.
   */
  function stripEchoedPrompt(text, prompt) {
    if (!text || !prompt) return text || '';
    const trimmedPrompt = String(prompt).trim();
    if (!trimmedPrompt) return text;

    let value = String(text);
    let previous = null;
    while (value !== previous) {
      previous = value;
      if (value.indexOf(trimmedPrompt) === 0) {
        value = value.slice(trimmedPrompt.length);
      }
      value = value.replace(/^\s+/, '');
    }
    return value.trim();
  }

  // ------------------------------------------------------------------
  // Diagnostics
  // ------------------------------------------------------------------

  /** Collect information about the live page - used by the diagnose command. */
  function describePage(doc, options) {
    const url = (options && options.url) || (doc && doc.location && doc.location.href) || '';
    const surfaceId = detectSurface(url, doc, options);
    const surface = surfaceConfig(surfaceId);
    const promptInput = findPromptInput(doc, options, surfaceId);
    const sendButton = findSendButton(doc, options, surfaceId);
    const container = findAnswerContainer(doc, options, surfaceId);

    return {
      url,
      surface: surfaceId,
      surfaceLabel: surface ? surface.label : null,
      hostname: hostnameOf(url),
      captcha: detectCaptcha(url, doc),
      loggedIn: detectLogin(doc, options),
      promptInputFound: !!promptInput,
      promptInputTag: promptInput ? promptInput.tagName.toLowerCase() : null,
      promptInputAriaLabel: promptInput ? promptInput.getAttribute('aria-label') : null,
      sendButtonFound: !!sendButton,
      sendButtonDisabled: sendButton ? !!sendButton.disabled : null,
      answerContainerFound: !!container,
      answerContainerClass: container ? String(container.className || '').slice(0, 120) : null,
      generating: isGenerating(doc, options, surfaceId),
      candidates: {
        promptInput: surface ? surface.promptInput : [],
        sendButton: surface ? surface.sendButton : [],
        answerContainer: surface ? surface.answerContainer : [],
        answerProse: surface ? surface.answerProse : []
      }
    };
  }

  return {
    SURFACES,
    SURFACE_ORDER,
    normalizeText,
    hostnameOf,
    isVisible,
    queryFirst,
    queryAll,
    detectSurface,
    surfaceConfig,
    findPromptInput,
    findSendButton,
    findStopButton,
    findAnswerContainer,
    findAnswerProse,
    detectCaptcha,
    detectLogin,
    isGenerating,
    readText,
    extractAnswerText,
    stripLabel,
    stripEchoedPrompt,
    describePage,
    BLOCK_TAGS,
    SKIP_TAGS
  };
});
