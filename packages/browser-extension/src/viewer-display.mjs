// What the player menu and the toolbar popup say, from structured playback fields
// only. Pure functions: no DOM, no I/O. One vocabulary for every viewer surface:
// "Watch with edit" / "Stop edit", On / Off, scenes typed Replaced, Added, Cut or
// Muted, and viewer times as 32:12 or 1:02:14.
import { viewerFailureMessage, viewerFailureCode, LEAD_IN_CHOICES } from './viewer-model.mjs';
import { jumpTargetMs } from './jump-target.mjs';
import { loadStatusMessage, loadStatusShort, downloadPercent, isActiveLoadPhase, loadStalled, stalledMessage } from './viewer-load-status.mjs';
import { loadedEditLabel, shownVersion } from './loaded-edit-display.mjs';

export const TYPE_WORDS = Object.freeze({ REPLACE: 'Replaced', INSERT: 'Added', SKIP: 'Cut', MUTE: 'Muted' });
const ON_STATES = ['armed', 'active', 'paused', 'restoring'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Viewer time: 32:12, or 1:02:14 past an hour. */
export function viewerTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
/** A countdown: 1:07, or 45 s. */
function countdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : viewerTime(s * 1000);
}
/** A length or time left: "42s" under a minute, else "1m 12s" (E59 player menu). */
export function shortDuration(ms, { roundUp = false } = {}) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = roundUp ? Math.ceil(ms / 1000 - 1e-9) : Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
// What the viewer watches for a scene: the clip for Replaced and Added, the muted
// stretch for Muted; a Cut has no length to show.
function watchedMs(scene) {
  if (scene.type === 'REPLACE' || scene.type === 'INSERT') return Number.isFinite(scene.lengthMs) ? scene.lengthMs : null;
  if (scene.type === 'MUTE') return scene.resumeMs - scene.startMs;
  return null;
}
// Time left in the scene that is playing, before the original comes back.
function timeLeftMs(playing, s) {
  if (!playing) return null;
  if (playing.type === 'MUTE') return Number.isFinite(s.currentTimeMs) ? Math.max(0, playing.resumeMs - s.currentTimeMs) : null;
  const length = watchedMs(playing);
  return Number.isFinite(length) && Number.isFinite(s.sceneTimeMs) ? Math.max(0, length - s.sceneTimeMs) : null;
}
export const leadInMs = prefs => LEAD_IN_CHOICES.includes(prefs?.leadInMs) ? prefs.leadInMs : 5000;

/** A Prime page title as a fallback show name: "Watch X | Prime Video" → "X". */
export function cleanPageTitle(title) {
  if (typeof title !== 'string') return '';
  return title.trim().replace(/\s*[|\-–]\s*(Prime Video|Amazon\.com|Netflix)\s*$/i, '').replace(/^Watch\s+/i, '').trim().slice(0, 200);
}
/**
 * 0.64.0 (E70): the live player's episode as an edit pack "episode" block (edit.json), from the
 * key Prime reports (title ID, runtime, season, episode) and the show title: no typing a GTI.
 */
export function episodeDetails(playback) {
  let parts; try { parts = JSON.parse(playback?.sourceKey ?? ''); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 9 || typeof parts[0] !== 'string' || typeof parts[1] !== 'string' || !parts[1] || !Number.isFinite(parts[5])) return null;
  const [service, gti, mediaType, season, episode, runtimeMs] = parts;
  const show = (typeof playback?.show?.title === 'string' && playback.show.title.trim() ? playback.show.title.trim() : cleanPageTitle(playback?.title ?? ''))
    .replace(/\s*[-–:]\s*Season\s+\d+\s*$/i, '');
  return { service, gti, show, ...(mediaType === 'episode' && Number.isSafeInteger(season) && Number.isSafeInteger(episode) ? { season, episode } : {}), runtime_ms: Math.round(runtimeMs) };
}
/** The text Copy episode details puts on the clipboard, ready to paste into edit.json. */
export const episodeDetailsText = block => `"episode": ${JSON.stringify(block).replace(/,"/g, ', "').replace(/":/g, '": ')}`;

