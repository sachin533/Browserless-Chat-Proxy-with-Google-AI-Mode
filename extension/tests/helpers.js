/**
 * Shared helpers for the extension test suite.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const EXTENSION_ROOT = path.resolve(__dirname, '..');

/** Load the DOM helper module (UMD style). */
function loadDomModule() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(EXTENSION_ROOT, 'lib', 'ai-mode-dom.js'));
}

/** Load the configuration module. */
function loadConfigModule() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(EXTENSION_ROOT, 'lib', 'config.js'));
}

/** Load the protocol module. */
function loadProtocolModule() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(EXTENSION_ROOT, 'lib', 'protocol.js'));
}

/** Build a document from an HTML string. */
function buildDom(html) {
  const { document, window } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return { document, window };
}

/**
 * linkedom has no layout engine, therefore nothing is "visible".
 * The helper below marks elements as visible unless they carry the
 * `data-hidden` attribute, which the fixtures use to model hidden duplicates.
 */
function visibilityOptions(document) {
  return {
    isVisible: (element) => {
      if (!element) return false;
      if (element.getAttribute && element.getAttribute('data-hidden') === 'true') return false;
      return true;
    },
    url: (document && document.location && document.location.href) || ''
  };
}

/** Read a file relative to the extension root. */
function readExtensionFile(relativePath) {
  return fs.readFileSync(path.join(EXTENSION_ROOT, relativePath), 'utf8');
}

/** Resolve a path relative to the extension root. */
function resolveExtensionPath(relativePath) {
  return path.join(EXTENSION_ROOT, relativePath);
}

module.exports = {
  EXTENSION_ROOT,
  loadDomModule,
  loadConfigModule,
  loadProtocolModule,
  buildDom,
  visibilityOptions,
  readExtensionFile,
  resolveExtensionPath
};
