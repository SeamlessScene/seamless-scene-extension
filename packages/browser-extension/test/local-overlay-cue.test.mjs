import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalOverlay } from '../src/local-overlay.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class CueVideo extends EventTarget {
  constructor(){super();this.duration=20;this.readyState=4;this.seeking=false;this.time=0;this.seeks=[];this.autoComplete=true;}
  get currentTime(){return this.time;}
  set currentTime(time){this.time=time;this.seeks.push(time);this.seeking=true;this.readyState=1;if(this.autoComplete)queueMicrotask(()=>{this.seeking=false;this.readyState=3;this.dispatchEvent(new Event('seeked'));});}
}
function harness(keys=[0,10]){
  const overlay=new LocalOverlay({document:{}}), video=new CueVideo();
  overlay.video=video;overlay.source='blob:fixture';overlay.indexKeyframes=async()=>keys;
  return {overlay,video};
}
test('long-GOP cue reaches the requested proportion rather than replaying seconds',async()=>{
  const {overlay,video}=harness([0]);
  assert.equal((await overlay.cue(0.73)).positionMs,14600);
  assert.equal(video.currentTime,14.6);
});
test('near-keyframe cue retains a fast start without the 1ms nudge crossing its 250ms bound',async()=>{
  const {overlay,video}=harness([0,2,5]);
  assert.equal((await overlay.cue(2.12/20)).positionMs,2001);
  video.time=5.008;
  assert.equal((await overlay.cue(4.75/20)).positionMs,5000);
  assert.equal(video.currentTime,5,'already-near shortcut must respect the target bound too');
});
test('a repeated cue at fraction zero rewinds an already used decoder',async()=>{
  const {overlay,video}=harness(null);
  await overlay.cue(0.25);
  assert.equal((await overlay.cue(0)).positionMs,0);
  assert.equal(video.currentTime,0);
  assert.deepEqual(video.seeks,[5,0]);
});
test('tail protection remains authoritative and is applied before keyframe selection',async()=>{
  const {overlay,video}=harness([0,19.75]);
  assert.equal((await overlay.cue(0.995)).positionMs,19500);
  assert.equal(video.currentTime,19.5,'no keyframe nudge past the final-half-second guard');
  video.duration=0.4;video.time=0;
  assert.equal((await overlay.cue(0.9)).positionMs,0);
});
test('unknown or failed indexes fall back to exact seeking',async()=>{
  for(const keys of [null,[]]){const {overlay}=harness(keys);assert.equal((await overlay.cue(0.31)).positionMs,6200);}
  const {overlay}=harness();overlay.indexKeyframes=async()=>{throw Error('index unavailable');};
  assert.equal((await overlay.cue(0.31)).positionMs,6200);
});
test('an index arriving after its deadline cannot move an already cued decoder',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {overlay,video}=harness();let resolve;
  overlay.indexKeyframes=()=>new Promise(done=>{resolve=done;});
  const cue=overlay.cue(0.31);await turn();t.mock.timers.tick(150);
  assert.equal((await cue).positionMs,6200);
  resolve([0]);await turn();assert.deepEqual(video.seeks,[6.2]);
});
test('decoder replacement during index lookup cancels without writing to either decoder',async()=>{
  const {overlay,video}=harness();let resolve;
  overlay.indexKeyframes=()=>new Promise(done=>{resolve=done;});
  const cue=overlay.cue(0.31), rejected=assert.rejects(cue,{name:'AbortError'});
  await turn();overlay.resetDecoderLifetime();const successor=new CueVideo();overlay.video=successor;
  resolve([0]);await rejected;
  assert.deepEqual(video.seeks,[]);assert.deepEqual(successor.seeks,[]);
});
test('cancellation during readiness waits rejects without a successful cue receipt',async()=>{
  const {overlay,video}=harness(null), controller=new AbortController();video.autoComplete=false;
  const cue=overlay.cue(0.31,controller.signal), rejected=assert.rejects(cue,{name:'AbortError'});
  await turn();controller.abort();await rejected;
});
