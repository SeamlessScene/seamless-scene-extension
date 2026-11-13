import { viewerLoadMessage, downloadLimitMessage } from './viewer-load-error.mjs';

// One vocabulary for an edit's download and load, shown the same way in the
// player panel, the toolbar popup and the Edits page. In order:
//   queued      waiting for the player or another download
//   restoring   putting native playback back before a load (player only)
//   opening     opening the extension's local edit storage
//   requesting  checking the account link and fetching the signed edit details
//   downloading clips arriving from the server, with measured percentage
//   saving      writing the download into local storage
//   licensing   unlocking the edit for this installation (challenge and licence)
//   verifying   decrypting and checking every file's hash and signature (with a file count)
//   checking    checking each clip plays as signed (with a clip count; E60)
//   arming      loaded; turning the edit on (E61: no "Off · Watch with edit" flash)
//   ready       downloaded, unlocked and checked
//   paused      a download the viewer paused (E61); not active, resumes on request
//   failed      stopped; the failure code names the stage
export const LOAD_PHASES = Object.freeze(['queued', 'restoring', 'opening', 'requesting', 'downloading', 'saving', 'licensing', 'verifying', 'checking', 'arming', 'ready', 'paused', 'failed']);
export const ACTIVE_LOAD_PHASES = Object.freeze(LOAD_PHASES.filter(phase => !['ready', 'paused', 'failed'].includes(phase)));
export const isActiveLoadPhase = state => ACTIVE_LOAD_PHASES.includes(state);

const labels = Object.freeze({
  queued: 'Waiting to start…', restoring: 'Returning to the original video…', opening: 'Opening your edit storage…',
  requesting: 'Asking Seamless Scene for the edit…', saving: 'Saving the download…',
  licensing: 'Unlocking the edit…', verifying: 'Checking the edit…', checking: 'Checking clips…', arming: 'Turning the edit on…', ready: 'Ready'
});

const UNITS = ['B', 'KB', 'MB', 'GB'];
const unitOf = bytes => { let unit = 0; for (let v = bytes; v >= 1000 && unit < UNITS.length - 1; v /= 1000) unit += 1; return unit; };
const scaled = (bytes, unit) => { const value = bytes / 1000 ** unit; return unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1); };
/** "12.3 of 29.1 MB": both sizes in the larger one's unit. */
function formatPair(bytes, total) {
  const unit = unitOf(total);
  return `${scaled(bytes, unit)} of ${scaled(total, unit)} ${UNITS[unit]}`;
}

/** The percentage when both sizes are measured, else null. A missing total never becomes a number. */
export function downloadPercent(load) {
  if (counted(load)) return Math.floor(load.bytes / load.total * 100);
  const measured = Number.isSafeInteger(load?.bytes) && Number.isSafeInteger(load?.total) && load.total > 0 && load.bytes >= 0 && load.bytes <= load.total;
  return measured ? Math.floor(load.bytes / load.total * 100) : null;
}

/** One sentence for a load: its phase, or why it failed. Codes are never part of
 * the sentence; surfaces show them only under "Details for support". */
