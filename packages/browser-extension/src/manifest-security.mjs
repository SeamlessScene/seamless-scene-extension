import { maximumAssetDurationMs, minimumAssetDurationMs, supportsBoundedAssetDimensions } from "./asset-duration-policy.mjs";
import { RULES } from "./seamless-rules.mjs";

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMVER_MAX = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?\.x$/;
const ACTIONS = new Set(["REPLACE", "INSERT", "SKIP", "MUTE"]);
const TOP_LEVEL_KEYS = [
  "schema_version", "edit_id", "manifest_version", "status", "source", "compatibility",
  "segments", "feature_flags", "content", "signature"
];
// The rights block is optional; files that carry it are still checked.
const OPTIONAL_TOP_LEVEL_KEYS = ["rights"];

export class ManifestSecurityError extends Error {
  constructor(code) {
    super(code);
    this.name = "ManifestSecurityError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIntegerIn(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isId(value) { return typeof value === 'string' && ID.test(value); }
function stringLength(value) { return [...value].length; }
function isTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})[tT](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, sign, zoneHour = '0', zoneMinute = '0'] = parts;
  const y = Number(year), m = Number(month), d = Number(day), h = Number(hour), min = Number(minute), s = Number(second);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || min > 59 || s > 60 || Number(zoneHour) > 23 || Number(zoneMinute) > 59) return false;
  if (s < 60) return true;
  const offset = (Number(zoneHour) * 60 + Number(zoneMinute)) * (sign === '-' ? -1 : 1);
  return ((h * 60 + min - offset) % 1440 + 1440) % 1440 === 1439;
}

