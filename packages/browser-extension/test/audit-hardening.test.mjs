import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ManifestActionScheduler } from "../src/manifest-action-scheduler.mjs";
import { createPlaybackObserver, createGuardedExecutor } from "../src/playback-session.mjs";
import { StandardMediaCommandAdapter } from "../src/standard-media-command-adapter.mjs";
import { StandardTransitionAdapter } from "../src/standard-transition-adapter.mjs";
import { LocalOverlay } from "../src/local-overlay.mjs";
import { evaluateTransitionEvidence } from "../src/trial-evidence.mjs";
import { loadFixturePacket } from "../src/fixture-local-packet.mjs";
import { OperationContext } from "../src/operation-context.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const local = (id, triggerMs, resumeMs) => ({id,type:"REPLACE",triggerMs,resumeMs,clipUrl:`blob:${id}`});

test("Prime composition delivers trigger and seek while preparation/playback is pending", async () => {
  const preparation = deferred(), playback = deferred(), calls=[];
  const scheduler = new ManifestActionScheduler({actions:[local("a",1000,6000)],executor:{
    preloadLocal:()=>preparation.promise,
    cancelPreload:()=>preparation.resolve(),
    executeLocal:()=>{calls.push("play");return playback.promise;},
    cancel:()=>{calls.push("cancel");playback.resolve();},
    honorNativeSeek:time=>calls.push(["seek",time])
  }});
  const observe=createPlaybackObserver({getScheduler:()=>scheduler});
  const preload=observe({currentTimeMs:900,paused:false});
  await flush();
  const crossing=observe({currentTimeMs:1001,paused:false});
  await crossing; await preload;
  assert.equal(scheduler.snapshot().statuses.a,"skipped");
  assert.deepEqual(calls,[]);
  await observe({currentTimeMs:500,paused:true},"seek");
  await observe({currentTimeMs:900,paused:false});
  const running=observe({currentTimeMs:1001,paused:false});await flush();
  await observe({currentTimeMs:9000,paused:true},"seek");await running;
  assert(calls.includes("play"));assert(calls.includes("cancel"));
  assert.deepEqual(calls.at(-1),["seek",9000]);
});

test("source-check continuation cannot arm an operation cancelled before engine startup", async () => {
  const identity=deferred();let starts=0;
  const executor=createGuardedExecutor({executeLocal:()=>starts++,cancel:()=>{},invalidate:()=>{}},()=>identity.promise);
  const operation=executor.executeLocal(local("a",1000,6000),1000);
  executor.cancel("source-changed");identity.resolve();
  await assert.rejects(operation,{name:"AbortError"});assert.equal(starts,0);
});

test("adjacent unprepared actions terminate explicitly and cannot starve later preloads", async () => {
  const preloads=[];
  const scheduler=new ManifestActionScheduler({actions:[local("a",1000,6000),local("b",6000,11000),local("c",15000,20000)],executor:{
    preloadLocal:async action=>preloads.push(action.id),executeLocal:async()=>{},cancelPreload:async()=>{}
  }});
  await scheduler.observe({currentTimeMs:900,paused:false});
  await scheduler.observe({currentTimeMs:1001,paused:false});
  await scheduler.observe({currentTimeMs:6001,paused:false});
  assert.equal(scheduler.snapshot().statuses.b,"skipped");
  await scheduler.observe({currentTimeMs:6050,paused:false});
  assert.deepEqual(preloads,["a","c"]);
});

test("a zero-anchor INSERT can prepare while armed at zero and fire once", async () => {
  let starts=0;
  const scheduler=new ManifestActionScheduler({actions:[{...local("zero",0,0),type:"INSERT"}],executor:{
    preloadLocal:async()=>{},executeLocal:async()=>starts++,honorNativeSeek:async()=>{}
  }});
  await scheduler.observe({currentTimeMs:0,paused:true,event:"seek"});
  assert.equal(scheduler.snapshot().preflightStatuses.zero,"ready");
  await scheduler.observe({currentTimeMs:0,paused:false});
  await scheduler.observe({currentTimeMs:1,paused:false});assert.equal(starts,1);
});

test("a cancelled warmup cannot later issue its seek", async () => {
  const pending=deferred();let seeks=0;
  class Player extends EventTarget {
    constructor(){super();this._time=1;this.duration=60;this.paused=true;this.muted=false;this.volume=.5;this.readyState=4;this.seeking=false;}
    get currentTime(){return this._time;} set currentTime(value){this._time=value;seeks++;this.dispatchEvent(new Event("seeked"));}
    async play(){await pending.promise;this.paused=false;} pause(){this.paused=true;}
  }
  const player=new Player(),passive={activePlayer:()=>player};
  const commands=new StandardMediaCommandAdapter({passiveAdapter:passive,timeoutMs:100});
  const adapter=new StandardTransitionAdapter({document:{},passiveAdapter:passive,commandAdapter:commands});
  const controller=new AbortController(),work=adapter.seek(5000,controller.signal);
  await flush();controller.abort();await assert.rejects(work,{name:"AbortError"});
  pending.resolve();await flush();assert.equal(seeks,0);assert.equal(player.muted,false);
});

test("native state ownership never transfers to a different element", async () => {
  const old={muted:false,paused:false},replacement={muted:true,paused:true};let active=old;
  const adapter=new StandardTransitionAdapter({document:{},passiveAdapter:{activePlayer:()=>active},commandAdapter:{readState:()=>({currentTimeMs:0,readyState:4})}});
  const snapshot = await adapter.snapshot();await adapter.setMuted(true);active=replacement;
  await assert.rejects(adapter.seek(1000),{name:"AbortError"});
  await adapter.forceSafeNativeState(snapshot);
  assert.equal(old.muted,false);assert.equal(replacement.muted,true);assert.equal(replacement.paused,true);
});

