import { installReadOnlyIdentityBridgeEndpoint as installBridge } from "./read-only-identity-bridge.mjs";
import { createPrimeIdentitySnapshotReader as createReader } from "./prime-identity-reader.mjs";
import { EXECUTING_BUILD } from './build-info.mjs';
import { sameExecutingBuild as sameBuild } from './build-identity.mjs';

const ALLOWED_HOSTS = new Set(["www.amazon.com", "www.primevideo.com"]);
export const PRIME_IDENTITY_ENDPOINT_KEY = "__sceneSubstitutionPrimeIdentityEndpointV1";

// Installs the read-only identity endpoint in the page's own world, once per
// build: a newer build replaces an older endpoint, and an old endpoint's close
// never removes a newer one. Globals are parameters so tests can supply doubles.
export function installPrimeIdentityEndpoint({
  globalScope = globalThis, window = globalThis.window, document = globalThis.document, location = globalThis.location,
  executingBuild = EXECUTING_BUILD, sameExecutingBuild = value => sameBuild(value, executingBuild),
  createPrimeIdentitySnapshotReader = createReader, installReadOnlyIdentityBridgeEndpoint = installBridge,
  setInterval = globalThis.setInterval.bind(globalThis), clearInterval = globalThis.clearInterval.bind(globalThis)
} = {}) {
  const previous = globalScope[PRIME_IDENTITY_ENDPOINT_KEY];
  if (ALLOWED_HOSTS.has(location.hostname) && previous && !sameExecutingBuild(previous.executingBuild)) {
    if (typeof previous.close !== 'function') throw Error('prime-identity-build-mismatch-refresh-required');
    previous.close();
  }
  if (!ALLOWED_HOSTS.has(location.hostname) || globalScope[PRIME_IDENTITY_ENDPOINT_KEY]) return;
  const reader = createPrimeIdentitySnapshotReader({ document });
  const endpoint = installReadOnlyIdentityBridgeEndpoint({
    window,
    origin: location.origin,
    readSnapshot: () => reader.readSnapshot()
  });
  let lastGeneration = reader.readSnapshot({ includeCanonicalClock: false }).lifecycleGeneration;
  const lifecyclePoll = setInterval(async () => {
    const generation = reader.readSnapshot({ includeCanonicalClock: false }).lifecycleGeneration;
    if (generation === lastGeneration) return;
    lastGeneration = generation;
    await endpoint.notifyIdentityChanged();
  }, 750);

  const close = () => {
    clearInterval(lifecyclePoll);
    endpoint.close();
    window.removeEventListener('pagehide', close);
    if (globalScope[PRIME_IDENTITY_ENDPOINT_KEY]?.close === close) delete globalScope[PRIME_IDENTITY_ENDPOINT_KEY];
  };
  globalScope[PRIME_IDENTITY_ENDPOINT_KEY] = { close, executingBuild };
  window.addEventListener("pagehide", close, { once: true });
}
