import { canonicalizeManifest, evaluateManifestVersion, verifyCatalogManifest, evaluateAdapterCompatibility } from './manifest-security.mjs';
import { verifyCatalogPacket, compileVerifiedCatalogActions } from './catalog-packet.mjs';
import { assertActive } from './operation-context.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 2_000_000;
const MAX_AUDIT = 32;
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function keyFor(editId) {
  if (typeof editId !== 'string' || !UUID.test(editId)) throw Error('catalog-edit-id-invalid');
  return `catalogActivation.v2.${editId}`;
}
function encoded(value) { return new TextEncoder().encode(JSON.stringify(value)); }
export async function catalogRecordDigest(record, cryptoApi = globalThis.crypto) {
  if (!record || encoded(record).length > MAX_RECORD_BYTES) throw Error('catalog-cache-invalid');
  const bytes = new TextEncoder().encode(canonicalizeManifest(record));
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
async function packetDigest(packet, cryptoApi) {
  const bytes = new TextEncoder().encode(canonicalizeManifest(packet) + '\n' + packet.signature.value);
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
function sameIdentity(left, right) {
  return left.creativeEditId === right.creativeEditId && left.sourceVariantId === right.sourceVariantId &&
    canonicalizeManifest(left.manifest.source) === canonicalizeManifest(right.manifest.source);
}

/** Extension-origin only. Every writer must use the same Web Lock name.
 * Durable storage and cross-context locking are required: no memory fallback.
 * Records contain signed instructions and digests, never local filenames or files.
 */
export class CatalogActivationStore {
  constructor({ storageArea = globalThis.chrome?.storage?.local, locks = globalThis.navigator?.locks,
    cryptoApi = globalThis.crypto, now = () => new Date().toISOString() } = {}) {
    if (!storageArea?.get || !storageArea?.set || !locks?.request) throw Error('catalog-durable-storage-unavailable');
    this.storage = storageArea; this.locks = locks; this.cryptoApi = cryptoApi; this.now = now;
  }

  async read(editId, { trustedKeys } = {}) {
    const key = keyFor(editId), value = (await this.storage.get(key))[key];
    if (value === undefined) return null;
    const record = structuredClone(value);
    if (encoded(record).length > MAX_RECORD_BYTES || !exact(record, ['recordVersion', 'editId', 'current', 'lastKnownGood', 'audit']) ||
      record.recordVersion !== 2 || record.editId !== editId || !Array.isArray(record.audit) ||
      record.audit.length < 1 || record.audit.length > MAX_AUDIT) throw Error('catalog-cache-invalid');
    for (const entry of [record.current, record.lastKnownGood]) {
      if (entry === null && entry === record.lastKnownGood) continue;
      if (!exact(entry, ['manifest', 'packetDigest', 'releaseId', 'creativeEditId', 'sourceVariantId']) ||
        !HASH.test(entry.packetDigest) || ![entry.releaseId, entry.creativeEditId, entry.sourceVariantId].every(id => typeof id === 'string' && UUID.test(id)) ||
        entry.manifest?.edit_id !== editId) throw Error('catalog-cache-invalid');
      // A known revoked key may authenticate historical evidence of a version
      // floor, but cannot authorize playback. Retain its public key on rotation.
      const signingKey = trustedKeys?.[entry.manifest.signature?.key_id];
      if (!signingKey || !['active', 'revoked'].includes(signingKey.status)) throw Error('catalog-cache-key-unavailable');
      const historicalKeys = { [entry.manifest.signature.key_id]: { ...signingKey, status: 'active' } };
      if (!(await verifyCatalogManifest(entry.manifest, historicalKeys, this.cryptoApi)).ok) throw Error('catalog-cache-signature-invalid');
    }
    const { current, lastKnownGood } = record;
    if (!current || (lastKnownGood && (!sameIdentity(current, lastKnownGood) ||
      lastKnownGood.manifest.feature_flags.emergency_disable || lastKnownGood.manifest.manifest_version > current.manifest.manifest_version)) ||
      (!current.manifest.feature_flags.emergency_disable && canonicalizeManifest(current) !== canonicalizeManifest(lastKnownGood))) throw Error('catalog-cache-state-invalid');
    let sequence = 0;
    for (const item of record.audit) {
      if (!exact(item, ['sequence', 'version', 'action', 'at']) || !Number.isSafeInteger(item.sequence) || item.sequence <= sequence ||
        !Number.isSafeInteger(item.version) || item.version < 1 || item.version > current.manifest.manifest_version ||
        !['accepted', 'disabled'].includes(item.action) || typeof item.at !== 'string' || item.at.length > 64 || !Number.isFinite(Date.parse(item.at))) throw Error('catalog-cache-audit-invalid');
      sequence = item.sequence;
    }
    if (record.audit.at(-1).version !== current.manifest.manifest_version ||
      (record.audit.at(-1).action === 'disabled') !== current.manifest.feature_flags.emergency_disable) throw Error('catalog-cache-audit-invalid');
    return record;
  }

  async accept(packet, { trustedKeys, capabilities, adapterVersion, revokedVersions = [], signal, assertAuthority = () => {} } = {}) {
    const check = () => { assertActive(signal); assertAuthority(); };
    check();
    const candidate = structuredClone(packet);
    const verification = await verifyCatalogPacket(candidate, trustedKeys, { capabilities, cryptoApi: this.cryptoApi });
    if (!verification.ok) throw Error(verification.code);
    check();
    const manifest = candidate.manifest, editId = manifest.edit_id;
    if (!manifest.feature_flags.emergency_disable && !evaluateAdapterCompatibility(adapterVersion, manifest.compatibility).ok) throw Error('catalog-adapter-incompatible');
    const entry = { manifest, packetDigest: await packetDigest(candidate, this.cryptoApi), releaseId: candidate.packet_id,
      creativeEditId: candidate.creative_edit_id, sourceVariantId: candidate.source_variant_id };
    return this.locks.request(keyFor(editId), { mode: 'exclusive', ...(signal ? { signal } : {}) }, async () => {
      check();
      const cached = await this.read(editId, { trustedKeys });
      const decision = evaluateManifestVersion(manifest, cached?.current.manifest, { revokedVersions });
      if (!decision.ok) throw Error(decision.code);
      if (cached && !sameIdentity(entry, cached.current)) throw Error('catalog-playback-identity-conflict');
      if (decision.code === 'verified-replay') {
        if (cached.current.packetDigest !== entry.packetDigest) throw Error('catalog-envelope-version-conflict');
        return { status: manifest.feature_flags.emergency_disable ? 'disabled' : 'unchanged', version: manifest.manifest_version,
          storageRevisionDigest: await catalogRecordDigest(cached, this.cryptoApi) };
      }
      const at = this.now();
      if (typeof at !== 'string' || at.length > 64 || !Number.isFinite(Date.parse(at))) throw Error('catalog-audit-time-invalid');
      const audit = [...(cached?.audit ?? []), { sequence: (cached?.audit.at(-1)?.sequence ?? 0) + 1,
        version: manifest.manifest_version, action: manifest.feature_flags.emergency_disable ? 'disabled' : 'accepted', at }].slice(-MAX_AUDIT);
      if (!Number.isSafeInteger(audit.at(-1).sequence)) throw Error('catalog-audit-sequence-exhausted');
      const record = { recordVersion: 2, editId, current: entry,
        lastKnownGood: manifest.feature_flags.emergency_disable ? cached?.lastKnownGood ?? null : entry, audit };
      if (encoded(record).length > MAX_RECORD_BYTES) throw Error('catalog-cache-too-large');
      // Recheck mutable key policy after lock/storage waits. A cancelled import
      // must not authorize playback, even if its already-started write finishes.
      if (!(await verifyCatalogPacket(candidate, trustedKeys, { capabilities, cryptoApi: this.cryptoApi })).ok) throw Error('catalog-trust-changed');
      check();
      await this.storage.set({ [keyFor(editId)]: record });
      check();
      const saved = await this.read(editId, { trustedKeys });
      if (saved?.current.packetDigest !== entry.packetDigest) throw Error('catalog-cache-write-unconfirmed');
      check();
      return { status: manifest.feature_flags.emergency_disable ? 'disabled' : 'accepted', version: manifest.manifest_version,
        storageRevisionDigest: await catalogRecordDigest(saved, this.cryptoApi) };
    });
  }

  /** Call when arming and before each preflight/action; re-read live policy and
   * durable state. Download grants are deliberately absent from this API. */
  async compile(packet, { trustedKeys, capabilities, adapterVersion, revokedVersions = [], observedSource, resolveAssetUrl, signal, assertAuthority = () => {} } = {}) {
    const check = () => { assertActive(signal); assertAuthority(); };
    check();
    const candidate = structuredClone(packet);
    const verification = await verifyCatalogPacket(candidate, trustedKeys, { capabilities, cryptoApi: this.cryptoApi });
    if (!verification.ok) throw Error(verification.code);
    check();
    return this.locks.request(keyFor(candidate.manifest.edit_id), { mode: 'shared', ...(signal ? { signal } : {}) }, async () => {
      check();
      const record = await this.read(candidate.manifest.edit_id, { trustedKeys });
      if (!record) throw Error('catalog-activation-required');
      if (record.current.manifest.feature_flags.emergency_disable) throw Error('catalog-playback-disabled');
      const decision = evaluateManifestVersion(candidate.manifest, record.current.manifest, { revokedVersions });
      if (!decision.ok) throw Error(decision.code);
      if (decision.code !== 'verified-replay' || record.current.packetDigest !== await packetDigest(candidate, this.cryptoApi)) throw Error('catalog-activation-required');
      const actions = await compileVerifiedCatalogActions(verification, { observedSource, adapterVersion,
        currentManifest: record.current.manifest, revokedVersions, resolveAssetUrl });
      check();
      return actions;
    });
  }
}
