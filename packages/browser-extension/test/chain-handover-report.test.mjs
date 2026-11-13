import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRecorder } from '../src/metrics.mjs';
import { validLocalResult, validLocalMessage } from '../src/local-message-schema.mjs';

// 0.65.3: the timing export shows how each internal chain join handed over.
const play = { durationMs: 1668, localTimeAtEndMs: 1668, unplayedTailMs: 0, frameHoldMode: 'chain-handover', heldFrameMediaTimeMs: 1626, localEnded: true };
const chain = { playLeadMs: 150, playMs: -151.2, firstFrameMs: -40.5, firstFrameMediaMs: 83, revealVia: 'already-presenting', revealMs: 0, revealPresentedFrames: 4 };

test('the private channel carries the chain handover report', () => {
  const result = value => validLocalResult({ type: 'result', id: 1, ok: true, value }, 'play');
  assert.equal(result(play), true);
  assert.equal(result({ ...play, chain }), true);
  assert.equal(result({ ...play, chain: { ...chain, revealVia: 'later' } }), false);
  assert.equal(result({ ...play, chain: { ...chain, extra: 1 } }), false);
  assert.equal(result({ ...play, chain: { ...chain, firstFrameMs: null, revealMs: null, revealVia: 'pending' } }), true);
  // 0.65.6: the next clip's presentedFrames at the reveal, null before its first frame callback.
  assert.equal(result({ ...play, chain: { ...chain, revealPresentedFrames: null } }), true);
  assert.equal(result({ ...play, chain: { ...chain, revealPresentedFrames: -1 } }), false);
  assert.equal(validLocalMessage({ type: 'command', id: 1, command: 'play', args: [{ profileClass: 'local-user', chainNext: true }] }, 'controller'), true);
});

test('each internal join is on the cycle in the timing export', () => {
  const metrics = new MetricsRecorder();
  metrics.startCycle({ id: 'scene-5', triggerMs: 330679, resumeMs: 332347 }, 330679);
  metrics.chainJoin({ segmentId: 'scene-5', nextSegmentId: 'scene-6', frameHoldMode: 'chain-handover', handover: chain, advanced: true, advanceMs: 1.5 });
  const cycle = metrics.snapshot().cycles[0];
  assert.deepEqual(cycle.chainJoins, [{ segmentId: 'scene-5', nextSegmentId: 'scene-6', frameHoldMode: 'chain-handover', handover: chain, advanced: true, advanceMs: 1.5 }]);
});
