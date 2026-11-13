import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFixturePacket } from '../src/fixture-local-packet.mjs';

async function example() {
  const packet = JSON.parse(await readFile(new URL('../media/edit-packet.json', import.meta.url), 'utf8'));
  packet.purpose = 'local-user-edit'; packet.manifest.status = 'local-only';
  packet.manifest.segments = packet.manifest.segments.filter(s => ['REPLACE', 'INSERT'].includes(s.action));
  packet.manifest.feature_flags.skip_enabled = false; packet.manifest.feature_flags.mute_enabled = false;
  packet.manifest.signature = null; packet.manifest.rights.classification = 'user-supplied';
  const manifest = { name: 'edit-packet.json', size: 1000, text: async () => JSON.stringify(packet) };
  return { packet, files: [manifest, { name: 'replacement.mp4', size: 100 }] };
}
test('fixture rejects a movie packet before decoding assets', async () => {
  const {packet, files} = await example(), expected = structuredClone(packet.manifest.source);
  packet.manifest.source.service_content_id = 'different-item';
  await assert.rejects(loadFixturePacket(files, expected, { validateAsset: () => { throw Error('must not decode'); } }), /Fixture source mismatch/);
});
test('fixture imports only validated bound assets and rejects duplicate names', async () => {
  const {packet, files} = await example(); let decoded = 0;
  const loaded = await loadFixturePacket(files, packet.manifest.source, { validateAsset: async (_file, expected) => {
    decoded++; assert.equal(expected.sha256, packet.asset_bindings[0].sha256); return {ok:true};
  }});
  assert.equal(decoded, 1); assert.equal(loaded.files.size, 1);
  await assert.rejects(loadFixturePacket([...files, files[1]], packet.manifest.source), /Duplicate/);
});
test('fixture fails closed on rejected media', async () => {
  const {packet, files} = await example();
  await assert.rejects(loadFixturePacket(files, packet.manifest.source, {validateAsset:async()=>({ok:false,errors:['hash-mismatch']})}), /hash-mismatch/);
});

test('private wrong-service import refuses before hashing or decoding any clip', async () => {
  const { files } = await example(); let validations = 0;
  await assert.rejects(loadFixturePacket(files, null, { expectedService: 'prime-video', validateAsset: async () => { validations++; return {ok:true}; } }), /wrong-service/);
  assert.equal(validations, 0);
});

test('invalid file sizes cannot bypass the packet aggregate byte budget', async () => {
  for (const size of [-1, NaN, Infinity, undefined, 0.5]) {
    const { files } = await example(); files[1].size = size;
    await assert.rejects(loadFixturePacket(files, null), /Invalid local file size/);
  }
});

async function multiple(sizes) {
  const { packet } = await example();
  const template = packet.manifest.segments.find(segment => segment.action === 'INSERT');
  packet.manifest.segments = sizes.map((_, i) => ({ ...structuredClone(template), segment_id: `bounded-${i}`, trigger_time_ms: i + 1, resume_time_ms: i + 1, asset: { ...template.asset, sha256: String(i).padStart(64, '0') } }));
  packet.asset_bindings = sizes.map((_, i) => ({ sha256: packet.manifest.segments[i].asset.sha256, relative_path: `clip-${i}.mp4` }));
  return { packet, files: [{ name: 'edit-packet.json', size: 1000, text: async () => JSON.stringify(packet) }, ...sizes.map((size, i) => ({ name: `clip-${i}.mp4`, size }))] };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('small bound assets validate in pairs and retain binding order despite reversed completion', async () => {
  const { packet, files } = await multiple([100, 100, 100]); const started = [], release = [];
  const loading = loadFixturePacket(files, null, { validateAsset: file => { started.push(file.name); return new Promise(resolve => release.push(() => resolve({ ok: true }))); } });
  await tick(); assert.deepEqual(started, ['clip-0.mp4', 'clip-1.mp4']);
  release[1](); await tick(); assert.equal(started.length, 2);
  release[0](); await tick(); assert.equal(started.length, 3); release[2]();
  const loaded = await loading; assert.deepEqual([...loaded.files.keys()], packet.asset_bindings.map(binding => binding.sha256));
});

test('clips above one hash chunk remain serial, including mixed large/small neighbors', async () => {
  const { files } = await multiple([1048577, 100, 1048577]); const started = [], release = [];
  const loading = loadFixturePacket(files, null, { validateAsset: file => { started.push(file.name); return new Promise(resolve => release.push(() => resolve({ ok: true }))); } });
  for (let i = 0; i < 3; i++) { await tick(); assert.equal(started.length, i + 1); release[i](); }
  await loading;
});

test('one rejected asset cancels its peer and never dispatches the next batch', async () => {
  const { files } = await multiple([100, 100, 100]); const started = []; let peerAborted = false;
  await assert.rejects(loadFixturePacket(files, null, { validateAsset: (file, _expected, { signal }) => {
    started.push(file.name);
    if (file.name === 'clip-0.mp4') return Promise.resolve({ ok: false, errors: ['bad-media'] });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { peerAborted = true; reject(signal.reason); }, { once: true }));
  } }), /bad-media/);
  assert.equal(peerAborted, true); assert.deepEqual(started, ['clip-0.mp4', 'clip-1.mp4']);
});

test('caller cancellation aborts both active validations and prevents further admission', async () => {
  const { files } = await multiple([100, 100, 100]); const controller = new AbortController(); let started = 0, aborted = 0;
  const loading = loadFixturePacket(files, null, { signal: controller.signal, validateAsset: (_file, _expected, { signal }) => { started++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true })); } });
  const rejected = assert.rejects(loading, { name: 'AbortError' }); await tick(); controller.abort(); await rejected;
  assert.equal(started, 2); assert.equal(aborted, 2);
});
