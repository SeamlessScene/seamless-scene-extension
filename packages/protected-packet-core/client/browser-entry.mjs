import { subscribePrivateSignOut } from './browser-signout-channel.mjs';
import { importJWK } from 'jose';
import { createProtectedBrowserOwner } from './browser-owner.mjs';
import { openVaultManager } from './vault-manager.mjs';
import { privateAccountState, selectPrivateAccount, rollbackPrivateAccount } from './browser-account.mjs';
import { readProtectedPairingCredentials } from '../../browser-extension/src/device-credentials.mjs';
export { SIGNOUT_KEY } from './browser-signout.mjs';
const key = 'protectedSignout.candidate1';
const publicKeys = async entries => new Map(await Promise.all(entries.map(async ({ kid, jwk }) => {
  if (typeof kid !== 'string' || jwk?.kty !== 'OKP' || jwk.crv !== 'Ed25519' || jwk.d !== undefined) throw Error('protected-public-key-required');
  return [kid, { key: await importJWK(jwk, 'EdDSA'), status: 'active' }];
})));
// Edits page: list and delete kept encrypted edits (no account, license or key).
export async function createConfiguredVaultManager({ trust }) {
  if (!trust?.enabled || !Array.isArray(trust.descriptorKeys)) throw Error('protected-trust-unconfigured');
  return openVaultManager({ descriptorTrust: await publicKeys(trust.descriptorKeys) });
}
export async function createConfiguredProtectedOwner({ trust, pairingConfig, online, ...options }) {
  if (!trust?.enabled || trust.fixtureOnly !== pairingConfig.fixtureOnly || !trust.issuer ||
      !Array.isArray(trust.descriptorKeys) || !Array.isArray(trust.licenseKeys)) throw Error('protected-trust-unconfigured');
  const marker = (await chrome.storage.local.get(key))[key];
  const selected = await privateAccountState();
  const account = online ? (await readProtectedPairingCredentials(pairingConfig)).accountId : selected.account;
  if (!account) throw Error('protected-offline-account-unavailable');
  const load = publicKeys;
  let owner, selectedHere = false;
  try {
    owner = await createProtectedBrowserOwner({ ...options, pairingConfig, issuer: trust.issuer, account,
      descriptorTrust: await load(trust.descriptorKeys), licenseTrust: await load(trust.licenseKeys), external: true,
      subscribeSignOut(callback) {
        return subscribePrivateSignOut(chrome.runtime, callback);
      } });
    if ((await chrome.storage.local.get(key))[key] !== marker) throw Error('protected-signout-race');
    await selectPrivateAccount(account, selected.generation); selectedHere = true;
    if ((await chrome.storage.local.get(key))[key] !== marker) throw Error('protected-signout-race');
    return owner;
  } catch (e) {
    try { if (selectedHere) await rollbackPrivateAccount(account, selected.generation); }
    finally { if (owner) await owner.close(); }
    throw e;
  }
}