// E60: verifying and checking carry counts in bytes/total (files, clips), not bytes.
const COUNTED = Object.freeze({ verifying: ['Checking files', 'file'], checking: ['Checking clips', 'clip'] });
const counted = load => Object.hasOwn(COUNTED, load?.state) && Number.isSafeInteger(load.total) && load.total > 0 && Number.isSafeInteger(load.bytes) && load.bytes >= 0 && load.bytes <= load.total;
/** "about 12 s left" from the measured rate, when there is one. */
export function etaText(etaMs) {
  if (!Number.isFinite(etaMs) || etaMs < 0) return '';
  const s = Math.max(1, Math.round(etaMs / 1000));
  return s < 60 ? `about ${s} s left` : `about ${Math.round(s / 60)} min left`;
}
/** After this long without progress a load is shown as stalled ("Still checking clip 37…"). */
export const LOAD_STALL_MS = 10_000;
export function loadStalled(load, now = Date.now()) {
  return Boolean(load && ACTIVE_LOAD_PHASES.includes(load.state) && load.state !== 'queued' && Number.isFinite(load.updatedAt) && now - load.updatedAt >= LOAD_STALL_MS);
}
/** "Still checking clip 37…", naming the step that stopped moving. */
export function stalledMessage(load) {
  if (counted(load)) return `Still ${COUNTED[load.state][0].toLowerCase()} · ${COUNTED[load.state][1]} ${Math.min(load.total, load.bytes + 1)} of ${load.total}…`;
  const label = labels[load?.state] ?? 'Working…';
  return `Still ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** "85 KB/s", the measured download rate (E61). */
export function rateText(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  const unit = unitOf(bytesPerSecond);
  return `${scaled(bytesPerSecond, unit)} ${UNITS[unit]}/s`;
}
/** E61: the queue position, "Waiting for Lighthouse S1E2 to finish (1 ahead)". */
export function queuedMessage(load) {
  const ahead = Number.isSafeInteger(load?.ahead) && load.ahead > 0 ? load.ahead : 0;
  const other = typeof load?.waitingFor === 'string' && load.waitingFor.trim() ? load.waitingFor.trim().slice(0, 120) : '';
  if (other) return `Waiting for ${other} to finish (${ahead || 1} ahead)`;
  return ahead ? `Waiting for another download to finish (${ahead} ahead)` : labels.queued;
}
/** E61: a download that stopped moving, with the automatic retry when one is planned. */
export function downloadStalledMessage(load, now = Date.now()) {
  const at = Number.isFinite(load?.retryAt) ? Math.max(0, Math.ceil((load.retryAt - now) / 1000)) : null;
  return at === null ? 'Download stalled' : at > 0 ? `Download stalled · retrying in ${at} s` : 'Download stalled · retrying…';
}

/**
 * Settings mirrors a player's load in its notice ("Checking clips 6 of 8 · about 1 s left").
 * `mirrored` is the in-progress text it last put there (null: none), `load` the player's load now,
 * `wrote` the text this refresh has just put in the notice (null: nothing), `shown` the notice's
 * text. A load that is no longer busy (finished, forgotten, its tab closed) and leaves no final
 * text takes its progress text with it: that line used to stay above the Library until the page
 * was reloaded. Returns the text to show (undefined: leave the notice alone) and what to remember.
 */
export function mirroredLoadNotice(mirrored, load, wrote = null, shown = '') {
  const busy = load?.busy === true;
  if (typeof wrote === 'string' && wrote) return { mirrored: busy ? wrote : null };
  if (mirrored == null || busy) return { mirrored: mirrored ?? null };
  return shown === mirrored ? { text: '', mirrored: null } : { mirrored: null };
}

export function loadStatusMessage(load) {
  if (!load) return null;
  // E91: the download limit says when the edit can be downloaded again (limitUntil, from the server's wait).
  if (load.state === 'failed' && load.error === 'viewer-download-limit') return downloadLimitMessage(load.limitUntil);
  if (load.state === 'failed') return viewerLoadMessage(load.error) ?? 'Loading failed. Try again, or copy the details for support.';
  if (load.stalled === true && ACTIVE_LOAD_PHASES.includes(load.state)) return downloadStalledMessage(load);
  if (load.state === 'queued') return queuedMessage(load);
  if (load.state === 'paused') return downloadPercent(load) === null || !load.total ? 'Paused' : `Paused · ${downloadPercent(load)}% · ${formatPair(load.bytes, load.total)}`;
  if (counted(load)) {
    const eta = load.bytes < load.total ? etaText(load.etaMs) : '';
    return `${COUNTED[load.state][0]} ${load.bytes} of ${load.total}${eta ? ` · ${eta}` : ''}`;
  }
  if (load.state === 'downloading') {
    const percent = downloadPercent(load);
    const rate = rateText(load.bytesPerSecond), retry = Number.isSafeInteger(load.transferRetries) && load.transferRetries > 0 ? ` · reconnected ${load.transferRetries}×` : '';
    return percent === null ? 'Downloading…' : `Downloading · ${percent}% · ${formatPair(load.bytes, load.total)}${rate ? ` · ${rate}` : ''}${retry}`;
  }
  return labels[load.state] ?? null;
}

/** The short form for small spaces: "Downloading · 42%", or the phase. */
export function loadStatusShort(load) {
  if (load?.stalled === true && ACTIVE_LOAD_PHASES.includes(load.state)) return 'Download stalled';
  if (load?.state === 'queued') return Number.isSafeInteger(load.ahead) && load.ahead > 0 ? `Waiting (${load.ahead} ahead)` : labels.queued;
  if (load?.state === 'downloading') { const percent = downloadPercent(load); return percent === null ? 'Downloading…' : `Downloading · ${percent}%`; }
  if (counted(load)) return `${COUNTED[load.state][0]} ${load.bytes} of ${load.total}`;
  return loadStatusMessage(load);
}

/** Step n of the visible sequence, for a compact progress indicator. */
export function loadStep(load) {
  const order = ['requesting', 'downloading', 'saving', 'licensing', 'verifying', 'checking', 'ready'];
  const index = order.indexOf(load?.state);
  return index < 0 ? null : { step: index + 1, of: order.length };
}
