import {refreshCatalogControl} from './catalog-control-updates.mjs';
import { CatalogActivationStore } from './catalog-activation-store.mjs';
import { EXTENSION_VERSION, ADAPTER_VERSION, EXECUTING_BUILD } from './build-info.mjs';
import { sameExecutingBuild } from './build-identity.mjs';
import { runtimeDocument } from './runtime-document.mjs';
import { CATALOG_PACKET_SCHEMA, CATALOG_MEDIA_PROFILE, CATALOG_PACKET_MAX_BYTES } from './catalog-packet.mjs';
import { assertActive } from './operation-context.mjs';

const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const CATALOG_SERVICE_MAX_ACTIVE = 8;
export const CATALOG_SERVICE_TIMEOUT_MS = 8000;

const SOURCE_FIELDS = ['serviceId', 'activeItemId', 'runtimeMs', 'season', 'episode', 'mediaType', 'versionTag', 'territory', 'plan'];
export function catalogObservedSource(value) {
  const output = {};
  for (const field of SOURCE_FIELDS) {
    const item = value?.[field] ?? null;
    if (!['string', 'number'].includes(typeof item) && item !== null) throw Error('catalog-source-invalid');
    if ((typeof item === 'string' && [...item].length > 256) || (typeof item === 'number' && !Number.isSafeInteger(item))) throw Error('catalog-source-invalid');
    output[field] = item;
  }
  return output;
}
export function catalogRendererService(sender, extensionId, { fixtureOnly = false, fixtureService = 'cleared-fixture' } = {}) {
  const document = runtimeDocument(sender, extensionId);
  if (!document || document.frameId < 1) return null;
  try {
    const frame = new URL(sender.url), tab = new URL(sender.tab.url);
    if (frame.protocol !== 'chrome-extension:' || frame.hostname !== extensionId || frame.pathname !== '/local-playback-frame.html') return null;
    if (fixtureOnly && !['fixture', 'cleared-fixture'].includes(fixtureService)) return null;
    if (fixtureOnly) return tab.protocol === 'chrome-extension:' && tab.hostname === extensionId && tab.pathname === '/catalog-fixture.html' ? fixtureService : null;
    if (['https://www.amazon.com', 'https://www.primevideo.com'].includes(tab.origin)) return 'prime-video';
  } catch {}
  return null;
}

/** Register only in the extension service worker. All catalog storage/locks live
 * here, so embedded renderer storage partitioning cannot fork version floors. */
