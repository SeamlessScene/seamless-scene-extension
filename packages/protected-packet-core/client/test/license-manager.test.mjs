import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { generateKeyPair } from 'jose';
import { createLeaseCache } from '../lease-cache.mjs';
import { createInstallationStore } from '../installation-store.mjs';
import { createLicenseManager } from '../license-manager.mjs';
import { signDescriptor, verifyDescriptor, descriptorToken, FORMAT, PROFILE } from '../../src/contract.mjs';
import { newContentKey, encryptObject } from '../../src/files.mjs';
import { issueLicense, openLicense } from '../../src/license.mjs';

async function setup() {
  const f = { time: 1_800_000_000_000, mono: 0, calls: 0, online: true, account: 'viewer', name: crypto.randomUUID() };
  const publisher = await generateKeyPair('EdDSA'); const signer = await generateKeyPair('EdDSA'); const key = await newContentKey();
  const context = { format: FORMAT, release_id: 'release', key_access: 'platform-key', publication: 'reviewed-catalog-v2', crypto_profile: PROFILE, required_capabilities: [PROFILE, 'platform-key'] };
  const encrypted = await encryptObject(new Blob(['synthetic']), key, { ...context, object_id: 'packet', kind: 'packet' });
  f.publisherTrust = new Map([['publisher', { key: publisher.publicKey, status: 'active' }]]);
  f.descriptor = await verifyDescriptor(await signDescriptor({ ...context, objects: [encrypted.binding] }, publisher.privateKey, 'publisher'), f.publisherTrust);
  f.trust = new Map([['issuer', { key: signer.publicKey, status: 'active' }]]);
  f.create = () => {
    const cache = createLeaseCache({ indexedDB, name: f.name + '-cache', now: () => f.time });
    const installationStore = createInstallationStore({ indexedDB, name: f.name + '-keys' });
    const client = {
      close() {}, async license(descriptor, { onVerifiedGrant, signal }) {
        f.calls++; if (!f.online) throw Error('network-unavailable'); if (signal?.aborted) throw Error('cancelled');
        if (f.beforeIssue) await f.beforeIssue();
        const installation = await installationStore.getInstallation();
        const token = await issueLicense({ descriptor, contentKeys: new Map([['packet', key]]), installationPublicKey: installation.publicKey,
          account: f.account, signingKey: signer.privateKey, kid: 'issuer', issuer: 'https://license.invalid', now: Math.floor(f.time / 1000), jti: crypto.randomUUID() });
        const license = await openLicense(token, { descriptor, trustedKeys: f.trust, installationPrivateKey: installation.privateKey, installationPublicKey: installation.publicKey, account: f.account, issuer: 'https://license.invalid', now: () => f.time, monotonic: () => f.mono });
        if (f.beforeSave) await f.beforeSave();
        await onVerifiedGrant({ token, accountId: f.account, expiresAt: license.expiresAt });
        return license;
      },
    };
    const manager = createLicenseManager({ cache, installationStore, client, licenseTrust: f.trust, issuer: 'https://license.invalid', now: () => f.time, monotonic: () => f.mono });
    return { cache, installationStore, manager, close() { manager.close(); cache.close(); installationStore.close(); } };
  };
  return f;
}

test('license and nonextractable keys reopen offline without another issuance', async () => {
  const f = await setup(); const first = f.create(); assert.equal((await first.manager.obtain(f.descriptor, 'viewer')).status, 'renewed'); first.close();
  f.time += 1000; f.online = false; const second = f.create(); const reopenedDescriptor = await verifyDescriptor(descriptorToken(f.descriptor), f.publisherTrust);
  const result = await second.manager.obtain(reopenedDescriptor, 'viewer', { online: false });
  assert.equal(result.status, 'cached'); assert.equal(f.calls, 1); assert.equal((await second.manager.guard(result.license)).renewalDue, false); second.close();
});

test('due renewal replaces cached grant; outage preserves valid grant only', async () => {
  const f = await setup(); const c = f.create(); const first = await c.manager.obtain(f.descriptor, 'viewer');
  f.time += 6 * 86400000; f.online = false; const deferred = await c.manager.obtain(f.descriptor, 'viewer'); assert.equal(deferred.status, 'renewal-deferred');
  f.online = true; const renewed = await c.manager.obtain(f.descriptor, 'viewer'); assert.equal(renewed.status, 'renewed'); assert.ok(renewed.license.expiresAt > first.license.expiresAt); c.close();
});

