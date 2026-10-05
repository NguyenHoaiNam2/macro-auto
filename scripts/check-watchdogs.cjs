// Runnable check for the Phase 3 watchdog logic (native-automation.cjs).
// Usage: node scripts/check-watchdogs.cjs
const assert = require('node:assert');
const { captureSnippet, checkWatchdogs, findTemplateOnScreen } = require('../electron/native-automation.cjs');

const snippet = captureSnippet(200, 200, 60, 60);
const snippetB64 = snippet.pngBase64;
assert.ok(snippetB64 && snippetB64.length > 0, 'captureSnippet must return base64 PNG data');

const rule = {
  id: 'w1',
  name: 'Test_Popup_Modal',
  enabled: true,
  visualAnchor: {
    templateBase64: snippetB64,
    width: 60,
    height: 60,
    confidenceThreshold: 0.85,
  },
  action: 'PAUSE_AND_AWAIT_USER',
};

// 1. Active rule matching the current screen must trigger with its name.
const res1 = checkWatchdogs([rule]);
assert.strictEqual(res1.triggered, true, 'enabled matching watchdog must trigger');
assert.strictEqual(res1.watchdogName, 'Test_Popup_Modal', 'must report the watchdog name');

// 2. Disabled rules are ignored.
const res2 = checkWatchdogs([{ ...rule, enabled: false }]);
assert.strictEqual(res2.triggered, false, 'disabled watchdog must not trigger');

// 3. Empty / invalid input short-circuits.
assert.strictEqual(checkWatchdogs([]).triggered, false, 'empty list must not trigger');
assert.strictEqual(checkWatchdogs(undefined).triggered, false, 'undefined must not trigger');

// 4. Anchor self-match sanity (shared matcher used by smart-wait).
const anchor = {
  templateBase64: snippetB64,
  width: 60,
  height: 60,
  confidenceThreshold: 0.85,
};
const res4 = findTemplateOnScreen(anchor);
assert.strictEqual(res4.found, true, 'screen snippet must be found on screen');

console.log('check-watchdogs: all assertions passed');
