import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { clearedCountFilename, tagClearedMp4, createClearedCountPacket } from '../../fixtures/high-count-packet-fixture-data.mjs';
import { validateLocalUserEditPacket } from '../src/local-edit-packet.mjs';
import { LOCAL_IMPORT_LIMITS } from '../src/fixture-local-packet.mjs';
const base = JSON.parse(await readFile(new URL('../media/edit-packet.json', import.meta.url), 'utf8'));

test('cleared count construction fits schema/metadata/aggregate budgets through 1000 distinct bindings without mutating input', () => {
  const original = structuredClone(base);
  for (const count of [1, 80, 1000]) {
    const hashes = Array.from({ length: count }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
    const packet = createClearedCountPacket(base, hashes), bytes = new TextEncoder().encode(JSON.stringify(packet)).byteLength;
    assert.equal(validateLocalUserEditPacket(packet).ok, true); assert.ok(bytes <= LOCAL_IMPORT_LIMITS.manifestBytes);
    assert.ok(bytes + count * 1829714 <= LOCAL_IMPORT_LIMITS.packetBytes);
    assert.equal(packet.asset_bindings.length, count); assert.equal(packet.manifest.segments.at(-1).resume_time_ms, (count - 1) * 6000 + 5000);
  }
  assert.deepEqual(base, original);
});

test('cleared tags are bounded distinct free-box suffixes and preserve the source bytes', () => {
  const source = new Uint8Array(100).fill(7), hashes = new Set();
  for (const i of [0, 79, 999, 1000]) {
    const bytes = tagClearedMp4(source, i); assert.equal(bytes.byteLength, 112);
    assert.deepEqual(bytes.slice(0, 100), source); const view = new DataView(bytes.buffer, 100);
    assert.equal(view.getUint32(0), 12); assert.equal(new TextDecoder().decode(bytes.slice(104, 108)), 'free'); assert.equal(view.getUint32(8), i);
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 4); assert.equal(clearedCountFilename(1000), 'cleared-count-1001.mp4');
});

test('cleared fixture refuses unsupported indices, buffers, duplicate hashes and over-count manifests', () => {
  for (const value of [-1, 1001, 0.5, NaN]) assert.throws(() => clearedCountFilename(value));
  assert.throws(() => tagClearedMp4(new Uint8Array(2 * 1024 * 1024 + 1), 0));
  for (const hashes of [[], ['x'], ['a'.repeat(64), 'a'.repeat(64)], Array(1001).fill('a'.repeat(64))]) assert.throws(() => createClearedCountPacket(base, hashes));
});
