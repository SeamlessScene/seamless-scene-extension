import { SignJWT, jwtVerify, CompactEncrypt, compactDecrypt, calculateJwkThumbprint, exportJWK, base64url } from 'jose';
import { insist, exact, isId, isHash, jsonBytes, requireDescriptor } from './contract.mjs';

export const LEASE_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_SECONDS = 24 * 60 * 60;
export const AUDIENCE = 'seamless-desktop-chrome-protected-candidate';
const sessions = new WeakMap();
const integer = value => Number.isSafeInteger(value) && value >= 0;
export async function installationId(key) {
  const jwk = await exportJWK(key);
  insist(jwk.kty === 'EC' && jwk.crv === 'P-256' && !jwk.d, 'installation-public-key-profile');
  return calculateJwkThumbprint(jwk);
}

// Candidate issuer primitive, not an account/entitlement endpoint. The future
// service MUST authorize account/release access before calling this function.
export async function issueLicense({ descriptor, contentKeys, installationPublicKey, account, signingKey, kid, issuer, now, jti }) {
  const d = requireDescriptor(descriptor);
  insist(isId(account) && isId(kid) && isId(jti) && integer(now) && typeof issuer === 'string' && issuer.length > 0, 'issuer-input');
  insist(contentKeys instanceof Map && contentKeys.size === d.objects.length, 'key-set');
  const keys = d.objects.map(o => {
    const key = contentKeys.get(o.object_id);
    insist(key instanceof Uint8Array && key.length === 32, 'key-set');
    return { object_id: o.object_id, key: base64url.encode(key) };
  });
  const installation = await installationId(installationPublicKey);
  const grant = jsonBytes({ descriptor_sha256: descriptor.sha256, installation_id: installation, keys });
  let wrapped;
  try {
    wrapped = await new CompactEncrypt(grant).setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', typ: 'seamless-content-keys+jwe' }).encrypt(installationPublicKey);
  } finally { grant.fill(0); }
  return new SignJWT({ descriptor_sha256: descriptor.sha256, installation_id: installation, keys_jwe: wrapped })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'seamless-playback-license+jwt', kid })
    .setIssuer(issuer).setAudience(AUDIENCE).setSubject(account).setJti(jti)
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + LEASE_SECONDS).sign(signingKey);
}

export async function openLicense(token, { descriptor, trustedKeys, installationPrivateKey, installationPublicKey,
  account, issuer, now = () => Date.now(), monotonic = () => performance.now() }) {
  const d = requireDescriptor(descriptor);
  insist(isId(account) && typeof issuer === 'string' && issuer.length > 0, 'license-verifier-policy');
  insist(typeof token === 'string' && token.length <= 128_000, 'license-token-limit');
  const started = now(); const startedMono = monotonic();
  insist(Number.isFinite(started) && started >= 0 && Number.isFinite(startedMono), 'clock-invalid');
  let record; let kid; let signingKey;
  const { payload } = await jwtVerify(token, header => {
    insist(exact(header, ['alg', 'typ', 'kid']) && header.alg === 'EdDSA' && header.typ === 'seamless-playback-license+jwt', 'license-header');
    kid = header.kid; record = trustedKeys.get(kid);
    insist(record?.status === 'active', 'license-key-untrusted'); signingKey = record.key; return signingKey;
  }, { algorithms: ['EdDSA'], issuer, audience: AUDIENCE, subject: account, typ: 'seamless-playback-license+jwt',
    currentDate: new Date(started), clockTolerance: 0, requiredClaims: ['iat', 'nbf', 'exp', 'jti', 'sub', 'iss', 'aud'] });
  insist(exact(payload, ['descriptor_sha256', 'installation_id', 'keys_jwe', 'iss', 'aud', 'sub', 'jti', 'iat', 'nbf', 'exp']), 'license-claims');
  insist([payload.iat, payload.nbf, payload.exp].every(integer) && payload.nbf === payload.iat &&
    payload.exp - payload.iat === LEASE_SECONDS && payload.iat * 1000 <= started && isId(payload.jti), 'license-lifetime');
  insist(payload.descriptor_sha256 === descriptor.sha256 && isHash(payload.descriptor_sha256), 'license-release');
  const installation = await installationId(installationPublicKey);
  insist(payload.installation_id === installation, 'license-installation');
  insist(typeof payload.keys_jwe === 'string' && payload.keys_jwe.length <= 100_000, 'key-envelope-limit');
  const decrypted = await compactDecrypt(payload.keys_jwe, installationPrivateKey,
    { keyManagementAlgorithms: ['ECDH-ES'], contentEncryptionAlgorithms: ['A256GCM'] });
  const keys = new Map();
  try {
    insist(decrypted.protectedHeader.typ === 'seamless-content-keys+jwe' &&
      exact(decrypted.protectedHeader, ['alg', 'enc', 'typ', 'epk']) &&
      decrypted.protectedHeader.epk?.kty === 'EC' && decrypted.protectedHeader.epk?.crv === 'P-256', 'key-envelope-type');
    insist(decrypted.plaintext.length <= 64_000, 'key-envelope-limit');
    const grant = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted.plaintext));
    insist(exact(grant, ['descriptor_sha256', 'installation_id', 'keys']) && grant.descriptor_sha256 === descriptor.sha256 && grant.installation_id === installation, 'key-envelope-binding');
    insist(Array.isArray(grant.keys) && grant.keys.length === d.objects.length, 'key-set');
    const expected = new Set(d.objects.map(o => o.object_id));
    for (const entry of grant.keys) {
      insist(exact(entry, ['object_id', 'key']) && expected.delete(entry.object_id) && typeof entry.key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(entry.key), 'key-set');
      const key = base64url.decode(entry.key); insist(key.length === 32 && base64url.encode(key) === entry.key, 'key-set'); keys.set(entry.object_id, key);
    }
    const handle = Object.freeze({ expiresAt: payload.exp * 1000, renewAfter: (payload.exp - REFRESH_SECONDS) * 1000 });
    sessions.set(handle, { descriptor, keys, now, monotonic, started, startedMono, high: started, monoHigh: startedMono, closed: false,
      trustedKeys, kid, signingKey });
    try { assertLicense(handle, descriptor); } catch (error) { closeLicense(handle); throw error; }
    return handle;
  } catch (error) { for (const key of keys.values()) key.fill(0); throw error; }
  finally { decrypted.plaintext.fill(0); }
}
export function assertLicense(handle, descriptor) {
  const s = sessions.get(handle);
  try {
  insist(s && !s.closed && s.descriptor === descriptor, 'license-session-required'); requireDescriptor(descriptor);
  insist(s.trustedKeys.get(s.kid)?.status === 'active' && s.trustedKeys.get(s.kid)?.key === s.signingKey, 'license-key-untrusted');
  const wall = s.now(); const mono = s.monotonic();
  insist(Number.isFinite(wall) && Number.isFinite(mono) && wall >= s.high && mono >= s.monoHigh, 'clock-regression');
  const effective = Math.max(wall, s.started + mono - s.startedMono);
  s.high = wall; s.monoHigh = mono;
  insist(effective < handle.expiresAt, 'license-expired');
  return { renewalDue: effective >= handle.renewAfter };
  } catch (error) { closeLicense(handle); throw error; }
}
export function copyObjectKey(handle, descriptor, id) {
  assertLicense(handle, descriptor); const key = sessions.get(handle).keys.get(id);
  insist(key, 'object-key-missing'); return key.slice();
}
export function closeLicense(handle) {
  const s = sessions.get(handle); if (!s) return;
  s.closed = true; for (const key of s.keys.values()) key.fill(0); s.keys.clear();
}