/** "Orbit Station · S1 E4": series title and episode, from the edit's source or Prime's identity. */
export function showLine(show, fallbackTitle = '') {
  const episode = Number.isSafeInteger(show?.season) && Number.isSafeInteger(show?.episode) ? `S${show.season} E${show.episode}` : '';
  let title = typeof show?.title === 'string' && show.title.trim() ? show.title.trim() : cleanPageTitle(fallbackTitle);
  // A page title often repeats the season ("Orbit Station - Season 1").
  if (episode) title = title.replace(/\s*[-–:]\s*Season\s+\d+\s*$/i, '');
  return [title, episode].filter(Boolean).join(' · ');
}

/** The loaded edit's scenes with their number, type word, jump target and viewer status. */
export function sceneList(playback, prefs) {
  const lead = leadInMs(prefs), scenes = Array.isArray(playback?.scenes) ? playback.scenes : [];
  const playingIndex = scenes.findIndex(s => s.status === 'playing');
  const nextIndex = scenes.findIndex(s => s.status === 'pending');
  return scenes.map((s, index) => {
    const targetMs = jumpTargetMs(scenes, index, lead);
    const length = watchedMs(s);
    return { ...s, index, number: index + 1, typeWord: TYPE_WORDS[s.type] ?? 'Changed', targetMs,
      // Rows show number, start and length only (0.62.10); a Cut has no length, so "(cut)".
      time: viewerTime(s.startMs), duration: s.type === 'SKIP' ? 'cut' : Number.isFinite(length) ? shortDuration(length) : '', title: s.startMs - targetMs >= lead
        ? `Jumps to ${viewerTime(targetMs)} (${lead / 1000} s before)` : `Jumps to ${viewerTime(targetMs)}, right after the scene before`,
      mark: index === playingIndex ? 'playing' : s.status === 'played' ? 'played' : index === nextIndex ? 'next' : '' };
  });
}

export function sceneJump(scenes, { currentMs, leadInMs: lead = 5000 } = {}, which) {
  const all = scenes ?? [];
  const list = all.map((s, index) => ({ index, startMs: s.startMs, playing: s.status === 'playing', played: s.status === 'played', targetMs: jumpTargetMs(all, index, lead) }));
  if (Number.isSafeInteger(which)) { const s = list[which]; return s ? { index: s.index, targetMs: s.targetMs } : null; }
  if (!Number.isFinite(currentMs)) return null;
  if (which === 'next') {
    // Repeated Next steps through the scenes: from a scene's jump point (its lead-in) Next goes
    // on to the following scene. 0.63.4 checked: one Next after Riley scene 5 lands on
    // scene 6's lead-in; reaching scene 7 takes a second Next or a tap on row 7.
    const s = list.find(x => !x.playing && x.startMs > currentMs && x.targetMs > currentMs + 1000);
    return s ? { index: s.index, targetMs: s.targetMs } : null;
  }
  if (which === 'previous') {
    // A scene that has just finished counts as the previous one even within its first 2 s back,
    // so Previous replays the scene you just watched instead of skipping back two.
    const s = list.filter(x => !x.playing && x.startMs < currentMs && (x.targetMs < currentMs - 2000 || x.played)).at(-1);
    return s ? { index: s.index, targetMs: s.targetMs } : null;
  }
  return null;
}

