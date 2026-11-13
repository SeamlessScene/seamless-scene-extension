import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, CompactSign } from 'jose';
import { FORMAT, PROFILE, CHUNK, LIMITS, validateDescriptor, signDescriptor, verifyDescriptor, requireDescriptor, digest, bytes, jsonBytes } from '../src/contract.mjs';
import { newContentKey, encryptObject, decryptObject } from '../src/files.mjs';
import { issueLicense, openLicense, closeLicense, assertLicense, LEASE_SECONDS, AUDIENCE } from '../src/license.mjs';
import { combineTransport, splitTransport } from '../src/transport.mjs';
import { importProtectedObjects, resolveObjects } from '../src/importer.mjs';

const epoch = 1_800_000_000;
const descriptorKeys = await generateKeyPair('EdDSA');
const licenseKeys = await generateKeyPair('EdDSA');
const installation = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
function writer() {
  return { chunks: [], committed: false, aborted: false,
    async write(value) { this.chunks.push(value.slice()); },
    async commit(evidence) { this.committed = true; this.evidence = evidence; },
    async abort() { this.chunks = []; this.aborted = true; this.committed = false; },
    blob() { return new Blob(this.chunks); } };
}
function transaction() {
  return { writers: [], committed: false, aborted: false,
    async open() { const w = writer(); this.writers.push(w); return w; },
    async commit(evidence) { this.evidence = evidence; this.committed = true; },
    async abort() { this.aborted = true; this.committed = false; for (const w of this.writers) await w.abort(); } };
}
async function fixture({ size = 31, mode = 'platform-key' } = {}) {
  const context = { format: FORMAT, release_id: 'release-1', key_access: mode,
    publication: mode === 'platform-key' ? 'reviewed-catalog-v2' : 'creator-private', crypto_profile: PROFILE,
    required_capabilities: [PROFILE, mode] };
  const original = new Uint8Array(size); for (let i = 0; i < size; i++) original[i] = i % 251;
  const key = await newContentKey();
  const encrypted = await encryptObject(new Blob([original]), key, { ...context, object_id: 'packet', kind: 'packet' });
  const d = { ...context, objects: [encrypted.binding] };
  const token = await signDescriptor(d, descriptorKeys.privateKey, 'publisher', { allowPrivateDesign: true });
  const trusted = new Map([['publisher', { key: descriptorKeys.publicKey, status: 'active' }]]);
  const handle = mode === 'platform-key' ? await verifyDescriptor(token, trusted) : null;
  const keys = new Map([['packet', key]]);
  const f = { original, key, encrypted, d, token, trusted, handle, keys };
  if (!handle) return f;
  f.licenseTrust = new Map([['license', { key: licenseKeys.publicKey, status: 'active' }]]);
  f.clock = { wall: epoch * 1000, mono: 0 };
  f.licenseToken = await issueLicense({ descriptor: handle, contentKeys: keys, installationPublicKey: installation.publicKey,
    account: 'viewer', signingKey: licenseKeys.privateKey, kid: 'license', issuer: 'https://license.invalid', now: epoch, jti: 'grant-1' });
  f.options = { descriptor: handle, trustedKeys: f.licenseTrust, installationPrivateKey: installation.privateKey,
    installationPublicKey: installation.publicKey, account: 'viewer', issuer: 'https://license.invalid',
    now: () => f.clock.wall, monotonic: () => f.clock.mono };
  f.lease = await openLicense(f.licenseToken, f.options);
  return f;
}

test('signed descriptor and seven-day installation-wrapped grant unlock exact bytes', async () => {
  const f = await fixture(); const tx = transaction();
  const result = await importProtectedObjects({ descriptor: f.handle, license: f.lease, entries: [['packet', f.encrypted.blob]], transaction: tx });
  assert.equal(result.status, 'authenticated-quarantine'); assert.equal(tx.committed, true);
  assert.deepEqual(new Uint8Array(await tx.writers[0].blob().arrayBuffer()), f.original);
  assert.equal(result.objects[0].sha256, await digest(f.original));
  assert.equal(f.lease.expiresAt, (epoch + LEASE_SECONDS) * 1000);
});

test('real combined transport and separate objects produce identical quarantine evidence', async () => {
  const f = await fixture(); const entries = [['packet', f.encrypted.blob]];
  const combined = combineTransport(f.token, f.handle, entries);
  const parsed = await splitTransport(combined, f.trusted);
  const secondLease = await openLicense(f.licenseToken, { ...f.options, descriptor: parsed.descriptor });
  const a = await importProtectedObjects({ descriptor: f.handle, license: f.lease, entries, transaction: transaction() });
  const b = await importProtectedObjects({ descriptor: parsed.descriptor, license: secondLease, entries: parsed.entries, transaction: transaction() });
  assert.deepEqual(a, b);
});

