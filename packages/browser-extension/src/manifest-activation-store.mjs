import {
  canonicalizeManifest,
  evaluateAdapterCompatibility,
  resolveManifestActivation,
  verifySignedManifest
} from "./manifest-security.mjs";

const RECORD_VERSION = 1;
const MAX_AUDIT_ENTRIES = 32;
const MAX_RECORD_JSON_LENGTH = 1_000_000;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const AUDIT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RECORD_KEYS = ["recordVersion", "editId", "currentVerified", "lastKnownGood", "audit"];
const AUDIT_KEYS = ["sequence", "actor", "action", "reason", "candidateVersion", "activeVersion", "at"];

function storageKey(editId) {
  if (!ID.test(editId)) throw new TypeError("Invalid manifest edit id");
  return `manifestActivation.v${RECORD_VERSION}.${editId}`;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isVersion(value, { nullable = false } = {}) {
  return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647);
}

function isAuditEntry(entry, previousSequence) {
  return hasExactKeys(entry, AUDIT_KEYS) &&
    Number.isSafeInteger(entry.sequence) && entry.sequence > previousSequence &&
    AUDIT_ID.test(entry.actor) && AUDIT_ID.test(entry.action) && AUDIT_ID.test(entry.reason) &&
    isVersion(entry.candidateVersion, { nullable: true }) &&
    isVersion(entry.activeVersion, { nullable: true }) &&
    typeof entry.at === "string" && entry.at.length <= 64 && Number.isFinite(Date.parse(entry.at));
}

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function sameSignedManifest(left, right) {
  return canonicalizeManifest(left) === canonicalizeManifest(right) &&
    left.signature.value === right.signature.value;
}

async function validateRecord(record, editId, { trustedKeys, revokedVersions, adapterVersion, cryptoApi }) {
  let serialized;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return Object.freeze({ ok: false, code: "cache-not-serializable" });
  }
  if (!serialized || serialized.length > MAX_RECORD_JSON_LENGTH || !hasExactKeys(record, RECORD_KEYS)) {
    return Object.freeze({ ok: false, code: "cache-record-invalid" });
  }
  if (record.recordVersion !== RECORD_VERSION || record.editId !== editId || !ID.test(record.editId)) {
    return Object.freeze({ ok: false, code: "cache-record-invalid" });
  }
  if (!Array.isArray(record.audit) || record.audit.length > MAX_AUDIT_ENTRIES) {
    return Object.freeze({ ok: false, code: "cache-audit-invalid" });
  }
  let sequence = 0;
  for (const entry of record.audit) {
    if (!isAuditEntry(entry, sequence)) return Object.freeze({ ok: false, code: "cache-audit-invalid" });
    sequence = entry.sequence;
  }

  const { currentVerified, lastKnownGood } = record;
  if ((currentVerified !== null && !isPlainObject(currentVerified)) ||
      (lastKnownGood !== null && !isPlainObject(lastKnownGood))) {
    return Object.freeze({ ok: false, code: "cache-manifest-invalid" });
  }
  if (currentVerified === null && lastKnownGood !== null) {
    return Object.freeze({ ok: false, code: "cache-state-invalid" });
  }

  const revoked = new Set(revokedVersions);
  const currentIsEmergencyDisable = currentVerified?.feature_flags?.emergency_disable === true;
  for (const manifest of [currentVerified, lastKnownGood]) {
    if (!manifest) continue;
    if (manifest.edit_id !== editId || revoked.has(manifest.manifest_version)) {
      return Object.freeze({ ok: false, code: "cache-manifest-revoked" });
    }
    const verification = await verifySignedManifest(manifest, trustedKeys, cryptoApi);
    if (!verification.ok) return Object.freeze({ ok: false, code: `cache-${verification.code}` });
    const compatibility = evaluateAdapterCompatibility(adapterVersion, manifest.compatibility);
    const inactiveHistoryBehindDisable = currentIsEmergencyDisable && manifest === lastKnownGood;
    if (!manifest.feature_flags.emergency_disable && !inactiveHistoryBehindDisable && !compatibility.ok) {
      return Object.freeze({ ok: false, status: "incompatible-cache", code: `cache-${compatibility.code}` });
    }
  }

  if (lastKnownGood?.feature_flags.emergency_disable) {
    return Object.freeze({ ok: false, code: "cache-last-known-good-disabled" });
  }
  if (currentVerified && lastKnownGood) {
    if (lastKnownGood.manifest_version > currentVerified.manifest_version) {
      return Object.freeze({ ok: false, code: "cache-state-invalid" });
    }
    if (!currentVerified.feature_flags.emergency_disable && !sameSignedManifest(currentVerified, lastKnownGood)) {
      return Object.freeze({ ok: false, code: "cache-state-invalid" });
    }
  }

  return Object.freeze({ ok: true, code: "cache-verified" });
}

