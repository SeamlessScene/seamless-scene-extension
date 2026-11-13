import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEdge} from '../src/timing-edge-audit.mjs';
const frame=(timeMs,mediaTime=timeMs/1000,playerId='active')=>({timeMs,mediaTime,playerId});
const base={edgeMs:0,observedFromMs:-300,observedUntilMs:1500,mappingKnown:true};
function hold(delay){return [-240,-200,-160,-120,-80,-40].map(t=>frame(t,t/1000,'native'))
 .concat(frame(0,0), Array.from({length:Math.floor((1440-delay)/40)+1},(_,i)=>frame(delay+i*40,(i+1)/25)));}
for(const delay of [80,160,290,300,310,400,600,1000]) test(`${delay} ms hold survives an observation-window crossing`,()=>{
 const r=auditEdge({...base,changes:hold(delay)}); assert.equal(r.status,'observed');assert.equal(r.largestGapMs,delay);
});
test('a frozen picture gives an open-ended lower bound, not the old 40 ms cadence',()=>{
 const r=auditEdge({...base,observedUntilMs:900,changes:hold(80).filter(x=>x.timeMs<=0).concat(frame(300,0),frame(800,0))});
 assert.equal(r.status,'censored');assert.equal(r.largestGapMs,null);assert.equal(r.lowerBoundMs,900);
});
test('no frames cannot produce a numeric success',()=>{const r=auditEdge({...base});assert.equal(r.largestGapMs,null);assert.equal(r.status,'insufficient-evidence');});
test('unknown visible player cannot be inferred from a mix of callbacks',()=>{assert.equal(auditEdge({...base,changes:hold(80),mappingKnown:false}).reason,'visible-player-mapping-unknown');});
test('dropped samples invalidate the completeness claim',()=>{assert.equal(auditEdge({...base,changes:hold(80),droppedSamples:1}).largestGapMs,null);});
test('same media time on a different player remains a picture change',()=>{
 const r=auditEdge({...base,changes:[frame(-240,0,'A'),frame(-40,0,'A'),frame(0,0,'B'),frame(100,0,'C'),frame(200,0,'D'),frame(400,0,'E')]});
 assert.equal(r.status,'observed');assert.equal(r.largestGapMs,240);
});
test('duplicate callbacks for the same picture cannot conceal a hold',()=>{
 const changes=hold(600).concat([40,80,120,160,200,240,280,320,400].map(t=>frame(t,0)));
 assert.equal(auditEdge({...base,changes}).largestGapMs,600);
});
test('right-window truncation is censored even after some observed changes',()=>{
 const r=auditEdge({...base,observedUntilMs:150,changes:hold(80).filter(x=>x.timeMs<=150)});
 assert.equal(r.status,'censored');assert.equal(r.largestGapMs,null);
});
test('left-window truncation remains incomplete',()=>{assert.equal(auditEdge({...base,observedFromMs:-100,changes:hold(80).filter(x=>x.timeMs>=-100)}).reason,'left-window-not-observed');});
test('unsorted input is normalized without modifying caller evidence',()=>{
 const changes=hold(600).reverse(),copy=structuredClone(changes);assert.equal(auditEdge({...base,changes}).largestGapMs,600);assert.deepEqual(changes,copy);
});
test('different frames at an identical timestamp are ambiguous',()=>{assert.equal(auditEdge({...base,changes:hold(80).concat(frame(80,9,'other'))}).reason,'ambiguous-simultaneous-frames');});
test('a later unrelated hold beyond the edge window is excluded',()=>{
 const changes=hold(80).filter(x=>x.timeMs<=400).concat(frame(1400,99));
 assert.equal(auditEdge({...base,changes}).largestGapMs,80);
});
test('an exit edge uses the same interval rules with independent player identities',()=>{
 const changes=hold(600).map(x=>({...x,playerId:x.playerId==='native'?'clip':'native'}));
 assert.equal(auditEdge({...base,changes}).largestGapMs,600);
});
test('nonfinite observations are rejected',()=>{assert.equal(auditEdge({...base,changes:hold(80).concat(frame(NaN))}).reason,'invalid-frame-evidence');});
test('recording end is required instead of inferred from the last frame',()=>{assert.equal(auditEdge({...base,observedUntilMs:undefined,changes:hold(80)}).reason,'invalid-observation-bounds');});

