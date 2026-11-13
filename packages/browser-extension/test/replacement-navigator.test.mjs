import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReplacementNavigationItems,
  formatProgramTime,
  normalizePrerollMs,
  navigateReplacement
} from "../src/replacement-navigator.mjs";
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { StandardMediaCommandAdapter } from '../src/standard-media-command-adapter.mjs';
import { installViewerKeys } from '../src/viewer-keys.mjs';

const packet = {
  manifest: {
    segments: [
      { segment_id: "first", action: "REPLACE", trigger_time_ms: 3_000, resume_time_ms: 5_000 },
      { segment_id: "second", action: "REPLACE", trigger_time_ms: 2_338_662, resume_time_ms: 2_348_598 }
    ]
  }
};

test("builds ordered navigation targets with bounded preroll", () => {
  assert.deepEqual(buildReplacementNavigationItems(packet, 5_000), [
    {
      id: "first", ordinal: 1, action: "REPLACE", triggerMs: 3_000, resumeMs: 5_000,
      targetMs: 0, triggerLabel: "00:03.000", targetLabel: "00:00.000"
    },
    {
      id: "second", ordinal: 2, action: "REPLACE", triggerMs: 2_338_662, resumeMs: 2_348_598,
      targetMs: 2_333_662, triggerLabel: "38:58.662", targetLabel: "38:53.662"
    }
  ]);
});

test("formats hour timestamps and clamps configurable preroll", () => {
  assert.equal(formatProgramTime(3_901_007), "1:05:01.007");
  assert.equal(normalizePrerollMs(-1), 0);
  assert.equal(normalizePrerollMs(60_000), 30_000);
  assert.equal(normalizePrerollMs(Number.NaN), 5_000);
});

for (const localPaused of [true, false]) test(`navigation drains active restoration and retains viewer pause=${localPaused}`, async () => {
  const calls = [], document = new EventTarget(), window = new EventTarget();
  const player = Object.assign(new EventTarget(), {
    currentTime: 100, duration: 1000, paused: true, muted: true, volume: 0.6, readyState: 4, seeking: false,
    pause() { calls.push('pause'); this.paused = true; },
    async play() {
      calls.push('play'); this.paused = false;
      const event = new Event('play');
      Object.defineProperty(event, 'target', { value: this });
      document.dispatchEvent(event);
    }
  });
  const commandAdapter = new StandardMediaCommandAdapter({ passiveAdapter: { activePlayer: () => player } });
  let releaseRecovery;
  const running = new Promise(resolve => { releaseRecovery = () => {
    calls.push('restored'); player.paused = false; player.muted = false;
    engine.localControllable = false; resolve();
  }; });
  const engine = { running, localControllable: true, localPaused };
  const lifetime = new AbortController();
  installViewerKeys({ document, window, engine, isNativePlayer: node => node === player,
    ownsNativePlay: () => false, signal: lifetime.signal });
  const executor = {
    invalidate() {}, async cancel() { calls.push('cancel'); }, async cancelPreload() {},
    async honorNativeSeek(target) { calls.push('honor'); assert.ok(calls.includes('restored')); player.currentTime = target / 1000; }
  };
  const scheduler = new ManifestActionScheduler({ actions: [{ id: 'next', type: 'SKIP', triggerMs: 30_000, resumeMs: 35_000 }], executor });
  scheduler.running = running;
  running.finally(() => { engine.running = null; scheduler.running = null; });
  const navigation = navigateReplacement({ targetMs: 25_000, commandAdapter, engine, scheduler });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.currentTime, 100, 'no destination write races old restoration');
  assert.equal(calls.includes('play'), false, 'no warmup races the replacement play guard');
  releaseRecovery();
  const receipt = await navigation;
  assert.equal(receipt.confirmed, true);
  assert.equal(player.currentTime, 25);
  assert.equal(player.paused, localPaused);
  assert.equal(player.muted, false, 'native audio restoration is complete');
  assert.ok(calls.indexOf('honor') > calls.indexOf('restored'));
  if (localPaused) assert.ok(calls.indexOf('play') > calls.indexOf('restored'));
  lifetime.abort();
});

test('a cancelled navigation cannot issue a new command after old recovery finishes', async () => {
  const controller = new AbortController(); let finish;
  const commands = [];
  const engine = { running: Promise.resolve(), localControllable: true, localPaused: true };
  const scheduler = { handleSeek: () => new Promise(resolve => { finish = resolve; }) };
  const commandAdapter = { pause: () => commands.push('pause'), seekToWithPlaybackWarmup: () => commands.push('seek') };
  const work = navigateReplacement({ targetMs: 25_000, commandAdapter, engine, scheduler, signal: controller.signal });
  controller.abort(); finish();
  await assert.rejects(work, { name: 'AbortError' });
  assert.deepEqual(commands, []);
});

