import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, sign } from 'node:crypto';
import { RULES, RULES_VERSION, requiredClientFor, relaxationsUsed, versionAtLeast } from '../src/seamless-rules.mjs';
import { supportsAssetDuration } from '../src/asset-duration-policy.mjs';
import { validateManifestSchema, canonicalizeManifest } from '../src/manifest-security.mjs';
import { validateLocalUserEditPacket } from '../src/local-edit-packet.mjs';
import { validateCatalogPacket, verifyCatalogPacket, CATALOG_MIN_CLIENT_VERSION, CATALOG_SHORT_CLIP_MIN_CLIENT_VERSION } from '../src/catalog-packet.mjs';
import { readEditJson } from '../src/ss-normalize.mjs';
import { writeSsArchive } from '../src/ss-archive.mjs';
import { viewerLoadCode, viewerLoadMessage } from '../src/viewer-load-error.mjs';
import { registerViewerWebBridge } from '../src/viewer-web-bridge.mjs';
import { editPackSchema } from '../src/edit-pack-fields.mjs';
import { fixtureManifest } from '../src/fixture-signed-manifest.mjs';
import { localPacket } from './helpers/ss-fixture.mjs';
import * as client064 from './fixtures/client-0.64.4/catalog-packet.mjs';
import { moduleText, vectors, validateRules } from '../../../scripts/build-rules.mjs';

// 0.65.0 (E75 / W9): the single rules source, its generated outputs, the boundary vectors the
// website runs too (rules/vectors/boundaries-v1.json), and the catalog client-version gate.
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const source = JSON.parse(await read('../rules/seamless-rules-v1.json'));
const VECTORS = JSON.parse(await read('../rules/vectors/boundaries-v1.json'));

test('the generated module, edit-pack schema and vectors are current (npm run check:rules)', async () => {
  validateRules(source);
  assert.equal(await read('../src/seamless-rules.mjs'), moduleText(source));
  assert.equal(await read('../rules/vectors/boundaries-v1.json'), JSON.stringify(vectors(source), null, 1) + '\n');
  assert.equal(await read('../../../docs/technical/seamless-edit-pack-v1.schema.json'), JSON.stringify(editPackSchema(source), null, 1) + '\n');
  assert.deepEqual(RULES, source); assert.equal(RULES_VERSION, '1.3.0'); assert.ok(Object.isFrozen(RULES.clip.duration_ms['catalog-v2']));
  assert.throws(() => validateRules({ ...source, relaxations: [{ id: 'new-thing', profile: 'local-user', requires_client: '1.0.0' }] }), /unknown relaxation/);
  // 1.2.0: "unverified" is a local-only tier and the local default; the catalog tiers stay inside the local list.
  assert.throws(() => validateRules({ ...source, source: { ...source.source, local_default_tier: 'ad-free' } }), /local-only tier/);
  // 1.3.0 (E78): an absent country is "ZZ" (CLDR Unknown Region), a valid territory, never a guessed US.
  assert.equal(RULES.source.local_unknown_territory, 'ZZ');
  for (const bad of ['US', 'zz', undefined]) assert.throws(() => validateRules({ ...source, source: { ...source.source, local_unknown_territory: bad } }), /local_unknown_territory must be ZZ/);
  assert.throws(() => validateRules({ ...source, source: { ...source.source, local_tiers: ['unverified'] } }), /every catalog tier/);
});

test('the JSON schemas carry the same clip and source limits', async () => {
  const v1 = JSON.parse(await read('../schemas/manifest-v1.schema.json')), v2 = JSON.parse(await read('../schemas/manifest-v2.schema.json'));
  const local = JSON.parse(await read('../schemas/edit-packet-local-v1.schema.json'));
  assert.equal(v1.$defs.asset.properties.expected_duration_ms.minimum, RULES.clip.duration_ms.mvp.min);
  assert.equal(v1.$defs.asset.properties.expected_duration_ms.maximum, RULES.clip.duration_ms.mvp.max);
  assert.equal(v1.$defs.source.properties.season.anyOf[1].minimum, RULES.source.season[0]);
  assert.equal(local.$defs.localAsset.properties.expected_duration_ms.minimum, RULES.clip.duration_ms['local-user'].min);
  const v2asset = JSON.stringify(v2), v2min = /"expected_duration_ms":\{"type":"integer","minimum":(\d+),"maximum":(\d+)\}/.exec(v2asset.replace(/\s/g, ''));
  assert.deepEqual([Number(v2min[1]), Number(v2min[2])], [RULES.clip.duration_ms['catalog-v2'].min, RULES.clip.duration_ms['catalog-v2'].max]);
  assert.match(v2asset.replace(/\s/g, ''), new RegExp(`"runtime_tolerance_ms":\\{"type":"integer","minimum":0,"maximum":${RULES.source.tolerance_ms.max}\\}`));
});

