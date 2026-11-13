import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackObserver, installNativeSeekObserver } from '../src/playback-session.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const document = new EventTarget(), lifetime = new AbortController();
  const h = { player: {}, timeMs: 1500, reads: 0, cancellations: 0, starts: 0, errors: [], owned: false };
  let finish;
  const scheduler = new ManifestActionScheduler({ enterReplacedOnSeek: true,
    actions: [{ id: 'scene', type: 'REPLACE', triggerMs: 1000, resumeMs: 10000, clipUrl: 'blob:fixture' }],
    executor: {
      async honorNativeSeek() {}, async cancelPreload() {}, async preloadLocal() {},
      executeLocal() { h.starts++; return new Promise(resolve => { finish = resolve; }); },
      async cancel() { h.cancellations++; finish?.(); }
    }
  });
  h.scheduler = scheduler;
  const observe = createPlaybackObserver({ getScheduler: () => h.scheduler, onError: e => h.errors.push(e) });
  const stop = installNativeSeekObserver({ document, signal: lifetime.signal,
    getPlayer: () => h.player, getScheduler: () => h.scheduler,
    readState: () => { h.reads++; if (h.readError) throw h.readError; return { currentTimeMs: h.timeMs, paused: false }; },
    isOwnedSeek: () => h.owned, observe, onError: e => h.errors.push(e) });
  const seek = target => {
    const event = new Event('seeking');
    // Model a captured bubbling media event on document.
    Object.defineProperty(event, 'target', { value: target });
    document.dispatchEvent(event);
  };
  return Object.assign(h, { seek, stop, lifetime });
}

test('a different video seeking cannot cancel an active replacement entry', async t => {
  const h = harness(); t.after(() => h.scheduler.cancelAll());
  h.seek(h.player); await turn();
  assert.equal(h.starts, 1);
  assert.equal(h.scheduler.snapshot().statuses.scene, 'running');
  const reads = h.reads;
  h.seek({ dataset: {} }); await turn();
  assert.equal(h.cancellations, 0);
  assert.equal(h.starts, 1);
  assert.equal(h.reads, reads, 'unrelated events do not even sample native time');
  assert.equal(h.scheduler.snapshot().statuses.scene, 'running');
});

test('a genuine second native seek still cancels and restarts entry, even at the same target', async t => {
  const h = harness(); t.after(() => h.scheduler.cancelAll());
  h.seek(h.player); await turn();
  h.seek(h.player); await turn();
  assert.ok(h.cancellations > 0);
  assert.equal(h.starts, 2);
  h.timeMs = 3000;
  h.seek(h.player); await turn();
  assert.equal(h.starts, 3);
  assert.equal(h.errors.length, 0);
});

test('current player identity, owned seeks, unarmed sessions and listener lifetime remain respected', async t => {
  const h = harness(), scheduler = h.scheduler; t.after(() => scheduler.cancelAll());
  const old = h.player; h.player = {};
  h.seek(old); await turn(); assert.equal(h.reads, 0);
  h.owned = true; h.seek(h.player); await turn(); assert.equal(h.starts, 0);
  h.owned = false; h.scheduler = null;
  h.seek(h.player); await turn(); assert.equal(h.reads, 1);
  h.scheduler = scheduler; h.player = null;
  h.seek(null); await turn(); assert.equal(h.reads, 1);
  h.player = {}; h.readError = new Error('lost native player');
  h.seek(h.player); assert.deepEqual(h.errors, [h.readError]);
  h.readError = null; h.lifetime.abort();
  h.seek(h.player); await turn(); assert.equal(h.starts, 0);
});

test('explicit observer teardown removes the capture listener', async t => {
  const h = harness(); t.after(() => h.scheduler.cancelAll());
  h.stop(); h.seek(h.player); await turn(); assert.equal(h.reads, 0);
});
