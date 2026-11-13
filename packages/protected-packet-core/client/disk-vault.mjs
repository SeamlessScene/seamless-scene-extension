import { descriptorToken, requireDescriptor, verifyDescriptor, insist } from '../src/contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LIBRARY = 'library', LEGACY = 'saved';

// Exclusive owner lock must cover the entire vault/session lifetime. Dedicated
// private directory only: never pass the OPFS root or a user-selected directory.
//
// Encrypted releases the viewer keeps, one directory each: library/<releaseId>/
// holds object-<i>, the signed descriptor as `receipt`, and `used` (last opened,
// ms). Plaintext never enters the vault. The pre-library single `saved/` copy is
// still read, listed and removable, and is dropped when its release is saved again.
export async function createDiskVault({ root, descriptorTrust, assertOwner, signal, now = () => Date.now() }) {
  insist(typeof assertOwner === 'function' && root?.entries, 'vault-owner-required');
  const check = () => { assertOwner(); if (signal?.aborted) throw Error('vault-cancelled'); };
  async function remove(parent, name) { try { await parent.removeEntry(name, { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; } }
  async function directory(parent, name, create = false) {
    try { return await parent.getDirectoryHandle(name, { create }); } catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
  }
  async function library(create = false) { return directory(root, LIBRARY, create); }
  async function write(dir, name, blob) {
    check(); const handle = await dir.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try { for (let n = 0; n < blob.size; n += 1048576) { check(); await writer.write(new Uint8Array(await blob.slice(n, n + 1048576).arrayBuffer())); } check(); await writer.close(); }
    catch (e) { await writer.abort().catch(() => {}); throw e; }
    check();
  }
  // Verified contents of one release directory, or an error naming what is wrong.
  async function read(dir, releaseId) {
    const token = await (await dir.getFileHandle('receipt')).getFile();
    insist(token.size > 0 && token.size <= 180000, 'vault-receipt-size');
    const descriptor = await verifyDescriptor(await token.text(), descriptorTrust); check();
    const d = requireDescriptor(descriptor); insist(releaseId === undefined || d.release_id === releaseId, 'vault-release');
    const entries = [];
    for (let i = 0; i < d.objects.length; i++) {
      const blob = await (await dir.getFileHandle(`object-${i}`)).getFile(); check();
      insist(blob.size === d.objects[i].ciphertext_bytes, 'vault-object-size'); entries.push([d.objects[i].object_id, blob]);
    }
    return { descriptor, entries };
  }
  async function lastUsed(dir) {
    try { const value = Number(await (await (await dir.getFileHandle('used')).getFile()).text()); return Number.isFinite(value) ? value : 0; }
    catch { return 0; }
  }
  async function touch(dir) { try { await write(dir, 'used', new Blob([String(now())])); } catch { /* recency is advisory */ } }
  async function legacyRelease() {
    const dir = await directory(root, LEGACY); if (!dir) return null;
    try { const { descriptor } = await read(dir); return { dir, releaseId: requireDescriptor(descriptor).release_id }; } catch { return { dir, releaseId: null }; }
  }
  async function cleanup() {
    check();
    for await (const [name] of root.entries()) {
      check();
      if (/^job-[a-f0-9-]{36}$/.test(name)) await remove(root, name);
      else if (name === LEGACY) {
        try { const d = await root.getDirectoryHandle(name); await d.getFileHandle('receipt'); }
        catch (e) { if (e.name !== 'NotFoundError') throw e; await remove(root, name); }
      }
    }
    const lib = await library();
    if (lib) for await (const [name] of lib.entries()) {
      check();
      // An interrupted save leaves no receipt (it is written last).
      if (!UUID.test(name)) { await remove(lib, name); continue; }
      try { await (await lib.getDirectoryHandle(name)).getFileHandle('receipt'); }
      catch (e) { if (e.name !== 'NotFoundError') throw e; await remove(lib, name); }
    }
    check();
  }
  await cleanup();
  return Object.freeze({
    // Keep one more release; other kept releases are untouched.
    async save({ descriptor, entries }) {
      check(); const d = requireDescriptor(descriptor); const objects = new Map(entries);
      insist(UUID.test(d.release_id) && objects.size === d.objects.length, 'vault-object-set');
      const lib = await library(true); await remove(lib, d.release_id);
      const dir = await lib.getDirectoryHandle(d.release_id, { create: true });
      try {
        for (let i = 0; i < d.objects.length; i++) {
          const binding = d.objects[i], blob = objects.get(binding.object_id);
          insist(blob instanceof Blob && blob.size === binding.ciphertext_bytes, 'vault-object-size');
          // Hash is checked by authenticated streaming decryption before use;
          // receipt binds exact signed descriptor, not caller-selected file paths.
          await write(dir, `object-${i}`, blob);
        }
        await touch(dir);
        await write(dir, 'receipt', new Blob([descriptorToken(descriptor)])); check();
      } catch (e) { await remove(lib, d.release_id); throw e; }
      const legacy = await legacyRelease(); if (legacy?.releaseId === d.release_id) await remove(root, LEGACY);
    },
    async load(releaseId) {
      check(); insist(UUID.test(releaseId), 'vault-release');
      const lib = await library(), dir = lib ? await directory(lib, releaseId) : null;
      if (dir) { const result = await read(dir, releaseId); await touch(dir); return result; }
      const legacy = await directory(root, LEGACY);
      insist(legacy, 'vault-release');
      return read(legacy, releaseId);
    },
    // True when this release is kept and its receipt and object sizes verify.
    async has(releaseId) {
      check(); if (!UUID.test(releaseId)) return false;
      try { await this.load(releaseId); return true; } catch { return false; }
    },
    // Kept releases, newest use first. `problem` marks one that cannot be loaded.
    async list() {
      check(); const out = [];
      const lib = await library();
      if (lib) for await (const [name, handle] of lib.entries()) {
        check(); if (!UUID.test(name) || handle.kind !== 'directory') continue;
        let bytes = 0; for await (const [, file] of handle.entries()) if (file.kind === 'file') bytes += (await file.getFile()).size;
        const entry = { releaseId: name, bytes, lastUsedAt: await lastUsed(handle), legacy: false, descriptorSha256: null, problem: null };
        try { const { descriptor } = await read(handle, name); entry.descriptorSha256 = descriptor.sha256; } catch (e) { entry.problem = e.message || 'vault-unreadable'; }
        out.push(entry);
      }
      const legacy = await legacyRelease();
      if (legacy?.releaseId && !out.some(e => e.releaseId === legacy.releaseId)) {
        let bytes = 0; for await (const [, file] of legacy.dir.entries()) if (file.kind === 'file') bytes += (await file.getFile()).size;
        const { descriptor } = await read(legacy.dir, legacy.releaseId);
        out.push({ releaseId: legacy.releaseId, bytes, lastUsedAt: 0, legacy: true, descriptorSha256: descriptor.sha256, problem: null });
      }
      return out.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    },
    async remove(releaseId) {
      check(); insist(UUID.test(releaseId), 'vault-release');
      const lib = await library(); if (lib) await remove(lib, releaseId);
      const legacy = await legacyRelease(); if (legacy?.releaseId === releaseId) await remove(root, LEGACY);
    },
    async clear() { assertOwner(); await remove(root, LIBRARY); await remove(root, LEGACY); },
    cleanup,
  });
}
