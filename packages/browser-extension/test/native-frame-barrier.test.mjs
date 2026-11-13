import test from 'node:test';
import assert from 'node:assert/strict';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const videoFrames = new Map(), animationFrames = new Map(); let id = 0, removed = 0;
  const player = { muted: false, paused: false, currentTime: 5,
    requestVideoFrameCallback(callback) { videoFrames.set(++id, callback); return id; },
    cancelVideoFrameCallback(handle) { videoFrames.delete(handle); } };
  const view = { requestAnimationFrame(callback) { animationFrames.set(++id, callback); return id; },
    cancelAnimationFrame(handle) { animationFrames.delete(handle); } };
  const adapter = new StandardTransitionAdapter({ document: { defaultView: view }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: 5000, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; } } });
  adapter.overlayHost = { remove() { removed++; } };
  const invoke = (queue, timestamp) => {
    // Match the rendering algorithm's snapshot of each callback map. rVFC
    // comes first; an rAF scheduled there is eligible in this same update.
    for (const handle of [...queue.keys()]) {
      const callback = queue.get(handle); if (!callback) continue; queue.delete(handle); callback(timestamp, {});
    }
  };
  return { player, view, adapter, videoFrames, animationFrames, get removed() { return removed; },
    render(timestamp) { invoke(videoFrames, timestamp); invoke(animationFrames, timestamp); },
    async start(signal) {
      const snapshot = await adapter.snapshot(); await adapter.pause(); await adapter.setMuted(true);
      const restoring = adapter.restore(snapshot, { targetTimeMs: 5000, resumePlayback: true, awaitPresentedFrame: true, signal });
      restoring.catch(() => {}); await turn(); return { snapshot, restoring };
    } };
}

test('a same-update animation callback cannot uncover before an additional rendering opportunity', async () => {
  const h = harness(), { restoring } = await h.start();
  try {
    h.render(100); await turn();
    assert.equal(h.removed, 0); assert.equal(h.player.muted, true); assert.equal(h.animationFrames.size, 1);
    h.render(116); const receipt = await restoring;
    assert.equal(receipt.presentation, 'presented'); assert.equal(h.removed, 1); assert.equal(h.player.muted, false);
    assert.equal(h.videoFrames.size, 0); assert.equal(h.animationFrames.size, 0);
  } finally { h.render(132); await restoring.catch(() => {}); }
});

test('abort between rendering opportunities cancels the pending second callback and ignores late delivery', async () => {
  const h = harness(), controller = new AbortController(), { restoring } = await h.start(controller.signal);
  h.render(100); const late = [...h.animationFrames.values()][0];
  assert.equal(typeof late, 'function'); controller.abort();
  await assert.rejects(restoring, { name: 'AbortError' }); assert.equal(h.animationFrames.size, 0);
  const removed = h.removed; late(116); await turn(); assert.equal(h.removed, removed); assert.equal(h.animationFrames.size, 0);
});

test('the existing presentation deadline covers both frame and compositor stages without resetting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const h = harness(), { restoring } = await h.start();
  t.mock.timers.tick(1000); h.render(1000); await turn();
  assert.equal(h.removed, 0); t.mock.timers.tick(501);
  assert.equal((await restoring).presentation, 'frame-timeout');
  assert.equal(h.animationFrames.size, 0); assert.equal(h.removed, 1); assert.equal(h.player.muted, false);
});

for (const stage of ['first-animation', 'second-animation', 'paused-video-reregistration']) test(`${stage} registration failure settles the barrier and cleans up`, async () => {
  const h = harness(), { restoring } = await h.start();
  if (stage === 'paused-video-reregistration') {
    h.player.paused = true; h.player.requestVideoFrameCallback = () => { throw Error('fixture registration failure'); };
  } else {
    let calls = 0;
    // The adapter already bound the view method, so inject through its shared
    // queue's insertion, which the bound method still calls.
    const set = h.animationFrames.set.bind(h.animationFrames);
    h.animationFrames.set = (id, callback) => {
      if (++calls === (stage === 'first-animation' ? 1 : 2)) throw Error('fixture registration failure');
      return set(id, callback);
    };
  }
  try {
    assert.doesNotThrow(() => h.render(100));
    await assert.rejects(restoring, /fixture registration failure/);
    assert.equal(h.videoFrames.size, 0); assert.equal(h.animationFrames.size, 0); assert.equal(h.removed, 1);
  } finally { await restoring.catch(() => {}); }
});
