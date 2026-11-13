import { viewerRequest } from './src/viewer-client.mjs';
import { createViewerStore } from './src/viewer-store.mjs';
import { defaultStorageBudget, viewerFailureMessage } from './src/viewer-model.mjs';
import { cleanPageTitle, showLine } from './src/viewer-display.mjs';
import { downloadedRows, downloadRows, previousRows, storageSummary, formatBytes, followedNotice, handoffNotice } from './src/edits-model.mjs';
import { mountLocalTab, localVisible } from './src/local-tab.mjs';
import { createLibraryRemoval, vaultRemover } from './src/library-removal.mjs';
import { EDITION, EXTENSION_VERSION } from './src/build-info.mjs';
import { protectedTrustConfig } from './protected-trust-config.mjs';
import { createStableRowRenderer } from './src/stable-row-renderer.mjs';
import { createConfiguredVaultManager } from './vendor/protected/owner.mjs';
import { loadStatusMessage, isActiveLoadPhase } from './src/viewer-load-status.mjs';
import { keptIds, metadataGaps, recoveryEntries } from './src/library-recovery.mjs';

// Settings → Library: the website edits kept on this device; Settings → Local: the
// viewer's local edits (.ss files, src/local-tab.mjs). Kept files are listed through the private vault manager (sizes and
// problems only), or through an open player tab while it is using them.
const $ = q => document.querySelector(q), store = createViewerStore();
const notice = text => { const el = $('#notice'); if (el) el.textContent = text; };
let updates = {}, vault = null, manager = null;
let followed = null;
// A Watch hand-off line is cleared once the viewer comes back to this page (handoffNotice).
let handoff = null;
const settleHandoff = () => {
  if (!handoff) return;
  const next = handoffNotice(handoff, { hidden: document.hidden, focused: document.hasFocus() }, $('#notice')?.textContent ?? '');
  if (next.text !== undefined) notice(next.text);
  handoff = next.handoff;
};
const noticeHandoff = text => { notice(text); handoff = { text }; settleHandoff(); };
document.addEventListener('visibilitychange', settleHandoff);
addEventListener('focus', settleHandoff);
addEventListener('blur', settleHandoff);
async function requestDownload(args) {
  followed = { releaseId: args.releaseId, progress: null };
  notice('Waiting to start…');
  try {
    const result = await viewerRequest('watch-intent', args);
    const text = loadStatusMessage(result.job) ?? result.message ?? 'Waiting to start…';
    notice(text);
    if (followed?.releaseId === args.releaseId && isActiveLoadPhase(result.job?.state)) followed = { releaseId: args.releaseId, progress: text };
  } catch (error) {
    followed = null;
    throw error;
  }
}

// The side menu is hash-routed. Links from 0.60 and earlier (#edits, #settings) still land.
const SECTIONS = ['library', 'playback', 'account', ...(EDITION === 'viewer' ? [] : ['creator']), 'local', 'advanced'], OLD = { edits: 'library', settings: 'playback' };
// Advanced → "Show the Local tab" (on by default) hides the tab; a link to it then lands on Library.
let localShown = true, localTab = null;
function showTab(name) {
  let tab = SECTIONS.includes(name) ? name : OLD[name] ?? 'library';
  if (tab === 'local' && !localShown) tab = 'library';
  for (const link of document.querySelectorAll('[data-tab]')) {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('[data-tab-panel]')) panel.hidden = panel.dataset.tabPanel !== tab;
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
  if (tab === 'local') void localTab?.opened().catch(() => {});
}
function applyLocalVisibility(shown) {
  localShown = shown;
  const link = $('#local-link'); if (link) link.hidden = !shown;
  if (!shown && location.hash.slice(1) === 'local') showTab('library');
}
addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

// A player tab holds the kept files while it is open, so ask it first; with none
// open, read them directly under the owner lock.
async function vaultList() {
  try { return (await viewerRequest('edits-library', {})).items; } catch {}
  try {
    manager ??= protectedTrustConfig.enabled ? await createConfiguredVaultManager({ trust: protectedTrustConfig }) : null;
    return manager ? await manager.list() : [];
  } catch { return null; }
}
const vaultRemove = vaultRemover({ viewerRequest, openManager: async () => (manager ??= protectedTrustConfig.enabled ? await createConfiguredVaultManager({ trust: protectedTrustConfig }) : null) });