function parseSemver(value) {
  const match = typeof value === "string" ? SEMVER.exec(value) : null;
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function parseMaxVersion(value) {
  const exact = parseSemver(value);
  if (exact) return { exact, exclusive: null };
  const wildcard = typeof value === "string" ? SEMVER_MAX.exec(value) : null;
  if (!wildcard) return null;
  const major = Number(wildcard[1]);
  const minor = wildcard[2] === undefined ? null : Number(wildcard[2]);
  if (!Number.isSafeInteger(major) || (minor !== null && !Number.isSafeInteger(minor))) return null;
  if ((minor === null && !Number.isSafeInteger(major + 1)) ||
      (minor !== null && !Number.isSafeInteger(minor + 1))) return null;
  return {
    exact: null,
    exclusive: minor === null ? [major + 1, 0, 0] : [major, minor + 1, 0]
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function evaluateAdapterCompatibility(adapterVersion, compatibility) {
  const current = parseSemver(adapterVersion);
  const minimum = parseSemver(compatibility?.min_adapter_version);
  const maximum = parseMaxVersion(compatibility?.max_adapter_version);
  if (!current || !minimum || !maximum) {
    return Object.freeze({ ok: false, code: "adapter-version-invalid" });
  }
  const rangeValid = maximum.exact
    ? compareVersions(minimum, maximum.exact) <= 0
    : compareVersions(minimum, maximum.exclusive) < 0;
  if (!rangeValid) return Object.freeze({ ok: false, code: "adapter-version-range-invalid" });
  if (compareVersions(current, minimum) < 0) {
    return Object.freeze({ ok: false, code: "adapter-version-below-minimum" });
  }
  const aboveMaximum = maximum.exact
    ? compareVersions(current, maximum.exact) > 0
    : compareVersions(current, maximum.exclusive) >= 0;
  return Object.freeze({
    ok: !aboveMaximum,
    code: aboveMaximum ? "adapter-version-above-maximum" : "adapter-version-compatible"
  });
}

function push(errors, path, code) {
  errors.push(Object.freeze({ path, code }));
}

function exactKeys(value, required, path, errors, optional = []) {
  if (!isPlainObject(value)) {
    push(errors, path, "object-required");
    return false;
  }
  const allowedSet = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) push(errors, `${path}.${key}`, "unknown-field");
  }
  for (const key of required) {
    if (!(key in value)) push(errors, `${path}.${key}`, "required-field");
  }
  return true;
}

function validateAsset(asset, path, errors, profileClass) {
  if (!exactKeys(asset, [
    "sha256", "expected_duration_ms", "container", "video_codec", "audio_codec", "width", "height", "dynamic_range"
  ], path, errors)) return;
  if (typeof asset.sha256 !== 'string' || !SHA256_HEX.test(asset.sha256)) push(errors, `${path}.sha256`, "invalid-sha256");
  if (!isIntegerIn(asset.expected_duration_ms, minimumAssetDurationMs(profileClass), maximumAssetDurationMs(profileClass))) push(errors, `${path}.expected_duration_ms`, "out-of-range");
  if (asset.container !== "video/mp4") push(errors, `${path}.container`, "unsupported-container");
  if (asset.video_codec !== "avc1") push(errors, `${path}.video_codec`, "unsupported-video-codec");
  if (asset.audio_codec !== "mp4a") push(errors, `${path}.audio_codec`, "unsupported-audio-codec");
  const validDimensions = profileClass === 'catalog-v2' ? supportsBoundedAssetDimensions(asset.width, asset.height) :
    [1280, 1920].includes(asset.width) && [720, 1080].includes(asset.height) && asset.width * 9 === asset.height * 16;
  if (!validDimensions) {
    push(errors, path, "unsupported-dimensions");
  }
  if (asset.dynamic_range !== "sdr") push(errors, `${path}.dynamic_range`, "unsupported-dynamic-range");
}

function validateSegment(segment, index, runtimeMs, errors, profileClass) {
  const path = `$.segments[${index}]`;
  if (!exactKeys(segment, [
    "segment_id", "action", "trigger_time_ms", "resume_time_ms", "asset", "transition", "failure_policy"
  ], path, errors)) return;
  if (!isId(segment.segment_id)) push(errors, `${path}.segment_id`, "invalid-id");
  if (!ACTIONS.has(segment.action)) push(errors, `${path}.action`, "unsupported-action");
  if (!isIntegerIn(segment.trigger_time_ms, 0, runtimeMs)) push(errors, `${path}.trigger_time_ms`, "out-of-runtime");
  if (!isIntegerIn(segment.resume_time_ms, 0, runtimeMs)) push(errors, `${path}.resume_time_ms`, "out-of-runtime");
  if (segment.resume_time_ms < segment.trigger_time_ms) push(errors, path, "negative-segment");

  if (segment.action === "INSERT") {
    if (segment.resume_time_ms !== segment.trigger_time_ms) push(errors, path, "insert-must-resume-at-trigger");
  } else if (segment.resume_time_ms <= segment.trigger_time_ms) {
    push(errors, path, "zero-duration-segment");
  }

  const needsAsset = segment.action === "REPLACE" || segment.action === "INSERT";
  if (needsAsset) validateAsset(segment.asset, `${path}.asset`, errors, profileClass);
  else if (segment.asset !== null) push(errors, `${path}.asset`, "asset-not-allowed");

  if (!exactKeys(segment.transition, ["type"], `${path}.transition`, errors, ["gain_db"])) return;
  if (segment.transition.type !== "hard_cut") push(errors, `${path}.transition.type`, "unsupported-transition");
  if ("gain_db" in segment.transition && !isIntegerIn(segment.transition.gain_db, -24, 6)) {
    push(errors, `${path}.transition.gain_db`, "out-of-range");
  }
  if (segment.failure_policy !== "continue_native") push(errors, `${path}.failure_policy`, "unsupported-failure-policy");
}

export function validateManifestSchema(manifest, { profileClass = "mvp" } = {}) {
  const errors = [];
  if (!exactKeys(manifest, TOP_LEVEL_KEYS, "$", errors, OPTIONAL_TOP_LEVEL_KEYS)) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  if (manifest.schema_version !== (profileClass === 'catalog-v2' ? '2.0.0' : '1.0.0')) push(errors, "$.schema_version", "unsupported-schema");
  if (!isId(manifest.edit_id)) push(errors, "$.edit_id", "invalid-id");
  if (!isIntegerIn(manifest.manifest_version, 1, 2_147_483_647)) push(errors, "$.manifest_version", "invalid-version");
  if (manifest.status !== "released") push(errors, "$.status", "unsupported-status");

  if (exactKeys(manifest.source, [
    "service", "territory", "service_content_id", "title", "season", "episode",
    "expected_runtime_ms", "runtime_tolerance_ms", "service_tier", "version_tag"
  ], "$.source", errors)) {
    if (!isId(manifest.source.service)) push(errors, "$.source.service", "invalid-id");
    if (typeof manifest.source.territory !== 'string' || (manifest.source.territory !== "fixture" && !/^[A-Z]{2}$/.test(manifest.source.territory))) push(errors, "$.source.territory", "invalid-territory");
    if (typeof manifest.source.service_content_id !== "string" || stringLength(manifest.source.service_content_id) < 1 || stringLength(manifest.source.service_content_id) > 256) push(errors, "$.source.service_content_id", "invalid-content-id");
    if (typeof manifest.source.title !== "string" || stringLength(manifest.source.title) < 1 || stringLength(manifest.source.title) > 256) push(errors, "$.source.title", "invalid-title");
    // 0.65.0 (rules 1.1.0, A3): season and episode 0 (specials) for every profile.
    for (const field of ["season", "episode"]) {
      if (manifest.source[field] !== null && !isIntegerIn(manifest.source[field], RULES.source[field][0], RULES.source[field][1])) push(errors, `$.source.${field}`, "invalid-coordinate");
    }
    if ((manifest.source.season === null) !== (manifest.source.episode === null)) push(errors, "$.source", "incomplete-episode-coordinates");
    if (!isIntegerIn(manifest.source.expected_runtime_ms, 1_000, 86_400_000)) push(errors, "$.source.expected_runtime_ms", "invalid-runtime");
    // 0.65.0 (A9): one maximum, 5000 ms, for everything written or published (catalog-v2, edit
    // packs, .ss writers). Local and legacy files already on disk with up to 10000 still read.
    const toleranceMax = profileClass === 'catalog-v2' ? RULES.source.tolerance_ms.max : RULES.source.tolerance_ms.legacy_read_max;
    if (!isIntegerIn(manifest.source.runtime_tolerance_ms, 0, toleranceMax)) push(errors, "$.source.runtime_tolerance_ms", "invalid-tolerance");
    if (!isId(manifest.source.service_tier)) push(errors, "$.source.service_tier", "invalid-service-tier");
    if (manifest.source.version_tag !== null && !isId(manifest.source.version_tag)) push(errors, "$.source.version_tag", "invalid-version-tag");
  }

  if (exactKeys(manifest.compatibility, ["min_adapter_version", "max_adapter_version", "verified_at"], "$.compatibility", errors)) {
    const minimum = parseSemver(manifest.compatibility.min_adapter_version);
    const maximum = parseMaxVersion(manifest.compatibility.max_adapter_version);
    if (!minimum || manifest.compatibility.min_adapter_version.length > 32) push(errors, "$.compatibility.min_adapter_version", "invalid-adapter-version");
    if (!maximum || manifest.compatibility.max_adapter_version.length > 32) push(errors, "$.compatibility.max_adapter_version", "invalid-adapter-version");
    if (minimum && maximum) {
      const rangeValid = maximum.exact
        ? compareVersions(minimum, maximum.exact) <= 0
        : compareVersions(minimum, maximum.exclusive) < 0;
      if (!rangeValid) push(errors, "$.compatibility", "invalid-adapter-range");
    }
    if (!isTimestamp(manifest.compatibility.verified_at)) push(errors, "$.compatibility.verified_at", "invalid-timestamp");
  }

  if (!Array.isArray(manifest.segments) || manifest.segments.length < 1 || manifest.segments.length > (profileClass === 'catalog-v2' ? 200 : 1_000)) {
    push(errors, "$.segments", "invalid-segment-count");
  } else {
    let previousResume = -1;
    const ids = new Set();
    const insertions = new Set();
    for (let index = 0; index < manifest.segments.length; index += 1) {
      const segment = manifest.segments[index];
      validateSegment(segment, index, manifest.source?.expected_runtime_ms ?? -1, errors, profileClass);
      if (profileClass === 'catalog-v2' && segment?.action === 'INSERT') {
        if (insertions.has(segment.trigger_time_ms)) push(errors, `$.segments[${index}]`, 'duplicate-insertion-anchor');
        insertions.add(segment.trigger_time_ms);
      }
      if (segment?.trigger_time_ms < previousResume) push(errors, `$.segments[${index}]`, "overlapping-or-unsorted");
      previousResume = Math.max(previousResume, segment?.resume_time_ms ?? previousResume);
      if (ids.has(segment?.segment_id)) push(errors, `$.segments[${index}].segment_id`, "duplicate-id");
      ids.add(segment?.segment_id);
    }
  }

  if (exactKeys(manifest.feature_flags, [
    "replace_enabled", "insert_enabled", "skip_enabled", "mute_enabled", "emergency_disable"
  ], "$.feature_flags", errors)) {
    for (const [key, value] of Object.entries(manifest.feature_flags)) {
      if (typeof value !== "boolean") push(errors, `$.feature_flags.${key}`, "boolean-required");
    }
  }

  if (exactKeys(manifest.content, ["spoilers", "warnings"], "$.content", errors, ["synthetic_media", "real_person_likeness"])) {
    if (typeof manifest.content.spoilers !== "boolean") push(errors, "$.content.spoilers", "boolean-required");
    if (!Array.isArray(manifest.content.warnings) || manifest.content.warnings.length > 32 || manifest.content.warnings.some((value) => typeof value !== "string" || stringLength(value) > 128)) push(errors, "$.content.warnings", "invalid-warnings");
    if ("synthetic_media" in manifest.content && typeof manifest.content.synthetic_media !== "boolean") push(errors, "$.content.synthetic_media", "boolean-required");
    if ("real_person_likeness" in manifest.content && typeof manifest.content.real_person_likeness !== "boolean") push(errors, "$.content.real_person_likeness", "boolean-required");
  }

  if (manifest.rights !== undefined && exactKeys(manifest.rights, ["classification", "approval_reference"], "$.rights", errors)) {
    if (!["cleared-test", "public-domain", "licensed"].includes(manifest.rights.classification)) push(errors, "$.rights.classification", "unsupported-rights-classification");
    if (!isId(manifest.rights.approval_reference)) push(errors, "$.rights.approval_reference", "invalid-approval-reference");
  }

  if (exactKeys(manifest.signature, ["algorithm", "key_id", "value"], "$.signature", errors)) {
    if (manifest.signature.algorithm !== "Ed25519") push(errors, "$.signature.algorithm", "unsupported-signature-algorithm");
    if (!isId(manifest.signature.key_id)) push(errors, "$.signature.key_id", "invalid-key-id");
    if (base64ByteLength(manifest.signature.value) !== 64) push(errors, "$.signature.value", "invalid-signature");
  }

  const enabledByAction = {
    REPLACE: manifest.feature_flags?.replace_enabled,
    INSERT: manifest.feature_flags?.insert_enabled,
    SKIP: manifest.feature_flags?.skip_enabled,
    MUTE: manifest.feature_flags?.mute_enabled
  };
  for (let index = 0; index < (Array.isArray(manifest.segments) ? manifest.segments.length : 0); index += 1) {
    const action = manifest.segments[index]?.action;
    if (ACTIONS.has(action) && enabledByAction[action] !== true) push(errors, `$.segments[${index}].action`, "action-disabled");
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function canonical(value, path) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new ManifestSecurityError("non-canonical-number");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => canonical(entry, `${path}[${index}]`)).join(",")}]`;
  if (!isPlainObject(value)) throw new ManifestSecurityError("non-canonical-value");
  const pairs = [];
  for (const key of Object.keys(value).sort()) {
    if (path === "$.signature" && key === "value") continue;
    pairs.push(`${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`)}`);
  }
  return `{${pairs.join(",")}}`;
}

