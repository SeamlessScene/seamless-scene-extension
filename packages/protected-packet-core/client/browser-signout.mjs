import { createInstallationStore } from './installation-store.mjs';
import { createLeaseCache } from './lease-cache.mjs';
import { privateAccount } from './browser-account.mjs';
import { EXECUTING_BUILD } from '../../browser-extension/src/build-info.mjs';
import { sameExecutingBuild } from '../../browser-extension/src/build-identity.mjs';
export const SIGNOUT_KEY = 'protectedSignout.candidate1';
export async function signOutProtected({ chromeApi = globalThis.chrome, indexedDB = globalThis.indexedDB,
  navigatorApi = globalThis.navigator, createCache = createLeaseCache, createInstallation = createInstallationStore,
  clearAccount = () => privateAccount(null, indexedDB) } = {}) {
  // The persistent marker fences owner construction; tombstones fence late
  // installation/grant writes. Every cleanup is attempted even after a failure.

  const cache = createCache({ indexedDB }), installation = createInstallation({ indexedDB });
  const failures = [];
  const collect = async fn => { try { return await fn(); } catch (e) { failures.push(e); } };
  try {
    await collect(() => chromeApi.storage.local.set({ [SIGNOUT_KEY]: crypto.randomUUID() }));
    await Promise.all([collect(() => cache.clear()), collect(() => installation.clear()), collect(clearAccount)]);
    const clearDiskIfUnowned = () => navigatorApi.locks.request('seamless-protected-owner-candidate-1', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) return false;
      const root = await navigatorApi.storage.getDirectory();
      await root.removeEntry('seamless-protected-candidate-1', { recursive: true }).catch(e => { if (e.name !== 'NotFoundError') throw e; });
      return true;
    });
    const unowned = await collect(clearDiskIfUnowned);
    if (unowned !== true) {
      await collect(async () => {
        let timer; let response;
        try { response = await Promise.race([
          chromeApi.runtime.sendMessage({ kind: 'protected-signout', build: EXECUTING_BUILD }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('protected-signout-timeout')), 15000); timer.unref?.(); })
        ]); } finally { clearTimeout(timer); }
        if (response?.ok !== true || !sameExecutingBuild(response.build)) throw Error('protected-native-cleanup-unconfirmed');
      });
      if (await collect(clearDiskIfUnowned) !== true) failures.push(Error('protected-owner-cleanup-unconfirmed'));
    }
    if (failures.length) throw Error('protected-signout-cleanup-failed');
  } finally { cache.close(); installation.close(); }
}
