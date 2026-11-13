import { generateKeyPairSync, sign } from 'node:crypto';
import { fixtureManifest } from '../../src/fixture-signed-manifest.mjs';
import { canonicalizeManifest } from '../../src/manifest-security.mjs';
import { CatalogActivationStore } from '../../src/catalog-activation-store.mjs';
const id = n => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function key(name = 'isolated-catalog-test') {
  const pair = generateKeyPairSync('ed25519');
  return { ...pair, name, record: { status: 'active', publicKey: Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64') } };
}
function signed(packet, signingKey) {
  const signature = { algorithm: 'Ed25519', key_id: signingKey.name, value: Buffer.alloc(64).toString('base64') };
  packet.manifest.signature = { ...signature }; packet.signature = { ...signature };
  packet.manifest.signature.value = sign(null, Buffer.from(canonicalizeManifest(packet.manifest)), signingKey.privateKey).toString('base64');
  packet.signature.value = sign(null, Buffer.from(canonicalizeManifest(packet)), signingKey.privateKey).toString('base64');
  return packet;
}
function packet(signingKey, { version = 2, disabled = false, source = 3, media = false } = {}) {
  const manifest = structuredClone(fixtureManifest);
  manifest.schema_version = '2.0.0'; manifest.edit_id = id(source + 100); manifest.manifest_version = version;
  manifest.feature_flags.emergency_disable = disabled;
  manifest.segments = manifest.segments.filter(segment => segment.action === (media ? 'INSERT' : 'SKIP'));
  if (media) Object.assign(manifest.segments[0].asset, { expected_duration_ms: 120000, width: 624, height: 480 });
  return signed({ packet_schema_version: '2.0.0', packet_id: id(version), purpose: 'catalog-distribution', creative_edit_id: id(90), source_variant_id: id(source),
    media_profile: 'catalog-av-v2', required_client_version: '0.42.0', manifest,
    asset_bindings: media ? [{ sha256: manifest.segments[0].asset.sha256, relative_path: 'private-name.mp4', bytes: 3 }] : [] }, signingKey);
}
function sourceOf(value) {
  const s = value.manifest.source;
  return { serviceId: s.service, activeItemId: s.service_content_id, runtimeMs: s.expected_runtime_ms, season: s.season,
    episode: s.episode, mediaType: s.season === null ? 'movie' : 'episode', versionTag: s.version_tag, territory: s.territory, plan: s.service_tier };
}
function harness() {
  const signingKey = key(), records = {}, pending = new Map();
  // Deterministic doubles for durable StorageArea and cross-context Web Locks.
  // Browser persistence/partitioning is a separate integration gate.
  const storageArea = { async get(name) { return structuredClone({ [name]: records[name] }); },
    async set(values) { if (storageArea.fail) throw Error('storage-unavailable'); Object.assign(records, structuredClone(values)); } };
  const locks = { request(name, options, callback) {
    const prior = pending.get(name) ?? Promise.resolve();
    const run = prior.catch(() => {}).then(() => { options.signal?.throwIfAborted(); return callback(); });
    pending.set(name, run); return run;
  } };
  const policy = { trustedKeys: { [signingKey.name]: signingKey.record }, adapterVersion: '0.42.0',
    capabilities: { clientVersion: '0.42.0', packetSchemas: ['2.0.0'], mediaProfiles: ['catalog-av-v2'] }, revokedVersions: [] };
  const createStore = () => new CatalogActivationStore({ storageArea, locks });
  return { signingKey, records, storageArea, locks, policy, createStore, store: createStore() };
}
const metadata = value => new File([JSON.stringify(value)], 'edit-packet.json', { type: 'application/json' });

export { id, key, signed, packet, sourceOf, harness, metadata };