function buildAuditEntry({ previousAudit, actor, activation, candidate, at }) {
  if (!AUDIT_ID.test(actor)) throw new TypeError("Invalid manifest audit actor");
  if (typeof at !== "string" || at.length > 64 || !Number.isFinite(Date.parse(at))) {
    throw new TypeError("Invalid manifest audit timestamp");
  }
  const previousSequence = previousAudit.at(-1)?.sequence ?? 0;
  const candidateVersion = isVersion(candidate?.manifest_version) ? candidate.manifest_version : null;
  const activeVersion = isVersion(activation.manifest?.manifest_version) ? activation.manifest.manifest_version : null;
  return Object.freeze({
    sequence: previousSequence + 1,
    actor,
    action: activation.audit.action,
    reason: activation.audit.reason,
    candidateVersion,
    activeVersion,
    at
  });
}

export class ManifestActivationStore {
  constructor({ storageArea = globalThis.chrome?.storage?.local } = {}) {
    this.storageArea = storageArea ?? null;
    this.memory = new Map();
    this.durable = Boolean(storageArea);
  }

  async read(editId, { trustedKeys, revokedVersions = [], adapterVersion, cryptoApi = globalThis.crypto } = {}) {
    const key = storageKey(editId);
    const value = this.storageArea
      ? (await this.storageArea.get(key))[key]
      : this.memory.get(key);
    if (value === undefined) {
      return Object.freeze({ status: "missing", currentVerified: null, lastKnownGood: null, audit: Object.freeze([]) });
    }
    const record = clone(value);
    const validation = await validateRecord(record, editId, { trustedKeys, revokedVersions, adapterVersion, cryptoApi });
    if (!validation.ok) {
      return Object.freeze({ status: validation.status ?? "invalid-cache", code: validation.code, currentVerified: null, lastKnownGood: null, audit: Object.freeze([]) });
    }
    return Object.freeze({
      status: record.currentVerified?.feature_flags.emergency_disable ? "disabled" : "ready",
      code: validation.code,
      currentVerified: record.currentVerified,
      lastKnownGood: record.lastKnownGood,
      manifest: record.currentVerified?.feature_flags.emergency_disable ? null : record.lastKnownGood,
      audit: Object.freeze(record.audit)
    });
  }

  async activate({
    editId,
    candidate,
    trustedKeys,
    revokedVersions = [],
    adapterVersion,
    actor = "update-channel",
    cryptoApi = globalThis.crypto,
    now = () => new Date().toISOString()
  }) {
    const cached = await this.read(editId, { trustedKeys, revokedVersions, adapterVersion, cryptoApi });
    const usableCache = cached.status === "ready" || cached.status === "disabled";
    const activation = await resolveManifestActivation({
      candidate,
      currentVerified: usableCache ? cached.currentVerified : null,
      lastKnownGood: usableCache ? cached.lastKnownGood : null,
      trustedKeys,
      revokedVersions,
      adapterVersion,
      cryptoApi,
      now
    });

    const candidateWasVerified = ["verified-candidate", "emergency-disabled"].includes(activation.audit.reason);
    let currentVerified = usableCache ? cached.currentVerified : null;
    let lastKnownGood = usableCache ? cached.lastKnownGood : null;
    if (candidateWasVerified) {
      currentVerified = candidate;
      if (!candidate.feature_flags.emergency_disable) lastKnownGood = candidate;
    }
    const at = activation.audit.at;
    const priorAudit = usableCache ? cached.audit : [];
    const auditEntry = buildAuditEntry({ previousAudit: priorAudit, actor, activation, candidate, at });
    const audit = Object.freeze([...priorAudit, auditEntry].slice(-MAX_AUDIT_ENTRIES));
    const record = {
      recordVersion: RECORD_VERSION,
      editId,
      currentVerified: currentVerified ? clone(currentVerified) : null,
      lastKnownGood: lastKnownGood ? clone(lastKnownGood) : null,
      audit: clone(audit)
    };
    const key = storageKey(editId);
    if (this.storageArea) await this.storageArea.set({ [key]: record });
    else this.memory.set(key, record);

    return Object.freeze({
      ...activation,
      durable: this.durable,
      cacheStatus: cached.status,
      audit: auditEntry
    });
  }

  async clear(editId) {
    const key = storageKey(editId);
    if (this.storageArea) await this.storageArea.remove(key);
    else this.memory.delete(key);
  }
}

export const manifestActivationStoreLimits = Object.freeze({
  recordVersion: RECORD_VERSION,
  maxAuditEntries: MAX_AUDIT_ENTRIES,
  maxRecordJsonLength: MAX_RECORD_JSON_LENGTH
});
