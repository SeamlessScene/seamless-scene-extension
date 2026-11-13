import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashBlobInChunks } from '../src/local-file-hash-core.mjs';
import { sha256Hex, HASH_CHUNK_BYTES, MAX_NATIVE_FILE_BYTES } from '../src/local-file-hash.mjs';
import { nodeHashWorker } from './support/hash-worker-factory.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const turn = () => new Promise(resolve => setImmediate(resolve));

test('packaged WASM matches reviewed upstream and ESM bytes with both licenses', async () => {
  const root = new URL('../vendor/hash-wasm/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('PROVENANCE.json', root)));
  assert.equal(provenance.version, '4.12.0');
  assert.equal(digest(await readFile(new URL('sha256.js', root))), 'b6864e861c132d8ad8c4e0e4266bddfca7555e3eb587a3a76ca6fec2fe7816b7');
  assert.equal(digest(await readFile(new URL('upstream-sha256.umd.min.js', root))), 'ed7f5896b41aba98909ab143264c5b2ae5c81abf2e47f08dd2d1c0d02ce623de');
  assert.match(await readFile(new URL('LICENSE', root), 'utf8'), /Permission is hereby granted/);
  assert.match(await readFile(new URL('LICENSE-SHA256', root), 'utf8'), /Permission to use, copy, modify/);
});

function fakeWorker() {
  const events = new Map();
  return { messages: [], terminations: 0, events,
    postMessage(value) { this.messages.push(value); },
    terminate() { this.terminations++; },
    addEventListener(name, listener) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); },
    removeEventListener(name, listener) { events.get(name)?.delete(listener); },
    emit(name, data) { for (const listener of events.get(name) ?? []) listener({ data }); }
  };
}

test('incremental SHA-256 agrees with standard empty, abc and million-a vectors', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('abc'), Buffer.alloc(1_000_000, 97)]) {
    assert.equal(await hashBlobInChunks(new Blob([bytes]), { chunkBytes: 4093 }), digest(bytes));
  }
});

test('SHA-256 agrees across padding/block/slice boundaries and the packaged MP4', async () => {
  for (const size of [1, 55, 56, 63, 64, 65, 127, 128, 129, HASH_CHUNK_BYTES - 1, HASH_CHUNK_BYTES, HASH_CHUNK_BYTES + 73]) {
    const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = i % 251;
    assert.equal(await hashBlobInChunks(new Blob([bytes])), digest(bytes));
  }
  const mp4 = await readFile(new URL('../media/replacement.mp4', import.meta.url));
  assert.equal(await sha256Hex(new Blob([mp4]), { workerFactory: nodeHashWorker }), digest(mp4));
});

test('core reads exactly one bounded slice at a time, never the whole Blob', async () => {
  const size = 3 * HASH_CHUNK_BYTES + 21, ranges = []; let reading = false;
  const blob = { size, arrayBuffer() { throw Error('Whole-file read prohibited'); },
    slice(start, end) { ranges.push([start, end]); return { async arrayBuffer() {
      assert.equal(reading, false); reading = true; await turn(); reading = false;
      return new ArrayBuffer(end - start);
    } }; }
  };
  assert.equal(await hashBlobInChunks(blob), digest(Buffer.alloc(size)));
  assert.equal(ranges.length, 4); assert.deepEqual(ranges.at(-1), [3 * HASH_CHUNK_BYTES, size]);
  assert.ok(ranges.every(([start, end]) => end - start <= HASH_CHUNK_BYTES));
});

test('core refuses short/oversized reads and cancellation stops further slices', async () => {
  for (const length of [0, 2]) await assert.rejects(hashBlobInChunks({ size: 1, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(length) }) }), /read-failed/);
  const controller = new AbortController(); let reads = 0;
  await assert.rejects(hashBlobInChunks({ size: HASH_CHUNK_BYTES + 1, slice: () => ({ arrayBuffer: async () => {
    reads++; controller.abort(); return new ArrayBuffer(HASH_CHUNK_BYTES);
  } }) }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 1);
});

test('admission preserves 2 GiB but rejects invalid/over-budget sizes before worker creation', async () => {
  let creations = 0; const worker = fakeWorker(), workerFactory = () => { creations++; return worker; };
  for (const size of [-1, NaN, Infinity, 0.5, MAX_NATIVE_FILE_BYTES + 1]) {
    await assert.rejects(sha256Hex({ size, slice() { throw Error('No read'); } }, { workerFactory }), /invalid-input/);
  }
  assert.equal(creations, 0);
  const blob = { size: MAX_NATIVE_FILE_BYTES, slice: () => new Blob() };
  const work = sha256Hex(blob, { workerFactory });
  worker.emit('message', { type: 'done', sha256: 'a'.repeat(64) }); await work;
  assert.equal(creations, 1); assert.equal(worker.terminations, 1);
  // Boundary admission with a double is not evidence of a real 2 GiB read.
});

