import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTiming } from '../src/timing-analysis.mjs';
import { mapClockTiming } from '../src/clock-timing-map.mjs';
const T = 1.7e12;
function stream(frames, id = 1) {
  return { frames: frames.map(([t, media, player = id], i) => [T + t, media, player, i + 1]),
    states: [[T - 500, id, 'video', null]], spans: [[T - 500, T + 2000]], losses: [],
    playback: [[T - 500, id, false, false, false]],
    dropped: { frames: 0, states: 0, spans: 0, losses: 0, playback: 0 }, maximumHeartbeatGapMs: 100 };
}
function trace(delay = 80) {
  const before = [-400, -360, -320, -280, -240, -200, -160, -120, -80, -40].map(t => [t, 10 + t / 1000]);
  const moving = Array.from({ length: Math.floor((1600 - delay) / 40) + 1 }, (_, i) => [delay + i * 40, (i + 1) / 25]);
  return { native: stream(before), clip: stream([[-20, 0], ...moving]), cover: [[T - 500, 'open'], [T, 'covered']], events: [] };
}
const cut = input => analyzeTiming(input).transitions[0];

function calibrated(input,offset) {
  const raw=structuredClone(input);
  for(const name of ['frames','states','playback'])raw.clip[name].forEach(row=>{row[0]+=offset;});
  for(const name of ['spans','losses'])raw.clip[name].forEach(row=>{row[0]+=offset;row[1]+=offset;});
  raw.clip.clockCalibration={samples:Array.from({length:9},(_,i)=>{
    const t=T-1000+i*500;return [t,t+4,t+2+offset,4,i*500+2];
  }),dropped:0};
  return raw;
}
for(const offset of [-1356,1356]) for(const delay of [80,600,1000]) test(`calibrated ${offset}ms clock preserves ${delay}ms hold as an estimate with exact raw replay`,()=>{
  const input=calibrated(trace(delay),offset),before=structuredClone(input);
  const report=analyzeTiming(input),entry=report.transitions[0].entry;
  assert.equal(entry.status,'clock-bounded-estimate');assert.equal(entry.estimatedLargestGapMs,delay);
  assert.equal(entry.largestGapMs,null,'an estimated domain conversion is not an exact gap verdict');
  assert.ok(entry.clockUncertaintyMs>=3);assert.deepEqual(input,before);
  assert.deepEqual(report.observations.clip,input.clip,'raw renderer timestamps must survive unchanged');
  assert.deepEqual(analyzeTiming(JSON.parse(JSON.stringify(report.observations))).transitions,report.transitions);
});
test('missing, failed, stale and malformed calibration never supplies a numeric continuity pass',()=>{
  for(const calibration of [null,{samples:[]},{samples:[[T,T+200,T+100,200,100]]},{samples:[null,'bad',[T]]}]) {
    const input=trace();input.clip.clockCalibration=calibration;
    assert.equal(cut(input).entry.reason,'clock-calibration-unavailable');assert.equal(cut(input).entryLargestGapMs,null);
  }
  const input=calibrated(trace(),1356);input.clip.clockCalibration.samples[2]=null;
  assert.equal(cut(input).entry.reason,'clock-calibration-unavailable');
});
test('unmapped state changes poison carry-forward attribution after a calibration gap',()=>{
  const input=calibrated(trace(),1356);
  input.clip.clockCalibration.samples[2]=null;
  input.clip.states.push([T+100+1356,2,'video',null]);
  const mapped=mapClockTiming(input.clip);
  assert.ok(mapped.stream.states.some(row=>row[1]===null&&row[2]==='unknown'));
});
test('a backward clock origin that reuses timestamp values refuses historical projection',()=>{
  const input=calibrated(trace(),0);
  for(let i=4;i<input.clip.clockCalibration.samples.length;i++)input.clip.clockCalibration.samples[i][2]-=1000;
  const mapped=mapClockTiming(input.clip);assert.deepEqual(mapped.coverage,[]);
  assert.equal(cut(input).entry.reason,'clock-calibration-unavailable');
});

