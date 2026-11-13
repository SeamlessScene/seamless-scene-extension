import { createViewerStore } from './src/viewer-store.mjs';
import { registerViewerSites } from './src/viewer-site-access.mjs';
import { registerViewerService } from './src/viewer-service.mjs';
import { registerDeviceLinkService } from './src/device-link-service.mjs';
import { registerLocalPlaybackRelay } from './src/local-playback-protocol.mjs';
import { registerCatalogRuntimeService } from './src/catalog-runtime-service.mjs';
import { EXECUTING_BUILD } from './src/build-info.mjs';
import { sameExecutingBuild } from './src/build-identity.mjs';
import { runtimeDocument } from './src/runtime-document.mjs';
import { registerViewerWebBridge } from './src/viewer-web-bridge.mjs';
import { registerCreatorBuilderBridge, registerCreatorPanelGate } from './src/edition-background.mjs';

const DEFAULT_DEPS = Object.freeze({ createViewerStore, registerViewerSites, registerViewerService, registerDeviceLinkService,
  registerLocalPlaybackRelay, registerCatalogRuntimeService, registerCreatorBuilderBridge, registerViewerWebBridge, registerCreatorPanelGate });

// Service-worker composition. The worker entry passes chrome, the trust config and the
// protected sign-out; tests pass doubles and import this module directly (so they never
// load the generated protected bundle).
export function startBackground({ chrome, catalogTrustConfig, signOutProtected, deps = {} }) {
const { createViewerStore, registerViewerSites, registerViewerService, registerDeviceLinkService, registerLocalPlaybackRelay,
  registerCatalogRuntimeService, registerCreatorBuilderBridge, registerViewerWebBridge, registerCreatorPanelGate } = { ...DEFAULT_DEPS, ...deps };
async function clearViewerProtected(){
 const results=await Promise.allSettled([Promise.resolve().then(()=>signOutProtected()),Promise.resolve().then(()=>createViewerStore().invalidateProtected())]);
 if(results.some(r=>r.status==='rejected'))throw Error('catalog-protected-signout-incomplete');
}
const localPlaybackRelay = registerLocalPlaybackRelay(chrome.runtime);
registerCatalogRuntimeService(chrome.runtime, catalogTrustConfig, { authorizeRenderer: localPlaybackRelay.authorizeRenderer });
const creatorPanel = registerCreatorPanelGate(chrome, { readMode: async () => (await createViewerStore().read()).preferences?.mode });
const viewerService = registerViewerService(chrome.runtime, catalogTrustConfig, {authorizeRenderer:localPlaybackRelay.authorizeRenderer,onPreferences:()=>void creatorPanel.refresh()});
registerViewerWebBridge(chrome.runtime, catalogTrustConfig, { service: viewerService });
registerDeviceLinkService(chrome.runtime, catalogTrustConfig, {cleanup:()=>clearViewerProtected(),authorizeRenderer:localPlaybackRelay.authorizeRenderer,
  getPlayerIdentityState:()=>viewerService?.playerIdentityState?.()??'unknown'});
registerCreatorBuilderBridge(chrome.runtime, catalogTrustConfig);

registerViewerSites(chrome);
// First install: the welcome checklist (link account, allow Prime Video, browse edits).
chrome.runtime.onInstalled?.addListener(details=>{if(details?.reason==='install')void chrome.tabs.create({url:chrome.runtime.getURL('welcome.html')});});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind === "enable-prime-identity-bridge") {
    if (!sameExecutingBuild(message.build)) { sendResponse({ ok: false, errorCode: 'prime-identity-build-mismatch-refresh-required', build: EXECUTING_BUILD }); return; }
    void enablePrimeIdentityBridge(sender)
      .then(() => sendResponse({ ok: true, status: "prime-identity-bridge-injected", build: EXECUTING_BUILD }))
      .catch(() => sendResponse({ ok: false, errorCode: "prime-identity-bridge-injection-failed" }));
    return true;
  }
});

async function enablePrimeIdentityBridge(sender) {
  const document = runtimeDocument(sender, chrome.runtime.id);
  if (!document || document.frameId !== 0) {
    throw new Error("prime-identity-sender-invalid");
  }
  if (!["https://www.amazon.com", "https://www.primevideo.com"].includes(document.origin) || document.topOrigin !== document.origin) {
    throw new Error("prime-identity-origin-invalid");
  }
  const moduleUrl = new URL(chrome.runtime.getURL("src/prime-identity-endpoint.mjs"));
  moduleUrl.searchParams.set("build", chrome.runtime.getManifest().version);
  const results = await chrome.scripting.executeScript({
    // A tab/frame can navigate between admission and execution. Never retry a
    // missing document by falling back to the tab's new top-level document.
    target: { tabId: document.tabId, documentIds: [document.documentId] },
    world: "MAIN",
    func: async (url) => { await import(url); },
    args: [moduleUrl.href]
  });
  if (!Array.isArray(results) || results.length !== 1 || results[0].frameId !== 0 || results[0].documentId !== document.documentId) {
    throw new Error('prime-identity-document-not-confirmed');
  }
}
}
