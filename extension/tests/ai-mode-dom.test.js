/**
 * DOM helper tests.
 *
 * The fixtures mirror the real Google AI Mode and Gemini markup that was
 * verified against the live pages.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadDomModule, buildDom, visibilityOptions } = require('./helpers');

const Dom = loadDomModule();

const AI_MODE_PAGE = `
  <div class="header">
    <a href="https://accounts.google.com/ServiceLogin">Sign in</a>
  </div>
  <textarea aria-label="Ask anything" placeholder="Ask anything" class="ITIRGe"></textarea>
  <textarea aria-label="Ask anything" placeholder="Ask anything" class="ITIRGe" data-hidden="true"></textarea>
  <button aria-label="Send" class="uMMzHc" disabled>Send</button>
  <button aria-label="Stop" class="uMMzHc" data-hidden="true">Stop</button>
`;

const AI_MODE_ANSWER_PAGE = `
  <textarea aria-label="Ask anything"></textarea>
  <button aria-label="Send"></button>
  <div class="CKgc1d" jsname="CS7uPe">
    <div>
      <div class="Zkbeff">
        <h3 class="iMqumd">AI Mode reply for Explain Python.</h3>
        <div class="pWvJNd">
          <div class="mZJni" jsname="KFl8ub">
            <div>Python is a popular, beginner-friendly programming language.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const GEMINI_PAGE = `
  <div role="textbox" contenteditable="true" aria-label="Enter a prompt for Gemini" class="ql-editor"></div>
  <button aria-label="Send message"></button>
`;

const GEMINI_ANSWER_PAGE = `
  <model-response>
    <div class="response-container">
      <div class="presented-response-container">
        <div class="response-container-content">
          <div class="response-content">
            <div class="model-response-label-announcer"><h6>Gemini said</h6></div>
            <model-response-content>
              <structured-content-container class="model-response-text">
                <div class="container">
                  <message-content>Python is a versatile, high-level language.</message-content>
                </div>
              </structured-content-container>
            </model-response-content>
          </div>
        </div>
      </div>
    </div>
  </model-response>
`;

const CAPTCHA_PAGE = `
  <form action="/sorry/index"><iframe src="https://www.google.com/recaptcha/api2"></iframe></form>
`;

// ----------------------------------------------------------------------
// Surface detection
// ----------------------------------------------------------------------
test('the AI Mode search surface is detected', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  const surface = Dom.detectSurface(
    'https://www.google.com/search?udm=50',
    document,
    visibilityOptions(document)
  );
  assert.equal(surface, 'search_ai_mode');
});

test('an AI Mode conversation URL is detected', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  const surface = Dom.detectSurface(
    'https://www.google.com/search?q=hello&udm=50&mstk=abc',
    document,
    visibilityOptions(document)
  );
  assert.equal(surface, 'search_ai_mode');
});

test('the Gemini surface is detected', () => {
  const { document } = buildDom(GEMINI_PAGE);
  const surface = Dom.detectSurface(
    'https://gemini.google.com/app',
    document,
    visibilityOptions(document)
  );
  assert.equal(surface, 'gemini');
});

test('an unrelated page is not detected', () => {
  const { document } = buildDom('<p>hello</p>');
  const surface = Dom.detectSurface(
    'https://example.com/',
    document,
    visibilityOptions(document)
  );
  assert.equal(surface, null);
});

// ----------------------------------------------------------------------
// Elements
// ----------------------------------------------------------------------
test('the visible prompt input is found on AI Mode', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  const input = Dom.findPromptInput(
    document,
    visibilityOptions(document),
    'search_ai_mode'
  );
  assert.ok(input);
  assert.equal(input.getAttribute('aria-label'), 'Ask anything');
  assert.equal(input.getAttribute('data-hidden'), null, 'the hidden duplicate must be skipped');
});

test('the prompt input is found on Gemini', () => {
  const { document } = buildDom(GEMINI_PAGE);
  const input = Dom.findPromptInput(document, visibilityOptions(document), 'gemini');
  assert.ok(input);
  assert.equal(input.getAttribute('contenteditable'), 'true');
});

test('the send button is found', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  const button = Dom.findSendButton(document, visibilityOptions(document), 'search_ai_mode');
  assert.ok(button);
  assert.equal(button.getAttribute('aria-label'), 'Send');
});

test('a missing prompt input returns null', () => {
  const { document } = buildDom('<p>nothing here</p>');
  assert.equal(
    Dom.findPromptInput(document, visibilityOptions(document), 'search_ai_mode'),
    null
  );
});

// ----------------------------------------------------------------------
// Login / captcha
// ----------------------------------------------------------------------
test('a signed out AI Mode page is detected', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  const state = Dom.detectLogin(document, visibilityOptions(document));
  assert.equal(state, false);
});

test('a signed in AI Mode page is detected', () => {
  const { document } = buildDom(
    '<img alt="Google Account" src="https://lh3.googleusercontent.com/a/default-user"><textarea aria-label="Ask anything"></textarea>'
  );
  const state = Dom.detectLogin(document, visibilityOptions(document));
  assert.equal(state, true);
});

test('an unknown login state is reported as unknown', () => {
  const { document } = buildDom('<textarea aria-label="Ask anything"></textarea>');
  const state = Dom.detectLogin(document, visibilityOptions(document));
  assert.equal(state, null);
});

test('a CAPTCHA page is detected', () => {
  const { document } = buildDom(CAPTCHA_PAGE);
  assert.equal(Dom.detectCaptcha('https://www.google.com/sorry/index', document), true);
});

test('a normal page is not a CAPTCHA', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  assert.equal(Dom.detectCaptcha('https://www.google.com/search?udm=50', document), false);
});

// ----------------------------------------------------------------------
// Answer extraction
// ----------------------------------------------------------------------
test('the AI Mode answer is extracted without the label', () => {
  const { document } = buildDom(AI_MODE_ANSWER_PAGE);
  const result = Dom.extractAnswerText(document, visibilityOptions(document), 'search_ai_mode');

  assert.equal(result.found, true);
  assert.equal(result.text, 'Python is a popular, beginner-friendly programming language.');
  assert.ok(!result.text.includes('AI Mode reply for'));
});

test('the Gemini answer is extracted without the attribution', () => {
  const { document } = buildDom(GEMINI_ANSWER_PAGE);
  const result = Dom.extractAnswerText(document, visibilityOptions(document), 'gemini');

  assert.equal(result.found, true);
  assert.equal(result.text, 'Python is a versatile, high-level language.');
  assert.ok(!result.text.includes('Gemini said'));
});

test('an empty page yields no answer', () => {
  const { document } = buildDom(AI_MODE_PAGE);
  const result = Dom.extractAnswerText(document, visibilityOptions(document), 'search_ai_mode');

  assert.equal(result.found, false);
  assert.equal(result.text, '');
});

test('an echoed prompt is removed from the answer', () => {
  const text = Dom.stripEchoedPrompt('Explain Python. Python is a language.', 'Explain Python.');
  assert.equal(text, 'Python is a language.');
});

test('the generation state is detected from the stop button', () => {
  const { document } = buildDom(`
    <textarea aria-label="Ask anything"></textarea>
    <button aria-label="Stop">Stop</button>
  `);
  assert.equal(
    Dom.isGenerating(document, visibilityOptions(document), 'search_ai_mode'),
    true
  );
});

test('a finished answer is not generating', () => {
  const { document } = buildDom(AI_MODE_ANSWER_PAGE);
  assert.equal(
    Dom.isGenerating(document, visibilityOptions(document), 'search_ai_mode'),
    false
  );
});

// ----------------------------------------------------------------------
// Diagnostics
// ----------------------------------------------------------------------
test('the page description reports what was found', () => {
  const { document } = buildDom(AI_MODE_ANSWER_PAGE);
  const description = Dom.describePage(document, {
    url: 'https://www.google.com/search?q=python&udm=50',
    isVisible: (element) => !!element
  });

  assert.equal(description.surface, 'search_ai_mode');
  assert.equal(description.promptInputFound, true);
  assert.equal(description.answerContainerFound, true);
  assert.ok(Array.isArray(description.candidates.answerContainer));
  assert.ok(description.candidates.answerContainer.length > 0);
});