test('a final backward probe refuses reused history before a new pair can form',()=>{
  for(const interrupted of [false,true]) {
    const input=calibrated(trace(),0);
    const samples=input.clip.clockCalibration.samples;
    const last=samples.at(-1);
    last[2]-=2000;
    if(interrupted)samples.splice(samples.length-1,0,null);
    const mapped=mapClockTiming(input.clip);
    assert.deepEqual(mapped.coverage,[], 'one backward observation already makes raw timestamps ambiguous');
    assert.equal(cut(input).entry.reason,'clock-calibration-unavailable');
  }
});

for (const delay of [80, 160, 300, 400, 600, 1000]) test(`actual analyzer retains ${delay} ms boundary-crossing hold`, () => {
  const entry = cut(trace(delay)).entry;
  assert.equal(entry.status, 'observed'); assert.equal(entry.largestGapMs, delay);
});

test('an unresolved hold has a lower bound rather than a small numeric pass', () => {
  const input = trace(); input.clip.frames = [[T - 20, 0, 1, 1], [T + 500, 0, 1, 2]];
  const entry = cut(input).entry;
  assert.equal(entry.status, 'censored'); assert.equal(entry.largestGapMs, null); assert.equal(entry.lowerBoundMs, 2000);
});

test('standby callbacks cannot hide a held active frame', () => {
  const input = trace(600);
  input.clip.frames.push(...Array.from({ length: 40 }, (_, i) => [T + i * 40, i / 25, 2, i + 1]));
  assert.equal(cut(input).entry.largestGapMs, 600);
});

test('a stale decoder cannot supply the frame at cover for a new active player', () => {
  const input = trace(); input.clip.states = [[T - 500, 1, 'video', null], [T - 10, 2, 'video', null]];
  const result = cut(input);
  assert.equal(result.clipFrameAtCover, null); assert.equal(result.entry.status, 'insufficient-evidence');
  assert.equal(result.entryLargestGapMs, null);
});

test('hidden decoder at cover and missing renderer observation are explicit', () => {
  const input = trace(); input.clip.states[0][2] = 'hidden';
  assert.equal(cut(input).entry.reason, 'selected-picture-not-observed');
  assert.equal(cut({ ...trace(), clip: [] }).entry.reason, 'player-mapping-and-observation-bounds-missing');
});

test('callback loss and heartbeat suspension cannot masquerade as a freeze', () => {
  const input = trace(600); input.clip.losses = [[T, T + 600, 14]];
  assert.equal(cut(input).entry.reason, 'frame-callbacks-skipped');
  input.clip.losses = []; input.clip.spans = [[T - 500, T + 100], [T + 600, T + 2000]];
  assert.equal(cut(input).entry.reason, 'observation-interrupted-or-truncated');
});

test('a held canvas suppresses later callbacks from the obscured video', () => {
  const input = trace(); input.clip.states.push([T + 80, 1, 'held', .04]);
  const entry = cut(input).entry;
  assert.equal(entry.status, 'censored'); assert.equal(entry.largestGapMs, null); assert.equal(entry.lowerBoundMs, 1920);
});

test('observation gaps beyond the nominal window invalidate a hold crossing that window', () => {
  const input = trace(1000); input.clip.spans = [[T - 500, T + 400], [T + 900, T + 2000]];
  assert.equal(cut(input).entry.reason, 'observation-interrupted-or-truncated');
});

test('an unresolved hold cannot claim a lower bound across a later observation gap', () => {
  const input = trace(); input.clip.frames = [[T - 20, 0, 1, 1]];
  input.clip.spans = [[T - 500, T + 500], [T + 900, T + 2000]];
  const entry = cut(input).entry;
  assert.equal(entry.status, 'insufficient-evidence'); assert.equal(entry.lowerBoundMs, null);
});

test('missing callback-loss counters do not produce an observed numeric gap', () => {
  const input = trace(); input.clip.frames.forEach(row => { row[3] = null; });
  assert.equal(cut(input).entry.reason, 'frame-loss-counter-unavailable');
});

