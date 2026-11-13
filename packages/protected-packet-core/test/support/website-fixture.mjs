import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { generateKeyPair, CompactEncrypt } from 'jose';
import { fixtureManifest } from '../../../browser-extension/src/fixture-signed-manifest.mjs';
import { canonicalizeManifest } from '../../../browser-extension/src/manifest-security.mjs';
import { digest, bytes } from '../../src/contract.mjs';
import { assertLicense } from '../../src/license.mjs';
import { importProtectedCatalog } from '../../src/catalog.mjs';
import { createProtectedWebsiteClient } from '../../client/website-client.mjs';


const websiteRoot = process.env.PROTECTED_WEBSITE_CORE;
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const origin = 'https://license.invalid';
export async function setup({ media = false } = {}) {
  const { createProtectedService } = await import(pathToFileURL(join(websiteRoot, 'server/service.mjs')));
  const { protectedHttp } = await import(pathToFileURL(join(websiteRoot, 'server/http.mjs')));
  const catalog = generateKeyPairSync('ed25519');
  const signature = { algorithm: 'Ed25519', key_id: 'catalog', value: '' };
  const manifest = structuredClone(fixtureManifest);
  Object.assign(manifest, { schema_version: '2.0.0', edit_id: id(4), signature: { ...signature } });
  manifest.segments = manifest.segments.filter(s => media ? ['REPLACE','INSERT','MUTE','SKIP'].includes(s.action) : s.action === 'SKIP');
  const asset = new Blob(['synthetic media bytes; decoder is a test adapter']);
  const assetHash = await digest(new Uint8Array(await asset.arrayBuffer()));
  if (media) for (const segment of manifest.segments) if (segment.asset) segment.asset.sha256 = assetHash;
  const packet = { packet_schema_version: '2.0.0', packet_id: id(1), purpose: 'catalog-distribution', creative_edit_id: id(2), source_variant_id: id(3),
    media_profile: 'catalog-av-v2', required_client_version: '0.42.0', manifest, asset_bindings: media ? [{sha256:assetHash,relative_path:'clip.mp4',bytes:asset.size}] : [], signature: { ...signature } };
  manifest.signature.value = sign(null, Buffer.from(canonicalizeManifest(manifest)), catalog.privateKey).toString('base64');
  packet.signature.value = sign(null, Buffer.from(canonicalizeManifest(packet)), catalog.privateKey).toString('base64');
  const descriptor = await generateKeyPair('EdDSA'); const issuer = await generateKeyPair('EdDSA');
  // WebCrypto nonextractable private key: the challenge must work without export.
  const installation = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const f = { now: 1_800_000_000_000, calls: [], records: new Map(), challenges: new Map(), used: new Set(), busy: new Set(), allowed: true, installation };
  f.credentials = { accountId: id(8), pairingId: id(9), accessToken: 'a'.repeat(64), expiresAt: f.now + 30 * 60_000 };
  const repository = {
    async commit(r) { assert(!f.records.has(r.releaseId)); f.records.set(r.releaseId, r); }, async read(release) { return f.records.get(release); },
    async createChallenge(c) { f.challenges.set(c.id, c); }, async transactIssue(challenge, fn) {
      assert(!f.used.has(challenge) && !f.busy.has(challenge), 'proof-replay'); f.busy.add(challenge);
      try { const result = await fn(f.challenges.get(challenge)); f.used.add(challenge); return result; } finally { f.busy.delete(challenge); }
    },
  };
  f.descriptorTrust = new Map([['descriptor', { key: descriptor.publicKey, status: 'active' }]]);
  f.licenseTrust = new Map([['license', { key: issuer.publicKey, status: 'active' }]]);
  f.catalogTrust = { catalog: { status: 'active', publicKey: Buffer.from(catalog.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64') } };
  f.capabilities = { clientVersion: '0.42.0', packetSchemas: ['2.0.0'], mediaProfiles: ['catalog-av-v2'] };
  f.service = createProtectedService({ repository, authorize: async context => {
    assert.equal(context.token, f.credentials?.accessToken); return { accountId: f.credentials.accountId, pairingId: f.credentials.pairingId, expiresAt: f.credentials.expiresAt / 1000 };
  }, entitled: async () => f.allowed, wrappingKeys: new Map([['custody', randomBytes(32)]]), wrappingKid: 'custody', descriptorTrust: f.descriptorTrust,
    descriptorSigner: { key: descriptor.privateKey, kid: 'descriptor' }, licenseSigner: { key: issuer.privateKey, kid: 'license' }, issuer: origin, clock: () => Math.floor(f.now / 1000) });
  const packetText = JSON.stringify(packet); const packetSha256 = await digest(bytes(packetText));
  await f.service.publish({ releaseId: id(1), packetText, assets: media ? new Map([[assetHash,asset]]) : new Map(), catalogTrust: f.catalogTrust, capabilities: f.capabilities,
    readApproved: async () => ({ releaseId: id(1), packetSha256, reviewed: true, available: true }) });
  const route = protectedHttp(f.service, { contextForRequest: async request => {
    assert.equal(request.headers.get('authorization'), `Bearer ${f.credentials?.accessToken}`); assert.equal(request.headers.has('cookie'), false);
    return { token: request.headers.get('authorization').slice(7) };
  } });
  f.respond = async (url, init) => route(new Request(url, init));
  f.fetch = async (url, init) => { f.calls.push({ url, init }); return f.respond(url, init); };
  f.makeClient = options => createProtectedWebsiteClient({ origin, issuer: origin, descriptorTrust: f.descriptorTrust, licenseTrust: f.licenseTrust,
    getCredentials: async () => f.credentials, getInstallation: async () => f.installation, fetchImpl: f.fetch, now: () => f.now, monotonic: () => 0, ...options });
  f.packet = packet;
  f.disable = () => {
    const disabled = structuredClone(packet); disabled.manifest.manifest_version++;
    disabled.manifest.feature_flags.emergency_disable = true;
    disabled.manifest.segments = disabled.manifest.segments.filter(s => s.action === 'SKIP'); disabled.asset_bindings = [];
    disabled.manifest.signature.value = sign(null, Buffer.from(canonicalizeManifest(disabled.manifest)), catalog.privateKey).toString('base64');
    disabled.signature.value = sign(null, Buffer.from(canonicalizeManifest(disabled)), catalog.privateKey).toString('base64'); return disabled;
  };
  f.client = f.makeClient(); return f;
}
