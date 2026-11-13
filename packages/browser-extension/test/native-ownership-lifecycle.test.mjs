import test from 'node:test';
import assert from 'node:assert/strict';
import {StandardTransitionAdapter} from '../src/standard-transition-adapter.mjs';
import {OwnershipLedger} from '../src/ownership-ledger.mjs';
import {StandardMediaCommandAdapter} from '../src/standard-media-command-adapter.mjs';
import {getEventListeners} from 'node:events';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const player=Object.assign(new EventTarget(),{paused:false,muted:false,currentTime:1});let removed=0;
 const adapter=new StandardTransitionAdapter({document:{},passiveAdapter:{activePlayer:()=>player},commandAdapter:{
  readState:()=>({currentTimeMs:1000,readyState:4,paused:player.paused}),pause:async()=>{player.paused=true;},play:async()=>{player.paused=false;}}});
 return {player,adapter,host:()=>({remove(){removed++;}}),removed:()=>removed};
}

test('an old or fabricated snapshot cannot restore or force-clean a newer transition',async()=>{
 const h=harness(),old=await h.adapter.snapshot(),current=await h.adapter.snapshot();
 await h.adapter.pause();await h.adapter.setMuted(true);const host=h.host();h.adapter.overlayHost=host;
 for(const snapshot of [old,{...current},{}]){
  await assert.rejects(h.adapter.restore(snapshot),{name:'AbortError'});
  await assert.rejects(h.adapter.forceSafeNativeState(snapshot),{name:'AbortError'});
 }
 assert.equal(h.player.paused,true);assert.equal(h.player.muted,true);assert.equal(h.adapter.overlayHost,host);assert.equal(h.removed(),0);
 await h.adapter.forceSafeNativeState(current);assert.equal(h.player.paused,false);assert.equal(h.player.muted,false);assert.equal(h.removed(),1);
});

test('a restore suspended at its first await cannot consume a newer ledger or remove its host',async()=>{
 const h=harness(),old=await h.adapter.snapshot(),waiting=deferred();h.adapter.ledger.restore=()=>waiting.promise;
 const work=h.adapter.restore(old);await turn();const current=await h.adapter.snapshot();
 await h.adapter.pause();await h.adapter.setMuted(true);const host=h.host();h.adapter.overlayHost=host;
 waiting.resolve();await assert.rejects(work,{name:'AbortError'});
 assert.equal(h.adapter.boundSnapshot,current);assert.equal(h.adapter.overlayHost,host);assert.equal(h.player.paused,true);assert.equal(h.player.muted,true);
 await h.adapter.forceSafeNativeState(current);
});

test('starting a new snapshot cannot discard native state still owned by its predecessor',async()=>{
 const h=harness(),old=await h.adapter.snapshot();await h.adapter.pause();await h.adapter.setMuted(true);
 await assert.rejects(h.adapter.snapshot(),/Previous native ownership/);
 assert.equal(h.adapter.boundSnapshot,old);await h.adapter.forceSafeNativeState(old);await h.adapter.snapshot();
});

test('force cleanup still attempts pause restoration when independent mute restoration fails',async()=>{
 const h=harness(),snapshot=await h.adapter.snapshot();await h.adapter.pause();h.adapter.ledger.restore=async()=>{throw Error('mute failed');};
 await assert.rejects(h.adapter.forceSafeNativeState(snapshot),/mute failed/);assert.equal(h.player.paused,false);
});

test('a cancelled ledger read cannot add or write a late ownership entry',async()=>{
 const ledger=new OwnershipLedger(),pending=deferred(),controller=new AbortController();let writes=0;
 const work=ledger.apply({key:'muted',read:()=>pending.promise,write:()=>writes++,value:true,signal:controller.signal});
 controller.abort();pending.resolve(false);await assert.rejects(work,{name:'AbortError'});
 assert.equal(ledger.entries.length,0);assert.equal(writes,0);
});

test('a ledger restore does not delete a different ownership entry added during its await',async()=>{
 const ledger=new OwnershipLedger(),pending=deferred();let first=false,second=false,delay=false;
 await ledger.apply({key:'first',read:()=>delay?pending.promise:first,write:value=>{first=value;},value:true});delay=true;
 const work=ledger.restore();await ledger.apply({key:'second',read:()=>second,write:value=>{second=value;},value:true});
 pending.resolve(true);await work;assert.equal(first,false);assert.equal(second,true);assert.equal(ledger.entries.length,1);
 assert.equal(ledger.entries[0].key,'second');await ledger.restore();assert.equal(second,false);
});

function commandHarness(timeoutMs=40){
 const h={seeks:0,pauses:0,plays:[]};
 class Player extends EventTarget{
  constructor(){super();this.paused=true;this.muted=false;this.volume=.5;this.readyState=4;this.duration=60;this._time=1;this.seeking=false;this.src='blob:source-a';this.currentSrc=this.src;}
  get currentTime(){return this._time;}set currentTime(value){h.seeks++;this._time=value;this.dispatchEvent(new Event('seeked'));}
  play(){const pending=deferred();h.plays.push(pending);return pending.promise;}
  pause(){h.pauses++;this.paused=true;}
 }
 h.player=new Player();h.adapter=new StandardMediaCommandAdapter({passiveAdapter:{activePlayer:()=>h.player},timeoutMs});return h;
}