test('ordinary paused navigation warms a provider that defers paused seeks and restores pause/audio', async () => {
  const calls = [];
  let position = 100;
  const player = Object.assign(new EventTarget(), {
    duration: 1000, paused: true, muted: false, volume: 0.6, readyState: 4, seeking: false,
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    async play() { calls.push({ muted: this.muted }); this.paused = false; this.dispatchEvent(new Event('play')); }
  });
  Object.defineProperty(player, 'currentTime', {
    get: () => position,
    set(value) {
      if (player.paused) return; // Prime's observed deferred paused-seek path.
      position = value;
      player.dispatchEvent(new Event('seeked'));
    }
  });
  const commandAdapter = new StandardMediaCommandAdapter({ passiveAdapter: { activePlayer: () => player }, timeoutMs: 20 });
  await assert.rejects(commandAdapter.seekTo(25_000), /Timed out waiting for seeked/);
  assert.equal(position, 100);
  commandAdapter.timeoutMs = 1000;
  const result = await navigateReplacement({ targetMs: 25_000, commandAdapter, engine: { running: null },
    scheduler: { handleSeek() { throw Error('No active replacement to recover'); } } });
  assert.equal(result.confirmed, true);
  assert.equal(result.errorMs, 0);
  assert.equal(position, 25);
  assert.equal(player.paused, true);
  assert.equal(player.muted, false);
  assert.equal(player.volume, 0.6);
  assert.deepEqual(calls, [{ muted: true }]);
});

function delayedSeekHarness(resumeDelayMs = 190) {
  let position = 100;
  const player = Object.assign(new EventTarget(), {
    duration: 1000, paused: true, muted: false, volume: 0.6, readyState: 4, seeking: false,
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  });
  Object.defineProperty(player, 'currentTime', {
    get: () => position,
    set(value) {
      position = value;
      player.seeking = true;
      queueMicrotask(() => { player.seeking = false; player.dispatchEvent(new Event('seeked')); });
      // Model the retained Prime trace: an early seek completion, further
      // seeking, then a delayed resume after the command has restored pause.
      setTimeout(() => { player.seeking = true; player.dispatchEvent(new Event('seeking')); }, 30);
      setTimeout(() => { player.seeking = false; player.dispatchEvent(new Event('seeked')); }, 180);
      setTimeout(() => { void player.play(); }, resumeDelayMs);
    }
  });
  const commandAdapter = new StandardMediaCommandAdapter({ passiveAdapter: { activePlayer: () => player }, timeoutMs: 2000 });
  return { player, commandAdapter };
}

test('paused navigation waits through a delayed post-seek resume before reporting ready', async () => {
  const { player, commandAdapter } = delayedSeekHarness();
  const result = await navigateReplacement({ targetMs: 25_000, commandAdapter });
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(player.paused, true);
  assert.equal(result.after.paused, true);
  assert.equal(result.errorMs, 0);
  assert.equal(player.muted, false);
  assert.equal(player.volume, 0.6);
  // No persistent play guard survives a completed navigation.
  await commandAdapter.play();
  assert.equal(player.paused, false);
});

test('paused navigation retains pause when resume follows final seek settlement by 340 ms', async () => {
  // Installed action 62 resumed 340 ms after the final seeking=false event,
  // after the former 250 ms guard had already reported Ready.
  const { player, commandAdapter } = delayedSeekHarness(520);
  const result = await navigateReplacement({ targetMs: 25_000, commandAdapter });
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(player.paused, true, 'the delayed provider resume must be settled before Ready');
  assert.equal(result.after.paused, true);
  assert.equal(result.errorMs, 0);
  assert.equal(player.muted, false);
  await commandAdapter.play();
  assert.equal(player.paused, false, 'explicit playback works after navigation');
});

test('a later play command supersedes paused navigation without a lingering pause guard', async () => {
  const { player, commandAdapter } = delayedSeekHarness();
  const navigation = navigateReplacement({ targetMs: 25_000, commandAdapter });
  const rejection = assert.rejects(navigation, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 40));
  await commandAdapter.play();
  await rejection;
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(player.paused, false);
  assert.equal(player.muted, false);
});

test('source reload during pause settlement releases the guard without pausing the new source', async () => {
  const { player, commandAdapter } = delayedSeekHarness();
  const navigation = navigateReplacement({ targetMs: 25_000, commandAdapter });
  const rejection = assert.rejects(navigation, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 40));
  player.paused = false;
  player.dispatchEvent(new Event('loadstart'));
  await rejection;
  assert.equal(player.paused, false);
  assert.equal(player.muted, false);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(player.paused, false);
});

test('pause settlement times out and removes its play listener', async () => {
  const { player, commandAdapter } = delayedSeekHarness();
  commandAdapter.timeoutMs = 50;
  await assert.rejects(navigateReplacement({ targetMs: 25_000, commandAdapter }), /Timed out waiting for seeking/);
  assert.equal(player.muted, false);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(player.paused, false, 'no stale guard handles the delayed provider play');
});
