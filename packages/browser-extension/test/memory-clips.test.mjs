import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackedClips } from '../src/memory-clips.mjs';

const clip = (size, type = 'video/mp4') => {
  let reads = 0;
  return { size, type, get reads() { return reads; }, async arrayBuffer() { reads += 1; return new ArrayBuffer(size); } };
};

test('small clips are copied into memory, smallest first, within the per-clip and total budgets', async () => {
  const files = new Map([['a', clip(40)], ['b', clip(10)], ['c', clip(30)], ['d', clip(200)]]);
  const copies = await memoryBackedClips(files, { perClip: 100, total: 45 });
  assert.ok(copies.get('b') instanceof Blob); assert.equal(copies.get('b').size, 10);
  assert.ok(copies.get('c') instanceof Blob); assert.equal(copies.get('c').type, 'video/mp4');
  assert.equal(copies.get('a'), files.get('a'), 'over the total budget stays file-backed');
  assert.equal(copies.get('d'), files.get('d'), 'over the per-clip limit stays file-backed');
  assert.equal(files.get('d').reads, 0);
  assert.deepEqual([...copies.keys()], ['a', 'b', 'c', 'd'], 'keys keep their order');
});

test('a clip that reads back a different size fails the import', async () => {
  const changed = { size: 20, type: '', async arrayBuffer() { return new ArrayBuffer(12); } };
  await assert.rejects(memoryBackedClips(new Map([['x', changed]])), /clip-changed-after-check/);
});

test('an unreadable clip fails the import and an aborted import stops copying', async () => {
  const gone = { size: 20, type: '', async arrayBuffer() { throw new DOMException('changed', 'NotReadableError'); } };
  await assert.rejects(memoryBackedClips(new Map([['x', gone]])), { name: 'NotReadableError' });
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(memoryBackedClips(new Map([['x', clip(5)]]), { signal: controller.signal }), /cancelled/);
});