test('callbacks during an earlier covered interval are not counted as removed native footage', () => {
  const input = trace(); input.native.frames.push([T - 600, 10.1, 1, 2]);
  input.cover = [[T - 1000, 'open'], [T - 700, 'covered'], [T - 450, 'open'], [T, 'covered']];
  input.events = [[T, 'transition', { triggerMs: 10000, resumeMs: 15000 }]];
  assert.equal(analyzeTiming(input).transitions.at(-1).removedNativeCallbacks, 0);
});

test('a pause in the selected clip is separate from a continuous-playback gap', () => {
  const input = trace(600);
  input.clip.playback.push([T + 100, 1, true, false, false], [T + 500, 1, false, false, false]);
  const entry = cut(input).entry;
  assert.equal(entry.status, 'playback-interrupted'); assert.equal(entry.largestGapMs, null);
  assert.equal(entry.observedLargestGapMs, 600); assert.equal(entry.playbackContext.pausedMs, 400);
});

test('paused native underneath a running replacement does not disqualify the clip', () => {
  const input = trace(600); input.native.playback.push([T, 1, true, false, false]);
  const entry = cut(input).entry;
  assert.equal(entry.status, 'observed'); assert.equal(entry.largestGapMs, 600);
  assert.equal(entry.playbackContext.pausedMs, 0);
});

test('pause at uncovered native and a seek in the selected clip are explicit', () => {
  const paused = trace(); paused.native.playback[0][2] = true;
  assert.equal(cut(paused).entry.status, 'playback-interrupted');
  const seeking = trace(600); seeking.clip.playback.push([T + 100, 1, false, true, false], [T + 500, 1, false, false, false]);
  assert.equal(cut(seeking).entry.playbackContext.seekingMs, 400);
});

test('unknown, stale and truncated transport evidence cannot claim uninterrupted playback', () => {
  for (const rows of [[], [[T - 500, 1, null, false, false]], [[T - 500, 2, false, false, false]], [[T + 100, 1, false, false, false]]]) {
    const input = trace(); input.clip.playback = rows;
    assert.equal(cut(input).entry.reason, 'selected-playback-state-unknown');
  }
});

test('natural end and a censored paused hold retain metadata without diagnosing a freeze', () => {
  const ended = trace(); ended.clip.playback.push([T + 80, 1, true, false, true]);
  assert.equal(cut(ended).entry.status, 'playback-interrupted');
  assert.ok(cut(ended).entry.playbackContext.endedMs > 0);
  const paused = trace(); paused.clip.frames = [[T - 20, 0, 1, 1]];
  paused.clip.playback.push([T + 100, 1, true, false, false]);
  const entry = cut(paused).entry;
  assert.equal(entry.status, 'playback-interrupted'); assert.equal(entry.lowerBoundMs, null);
  assert.equal(entry.observedLowerBoundMs, 2000); assert.equal(entry.playbackContext.pausedMs, 1900);
});

test('renderer observation need not precede cover while the native picture is selected', () => {
  const input = trace(160); input.clip.spans = [[T, T + 2000]];
  assert.equal(cut(input).entry.status, 'observed'); assert.equal(cut(input).entry.largestGapMs, 160);
});

test('renderer observation may stop after uncover while native continues', () => {
  const input = trace(); input.cover.push([T + 800, 'open']); input.clip.spans = [[T, T + 800]];
  input.native.frames.push(...Array.from({ length: 25 }, (_, i) => [T + 780 + i * 40, 20 + i / 25, 1, 11 + i]));
  assert.equal(cut(input).exit.status, 'observed'); assert.equal(cut(input).exit.largestGapMs, 40);
});

test('loss from a hidden decoder does not invalidate the selected picture', () => {
  const input = trace(600); input.native.losses = [[T + 10, T + 550, 12]];
  input.native.frames.push([T + 200, 12, 1, null]);
  assert.equal(cut(input).entry.status, 'observed'); assert.equal(cut(input).entry.largestGapMs, 600);
});

test('controller suspension still leaves cover observation unknown even with uninterrupted clip samples', () => {
  const input = trace(600); input.native.spans = [[T - 500, T + 100], [T + 500, T + 2000]];
  assert.equal(cut(input).entry.reason, 'observation-interrupted-or-truncated');
});

