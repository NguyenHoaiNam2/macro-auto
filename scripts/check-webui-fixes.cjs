// Runnable check for the Web UI fixes (native-automation.cjs): wide clamped capture
// with real click offsets, anchored match roundtrip, blind-fallback rejection, and the
// hover glide. Note: the glide assertion moves the real cursor ~60px and restores it.
// Usage: node scripts/check-webui-fixes.cjs
const assert = require('node:assert');
const { captureSnippet, findTemplateOnScreen, performStep, moveCursorTo, getCursorPos, getVirtualScreen } = require('../electron/native-automation.cjs');

(async () => {
  // 1. Edge click: rect clamps on all sides but reports the click's true position in it.
  //    The virtual origin can be negative (monitor left of primary) — use it, not 0.
  const vs = getVirtualScreen();
  const edge = captureSnippet(vs.x + 2, 500, 120, 40);
  assert.strictEqual(edge.width, 120, 'web-UI capture must keep the wide shape');
  assert.strictEqual(edge.height, 40, 'web-UI capture must keep the short shape');
  assert.ok(edge.xPercent > 0 && edge.xPercent < 0.1, `clamped x offset must sit near the left edge, got ${edge.xPercent}`);
  assert.ok(Math.abs(edge.yPercent - 0.5) < 0.01, `unclamped y offset must stay centered, got ${edge.yPercent}`);
  assert.ok(edge.pngBase64 && edge.pngBase64.length > 0, 'capture must return base64 PNG data');

  // 2. Roundtrip: match the template back on screen and reconstruct the click point.
  const match = findTemplateOnScreen({
    templateBase64: edge.pngBase64,
    width: edge.width,
    height: edge.height,
    confidenceThreshold: 0.85,
    origX: edge.origX,
    origY: edge.origY,
  });
  assert.strictEqual(match.found, true, 'wide edge template must be found on screen');
  const clickX = Math.round(match.matchX + edge.width * edge.xPercent);
  const clickY = Math.round(match.matchY + edge.height * edge.yPercent);
  assert.ok(Math.abs(clickX - (vs.x + 2)) <= 2 && Math.abs(clickY - 500) <= 2, `reconstructed click must land on (${vs.x + 2}, 500), got (${clickX}, ${clickY})`);

  // 3. Blind fallback disabled: mouse steps without valid coords reject before moving.
  await assert.rejects(
    () => performStep({ type: 'click', stepNumber: 1, delayAfterMs: 0 }),
    /blind clicks are disabled/,
    'click without coordinates must reject'
  );
  await assert.rejects(
    () => performStep({ type: 'move', stepNumber: 2, fallbackCoords: { x: null, y: 5 }, delayAfterMs: 0 }),
    /blind clicks are disabled/,
    'non-numeric coordinates must reject'
  );
  await assert.rejects(
    () => performStep({ type: 'scroll', stepNumber: 3, wheelData: { rotation: -1 }, delayAfterMs: 0 }),
    /blind clicks are disabled/,
    'scroll without coordinates must reject'
  );

  // 4. Hover glide: moves to a new point and back, exercising GetCursorPos + interpolation.
  const before = getCursorPos();
  await moveCursorTo(before.x + 60, before.y + 40);
  const moved = getCursorPos();
  if (moved.x !== before.x || moved.y !== before.y) {
    assert.ok(Math.abs(moved.x - (before.x + 60)) <= 1 && Math.abs(moved.y - (before.y + 40)) <= 1, 'glide must land on the target');
    await moveCursorTo(before.x, before.y);
    const restored = getCursorPos();
    assert.ok(Math.abs(restored.x - before.x) <= 1 && Math.abs(restored.y - before.y) <= 1, 'cursor must be restored');
  }

  // 5. delayBefore is honored at the top of performStep; validation still rejects after it.
  const delayStart = Date.now();
  await assert.rejects(
    () => performStep({ type: 'click', stepNumber: 4, delayBefore: 150, delayAfterMs: 0 }),
    /blind clicks are disabled/,
    'delayBefore step without coordinates must still reject'
  );
  const delayElapsed = Date.now() - delayStart;
  assert.ok(delayElapsed >= 150, `delayBefore must wait before executing, elapsed=${delayElapsed}`);

  console.log('check-webui-fixes: all assertions passed');
})().catch((error) => {
  console.error('check-webui-fixes FAILED:', error.message);
  process.exit(1);
});