test('late play after cancellation stops only its own unchanged command',async()=>{
 const h=commandHarness(),controller=new AbortController();const work=h.adapter.play(controller.signal);await turn();
 controller.abort();await assert.rejects(work,{name:'AbortError'});h.player.paused=false;h.plays[0].resolve();await turn();assert.equal(h.player.paused,true);
});

test('late play from a superseded command cannot pause a newer successful play',async()=>{
 const h=commandHarness(),old=h.adapter.play();await turn();const rejected=assert.rejects(old,{name:'AbortError'});
 const current=h.adapter.play();await turn();h.player.paused=false;h.plays[1].resolve();await current;await rejected;
 const pauses=h.pauses;h.plays[0].resolve();await turn();assert.equal(h.player.paused,false);assert.equal(h.pauses,pauses);
});

test('same-element media reload aborts warmup without a late seek or pause into the new source',async()=>{
 const h=commandHarness(),work=h.adapter.seekToWithPlaybackWarmup(5000);await turn();
 h.player.src='blob:source-b';h.player.currentSrc=h.player.src;h.player.dispatchEvent(new Event('loadstart'));
 await assert.rejects(work,{name:'AbortError'});assert.equal(h.player.muted,false);const pauses=h.pauses;
 h.player.muted=true;h.player.paused=false;h.plays[0].resolve();await turn();
 assert.equal(h.seeks,0);assert.equal(h.pauses,pauses);assert.equal(h.player.paused,false);assert.equal(h.player.muted,true);
});

test('play timeout cancels its command and bounds late settlement cleanup',async()=>{
 const h=commandHarness(5),work=h.adapter.play();await assert.rejects(work,/native-play-timeout/);
 h.player.paused=false;h.plays[0].resolve();await turn();assert.equal(h.player.paused,true);
});

test('transition restore refuses old coordinates after same-element source replacement',async()=>{
 const h=harness();h.player.src='blob:old';h.player.currentSrc='blob:old';const snapshot=await h.adapter.snapshot();
 await h.adapter.pause();await h.adapter.setMuted(true);h.player.src='blob:new';h.player.currentSrc='blob:new';h.player.dispatchEvent(new Event('loadstart'));
 await assert.rejects(h.adapter.restore(snapshot,{targetTimeMs:5000}),/context changed/);
 assert.equal(h.player.currentTime,1);assert.equal(h.player.paused,true);assert.equal(h.player.muted,false);
});

test('cancelling a pending MUTE source read prevents the late native mute write',async()=>{
 const h=harness(),pending=deferred();h.adapter.readState=()=>pending.promise;
 const work=h.adapter.beginMuteAction();await h.adapter.finishMuteAction();pending.resolve({});await assert.rejects(work,{name:'AbortError'});
 assert.equal(h.player.muted,false);assert.equal(h.adapter.muteActionLedger,null);
});

test('MUTE retains its ownership slot until asynchronous restoration settles',async()=>{
 const h=harness();await h.adapter.beginMuteAction();const pending=deferred(),restore=h.adapter.muteActionLedger.restore.bind(h.adapter.muteActionLedger);
 h.adapter.muteActionLedger.restore=async()=>{await pending.promise;return restore();};const work=h.adapter.finishMuteAction();
 await assert.rejects(h.adapter.beginMuteAction(),/already-active/);pending.resolve();await work;assert.equal(h.player.muted,false);
});

test('provider item invalidation aborts a pending command even when the media URL is unchanged',async()=>{
 const h=commandHarness(),transition=new StandardTransitionAdapter({document:{},passiveAdapter:{activePlayer:()=>h.player},commandAdapter:h.adapter});
 await transition.snapshot();const work=transition.seek(5000);await turn();transition.invalidateContext();
 await assert.rejects(work,{name:'AbortError'});const pauses=h.pauses;h.player.paused=false;h.plays[0].resolve();await turn();
 assert.equal(h.seeks,0);assert.equal(h.pauses,pauses);assert.equal(h.player.paused,false);assert.equal(h.player.muted,false);
});

test('shared native commands and transition ownership never inspect provider media URLs',async()=>{
 const h=commandHarness();Object.defineProperties(h.player,{src:{get(){throw Error('forbidden src read');}},currentSrc:{get(){throw Error('forbidden currentSrc read');}}});
 h.player.paused=false;const transition=new StandardTransitionAdapter({document:{},passiveAdapter:{activePlayer:()=>h.player},commandAdapter:h.adapter});
 const snapshot=await transition.snapshot();await transition.seek(5000);await transition.forceSafeNativeState(snapshot);assert.equal(h.seeks,1);
});