test('a missing counter on the frame supporting cover cannot be hidden by later known counters', () => {
  const input = trace(600); input.clip.frames[0][3] = null;
  assert.equal(cut(input).entry.reason, 'frame-loss-counter-unavailable');
});

test('exported observations reproduce a boundary supported by an earlier staged frame', () => {
  const input = trace(80);
  input.clip.frames[0][0] = T - 1800;
  input.clip.states[0][0] = input.clip.playback[0][0] = T - 2000;
  input.clip.spans[0][0] = T - 2000;
  input.events = [[T, 'transition', { triggerMs: 10000, resumeMs: 15000, action: 'REPLACE' }]];
  const report = JSON.parse(JSON.stringify(analyzeTiming(input)));
  assert.equal(report.transitions[0].entry.status, 'observed');
  assert.equal(report.transitions[0].frames.entry.clip.some(row => row[0] === -1800), false,
    'the display window alone omits the supporting frame');
  const replay = analyzeTiming(report.observations);
  assert.deepEqual(replay.transitions, report.transitions, 'the full retained observations must reproduce the verdict and scene identity');
  input.clip.frames[0][3] = null;
  const missingCounter = JSON.parse(JSON.stringify(analyzeTiming(input)));
  assert.equal(missingCounter.transitions[0].entry.reason, 'frame-loss-counter-unavailable');
  assert.deepEqual(analyzeTiming(missingCounter.observations).transitions, missingCounter.transitions,
    'export must also retain evidence that refuses measurement');
});

test('export retains the far endpoint of a hold beyond the display window', () => {
  const input = trace();
  input.clip.frames = [[T - 20, 0, 1, 1], [T + 3000, 1, 1, 2]];
  input.native.spans[0][1] = input.clip.spans[0][1] = T + 3500;
  const report = JSON.parse(JSON.stringify(analyzeTiming(input)));
  assert.equal(report.transitions[0].entry.largestGapMs, 3000);
  assert.equal(report.transitions[0].frames.entry.clip.length, 1);
  assert.deepEqual(analyzeTiming(report.observations).transitions, report.transitions);
});

test('E92: the covering clip pausing and ending at its own end, just before the uncover, is not an interruption', () => {
  const finished = (endAt, paused = true, ended = true) => {
    const input = trace(); input.cover.push([T + 800, 'open']); input.clip.spans = [[T, T + 800]];
    input.clip.frames = input.clip.frames.filter(row => row[0] <= T + endAt);
    input.clip.playback.push([T + endAt, 1, paused, false, ended]);
    input.native.frames.push(...Array.from({ length: 25 }, (_, i) => [T + 780 + i * 40, 20 + i / 25, 1, 11 + i]));
    return cut(input);
  };
  // 11-05 store test: the clip's natural paused+ended state began 45-57 ms before the sampled uncover.
  for (const [lead, paused, ended] of [[45, true, true], [57, true, true], [50, true, false], [0, true, true]]) {
    const result = finished(800 - lead, paused, ended);
    assert.equal(result.exit.status, 'observed', `${lead} ms before uncover`); assert.ok(result.exit.largestGapMs <= 80);
    assert.equal(result.exit.playbackContext.pausedMs, 0); assert.equal(result.exit.playbackContext.endedMs, 0);
    assert.equal(result.entry.status, 'observed', 'the entry is unaffected');
  }
  // Stopping earlier than the clip's end is still the selected player interrupted.
  const early = finished(560);
  assert.equal(early.exit.status, 'playback-interrupted'); assert.ok(early.exit.playbackContext.endedMs > 0);
  // A seek at the end is not excused.
  const input = trace(); input.cover.push([T + 800, 'open']); input.clip.spans = [[T, T + 800]];
  input.clip.frames = input.clip.frames.filter(row => row[0] <= T + 750); input.clip.playback.push([T + 750, 1, false, true, false]);
  input.native.frames.push(...Array.from({ length: 25 }, (_, i) => [T + 780 + i * 40, 20 + i / 25, 1, 11 + i]));
  assert.equal(cut(input).exit.status, 'playback-interrupted');
});