/** Fix actions a problem offers: one button. */
const FIXES = Object.freeze({
  watch: { act: 'watch', label: 'Watch with edit' },
  reload: { act: 'reload', label: 'Refresh this tab' },
  link: { act: 'link', label: 'Connect your account' },
  library: { act: 'library', label: 'Open Settings → Library' },
  local: { act: 'local', label: 'Open Settings → Local' },
  retry: { act: 'watch', label: 'Try again' },
  find: { act: 'find', label: 'Find an edit' }
});
const FIX_FOR = {
  'viewer-renderer-lost': 'reload', 'viewer-extension-updated': 'reload', 'viewer-request-denied': 'reload', 'viewer-renderer-unavailable': 'reload',
  'viewer-load-unavailable': 'reload', 'viewer-player-not-active': 'reload', 'viewer-extension-no-reply': 'reload', 'viewer-method-denied': 'reload',
  'viewer-import-restoration-failed': 'reload', 'viewer-import-cleanup-failed': 'reload', 'viewer-packet-delivery-failed': 'reload',
  'viewer-account-link-required': 'link', 'viewer-account-link-removed': 'link', 'viewer-link-check-failed': 'link', 'viewer-account-changed': 'link',
  'viewer-budget-exceeded': 'library', 'viewer-reimport-required': 'library', 'viewer-local-missing': 'local', 'viewer-local-invalid': 'local',
  'viewer-packet-import-failed': 'library', 'viewer-release-unavailable': 'find', 'viewer-release-invalid': 'find', 'viewer-edit-not-matched': 'find',
  'viewer-access-refused': 'find', 'viewer-download-limit': 'library', 'viewer-episode-mismatch': 'find', 'viewer-title-id-changed': 'find', 'viewer-runtime-mismatch': 'find', 'viewer-source-check-failed': 'reload'
};
// The toolbar popup's one-line form, where the full sentence is too long.
const SHORT = Object.freeze({
  'viewer-episode-changed': 'The episode changed, so the edit stopped.',
  'viewer-ads-detected': 'Ads came on, so the edit stopped.',
  'viewer-player-changed': 'The player restarted, so the edit stopped.'
});
/** A problem worth the Problem state: its sentence, short form, one fix and support code. */
export function problemFor(code) {
  if (!code) return null;
  const known = viewerFailureCode(code), sentence = viewerFailureMessage(code);
  const fix = FIXES[FIX_FOR[known] ?? 'watch'];
  return { code: known, sentence, short: SHORT[known] ?? sentence.split(/(?<=\.)\s/)[0], fix };
}

/** Support details: code, version and time only. */
export function supportDetails(code, version, at = new Date()) {
  const stamp = at.toISOString().slice(0, 16).replace('T', ' ');
  return `${code || 'unknown'} · ${version || 'unknown'} · ${stamp} UTC`;
}

const nameOf = (playback, fallback = 'Your edit') => {
  const name = typeof playback?.editName === 'string' && playback.editName.trim() ? playback.editName.trim() : '';
  return name || fallback;
};
const previewName = playback => typeof playback?.previewName === 'string' && playback.previewName.trim() ? playback.previewName.trim() : 'Scene';
const versionOf = v => typeof v === 'string' && /^\d{1,10}$/.test(v) ? `v${v}` : '';
const matchName = m => (typeof m?.name === 'string' && m.name.trim() ? m.name.trim() : String(m?.title ?? 'Your edit').replace(/ · v\d+$| · your edit$| · check compatibility$/, ''));
/** A chooser row: name, version, and what is known about it (scenes, size). */
export function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB']; let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
export function chooserItems(matches = [], formatBytes = sizeText) {
  return matches.map(m => ({ id: m.id, name: matchName(m), version: versionOf(shownVersion(m)),
    detail: [Number.isSafeInteger(m.scenes) ? plural(m.scenes, 'scene', 'scenes') : '', formatBytes && Number.isFinite(m.bytes) ? formatBytes(m.bytes) : '',
      m.local ? 'local file' : '', / · check compatibility$/.test(m.title ?? '') ? 'checked when you watch' : ''].filter(Boolean).join(' · ') }));
}

/** E89 (0.66.1): text parts joined by " · ", empty ones dropped (a row never shows a bare " · "). */
export const joinParts = (...parts) => parts.map(part => typeof part === 'string' ? part.trim() : '').filter(Boolean).join(' · ');
/** E96 (0.66.1): the popup's account line, "Linked as <name>", from the same stored display name
 * Settings → Account & sites shows; empty when this browser is not linked. */