const cell = (row, content) => { const td = document.createElement('td'); if (content?.nodeType) td.append(content); else td.textContent = content ?? '—'; row.append(td); return td; };
// A button that disables itself while its action runs, reports a failure in plain words, then re-renders.
const button = (label, onClick) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  b.onclick = () => {
    b.disabled = true;
    void Promise.resolve().then(onClick).catch(e => notice(viewerFailureMessage(e))).finally(() => { b.disabled = false; void render(); });
  };
  return b;
};
const showText = row => [cleanPageTitle(row.titleName ?? ''), row.episodeName].filter(Boolean).join(' · ');
const titleLink = row => {
  const a = document.createElement('a'); a.href = row.streamingUrl; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = showText(row) || 'Open on Prime Video ↗';
  return a;
};
const editName = (name, version) => {
  const span = document.createElement('span'); span.className = 'edit-name'; span.textContent = name;
  if (version) { const v = document.createElement('span'); v.className = 'v'; v.textContent = `v${version}`; span.append(v); }
  return span;
};
const watchedText = at => {
  if (!at) return null;
  const day = new Date(at), today = new Date();
  return day.toDateString() === today.toDateString() ? 'Today' : day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const removal = createLibraryRemoval({ store, removeFromVault: vaultRemove });
let hiddenRemovals = new Set();
const VAULT_BUSY_TEXT = 'Your downloaded edits are in use by a Prime Video tab, so they cannot be listed right now. Stop the edit there, or refresh that tab. If this lasts, restart Chrome.';
let emptyText = null;
// Remove shows Undo: the files are deleted when the Undo window closes. 8 s proved too short in
// testing; 30 s costs nothing. 0.63.2: the pending removal is stored, so closing the page inside the
// window cannot lose it: the next visit finishes it (library-removal.mjs).
let pendingRemoval = null;
async function scheduleRemoval(row) {
  if (pendingRemoval) { const previous = pendingRemoval; pendingRemoval = null; await removal.commit(previous.releaseId).catch(e => notice(viewerFailureMessage(e))); }
  pendingRemoval = { releaseId: row.releaseId };
  await removal.schedule(row.releaseId, error => {
    if (pendingRemoval?.releaseId === row.releaseId) { pendingRemoval = null; $('#undo-bar').hidden = true; }
    if (error) notice(`${row.name} could not be removed: ${viewerFailureMessage(error)}`);
    void render();
  });
  $('#undo-text').textContent = `Removed ${row.name} from this device.`;
  $('#undo-bar').hidden = false; $('#undo').focus();
}
$('#undo').onclick = () => {
  if (!pendingRemoval) return;
  const { releaseId } = pendingRemoval; pendingRemoval = null; $('#undo-bar').hidden = true;
  void removal.undo(releaseId).then(() => { notice('The edit was kept.'); return render(); });
};
// Removals left pending when Settings closed last time are finished now (no Prime tab needed).
void removal.resume().then(failures => {
  for (const f of failures) notice(`A removed edit could not be deleted yet: ${viewerFailureMessage(f.error)}`);
  return render();
}).catch(() => {});

// Kept releases with missing library details (downloaded by Update or Watch
// without being opened). Ask the website once per page visit; Check for
// updates asks again. The page's own vault listing is the evidence that lets
// a status hint create a row here; the service joins its renderer's evidence.
const metadataAttempted = new Set();
let metadataRequest = null;
async function recordStatus(items, listing) {
  const kept = keptIds(listing);
  const entries = recoveryEntries(items, id => kept.has(id));
  if (entries.length) await store.recoverMetadata(entries).catch(() => []);
}
function recoverMissing(library, listing) {
  if (metadataRequest || !listing) return;
  const ids = metadataGaps(library, listing).filter(id => !metadataAttempted.has(id));
  if (!ids.length) return;
  for (const id of ids) metadataAttempted.add(id);
  metadataRequest = viewerRequest('release-metadata', { releaseIds: ids })
    .then(result => recordStatus(result.items, listing))
    .catch(() => {})
    .finally(() => { metadataRequest = null; if (!document.hidden) void render(); });
}

async function render() {
  const [snapshot, estimate] = await Promise.all([viewerRequest('snapshot', {}).catch(() => null), navigator.storage.estimate().catch(() => null)]);
  const data = snapshot ?? await store.read();
  // Creator → "Make a .ss file": the website builder makes the file (0.63.1).
  const projects = $('#creator-projects');
  if (projects && snapshot?.websiteOrigin) { projects.href = `${new URL(snapshot.websiteOrigin).origin}/creator/projects`; projects.hidden = false; }
  if (followed) {
    const next = followedNotice(followed, snapshot?.jobs ?? null, $('#notice')?.textContent ?? '');
    if (next.text !== undefined) notice(next.text);
    followed = next.following;
  }
  settleHandoff();
  hiddenRemovals = await removal.pendingIds().catch(() => new Set());
  vault = await vaultList();
  recoverMissing(data.library ?? [], vault);
  const preferences = data.preferences ?? {};
  const budgetBytes = preferences.storageBudgetBytes ?? defaultStorageBudget(estimate);
  $('#storage-summary').textContent = vault === null ? 'Your downloaded edits are in use by a Prime Video tab; sizes show when it is free.' : storageSummary({ vault, budgetBytes, estimate }).label;
  $('#storage-budget').value = preferences.storageBudgetBytes ? String(preferences.storageBudgetBytes) : '';
  renderDownloads(downloadRows({ library: data.library ?? [], vault, jobs: snapshot?.jobs ?? [] }));
  renderPrevious(previousRows(snapshot?.previouslyQueued ?? []));
  const rows = downloadedRows({ library: data.library ?? [], vault, jobs: snapshot?.jobs ?? [], updates })
    .filter(row => !hiddenRemovals.has(row.releaseId))
    .map(row => ({ ...row, updateReleaseId: updates[row.releaseId]?.latestReleaseId ?? null }));
  renderDownloadedRows(rows);
  // A busy vault cannot be listed: say so rather than "No edits downloaded yet" (E41).
  const empty = $('#downloaded-empty');
  emptyText ??= empty.textContent;
  empty.textContent = vault === null ? VAULT_BUSY_TEXT : emptyText;
  empty.hidden = rows.length > 0;
}

const renderDownloadedRows = createStableRowRenderer($('#downloaded-edits tbody'), row => {
    const tr = document.createElement('tr');
    cell(tr, editName(row.name, row.version));
    cell(tr, row.streamingUrl ? titleLink(row) : showText(row) || null);
    cell(tr, row.bytes === null ? null : formatBytes(row.bytes));
    cell(tr, watchedText(row.lastWatchedAt));
    const status = cell(tr, row.status.label); status.className = `status-${row.status.kind}`;
    const actions = document.createElement('div'); actions.className = 'actions';
    if (row.actions.includes('watch')) actions.append(button('Watch', async () => {
      const result = await viewerRequest('watch-intent', { releaseId: row.releaseId, open: true });
      noticeHandoff(result.message ?? 'Opening the title. The edit turns on when you press play.');
    }));
    if (row.actions.includes('update')) actions.append(button('Update', async () => {
      await requestDownload({ releaseId: row.updateReleaseId, replaces: row.releaseId });
    }));
    if (row.actions.includes('repair')) actions.append(button('Repair', async () => {
      if (row.actions.includes('remove')) await vaultRemove(row.releaseId);
      await requestDownload({ releaseId: row.releaseId });
    }));
    if (row.actions.includes('remove')) actions.append(button('Remove', () => scheduleRemoval(row)));
    cell(tr, actions); return tr;
});

let downloadsActive = false, quickRender = null;
// 0.63.2: stale downloads dropped from the queue, with Download again (a new Watch) and Clear.
function renderPrevious(rows) {
  const list = $('#previous-list'); list.replaceChildren();
  $('#previous').hidden = !rows.length;
  for (const row of rows) {
    const li = document.createElement('li'); li.className = 'download status-previous';
    const name = document.createElement('strong'); name.textContent = row.name;
    li.append(`${row.label}: `, name, ' ');
    li.append(button('Download again', () => requestDownload({ releaseId: row.releaseId })));
    li.append(' ', button('Clear', () => viewerRequest('previous-clear', { releaseId: row.releaseId })));
    list.append(li);
  }
}
function renderDownloads(downloads) {
  const list = $('#download-list'); list.replaceChildren();
  $('#downloads').hidden = !downloads.length;
  for (const d of downloads) {
    const li = document.createElement('li'); li.className = `download status-${d.status.kind}`;
    const name = document.createElement('strong'); name.textContent = d.name;
    const label = document.createElement('span'); label.textContent = d.status.label ?? '';
    li.append(name, ' ', label);
    if (d.status.percent !== null && d.status.percent !== undefined) {
      const bar = document.createElement('progress'); bar.max = 100; bar.value = d.status.percent; bar.setAttribute('aria-label', `${d.name} download`); li.append(bar);
    } else if (d.status.kind === 'downloading') { const bar = document.createElement('progress'); bar.setAttribute('aria-label', `${d.name} in progress`); li.append(bar); }
    // E61: Pause / Resume / Retry / Cancel, through the service's download queue.
    for (const [act, label] of [['pause', 'Pause'], ['resume', 'Resume'], ['retry', 'Retry'], ['cancel', 'Cancel'], ['clear', 'Clear']])
      if (d.actions.includes(act)) li.append(button(label, async () => {
        const result = await viewerRequest('download-control', { action: act, releaseId: d.releaseId });
        if (result?.message) notice(result.message);
        await render();
      }));
    list.append(li);
  }
  const failed = downloads.filter(d => d.actions.includes('clear')).length, clearAll = $('#downloads-clear-all');
  clearAll.hidden = failed < 2;
  clearAll.onclick = () => void viewerRequest('download-control', { action: 'clear-all' }).then(r => { notice(r.message); return render(); }, e => notice(viewerFailureMessage(e)));
  // While something downloads, refresh every second so the percentage moves.
  downloadsActive = downloads.some(d => ['downloading', 'queued', 'stalled'].includes(d.status.kind));
  if (downloadsActive && !quickRender) quickRender = setTimeout(() => { quickRender = null; if (!document.hidden) void render(); }, 1000);
}

localTab = mountLocalTab({ document, store, viewerRequest, trustedKeys: protectedTrustConfig.descriptorKeys ?? [], extensionVersion: EXTENSION_VERSION,
  notice, noticeHandoff, cell, button, titleLink, showText, watchedText, createRenderer: (body, make) => createStableRowRenderer(body, make) });
void store.read().then(data => { applyLocalVisibility(localVisible(data.preferences)); if (location.hash.slice(1) === 'local') void localTab.opened(); }).catch(() => {});
$('[data-preference="showLocal"]')?.addEventListener('change', event => applyLocalVisibility(event.target.checked));
$('#storage-budget').onchange = () => void viewerRequest('preferences', { storageBudgetBytes: $('#storage-budget').value ? Number($('#storage-budget').value) : null }).then(render, e => notice(viewerFailureMessage(e)));
$('#check-updates').onclick = () => void (async () => {
  notice('Checking for updates…');
  // The explicit check is the retry for missing details, too.
  const listing = vault, ids = [...keptIds(listing)];
  for (const id of ids) metadataAttempted.add(id);
  const result = await viewerRequest('check-updates', { releaseIds: ids });
  await recordStatus(result.items, listing);
  updates = Object.fromEntries((result.items ?? []).map(item => [item.releaseId, item]));
  const count = Object.values(updates).filter(item => item.latestReleaseId && item.latestReleaseId !== item.releaseId).length;
  notice(count ? `${count} update${count === 1 ? '' : 's'} available.` : 'Every edit is up to date.');
  await render();
})().catch(e => notice(viewerFailureMessage(e)));

void render();
const timer = setInterval(() => { if (!document.hidden && document.querySelector('[data-tab="library"][aria-current="page"]')) void render(); }, 3000);
addEventListener('pagehide', () => clearInterval(timer), { once: true });
