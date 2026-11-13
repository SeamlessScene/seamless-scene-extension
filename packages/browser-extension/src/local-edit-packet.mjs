import { validateManifestSchema, verifySignedManifest } from "./manifest-security.mjs";

// Asset validation is not source compatibility. Reject a different playback
// surface before hashing files or presenting an edit as eligible for arming.
export function assertLocalPacketService(packet, serviceId) {
  const actual=packet?.manifest?.source?.service;
  if(!serviceId || actual!==serviceId) {
    throw new Error(actual==='local-native'
      ? 'This packet is for the selected local video. Choose the separately aligned streaming packet.'
      : 'Packet service does not match this player. Choose a packet authored for this service.');
  }
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE_MP4 = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.mp4$/;
const PACKET_KEYS = ["packet_schema_version", "packet_id", "purpose", "manifest", "asset_bindings"];
const BINDING_KEYS = ["sha256", "relative_path"];

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function push(errors, path, code) {
  errors.push(Object.freeze({ path, code }));
}

function exactKeys(value, keys, path, errors) {
  if (!isPlainObject(value)) {
    push(errors, path, "object-required");
    return false;
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) push(errors, `${path}.${key}`, "unknown-field");
  }
  for (const key of keys) {
    if (!(key in value)) push(errors, `${path}.${key}`, "required-field");
  }
  return true;
}

export function isSafeRelativeMediaPath(value) {
  return typeof value === "string" && value.length <= 256 && SAFE_RELATIVE_MP4.test(value);
}

export function supportsLocalEditDimensions(width, height) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width >= 320 && height >= 180 && width <= 4096 && height <= 2160 &&
    width % 2 === 0 && height % 2 === 0;
}

export function manifestAssetHashes(manifest) {
  const hashes = new Set();
  for (const segment of manifest?.segments ?? []) {
    if ((segment?.action === "REPLACE" || segment?.action === "INSERT") && SHA256_HEX.test(segment?.asset?.sha256)) {
      hashes.add(segment.asset.sha256);
    }
  }
  return Object.freeze([...hashes]);
}

function validatePacketSchema(packet, profileClass = "mvp") {
  const errors = [];
  if (!exactKeys(packet, PACKET_KEYS, "$", errors)) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  if (packet.packet_schema_version !== "1.0.0") push(errors, "$.packet_schema_version", "unsupported-schema");
  if (!ID.test(packet.packet_id)) push(errors, "$.packet_id", "invalid-id");
  if (packet.purpose !== "local-research") push(errors, "$.purpose", "unsupported-purpose");

  const manifestValidation = validateManifestSchema(packet.manifest, { profileClass });
  for (const error of manifestValidation.errors) {
    push(errors, `$.manifest${error.path.slice(1)}`, error.code);
  }

  const bindingsByHash = new Map();
  const paths = new Set();
  if (!Array.isArray(packet.asset_bindings) || packet.asset_bindings.length < 1 || packet.asset_bindings.length > 1_000) {
    push(errors, "$.asset_bindings", "invalid-binding-count");
  } else {
    for (let index = 0; index < packet.asset_bindings.length; index += 1) {
      const binding = packet.asset_bindings[index];
      const path = `$.asset_bindings[${index}]`;
      if (!exactKeys(binding, BINDING_KEYS, path, errors)) continue;
      if (!SHA256_HEX.test(binding.sha256)) push(errors, `${path}.sha256`, "invalid-sha256");
      if (!isSafeRelativeMediaPath(binding.relative_path)) push(errors, `${path}.relative_path`, "unsafe-relative-path");
      if (bindingsByHash.has(binding.sha256)) push(errors, `${path}.sha256`, "duplicate-hash-binding");
      if (paths.has(binding.relative_path)) push(errors, `${path}.relative_path`, "duplicate-path-binding");
      bindingsByHash.set(binding.sha256, binding);
      paths.add(binding.relative_path);
    }
  }

  const requiredHashes = new Set(manifestAssetHashes(packet.manifest));
  for (const hash of requiredHashes) {
    if (!bindingsByHash.has(hash)) push(errors, "$.asset_bindings", "missing-manifest-asset");
  }
  for (const hash of bindingsByHash.keys()) {
    if (!requiredHashes.has(hash)) push(errors, "$.asset_bindings", "orphan-binding");
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateLocalEditPacket(packet) {
  return validatePacketSchema(packet);
}

// 0.64.4 (security review F5): how deep a packet's JSON may nest. Real packets nest about 6
// levels; a hostile one 400,000 deep made structuredClone overflow the stack.
export const MAX_PACKET_DEPTH = 64;
/** Whether a parsed JSON value nests deeper than `limit` (checked without recursion). */
export function jsonTooDeep(value, limit = MAX_PACKET_DEPTH) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (depth > limit) return true;
    for (const child of Array.isArray(node) ? node : Object.values(node)) if (child !== null && typeof child === "object") stack.push([child, depth + 1]);
  }
  return false;
}