// Manifests for the boundary vectors.
const catalogManifest = (duration, season = 1) => {
  const m = structuredClone(fixtureManifest); m.schema_version = '2.0.0'; m.edit_id = '50000000-0000-4000-8000-000000000004';
  m.segments = m.segments.filter(s => s.action === 'INSERT'); Object.assign(m.segments[0].asset, { expected_duration_ms: duration, width: 624, height: 480 });
  m.source.season = season; return m;
};
const mvpManifest = (duration, season = 1) => { const m = structuredClone(fixtureManifest); m.segments.find(s => s.asset).asset.expected_duration_ms = duration; m.source.season = season; return m; };
const localManifest = (duration, season = 1) => {
  const { packet } = localPacket({ count: 1 }), s = packet.manifest.segments[0];
  s.asset.expected_duration_ms = duration; s.resume_time_ms = s.trigger_time_ms + Math.max(1, duration); packet.manifest.source.season = season;
  return packet;
};
const manifestOk = (profile, duration, season) => profile === 'local-user' ? validateLocalUserEditPacket(localManifest(duration, season)).ok
  : validateManifestSchema(profile === 'catalog-v2' ? catalogManifest(duration, season) : mvpManifest(duration, season), { profileClass: profile }).errors
    .every(e => !/expected_duration_ms|season|schema_version|edit_id/.test(e.path) || (profile === 'catalog-v2' && /edit_id/.test(e.path)));

test('vectors: clip durations at every boundary, per profile (policy and manifest)', () => {
  assert.ok(VECTORS.clip_duration_ms.length >= 24);
  for (const { profile, ms, accept } of VECTORS.clip_duration_ms) {
    assert.equal(supportsAssetDuration(ms, profile), accept, `policy ${profile} ${ms}`);
    if (ms >= 1) assert.equal(manifestOk(profile, ms, 1), accept, `manifest ${profile} ${ms}`);
  }
  // The required cases: 1,499 refused and 1,500 accepted for local-user and catalog-v2; mvp 4,999 / 5,000.
  const at = (p, ms) => VECTORS.clip_duration_ms.find(v => v.profile === p && v.ms === ms).accept;
  assert.deepEqual([at('local-user', 1499), at('local-user', 1500), at('catalog-v2', 1499), at('catalog-v2', 1500), at('mvp', 4999), at('mvp', 5000)], [false, true, false, true, false, true]);
});

test('vectors: season and episode 0 for every profile (A3)', () => {
  for (const { profile, season, accept } of VECTORS.season_episode) assert.equal(manifestOk(profile, 5000, season), accept, `${profile} season ${season}`);
});

test('vectors: one 5000 ms tolerance for edit.json and catalog-v2; older local and legacy files still read up to 10000', () => {
  const entries = new Map([['clips/a.mp4', {}]]);
  const edit = ms => { try { readEditJson({ id: 'tol', episode: { gti: 'amzn1.dv.gti.x', show: 'S', season: 1, episode: 1, runtime_ms: 3_000_000, runtime_tolerance_ms: ms }, scenes: [{ action: 'REPLACE', start: 1000, end: 6000, clip: 'clips/a.mp4' }] }, entries); return true; } catch { return false; } };
  const withTolerance = (m, ms) => { m.source.runtime_tolerance_ms = ms; return m; };
  for (const { where, ms, accept } of VECTORS.tolerance_ms) {
    const ok = where === 'edit.json' ? edit(ms)
      : where === 'catalog-v2' ? !validateManifestSchema(withTolerance(catalogManifest(5000), ms), { profileClass: 'catalog-v2' }).errors.some(e => /tolerance/.test(e.path))
        : where === 'local-user-read' ? (() => { const p = localManifest(5000); p.manifest.source.runtime_tolerance_ms = ms; return validateLocalUserEditPacket(p).ok; })()
          : !validateManifestSchema(withTolerance(mvpManifest(5000), ms)).errors.some(e => /tolerance/.test(e.path));
    assert.equal(ok, accept, `${where} ${ms}`);
  }
});