export function canonicalizeManifest(manifest) {
  return canonical(manifest, "$" );
}

function decodeBase64(value) {
  if (typeof value !== "string" || !BASE64.test(value)) throw new ManifestSecurityError("invalid-base64");
  if (typeof globalThis.atob === "function") {
    const decoded = globalThis.atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  throw new ManifestSecurityError("base64-decoder-unavailable");
}

function base64ByteLength(value) {
  if (typeof value !== "string" || !BASE64.test(value)) return -1;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export async function verifySignedManifest(manifest, trustedKeys, cryptoApi = globalThis.crypto) {
  const schema = validateManifestSchema(manifest);
  if (!schema.ok) return Object.freeze({ ok: false, code: "schema-invalid", errors: schema.errors });
  return verifyEd25519Document(manifest, trustedKeys, cryptoApi);
}

// New catalog manifests are accepted only through an explicitly selected v2
// trust path. Default/legacy manifest verification remains unchanged.
export async function verifyCatalogManifest(manifest, trustedKeys, cryptoApi = globalThis.crypto) {
  const schema = validateManifestSchema(manifest, { profileClass: 'catalog-v2' });
  if (!schema.ok) return Object.freeze({ ok: false, code: 'schema-invalid', errors: schema.errors });
  return verifyEd25519Document(manifest, trustedKeys, cryptoApi);
}

/** Cryptographic primitive. Callers must validate their own document schema.
 * Canonicalization omits only the root signature.value; nested signatures and
 * every envelope binding are included in the signed bytes. */
export async function verifyEd25519Document(manifest, trustedKeys, cryptoApi = globalThis.crypto) {
  if (manifest?.signature?.algorithm !== 'Ed25519' || !isId(manifest.signature.key_id) || base64ByteLength(manifest.signature.value) !== 64) {
    return Object.freeze({ ok: false, code: 'signature-invalid', errors: Object.freeze([]) });
  }
  const keyRecord = trustedKeys?.[manifest.signature.key_id];
  if (!keyRecord) return Object.freeze({ ok: false, code: "unknown-signing-key", errors: Object.freeze([]) });
  if (keyRecord.status === "revoked") return Object.freeze({ ok: false, code: "signing-key-revoked", errors: Object.freeze([]) });
  if (keyRecord.status !== "active") return Object.freeze({ ok: false, code: "signing-key-inactive", errors: Object.freeze([]) });
  if (!cryptoApi?.subtle) throw new ManifestSecurityError("webcrypto-unavailable");

  try {
    const publicKeyBytes = typeof keyRecord.publicKey === "string" ? decodeBase64(keyRecord.publicKey) : keyRecord.publicKey;
    if (!(publicKeyBytes instanceof Uint8Array) || publicKeyBytes.byteLength !== 32) {
      return Object.freeze({ ok: false, code: "invalid-public-key", errors: Object.freeze([]) });
    }
    const publicKey = await cryptoApi.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const verified = await cryptoApi.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      decodeBase64(manifest.signature.value),
      new TextEncoder().encode(canonicalizeManifest(manifest))
    );
    return Object.freeze({ ok: verified, code: verified ? "verified" : "signature-invalid", errors: Object.freeze([]) });
  } catch (error) {
    if (error instanceof ManifestSecurityError) throw error;
    return Object.freeze({ ok: false, code: "signature-invalid", errors: Object.freeze([]) });
  }
}

export function evaluateManifestVersion(candidate, current, { revokedVersions = [] } = {}) {
  const revoked = new Set(revokedVersions);
  if (revoked.has(candidate.manifest_version)) return Object.freeze({ ok: false, code: "manifest-version-revoked" });
  if (!current) return Object.freeze({ ok: true, code: "first-verified-version" });
  if (candidate.edit_id !== current.edit_id) return Object.freeze({ ok: false, code: "edit-id-mismatch" });
  if (candidate.manifest_version < current.manifest_version) return Object.freeze({ ok: false, code: "downgrade-rejected" });
  if (candidate.manifest_version === current.manifest_version) {
    const same = canonicalizeManifest(candidate) === canonicalizeManifest(current) &&
      candidate.signature.value === current.signature.value;
    return Object.freeze({ ok: same, code: same ? "verified-replay" : "immutable-version-conflict" });
  }
  return Object.freeze({ ok: true, code: "upgrade" });
}

export async function resolveManifestActivation({
  candidate,
  lastKnownGood = null,
  currentVerified = lastKnownGood,
  adapterVersion,
  trustedKeys,
  revokedVersions = [],
  cryptoApi = globalThis.crypto,
  now = () => new Date().toISOString()
}) {
  const candidateVerification = await verifySignedManifest(candidate, trustedKeys, cryptoApi);
  const candidateCompatibility = candidateVerification.ok
    ? evaluateAdapterCompatibility(adapterVersion, candidate.compatibility)
    : Object.freeze({ ok: false, code: candidateVerification.code });
  const candidateCanActivate = candidateVerification.ok &&
    (candidate.feature_flags.emergency_disable || candidateCompatibility.ok);
  const versionDecision = candidateCanActivate
    ? evaluateManifestVersion(candidate, currentVerified, { revokedVersions })
    : Object.freeze({ ok: false, code: candidateVerification.ok ? candidateCompatibility.code : candidateVerification.code });

  if (candidateVerification.ok && versionDecision.ok && !candidate.feature_flags.emergency_disable) {
    return Object.freeze({
      status: versionDecision.code === "verified-replay" ? "unchanged" : "activated",
      manifest: candidate,
      audit: Object.freeze({ action: versionDecision.code, reason: "verified-candidate", at: now() })
    });
  }


  if (candidateVerification.ok && versionDecision.ok && candidate.feature_flags.emergency_disable) {
    return Object.freeze({
      status: "disabled",
      manifest: null,
      audit: Object.freeze({ action: "native-only", reason: "emergency-disabled", at: now() })
    });
  }

  const rejectionCode = versionDecision.code;
  const emergencyDisableIsCurrent = currentVerified?.feature_flags?.emergency_disable === true;
  if (!emergencyDisableIsCurrent && lastKnownGood && !new Set(revokedVersions).has(lastKnownGood.manifest_version)) {
    const fallbackVerification = await verifySignedManifest(lastKnownGood, trustedKeys, cryptoApi);
    const fallbackCompatibility = fallbackVerification.ok
      ? evaluateAdapterCompatibility(adapterVersion, lastKnownGood.compatibility)
      : Object.freeze({ ok: false });
    if (fallbackVerification.ok && fallbackCompatibility.ok && !lastKnownGood.feature_flags.emergency_disable) {
      return Object.freeze({
        status: "rolled-back",
        manifest: lastKnownGood,
        audit: Object.freeze({ action: "last-known-good", reason: rejectionCode, at: now() })
      });
    }
  }
  return Object.freeze({
    status: "disabled",
    manifest: null,
    audit: Object.freeze({ action: "native-only", reason: rejectionCode, at: now() })
  });
}
