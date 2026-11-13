import { assertLicense, closeLicense, openLicense } from '../src/license.mjs';
import { requireDescriptor } from '../src/contract.mjs';

// Owner must call guard before preparation/action dispatch and dispose on sign-out.
// Account selection is trusted private application state, never provider input.
export function createLicenseManager({ cache, installationStore, client, licenseTrust, issuer, now = () => Date.now(), monotonic = () => performance.now() }) {
  let closed = false; const sessions = new Set(); const metadata = new WeakMap(); const pending = new Map();
  const check = signal => { if (closed || signal?.aborted) throw Error('license-manager-closed'); };
  async function register(license, descriptor, generation) {
    try { check(); if (sessions.size >= 32) throw Error('license-session-capacity'); await cache.checkpoint(generation); check(); assertLicense(license, descriptor); }
    catch (e) { closeLicense(license); throw e; }
    sessions.add(license); metadata.set(license, { descriptor, generation, wall: now(), mono: monotonic() }); return license;
  }
  async function restore(descriptor, account) {
    check(); requireDescriptor(descriptor);
    const { generation, entry } = await cache.read(account, descriptor.sha256); check();
    if (!entry) return { generation, license: null };
    const keys = await installationStore.getInstallation(); check();
    const license = await openLicense(entry.token, { descriptor, trustedKeys: licenseTrust, installationPrivateKey: keys.privateKey,
      installationPublicKey: keys.publicKey, account, issuer, now, monotonic });
    if (license.expiresAt !== entry.expiresAt) { closeLicense(license); throw Error('lease-cache-expiry-mismatch'); }
    return { generation, license: await register(license, descriptor, generation) };
  }
  async function guard(license) {
    const m = metadata.get(license);
    try { check(); if (!m) throw Error('managed-license-required'); const effective = Math.floor(Math.max(now(), m.wall + monotonic() - m.mono));
      const decision = assertLicense(license, m.descriptor);
      await cache.checkpoint(m.generation, effective); check(); assertLicense(license, m.descriptor); return decision; }
    catch (e) { closeLicense(license); sessions.delete(license); throw e; }
  }
  async function obtain(descriptor, account, { online = true, signal } = {}) {
    check(signal);
    let cached; let generation;
    try { ({ generation, license: cached } = await restore(descriptor, account)); }
    catch (e) {
      // Never erase a persisted clock floor or accept corrupted state to recover.
      if (!online || /clock|cache|generation|closed|capacity/.test(e.message)) throw e;
      generation = await cache.checkpoint();
    }
    try { check(signal); } catch (e) { if (cached) { closeLicense(cached); sessions.delete(cached); } throw e; }
    if (cached && (!(await guard(cached)).renewalDue || !online)) return { license: cached, status: 'cached' };
    if (!online) throw Error('offline-license-unavailable');
    let issued;
    try {
      const license = await client.license(descriptor, { signal, onVerifiedGrant: async grant => {
        check(signal); if (grant.accountId !== account) throw Error('license-account-changed');
        await cache.save({ generation, account, descriptorSha256: descriptor.sha256, token: grant.token, expiresAt: grant.expiresAt }); check(signal);
      } });
      issued = license; await register(license, descriptor, generation); check(signal);
      if (cached) { closeLicense(cached); sessions.delete(cached); }
      return { license, status: 'renewed' };
    } catch (e) {
      if (issued) { closeLicense(issued); sessions.delete(issued); }
      try { check(signal); } catch (cancelled) { if (cached) { closeLicense(cached); sessions.delete(cached); } throw cancelled; }
      if (/account-changed|paired-session-changed|client-cancelled|clock|cache|generation/.test(e.message)) { if (cached) { closeLicense(cached); sessions.delete(cached); } throw e; }
      // Availability failure is not an authenticated revoke. Existing valid grant
      // remains usable; caller surfaces deferred renewal and schedules a retry.
      if (cached) { await guard(cached); return { license: cached, status: 'renewal-deferred' }; }
      throw e;
    }
  }
  return Object.freeze({
    obtain(descriptor, account, options = {}) {
      const id = `${account}:${descriptor.sha256}`;
      if (pending.has(id)) return Promise.reject(Error('license-operation-busy'));
      const p = obtain(descriptor, account, options).finally(() => pending.delete(id)); pending.set(id, p); return p;
    },
    guard,
    release(license) { closeLicense(license); sessions.delete(license); metadata.delete(license); },
    async signOut() {
      closed = true; client.close(); for (const s of sessions) closeLicense(s); sessions.clear();
      // Both stores must be attempted even if one storage operation fails.
      const outcomes = await Promise.allSettled([cache.clear(), installationStore.clear()]);
      if (outcomes.some(x => x.status === 'rejected')) throw Error('protected-signout-cleanup-failed');
    },
    close() { closed = true; client.close(); for (const s of sessions) closeLicense(s); sessions.clear(); },
  });
}