test('vectors: the client each edit needs (catalog required_client_version, local .ss min_extension)', async () => {
  for (const { profile, shortest_clip_ms, season, requires } of VECTORS.required_client) {
    const manifest = profile === 'catalog-v2' ? catalogManifest(shortest_clip_ms, season) : localManifest(shortest_clip_ms, season).manifest;
    assert.equal(requiredClientFor(manifest, profile), requires, `${profile} ${shortest_clip_ms} season ${season}`);
  }
  assert.deepEqual(relaxationsUsed(catalogManifest(1500), 'catalog-v2').map(r => r.id), ['clip-under-5000']);
  assert.equal(CATALOG_SHORT_CLIP_MIN_CLIENT_VERSION, '0.65.0'); assert.equal(CATALOG_MIN_CLIENT_VERSION, '0.42.0');
  // .ss files: the writer asks for what the file needs.
  const header = async blob => JSON.parse((await blob.slice(30 + 'seamless-edit.json'.length, 600).text()).replace(/}.*$/s, '}'));
  for (const [duration, season, expected] of [[5000, 1, '0.63.0'], [1500, 1, '0.64.2'], [5000, 0, '0.65.0'], [1500, 0, '0.65.0']]) {
    const { packet, clips } = localPacket({ count: 1 });
    packet.manifest.segments[0].asset.expected_duration_ms = duration; packet.manifest.source.season = season;
    const { blob } = await writeSsArchive({ packet, clips, createdAt: '2026-10-15T12:00:00.000Z', generator: 'test' });
    assert.equal((await header(blob)).min_extension, expected, `${duration} ms, season ${season}`);
  }
  const { packet, clips } = localPacket({ count: 1 }); packet.manifest.source.runtime_tolerance_ms = 6000;
  await assert.rejects(writeSsArchive({ packet, clips }), /ss-packet-invalid/);
});

test('vectors: version_tag, territory and tier, as edit.json reads them', () => {
  const entries = new Map([['clips/a.mp4', {}]]);
  const ok = extra => { try { readEditJson({ id: 'facts', episode: { gti: 'amzn1.dv.gti.x', show: 'S', season: 1, episode: 1, runtime_ms: 3_000_000, ...extra }, scenes: [{ action: 'REPLACE', start: 1000, end: 6000, clip: 'clips/a.mp4' }] }, entries); return true; } catch { return false; } };
  for (const { value, accept } of VECTORS.version_tag) assert.equal(ok({ version_tag: value }), accept, `version_tag ${value}`);
  for (const { value, accept } of VECTORS.territory) assert.equal(ok({ territory: value }), accept, `territory ${value}`);
  for (const { value, accept } of VECTORS.tier) assert.equal(ok({ tier: value }), accept, `tier ${value}`);
});