test('multiple bounded records and authenticated FINAL survive roundtrip', async () => {
  const f = await fixture({ size: CHUNK + 173 }); const w = writer();
  await decryptObject(f.encrypted.blob, f.key, f.d, f.d.objects[0], w);
  assert.equal(w.chunks.length, 2); assert.ok(w.chunks.every(c => c.length <= CHUNK));
  assert.deepEqual(new Uint8Array(await w.blob().arrayBuffer()), f.original);
});

for (const [name, mutate] of [
  ['wrong release', d => d.release_id = 'release-other'],
  ['wrong object identity', d => d.objects[0].object_id = 'other'],
  ['changed access and publication mode', d => { d.key_access = 'creator-secret'; d.publication = 'creator-private'; }],
]) test(`${name} fails cryptographic binding`, async () => {
  const f = await fixture(); const d = structuredClone(f.d); mutate(d); const w = writer();
  await assert.rejects(decryptObject(f.encrypted.blob, f.key, d, d.objects[0], w)); assert.equal(w.aborted, true); assert.equal(w.committed, false);
});

for (const [name, modify] of [
  ['wrong key', async f => ({ key: await newContentKey() })],
  ['tampered header', async f => { const b = new Uint8Array(await f.encrypted.blob.arrayBuffer()); b[0] ^= 1; return { blob: new Blob([b]) }; }],
  ['tampered ciphertext', async f => { const b = new Uint8Array(await f.encrypted.blob.arrayBuffer()); b[27] ^= 1; return { blob: new Blob([b]) }; }],
  ['truncated ciphertext', async f => ({ blob: f.encrypted.blob.slice(0, -1) })],
  ['trailing ciphertext', async f => ({ blob: new Blob([f.encrypted.blob, new Uint8Array([0])]) })],
]) test(`${name} aborts tentative data`, async () => {
  const f = await fixture(); const change = await modify(f); const w = writer();
  await assert.rejects(decryptObject(change.blob ?? f.encrypted.blob, change.key ?? f.key, f.d, f.d.objects[0], w));
  assert.equal(w.aborted, true); assert.equal(w.chunks.length, 0);
});

test('ciphertext digest mismatch aborts even after successful AEAD', async () => {
  const f = await fixture(); const o = { ...f.d.objects[0], ciphertext_sha256: '0'.repeat(64) }; const w = writer();
  await assert.rejects(decryptObject(f.encrypted.blob, f.key, f.d, o, w), /digest/); assert.equal(w.aborted, true);
});

test('record reorder and duplicate substitution are rejected', async () => {
  const f = await fixture({ size: CHUNK + 173 }); const blob = f.encrypted.blob;
  for (const altered of [new Blob([blob.slice(0, 24), blob.slice(24 + CHUNK + 17), blob.slice(24, 24 + CHUNK + 17)]),
    new Blob([blob.slice(0, 24 + CHUNK + 17), blob.slice(24, 24 + 173 + 17)])]) {
    const w = writer(); await assert.rejects(decryptObject(altered, f.key, f.d, f.d.objects[0], w)); assert.equal(w.aborted, true);
  }
});

test('cancellation during writer await removes already-decrypted chunks', async () => {
  const f = await fixture({ size: CHUNK + 173 }); const controller = new AbortController(); const w = writer();
  const write = w.write.bind(w); w.write = async value => { await write(value); controller.abort(); };
  await assert.rejects(decryptObject(f.encrypted.blob, f.key, f.d, f.d.objects[0], w, { signal: controller.signal }), /cancelled/);
  assert.equal(w.aborted, true); assert.equal(w.chunks.length, 0);
});

test('strict limits, unknown fields, profiles and capability sets refuse', async () => {
  const f = await fixture();
  for (const mutate of [d => d.extra = 1, d => d.crypto_profile = 'other', d => d.required_capabilities.push('mobile'),
    d => d.objects[0].plaintext_bytes = LIMITS.packet + 1, d => d.objects.push({ ...d.objects[0] }),
    d => d.objects[0].object_id = '../packet', d => d.publication = 'creator-private', d => d.objects = []]) {
    const d = structuredClone(f.d); mutate(d); assert.throws(() => validateDescriptor(d));
  }
});

