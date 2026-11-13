import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMp4Format } from '../src/mp4-format-probe.mjs';
import { packagedMp4, malformedConfigurations, box } from './support/mp4-format-mutations.mjs';
const fixture = await packagedMp4();

for (const [name, bytes] of malformedConfigurations(fixture)) test(`MP4 rejects ${name} before decoder invocation`, async () => {
  await assert.rejects(inspectMp4Format(new Blob([bytes])), /unsupported-or-malformed/);
});

test('compatible MP4 brands are checked independently of the major-brand label', async () => {
  const bytes = Buffer.from(fixture); bytes.write('M4V ', 8);
  assert.equal((await inspectMp4Format(new Blob([bytes]))).container, 'mp4');
  const ftypLength = bytes.readUInt32BE(0); bytes.fill(0, 8, ftypLength);
  await assert.rejects(inspectMp4Format(new Blob([bytes])), /unsupported-or-malformed/);
});

test('duplicate file-type metadata and nonintegral compatible-brand lists fail closed', async () => {
  const ftyp = fixture.subarray(0, fixture.readUInt32BE(0));
  await assert.rejects(inspectMp4Format(new Blob([ftyp, fixture])), /unsupported-or-malformed/);
  await assert.rejects(inspectMp4Format(new Blob([box('ftyp', Buffer.concat([ftyp.subarray(8), Buffer.alloc(1)])), fixture.subarray(ftyp.length)])), /unsupported-or-malformed/);
});

test('short and oversized reads fail with a bounded code, not DataView/OS details', async () => {
  for (const buffer of [new ArrayBuffer(0), new ArrayBuffer(7), new ArrayBuffer(17)]) {
    await assert.rejects(inspectMp4Format({ size: 100, slice: () => ({ arrayBuffer: async () => buffer }) }), {message:'unsupported-or-malformed-mp4-format'});
  }
  await assert.rejects(inspectMp4Format({ size: 100, slice: () => ({ arrayBuffer: async () => { throw Error('private file location'); } }) }), {message:'unsupported-or-malformed-mp4-format'});
});

test('an aborted pending format read cannot start a later read', async () => {
  let resolve, reads = 0; const controller = new AbortController();
  const work = inspectMp4Format({ size: fixture.length, slice: () => ({ arrayBuffer: () => { reads++; return new Promise(done => { resolve = done; }); } }) }, { signal: controller.signal });
  controller.abort(); resolve(fixture.subarray(0, 16).buffer.slice(fixture.byteOffset, fixture.byteOffset + 16));
  await assert.rejects(work, { name: 'AbortError' }); assert.equal(reads, 1);
});

test('top-level metadata count is bounded before an unbounded box walk', async () => {
  const free = box('free', Buffer.alloc(0));
  await assert.rejects(inspectMp4Format(new Blob(Array(10001).fill(free))), /unsupported-or-malformed/);
});

function countedFile(blob, hook = () => {}) {
  const ranges = [];
  const file = { size: blob.size, slice(start, end) { ranges.push([start, end]); return { async arrayBuffer() {
    const bytes = await blob.slice(start, end).arrayBuffer();
    return hook({ start, end, bytes, file, ranges }) ?? bytes;
  } }; } };
  return { file, ranges };
}
function denseFile(count) {
  let originalCount = 0;
  for (let p = 0; p < fixture.length; p += fixture.readUInt32BE(p)) originalCount++;
  return new Blob([...Array(count - originalCount).fill(box('free', Buffer.alloc(0))), fixture]);
}
test('exact top-level count uses bounded read-ahead across cache boundaries; over-count refuses', async () => {
  const { file, ranges } = countedFile(denseFile(10000));
  assert.equal((await inspectMp4Format(file)).container, 'mp4');
  assert.deepEqual(ranges[0], [0, 16]);
  assert.ok(ranges.length < 20, `dense headers must be amortized: ${ranges.length}`);
  await assert.rejects(inspectMp4Format(denseFile(10001)), /unsupported-or-malformed/);
});
test('initial oversized movie is refused after only its precise header', async () => {
  const h = Buffer.alloc(16); h.writeUInt32BE(8 * 1024 * 1024 + 1); h.write('moov', 4);
  const { file, ranges } = countedFile(new Blob([h, new Uint8Array(8 * 1024 * 1024)]));
  await assert.rejects(inspectMp4Format(file), /unsupported-or-malformed/);
  assert.deepEqual(ranges, [[0, 16]]);
});
test('speculative reads stay within their independent budget and fall back to precise headers', async () => {
  const blob = new Blob([...Array(100).fill(box('free', Buffer.alloc(65528))), fixture]);
  const { file, ranges } = countedFile(blob);
  assert.equal((await inspectMp4Format(file)).container, 'mp4');
  const speculative = ranges.filter(([a, b]) => a < 100 * 65536);
  assert.ok(speculative.every(([a, b]) => b - a <= 65536));
  assert.ok(speculative.reduce((sum, [a, b]) => sum + Math.max(0, b - a - 16), 0) <= 160000);
  assert.ok(speculative.slice(-10).every(([a, b]) => b - a === 16));
});
test('read-ahead abort, changed size, short/oversized buffers and read failures remain fail-closed', async () => {
  for (const mode of ['abort', 'resize', 'short', 'oversized', 'throw']) {
    const controller = new AbortController();
    const { file, ranges } = countedFile(denseFile(10000), ({ bytes, file, ranges }) => {
      if (ranges.length !== 2) return;
      if (mode === 'abort') controller.abort();
      if (mode === 'resize') file.size++;
      if (mode === 'short') return bytes.slice(0, -1);
      if (mode === 'oversized') return new ArrayBuffer(bytes.byteLength + 1);
      if (mode === 'throw') throw Error('private read failure');
    });
    await assert.rejects(inspectMp4Format(file, { signal: controller.signal }), mode === 'abort' ? { name: 'AbortError' } : { message: 'unsupported-or-malformed-mp4-format' });
    assert.equal(ranges.length, 2);
  }
});
test('cached header hits still check cancellation and current file size', async () => {
  for (const mode of ['abort', 'resize']) {
    const controller = new AbortController(); let sizeChecks = 0;
    const blob = denseFile(10000), { file, ranges } = countedFile(blob);
    Object.defineProperty(file, 'size', { get() {
      if (ranges.length === 2 && ++sizeChecks === 3) {
        if (mode === 'abort') controller.abort(); else return blob.size + 1;
      }
      return blob.size;
    } });
    await assert.rejects(inspectMp4Format(file, { signal: controller.signal }), mode === 'abort' ? { name: 'AbortError' } : { message: 'unsupported-or-malformed-mp4-format' });
    assert.equal(ranges.length, 2);
  }
});
