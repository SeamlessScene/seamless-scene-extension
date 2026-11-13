import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockDomain, CLOCK_DOMAIN_LIMITS } from '../src/clock-domain.mjs';
const epoch=1.8e12;
function harness(offset=0, out=2, back=3) {
  let time=epoch;
  const domain=new ClockDomain({clock:()=>time});
  const sample=(change={})=>{const sent=time;time+=out+back;return domain.accept({sentMs:sent,receivedMs:time,remoteMs:sent+out+offset,elapsedMs:out+back,remoteMonotonicMs:sent-epoch+out,...change});};
  return {domain,sample,advance:ms=>{time+=ms;},now:()=>time};
}
for(const offset of [-1356,0,1356]) for(const [out,back] of [[1,1],[1,18],[18,1]]) test(`offset ${offset}, asymmetric path ${out}/${back}ms stays bounded in both directions`,()=>{
  const h=harness(offset,out,back);assert.equal(h.sample(),false);assert.equal(h.domain.toRemote(epoch),null);
  h.advance(50);assert.equal(h.sample(),true);const m=h.domain.current();
  assert.ok(Math.abs(m.offsetMs-offset)<=m.uncertaintyMs);
  const deadline=h.now()+400;
  assert.ok(Math.abs(h.domain.toRemote(deadline)-(deadline+offset))<=m.uncertaintyMs);
  assert.ok(Math.abs(h.domain.toLocal(deadline+offset)-deadline)<=m.uncertaintyMs);
});
test('expired, reversed, suspended and wall/monotonic-disagreeing samples refuse prediction',()=>{
  for(const invalid of [{elapsedMs:100},{receivedMs:epoch-1},{remoteMs:NaN},{remoteMonotonicMs:-1}]) {
    const h=harness();h.sample();h.advance(50);h.sample();assert.ok(h.domain.current());
    h.advance(50);h.sample(invalid);assert.equal(h.domain.current(),null);
  }
  const h=harness();h.sample();h.advance(50);h.sample();h.advance(CLOCK_DOMAIN_LIMITS.ageMs+1);
  assert.equal(h.domain.current(),null);assert.equal(h.sample(),false);h.advance(50);assert.equal(h.sample(),true);
  const slow=harness(0,15,15);assert.equal(slow.sample(),false);slow.advance(50);assert.equal(slow.sample(),false);
});
test('changed offset and remote origin require a new consistent pair; reset discards active mapping',()=>{
  const h=harness();h.sample();h.advance(50);h.sample();h.advance(50);
  const remote=h.now()+2+1356;
  assert.equal(h.sample({remoteMs:remote}),false);assert.equal(h.domain.toLocal(remote),null);
  h.advance(50);assert.equal(h.sample({remoteMs:h.now()+2+1356}),true);
  h.domain.reset();assert.equal(h.domain.current(),null);
});
test('bounded history discloses retention and snapshots cannot mutate mapping history',()=>{
  const h=harness();for(let i=0;i<600;i++){h.sample();h.advance(20);}
  const s=h.domain.snapshot();assert.equal(s.samples.length,512);assert.equal(s.dropped,88);
  s.samples[0][0]=0;assert.notEqual(h.domain.snapshot().samples[0][0],0);
});

test('local epoch changes between probes and deadlines beyond calibration freshness are refused',()=>{
  let epochNow=epoch,mono=0;const d=new ClockDomain({clock:()=>epochNow,now:()=>mono});
  const probe=()=>{const sent=epochNow;epochNow+=4;mono+=4;d.accept({sentMs:sent,receivedMs:epochNow,remoteMs:sent+2,elapsedMs:4,remoteMonotonicMs:mono-2});};
  probe();probe();assert.ok(d.current());
  assert.equal(d.toRemote(epochNow+6000),null);
  epochNow+=100;assert.equal(d.current(),null,'changed epoch/monotonic relationship cannot reuse the mapping');
});

test('a slow but consistent probe is discarded without clearing a fresh mapping', () => {
  const h=harness();h.sample();h.advance(50);assert.equal(h.sample(),true);const before=h.domain.current();
  h.advance(50);const sent=h.now();h.advance(40);
  assert.equal(h.domain.accept({sentMs:sent,receivedMs:h.now(),remoteMs:sent+20,elapsedMs:40,remoteMonotonicMs:sent-epoch+20}),false);
  assert.equal(h.domain.current().offsetMs,before.offsetMs);assert.equal(h.domain.snapshot().slow,1);
  h.advance(CLOCK_DOMAIN_LIMITS.ageMs);assert.equal(h.domain.current(),null,'freshness still expires the kept mapping');
});