export function validateLocalUserEditPacket(packet) {
  const localErrors = [];
  if (!isPlainObject(packet)) {
    push(localErrors, "$", "object-required");
    return Object.freeze({ ok: false, errors: Object.freeze(localErrors) });
  }
  if (jsonTooDeep(packet)) {
    push(localErrors, "$", "nested-too-deeply");
    return Object.freeze({ ok: false, errors: Object.freeze(localErrors) });
  }
  if (packet.purpose !== "local-user-edit") push(localErrors, "$.purpose", "local-user-purpose-required");
  if (packet.manifest?.status !== "local-only") push(localErrors, "$.manifest.status", "local-only-status-required");
  if (packet.manifest?.signature !== null) push(localErrors, "$.manifest.signature", "local-signature-must-be-null");
  // No legal gates: a local packet needs no rights block; an old one saying "user-supplied" still loads.
  if (packet.manifest?.rights !== undefined && packet.manifest.rights?.classification !== "user-supplied") {
    push(localErrors, "$.manifest.rights.classification", "user-supplied-rights-required");
  }

  const insertionAnchors = new Set();
  for (let index = 0; index < (packet.manifest?.segments?.length ?? 0); index += 1) {
    const segment = packet.manifest.segments[index];
    if (segment?.action !== "REPLACE" && segment?.action !== "INSERT") {
      push(localErrors, `$.manifest.segments[${index}].action`, "unsupported-local-action");
      continue;
    }
    if (segment.action === "INSERT") {
      if (insertionAnchors.has(segment.trigger_time_ms)) push(localErrors, `$.manifest.segments[${index}]`, "duplicate-insertion-anchor");
      insertionAnchors.add(segment.trigger_time_ms);
    }
    const width = segment.asset?.width;
    const height = segment.asset?.height;
    if (!supportsLocalEditDimensions(width, height)) {
      push(localErrors, `$.manifest.segments[${index}].asset`, "unsupported-local-dimensions");
    }
  }

  const normalized = structuredClone(packet);
  normalized.purpose = "local-research";
  if (isPlainObject(normalized.manifest)) {
    normalized.manifest.status = "released";
    if (isPlainObject(normalized.manifest.rights)) normalized.manifest.rights.classification = "cleared-test";
    normalized.manifest.signature = {
      algorithm: "Ed25519",
      key_id: "local-validation-placeholder",
      value: `${"A".repeat(86)}==`
    };
    for (const segment of normalized.manifest.segments ?? []) {
      if (segment?.action === "REPLACE" || segment?.action === "INSERT") {
        if (isPlainObject(segment.asset)) {
          segment.asset.width = 1280;
          segment.asset.height = 720;
        }
      }
    }
  }
  const normalizedValidation = validatePacketSchema(normalized, "local-user");
  localErrors.push(...normalizedValidation.errors);
  return Object.freeze({ ok: localErrors.length === 0, errors: Object.freeze(localErrors) });
}

// Compatibility alias for packet drafts created before local-user playback was enabled.
export const validateLocalEditPacketDraft = validateLocalUserEditPacket;

export function compileLocalUserEditActions(packet, { resolveAssetUrl = () => null } = {}) {
  const validation = validateLocalUserEditPacket(packet);
  if (!validation.ok) throw new TypeError("Cannot compile an invalid local-user edit packet");
  return Object.freeze(packet.manifest.segments.map((segment) => {
    if (segment.action !== "REPLACE" && segment.action !== "INSERT") {
      throw new TypeError(`Local-user packet action is not supported: ${segment.action}`);
    }
    const clipUrl = resolveAssetUrl(segment.asset.sha256, segment.segment_id);
    if (typeof clipUrl !== "string" || clipUrl.length === 0) {
      throw new TypeError(`Local asset is unresolved for ${segment.segment_id}`);
    }
    return Object.freeze({
      id: segment.segment_id,
      type: segment.action,
      triggerMs: segment.trigger_time_ms,
      resumeMs: segment.resume_time_ms,
      clipUrl,
      expectedDurationMs: segment.asset.expected_duration_ms,
      profileClass: "local-user",
      gainDb: segment.transition.gain_db ?? 0
    });
  }));
}

export async function verifyLocalEditPacket(packet, trustedManifestKeys, cryptoApi = globalThis.crypto) {
  const packetValidation = validateLocalEditPacket(packet);
  if (!packetValidation.ok) {
    return Object.freeze({ ok: false, code: "packet-invalid", errors: packetValidation.errors });
  }
  const signature = await verifySignedManifest(packet.manifest, trustedManifestKeys, cryptoApi);
  return Object.freeze({
    ok: signature.ok,
    code: signature.ok ? "verified" : signature.code,
    errors: signature.errors
  });
}

export function localBindingMap(packet) {
  const validation = validateLocalEditPacket(packet);
  if (!validation.ok) throw new TypeError("Invalid local edit packet");
  return new Map(packet.asset_bindings.map((binding) => [binding.sha256, binding.relative_path]));
}
