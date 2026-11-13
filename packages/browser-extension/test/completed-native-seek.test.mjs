import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';

async function harness({ confirmed = true, clamped = false } = {}) {
  const player = Object.assign(new EventTarget(), { currentTime: 1, paused: false, seeking: false, readyState: 4,
    src: 'blob:source-a', currentSrc: 'blob:source-a', srcObject: null, muted: false, isConnected: true });
  let seeks = 0;
  const state = () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, readyState: player.readyState });
  const commands = { readState: state, pause: async () => { player.paused = true; }, play: async () => { player.paused = false; player.dispatchEvent(new Event('play')); },
    seekToWithPlaybackWarmup: async target => {
      seeks++; player.currentTime = (target + 4) / 1000; player.paused = true; player.seeking = false; player.readyState = 4;
      return { confirmed, targetMs: clamped ? target - 250 : target, errorMs: 4, toleranceMs: 250, after: state() };
    } };
  const adapter = new StandardTransitionAdapter({ document: {}, passiveAdapter: { activePlayer: () => player }, commandAdapter: commands });
  const snapshot = await adapter.snapshot(); await adapter.pause(); await adapter.seek(5000);
  return { player, adapter, snapshot, commands, seeks: () => seeks,
    restore: (options = {}) => adapter.restore(snapshot, { targetTimeMs: 5000, awaitPresentedFrame: true, ...options }) };
}

test('presentation restoration reuses an unchanged confirmed seek and preserves actual timing', async () => {
  const h = await harness(); const result = await h.restore();
  assert.equal(h.seeks(), 1); assert.equal(h.player.paused, false); assert.equal(result.errorMs, 4);
  for (const name of ['seeking', 'play', 'timeupdate', 'emptied', 'loadstart', 'waiting']) assert.equal(getEventListeners(h.player, name).length, 0);
});

for (const event of ['seeking', 'play', 'timeupdate', 'waiting', 'stalled', 'durationchange', 'ratechange']) {
  test(`intervening ${event} invalidates the receipt even if position later returns`, async () => {
    const h = await harness(); const time = h.player.currentTime;
    if (event === 'timeupdate') h.player.currentTime += .02;
    h.player.dispatchEvent(new Event(event)); h.player.currentTime = time;
    await h.restore(); assert.equal(h.seeks(), 2);
  });
}

for (const field of ['currentTime', 'readyState']) {
  test(`changed ${field} cannot reuse a completed seek without an event`, async () => {
    const h = await harness(); h.player[field] = field === 'currentTime' ? 5.02 : 1;
    await h.restore(); assert.equal(h.seeks(), 2);
  });
}

test('unchanged timeupdate does not discard a paused confirmed position', async () => {
  const h = await harness(); h.player.dispatchEvent(new Event('timeupdate')); await h.restore(); assert.equal(h.seeks(), 1);
});

test('unconfirmed and clamped results cannot bypass the restoration seek', async () => {
  for (const options of [{ confirmed: false }, { clamped: true }]) { const h = await harness(options); await h.restore(); assert.equal(h.seeks(), 2); }
});

test('recovery and different target keep the existing seek path', async () => {
  for (const options of [{ awaitPresentedFrame: false }, { targetTimeMs: 6000 }]) { const h = await harness(); await h.restore(options); assert.equal(h.seeks(), 2); }
});

test('source invalidation and aborted restoration cannot use the old receipt', async () => {
  const h = await harness(); h.player.dispatchEvent(new Event('emptied'));
  assert.equal(h.adapter.completedSeek, null); await h.adapter.forceSafeNativeState(h.snapshot); assert.equal(h.player.paused, true);
  const next = await harness(); const c = new AbortController(); c.abort();
  await assert.rejects(next.restore({ signal: c.signal }), { name: 'AbortError' });
  await next.adapter.forceSafeNativeState(next.snapshot); assert.equal(next.adapter.completedSeek, null);
});

test('a new snapshot cannot reuse the previous completed seek', async () => {
  const h = await harness(); await h.adapter.forceSafeNativeState(h.snapshot);
  const next = await h.adapter.snapshot(); await h.adapter.pause();
  await h.adapter.restore(next, { targetTimeMs: 5000, awaitPresentedFrame: true }); assert.equal(h.seeks(), 2);
});

test('confirmed paused seek reuse never reads media URLs or source objects', async () => {
  const h = await harness();
  for (const key of ['src', 'currentSrc', 'srcObject']) Object.defineProperty(h.player, key, { get() { throw Error('forbidden media source read'); } });
  await h.adapter.seek(6000); await h.restore({ targetTimeMs: 6000 }); assert.equal(h.seeks(), 2);
});

test('an older delayed state read cannot command over a newer completed seek', async () => {
  const h = await harness(); const read = h.commands.readState; let release;
  h.commands.readState = () => { h.commands.readState = read; return new Promise(resolve => { release = resolve; }); };
  const old = h.adapter.seek(6000); const rejected = assert.rejects(old, { name: 'AbortError' });
  await h.adapter.seek(7000); release(read()); await rejected;
  assert.equal(h.seeks(), 2); assert.equal(h.player.currentTime, 7.004);
  await h.restore({ targetTimeMs: 7000 }); assert.equal(h.seeks(), 2);
});