export function popupAccountLine(account) {
  const name = account?.state === 'saved' && typeof account.displayName === 'string' ? account.displayName.trim().slice(0, 80) : '';
  return name ? `Connected as ${name}` : '';
}
/** E61: a download's name: the edit's, else its title and episode ("Lighthouse · Episode 2"). */
export function downloadName(load) {
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 120) : '';
  const name = clean(load?.name), title = clean(load?.titleName), episode = clean(load?.episodeName);
  const where = [title, episode && episode !== title ? episode : ''].filter(Boolean).join(' · ');
  return name || where;
}

/**
 * The state both viewer surfaces show. `problem` is the code of what went wrong last
 * (a stopped edit, a failed load or a failed command) while no edit is on.
 */
// A failed load stays a Problem for two minutes; after that the normal state returns.
export const PROBLEM_LIFETIME_MS = 120_000;
// `problemReleaseId` is the edit a failed command asked for, so the Problem view's
// "Try again" repeats that same request instead of asking for any edit (E50).
export function viewerView({ playback, matches = [], load = null, prefs = {}, problem = null, problemReleaseId = null, now = Date.now() } = {}) {
  const s = playback ?? { state: 'unavailable' };
  const scenes = sceneList(s, prefs), total = scenes.length;
  const played = scenes.filter(x => x.status === 'played').length;
  const playing = scenes.find(x => x.mark === 'playing'), next = scenes.find(x => x.mark === 'next');
  const on = ON_STATES.includes(s.state), lead = leadInMs(prefs);
  // A creator's clip preview (E57 C4) is named after its scene, has no version and is never
  // offered as an edit to find, change or watch again.
  const preview = s.preview === true;
  const version = preview ? '' : versionOf(shownVersion(s)), loadedName = preview ? `Preview · ${previewName(s)}` : loadedEditLabel(s) ? nameOf(s) : '';
  const base = { state: s.state, show: showLine(s.show, s.title), name: '', version: '', scenes: [], progress: null, download: null,
    canPrevious: false, canNext: false, previousTitle: '', nextTitle: '', problem: null, leadInMs: lead, paused: s.paused === true, ...(preview ? { preview: true } : {}) };
  const withEdit = { name: loadedName || nameOf(s), version };
  const nav = () => {
    const current = { currentMs: s.currentTimeMs, leadInMs: lead };
    const previous = sceneJump(s.scenes, current, 'previous'), following = sceneJump(s.scenes, current, 'next');
    return { scenes, canPrevious: Boolean(previous), canNext: Boolean(following),
      previousTitle: previous ? scenes[previous.index].title : '', nextTitle: following ? scenes[following.index].title : '' };
  };
  if (s.state === 'unavailable') return { ...base, kind: 'unavailable', chip: { text: 'Off', tone: 'off' }, badge: 'off',
    status: { strong: '', rest: 'Press play on the title to continue.' }, popupSub: 'Press play on the title to continue.' };
  if (load?.busy === true && !on) {
    // E60: 10 s without progress: "Still checking clip 37…" with Check again / Report.
    // E61: a download the service saw stall (20 s) says so, with its automatic retry.
    const downloadStall = load.stalled === true, stalled = downloadStall || loadStalled(load, now);
    const percent = downloadPercent(load), label = downloadStall ? loadStatusMessage(load) : stalled ? stalledMessage(load) : loadStatusMessage(load) ?? 'Getting the edit ready…';
    const loadName = downloadName(load) || loadedName || (load.download ? 'Edit from the website' : 'New edit');
    // E61: Pause / Resume / Cancel for a download in the queue (not for a load of a kept edit).
    const controls = load.download === true && typeof load.releaseId === 'string'
      ? load.state === 'paused' ? ['resume', 'cancel'] : downloadStall ? ['retry', 'cancel'] : ['queued', 'opening', 'requesting', 'downloading'].includes(load.state) ? ['pause', 'cancel'] : ['cancel']
      : [];
    return { ...base, kind: 'downloading', chip: { text: load.state === 'paused' ? 'Paused' : 'Getting ready', tone: 'ready' }, badge: 'off', name: loadName, version: versionOf(shownVersion(load)) || (loadedName ? version : ''),
      download: { percent, label, ...(controls.length ? { controls } : {}), ...(stalled ? { stalled: true, step: load.state, done: load.bytes, total: load.total } : {}) }, status: { strong: '', rest: '' },
      ...((stalled || controls.length) && typeof load.releaseId === 'string' ? { releaseId: load.releaseId } : {}),
      note: load.state === 'paused' ? 'Resume continues the download.' : downloadStall ? 'It retries by itself; Report copies the details for support.'
        : stalled ? 'Check again re-checks every clip; Report copies the details for support.' : load.state === 'arming' ? 'Turning the edit on…'
        // An edit already on this device (a local file, a kept download) is only opened and checked.
        : load.download === true || ['queued', 'requesting', 'downloading', 'saving'].includes(load.state) ? 'It turns on by itself when the download finishes.' : 'It turns on by itself when it is ready.',
      popupSub: stalled ? label : loadStatusShort(load) ?? label };
  }
  const failedLoad = load?.state === 'failed' && !on && !(Number.isFinite(load.failedAt) && now - load.failedAt > PROBLEM_LIFETIME_MS) ? load.error ?? 'unknown' : null;
  // E110: the service moving on to another episode stops the edit, which is expected, not a fault:
  // the new episode shows its normal state (a matching download, or none).
  const notice = s.notice === 'viewer-episode-changed' ? null : s.notice;
  const trouble = !on && s.state !== 'finished' ? (problem || failedLoad || notice || null) : null;
  if (trouble) {
    let p = problemFor(trouble);
    // E91: a download refused by the per-edit limit says when it can be downloaded again, also in the popup's short line.
    if (!problem && failedLoad === 'viewer-download-limit') { const sentence = loadStatusMessage(load); p = { ...p, sentence, short: sentence }; }
    const retry = problem ? problemReleaseId : failedLoad ? load.releaseId : null;
    const releaseId = p.fix.act === 'watch' && typeof retry === 'string' && /^[a-f0-9-]{36}$/.test(retry) ? retry : null;
    // 0.63.2: a failed download for this episode can be cleared from the player menu.
    const clearRelease = !problem && failedLoad && load?.download === true && typeof load.releaseId === 'string' ? load.releaseId : null;
    return { ...base, ...(loadedName || s.editId ? withEdit : {}), kind: 'problem', chip: { text: 'Problem', tone: 'bad' }, badge: 'bad', problem: p,
      ...(releaseId ? { releaseId } : {}), ...(clearRelease ? { clearRelease } : {}), status: { strong: '', rest: p.sentence }, popupSub: p.short };
  }
  if (s.state === 'finished' && preview) return { ...base, ...withEdit, kind: 'finished', chip: { text: 'Finished', tone: 'off' }, badge: 'off',
    progress: null, status: { strong: 'Preview finished.', rest: '' }, popupSub: 'Preview finished.' };
  // 0.65.2: count only scenes that actually played. Starting part-way through, the
  // scenes before the start were skipped, so the edit finishes with fewer than all played.
  if (s.state === 'finished') {
    const finishedText = played >= total ? `Finished ${total} of ${total}` : `Finished · ${played} of ${total} played`;
    return { ...base, ...withEdit, kind: 'finished', chip: { text: 'Finished', tone: 'off' }, badge: 'off',
      progress: total ? { played, total } : null, status: { strong: finishedText, rest: '' }, popupSub: finishedText };
  }
  if (on) {
    const view = { ...base, ...withEdit, ...nav(), chip: { text: 'On', tone: s.state === 'active' ? 'on' : 'ready' }, badge: s.state === 'active' ? 'on' : 'ready',
      progress: total ? { played, total } : null };
    if (preview) {
      const view1 = { ...view, progress: null, canPrevious: false, canNext: false };
      if (s.state === 'active' && playing) return { ...view1, kind: 'playing', status: { strong: 'Playing your clip', rest: ` · back to the original at ${viewerTime(playing.resumeMs)}` }, popupSub: 'Playing your clip' };
      const inText = next && Number.isFinite(s.currentTimeMs) && next.startMs > s.currentTimeMs ? ` · in ${countdown(next.startMs - s.currentTimeMs)}` : '';
      return { ...view1, kind: 'waiting', status: next ? { strong: `Your clip starts at ${next.time}`, rest: inText } : { strong: 'The preview scene is behind you.', rest: '' },
        popupSub: next ? `Your clip starts at ${next.time}` : 'The preview scene is behind you.' };
    }
    // One short line each (E59): "Playing 49 of 80 (42s)", "Next: 50 of 80 in 1m 12s".
    if (s.state === 'active' && playing) {
      const left = timeLeftMs(playing, s), line = `Playing ${playing.number} of ${total}${Number.isFinite(left) ? ` (${shortDuration(left, { roundUp: true })})` : ''}`;
      return { ...view, kind: 'playing', status: { strong: line, rest: '' }, popupSub: line };
    }
    const nextLine = next ? `Next: ${next.number} of ${total} ${Number.isFinite(s.currentTimeMs) && next.startMs > s.currentTimeMs
      ? `in ${shortDuration(next.startMs - s.currentTimeMs, { roundUp: true })}` : `at ${next.time}`}` : 'No more scenes ahead';
    if (s.skippedCount > 0) return { ...view, kind: 'behind',
      status: { strong: nextLine, rest: ` · ${s.skippedCount} behind` }, popupSub: `${nextLine} · ${s.skippedCount} behind` };
    return { ...view, kind: 'waiting', status: { strong: nextLine, rest: '' }, popupSub: nextLine };
  }
  if (!s.sourceKey) return { ...base, kind: 'identifying', chip: { text: 'Off', tone: 'off' }, badge: 'off',
    status: { strong: '', rest: 'Finding this episode… Press play if it has not started.' }, popupSub: 'Finding this episode…' };
  // An edit already loaded and checked (a remembered edit, or one loaded for testing) turns on directly.
  if (s.state === 'loaded' && s.canArm && loadedName) return { ...base, kind: 'ready', armDirect: true, chip: { text: 'Off', tone: 'off' }, badge: 'off', ready: { name: loadedName, version },
    status: { strong: '', rest: 'Ready to watch: ', name: loadedName, version }, popupSub: 'Ready to watch. Scenes switch as you watch.', popupEdit: `${loadedName}${version ? ` · ${version}` : ''} downloaded` };
  if (matches.length === 1) {
    const [only] = chooserItems(matches);
    return { ...base, kind: 'ready', chip: { text: 'Off', tone: 'off' }, badge: 'off', ready: only, releaseId: only.id,
      status: { strong: '', rest: '1 downloaded edit matches: ', name: only.name, version: only.version },
      popupSub: 'Ready to watch. Scenes switch as you watch.', popupEdit: `${only.name}${only.version ? ` · ${only.version}` : ''} downloaded` };
  }
  if (matches.length > 1) return { ...base, kind: 'choose', chip: { text: 'Off', tone: 'off' }, badge: 'off',
    status: { strong: '', rest: `${matches.length} downloaded edits match this episode.` }, popupSub: 'Choose one to watch.', popupEdit: `${matches.length} edits match` };
  return { ...base, kind: 'none', chip: { text: 'Off', tone: 'off' }, badge: 'off',
    status: { strong: '', rest: 'No downloaded edit for this episode.' }, popupSub: 'No downloaded edit for this episode.' };
}

