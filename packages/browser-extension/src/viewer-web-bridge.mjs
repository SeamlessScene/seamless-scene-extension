import { EXECUTING_BUILD } from './build-info.mjs';
import { versionAtLeast } from './seamless-rules.mjs';
import { websiteOrigins, senderWebsiteOrigin } from './website-origins.mjs';

// "Watch this edit" on the configured website. Only its exact origins may ask;
// it learns only what it needs to show one button: whether the extension is set up,
// and a download's progress. The release id is the only input, and the extension
// never opens or trusts a URL the page supplies.
export const WATCH_KIND = 'viewer-watch-v1';
const WATCH_HOSTS = new Set(['www.amazon.com', 'www.primevideo.com']);
const UUID =/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function registerViewerWebBridge(runtime, config, { service, permissions = globalThis.chrome?.permissions } = {}) {
  const origins = websiteOrigins(config);
  runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
    if (message?.kind !== WATCH_KIND) return false;
    if (!senderWebsiteOrigin(origins, sender)) { sendResponse({ ok: false, error: 'origin-refused' }); return false; }
    (async () => {
      if (message.op === 'status') {
        // The host the edit's title opens on, when the website names one; only
        // hosts the extension can be allowed on are ever queried.
        const host = message.host ?? 'www.amazon.com';
        let siteAccess = false;
        if (WATCH_HOSTS.has(host)) try { siteAccess = await permissions.contains({ origins: [`https://${host}/*`] }); } catch {}
        return { ok: true, version: EXECUTING_BUILD.version, account: await service.account(), siteAccess, supportsWatch: true };
      }
      if (!UUID.test(message.releaseId ?? '')) return { ok: false, error: 'release-invalid' };
      // E61: a Prime tab already open on this title is focused; focusedTab tells the
      // website it need not open another one.
      // 0.65.0 (W9): the website may name the release's required_client_version. A release made for
      // a newer extension is refused here, before anything is downloaded.
      if (message.op === 'watch' && message.requiredClientVersion !== undefined) {
        if (!versionAtLeast(message.requiredClientVersion, '0.0.0')) return { ok: false, error: 'release-invalid' };
        if (!versionAtLeast(EXECUTING_BUILD.version, message.requiredClientVersion)) return { ok: false, error: 'client-update-required', version: EXECUTING_BUILD.version, requiredClientVersion: message.requiredClientVersion };
      }
      if (message.op === 'watch') return { ok: true, ...(await service.recordIntent(message.releaseId, { focus: true })) };
      if (message.op === 'job') return { ok: true, job: service.job(message.releaseId) };
      return { ok: false, error: 'operation-invalid' };
    })().then(sendResponse, () => sendResponse({ ok: false, error: 'watch-failed' }));
    return true;
  });
}