export function registerCatalogRuntimeService(runtime, config, { storageArea = globalThis.chrome?.storage?.local, locks = globalThis.navigator?.locks, fetcher = globalThis.fetch, authorizeRenderer = () => false } = {}) {
  let store;
  const pending = new Map();
  runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.kind !== 'catalog-v2') return;
    const service = catalogRendererService(sender, runtime.id, config);
    let replied = false;
    const reply = value => { if (replied) return; replied = true; try { respond(value); } catch {} };
    const fail = error => {
      // Storage/transport errors can contain URLs or local details.
      const code = /^(?:catalog-|packet-|manifest-|client-|signing-|unknown-signing-|signature-|schema-|downgrade-|immutable-|edit-id-)[a-z0-9-]+$/.test(error?.message)
        ? error.message : 'catalog-service-unavailable';
      reply({ ok: false, code });
    };
    let owner;
    try {
      if (!service || authorizeRenderer(sender) !== true) throw Error('catalog-sender-denied');
      if (!message || typeof message !== 'object' || !['policy', 'accept', 'compile', 'refresh', 'cancel'].includes(message.method) ||
        new TextEncoder().encode(JSON.stringify(message)).length > CATALOG_PACKET_MAX_BYTES + 4096) throw Error('catalog-request-invalid');
      if (runtime.getManifest().version !== EXTENSION_VERSION || !sameExecutingBuild(message.build)) throw Error('catalog-mixed-client-build');
      if (typeof message.requestId !== 'string' || !REQUEST_ID.test(message.requestId)) throw Error('catalog-request-invalid');
      owner = `${sender.tab.id}:${sender.frameId}:${sender.documentId}`;
      if (message.method === 'cancel') {
        if (Object.keys(message).sort().join(',') !== 'build,kind,method,requestId') throw Error('catalog-request-invalid');
        const target = pending.get(message.requestId);
        if (target && target.owner !== owner) throw Error('catalog-sender-denied');
        target?.controller.abort(Error('catalog-request-cancelled'));
        reply({ ok: true, value: { cancelled: Boolean(target) }, build: EXECUTING_BUILD });
        return true;
      }
      if (pending.has(message.requestId)) throw Error('catalog-request-duplicate');
      if (pending.size >= CATALOG_SERVICE_MAX_ACTIVE) throw Error('catalog-service-busy');
    } catch (error) { fail(error); return true; }
    const controller = new AbortController(), entry = { owner, controller };
    pending.set(message.requestId, entry);
    const assertAuthority = () => {
      assertActive(controller.signal);
      if (authorizeRenderer(sender) !== true) throw Error('catalog-sender-denied');
    };
    const onAbort = () => fail(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const deadline = setTimeout(() => controller.abort(Error('catalog-service-timeout')), CATALOG_SERVICE_TIMEOUT_MS);
    const run = async () => {
      assertAuthority();
      const policy = { service, fixtureOnly: config.fixtureOnly === true, trustedKeys: structuredClone(config.trustedKeys), adapterVersion: ADAPTER_VERSION,
        capabilities: { clientVersion: EXTENSION_VERSION, packetSchemas: [CATALOG_PACKET_SCHEMA], mediaProfiles: [CATALOG_MEDIA_PROFILE] },
        revokedVersions: structuredClone(config.revokedVersionsByEdit?.[message.packet?.manifest?.edit_id] ?? []) };
      if (message.method === 'policy') return policy;
      store ??= new CatalogActivationStore({ storageArea, locks });
      const refresh = editId => refreshCatalogControl({editId,store,policy,origin:config.controlOrigin,fixtureOnly:config.fixtureOnly===true,fetcher,signal:controller.signal,assertAuthority});
      if (message.method === 'refresh') {
        if (Object.keys(message).sort().join(',') !== 'build,kind,method,playbackEditId,requestId') throw Error('catalog-request-invalid');
        policy.revokedVersions = structuredClone(config.revokedVersionsByEdit?.[message.playbackEditId] ?? []);
        return refresh(message.playbackEditId);
      }
      if (message.packet?.manifest?.source?.service !== service) throw Error('catalog-wrong-service');
      if (message.method === 'accept') {
        const accepted = await store.accept(message.packet, { ...policy, signal: controller.signal, assertAuthority });
        const updated = await refresh(message.packet.manifest.edit_id);
        return updated.status === 'disabled' ? updated : accepted;
      }
      await refresh(message.packet?.manifest?.edit_id);
      const observedSource = catalogObservedSource(message.observedSource);
      if (observedSource.serviceId !== service) throw Error('catalog-wrong-service');
      return store.compile(message.packet, { ...policy, observedSource, resolveAssetUrl: hash => `asset:${hash}`, signal: controller.signal, assertAuthority });
    };
    void run().then(value => {
      // Do not publish a successful result into a discarded document/session.
      // A valid signed version record already committed by storage is retained;
      // disconnect is not authority to roll back its security floor.
      assertAuthority();
      reply({ ok: true, value, build: EXECUTING_BUILD });
    }).catch(fail).finally(() => {
      clearTimeout(deadline);
      controller.signal.removeEventListener('abort', onAbort);
      // Native StorageArea calls cannot be recalled. Keep admission occupied
      // until the actual operation settles, even after its caller times out.
      if (pending.get(message.requestId) === entry) pending.delete(message.requestId);
    });
    return true;
  });
}
