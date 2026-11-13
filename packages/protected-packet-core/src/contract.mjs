import { CompactSign, compactVerify } from 'jose';

// Candidate identifiers intentionally cannot be confused with catalog packet v2.
export const FORMAT = 'seamless-protected-candidate-1';
export const PROFILE = 'secretstream-xchacha20poly1305-1m-v1';
export const CHUNK = 1_048_576;
export const LIMITS = Object.freeze({ descriptor: 128_000, packet: 2_000_000, asset: 250_000_000, total: 2_002_000_000, objects: 201 });
const verified = new WeakMap();
const encoder = new TextEncoder();
export const bytes = value => encoder.encode(value);
export const jsonBytes = value => bytes(JSON.stringify(value));
export function insist(condition, code) { if (!condition) throw new Error(code); }
export function exact(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function ciphertextSize(size) { return 24 + size + Math.ceil(size / CHUNK) * 17; }
export function validateDescriptor(input, { allowPrivateDesign = false } = {}) {
  const d = structuredClone(input);
  insist(exact(d, ['format', 'release_id', 'key_access', 'publication', 'crypto_profile', 'required_capabilities', 'objects']), 'descriptor-shape');
  insist(d.format === FORMAT && d.crypto_profile === PROFILE && isId(d.release_id), 'descriptor-profile');
  insist(['platform-key', 'creator-secret'].includes(d.key_access), 'key-access-unsupported');
  insist(d.publication === (d.key_access === 'platform-key' ? 'reviewed-catalog-v2' : 'creator-private'), 'publication-mode-conflict');
  insist(d.key_access === 'platform-key' || allowPrivateDesign, 'creator-private-not-enabled');
  insist(Array.isArray(d.required_capabilities) && d.required_capabilities.length === 2 &&
    d.required_capabilities[0] === PROFILE && d.required_capabilities[1] === d.key_access, 'required-capabilities-unsupported');
  insist(Array.isArray(d.objects) && d.objects.length >= 1 && d.objects.length <= LIMITS.objects, 'object-count');
  const names = new Set(); let total = 0; let mediaTotal = 0; let packets = 0;
  for (const o of d.objects) {
    insist(exact(o, ['object_id', 'kind', 'plaintext_bytes', 'ciphertext_bytes', 'ciphertext_sha256']), 'object-shape');
    insist(isId(o.object_id) && !names.has(o.object_id), 'object-identity'); names.add(o.object_id);
    insist(o.kind === 'packet' || o.kind === 'media', 'object-kind');
    if (o.kind === 'packet') packets++;
    const limit = o.kind === 'packet' ? LIMITS.packet : LIMITS.asset;
    insist(Number.isSafeInteger(o.plaintext_bytes) && o.plaintext_bytes > 0 && o.plaintext_bytes <= limit, 'plaintext-limit');
    insist(o.ciphertext_bytes === ciphertextSize(o.plaintext_bytes) && isHash(o.ciphertext_sha256), 'ciphertext-binding');
    total += o.plaintext_bytes; if (o.kind === 'media') mediaTotal += o.plaintext_bytes;
  }
  insist(packets === 1 && total <= LIMITS.total && mediaTotal <= 2_000_000_000, 'aggregate-limit');
  insist(jsonBytes(d).length <= LIMITS.descriptor, 'descriptor-limit');
  return d;
}
export function objectAAD(d, o) {
  // Exact array serialization is the candidate AAD format. No sorted-JSON claim.
  return jsonBytes([FORMAT, d.release_id, d.key_access, d.publication, PROFILE, o.object_id, o.kind, o.plaintext_bytes]);
}
export async function signDescriptor(descriptor, privateKey, kid, options) {
  insist(isId(kid), 'descriptor-key-id');
  const d = validateDescriptor(descriptor, options);
  return new CompactSign(jsonBytes(d)).setProtectedHeader({ alg: 'EdDSA', typ: 'seamless-protected-descriptor+jws', kid }).sign(privateKey);
}
export async function verifyDescriptor(token, trustedKeys) {
  insist(typeof token === 'string' && token.length <= 180_000, 'descriptor-token-limit');
  let signingKey;
  const { payload, protectedHeader } = await compactVerify(token, header => {
    insist(exact(header, ['alg', 'typ', 'kid']) && header.alg === 'EdDSA' && header.typ === 'seamless-protected-descriptor+jws', 'descriptor-header');
    const record = trustedKeys.get(header.kid);
    insist(record?.status === 'active', 'descriptor-key-untrusted');
    signingKey = record.key; return signingKey;
  }, { algorithms: ['EdDSA'] });
  insist(payload.length <= LIMITS.descriptor, 'descriptor-limit');
  const descriptor = validateDescriptor(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)));
  const handle = Object.freeze({ descriptor: deepFreeze(descriptor), sha256: await digest(bytes(token)) });
  verified.set(handle, { token, trustedKeys, kid: protectedHeader.kid, key: signingKey });
  requireDescriptor(handle); return handle;
}
export function requireDescriptor(handle) {
  const record = verified.get(handle);
  insist(record && record.trustedKeys.get(record.kid)?.status === 'active' && record.trustedKeys.get(record.kid)?.key === record.key, 'verified-descriptor-required');
  return handle.descriptor;
}
function deepFreeze(value) { if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); } return value; }

export function descriptorToken(handle) { requireDescriptor(handle); return verified.get(handle).token; }
