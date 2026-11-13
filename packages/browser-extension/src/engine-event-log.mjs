import { EXECUTING_BUILD } from './build-info.mjs';

// 0.65.9: the developer-mode "Engine event export". The scene timing report
// keeps only recent cycles, the playback-evidence allowlist drops the engine's events, and the
// scheduler evidence has no times. While developer mode (Settings → Advanced) is on, this log keeps
// the scheduler-side and sync-mark times in a bounded ring buffer, and the export joins them to the
// engine's own events (MetricsRecorder, already bounded) and the retained cycles' stage traces.
//
// Logging only. record() is a flag check and one array slot write; nothing is copied, cleaned or
// serialized until the export is made. Off (outside developer mode) it records nothing and keeps
// nothing. Every detail goes through sanitizeDetail at export: finite numbers, booleans and short
// code strings only (no URLs, blob or asset references, hashes, UUIDs or free text), and never a
// field whose name suggests a token, key, licence, account, device, title, file or source.
//
// 0.65.10: a code string that merely CONTAINS a UUID or a long hex run is
// left out too (cycle IDs are `<segment UUID>-<n>`, which the anchored check let through), and
// id-like fields (cycleId, actionId, any `…Id`) never carry their value: each distinct value becomes
// a local number, 1, 2, … in order of appearance, per field and per export. The exported cycles
// carry the same number as `cycleRef`. segmentId stays a short scene code (or null), as in the
// scene timing report.
export const ENGINE_EVENT_SCHEMA = 'seamless-engine-events-v1';
export const ENGINE_EVENT_LIMIT = 2000;
export const ENGINE_EXPORT_CYCLE_LIMIT = 200;
const KINDS = new Set(['engine', 'scheduler', 'sync']);

export class EngineEventLog {
  constructor({ now = () => performance.now(), limit = ENGINE_EVENT_LIMIT } = {}) {
    this.now = now;
    this.limit = limit;
    this.enabled = false;
    this.clear();
  }

  setEnabled(enabled) {
    const on = enabled === true;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.clear(); // nothing is kept outside developer mode
  }

  clear() { this.ring = new Array(this.limit); this.next = 0; this.count = 0; this.dropped = 0; }

  record(kind, name, detail = null) {
    if (!this.enabled) return;
    const slot = this.next;
    this.ring[slot] = [this.now(), kind, name, detail];
    this.next = slot + 1 === this.limit ? 0 : slot + 1;
    if (this.count < this.limit) this.count += 1; else this.dropped += 1;
  }

