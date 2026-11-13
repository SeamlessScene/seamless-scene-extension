import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCatalogActivity } from '../src/catalog-activity-executor.mjs';
import { validLocalMessage, validLocalResult } from '../src/local-message-schema.mjs';
test('private activity protocol is exact and carries no credentials', () => {
  const message = { type: 'command', id: 1, command: 'catalogActivity', args: ['segment-1', true] };
  assert(validLocalMessage(message, 'controller'));
  for (const args of [['x', 1], ['x', true, 'key'], [{token:'secret'},true], ['x'.repeat(129),false]]) assert(!validLocalMessage({...message,args}, 'controller'));
  assert(validLocalResult({type:'result', id:1, ok:true, value:null}, 'catalogActivity'));
  assert(!validLocalResult({type:'result', id:1, ok:true, value:{token:'secret'}}, 'catalogActivity'));
});
test('native restoration precedes release of local-action admission', async () => {
  const events=[]; let finish;
  const executor=withCatalogActivity({executeLocal:async()=>{events.push('playing');await new Promise(r=>finish=r);events.push('restored');}}, {catalogActivity:async(id,active)=>events.push(active?'begin':'end')});
  const run=executor.executeLocal({id:'a'}); while(!finish) await new Promise(r=>setImmediate(r));
  assert.deepEqual(events,['begin','playing']); finish(); await run; assert.deepEqual(events,['begin','playing','restored','end']);
});
test('mute admission lasts until actual unmute; failed native cancellation does not claim restoration', async()=>{
  const events=[];
  const executor=withCatalogActivity({startMute:async()=>events.push('muted'),finishMute:async()=>events.push('unmuted'),cancel:async()=>{throw Error('restore-failed');}}, {catalogActivity:async(id,active)=>events.push(active?'begin':'end')});
  await executor.startMute({id:'a'});assert.deepEqual(events,['begin','muted']);await assert.rejects(executor.cancel());assert(!events.includes('end'));
  await executor.finishMute({id:'a'});assert.deepEqual(events,['begin','muted','unmuted','end']);
});
test('cancellation during admission cannot start a late native action',async()=>{
  let release,started=0; const events=[];
  const executor=withCatalogActivity({executeSkip:async()=>started++,cancel:async()=>events.push('restored')}, {catalogActivity:async(id,active)=>{if(active) await new Promise(r=>release=r);else events.push('end');}});
  const run=executor.executeSkip({id:'a'}), rejected=assert.rejects(run,/cancelled/);await executor.cancel();release();await rejected;assert.equal(started,0);assert.deepEqual(events,['restored','end']);
});

test('catalog cancellation awaits native transition and refuses recorded recovery failures',async()=>{
 let finish;const engine={running:new Promise(r=>finish=r),lastRecoveryFailures:[]};
 const executor=withCatalogActivity({transitionEngine:engine,cancel:async()=>{}},{catalogActivity:async()=>{}});
 let completed=false;const work=executor.cancel().then(()=>completed=true);await new Promise(r=>setImmediate(r));assert.equal(completed,false);finish();await work;assert.equal(completed,true);
 engine.lastRecoveryFailures=[Error('restore')];await assert.rejects(executor.cancel(),/restoration-failed/);
});

// A scene that fails on its own (its cover lost its place when the page moved on) reports that
// failure to whoever ran it and to the engine's state and metrics. A cancel arriving meanwhile
// waits for it to settle and then answers for the restoration only: several callers stop an edit
// without awaiting the result, and the scene's error surfaced there as an unhandled rejection.
test('a cancel that meets a scene failing on its own waits for it and does not rethrow its error', async () => {
  let fail; const failure = Object.assign(Error('presentation-overlay-failure'), { phase: 'presentation', code: 'overlay-failure' });
  const engine = { running: new Promise((_, reject) => { fail = reject; }), lastRecoveryFailures: [] };
  const ran = assert.rejects(engine.running, { code: 'overlay-failure' }); // the scene's own caller still gets it
  const events = [];
  const executor = withCatalogActivity({ transitionEngine: engine, cancel: async () => { events.push('cancel'); } }, { catalogActivity: async () => {} });
  let settled = false; const work = executor.cancel('source-identity-changed').then(() => { settled = true; });
  await new Promise(r => setImmediate(r)); assert.equal(settled, false, 'waits for the scene');
  fail(failure); await work; await ran;
  assert.deepEqual(events, ['cancel']);
  // A restoration that failed is still refused.
  engine.running = Promise.reject(failure); engine.lastRecoveryFailures = [Error('restore')];
  await assert.rejects(executor.cancel(), /catalog-native-restoration-failed/);
});