test('completed restoration releases lifecycle listeners and cannot rewind playback on retry',async()=>{
 const h=harness(),snapshot=await h.adapter.snapshot();assert.equal(getEventListeners(h.player,'loadstart').length,1);
 await h.adapter.restore(snapshot);assert.equal(getEventListeners(h.player,'loadstart').length,0);assert.equal(getEventListeners(h.player,'emptied').length,0);
 h.player.currentTime=8;const retry=await h.adapter.restore(snapshot,{targetTimeMs:1000});await h.adapter.forceSafeNativeState(snapshot);
 assert.equal(h.player.currentTime,8);assert.equal(retry.errorMs,null);assert.equal(retry.presentation,'already-restored');
});

test('a new snapshot reconciles failed final cleanup after external native playback resumes',async()=>{
 const h=harness(),old=await h.adapter.snapshot();await h.adapter.pause();
 let plays=0;h.adapter.commandAdapter.play=async()=>{plays++;throw Error('network unavailable');};
 await assert.rejects(h.adapter.forceSafeNativeState(old),/network unavailable/);
 assert.equal(h.adapter.pauseLedger.entries.length,1);h.player.paused=false;
 const current=await h.adapter.snapshot();assert.notEqual(current,old);assert.equal(plays,1);
 assert.equal(h.adapter.pauseLedger.entries.length,0);assert.equal(h.player.paused,false);
 await assert.rejects(h.adapter.forceSafeNativeState(old),{name:'AbortError'});
});

test('failed cleanup retry preserves outstanding ownership and can succeed after delivery returns',async()=>{
 const h=harness(),old=await h.adapter.snapshot();await h.adapter.pause();
 h.adapter.commandAdapter.play=async()=>{throw Error('network unavailable');};
 await assert.rejects(h.adapter.forceSafeNativeState(old),/network unavailable/);
 await assert.rejects(h.adapter.snapshot(),/network unavailable/);
 assert.equal(h.adapter.boundSnapshot,old);assert.equal(h.adapter.pauseLedger.entries.length,1);
 h.adapter.commandAdapter.play=async()=>{h.player.paused=false;};
 await h.adapter.snapshot();assert.equal(h.player.paused,false);assert.equal(h.adapter.pauseLedger.entries.length,0);
});

test('another snapshot cannot take ownership while failed cleanup is being retried',async()=>{
 const h=harness(),old=await h.adapter.snapshot();await h.adapter.pause();
 h.adapter.commandAdapter.play=async()=>{throw Error('network unavailable');};
 await assert.rejects(h.adapter.forceSafeNativeState(old),/network unavailable/);
 const pending=deferred();h.adapter.commandAdapter.play=async()=>{await pending.promise;h.player.paused=false;};
 const retry=h.adapter.snapshot();await turn();
 await assert.rejects(h.adapter.snapshot(),/Previous native ownership/);
 pending.resolve();await retry;assert.equal(h.player.paused,false);
});

test('cancelled cleanup retry retains ownership and a later retry can reconcile user playback',async()=>{
 const h=harness(),old=await h.adapter.snapshot();await h.adapter.pause();
 h.adapter.commandAdapter.play=async()=>{throw Error('network unavailable');};
 await assert.rejects(h.adapter.forceSafeNativeState(old),/network unavailable/);
 const controller=new AbortController();
 h.adapter.commandAdapter.play=signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 const retry=h.adapter.snapshot(controller.signal),rejected=assert.rejects(retry,{name:'AbortError'});await turn();controller.abort();await rejected;
 assert.equal(h.adapter.boundSnapshot,old);assert.equal(h.adapter.pauseLedger.entries.length,1);
 h.player.paused=false;const current=await h.adapter.snapshot();assert.notEqual(current,old);assert.equal(h.player.paused,false);
});

test('source reload during cleanup retry prevents late play cleanup from touching the new source',async()=>{
 const commands=commandHarness(5),player=commands.player;player.paused=false;
 const adapter=new StandardTransitionAdapter({document:{},passiveAdapter:{activePlayer:()=>player},commandAdapter:commands.adapter});
 const old=await adapter.snapshot();await adapter.pause();
 await assert.rejects(adapter.forceSafeNativeState(old),/native-play-timeout/);
 commands.adapter.timeoutMs=1000;const retry=adapter.snapshot(),rejected=assert.rejects(retry,{name:'AbortError'});await turn();
 player.src='blob:source-new';player.currentSrc=player.src;player.dispatchEvent(new Event('loadstart'));await rejected;
 player.paused=false;player.muted=true;const pauses=commands.pauses;
 for(const pending of commands.plays)pending.resolve();await turn();
 assert.equal(commands.pauses,pauses);assert.equal(player.paused,false);assert.equal(player.muted,true);
 const current=await adapter.snapshot();assert.notEqual(current,old);assert.equal(player.paused,false);assert.equal(player.muted,true);
 await assert.rejects(adapter.forceSafeNativeState(old),{name:'AbortError'});
});
