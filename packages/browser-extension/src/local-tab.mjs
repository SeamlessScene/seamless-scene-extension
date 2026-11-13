// Settings → Local (0.63.0): local edits from .ss files. Add (picker or drop), the default
// folder with Refresh and its automatic check, the rows (shaped like the Library's) with
// Watch and Remove, and the local settings. Import logic lives in local-library.mjs.
import { importLocalEdit, removeLocalEdit, localRows, localSpaceSummary, localRoot, exportLocalEdit, cleanupLocalOrphans } from './local-library.mjs';
import { formatBytes } from './edits-model.mjs';
import { cleanupPackStaging } from './ss-normalize.mjs';
import { viewerFailureMessage } from './viewer-model.mjs';

/** The default folder's display line: its name, plus where we suggest keeping it. */
export function folderHint(platform = globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform ?? '') {
  return /win/i.test(platform) ? '(e.g. Documents\\Seamless Scene)' : '(e.g. ~/Documents/Seamless Scene)';
}
/** "Checked 2 min ago · 3 edits · 1 new". */
export function checkLine(check, now = Date.now()) {
  if (!Number.isFinite(check?.at)) return '';
  const minutes = Math.round((now - check.at) / 60_000);
  const when = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : new Date(check.at).toLocaleDateString();
  return [`Checked ${when}`, `${check.files} edit${check.files === 1 ? '' : 's'}`, check.added ? `${check.added} new` : null, check.skipped ? `${check.skipped} skipped` : null].filter(Boolean).join(' · ');
}
/** Lists the .ss files directly inside a folder (sub-folders are not read). */
export async function folderFiles(handle) {
  const out = [];
  for await (const [name, entry] of handle.entries()) if (entry.kind === 'file' && /\.(ss|zip)$/i.test(name)) out.push(await entry.getFile());
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** Imports a set of files one after another; returns the tallies and the skipped-file report. */
export async function importAll(files, importOne, { onFile = () => {}, signal = null } = {}) {
  const report = [], tally = { files: files.length, added: 0, unchanged: 0, skipped: 0 };
  for (const [index, file] of files.entries()) {
    // F4 (0.64.4): Cancel ends the run; nothing after it is read.
    if (signal?.aborted) { tally.cancelled = true; break; }
    onFile(file, index);
    let result;
    try { result = await importOne(file); } catch (error) { result = { status: 'refused', message: viewerFailureMessage(error) }; }
    if (signal?.aborted) { tally.cancelled = true; result = { status: 'refused', code: 'cancelled', message: 'Cancelled.' }; }
    if (['added', 'updated', 'conflict'].includes(result.status)) tally.added += 1;
    else if (result.status === 'already') tally.unchanged += 1;
    else { tally.skipped += 1; report.push({ name: file.name, message: result.message }); }
    result.file = file.name;
    report.lastResult = result;
  }
  return { tally, report };
}
/**
 * Saves a file: the save picker where the browser has one (it streams to disk), else a
 * download link (no extra permission is needed for either).
 */
export async function saveFile(file, name, { showSaveFilePicker = globalThis.showSaveFilePicker, document = globalThis.document, URL = globalThis.URL,
  types = [{ description: 'Seamless Scene edit', accept: { 'application/octet-stream': ['.ss'] } }] } = {}) {
  if (typeof showSaveFilePicker === 'function') {
    let handle;
    try { handle = await showSaveFilePicker({ suggestedName: name, types }); }
    catch (error) { if (error?.name === 'AbortError') throw Error('viewer-export-cancelled'); throw error; }
    const writable = await handle.createWritable();
    try { await file.stream().pipeTo(writable); } catch (error) { await writable.abort?.().catch(() => {}); throw error; }
    return;
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  const timer = setTimeout(() => URL.revokeObjectURL(url), 60_000);
  timer?.unref?.();
}
/** Whether the Local tab (and local choices in the player) are shown. */
export const localVisible = preferences => preferences?.showLocal !== false;

export function mountLocalTab({ document, store, viewerRequest, trustedKeys = [], extensionVersion, notice, noticeHandoff = notice, cell, button, titleLink, showText, watchedText,
  createRenderer, getRoot = () => localRoot(), validate = null, save = saveFile, importOptions = {}, showDirectoryPicker = globalThis.showDirectoryPicker, confirm = globalThis.confirm?.bind(globalThis), now = () => Date.now() }) {
  const $ = q => document.querySelector(q);
  let busy = false, report = [], running = null;
  // F4 (0.64.4): Cancel stops the import in progress (the current file and the rest).
  const cancelButton = $('#local-cancel');
  if (cancelButton) cancelButton.onclick = () => { running?.abort(Object.assign(Error('Cancelled'), { name: 'AbortError' })); };
  const progressBox = $('#local-progress'), progressText = $('#local-progress-text'), progressBar = $('#local-progress-bar');
  const showProgress = (file, { phase, done, total }) => {
    progressBox.hidden = false;
    const words = { reading: 'Reading', converting: 'Converting', checking: 'Checking clips', copying: 'Saving a copy', done: 'Done' }[phase] ?? 'Working';
    const counted = (phase === 'checking' || phase === 'converting') && total;
    progressText.textContent = `${file.name}: ${words}${counted ? ` ${phase === 'converting' ? 'clip ' : ''}${Math.min(done + (phase === 'converting' ? 1 : 0), total)} of ${total}` : ''}…`;
    if (counted) { progressBar.max = total; progressBar.value = done; } else progressBar.removeAttribute('value');
  };
  async function importOne(file) {
    const data = await store.read();
    const result = await importLocalEdit(file, {
      store, root: await getRoot(), preferences: data.preferences, trustedKeys, extensionVersion, validate,
      catalog: (data.library ?? []).filter(item => item.origin === 'website' && item.editSignature),
      confirmUnverified: async name => confirm ? confirm(`${name} is unsigned (not signed by Seamless Scene). Add it anyway?`) : false,
      // F3 (0.64.4): a newer revision from another file replaces the earlier one only when confirmed.
      confirmReplace: async (previous, next) => confirm ? confirm(`${next.fileName || 'This file'} has revision ${next.revision} of “${previous.name}” (you have revision ${previous.revision}, from ${previous.fileName || 'another file'}). Replace it?`) : false,
      signal: running?.signal, onProgress: p => showProgress(file, p), ...importOptions
    });
    return result;
  }
  // 0.64.0: a default-folder zip that was converted before (same name, size and date) is not converted again.
  // 0.64.4 (F2): nor is one that was refused: its refusal is remembered until the file changes.
  const packKey = file => `${file.name}|${file.size}|${file.lastModified}`;
  const packCache = async () => await Promise.resolve(store.localPackCache?.()).catch(() => ({})) ?? {};
  async function importCached(file) {
    if (!/\.zip$/i.test(file.name ?? '')) return importOne(file);
    const key = packKey(file), cache = await packCache(), cached = cache[key];
    if (cached?.refused) return { status: 'refused', code: cached.refused, cached: true, message: `${cached.message} (Unchanged since it was refused; not read again.)` };
    const known = typeof cached === 'string' && (await store.localEdits()).find(row => row.archiveId === cached);
    if (known) return { status: 'already', row: known, message: `“${known.name}” is already added.` };
    const result = await importOne(file);
    if (result.row?.archiveId && ['added', 'updated', 'conflict', 'already'].includes(result.status))
      await Promise.resolve(store.localPackCache?.({ ...cache, [key]: result.row.archiveId })).catch(() => {});
    // Only refusals of the file itself are remembered (not space, settings or a cancelled run).
    else if (result.status === 'refused' && /^(pack|ss)-/.test(result.code ?? '') && !running?.signal?.aborted)
      await Promise.resolve(store.localPackCache?.({ ...cache, [key]: { refused: String(result.code).slice(0, 60), message: String(result.message ?? 'It was not added.').slice(0, 300) } })).catch(() => {});
    return result;
  }
  // 0.64.4 (F2): zips in the default folder that have never been read (neither added nor refused).
  async function newPacks(files) {
    const cache = await packCache();
    return files.filter(file => /\.zip$/i.test(file.name ?? '') && cache[packKey(file)] === undefined);
  }
  async function run(files) {
    if (busy || !files.length) return;
    busy = true; running = new AbortController();
    if (cancelButton) cancelButton.hidden = false;
    try {
      const { tally, report: skipped } = await importAll(files, importOne, { signal: running.signal });
      report = skipped;
      notice(tally.cancelled ? `Cancelled. ${tally.added} added before that.` : files.length === 1 ? skipped.lastResult?.message ?? '' : `${tally.added} added · ${tally.unchanged} already here · ${tally.skipped} skipped.`);
    } finally { busy = false; running = null; if (cancelButton) cancelButton.hidden = true; progressBox.hidden = true; await render(); }
  }
  // Add: the picker filtered to .ss, or files dropped on the tab.
  const input = $('#local-file');
  $('#add-local').onclick = () => input.click();
  input.onchange = () => { const files = [...input.files]; input.value = ''; void run(files); };
  const panel = $('#local-panel'), drop = $('#local-drop');
  panel.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
  panel.addEventListener('dragleave', () => drop.classList.remove('over'));
  panel.addEventListener('drop', event => {
    event.preventDefault(); drop.classList.remove('over');
    const files = [...(event.dataTransfer?.files ?? [])].filter(f => /\.(ss|zip)$/i.test(f.name));
    if (!files.length) { notice('Only .ss and .zip edit files can be added here.'); return; }
    void run(files);
  });
  // The default folder: Chrome never shows its path, so its name plus a hint.
  async function refreshFolder({ automatic = false } = {}) {
    const handle = await store.folder('local').catch(() => null);
    if (!handle) return;
    let permission = 'prompt';
    try { permission = await handle.queryPermission({ mode: 'read' }); } catch {}
    $('#local-folder-allow').hidden = permission === 'granted';
    if (permission !== 'granted') { if (!automatic) notice('Allow access to the default folder first.'); return; }
    if (busy) return;
    let files;
    try { files = await folderFiles(handle); } catch { notice('The default folder could not be read. Choose it again.'); return; }
    // F2 (0.64.4): the automatic check asks before converting zips it has never read.
    let declined = 0;
    if (automatic) {
      const fresh = await newPacks(files);
      if (fresh.length && !(confirm && confirm(`${fresh.length} new edit pack${fresh.length === 1 ? '' : 's'} in your folder (${fresh.slice(0, 3).map(f => f.name).join(', ')}${fresh.length > 3 ? ', …' : ''}). Import ${fresh.length === 1 ? 'it' : 'them'}?`))) {
        files = files.filter(file => !fresh.includes(file)); declined = fresh.length;
      }
    }
    busy = true; running = new AbortController();
    if (cancelButton) cancelButton.hidden = false;
    try {
      const { tally, report: skipped } = await importAll(files, importCached, { signal: running.signal });
      report = skipped;
      await store.localFolderCheck({ at: now(), files: tally.files, added: tally.added, unchanged: tally.unchanged, skipped: tally.skipped });
      if (!automatic || tally.added || tally.skipped || declined) notice(tally.cancelled ? `Cancelled. ${tally.added} added before that.`
        : `Checked the default folder: ${tally.added} new · ${tally.unchanged} unchanged · ${tally.skipped} skipped${declined ? ` · ${declined} not imported (press Refresh to import ${declined === 1 ? 'it' : 'them'})` : ''}.`);
    } finally { busy = false; running = null; if (cancelButton) cancelButton.hidden = true; progressBox.hidden = true; await render(); }
  }
  $('#local-folder-change').onclick = () => void (async () => {
    if (!showDirectoryPicker) { notice('This browser cannot choose folders.'); return; }
    const handle = await showDirectoryPicker({ id: 'ss-local', mode: 'read', startIn: 'documents' });
    await store.folder('local', handle);
    await refreshFolder();
  })().catch(e => notice(e?.name === 'AbortError' ? 'No folder chosen.' : viewerFailureMessage(e)));
  $('#local-folder-refresh').onclick = () => void refreshFolder().catch(e => notice(viewerFailureMessage(e)));
  $('#local-folder-allow').onclick = () => void (async () => {
    const handle = await store.folder('local');
    if ((await handle?.requestPermission({ mode: 'read' })) === 'granted') await refreshFolder();
    else notice('Folder access was not allowed.');
  })().catch(e => notice(viewerFailureMessage(e)));

  const renderRows = createRenderer($('#local-edits tbody'), row => {
    const tr = document.createElement('tr');
    // 0.64.0: the description with the name (0.64.1: no poster).
    const what = document.createElement('div'); what.className = 'local-name';
    const words = document.createElement('div'); const title = document.createElement('span'); title.textContent = row.name; words.append(title);
    if (row.description) { const d = document.createElement('small'); d.className = 'description'; d.textContent = row.description; words.append(d); }
    what.append(words);
    cell(tr, what);
    cell(tr, row.streamingUrl ? titleLink(row) : showText(row) || null);
    cell(tr, row.bytes === null ? null : formatBytes(row.bytes));
    cell(tr, watchedText(row.lastWatchedAt));
    const status = cell(tr, row.status.label); status.className = `status-${row.status.kind}`;
    // R2: the publication settings this pack still lacks (it plays regardless).
    if (row.readiness) { const r = document.createElement('small'); r.className = 'readiness'; r.textContent = row.readiness; status.append?.(r); }
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('Watch', async () => {
      const result = await viewerRequest('local-watch', { archiveId: row.archiveId });
      // Cleared once the viewer is back on this page (handoffNotice in edits-model.mjs).
      noticeHandoff(result?.message ?? 'Opening the episode. The edit turns on when you press play.');
    }));
    // 0.63.1: Export saves this local edit's stored copy as a .ss file (local edits only).
    actions.append(button('Export', async () => {
      const result = await exportLocalEdit(row.archiveId, { store, root: await getRoot(), save, trustedKeys });
      notice(result.message);
    }));
    actions.append(button('Remove', async () => {
      // 0.63.3: an edit that is on in a Prime tab is stopped there first, then removed.
      const stopped = await viewerRequest('local-stop', { archiveId: row.archiveId }).catch(() => ({ stopped: 0 }));
      const result = await removeLocalEdit(row.archiveId, { store, root: await getRoot() });
      notice(result.deferred
        ? `Removed ${row.name}. Its copy is still in use by a Prime Video tab and is deleted when you next open this page.`
        : `Removed ${row.name}${stopped?.stopped ? ' (it was stopped in its Prime Video tab)' : ''}. The original file was not changed.`);
      await render();
    }));
    cell(tr, actions); return tr;
  });
  async function render() {
    const data = await store.read(), rows = await store.localEdits().catch(() => []);
    renderRows(localRows(rows, { library: data.library ?? [] }).map(row => ({ ...row, releaseId: row.archiveId })));
    $('#local-empty').hidden = rows.length > 0;
    $('#local-space').textContent = localSpaceSummary(rows, data.preferences.localBudgetBytes).label;
    const handle = await store.folder('local').catch(() => null);
    $('#local-folder-name').textContent = handle?.name ?? 'None chosen';
    $('#local-folder-hint').textContent = folderHint();
    $('#local-folder-change').textContent = handle ? 'Change' : 'Choose folder';
    $('#local-folder-refresh').hidden = !handle;
    $('#local-check').textContent = handle ? checkLine(await store.localFolderCheck().catch(() => null), now()) : '';
    const list = $('#local-report'); list.replaceChildren();
    for (const item of report) { const li = document.createElement('li'); li.textContent = `${item.name}: ${item.message}`; list.append(li); }
    list.hidden = report.length === 0;
  }
  return {
    render,
    /** The tab opened: check the default folder when that is on and access is still granted. */
    async opened() {
      await cleanupLocalOrphans({ store, root: await getRoot() }).catch(() => {});
      // Edit pack conversions left behind by a closed page (local/.staging/).
      if (!busy) await cleanupPackStaging(await getRoot()).catch(() => {});
      await render();
      const data = await store.read();
      if (data.preferences.localAutoCheck !== false) await refreshFolder({ automatic: true }).catch(() => {});
    },
    run, refreshFolder
  };
}
