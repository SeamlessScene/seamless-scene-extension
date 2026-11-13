import assert from "node:assert/strict";
import test from "node:test";
import { StandardTransitionAdapter } from "../src/standard-transition-adapter.mjs";

test("restoration removes the overlay host and restores owned mute after seek failure", async () => {
  const player = { muted: false, paused: false };
  let hostRemoved = false;
  const commandAdapter = {
    readState: () => ({ currentTimeMs: 1000, readyState: 4 }),
    seekToWithPlaybackWarmup: async () => { throw new Error("seek failed"); },
    play: async () => { player.paused = false; },
    pause: async () => { player.paused = true; }
  };
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter
  });
  adapter.overlayHost = { remove: () => { hostRemoved = true; } };

  const snapshot = await adapter.snapshot();
  await adapter.setMuted(true);
  await adapter.pause();
  await assert.rejects(
    adapter.restore(snapshot, { targetTimeMs: 5000, resumePlayback: true }),
    /seek failed/
  );
  assert.equal(player.muted, false);
  assert.equal(player.paused, false);
  assert.equal(hostRemoved, true);
  assert.equal(adapter.overlayHost, null);
});

test("restores playback only while the adapter still owns its pause", async () => {
  const player = { muted: false, paused: false };
  const calls = [];
  const commandAdapter = {
    readState: () => ({ currentTimeMs: 1_000, readyState: 4 }),
    pause: async () => { calls.push("pause"); player.paused = true; },
    play: async () => { calls.push("play"); player.paused = false; }
  };
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter
  });

  const snapshot = await adapter.snapshot();
  await adapter.pause();
  await adapter.restore(snapshot, {});
  assert.deepEqual(calls, ["pause", "play"]);
  assert.equal(player.paused, false);
});

test("keeps native muted and covered until a resumed frame is presented", async () => {
  const calls = [];
  let muted = false;
  const player = {
    paused: false,
    get muted() { return muted; },
    set muted(value) { muted = value; calls.push(`muted:${value}`); },
    requestVideoFrameCallback(callback) {
      calls.push("frame-requested");
      queueMicrotask(() => {
        calls.push("frame-presented");
        callback(0, {});
      });
      return 1;
    },
    cancelVideoFrameCallback() {}
  };
  const commandAdapter = {
    readState: () => ({ currentTimeMs: 5_000, readyState: 4 }),
    pause: async () => { calls.push("pause"); player.paused = true; },
    play: async () => { calls.push("play"); player.paused = false; }
  };
  const adapter = new StandardTransitionAdapter({
    document: {
      defaultView: {
        requestAnimationFrame(callback) {
          calls.push("compositor-settle-requested");
          queueMicrotask(() => {
            calls.push("compositor-settled");
            callback(0);
          });
          return 1;
        },
        cancelAnimationFrame() {}
      }
    },
    passiveAdapter: { activePlayer: () => player },
    commandAdapter
  });
  adapter.overlayHost = { remove: () => calls.push("overlay-removed") };

  const snapshot = await adapter.snapshot();
  await adapter.pause();
  await adapter.setMuted(true);
  await adapter.restore(snapshot, {
    targetTimeMs: 5_000,
    resumePlayback: true,
    awaitPresentedFrame: true
  });

  assert.deepEqual(calls, [
    "pause", "muted:true", "frame-requested", "frame-presented", "frame-requested", "play", "frame-presented",
    "compositor-settle-requested", "compositor-settled", "compositor-settle-requested", "compositor-settled", "overlay-removed", "muted:false"
  ]);
});

test("presentation timeout still uncovers native playback and restores owned mute", async () => {
  const player = {
    muted: false,
    paused: false,
    requestVideoFrameCallback() { return 1; },
    cancelVideoFrameCallback() {}
  };
  let hostRemoved = false;
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter: {
      readState: () => ({ currentTimeMs: 5_000, readyState: 4 }),
      pause: async () => { player.paused = true; },
      play: async () => { player.paused = false; }
    },
    presentationTimeoutMs: 5
  });
  adapter.overlayHost = { remove: () => { hostRemoved = true; } };

  const snapshot = await adapter.snapshot();
  await adapter.pause();
  await adapter.setMuted(true);
  // A missing frame callback (hidden tab, protected renderer) is a degraded
  // uncover, not a failure that would send recovery back into the replaced interval.
  const receipt = await adapter.restore(snapshot, {
    targetTimeMs: 5_000,
    resumePlayback: true,
    awaitPresentedFrame: true
  });
  assert.equal(receipt.presentation, "frame-timeout");

  assert.equal(hostRemoved, true);
  assert.equal(player.muted, false);
  assert.equal(player.paused, false);
});

