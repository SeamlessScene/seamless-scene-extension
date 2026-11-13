import { createDiskVault } from './disk-vault.mjs';

/** Lists and removes the encrypted edits kept on this device, for the extension's
 * Edits page. It holds no credentials, licenses or keys and never decrypts: it only
 * reads signed receipts and sizes, and deletes directories. It shares the protected
 * owner lock, so it never touches storage an owner is using, and releases it at once. */
export async function openVaultManager({ descriptorTrust, lockWaitMs = 5_000, navigatorApi = globalThis.navigator,
  chromeApi = globalThis.chrome, locationApi = globalThis.location }) {
  if (locationApi?.protocol !== 'chrome-extension:' || locationApi.hostname !== chromeApi?.runtime?.id ||
    locationApi.pathname !== '/viewer-settings.html' || !navigatorApi?.locks?.request || !navigatorApi?.storage?.getDirectory) throw Error('protected-vault-page-required');
  if (!(descriptorTrust instanceof Map) || !descriptorTrust.size) throw Error('protected-release-trust-required');
  async function withVault(work) {
    return navigatorApi.locks.request('seamless-protected-owner-candidate-1', { mode: 'exclusive', signal: AbortSignal.timeout(lockWaitMs) }, async () => {
      let open = true;
      const root = await (await navigatorApi.storage.getDirectory()).getDirectoryHandle('seamless-protected-candidate-1', { create: true });
      const vault = await createDiskVault({ root, descriptorTrust, assertOwner: () => { if (!open) throw Error('protected-vault-closed'); } });
      try { return await work(vault); } finally { open = false; }
    }).catch(error => { throw error?.name === 'TimeoutError' || error?.name === 'AbortError' ? Error('protected-owner-busy') : error; });
  }
  return Object.freeze({
    list: () => withVault(vault => vault.list()),
    remove: releaseId => withVault(vault => vault.remove(releaseId)),
  });
}
