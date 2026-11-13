import assert from "node:assert/strict";
import test from "node:test";
import { StandardMediaCommandAdapter } from "../src/standard-media-command-adapter.mjs";
import { installViewerKeys } from "../src/viewer-keys.mjs";

class FakePlayer extends EventTarget {
  constructor() {
    super();
    this._currentTime = 100;
    this.duration = 3000;
    this.paused = false;
    this.muted = false;
    this.volume = 1;
    this.readyState = 4;
    this.seeking = false;
    this.videoWidth = 1920;
    this.videoHeight = 1080;
  }

  get currentTime() { return this._currentTime; }

  set currentTime(value) {
    this.seeking = true;
    this._currentTime = value;
    queueMicrotask(() => {
      this.seeking = false;
      this.dispatchEvent(new Event("seeked"));
    });
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
}

function harness() {
  const player = new FakePlayer();
  let now = 0;
  const adapter = new StandardMediaCommandAdapter({
    passiveAdapter: { activePlayer: () => player },
    now: () => ++now
  });
  return { adapter, player };
}

test("confirms standard pause and play commands", async () => {
  const { adapter, player } = harness();
  assert.equal((await adapter.pause()).confirmed, true);
  assert.equal(player.paused, true);
  assert.equal((await adapter.play()).confirmed, true);
  assert.equal(player.paused, false);
});

test("reads only the decoded native video dimensions for quality comparison", () => {
  const { adapter } = harness();
  assert.deepEqual(adapter.readVideoProfile(), { width: 1920, height: 1080 });
});

test("confirms bounded standard seeks and reports position error", async () => {
  const { adapter, player } = harness();
  const forward = await adapter.seekBy(10000);
  assert.equal(forward.targetMs, 110000);
  assert.equal(forward.errorMs, 0);
  assert.equal(player.currentTime, 110);

  const backward = await adapter.seekBy(-10000);
  assert.equal(backward.targetMs, 100000);
  assert.equal(backward.errorMs, 0);
});

test("nudges paused playback forward by the three bounded millisecond increments", async () => {
  const { adapter, player } = harness();
  player.paused = true;

  for (const increment of [1, 10, 100]) {
    const beforeMs = Math.round(player.currentTime * 1000);
    const result = await adapter.nudgeForward(increment);
    assert.equal(result.requestedDeltaMs, increment);
    assert.equal(result.targetMs, beforeMs + increment);
    assert.equal(result.appliedDeltaMs, increment);
    assert.equal(result.errorMs, 0);
    assert.equal(result.confirmed, true);
  }
});

test("fine seek rejects active playback and unreviewed increments", async () => {
  const { adapter, player } = harness();
  await assert.rejects(adapter.nudgeForward(1), /Pause playback/);
  player.paused = true;
  await assert.rejects(adapter.nudgeForward(1000), /Unsupported fine-seek increment/);
});

test("toggles mute without changing volume", async () => {
  const { adapter, player } = harness();
  const result = await adapter.setMuted(true);
  assert.equal(result.confirmed, true);
  assert.equal(player.muted, true);
  assert.equal(player.volume, 1);
});

test("warms a paused seek through muted playback and restores prior state", async () => {
  const player = new FakePlayer();
  player.paused = true;
  let playedWhileMuted = false;
  player.play = async function play() {
    playedWhileMuted = this.muted;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  };
  const adapter = new StandardMediaCommandAdapter({
    passiveAdapter: { activePlayer: () => player }
  });

  const result = await adapter.seekByWithPlaybackWarmup(10000);
  assert.equal(result.confirmed, true);
  assert.equal(result.errorMs, 0);
  assert.equal(playedWhileMuted, true);
  assert.equal(player.paused, true);
  assert.equal(player.muted, false);
});

test("absolute navigation reaches the seek while the replacement guard blocks native warmup", async () => {
  const player = new FakePlayer(), document = new EventTarget(), window = new EventTarget();
  player.paused = true;
  const controller = new AbortController(), engine = { localControllable: true };
  installViewerKeys({ window, document, engine, isNativePlayer: node => node === player,
    ownsNativePlay: () => false, signal: controller.signal });
  let playCalls = 0;
  player.play = async () => {
    playCalls++;
    player.paused = false;
    const event = new Event('play');
    Object.defineProperty(event, 'target', { value: player });
    document.dispatchEvent(event);
  };
  const adapter = new StandardMediaCommandAdapter({ passiveAdapter: { activePlayer: () => player }, timeoutMs: 10 });
  try {
    // The former navigator path never issued its seek: the active replacement
    // re-pauses native immediately. Retain that reproduction alongside the fix.
    await assert.rejects(adapter.seekToWithPlaybackWarmup(25_000), /Timed out waiting for play\/playing/);
    assert.equal(player.currentTime, 100);
    assert.equal(playCalls, 1);
    const result = await adapter.seekTo(25_000);
    assert.equal(result.confirmed, true);
    assert.equal(result.errorMs, 0);
    assert.equal(player.currentTime, 25);
    assert.equal(player.paused, true);
    assert.equal(player.muted, false);
    assert.equal(playCalls, 1, 'navigation does not issue another play request');
  } finally { controller.abort(); }
});

test("absolute navigation preserves playback and audio state and clamps its destination", async () => {
  for (const paused of [true, false]) {
    const { adapter, player } = harness();
    player.paused = paused; player.muted = true; player.volume = 0.3;
    player.play = () => { throw Error('Navigation must not play'); };
    for (const [requested, expected] of [[-1000, 0], [30_000, 30_000], [4_000_000, 2_999_750]]) {
      const result = await adapter.seekTo(requested);
      assert.equal(result.targetMs, expected);
      assert.equal(result.after.paused, paused);
      assert.equal(result.after.muted, true);
      assert.equal(result.after.volume, 0.3);
    }
  }
});

test("absolute navigation rejects stale source authority before writing a position", async () => {
  const { adapter, player } = harness();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.seekTo(25_000, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(adapter.seekTo(25_000, { assertCurrent: () => { throw Error('Source changed'); } }), /Source changed/);
  assert.equal(player.currentTime, 100);
});

test("E52: a warm seek whose play Prime interrupts with pause() asks again instead of failing Preview", async () => {
  const { adapter, player } = harness();
  player.pause();
  let interrupts = 1, plays = 0;
  const play = player.play.bind(player);
  player.play = async () => {
    plays += 1;
    if (interrupts-- > 0) throw new DOMException("The play request was interrupted by a call to pause().", "AbortError");
    return play();
  };
  const result = await adapter.seekToWithPlaybackWarmup(400_000, "preview-seek");
  assert.equal(plays, 2);
  assert.equal(result.after.currentTimeMs, 400_000);
  assert.equal(player.paused, true, "a seek started paused is left paused");
  assert.equal(player.muted, false);
});

test("E52: other play failures and a cancelled command are not retried", async () => {
  const { adapter, player } = harness();
  player.pause();
  let plays = 0;
  player.play = async () => { plays += 1; throw new DOMException("play() failed because the user didn't interact with the document first.", "NotAllowedError"); };
  await assert.rejects(adapter.seekToWithPlaybackWarmup(400_000, "preview-seek"), /NotAllowedError|interact/);
  assert.equal(plays, 1);
  plays = 0;
  player.play = async () => { plays += 1; throw new DOMException("The play request was interrupted by a call to pause().", "AbortError"); };
  await assert.rejects(adapter.seekToWithPlaybackWarmup(400_000, "preview-seek"), /interrupted/);
  assert.equal(plays, 3, "bounded: three asks at most");
});

// 0.65.6: the Developer "Seek to position" control for R3's precise seeks.
test("seekToPosition writes the exact position once, like the slider: no pause, play or mute, and no superseding", async () => {
  const { adapter, player } = harness();
  player.paused = true;
  let writes = 0; const set = Object.getOwnPropertyDescriptor(FakePlayer.prototype, "currentTime").set;
  Object.defineProperty(player, "currentTime", { get() { return this._currentTime; }, set(value) { writes += 1; set.call(this, value); } });
  const events = []; for (const type of ["play", "pause"]) player.addEventListener(type, () => events.push(type));
  const pending = { active: true, controller: new AbortController(), sourceChanged: false };
  adapter.pendingCommand = pending; // e.g. the transition's own join seek in flight
  const result = await adapter.seekToPosition(1234567);
  assert.equal(result.command, "seek-position"); assert.equal(result.confirmed, true);
  assert.equal(result.targetMs, 1234567); assert.equal(result.errorMs, 0);
  assert.equal(writes, 1); assert.deepEqual(events, []); assert.equal(player.paused, true); assert.equal(player.muted, false);
  assert.equal(pending.controller.signal.aborted, false, "the extension's own command is not superseded");
});

test("seekToPosition accepts only whole milliseconds within the runtime less 250 ms", async () => {
  const { adapter, player } = harness();
  for (const bad of [-1, 1.5, NaN, Infinity, "100"]) await assert.rejects(adapter.seekToPosition(bad), TypeError, String(bad));
  await assert.rejects(adapter.seekToPosition(2_999_751), /at most 2999750 ms/);
  assert.equal(player.currentTime, 100, "nothing written");
  assert.equal((await adapter.seekToPosition(2_999_750)).confirmed, true);
});

test("seekToPosition reports a seek that has not landed as settling, not failed", async () => {
  const player = new FakePlayer(); player.readyState = 1;
  const adapter = new StandardMediaCommandAdapter({ passiveAdapter: { activePlayer: () => player }, timeoutMs: 30 });
  const result = await adapter.seekToPosition(500000);
  assert.equal(result.confirmed, false); assert.equal(result.settling, true); assert.equal(result.targetMs, 500000);
});

test("the Developer panel's command tests offer Seek to position, wired to seekToPosition", async () => {
  const { DEVELOPER_PANEL_HTML } = await import("../src/developer-panel.mjs");
  const controls = DEVELOPER_PANEL_HTML.slice(DEVELOPER_PANEL_HTML.indexOf("data-command-controls"), DEVELOPER_PANEL_HTML.indexOf("data-command-output"));
  assert.match(controls, /<input data-seek-position type="number" min="0" step="1"/);
  assert.match(controls, /data-command="seek-position"/);
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /"seek-position": \(\) => \{\n\s+const value = shadow\.querySelector\("\[data-seek-position\]"\)\?\.value \?\? "";\n\s+return commandAdapter\.seekToPosition\(/);
});