/** The popup's one main button and second row, by state. Account and site access come first. */
export function popupPlan(view, { account = null, siteAllowed = null, onSupportedSite = false, fixtureOnly = false } = {}) {
  if (!fixtureOnly && account && !['saved', 'unconfigured'].includes(account.state))
    return { main: { act: 'link', label: 'Connect your account' }, row: [], sub: 'Connect this browser to your Seamless Scene account to watch website edits.' };
  if (onSupportedSite && siteAllowed === false)
    return { main: { act: 'allow-site', label: 'Allow Prime Video' }, row: [], sub: 'Seamless Scene only runs on sites you allow.' };
  // A creator preview: Preview again and Stop preview only (E57 C4).
  if (view.preview && ['waiting', 'playing', 'behind'].includes(view.kind)) return { main: { act: 'stop', label: 'Stop preview', quiet: true }, row: [{ act: 'again', label: 'Preview again' }] };
  if (view.preview && view.kind === 'finished') return { main: { act: 'again', label: 'Preview again' }, row: [{ act: 'stop', label: 'Stop preview' }] };
  switch (view.kind) {
    case 'unavailable': return { main: { act: 'find', label: 'Find an edit' }, row: [],
      sub: onSupportedSite ? 'Press play on the title to continue.' : 'Open a title on Prime Video and press play.' };
    case 'identifying': case 'none': return { main: { act: 'find', label: 'Find an edit' }, row: [] };
    case 'ready': return { main: { act: 'watch', label: 'Watch with edit', releaseId: view.releaseId }, row: [{ act: 'change', label: 'Change edit…' }] };
    case 'choose': return { main: null, row: [], list: true };
    case 'downloading': return { main: null, row: [] };
    case 'waiting': case 'playing': return { main: { act: 'stop', label: 'Stop edit', quiet: true },
      row: [{ act: 'next', label: 'Next scene', disabled: !view.canNext, title: view.nextTitle }, { act: 'change', label: 'Change edit…' }] };
    // An edit that is on always offers Stop edit, including when the viewer joined late.
    case 'behind': return { main: { act: 'jump-first', label: 'Jump to scene 1' },
      row: [{ act: 'next', label: 'Next scene', disabled: !view.canNext, title: view.nextTitle }, { act: 'stop', label: 'Stop edit' }, { act: 'change', label: 'Change edit…' }] };
    // Finished keeps the edit loaded; Stop edit turns it off and frees it for another tab (E50).
    case 'finished': return { main: { act: 'again', label: 'Watch again' }, row: [{ act: 'find', label: 'Find another edit' }, { act: 'stop', label: 'Stop edit' }] };
    case 'problem': return { main: { ...view.problem.fix, ...(view.releaseId ? { releaseId: view.releaseId } : {}) }, row: [] };
    default: return { main: null, row: [] };
  }
}

