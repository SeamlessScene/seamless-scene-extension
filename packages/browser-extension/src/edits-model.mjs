// What the Edits page shows, derived from what the extension already keeps: the
// viewer library (website metadata), the protected vault listing (sizes, problems),
// download jobs, and the last check for updates. Pure functions, no I/O.
import { sourceKey } from './viewer-model.mjs';
import { loadStatusMessage, isActiveLoadPhase, downloadPercent, loadStep } from './viewer-load-status.mjs';

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const describe = (library, releaseId, job = null) => {
  const item = library.find(entry => entry.id === releaseId && entry.origin === 'website') ?? {};
  // E61: before its library row exists a download is named from the website's release
  // details (the job's name, title and episode). Only with nothing known (the website could not be asked yet) is it an "Edit from the website".
  const where = [job?.titleName, job?.episodeName && job.episodeName !== job?.titleName ? job.episodeName : null].filter(Boolean).join(' · ');
  return { item: { ...(job?.titleName ? { titleName: job.titleName } : {}), ...(job?.episodeName ? { episodeName: job.episodeName } : {}), ...item },
    name: item.name ?? job?.name ?? item.title ?? (where || 'Edit from the website') };
};
/** E61: the controls a download offers in its current state. */
export function downloadActions(job) {
  if (job?.state === 'paused') return ['resume', 'cancel'];
  // 0.63.2: a failed row can be cleared (and its Watch with it) instead of staying.
  if (job?.state === 'failed') return ['retry', 'clear'];
  if (job?.stalled === true && job.state === 'queued') return ['retry', 'cancel'];
  if (['queued', 'opening', 'requesting', 'downloading'].includes(job?.state)) return ['pause', 'cancel'];
  return isActiveLoadPhase(job?.state) ? ['cancel'] : [];
}

/**
 * The library: one row per website edit actually downloaded to this device.
 * The vault is the truth; while a player tab holds it (vault null), edits the
 * library recorded as downloaded are listed with an unknown status. Edits that
 * were chosen but not downloaded are not listed (the website catalog shows
 * everything); downloads still running or failed are in downloadRows().
 */
export function downloadedRows({ library = [], vault = null, jobs = [], updates = {} }) {
  const kept = vault === null ? null : new Map(vault.map(entry => [entry.releaseId, entry]));
  const job = new Map(jobs.map(entry => [entry.releaseId, entry]));
  const ids = kept ? [...kept.keys()] : library.filter(item => item.origin === 'website' && item.transport === 'protected' && item.downloadedAt).map(item => item.id);
  return ids.map(releaseId => {
    const { item, name } = describe(library, releaseId, job.get(releaseId));
    const entry = kept?.get(releaseId), running = job.get(releaseId), update = updates[releaseId];
    let status;
    if (isActiveLoadPhase(running?.state)) status = { kind: 'downloading', label: loadStatusMessage(running), percent: downloadPercent(running) };
    else if (entry?.problem) status = { kind: 'corrupt', label: 'Damaged · repair downloads it again' };
    else if (update?.availability && update.availability !== 'available') status = { kind: 'unavailable', label: 'No longer available on Seamless Scene' };
    else if (update?.latestReleaseId && update.latestReleaseId !== releaseId) status = { kind: 'update', label: `Update to v${update.latestVersion}` };
    else if (entry) status = { kind: 'ready', label: 'Ready' };
    else status = { kind: 'unknown', label: 'In use by a Prime Video tab' };
    return {
      releaseId, editId: item.editId ?? null, name,
      creator: item.creatorName ?? null, version: (Number.isSafeInteger(item.displayVersion) && item.displayVersion >= 1 ? String(item.displayVersion) : item.version) || null, titleName: item.titleName ?? null, episodeName: item.episodeName ?? null,
      streamingUrl: item.streamingUrl ?? null, bytes: entry?.bytes ?? item.bytes ?? null,
      lastWatchedAt: item.lastWatchedAt ?? null, status,
      actions: [
        ...(status.kind === 'update' ? ['update'] : []), ...(status.kind === 'corrupt' ? ['repair'] : []),
        ...(status.kind !== 'unavailable' && item.streamingUrl ? ['watch'] : []), ...(entry ? ['remove'] : [])
      ]
    };
  }).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
}