test('creator-private design vector is valid but v1 refuses before key resolution', async () => {
  const f = await fixture({ mode: 'creator-secret' }); assert.equal(validateDescriptor(f.d, { allowPrivateDesign: true }).key_access, 'creator-secret');
  await assert.rejects(verifyDescriptor(f.token, f.trusted), /creator-private-not-enabled/);
});

test('fake descriptor, mutation and revoked descriptor trust cannot import', async () => {
  const f = await fixture(); assert.throws(() => requireDescriptor({ ...f.handle }), /verified/);
  assert.throws(() => f.handle.descriptor.release_id = 'other', TypeError);
  f.trusted.get('publisher').status = 'revoked'; assert.throws(() => requireDescriptor(f.handle), /verified/);
});

test('descriptor tampering, wrong signer and changed type refuse', async () => {
  const f = await fixture(); const parts = f.token.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...f.d, release_id: 'other' })).toString('base64url');
  await assert.rejects(verifyDescriptor(parts.join('.'), f.trusted));
  await assert.rejects(verifyDescriptor(f.token, new Map([['publisher', { key: licenseKeys.publicKey, status: 'active' }]])));
  const wrong = await new CompactSign(jsonBytes(f.d)).setProtectedHeader({ alg: 'EdDSA', kid: 'publisher', typ: 'other' }).sign(descriptorKeys.privateKey);
  await assert.rejects(verifyDescriptor(wrong, f.trusted), /header/);
});

for (const [name, modify] of [
  ['wrong account', async f => ({ account: 'other' })],
  ['wrong issuer', async f => ({ issuer: 'https://other.invalid' })],
  ['wrong installation', async f => { const k = await generateKeyPair('ECDH-ES', { extractable: true }); return { installationPrivateKey: k.privateKey, installationPublicKey: k.publicKey }; }],
  ['wrong installation private key', async f => ({ installationPrivateKey: (await generateKeyPair('ECDH-ES')).privateKey })],
  ['expired license', async f => ({ now: () => (epoch + LEASE_SECONDS) * 1000 })],
  ['not-yet-valid license', async f => ({ now: () => (epoch - 1) * 1000 })],
]) test(`${name} cannot unwrap a grant`, async () => {
  const f = await fixture(); await assert.rejects(openLicense(f.licenseToken, { ...f.options, ...await modify(f) }));
});

test('wrong audience, algorithm, type and excessive validity fail even with signer authority', async () => {
  const f = await fixture(); const original = JSON.parse(Buffer.from(f.licenseToken.split('.')[1], 'base64url'));
  for (const [payload, header] of [
    [{ ...original, aud: 'other' }, { alg: 'EdDSA', typ: 'seamless-playback-license+jwt', kid: 'license' }],
    [{ ...original, exp: original.exp + 1 }, { alg: 'EdDSA', typ: 'seamless-playback-license+jwt', kid: 'license' }],
    [original, { alg: 'EdDSA', typ: 'other', kid: 'license' }],
  ]) { const token = await new SignJWT(payload).setProtectedHeader(header).sign(licenseKeys.privateKey); await assert.rejects(openLicense(token, f.options)); }
  const hs = await new SignJWT(original).setProtectedHeader({ alg: 'HS256', typ: 'seamless-playback-license+jwt', kid: 'license' }).sign(new Uint8Array(32));
  await assert.rejects(openLicense(hs, f.options));
});

test('license binds exact signed descriptor bytes, not only release name', async () => {
  const f = await fixture(); const d = structuredClone(f.d); d.objects[0].ciphertext_sha256 = '0'.repeat(64);
  const token = await signDescriptor(d, descriptorKeys.privateKey, 'publisher'); const other = await verifyDescriptor(token, f.trusted);
  await assert.rejects(openLicense(f.licenseToken, { ...f.options, descriptor: other }), /license-release/);
});

test('renewal threshold and exact expiry use wall and monotonic elapsed time', async () => {
  const f = await fixture(); assert.equal(assertLicense(f.lease, f.handle).renewalDue, false);
  f.clock.mono = (LEASE_SECONDS - 86400) * 1000; assert.equal(assertLicense(f.lease, f.handle).renewalDue, true);
  f.clock.mono = LEASE_SECONDS * 1000; assert.throws(() => assertLicense(f.lease, f.handle), /expired/);
});

test('clock rollback, sign-out and signer revocation invalidate sessions', async () => {
  const f = await fixture(); f.clock.wall -= 1; assert.throws(() => assertLicense(f.lease, f.handle), /regression/);
  const g = await fixture(); closeLicense(g.lease); assert.throws(() => assertLicense(g.lease, g.handle), /session-required/);
  const h = await fixture(); h.licenseTrust.get('license').status = 'revoked'; assert.throws(() => assertLicense(h.lease, h.handle), /untrusted/);
});