test("captures the first resumed frame even when it precedes play promise settlement", async () => {
  let callback, observed = false;
  const player = {muted:false, paused:false, currentTime:5,
    requestVideoFrameCallback(fn) { callback=fn; return 1; }, cancelVideoFrameCallback() {}};
  const adapter = new StandardTransitionAdapter({document:{}, passiveAdapter:{activePlayer:()=>player},
    commandAdapter:{readState:()=>({currentTimeMs:5000,readyState:4}),
      pause:async()=>{player.paused=true;},
      play:async()=>{player.paused=false; assert.equal(typeof callback,"function"); callback(0,{}); observed=true;}
    }, presentationTimeoutMs:20});
  const snapshot = await adapter.snapshot(); await adapter.pause(); await adapter.setMuted(true);
  const receipt=await adapter.restore(snapshot,{targetTimeMs:5000,resumePlayback:true,awaitPresentedFrame:true});
  assert.equal(observed,true); assert.equal(receipt.presentation,"presented");
  assert.equal(receipt.errorMs,0); assert.equal(player.muted,false);
});

test("failed resume cancels its registered frame callback and releases native mute", async () => {
  let cancelled=0;
  const player={muted:false,paused:false,currentTime:5,
    requestVideoFrameCallback(){return 7;},cancelVideoFrameCallback(id){assert.equal(id,7);cancelled++;}};
  const adapter=new StandardTransitionAdapter({document:{},passiveAdapter:{activePlayer:()=>player},
    commandAdapter:{readState:()=>({currentTimeMs:5000,readyState:4}),pause:async()=>{player.paused=true;},play:async()=>{throw Error("play failed");}}});
  const snapshot = await adapter.snapshot();await adapter.pause();await adapter.setMuted(true);
  await assert.rejects(adapter.restore(snapshot,{targetTimeMs:5000,resumePlayback:true,awaitPresentedFrame:true}),/play failed/);
  assert.equal(cancelled,1);assert.equal(player.muted,false);
});

test("preserves a user play change made during an adapter-owned pause", async () => {
  const player = { muted: false, paused: false };
  const calls = [];
  const commandAdapter = {
    readState: () => ({ currentTimeMs: 1_000, readyState: 4 }),
    pause: async () => { calls.push("pause"); player.paused = true; },
    play: async () => { calls.push("play"); player.paused = false; }
  };
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter
  });

  const snapshot = await adapter.snapshot();
  await adapter.pause();
  player.paused = false;
  await adapter.restore(snapshot, {});
  assert.deepEqual(calls, ["pause"]);
  assert.equal(player.paused, false);
});

test("does not claim an already-paused player's later playback state", async () => {
  const player = { muted: false, paused: true };
  const calls = [];
  const commandAdapter = {
    readState: () => ({ currentTimeMs: 1_000, readyState: 4 }),
    pause: async () => { calls.push("pause"); player.paused = true; },
    play: async () => { calls.push("play"); player.paused = false; }
  };
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter
  });

  const snapshot = await adapter.snapshot();
  await adapter.pause();
  player.paused = false;
  await adapter.restore(snapshot, {});
  assert.deepEqual(calls, ["pause"]);
  assert.equal(player.paused, false);
});

test("force-safe cleanup preserves volume because the adapter never owns it", async () => {
  const player = { muted: false, paused: false, volume: 1 };
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: 1_000, readyState: 4 }) }
  });

  const snapshot = await adapter.snapshot();
  player.volume = 0;
  await adapter.forceSafeNativeState(snapshot);
  assert.equal(player.volume, 0);
});

test("mute action restoration preserves a user audio change made during the interval", async () => {
  const player = { muted: false };
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: 1_000, readyState: 4 }) }
  });
  await adapter.beginMuteAction();
  assert.equal(player.muted, true);
  player.muted = false;
  await adapter.finishMuteAction();
  assert.equal(player.muted, false);
});

test("classifies only the adapter's exact pending seek target as owned", () => {
  const adapter = new StandardTransitionAdapter({
    document: {},
    passiveAdapter: { activePlayer: () => ({ muted: false }) },
    commandAdapter: {}
  });
  adapter.ownedSeekDepth = 1;
  adapter.ownedSeekTargetMs = 8_000;
  assert.equal(adapter.isOwnedSeekEvent(8_100), true);
  assert.equal(adapter.isOwnedSeekEvent(0), false);
});


test('initial mount failure notifies active presentation owners and preserves the error', async () => {
  const reported = [], error = Error('unsupported initial presentation');
  const adapter = new StandardTransitionAdapter({ document: {}, passiveAdapter: {}, commandAdapter: {}, onPresentationError: value => reported.push(value) });
  const controller = [], engine = new AbortController();
  const remove = adapter.subscribePresentationErrors(value => controller.push(value));
  adapter.subscribePresentationErrors(value => engine.abort(value));
  adapter.presentation.mount = () => { throw error; };
  await assert.rejects(adapter.mountOverlayHost(), value => value === error);
  assert.deepEqual(controller, [error]); assert.deepEqual(reported, [error]); assert.equal(engine.signal.reason, error);
  remove(); await assert.rejects(adapter.mountOverlayHost(), value => value === error); assert.equal(controller.length, 1);
});

function hostDocument() {
  const root = { append(node) { node.isConnected = true; node.parentNode = this; }, moveBefore(node) { node.parentNode = this; } };
  const created = [];
  return {
    created,
    document: { documentElement: root, fullscreenElement: null, pictureInPictureElement: null, defaultView: {},
      createElement: () => { const host = { style: {}, dataset: {}, isConnected: false, remove() { this.isConnected = false; } }; created.push(host); return host; } }
  };
}

