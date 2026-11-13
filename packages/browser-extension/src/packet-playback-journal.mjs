import { sanitizeStagingFailure } from './staging-failure.mjs';

const actions = new Set(['REPLACE', 'INSERT', 'SKIP', 'MUTE']);
const schedulerOutcomes = new Set(['preflight-started', 'preflight-ready', 'preflight-failed', 'preflight-cancelled',
  'stage-started', 'staged', 'stage-failed',
  'running', 'started', 'completed', 'failed', 'cancelled', 'cancelled-by-seek', 'skipped', 'reset-pending', 'mute-stopped']);
const reasons = new Set(['preload-unavailable', 'not-ready', 'cancelled', 'armed-after-trigger', 'missed-interval',
  'preflight-not-ready', 'seek-at-or-before-trigger', 'seek-after-trigger', 'plan-cancelled',
  'during-previous', 'unstaged-fallback', 'seek-entry-not-ready', 'seek-into-replaced', 'chained']);
const phases = new Set(['source-check', 'compile', 'scheduler-arm']);
// 0.65.7: why the controller cleared the run (its clear(reason) caller). Known codes only; anything
// else is 'other', so no free text reaches the journal.
export const CLEAR_CAUSES = Object.freeze(['local-packet-replaced', 'viewer-user-stopped', 'catalog-state-changed', 'ad-break-detected',
  'native-player-changed', 'page-lifecycle-ended', 'pagehide', 'pagehide-bfcache', 'source-identity-changed', 'source-identity-unavailable',
  'user-cancelled-local-packet', 'new-folder-selected', 'packet-rejected', 'renderer-disconnected']);
export const clearCause = cause => CLEAR_CAUSES.includes(cause) ? cause : 'other';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// Current-page, bounded diagnostics only. Private IDs live only in an active
// run's ordinal map and are released on close; retained events never contain them.
export class PacketPlaybackJournal {
  constructor() {
    this.events = []; this.sequence = 0; this.runSequence = 0;
    this.droppedEvents = 0; this.rejectedEvents = 0; this.ignoredLateEvents = 0;
    this.closedRunObserverFailures = 0;
  }

  #append(runSequence, event, fields = {}) {
    this.events.push(Object.freeze({ sequence: ++this.sequence, runSequence, event, ...fields }));
    if (this.events.length > 2000) { this.events.shift(); this.droppedEvents++; }
  }

  beginRun(selectedActions, profileContext = 'local-user') {
    if (!Array.isArray(selectedActions) || selectedActions.length < 1 || selectedActions.length > 1000) throw TypeError('Invalid journal action count');
    const ordinals = new Map();
    for (const [index, action] of selectedActions.entries()) {
      if (typeof action?.id !== 'string' || !action.id.length || action.id.length > 128 || !actions.has(action.type) || ordinals.has(action.id)) throw TypeError('Invalid journal action');
      ordinals.set(action.id, { ordinal: index + 1, type: action.type });
    }
    const runSequence = ++this.runSequence; let closed = false;
    this.#append(runSequence, 'arm-requested', { actionCount: ordinals.size,
      profileContext: ['local-user', 'catalog-v2'].includes(profileContext) ? profileContext : 'unknown' });
    const append = (event, fields) => {
      if (closed) { this.ignoredLateEvents++; return; }
      this.#append(runSequence, event, fields);
    };
    const close = (reason = 'cleared', observerFailures = 0, cause = undefined) => {
      if (closed) return;
      const failures = count(observerFailures); this.closedRunObserverFailures += failures;
      append('run-closed', { reason: ['cleared', 'arm-failed', 'cancelled'].includes(reason) ? reason : 'unknown', observerFailures: failures,
        ...(cause === undefined ? {} : { cause: clearCause(cause) }) });
      closed = true; ordinals.clear();
    };
    return Object.freeze({
      sequence: runSequence,
      context: action => {
        const found = closed ? null : ordinals.get(action?.id);
        return found && found.type === action?.type ? Object.freeze({ runSequence, actionOrdinal: found.ordinal }) : null;
      },
      armed: () => append('armed'),
      refuse: (phase, cancelled = false, observerFailures = 0) => {
        if (closed) return;
        append(cancelled ? 'arm-cancelled' : 'arm-refused', { phase: phases.has(phase) ? phase : 'unknown' });
        close(cancelled ? 'cancelled' : 'arm-failed', observerFailures);
      },
      onSchedulerEvent: event => {
        if (closed) { this.ignoredLateEvents++; return; }
        const found = ordinals.get(event?.actionId);
        if (!found || found.type !== event.type || !schedulerOutcomes.has(event.outcome)) { this.rejectedEvents++; return; }
        append('scheduler', { actionOrdinal: found.ordinal, action: found.type, outcome: event.outcome,
          reason: event.reason === null || event.reason === undefined ? null : reasons.has(event.reason) ? event.reason : 'unknown',
          ...(event.outcome === 'stage-failed' && event.failure ? { failure: sanitizeStagingFailure(event.failure) } : {}) });
      },
      close
    });
  }

  snapshot() {
    return {
      schemaVersion: 1,
      scope: 'Arming and scheduler events in this page session; not a release-gate denominator',
      retention: { maximumEvents: 2000, droppedEvents: this.droppedEvents, rejectedEvents: this.rejectedEvents,
        ignoredLateEvents: this.ignoredLateEvents, closedRunObserverFailures: this.closedRunObserverFailures },
      events: this.events.map(event => ({ ...event, ...(event.failure ? { failure: { ...event.failure } } : {}) }))
    };
  }
}