test('expired offline license is refused and valid fresh online authorization recovers', async () => {
  const f = await setup(); const c = f.create(); await c.manager.obtain(f.descriptor, 'viewer'); f.time += 7 * 86400000;
  await assert.rejects(c.manager.obtain(f.descriptor, 'viewer', { online: false })); assert.equal((await c.manager.obtain(f.descriptor, 'viewer')).status, 'renewed'); c.close();
});

test('persisted clock floor refuses rollback across restart without network fallback', async () => {
  const f = await setup(); const c = f.create(); const result = await c.manager.obtain(f.descriptor, 'viewer'); f.time += 2000; await c.manager.guard(result.license); c.close();
  f.time -= 1000; const next = f.create(); await assert.rejects(next.manager.obtain(f.descriptor, 'viewer'), /clock-regression/); assert.equal(f.calls, 1); next.close();
});

test('sign-out invalidates another context and late renewal cannot repopulate cache', async () => {
  const f = await setup(); const a = f.create(); const b = f.create(); const issued = await a.manager.obtain(f.descriptor, 'viewer');
  await b.manager.signOut(); await assert.rejects(a.manager.guard(issued.license), /generation/);
  a.close(); b.close();
  const g = await setup(); const c = g.create(); const other = g.create();
  g.beforeSave = async () => other.manager.signOut();
  await assert.rejects(c.manager.obtain(g.descriptor, 'viewer'), /generation/);
  const stored = await c.cache.read('viewer', g.descriptor.sha256); assert.equal(stored.entry, null); c.close(); other.close();
});

test('wrong account cannot restore or persist someone else’s grant', async () => {
  const f = await setup(); const c = f.create(); await c.manager.obtain(f.descriptor, 'viewer');
  await assert.rejects(c.manager.obtain(f.descriptor, 'other', { online: false }), /offline-license/);
  await assert.rejects(c.manager.obtain(f.descriptor, 'other'), /account-changed/); c.close();
});

test('tampered cached token is cryptographically rejected', async () => {
  const f = await setup(); const c = f.create(); const result = await c.manager.obtain(f.descriptor, 'viewer');
  const saved = await c.cache.read('viewer', f.descriptor.sha256);
  await c.cache.save({ generation: saved.generation, account: 'viewer', descriptorSha256: f.descriptor.sha256, token: 'invalid', expiresAt: result.license.expiresAt });
  await assert.rejects(c.manager.obtain(f.descriptor, 'viewer', { online: false })); c.close();
});

test('concurrent renewal is refused rather than racing duplicate grants', async () => {
  const f = await setup(); const c = f.create(); let release; f.beforeIssue = () => new Promise(resolve => release = resolve);
  const p = c.manager.obtain(f.descriptor, 'viewer'); await assert.rejects(c.manager.obtain(f.descriptor, 'viewer'), /busy/);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1)); release(); await p; c.close();
});

test('monotonic elapsed time is checkpointed so restart cannot recover elapsed lease time', async () => {
  const f = await setup(); const first = f.create(); const issued = await first.manager.obtain(f.descriptor, 'viewer');
  f.mono += 5000; await first.manager.guard(issued.license); first.close();
  f.mono = 0; const second = f.create(); await assert.rejects(second.manager.obtain(f.descriptor, 'viewer', { online: false }), /clock-regression/); second.close();
});

test('account change during renewal is not treated as an offline outage', async () => {
  const f = await setup(); const c = f.create(); await c.manager.obtain(f.descriptor, 'viewer'); f.time += 6 * 86400000;
  f.account = 'different'; await assert.rejects(c.manager.obtain(f.descriptor, 'viewer'), /account-changed/); c.close();
});

test('sign-out attempts installation cleanup even when license-cache clearing fails', async () => {
  let cleared = false; let closed = false;
  const manager = createLicenseManager({ cache: { async clear() { throw Error('storage-failure'); } }, installationStore: { async clear() { cleared = true; } }, client: { close() { closed = true; } } });
  await assert.rejects(manager.signOut(), /cleanup-failed/); assert.equal(cleared, true); assert.equal(closed, true);
});

test('owner can release a managed grant and released handles cannot authorize', async () => {
  const f = await setup(); const c = f.create(); const result = await c.manager.obtain(f.descriptor, 'viewer');
  c.manager.release(result.license); await assert.rejects(c.manager.guard(result.license), /managed-license/);
  assert.equal((await c.manager.obtain(f.descriptor, 'viewer', { online: false })).status, 'cached'); c.close();
});