test("the cover host mounts invisible (opacity 0, still rendering) and is revealed only when native is covered", async () => {
  const { document } = hostDocument();
  const player = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  const adapter = new StandardTransitionAdapter({ document, passiveAdapter: { activePlayer: () => player }, commandAdapter: {} });
  const host = await adapter.mountOverlayHost();
  // 0.62.18: not visibility:hidden, so the clip's frame renders at its final size before the reveal.
  assert.equal(host.style.opacity, "0"); assert.equal(host.style.visibility, "visible");
  await adapter.setNativeCovered(true);
  assert.equal(host.style.visibility, "visible"); assert.equal(host.style.opacity, "1");
  adapter.teardownOverlayHost();
});

test("a staged host is adopted by the transition; unstaging returns the renderer first", async () => {
  const { document, created } = hostDocument();
  const player = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  const order = [];
  const adapter = new StandardTransitionAdapter({ document, passiveAdapter: { activePlayer: () => player }, commandAdapter: {},
    beforeHostTeardown: () => order.push("return-home") });
  const staged = await adapter.stageOverlayHost();
  assert.equal(staged.style.opacity, "0", "staged invisible but rendering (0.62.18)");
  assert.equal(await adapter.mountOverlayHost(), staged, "the staged host is reused, not remounted");
  assert.equal(created.length, 1);
  adapter.teardownOverlayHost();

  const again = await adapter.stageOverlayHost();
  const remove = again.remove.bind(again);
  again.remove = () => { order.push("remove-host"); remove(); };
  order.length = 0;
  assert.equal(adapter.unstageOverlayHost(), true);
  assert.equal(order[0], "return-home");
  assert.ok(order.includes("remove-host"));
  assert.equal(again.isConnected, false);
  assert.equal(adapter.unstageOverlayHost(), false);
});

test("observation continues on media timeupdate when animation frames stop", async () => {
  const listeners = new Map();
  const document = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const adapter = new StandardTransitionAdapter({ document, passiveAdapter: { activePlayer: () => ({}) },
    commandAdapter: { readState: () => ({ currentTimeMs: 4_200, paused: false }) } });
  const frames = [];
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const seen = [];
    const stop = adapter.subscribe(state => seen.push(state.currentTimeMs));
    // No animation frame ever runs (hidden tab); timeupdate still samples.
    listeners.get("timeupdate")({ target: {} });
    listeners.get("timeupdate")({ target: { dataset: { sceneSubstitutionOverlay: "true" } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [4_200], "native timeupdate samples; the local clip's own timeupdate is ignored");
    stop();
    assert.equal(listeners.has("timeupdate"), false);
  } finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});

test("restore in a hidden document uncovers without waiting for a frame that cannot be presented", async () => {
  const player = { muted: false, paused: false, currentTime: 5, requestVideoFrameCallback() { throw new Error("must not wait"); } };
  const adapter = new StandardTransitionAdapter({ document: { visibilityState: "hidden" }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: 5_000, readyState: 4 }), pause: async () => { player.paused = true; }, play: async () => { player.paused = false; } },
    presentationTimeoutMs: 60_000 });
  const snapshot = await adapter.snapshot(); await adapter.pause(); await adapter.setMuted(true);
  const receipt = await adapter.restore(snapshot, { targetTimeMs: 5_000, resumePlayback: true, awaitPresentedFrame: true });
  assert.equal(receipt.presentation, "hidden-document");
  assert.equal(player.muted, false); assert.equal(player.paused, false);
});

// 0.66.2 (a second pass in one tab): the player element changed between scenes, the
// session was cleared and armed again, and the first stage of the new run failed at once.
test("staging after an invalidation that nothing owned starts from the active player again", async () => {
  const { document } = hostDocument();
  const player = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  const errors = [];
  const adapter = new StandardTransitionAdapter({ document, passiveAdapter: { activePlayer: () => player }, commandAdapter: {},
    onPresentationError: error => errors.push(error) });
  adapter.invalidateContext(); // no snapshot is bound: nothing to protect
  assert.throws(() => adapter.player(), { name: "AbortError" }, "the latched invalidation is what failed the stage");
  const staged = await adapter.stageOverlayHost();
  assert.equal(staged.style.opacity, "0");
  assert.equal(adapter.player(), player);
  assert.deepEqual(errors, []);
  adapter.unstageOverlayHost();
});

test("staging does not clear the invalidation of a native context a transition still owns", async () => {
  const { document } = hostDocument();
  const player = Object.assign(new EventTarget(), { paused: false, muted: false, volume: 1, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) });
  const adapter = new StandardTransitionAdapter({ document, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: 1000, paused: false, muted: false, volume: 1, readyState: 4 }), pause: async () => { player.paused = true; } } });
  await adapter.snapshot(); await adapter.pause(); // the pause ledger now owns native
  adapter.invalidateContext();
  await assert.rejects(adapter.stageOverlayHost(), { name: "AbortError" });
  assert.equal(adapter.contextValid, false);
});
