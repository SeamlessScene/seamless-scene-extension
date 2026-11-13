import { createInstallationStore } from './installation-store.mjs';
import { createLeaseCache } from './lease-cache.mjs';
import { createLicenseManager } from './license-manager.mjs';
import { createPairedProtectedWebsiteClient } from './paired-website-client.mjs';
import { createDiskVault } from './disk-vault.mjs';
import { ProtectedPlaybackSession } from '../../browser-extension/src/protected-playback-session.mjs';

/** Called only by an admitted privileged renderer, with release-managed public
 * trust and its existing catalog/native adapters. Not a content-script export. */
export async function createProtectedBrowserOwner({ pairingConfig, issuer, descriptorTrust, licenseTrust,
  account, catalogOptions, executor, readSource, refreshControl, subscribeSignOut, external = false, storagePolicy = null, lockWaitMs = 0,
  chromeApi = globalThis.chrome, navigatorApi = globalThis.navigator, locationApi = globalThis.location,
  indexedDB = globalThis.indexedDB, fetchImpl = globalThis.fetch }) {
  if (locationApi?.protocol !== 'chrome-extension:' || locationApi.hostname !== chromeApi?.runtime?.id ||
    locationApi.pathname !== '/local-playback-frame.html' || !navigatorApi?.locks?.request || !navigatorApi?.storage?.getDirectory ||
    typeof subscribeSignOut !== 'function') throw Error('protected-private-renderer-required');
  if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 600_000) throw Error('protected-lock-wait');
  if (!(descriptorTrust instanceof Map) || !(licenseTrust instanceof Map) || !descriptorTrust.size || !licenseTrust.size)
    throw Error('protected-release-trust-required');
  let unlock, alive = true, ready, reject;
  const started = new Promise((a, b) => { ready = a; reject = b; });
  const held = new Promise(r => { unlock = r; });
  // Single private owner excludes active jobs from crash-orphan collection.
  // One owner at a time. By default a busy lock fails at once; a caller may wait a
  // bounded time instead (the other owner releases it when its job ends).
  const lockOptions = lockWaitMs > 0 ? { mode: 'exclusive', signal: AbortSignal.timeout(lockWaitMs) } : { mode: 'exclusive', ifAvailable: true };
  const task = navigatorApi.locks.request('seamless-protected-owner-candidate-1', lockOptions, async lock => {
    if (!lock) throw Error('protected-owner-busy');
    ready(); await held;
  }).catch(error => reject(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? Error('protected-owner-busy') : error));
  await started;
  const installationStore = createInstallationStore({ indexedDB });
  const cache = createLeaseCache({ indexedDB });
  let owner, unsubscribe, listener, signingOut;
  const finish = async () => {
    if (!alive) return;
    alive = false; unsubscribe?.(); if (listener) chromeApi.storage.onChanged.removeListener(listener);
    cache.close(); installationStore.close(); unlock(); await task;
  };
  try {
    const root = await (await navigatorApi.storage.getDirectory()).getDirectoryHandle('seamless-protected-candidate-1', { create: true });
    const vault = await createDiskVault({ root, descriptorTrust, assertOwner: () => { if (!alive) throw Error('protected-owner-closed'); } });
    // Privileged Chrome GETs omit Origin unless explicitly supplied. The
    // admitted extension identity, never caller/page input, supplies it.
    const contextualFetch = (url, init = {}) => {
      const headers = new Headers(init.headers); headers.set('Origin', `chrome-extension://${chromeApi.runtime.id}`);
      return fetchImpl(url, { ...init, headers });
    };
    const client = createPairedProtectedWebsiteClient({ pairingConfig, storage: chromeApi.storage.session, locks: navigatorApi.locks,
      fetchImpl: contextualFetch, issuer, descriptorTrust, licenseTrust, getInstallation: () => installationStore.getInstallation() });
    const manager = createLicenseManager({ cache, installationStore, client, licenseTrust, issuer });
    owner = new ProtectedPlaybackSession({ client, manager, vault, root, account, catalogOptions, executor, readSource, refreshControl, external, storagePolicy,
      estimate: () => navigatorApi.storage.estimate() });
    // Renderer disposal may re-enter while native restoration resolves. Join
    // the entire sign-out, including ciphertext clear, before closing stores.
    const signOut = () => signingOut ??= (async () => {
      try { await owner.signOut(); } finally { await finish(); }
    })();
    unsubscribe = subscribeSignOut(signOut);
    listener = (changes, area) => {
      if (area !== 'local' || !owner.catalog.current) return;
      const key = `catalogActivation.v2.${owner.catalog.description().manifest.edit_id}`;
      if (Object.hasOwn(changes, key)) void owner.storageChanged(changes[key].newValue).catch(() => {});
    };
    chromeApi.storage.onChanged.addListener(listener);
    // Private, nonserializable facade: no license, account, key, file or URL API.
    return Object.freeze({
      open: (...args) => owner.open(...args),
      // Download-only ("Watch this edit", next episode) and kept-edit management
      // (sizes and ids only; no files or keys).
      acquire: (...args) => owner.acquireOnly(...args),
      // 0.63.3: the first-Watch checks right after a download (warms the validated cache).
      prepare: (...args) => owner.prepareOnly?.(...args),
      library: () => owner.library(),
      remove: releaseId => owner.removeRelease(releaseId),
      description: () => owner.catalog.description(),
      actions: (...args) => owner.actions(...args), activity: (...args) => owner.activity(...args),
      resolveAsset: ref => owner.resolveAsset(ref), beginLocal: () => owner.beginLocal(), arm: () => owner.arm(), observe: state => owner.observe(state),
      signOut,
      async close() {
        if (signingOut) return signingOut;
        try { await owner.stop(); } finally { await finish(); }
      },
    });
  } catch (e) { if (owner) await owner.stop().catch(() => {}); await finish(); throw e; }
}
