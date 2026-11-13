import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preferences, preferenceChange, VIEWER_DEFAULTS } from '../src/viewer-model.mjs';
import { validLocalResult } from '../src/local-message-schema.mjs';
import { playbackQuality, longFrameLog, relativeLongFrames } from '../src/exit-diagnostics.mjs';

// E72 (0.64.3): the Exit reveal setting and the exit diagnostics (F3).

// 0.65.7 (X1): the default is now 'precise'; 'new' (the 0.65.6 default) stays selectable for the A/B.
test('Exit reveal is a setting: precise by default, new and previous for A/B captures, nothing else', async () => {
  assert.equal(VIEWER_DEFAULTS.exitReveal, 'precise');
  assert.equal(preferences({}).exitReveal, 'precise');
  assert.equal(preferenceChange(preferences({}), { exitReveal: 'previous' }).exitReveal, 'previous');
  assert.equal(preferenceChange(preferences({}), { exitReveal: 'new' }).exitReveal, 'new');
  assert.equal(preferences({ exitReveal: 'new' }).exitReveal, 'new', 'a stored 0.65.6 choice is kept');
  assert.equal(preferences({ exitReveal: 'later' }).exitReveal, 'precise', 'an invalid stored value falls back to the default');
  assert.throws(() => preferenceChange(preferences({}), { exitReveal: 'later' }), /viewer-preference-invalid/);
  const html = await readFile(new URL('../viewer-settings.html', import.meta.url), 'utf8');
  // 0.66.0: the default is listed first, and the copy names no version numbers.
  assert.match(html, /data-preference="exitReveal"[^>]*><option value="precise">Precise \(recommended\)[^<]*<\/option><option value="new">New[^<]*<\/option><option value="previous">Previous/);
  const exitCopy = html.slice(html.indexOf('data-preference="exitReveal"'), html.indexOf('data-preference="shortGapPriming"'));
  assert.doesNotMatch(exitCopy, /\d+\.\d+\.\d+/);
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /setExitRevealPolicy\(p\.exitReveal\)/);
  assert.match(main, /setSyncPatch\(p\.timing===true\)/);
});

test('the renderer may add its end-of-clip diagnostics to the play result, and only in shape', () => {
  const play = { durationMs: 3000, localTimeAtEndMs: 3000, unplayedTailMs: 0, frameHoldMode: 'local-canvas-audio-to-ended', heldFrameMediaTimeMs: 2958, localEnded: true };
  const ok = value => validLocalResult({ type: 'result', id: 1, ok: true, value }, 'play');
  assert.equal(ok(play), true);
  assert.equal(ok({ ...play, exitDiag: { quality: [0, 72], longFrames: [[-120.5, 111.2, 40], [-5, 60, null]] } }), true);
  assert.equal(ok({ ...play, exitDiag: { quality: null, longFrames: [] } }), true);
  assert.equal(ok({ ...play, exitDiag: { quality: [0, 72] } }), false, 'both keys');
  assert.equal(ok({ ...play, exitDiag: { quality: [-1, 72], longFrames: [] } }), false);
  assert.equal(ok({ ...play, exitDiag: { quality: null, longFrames: [[0, 1]] } }), false);
  assert.equal(ok({ ...play, exitDiag: { quality: null, longFrames: Array(17).fill([0, 50, null]) } }), false, 'at most 16');
});

test('exit diagnostics observe only: playback quality and the long-animation-frame log', () => {
  assert.deepEqual(playbackQuality({ getVideoPlaybackQuality: () => ({ droppedVideoFrames: 2, totalVideoFrames: 190 }) }), [2, 190]);
  assert.equal(playbackQuality({}), null);
  assert.equal(longFrameLog({}), null, 'no PerformanceObserver: no log');
  let deliver = null, pending = [];
  class Observer {
    static supportedEntryTypes = ['long-animation-frame'];
    constructor(callback) { deliver = callback; }
    observe(options) { assert.deepEqual(options, { type: 'long-animation-frame', buffered: true }); }
    takeRecords() { const out = pending; pending = []; return out; }
    disconnect() {}
  }
  const log = longFrameLog({ PerformanceObserver: Observer });
  deliver({ getEntries: () => [{ startTime: 1000, duration: 120, blockingDuration: 70 }, { startTime: 5000, duration: 60 }] });
  pending = [{ startTime: 1300, duration: 80, blockingDuration: 30 }]; // not yet delivered: flushed by between()
  assert.deepEqual(log.between(900, 1400), [[1000, 120, 70], [1300, 80, 30]]);
  assert.deepEqual(relativeLongFrames(log.between(900, 1400), 1100), [[-100, 120, 70], [200, 80, 30]]);
  assert.deepEqual(log.between(4000, 6000), [[5000, 60, null]]);
});
