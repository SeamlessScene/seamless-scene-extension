import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';
import { FORMAT, PROFILE, signDescriptor, verifyDescriptor, descriptorToken } from '../src/contract.mjs';
import { newContentKey, encryptObject } from '../src/files.mjs';
import { createDiskVault } from '../client/disk-vault.mjs';

// A small in-memory stand-in for the origin-private file system.
function memoryDirectory(name = '') {
  const children = new Map();
  const notFound = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
  return {
    kind: 'directory', name, children,
    async getDirectoryHandle(child, { create = false } = {}) {
      const found = children.get(child);
      if (found) { if (found.kind !== 'directory') throw new TypeError('not a directory'); return found; }
      if (!create) throw notFound();
      const made = memoryDirectory(child); children.set(child, made); return made;
    },
    async getFileHandle(child, { create = false } = {}) {
      let found = children.get(child);
      if (!found) {
        if (!create) throw notFound();
        found = { kind: 'file', name: child, data: new Blob([]),
          async getFile() { return this.data; },
          async createWritable() { const parts = [], file = this; return { async write(value) { parts.push(value.slice()); }, async close() { file.data = new Blob(parts); }, async abort() {} }; } };
        children.set(child, found);
      }
      return found;
    },
    async removeEntry(child) { if (!children.delete(child)) throw notFound(); },
    async *entries() { for (const entry of [...children]) yield entry; }
  };
}

const keys = await generateKeyPair('EdDSA');
const trusted = new Map([['publisher', { key: keys.publicKey, status: 'active' }]]);
const release = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function acquired(releaseId, size = 64) {
  const context = { format: FORMAT, release_id: releaseId, key_access: 'platform-key', publication: 'reviewed-catalog-v2', crypto_profile: PROFILE, required_capabilities: [PROFILE, 'platform-key'] };
  const encrypted = await encryptObject(new Blob([new Uint8Array(size).fill(7)]), await newContentKey(), { ...context, object_id: 'packet', kind: 'packet' });
  const descriptor = await verifyDescriptor(await signDescriptor({ ...context, objects: [encrypted.binding] }, keys.privateKey, 'publisher'), trusted);
  return { descriptor, entries: [['packet', encrypted.blob ?? encrypted.ciphertext]] };
}
const owner = () => {};

test('the vault keeps several releases, loads each, lists them by last use and removes one', async () => {
  let clock = 1000; const root = memoryDirectory();
  const vault = await createDiskVault({ root, descriptorTrust: trusted, assertOwner: owner, now: () => clock });
  const a = await acquired(release(1)), b = await acquired(release(2), 128);
  await vault.save(a); clock = 2000; await vault.save(b);
  assert.equal((await vault.load(release(1))).descriptor.sha256, a.descriptor.sha256, 'saving b kept a');
  clock = 3000; await vault.load(release(1));
  const listed = await vault.list();
  assert.deepEqual(listed.map(e => e.releaseId), [release(1), release(2)], 'most recently used first');
  assert.ok(listed.every(e => e.bytes > 0 && e.problem === null && e.descriptorSha256));
  assert.equal(await vault.has(release(2)), true);
  await vault.remove(release(2));
  assert.equal(await vault.has(release(2)), false);
  await assert.rejects(vault.load(release(2)), /vault-release/);
  await vault.clear(); assert.deepEqual(await vault.list(), []);
});

test('a damaged release is listed as a problem, and an interrupted save is swept at start', async () => {
  const root = memoryDirectory();
  const vault = await createDiskVault({ root, descriptorTrust: trusted, assertOwner: owner });
  await vault.save(await acquired(release(3)));
  const dir = await (await root.getDirectoryHandle('library')).getDirectoryHandle(release(3));
  (await dir.getFileHandle('object-0')).data = new Blob(['short']);
  const [entry] = await vault.list();
  assert.equal(entry.problem, 'vault-object-size');
  assert.equal(await vault.has(release(3)), false);
  await (await root.getDirectoryHandle('library')).getDirectoryHandle(release(4), { create: true });
  await createDiskVault({ root, descriptorTrust: trusted, assertOwner: owner });
  assert.equal((await root.getDirectoryHandle('library')).children.has(release(4)), false, 'no receipt: incomplete save removed');
});

test('the single pre-library copy is still readable, listed and replaced on a new save', async () => {
  const root = memoryDirectory(), old = await acquired(release(5));
  const legacy = await root.getDirectoryHandle('saved', { create: true });
  const object = await legacy.getFileHandle('object-0', { create: true }); object.data = old.entries[0][1];
  const receipt = await legacy.getFileHandle('receipt', { create: true }); receipt.data = new Blob([descriptorToken(old.descriptor)]);
  const vault = await createDiskVault({ root, descriptorTrust: trusted, assertOwner: owner });
  assert.equal((await vault.load(release(5))).descriptor.sha256, old.descriptor.sha256);
  assert.deepEqual((await vault.list()).map(e => [e.releaseId, e.legacy]), [[release(5), true]]);
  await vault.save(old);
  assert.equal(root.children.has('saved'), false, 'the old copy is dropped once the same release is in the library');
  assert.deepEqual((await vault.list()).map(e => [e.releaseId, e.legacy]), [[release(5), false]]);
});

test('the vault manager runs only on the extension settings page and shares the owner lock', async () => {
  const { openVaultManager } = await import('../client/vault-manager.mjs');
  const chromeApi = { runtime: { id: 'ext' } }, root = memoryDirectory();
  const held = [];
  const navigatorApi = { storage: { getDirectory: async () => root },
    locks: { request: async (name, options, work) => { held.push([name, options.mode]); return work({ name }); } } };
  await assert.rejects(openVaultManager({ descriptorTrust: trusted, chromeApi, navigatorApi, locationApi: { protocol: 'chrome-extension:', hostname: 'ext', pathname: '/viewer-popup.html' } }), /vault-page-required/);
  const manager = await openVaultManager({ descriptorTrust: trusted, chromeApi, navigatorApi, locationApi: { protocol: 'chrome-extension:', hostname: 'ext', pathname: '/viewer-settings.html' } });
  const vault = await createDiskVault({ root: await root.getDirectoryHandle('seamless-protected-candidate-1', { create: true }), descriptorTrust: trusted, assertOwner: owner });
  await vault.save(await acquired(release(9)));
  assert.deepEqual((await manager.list()).map(e => e.releaseId), [release(9)]);
  await manager.remove(release(9));
  assert.deepEqual(await manager.list(), []);
  assert.ok(held.every(([name, mode]) => name === 'seamless-protected-owner-candidate-1' && mode === 'exclusive'));
});