test('private worker receives a nameless Blob, returns only hash and terminates on success', async () => {
  const worker = fakeWorker(), file = new File(['abc'], 'private-filename.mp4');
  const work = sha256Hex(file, { workerFactory: () => worker });
  assert.deepEqual(Object.keys(worker.messages[0]), ['blob']);
  assert.ok(worker.messages[0].blob instanceof Blob); assert.equal(worker.messages[0].blob.name, undefined);
  worker.emit('message', { type: 'done', sha256: digest('abc') }); assert.equal(await work, digest('abc'));
  assert.equal(worker.terminations, 1); assert.ok([...worker.events.values()].every(listeners => listeners.size === 0));
});

test('abort terminates pending worker promptly and ignores retained late replies', async () => {
  const worker = fakeWorker(), controller = new AbortController(); let progress = 0;
  const work = sha256Hex(new Blob(['abc']), { workerFactory: () => worker, signal: controller.signal, onProgress: () => progress++ });
  const late = [...worker.events.get('message')][0]; controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  late({ data: { type: 'progress', processedBytes: 3 } }); late({ data: { type: 'done', sha256: digest('abc') } });
  assert.equal(progress, 0); assert.equal(worker.terminations, 1);
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(sha256Hex(new Blob(), { signal: preAborted.signal, workerFactory: () => { throw Error('Must not create'); } }), { name: 'AbortError' });
});

test('hash deadline terminates the actual owned worker instead of just ignoring its promise', async () => {
  const worker = fakeWorker();
  await assert.rejects(sha256Hex(new Blob(['abc']), { workerFactory: () => worker, timeoutMs: 5 }), /local-hash-timeout/);
  assert.equal(worker.terminations, 1);
});

test('hash worker budget has no unbounded queue and releases capacity after abort and construction failure', async () => {
  const controllers = [new AbortController(), new AbortController()];
  const jobs = controllers.map(controller => sha256Hex(new Blob(['abc']), { workerFactory: fakeWorker, signal: controller.signal }));
  await assert.rejects(sha256Hex(new Blob()), /local-hash-busy/);
  controllers.forEach(controller => controller.abort()); await Promise.all(jobs.map(work => assert.rejects(work, { name: 'AbortError' })));
  for (let i = 0; i < 3; i++) await assert.rejects(sha256Hex(new Blob(), { workerFactory: () => { throw Error('Construction failed'); } }), /Construction failed/);
  assert.equal(await sha256Hex(new Blob(['abc']), { workerFactory: nodeHashWorker }), digest('abc'));
});

test('malformed, oversized, duplicate progress, raw-error and worker failure replies fail closed', async () => {
  for (const data of [null, [], { type: 'done', sha256: 'wrong' }, { type: 'done', sha256: ['a'.repeat(64)] }, { type: 'done', sha256: 'a'.repeat(64), path: 'private' },
    { type: 'progress', processedBytes: 4 }, { type: 'progress', processedBytes: -1 }, { type: 'error', message: 'private path' }]) {
    const worker = fakeWorker(), work = sha256Hex(new Blob(['abc']), { workerFactory: () => worker });
    worker.emit('message', data); await assert.rejects(work, /local-hash-worker-failed/); assert.equal(worker.terminations, 1);
  }
  const worker = fakeWorker(), progress = [], work = sha256Hex(new Blob(['abc']), { workerFactory: () => worker, onProgress: bytes => progress.push(bytes) });
  worker.emit('message', { type: 'progress', processedBytes: 2 }); worker.emit('message', { type: 'progress', processedBytes: 2 });
  await assert.rejects(work, /worker-failed/); assert.deepEqual(progress, [2]);
  for (const name of ['error', 'messageerror']) {
    const worker = fakeWorker(), work = sha256Hex(new Blob(['abc']), { workerFactory: () => worker });
    worker.emit(name, 'private-path'); await assert.rejects(work, { message: 'local-hash-worker-failed' });
  }
});


test('cancelled asynchronous hash initialization cannot read or publish a digest', async () => {
  let release, reads = 0, destroyed = 0;
  const initialized = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const pending = hashBlobInChunks({ size: 1, slice() { reads++; throw Error('Retired read'); } }, {
    signal: controller.signal, createHasher: () => initialized
  });
  controller.abort();
  release({ destroy() { destroyed++; }, digest() { throw Error('Retired digest'); } });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(reads, 0); assert.equal(destroyed, 1);
});

test('hash initialization failure cannot read the selected Blob', async () => {
  let reads = 0;
  await assert.rejects(hashBlobInChunks({ size: 1, slice() { reads++; } }, {
    createHasher: async () => { throw Error('Compilation refused'); }
  }), /Compilation refused/);
  assert.equal(reads, 0);
});