/** The popup's edit line: "No edit on", "Name · v1", "Name · v1 downloaded" or "2 edits match". */
export function popupEditLine(view) {
  if (view.popupEdit) return view.popupEdit;
  if (['unavailable', 'identifying', 'none'].includes(view.kind) || (view.kind === 'problem' && !view.name)) return 'No edit on';
  return `${view.name || 'Your edit'}${view.version ? ` · ${view.version}` : ''}`;
}

/** The toolbar icon: a badge only while an edit is on, and a tooltip naming it. */
export function toolbarState(playback, editName = '') {
  const on = ['armed', 'active', 'paused'].includes(playback?.state);
  const name = typeof editName === 'string' && editName.trim() ? editName.trim().slice(0, 120) : '';
  return { on, badge: on ? 'ON' : '', title: on ? `Seamless Scene · On${name ? `: ${name}` : ''}` : 'Seamless Scene · Off' };
}

/** Where "Find an edit" goes: the website's search for this show. Prime often reports the
 * season and episode but not the series title; the page title ("Watch Lighthouse Season 1 |
 * Prime Video") then names the show. */
export function findEditUrl(origin, show, pageTitle = '') {
  if (typeof origin !== 'string' || !origin) return null;
  const named = typeof show?.title === 'string' ? show.title.trim() : '';
  const title = (named || cleanPageTitle(pageTitle)).replace(/\s*[-–:]?\s*\(?\s*Season\s+\d+\s*\)?\s*$/i, '').trim();
  const url = new URL('/search', origin);
  if (title) url.searchParams.set('q', title.slice(0, 120));
  return url.href;
}

export { isActiveLoadPhase };