// Catalog packets for the version gate.
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function keys() { const pair = generateKeyPairSync('ed25519'); return { ...pair, trusted: { 'catalog-isolated-test': { status: 'active', publicKey: Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64') } } }; }
function catalogPacket(key, { duration, required = CATALOG_MIN_CLIENT_VERSION, breakManifest = false }) {
  const manifest = catalogManifest(duration), signature = { algorithm: 'Ed25519', key_id: 'catalog-isolated-test', value: Buffer.alloc(64).toString('base64') };
  manifest.signature = { ...signature };
  if (breakManifest) manifest.status = 'draft';
  const packet = { packet_schema_version: '2.0.0', packet_id: id(1), purpose: 'catalog-distribution', creative_edit_id: id(2), source_variant_id: id(3),
    media_profile: 'catalog-av-v2', required_client_version: required, manifest,
    asset_bindings: [{ sha256: manifest.segments[0].asset.sha256, relative_path: 'clips/one.mp4', bytes: 3 }], signature: { ...signature } };
  manifest.signature.value = sign(null, Buffer.from(canonicalizeManifest(manifest)), key.privateKey).toString('base64');
  packet.signature.value = sign(null, Buffer.from(canonicalizeManifest(packet)), key.privateKey).toString('base64');
  return packet;
}
const capabilities = clientVersion => ({ clientVersion, packetSchemas: ['2.0.0'], mediaProfiles: ['catalog-av-v2'] });

test('version gate (A2): a short-clip packet must ask for 0.65.0; the gate runs before the manifest', async () => {
  const key = keys();
  // Writers: a clip under 5 s with the old 0.42.0 is refused, so no old client is sent one.
  assert.equal(validateCatalogPacket(catalogPacket(key, { duration: 1500 })).code, 'packet-client-version-too-low');
  assert.equal(validateCatalogPacket(catalogPacket(key, { duration: 1500, required: '0.65.0' })).ok, true);
  assert.equal(validateCatalogPacket(catalogPacket(key, { duration: 5000 })).ok, true, 'a 5 s packet keeps 0.42.0');
  // Readers: this client verifies it; a 0.64.4 capability is told to update, not "manifest invalid".
  const verified = await verifyCatalogPacket(catalogPacket(key, { duration: 1500, required: '0.65.0' }), key.trusted, { capabilities: capabilities('0.65.0') });
  assert.equal(verified.code, 'verified');
  const old = await verifyCatalogPacket(catalogPacket(key, { duration: 1500, required: '0.65.0' }), key.trusted, { capabilities: capabilities('0.64.4') });
  assert.deepEqual([old.ok, old.code, old.requiredClientVersion], [false, 'client-update-required', '0.65.0']);
  // Ordering: even a manifest this client cannot read gives the update answer first.
  const unreadable = await verifyCatalogPacket(catalogPacket(key, { duration: 1500, required: '0.65.0', breakManifest: true }), key.trusted, { capabilities: capabilities('0.64.4') });
  assert.equal(unreadable.code, 'client-update-required');
  // A 5 s packet with 0.42.0 still verifies for a 0.42.0 client.
  assert.equal((await verifyCatalogPacket(catalogPacket(key, { duration: 5000 }), key.trusted, { capabilities: capabilities('0.42.0') })).code, 'verified');
});

test('a simulated 0.64.4 client (its own catalog-packet.mjs) refuses a 0.65.0-gated short-clip packet as manifest-invalid', async () => {
  const key = keys(), packet = catalogPacket(key, { duration: 1500, required: '0.65.0' });
  // 0.64.4 checks the manifest first: the 1.5 s clip fails its 5 s catalog floor. This is why the
  // website must gate Watch on required_client_version for clients older than 0.65.0.
  const result = await client064.verifyCatalogPacket(packet, key.trusted, { capabilities: capabilities('0.64.4') });
  assert.deepEqual([result.ok, result.code], [false, 'manifest-invalid']);
  assert.ok(result.errors.some(e => /expected_duration_ms/.test(e.path)));
  // A 5 s packet with 0.42.0 still plays on 0.64.4 (nothing changes for ordinary edits).
  assert.equal((await client064.verifyCatalogPacket(catalogPacket(key, { duration: 5000 }), key.trusted, { capabilities: capabilities('0.64.4') })).code, 'verified');
});

test('"update the extension" has its own message, and the website Watch request can be refused before any download', async () => {
  for (const code of ['client-update-required', 'inner-catalog-client-update-required']) assert.equal(viewerLoadCode(Error(code), 'catalog'), 'viewer-client-update-required');
  assert.equal(viewerLoadMessage('viewer-client-update-required'), 'This edit needs a newer Seamless Scene. Update the extension, then try again.');
  let listener = null; const recorded = [];
  const runtime = { onMessageExternal: { addListener: fn => { listener = fn; } } };
  registerViewerWebBridge(runtime, { pairingOrigin: 'https://seamlessscene.com' }, { service: { recordIntent: async releaseId => { recorded.push(releaseId); return { queued: true }; }, account: async () => null } });
  const send = message => new Promise(resolve => listener({ kind: 'viewer-watch-v1', ...message }, { url: 'https://seamlessscene.com/edits/x', origin: 'https://seamlessscene.com' }, resolve));
  const release = '6b0d5a6e-1111-4222-8333-444455556666';
  const refused = await send({ op: 'watch', releaseId: release, requiredClientVersion: '99.0.0' });
  assert.deepEqual([refused.ok, refused.error, refused.requiredClientVersion], [false, 'client-update-required', '99.0.0']);
  assert.deepEqual(recorded, [], 'nothing queued or downloaded');
  assert.equal((await send({ op: 'watch', releaseId: release, requiredClientVersion: 'not-a-version' })).error, 'release-invalid');
  assert.equal((await send({ op: 'watch', releaseId: release, requiredClientVersion: '0.42.0' })).ok, true);
  assert.equal((await send({ op: 'watch', releaseId: release })).ok, true, 'websites that do not send it are unaffected');
  assert.deepEqual(recorded, [release, release]);
  assert.equal(versionAtLeast('0.65.0', '0.64.10'), true); assert.equal(versionAtLeast('0.64.4', '0.65.0'), false);
});
