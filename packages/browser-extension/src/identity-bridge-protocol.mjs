import { BUILD_ID } from './build-info.mjs';
// Build-scoped compatibility only: same-page messages are never authentication.
export const IDENTITY_BRIDGE_PROTOCOL = `scene-substitution-source-identity/v1${BUILD_ID ? `/${BUILD_ID}` : ''}`;
export const CLEARED_FIXTURE_BRIDGE_PROTOCOL = 'scene-substitution-source-identity/v1';
export const IDENTITY_BRIDGE_SCHEMA_VERSION = 1;

export const IDENTITY_BRIDGE_REQUEST_KINDS = Object.freeze([
  "connect",
  "read-identity",
  "close"
]);

const SNAPSHOT_KEYS = Object.freeze([
  "schemaVersion",
  "serviceId",
  "activeItemId",
  "mediaType",
  "season",
  "episode",
  "canonicalTimeMs",
  "runtimeMs",
  "versionTag",
  "territory",
  "plan",
  "lifecycleGeneration",
  "provenance"
]);

const PROVENANCE_KEYS = Object.freeze([
  "activeItemId",
  "mediaType",
  "season",
  "episode",
  "canonicalTimeMs",
  "runtimeMs",
  "versionTag",
  "territory",
  "plan",
  "lifecycleGeneration"
]);

const MEDIA_TYPES = new Set(["film", "episode", "unknown"]);
const PROVENANCE_VALUES = new Set([
  "fixture-player-state",
  "fixture-manifest",
  "provider-player-state",
  "provider-lifecycle-state",
  "provider-current-position",
  "provider-content-relative-time",
  "provider-time-data-method",
  "standard-media-element",
  "not-available"
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_RUNTIME_MS = 24 * 60 * 60 * 1000;

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

function nullablePattern(value, pattern) {
  return value === null || (typeof value === "string" && pattern.test(value));
}

function nullableInteger(value, minimum, maximum) {
  return value === null || (Number.isInteger(value) && value >= minimum && value <= maximum);
}

export function sanitizeIdentitySnapshot(value) {
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) throw new TypeError("identity-snapshot-schema-invalid");
  if (value.schemaVersion !== IDENTITY_BRIDGE_SCHEMA_VERSION) throw new TypeError("identity-snapshot-version-invalid");
  if (typeof value.serviceId !== "string" || !LABEL_PATTERN.test(value.serviceId)) throw new TypeError("identity-service-invalid");
  if (!nullablePattern(value.activeItemId, IDENTIFIER_PATTERN)) throw new TypeError("identity-active-item-invalid");
  if (!MEDIA_TYPES.has(value.mediaType)) throw new TypeError("identity-media-type-invalid");
  if (!nullableInteger(value.season, 1, 999)) throw new TypeError("identity-season-invalid");
  if (!nullableInteger(value.episode, 1, 9999)) throw new TypeError("identity-episode-invalid");
  if (!nullableInteger(value.canonicalTimeMs, 0, MAX_RUNTIME_MS)) throw new TypeError("identity-time-invalid");
  if (!nullableInteger(value.runtimeMs, 1_000, MAX_RUNTIME_MS)) throw new TypeError("identity-runtime-invalid");
  if (!nullablePattern(value.versionTag, IDENTIFIER_PATTERN)) throw new TypeError("identity-version-invalid");
  if (!nullablePattern(value.territory, LABEL_PATTERN)) throw new TypeError("identity-territory-invalid");
  if (!nullablePattern(value.plan, LABEL_PATTERN)) throw new TypeError("identity-plan-invalid");
  if (!Number.isInteger(value.lifecycleGeneration) || value.lifecycleGeneration < 1 || value.lifecycleGeneration > 1_000_000_000) {
    throw new TypeError("identity-generation-invalid");
  }
  if (value.mediaType === "episode" && (!Number.isInteger(value.season) || !Number.isInteger(value.episode))) {
    throw new TypeError("identity-episode-fields-missing");
  }
  if (value.mediaType !== "episode" && (value.season !== null || value.episode !== null)) {
    throw new TypeError("identity-episode-fields-unexpected");
  }
  if (value.canonicalTimeMs !== null && value.runtimeMs !== null && value.canonicalTimeMs > value.runtimeMs) {
    throw new TypeError("identity-time-beyond-runtime");
  }
  if (!hasExactKeys(value.provenance, PROVENANCE_KEYS)) throw new TypeError("identity-provenance-schema-invalid");
  for (const key of PROVENANCE_KEYS) {
    if (!PROVENANCE_VALUES.has(value.provenance[key])) throw new TypeError("identity-provenance-value-invalid");
  }

  return Object.freeze({
    ...value,
    provenance: Object.freeze({ ...value.provenance })
  });
}

export function isValidBridgeChannelId(value) {
  return typeof value === "string" && /^[a-f0-9]{32,128}$/.test(value);
}

export function isValidBridgeRequestId(value) {
  return typeof value === "string" && /^request-[1-9]\d{0,8}$/.test(value);
}

export function validateBridgeRequest(value, protocol = IDENTITY_BRIDGE_PROTOCOL) {
  if (!hasExactKeys(value, ["protocol", "schemaVersion", "kind", "channelId", "requestId"])) return false;
  return value.protocol === protocol
    && value.schemaVersion === IDENTITY_BRIDGE_SCHEMA_VERSION
    && IDENTITY_BRIDGE_REQUEST_KINDS.includes(value.kind)
    && isValidBridgeChannelId(value.channelId)
    && isValidBridgeRequestId(value.requestId);
}

export function validateBridgeResponse(value, protocol = IDENTITY_BRIDGE_PROTOCOL) {
  if (!isPlainObject(value)) return false;
  const expectedKeys = value.ok
    ? ["protocol", "schemaVersion", "kind", "channelId", "requestId", "ok", "payload"]
    : ["protocol", "schemaVersion", "kind", "channelId", "requestId", "ok", "errorCode"];
  if (!hasExactKeys(value, expectedKeys)) return false;
  return value.protocol === protocol
    && value.schemaVersion === IDENTITY_BRIDGE_SCHEMA_VERSION
    && value.kind === "response"
    && isValidBridgeChannelId(value.channelId)
    && isValidBridgeRequestId(value.requestId)
    && typeof value.ok === "boolean"
    && (value.ok || (typeof value.errorCode === "string" && LABEL_PATTERN.test(value.errorCode)));
}

export function validateBridgeNotification(value, protocol = IDENTITY_BRIDGE_PROTOCOL) {
  if (!hasExactKeys(value, ["protocol", "schemaVersion", "kind", "channelId", "payload"])) return false;
  return value.protocol === protocol
    && value.schemaVersion === IDENTITY_BRIDGE_SCHEMA_VERSION
    && value.kind === "identity-changed"
    && isValidBridgeChannelId(value.channelId);
}
