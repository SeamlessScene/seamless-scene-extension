import { readProtectedPairingCredentials } from '../../browser-extension/src/device-credentials.mjs';
import { catalogControlOrigin } from '../../browser-extension/src/catalog-control-updates.mjs';
import { createProtectedWebsiteClient } from './website-client.mjs';

/** Privileged composition only. Does not register any RPC or expose bearer/IDs
 * to the public account UI. Deployment/build admission is a separate gate. */
export function createPairedProtectedWebsiteClient({ pairingConfig, storage, locks, fetchImpl = globalThis.fetch,
  issuer, descriptorTrust, licenseTrust, getInstallation, now = () => Date.now(), monotonic, timeoutMs }) {
  const origin = catalogControlOrigin(pairingConfig.pairingOrigin, { fixtureOnly: pairingConfig.fixtureOnly === true });
  return createProtectedWebsiteClient({ origin, issuer, descriptorTrust, licenseTrust, getInstallation, fetchImpl, now, monotonic, timeoutMs,
    // Conservative candidate: refresh status for every authoritative credential
    // read. Cached optimization requires a reviewed invalidation/refresh policy.
    getCredentials: signal => readProtectedPairingCredentials(pairingConfig, { signal, now }),
  });
}