test("presentation failure preserves source ownership so cleanup can resume the original player", async () => {
  const player = {muted:false, paused:false, currentTime:1};
  const passiveAdapter = {activePlayer:()=>player};
  const commandAdapter = {
    readState:()=>({currentTimeMs:1000, readyState:4}),
    pause:async()=>{player.paused=true;}, play:async()=>{player.paused=false;}
  };
  const adapter = new StandardTransitionAdapter({document:{}, passiveAdapter, commandAdapter});
  const snapshot = await adapter.snapshot(); await adapter.pause(); await adapter.setMuted(true);
  let failures=0;
  const unsubscribe = adapter.subscribePresentationErrors(()=>failures++);
  adapter.presentation.onError(new Error("native video fullscreen"));
  assert.equal(adapter.contextValid,true);
  await adapter.forceSafeNativeState(snapshot);
  assert.equal(player.paused,false); assert.equal(player.muted,false); assert.equal(failures,1);
  unsubscribe(); adapter.presentation.onError(new Error("late resize")); assert.equal(failures,1);
});

test("loadeddata at HAVE_CURRENT_DATA waits for canplay rather than failing preload", async () => {
  class Video extends EventTarget {
    constructor(){super();this.style={};this.dataset={};this.readyState=0;this.currentTime=0;this.seeking=false;}
    load(){queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event("loadeddata"));queueMicrotask(()=>{this.readyState=3;this.dispatchEvent(new Event("canplay"));});});}
  }
  const overlay=new LocalOverlay({document:{createElement:()=>new Video()}});
  assert.equal((await overlay.prepare("blob:test")).readyState,3);
});

test("already-aborted preparation creates no decoder", async () => {
  let created=0;const controller=new AbortController();controller.abort();
  const overlay=new LocalOverlay({document:{createElement:()=>created++}});
  await assert.rejects(overlay.prepare("blob:test",controller.signal),{name:"AbortError"});assert.equal(created,0);
});

test("missing, string and nonfinite timings cannot pass the evidence gate", () => {
  for(const value of [null,undefined,"0",NaN,Infinity]){
    const records=Array.from({length:100},()=>({command:"local-replacement",outcome:"success",restoration:{passed:true},metrics:{timelineErrorMs:value},scenario:{}}));
    const gate=evaluateTransitionEvidence({records});
    assert.notEqual(gate.status,"passed");assert.equal(gate.checks.timelineErrorP95Ms.samples,0);
    assert.equal(gate.checks.timingCompleteness.missing,100);
  }
});

test("native/fixture importer uses current adapter version, not historical 0.1.0", async () => {
  const packet=JSON.parse(await readFile(new URL("../media/edit-packet.json",import.meta.url),"utf8"));
  packet.purpose="local-user-edit";packet.manifest.status="local-only";packet.manifest.signature=null;packet.manifest.rights.classification="user-supplied";
  packet.manifest.segments=packet.manifest.segments.filter(segment=>segment.asset);
  packet.manifest.compatibility.min_adapter_version="0.40.0";
  const files=[{name:"edit-packet.json",size:100,text:async()=>JSON.stringify(packet)},...packet.asset_bindings.map(binding=>({name:binding.relative_path,size:100}))];
  const result=await loadFixturePacket(files,packet.manifest.source,{validateAsset:async()=>({ok:true})});
  assert.equal(result.files.size,1);
});

test("context invalidation makes every captured continuation stale", () => {
  const context=new OperationContext(),prior=context.capture();context.invalidate();
  assert.throws(()=>prior.assertCurrent(),{name:"AbortError"});context.capture().assertCurrent();
});

test("each scene in a chained execution holds its own catalog activity until restoration", async () => {
  const { withCatalogActivity } = await import("../src/catalog-activity-executor.mjs");
  const log = [];
  const overlay = { catalogActivity: async (id, active) => { log.push(`${active ? "begin" : "end"}:${id}`); } };
  const base = { async executeLocal(action, _observed, options) { log.push(`execute:${action.id}+${options.chain.map(m => m.id).join(",")}`); return { status: "success" }; } };
  const executor = withCatalogActivity(base, overlay);
  await executor.executeLocal({ id: "a" }, 0, { chain: [{ id: "b" }, { id: "c" }] });
  assert.deepEqual(log, ["begin:a", "begin:b", "begin:c", "execute:a+b,c", "end:a", "end:b", "end:c"]);
});

test("honoring a viewer seek does not re-seek native that has landed or is seeking there", async () => {
  const { ManifestActionExecutor } = await import("../src/manifest-action-executor.mjs");
  const seeks = [];
  let state = { currentTimeMs: 60_010, seeking: false };
  const executor = new ManifestActionExecutor({ transitionEngine: {}, adapter: { readState: async () => state, seek: async target => { seeks.push(target); } } });
  await executor.honorNativeSeek(60_000);
  assert.deepEqual(seeks, []);
  state = { currentTimeMs: 12_000, seeking: false };
  await executor.honorNativeSeek(60_000);
  // Still on its way to the viewer's target: that seek is the viewer's own; do not repeat it.
  state = { currentTimeMs: 60_000, seeking: true };
  await executor.honorNativeSeek(60_000);
  // Seeking somewhere else (for example a restore in flight): re-assert the target.
  state = { currentTimeMs: 15_000, seeking: true };
  await executor.honorNativeSeek(60_000);
  assert.deepEqual(seeks, [60_000, 60_000]);
});
