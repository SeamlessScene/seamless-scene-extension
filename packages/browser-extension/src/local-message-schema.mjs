import { catalogObservedSource } from './catalog-runtime-service.mjs';
import { validateManifestSchema } from './manifest-security.mjs';
import { minimumAssetDurationMs, maximumAssetDurationMs } from './asset-duration-policy.mjs';
import { validateLocalUserEditPacket } from './local-edit-packet.mjs';
import { isPreviewPacket } from './preview-packet.mjs';
import { isViewerLoadCode } from './viewer-load-error.mjs';
import { validDisconnectNotice } from './connection-diagnostics.mjs';

// The 1 MiB imported JSON may gain up to 1000 hash-only filename aliases before
// transport. Preserve that admission contract while bounding the wire envelope.
export const LOCAL_LIMITS = Object.freeze({ messageBytes: 1_200_000, sessions: 32, sessionsPerTab: 2, pending: 8, controlReserve: 2 });
export const LOCAL_COMMANDS = new Set(['clockSample', 'viewerClock', 'prepare', 'prepareNext', 'advance', 'cue', 'mount', 'unmount', 'configureAudio', 'primeForPlayback', 'show', 'play', 'stop', 'teardown', 'clear', 'abort', 'lease', 'importReady', 'catalogActions', 'catalogActivity', 'localPause', 'localResume', 'localSeek', 'localMute', 'localFadeOut', 'prerollAt', 'timing', 'timingLog', 'primeStandby', 'promoteStandby', 'cueAt']);
export const LOCAL_CONTROL_COMMANDS = new Set(['stop', 'teardown', 'clear', 'importReady']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const gain = value => Number.isSafeInteger(value) && finite(value, -24, 6);
const asset = value => typeof value === 'string' && /^asset:[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
// 0.62.10 exit diagnostics with the play result: how the clip's end fade met its actual end.
const endFadeReport = value => exact(value, ['endedAtMs', 'gainAtEnd', 'ended', 'trace']) && finite(value.endedAtMs, -600000, 600000)
  && (value.gainAtEnd === null || finite(value.gainAtEnd, 0, 1)) && typeof value.ended === 'boolean'
  && Array.isArray(value.trace) && value.trace.length <= 48 && value.trace.every(row => Array.isArray(row) && row.length === 2 && finite(row[0], -600000, 600000) && finite(row[1], 0, 1));
// E58 diagnostics the renderer returns for a clip end fade (times relative to the clip's end).
const FADE_REASONS = ['clip-finished', 'clip-not-playing', 'hidden-tab', 'clip-muted', 'clip-replaced'];
const fadeReport = value => (exact(value, ['status']) && value.status === 'cancelled')
  || (exact(value, ['status', 'reason']) && value.status === 'skipped' && FADE_REASONS.includes(value.reason))
  || ((exact(value, ['status', 'startMs', 'endMs']) || exact(value, ['status', 'startMs', 'endMs', 'lateMs']) || exact(value, ['status', 'startMs', 'endMs', 'shortenedMs'])) && value.status === 'scheduled'
    && finite(value.startMs, -1000, 0) && finite(value.endMs, -1000, 0) && (!('lateMs' in value) || finite(value.lateMs, 0, 60000))
    && (!('shortenedMs' in value) || finite(value.shortenedMs, 0, 1000)));

function boundedJson(value) {
  let nodes = 0, characters = 0;
  const seen = new Set();
  function visit(item, depth) {
    if (++nodes > 200_000 || depth > 24) throw Error('structure');
    if (typeof item === 'string') { characters += item.length; if (characters > LOCAL_LIMITS.messageBytes) throw Error('size'); return; }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw Error('number'); return; }
    if ((!plain(item) && !Array.isArray(item)) || seen.has(item)) throw Error('non-json');
    seen.add(item);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error('accessor');
      characters += key.length; visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  try {
    visit(value, 0);
    const json = JSON.stringify(value);
    return new TextEncoder().encode(json).length <= LOCAL_LIMITS.messageBytes && !/(?:blob:|file:\/\/|data:)/i.test(json);
  } catch { return false; }
}

// 0.65.3: how a chained join handed over (ms relative to the current clip's end).
function chainReport(value) {
  const ms = v => v === null || finite(v, -2000, 2000);
  return exact(value, ['playLeadMs', 'playMs', 'firstFrameMs', 'firstFrameMediaMs', 'revealVia', 'revealMs', 'revealPresentedFrames'])
    && finite(value.playLeadMs, 0, 2000) && ms(value.playMs) && ms(value.firstFrameMs)
    && (value.firstFrameMediaMs === null || finite(value.firstFrameMediaMs, 0, 125000))
    && ['already-presenting', 'first-frame', 'cap', 'advance', 'pending'].includes(value.revealVia)
    && (value.revealMs === null || finite(value.revealMs, 0, 2000))
    // 0.65.6: the next clip's presentedFrames at the reveal (null before its first frame callback).
    && (value.revealPresentedFrames === null || (Number.isSafeInteger(value.revealPresentedFrames) && value.revealPresentedFrames >= 0));
}

function validateLocalMessage(message, role) {
  if (!boundedJson(message)) return false;
  if (role === 'controller') {
    if (!(exact(message, ['type', 'id', 'command', 'args']) || exact(message, ['type', 'id', 'command'])) || message.type !== 'command' || !positiveId(message.id) || !LOCAL_COMMANDS.has(message.command)) return false;
    const args = message.args ?? [];
    if (!Array.isArray(args)) return false;
    switch (message.command) {
      case 'prepare': case 'prepareNext': return args.length === 1 && (args[0] === 'fixture' || asset(args[0]));
      case 'configureAudio': return args.length === 2 && exact(args[0], ['muted', 'volume']) && typeof args[0].muted === 'boolean' && finite(args[0].volume, 0, 1) && gain(args[1]);
      // 0.65.2 (W7): chainNext asks the renderer to hand over to the prepared next clip itself.
      case 'play': return args.length === 0 || (args.length === 1 && (exact(args[0], []) || (exact(args[0], ['profileClass']) && ['mvp', 'local-user', 'catalog-v2'].includes(args[0].profileClass))
        || (exact(args[0], ['chainNext']) && args[0].chainNext === true)
        || (exact(args[0], ['profileClass', 'chainNext']) && ['mvp', 'local-user', 'catalog-v2'].includes(args[0].profileClass) && args[0].chainNext === true)));
      case 'abort': case 'importReady': return args.length === 1 && positiveId(args[0]);
      case 'cue': return args.length === 1 && finite(args[0], 0, 0.999);
      // 0.65.7 short-gap fallback: an exact clip position in whole milliseconds.
      case 'cueAt': return args.length === 1 && Number.isSafeInteger(args[0]) && finite(args[0], 0, 125000);
      case 'localSeek': return args.length === 1 && Number.isSafeInteger(args[0]) && args[0] !== 0 && finite(args[0], -30000, 30000);
      case 'localMute': return args.length === 1 && typeof args[0] === 'boolean';
      case 'localFadeOut': return (args.length === 1 && typeof args[0] === 'boolean') || (args.length === 2 && args[0] === true && (args[1] === 'cut' || (Number.isSafeInteger(args[1]) && finite(args[1], 1, 1000))));
      case 'prerollAt': return (args.length === 1 && args[0] === null) || ((args.length === 2 || args.length === 3) && args.every(n => finite(n, 1e12, 1e14)))
        || (args.length === 4 && args.slice(0, 3).every(n => finite(n, 1e12, 1e14)) && args[3] === 0);
      case 'timing': return args.length === 1 && typeof args[0] === 'boolean';
      case 'catalogActivity': return args.length === 2 && typeof args[0] === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(args[0]) && typeof args[1] === 'boolean';
      case 'catalogActions': {
        if (args.length !== 1 || !plain(args[0])) return false;
        try { return exact(args[0], Object.keys(catalogObservedSource(args[0]))); } catch { return false; }
      }
      default: return args.length === 0;
    }
  }
  if (role !== 'renderer') return false;
  switch (message.type) {
    case 'disconnect-notice': return validDisconnectNotice(message, 'renderer');
    case 'result': return positiveId(message.id) && (message.ok === false
      ? exact(message, ['type', 'id', 'ok', 'error']) && typeof message.error === 'string' && /^(?:catalog|private)-[a-z0-9-]{1,120}$/.test(message.error)
      : message.ok === true && (exact(message, ['type', 'id', 'ok', 'value']) || exact(message, ['type', 'id', 'ok'])));
    case 'import-start': return exact(message, ['type', 'importId']) && positiveId(message.importId);
    case 'import-error': return exact(message, ['type']) || (exact(message, ['type', 'code']) && isViewerLoadCode(message.code));
    case 'catalog-invalidated': return exact(message, ['type']);
    case 'lease-request': return exact(message, ['type']);
    case 'local-ending': return message.endAtMs === null ? exact(message, ['type', 'endAtMs']) :
      exact(message, ['type', 'endAtMs', 'sentEpochMs', 'sentMonotonicMs']) && finite(message.endAtMs, 1e12, 1e14) && finite(message.sentEpochMs, 1e12, 1e14) && finite(message.sentMonotonicMs, 0, 1e12);
    case 'catalog-packet': return exact(message, ['type', 'packet']) && exact(message.packet, ['manifest', 'packet_id']) && uuid(message.packet.packet_id) && validateManifestSchema(message.packet.manifest, { profileClass: 'catalog-v2' }).ok;
    // A creator preview carries its scene's name beside the packet (E57 C4); nothing else may.
    case 'packet': return (exact(message, ['type', 'packet']) || (exact(message, ['type', 'packet', 'preview']) && exact(message.preview, ['name'])
        && typeof message.preview.name === 'string' && message.preview.name.length <= 120 && isPreviewPacket(message.packet)))
      && validateLocalUserEditPacket(message.packet).ok
      && message.packet.asset_bindings.every(binding => binding.relative_path === `${binding.sha256}.mp4`);
    default: return false;
  }
}

export function validLocalMessage(message, role) {
  try { return validateLocalMessage(message, role); } catch { return false; }
}

export function validLocalResult(message, command) {
  if (!validLocalMessage(message, 'renderer') || message.type !== 'result') return false;
  if (!message.ok) return true;
  const value = message.value ?? null;
  if (command === 'clockSample') return exact(value, ['epochMs', 'monotonicMs']) && finite(value.epochMs, 1e12, 1e14) && finite(value.monotonicMs, 0, 1e12);
  if (command === 'viewerClock') return exact(value,['currentTimeMs','paused','buffering']) && (value.currentTimeMs===null || finite(value.currentTimeMs,0,1200000)) && typeof value.paused==='boolean' && typeof value.buffering==='boolean';
  if (command === 'prepare' || command === 'prepareNext') return exact(value, ['readyState']) && Number.isInteger(value.readyState) && finite(value.readyState, 3, 4);
  if (command === 'timingLog') return validTimingStream(value);
  if (command === 'localFadeOut') return fadeReport(value);
  if (command === 'cue' || command === 'cueAt') return value === null || (exact(value, ['positionMs']) && Number.isSafeInteger(value.positionMs) && finite(value.positionMs, 0, 125000));
  // 0.65.7 short-gap priming: whether the standby was warmed, why not, and its measured start-up.
  if (command === 'primeStandby') return exact(value, ['status', 'reason', 'startLatencyMs']) && ['primed', 'skipped'].includes(value.status)
    && (value.reason === null || ['not-prepared', 'busy', 'no-playing-clip', 'too-late'].includes(value.reason))
    && (value.startLatencyMs === null || finite(value.startLatencyMs, 30, 250));
  if (command === 'configureAudio') return exact(value, ['muted', 'volume', 'gainDb']) && typeof value.muted === 'boolean' && finite(value.volume, 0, 1) && gain(value.gainDb);
  if (command === 'play') return exact(value, ['durationMs', 'localTimeAtEndMs', 'unplayedTailMs', 'frameHoldMode', 'heldFrameMediaTimeMs', 'localEnded', ...(Object.hasOwn(value ?? {}, 'stalledMs') ? ['stalledMs'] : []), ...(Object.hasOwn(value ?? {}, 'endFade') ? ['endFade'] : []), ...(Object.hasOwn(value ?? {}, 'exitDiag') ? ['exitDiag'] : []), ...(Object.hasOwn(value ?? {}, 'chain') ? ['chain'] : []), ...(Object.hasOwn(value ?? {}, 'firstFrame') ? ['firstFrame'] : [])])
    && (!Object.hasOwn(value, 'exitDiag') || exitDiagReport(value.exitDiag))
    // 0.65.7 (scene timing on): the clip's first frame callback: when it ran and the frame's display time (epoch ms).
    // 0.65.9: and, when it came, the clip's 'playing' event (epoch ms).
    && (!Object.hasOwn(value, 'firstFrame') || (exact(value.firstFrame, ['callbackMs', 'displayMs', 'mediaMs', ...(Object.hasOwn(value.firstFrame ?? {}, 'playingMs') ? ['playingMs'] : [])]) && finite(value.firstFrame.callbackMs, 1e12, 1e14)
      && (!Object.hasOwn(value.firstFrame, 'playingMs') || finite(value.firstFrame.playingMs, 1e12, 1e14))
      && (value.firstFrame.displayMs === null || finite(value.firstFrame.displayMs, 1e12, 1e14)) && (value.firstFrame.mediaMs === null || finite(value.firstFrame.mediaMs, 0, 125000))))
    && (!Object.hasOwn(value, 'chain') || chainReport(value.chain))
    && (!Object.hasOwn(value, 'endFade') || endFadeReport(value.endFade))
    && (!Object.hasOwn(value, 'stalledMs') || (Number.isSafeInteger(value.stalledMs) && finite(value.stalledMs, 1, 8000)))
    && ['durationMs', 'localTimeAtEndMs', 'unplayedTailMs'].every(key => finite(value[key], 0, 125000))
    && (value.heldFrameMediaTimeMs === null || finite(value.heldFrameMediaTimeMs, 0, 125000)) && typeof value.localEnded === 'boolean'
    && ['natural-end', 'local-canvas-audio-to-ended', 'paused-frame-fallback', 'chain-handover'].includes(value.frameHoldMode);
  if (command === 'catalogActions') return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every(action => {
    const local = ['INSERT', 'REPLACE'].includes(action?.type);
    return exact(action, ['id', 'type', 'triggerMs', 'resumeMs', 'clipUrl', 'gainDb', ...(local ? ['expectedDurationMs', 'profileClass'] : [])])
      && typeof action.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(action.id) && ['INSERT', 'REPLACE', 'SKIP', 'MUTE'].includes(action.type)
      && ['triggerMs', 'resumeMs'].every(key => Number.isSafeInteger(action[key]) && finite(action[key], 0, 86400000)) && gain(action.gainDb)
      && (local ? asset(action.clipUrl) && action.profileClass === 'catalog-v2' && finite(action.expectedDurationMs, minimumAssetDurationMs('catalog-v2'), maximumAssetDurationMs('catalog-v2')) : action.clipUrl === null);
  });
  return LOCAL_COMMANDS.has(command) && value === null;
}

// E72 (0.64.3): the clip's decoder counts and the renderer's long frames at its end.
function exitDiagReport(value) {
  const quality = value?.quality;
  return exact(value, ['quality', 'longFrames'])
    && (quality === null || (Array.isArray(quality) && quality.length === 2 && quality.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9)))
    && Array.isArray(value.longFrames) && value.longFrames.length <= 16
    && value.longFrames.every(row => Array.isArray(row) && row.length === 3 && finite(row[0], -2000, 2000) && finite(row[1], 0, 60000) && (row[2] === null || finite(row[2], 0, 60000)));
}

function validTimingStream(value) {
  const epoch = n => finite(n, 1e12, 1e14);
  const count = n => Number.isSafeInteger(n) && n >= 0;
  const rows = (list, maximum, check) => Array.isArray(list) && list.length <= maximum && list.every(check);
  return exact(value, ['frames', 'states', 'spans', 'losses', 'playback', 'dropped', 'maximumHeartbeatGapMs'])
    && value.maximumHeartbeatGapMs === 100
    && exact(value.dropped, ['frames', 'states', 'spans', 'losses', 'playback']) && Object.values(value.dropped).every(count)
    && rows(value.frames, 12000, row => Array.isArray(row) && row.length === 4 && epoch(row[0]) && finite(row[1], 0, 86400) && positiveId(row[2]) && (row[3] === null || positiveId(row[3])))
    && rows(value.states, 2000, row => Array.isArray(row) && row.length === 4 && epoch(row[0]) && (row[1] === null || positiveId(row[1])) && ['video', 'hidden', 'held', 'unknown'].includes(row[2]) && (row[3] === null || finite(row[3], 0, 86400)))
    && rows(value.playback, 2000, row => Array.isArray(row) && row.length === 5 && epoch(row[0]) && (row[1] === null || positiveId(row[1])) && row.slice(2).every(flag => flag === null || typeof flag === 'boolean'))
    && rows(value.spans, 2000, row => Array.isArray(row) && row.length === 2 && epoch(row[0]) && epoch(row[1]) && row[1] >= row[0])
    && rows(value.losses, 2000, row => Array.isArray(row) && row.length === 3 && epoch(row[0]) && epoch(row[1]) && row[1] >= row[0] && positiveId(row[2]));
}
