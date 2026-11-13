import { EDITION } from './build-info.mjs';
// The authoring page bridge serves Creator tools only, so the viewer edition does not inject it.
const PAGE_SCRIPTS = EDITION === 'viewer' ? ['bootstrap.js'] : ['bootstrap.js', 'authoring-page-bridge.js'];
const SITES = ['https://www.amazon.com/*', 'https://www.primevideo.com/*'];
const PREFIX = 'seamless-viewer-';
export async function syncViewerSites({permissions, scripting}) {
  const desired = [];
  for (let i = 0; i < SITES.length; i++) {
    if (await permissions.contains({origins: [SITES[i]]})) desired.push({id: PREFIX + i, matches: [SITES[i]], js: PAGE_SCRIPTS, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true});
  }
  const existing = await scripting.getRegisteredContentScripts();
  const owned = existing.filter(item => item.id.startsWith(PREFIX));
  const removed = owned.filter(item => !desired.some(next => next.id === item.id)).map(item => item.id);
  if (removed.length) await scripting.unregisterContentScripts({ids: removed});
  const added = desired.filter(item => !owned.some(old => old.id === item.id));
  const updated = desired.filter(item => owned.some(old => old.id === item.id));
  if (added.length) await scripting.registerContentScripts(added);
  if (updated.length) await scripting.updateContentScripts(updated);
}
export function registerViewerSites(api) {
  let queue = Promise.resolve();
  const refresh = () => { queue = queue.catch(() => {}).then(() => syncViewerSites(api)); void queue.catch(() => {}); };
  api.permissions.onAdded.addListener(refresh);
  api.permissions.onRemoved.addListener(refresh);
  api.runtime.onInstalled.addListener(refresh);
  api.runtime.onStartup.addListener(refresh);
  refresh();
}