  entries() {
    const start = this.count < this.limit ? 0 : this.next;
    return Array.from({ length: this.count }, (_, index) => this.ring[(start + index) % this.limit]);
  }
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
// Anywhere in the string, not anchored: a prefixed, suffixed or embedded UUID, or 16+ hex digits
// in a row (a dashless UUID, a hash or key fragment).
const HEX_RUN = /[0-9a-f]{16,}/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DENIED_KEY = /url|uri|src|token|key|licen[cs]|lease|hash|sha|account|device|user|mail|title|path|file|blob|packet|asset|cookie|identity|serial|source|generation|origin|secret|auth|signature|cert/i;
// Id-like field names (id, cycleId, actionId, foo_id, fooID). Segment IDs are scene codes, kept as such.
const ID_KEY = /^id$|Id$|ID$|_id$/;
const CODE_ID_KEYS = new Set(['segmentId', 'nextSegmentId']);
const MAX_DEPTH = 4, MAX_KEYS = 64, MAX_ITEMS = 32;

export function safeCode(value) {
  return typeof value === 'string' && CODE.test(value) && !HEX_RUN.test(value) && !UUID.test(value) ? value : null;
}

// Per-export local numbers for id-like values: the raw value is never exported.
export class LocalIdMap {
  constructor() { this.fields = new Map(); }
  ref(field, value) {
    if (!((typeof value === 'string' && value !== '') || Number.isFinite(value))) return null;
    let ids = this.fields.get(field);
    if (!ids) { ids = new Map(); this.fields.set(field, ids); }
    const raw = String(value);
    if (!ids.has(raw)) ids.set(raw, ids.size + 1);
    return ids.get(raw);
  }
}

export function sanitizeDetail(value, depth = 0, ids = new LocalIdMap()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  if (typeof value === 'string') return safeCode(value);
  if (depth >= MAX_DEPTH || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(item => sanitizeDetail(item, depth + 1, ids) ?? null);
  const out = {};
  let keys = 0;
  for (const [key, item] of Object.entries(value)) {
    if (keys >= MAX_KEYS) break;
    if (!CODE.test(key) || DENIED_KEY.test(key)) continue;
    const clean = ID_KEY.test(key) && !CODE_ID_KEYS.has(key) ? ids.ref(key, item) : sanitizeDetail(item, depth + 1, ids);
    if (clean === undefined) continue;
    out[key] = clean; keys += 1;
  }
  return out;
}

const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

// The export: schema, build, clock, retention, then three time-ordered lists on the page's
// performance.now() clock (ms; timeOriginMs maps them to the scene timing report's epoch clock).
export function engineEventExport({ log, metrics = null, timeOriginMs = performance.timeOrigin, wallClock = () => new Date().toISOString() }) {
  if (!log?.enabled) throw Error('engine-events-developer-mode-only');
  const snapshot = metrics?.snapshot?.() ?? null;
  // One id map for the whole export, seeded with the exported cycles in order, so an event's
  // cycleId and its cycle's cycleRef are the same local number.
  const ids = new LocalIdMap();
  const retained = (snapshot?.cycles ?? []).slice(-ENGINE_EXPORT_CYCLE_LIMIT);
  const cycleRefs = retained.map(cycle => ids.ref('cycleId', cycle?.id));
  const logged = log.entries().filter(entry => Array.isArray(entry) && KINDS.has(entry[1]) && safeCode(entry[2]));
  const list = kind => logged.filter(entry => entry[1] === kind).map(([atMs, , name, detail]) => ({ atMs: round(atMs), name, detail: sanitizeDetail(detail ?? {}, 0, ids) ?? {} }));
  const engineEvents = (snapshot?.events ?? []).filter(event => safeCode(event?.name)).map(event => ({ atMs: round(event.atMs), name: event.name, detail: sanitizeDetail(event.detail ?? {}, 0, ids) ?? {} }));
  // Engine-side marks recorded here (planned-cut registration) join the engine's own events.
  for (const entry of list('engine')) engineEvents.push(entry);
  engineEvents.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  const cycles = retained.map((cycle, index) => ({
    sequence: Number.isSafeInteger(cycle.sequence) ? cycle.sequence : null,
    cycleRef: cycleRefs[index],
    segmentId: safeCode(cycle.segmentId),
    action: ['REPLACE', 'INSERT'].includes(cycle.action) ? cycle.action : null,
    status: safeCode(cycle.status),
    entryMode: safeCode(cycle.entryMode),
    coverPath: safeCode(cycle.coverPath ?? null),
    triggerErrorBasis: safeCode(cycle.triggerErrorBasis ?? null),
    nativeCutFrameErrorMs: round(cycle.nativeCutFrameErrorMs),
    ...(cycle.stage ? { stage: sanitizeDetail(cycle.stage, 0, ids) ?? {} } : {})
  }));
  return {
    schema: ENGINE_EVENT_SCHEMA,
    recordedAt: wallClock(),
    executingBuild: EXECUTING_BUILD,
    clock: { domain: 'performance.now', timeOriginMs: round(timeOriginMs) },
    retention: {
      maximumEvents: log.limit, droppedEvents: log.dropped,
      maximumEngineEvents: snapshot?.retention?.maximumEvents ?? null, droppedEngineEvents: snapshot?.retention?.droppedEvents ?? null,
      maximumCycles: ENGINE_EXPORT_CYCLE_LIMIT, droppedCycles: Math.max(0, (snapshot?.cycles?.length ?? 0) - ENGINE_EXPORT_CYCLE_LIMIT) + (snapshot?.retention?.droppedCycles ?? 0)
    },
    engineEvents,
    schedulerEvents: list('scheduler'),
    syncMarks: list('sync'),
    cycles,
    limitations: [
      'Recorded only while developer mode (Settings → Advanced) is on; turning it off clears the log.',
      'Times are page performance.now() ms. Callback and media-clock times are not optical display times.',
      'The clip\'s playing event and first frame callback are reported only with Record scene timing on, at the clip\'s end.',
      'Details keep numbers, booleans and short codes only; anything else is left out.',
      'Id-like fields (cycleId, actionId, …Id) are local numbers for this export only (cycles carry theirs as cycleRef); no code containing a UUID or 16+ hex digits is exported.'
    ]
  };
}