test('missing, duplicate, foreign and wrong-size objects cannot enter quarantine', async () => {
  const f = await fixture();
  for (const entries of [[], [['other', f.encrypted.blob]], [['packet', f.encrypted.blob], ['packet', f.encrypted.blob]], [['packet', new Blob(['bad'])]]]) {
    assert.throws(() => resolveObjects(f.handle, entries));
  }
});

test('lease loss during asynchronous import aborts entire transaction', async () => {
  const f = await fixture(); const tx = transaction(); const open = tx.open.bind(tx);
  tx.open = async binding => { const w = await open(binding); const write = w.write.bind(w); w.write = async b => { await write(b); closeLicense(f.lease); }; return w; };
  await assert.rejects(importProtectedObjects({ descriptor: f.handle, license: f.lease, entries: [['packet', f.encrypted.blob]], transaction: tx }), /session-required/);
  assert.equal(tx.aborted, true); assert.equal(tx.committed, false); assert.equal(tx.writers[0].chunks.length, 0);
});

test('combined transport rejects truncation, extras, bad magic and excessive metadata lengths', async () => {
  const f = await fixture(); const blob = combineTransport(f.token, f.handle, [['packet', f.encrypted.blob]]);
  const modified = new Uint8Array(await blob.arrayBuffer()); modified[0] ^= 1;
  const excessive = new Uint8Array(await blob.arrayBuffer()); new DataView(excessive.buffer).setUint32(8, 0xffffffff);
  for (const candidate of [blob.slice(0, -1), new Blob([blob, bytes('extra')]), new Blob([modified]), new Blob([excessive])]) {
    await assert.rejects(splitTransport(candidate, f.trusted));
  }
});

test('expired or cancelled transaction commit cannot publish successful import', async () => {
  const f = await fixture(); const tx = transaction(); const commit = tx.commit.bind(tx);
  tx.commit = async evidence => { await commit(evidence); f.clock.wall += LEASE_SECONDS * 1000; };
  await assert.rejects(importProtectedObjects({ descriptor: f.handle, license: f.lease, entries: [['packet', f.encrypted.blob]], transaction: tx }), /expired/);
  assert.equal(tx.aborted, true); assert.equal(tx.writers[0].chunks.length, 0);
});

