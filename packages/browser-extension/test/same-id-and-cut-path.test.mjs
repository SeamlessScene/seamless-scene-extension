import test from 'node:test';
import assert from 'node:assert/strict';
import { localRows } from '../src/local-library.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';

// 0.65.1: fixes from real-Prime testing.
const key = (gti, season, episode) => JSON.stringify(['prime-video', gti, 'episode', season, episode, 3_047_656, 'creator-reported', 'US', 'ad-free']);
const row = (archiveId, revision, sourceKey) => ({ archiveId, packetId: 'e71-synthetic-short-clips', revision, sourceKey, name: `rev ${revision}`, conflict: false, updatedFrom: null, signature: { status: 'unsigned' }, bytes: 1, addedAt: 1, lastWatchedAt: null });

test('a same-id edit for another episode does not make a row say "Newer revision available"', () => {
  const s1e2 = row('a'.repeat(64), 1, key('amzn1.dv.gti.4a8535a2-1dac-42fe-8783-3101673b0f08', 1, 2));
  const s1e3 = row('b'.repeat(64), 99, key('amzn1.dv.gti.0e2c9069-b4df-488a-8cdf-37a985a5a362', 1, 3));
  const labels = rows => Object.fromEntries(localRows(rows).map(r => [r.archiveId.slice(0, 1), r.status.label]));
  assert.deepEqual(labels([s1e2, s1e3]), { a: 'Unsigned', b: 'Unsigned' });
  // The same episode with a newer revision kept beside it (keep both revisions) still says so.
  const s1e2rev2 = row('c'.repeat(64), 2, s1e2.sourceKey);
  assert.deepEqual(labels([s1e2, s1e2rev2]), { a: 'Newer revision available', c: 'Unsigned' });
  // An unreadable source key never claims a newer revision.
  assert.equal(labels([row('d'.repeat(64), 1, ''), row('e'.repeat(64), 5, '')]).d, 'Unsigned');
});

test('each cycle in the timing export says how its cut was made (coverPath)', () => {
  const metrics = new MetricsRecorder();
  metrics.startCycle({ id: 'a1', action: 'REPLACE', triggerMs: 1000, resumeMs: 2500 }, 1000);
  metrics.coverPath('staged'); metrics.coverPath('bogus');
  metrics.finishCycle('success');
  assert.equal(metrics.snapshot().cycles[0].coverPath, 'staged');
});
