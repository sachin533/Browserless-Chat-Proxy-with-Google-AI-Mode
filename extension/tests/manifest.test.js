/**
 * Manifest validation tests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EXTENSION_ROOT } = require('./helpers');

const manifest = JSON.parse(
  fs.readFileSync(path.join(EXTENSION_ROOT, 'manifest.json'), 'utf8')
);

test('the manifest declares Manifest V3', () => {
  assert.equal(manifest.manifest_version, 3);
});

test('the manifest has the required metadata', () => {
  assert.ok(manifest.name);
  assert.ok(manifest.version);
  assert.ok(manifest.description);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('the background service worker is declared', () => {
  assert.ok(manifest.background);
  assert.equal(manifest.background.service_worker, 'background.js');
});

test('the content scripts are declared for Google only', () => {
  assert.ok(Array.isArray(manifest.content_scripts));
  assert.ok(manifest.content_scripts.length > 0);
  for (const entry of manifest.content_scripts) {
    assert.ok(Array.isArray(entry.js));
    for (const match of entry.matches) {
      assert.match(match, /google\.com/);
    }
  }
});

test('the content script files exist', () => {
  for (const entry of manifest.content_scripts) {
    for (const file of entry.js) {
      const target = path.join(EXTENSION_ROOT, file);
      assert.ok(fs.existsSync(target), `${file} is missing`);
    }
  }
});

test('the popup and the background worker exist', () => {
  assert.ok(fs.existsSync(path.join(EXTENSION_ROOT, 'background.js')));
  assert.ok(fs.existsSync(path.join(EXTENSION_ROOT, 'popup.html')));
  assert.ok(fs.existsSync(path.join(EXTENSION_ROOT, 'popup.css')));
  assert.ok(fs.existsSync(path.join(EXTENSION_ROOT, 'popup.js')));
  assert.ok(fs.existsSync(path.join(EXTENSION_ROOT, 'content.js')));
});

test('the action popup is registered', () => {
  assert.ok(manifest.action);
  assert.equal(manifest.action.default_popup, 'popup.html');
});

test('the permissions are limited to what is required', () => {
  const allowed = new Set(['storage', 'scripting', 'alarms']);
  for (const permission of manifest.permissions || []) {
    assert.ok(allowed.has(permission), `unexpected permission: ${permission}`);
  }
  assert.ok(!manifest.permissions.includes('tabs'), 'the tabs permission is not needed');
  assert.ok(!manifest.permissions.includes('webRequest'), 'webRequest is not needed');
  assert.ok(!manifest.permissions.includes('<all_urls>'), 'no blanket host access');
});

test('the host permissions are limited to Google', () => {
  for (const origin of manifest.host_permissions || []) {
    assert.match(origin, /google\.com/);
  }
});

test('the backend origin is requested optionally, not up front', () => {
  assert.ok(Array.isArray(manifest.optional_host_permissions));
  assert.ok(
    manifest.optional_host_permissions.some((origin) => origin.includes('http')),
    'the backend origin must be requestable at runtime'
  );
});

test('the icons exist', () => {
  const icons = manifest.icons || {};
  assert.ok(Object.keys(icons).length >= 2);
  for (const file of Object.values(icons)) {
    const target = path.join(EXTENSION_ROOT, file);
    assert.ok(fs.existsSync(target), `${file} is missing`);
    const header = fs.readFileSync(target).subarray(0, 8);
    assert.deepEqual(
      Array.from(header),
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${file} is not a PNG`
    );
  }
});

test('the manifest does not contain a hard coded secret', () => {
  const raw = JSON.stringify(manifest);
  assert.ok(!/token"\s*:\s*"[A-Za-z0-9_-]{16,}/.test(raw));
  assert.ok(!/api[_-]?key/i.test(raw));
});