/** Downloads not yet in the library: running (with their phase) or failed (with the reason and code). */
export function downloadRows({ library = [], vault = null, jobs = [] }) {
  const kept = new Set((vault ?? []).map(entry => entry.releaseId));
  return jobs.filter(job => !kept.has(job.releaseId) && (isActiveLoadPhase(job.state) || job.state === 'paused' || job.state === 'failed')).map(job => {
    const { item, name } = describe(library, job.releaseId, job);
    const failed = job.state === 'failed', paused = job.state === 'paused';
    return { releaseId: job.releaseId, name, titleName: item.titleName ?? null, episodeName: item.episodeName ?? null, streamingUrl: item.streamingUrl ?? null,
      status: { kind: failed ? 'failed' : paused ? 'paused' : job.stalled === true ? 'stalled' : job.state === 'queued' ? 'queued' : 'downloading',
        label: loadStatusMessage(job), percent: failed ? null : downloadPercent(job), step: loadStep(job) },
      actions: downloadActions(job) };
  });
}

/** 0.63.2: "Previously queued: <name>" rows for downloads dropped as stale (Download again, Clear). */
export function previousRows(previous = []) {
  // E89: an empty name falls back like a missing one (never a bare row).
  const part = value => typeof value === 'string' ? value.trim() : '';
  return previous.map(p => ({ releaseId: p.releaseId, name: part(p.name) || [part(p.titleName), part(p.episodeName)].filter(Boolean).join(' · ') || 'An edit',
    label: 'Previously queued', actions: ['again', 'clear'] }));
}

/** Kept bytes against the viewer's budget, for the storage bar. */
export function storageSummary({ vault = [], budgetBytes, estimate }) {
  const used = vault.reduce((n, entry) => n + (entry.bytes ?? 0), 0);
  const free = Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage) ? estimate.quota - estimate.usage : null;
  return { used, budgetBytes, free, label: `Using ${formatBytes(used)} of ${formatBytes(budgetBytes)}${free === null ? '' : ` · ${formatBytes(free)} free for the browser`}` };
}


/**
 * The Library's one-line notice while it follows the download or load it asked for.
 * `following` is { releaseId, progress } (progress: the in-progress text this put in the notice,
 * or null); `jobs` is the service's list, or null when it could not be read; `shown` is the
 * notice's text now. Returns the text to show (undefined: leave the notice alone) and what to
 * follow next. A job that is no longer listed (finished and forgotten, removed, expired) takes
 * its last progress text with it: "Checking clips 73 of 75 · about 1 s left" used to stay until
 * the page was reloaded.
 */
/**
 * A Watch hand-off line ("Opening the title. The edit turns on when you press play.") is only
 * true until the viewer has gone to the title. `handoff` is { text, hidden, blurred } (what Watch
 * put in the notice, and whether the page has been hidden or without focus since), or null;
 * `page` is { hidden, focused } now; `shown` is the notice's text. Once the viewer is back (the
 * page shown again after being hidden, or focused again after losing focus) the line is cleared,
 * unless another message has replaced it. Returns the text to show (undefined: leave the notice
 * alone) and the hand-off to keep.
 */
export function handoffNotice(handoff, page, shown = '') {
  if (!handoff?.text) return { handoff: null };
  if (shown !== handoff.text) return { handoff: null };
  const hidden = page?.hidden === true, focused = page?.focused === true;
  const back = !hidden && (handoff.hidden === true || (focused && handoff.blurred === true));
  if (back) return { text: '', handoff: null };
  return { handoff: { text: handoff.text, hidden: handoff.hidden === true || hidden, blurred: handoff.blurred === true || !focused } };
}

export function followedNotice(following, jobs, shown = '') {
  if (!following?.releaseId || !Array.isArray(jobs)) return { following: following ?? null };
  const job = jobs.find(entry => entry.releaseId === following.releaseId);
  if (job) {
    const text = loadStatusMessage(job), active = isActiveLoadPhase(job.state);
    return { text, following: active ? { releaseId: following.releaseId, progress: text } : null };
  }
  if (following.progress == null) return { following };
  return shown === following.progress ? { text: '', following: null } : { following: null };
}
