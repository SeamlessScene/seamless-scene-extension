import test from 'node:test';
import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { keyframeTimes, entryPosition } from '../src/mp4-keyframes.mjs';

test('reads keyframe presentation times from the fixture clip, and null from a non-MP4', async () => {
  const times = await keyframeTimes(await openAsBlob(new URL('../media/replacement.mp4', import.meta.url)));
  assert.ok(Array.isArray(times) && times.length >= 1);
  assert.equal(times[0], 0);
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.equal(await keyframeTimes(new Blob(['not an mp4 file at all'])), null);
});

test('an entry uses a keyframe within 250ms and otherwise keeps the proportional target', () => {
  const keyframes = [0, 1.25, 2.5, 3.75, 5];
  assert.equal(entryPosition(2.2, keyframes), 2.2, 'distant keyframe does not move the entry');
  assert.equal(entryPosition(2.3, keyframes), 2.5, 'nearby later keyframe remains available');
  assert.equal(entryPosition(2.0, keyframes), 2.0);
  assert.equal(entryPosition(1.5, keyframes), 1.25);
  assert.equal(entryPosition(4.2, [0, 10.4]), 4.2);
  assert.equal(entryPosition(9.6, [0, 10.4]), 9.6);
  assert.equal(entryPosition(14.6, [0]), 14.6, 'single-keyframe clips no longer replay from zero');
  assert.equal(entryPosition(3.3, null), 3.3, 'no index: exact');
  assert.equal(entryPosition(3.3, []), 3.3);
});