test('decrypted catalog retains both existing signature checks; no decryption-to-trust shortcut', async () => {
  const { fixtureManifest } = await import('../../browser-extension/src/fixture-signed-manifest.mjs');
  const { canonicalizeManifest } = await import('../../browser-extension/src/manifest-security.mjs');
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { importProtectedCatalog } = await import('../src/catalog.mjs');
  const { protectCatalog } = await import('../src/producer.mjs');
  const catalog = generateKeyPairSync('ed25519');
  const signature = { algorithm: 'Ed25519', key_id: 'isolated-catalog', value: Buffer.alloc(64).toString('base64') };
  const manifest = structuredClone(fixtureManifest);
  Object.assign(manifest, { schema_version: '2.0.0', edit_id: '50000000-0000-4000-8000-000000000004', signature: { ...signature } });
  manifest.segments = manifest.segments.filter(s => s.action === 'SKIP');
  const packet = { packet_schema_version: '2.0.0', packet_id: '50000000-0000-4000-8000-000000000001', purpose: 'catalog-distribution',
    creative_edit_id: '50000000-0000-4000-8000-000000000002', source_variant_id: '50000000-0000-4000-8000-000000000003',
    media_profile: 'catalog-av-v2', required_client_version: '0.42.0', manifest, asset_bindings: [], signature: { ...signature } };
  packet.manifest.signature.value = sign(null, Buffer.from(canonicalizeManifest(manifest)), catalog.privateKey).toString('base64');
  packet.signature.value = sign(null, Buffer.from(canonicalizeManifest(packet)), catalog.privateKey).toString('base64');
  const catalogTrust = { 'isolated-catalog': { status: 'active', publicKey: Buffer.from(catalog.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64') } };
  const capabilities = { clientVersion: '0.42.0', packetSchemas: ['2.0.0'], mediaProfiles: ['catalog-av-v2'] };
  async function run(input) {
    const f = await fixture();
    const encrypted = await encryptObject(new Blob([JSON.stringify(input)]), f.key, { ...f.d, object_id: 'packet', kind: 'packet' });
    if (input === packet) {
      const produced = await protectCatalog({ packet: input, assets: new Map(), catalogTrust, capabilities, releaseId: 'producer-1', signingKey: descriptorKeys.privateKey, kid: 'publisher' });
      const output = await verifyDescriptor(produced.token, f.trusted);
      assert.equal(output.descriptor.release_id, 'producer-1'); assert.equal(produced.entries.length, 1);
      for (const key of produced.contentKeys.values()) key.fill(0);
    }
    const descriptor = await verifyDescriptor(await signDescriptor({ ...f.d, objects: [encrypted.binding] }, descriptorKeys.privateKey, 'publisher'), f.trusted);
    const token = await issueLicense({ descriptor, contentKeys: f.keys, installationPublicKey: installation.publicKey,
      account: 'viewer', signingKey: licenseKeys.privateKey, kid: 'license', issuer: 'https://license.invalid', now: epoch, jti: 'catalog-grant' });
    const license = await openLicense(token, { ...f.options, descriptor });
    const store = transaction(); store.read = async () => store.writers[0].blob();
    return importProtectedCatalog({ descriptor, license, entries: [['packet', encrypted.blob]], store, catalogTrust, capabilities });
  }
  const result = await run(packet); assert.equal(result.status, 'catalog-verified-quarantine'); assert.equal(result.verification.ok, true);
  const bad = structuredClone(packet); bad.manifest.signature.value = Buffer.alloc(64).toString('base64');
  bad.signature.value = sign(null, Buffer.from(canonicalizeManifest(bad)), catalog.privateKey).toString('base64');
  await assert.rejects(run(bad), /inner-catalog/);
  const local = { ...packet, purpose: 'local-user-edit' }; await assert.rejects(run(local), /inner-catalog/);
});

test('missing verifier account or issuer never disables JWT policy checks', async () => {
  const f = await fixture();
  for (const override of [{ account: undefined }, { issuer: undefined }, { issuer: '' }]) {
    await assert.rejects(openLicense(f.licenseToken, { ...f.options, ...override }), /verifier-policy/);
  }
});

test('installation key profile is fixed to P-256', async () => {
  const f = await fixture(); const wrongCurve = await generateKeyPair('ECDH-ES', { crv: 'P-384', extractable: true });
  await assert.rejects(issueLicense({ descriptor: f.handle, contentKeys: f.keys, installationPublicKey: wrongCurve.publicKey,
    account: 'viewer', signingKey: licenseKeys.privateKey, kid: 'license', issuer: 'https://license.invalid', now: epoch, jti: 'grant' }), /key-profile/);
});

test('detected clock regression latches refusal until fresh authorization', async () => {
  const f = await fixture(); f.clock.wall -= 1;
  assert.throws(() => assertLicense(f.lease, f.handle), /regression/);
  f.clock.wall += 1; assert.throws(() => assertLicense(f.lease, f.handle), /session-required/);
});

test('aggregate media bound is independent of the packet byte allowance', async () => {
  const f = await fixture(); const d = structuredClone(f.d);
  const { ciphertextSize } = await import('../src/contract.mjs');
  for (let i = 0; i < 8; i++) d.objects.push({ object_id: `media-${i}`, kind: 'media', plaintext_bytes: 250_000_000,
    ciphertext_bytes: ciphertextSize(250_000_000), ciphertext_sha256: '0'.repeat(64) });
  assert.doesNotThrow(() => validateDescriptor(d));
  d.objects.push({ object_id: 'excess', kind: 'media', plaintext_bytes: 1, ciphertext_bytes: ciphertextSize(1), ciphertext_sha256: '0'.repeat(64) });
  assert.throws(() => validateDescriptor(d), /aggregate-limit/);
});

test('combined writer refuses a token inconsistent with its verified descriptor', async () => {
  const f = await fixture(); assert.throws(() => combineTransport(f.token + 'x', f.handle, [['packet', f.encrypted.blob]]), /descriptor-mismatch/);
});

test('E60: the importer reports progress after each authenticated object, and a throwing observer changes nothing', async () => {
  const f = await fixture(); const seen = [];
  const result = await importProtectedObjects({ descriptor: f.handle, license: f.lease, entries: [['packet', f.encrypted.blob]], transaction: transaction(),
    onObject: (done, total) => seen.push([done, total]) });
  assert.equal(result.status, 'authenticated-quarantine'); assert.deepEqual(seen, [[1, 1]]);
  const again = await importProtectedObjects({ descriptor: f.handle, license: f.lease, entries: [['packet', f.encrypted.blob]], transaction: transaction(),
    onObject: () => { throw Error('observer'); } });
  assert.equal(again.status, 'authenticated-quarantine');
});
