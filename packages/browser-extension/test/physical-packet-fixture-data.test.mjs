import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClearedBoundaryPacket, boundaryFileSizes, PACKET_BOUNDARY_BYTES, CLIP_BOUNDARY_BYTES } from '../../fixtures/physical-packet-fixture-data.mjs';
import { validateLocalUserEditPacket } from '../src/local-edit-packet.mjs';
import { loadFixturePacket } from '../src/fixture-local-packet.mjs';

async function data() {
  const base = JSON.parse(await readFile(new URL('../media/edit-packet.json', import.meta.url)));
  const hashes = [1, 2, 3, 4].map(i => String(i).repeat(64));
  const packet = createClearedBoundaryPacket(base, hashes), text = JSON.stringify(packet), size = Buffer.byteLength(text);
  return { packet, text, size, sizes: boundaryFileSizes(size) };
}
test('cleared boundary metadata is valid, independently owned and sums to the exact private aggregate ceiling', async () => {
  const { packet, size, sizes } = await data();
  assert.equal(validateLocalUserEditPacket(packet).ok, true);
  assert.equal(packet.manifest.signature, null);
  assert.equal(packet.manifest.source.service, 'cleared-fixture');
  assert.equal(sizes.reduce((a, b) => a + b, size), PACKET_BOUNDARY_BYTES);
  assert.ok(sizes.every(value => value <= CLIP_BOUNDARY_BYTES && value > 0));
  const alternate = createClearedBoundaryPacket(packet, ['a', 'b', 'c', 'd'].map(c => c.repeat(64)));
  assert.equal(Buffer.byteLength(JSON.stringify(alternate)), size);
  alternate.manifest.segments[0].asset.width = 320;
  assert.equal(packet.manifest.segments[0].asset.width, 1280);
});
test('controlled aggregate boundary refuses the extra byte before metadata read or asset work', async () => {
  const { packet, text, size, sizes } = await data(); let reads = 0, validations = 0;
  const manifest = { name: 'edit-packet.json', size: size + 1, text: async () => { reads++; return text; } };
  const files = [manifest, ...sizes.map((bytes, i) => ({ name: packet.asset_bindings[i].relative_path, size: bytes }))];
  await assert.rejects(loadFixturePacket(files, packet.manifest.source, { validateAsset: () => { validations++; } }), /byte budget exceeded/);
  assert.equal(reads, 0); assert.equal(validations, 0);
  manifest.size = size;
  const result = await loadFixturePacket(files, packet.manifest.source, { validateAsset: async () => { validations++; return { ok: true }; } });
  assert.equal(result.files.size, 4); assert.equal(reads, 1); assert.equal(validations, 4);
  // These controlled size records do not stand in for the separate actual File run.
});
test('boundary fixture rejects invalid metadata sizes and duplicate hashes', async () => {
  for (const size of [NaN, -1, 0, 3, 0.5, 1_048_577]) assert.throws(() => boundaryFileSizes(size));
  const { packet } = await data(); assert.throws(() => createClearedBoundaryPacket(packet, ['a'.repeat(64)].flatMap(x => [x, x, x, x])));
});
