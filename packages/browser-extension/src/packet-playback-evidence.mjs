import { EXECUTING_BUILD } from './build-info.mjs';

const finite = value => Number.isFinite(value) ? value : null;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const timings = ['nativeSeekErrorMs', 'nativeUncoverErrorMs', 'nativeRecoveryErrorMs',
  'nativeResumeMs', 'nativeFrameWaitMs', 'nativeCompositorWaitMs', 'localUnplayedTailMs',
  'triggerToCoveredMs', 'nativeSeekMs', 'restoreMs', 'coveredDurationMs'];
const outcomes = new Set(['running', 'success', 'failed', 'cancelled']);
const presentations = new Set(['not-requested', 'already-restored', 'hidden-document',
  'presented', 'unsupported', 'frame-timeout', 'prerolled',
  'prerolled-without-frame-callback', 'preroll-withdrawn']);
const statuses = new Set(['pending', 'running', 'active', 'completed', 'skipped', 'failed', 'cancelled']);
const errors = new Set(['timeout', 'local-media-failure', 'snapshot-failure', 'overlay-failure',
  'native-control-failure', 'seek-failure', 'restore-failure', 'transition-failure', 'cancelled']);

// Deliberate allowlist. Never serialize raw cycle IDs/details/events, packet or
// source metadata, source coordinates, asset hashes, filenames or URLs here.
export function automaticPacketEvidence(snapshot) {
  return {
    schemaVersion: 2,
    scope: 'Attempted automatic local transitions; not a release or perceptual gate',
    retention: {
      maximumSharedCycles: 1000,
      droppedSharedCycles: Number.isSafeInteger(snapshot?.retention?.droppedCycles) && snapshot.retention.droppedCycles >= 0
        ? snapshot.retention.droppedCycles : null,
      droppedCountIncludesOtherTransitionOrigins: true
    },
    records: (snapshot?.cycles ?? []).slice(-1000)
      .filter(cycle => cycle.evidenceOrigin === 'automatic-packet')
      .map(cycle => ({
        sequence: positiveInteger(cycle.sequence),
        runSequence: positiveInteger(cycle.evidenceRunSequence),
        actionOrdinal: positiveInteger(cycle.evidenceActionOrdinal),
        action: ['REPLACE', 'INSERT'].includes(cycle.action) ? cycle.action : 'unknown',
        outcome: outcomes.has(cycle.status) ? cycle.status : 'unknown',
        clipDurationMs: finite(cycle.expectedDurationMs),
        entryMode: ['from-start', 'seek-entry'].includes(cycle.entryMode) ? cycle.entryMode : 'unknown',
        triggerErrorMs: cycle.entryMode === 'seek-entry' ? null : finite(cycle.triggerErrorMs),
        triggerErrorBasis: ['native-cut-clock', 'scheduler-observation', 'not-applicable'].includes(cycle.triggerErrorBasis) ? cycle.triggerErrorBasis : null,
        nativeCutFrameErrorMs: cycle.entryMode === 'seek-entry' ? null : finite(cycle.nativeCutFrameErrorMs),
        entryOffsetMs: cycle.entryMode === 'seek-entry' ? finite(cycle.entryOffsetMs) : null,
        errorCode: errors.has(cycle.detail?.errorCode) ? cycle.detail.errorCode : null,
        nativePresentation: presentations.has(cycle.detail?.nativePresentation) ? cycle.detail.nativePresentation : null,
        metrics: Object.fromEntries(timings.map(name => [name, finite(cycle.timings?.[name])])),
        timelineErrorBasis: ['failed', 'cancelled'].includes(cycle.status) ? 'native-recovery-receipt' : 'native-uncover-receipt',
        timelineErrorMs: finite(['failed', 'cancelled'].includes(cycle.status)
          ? cycle.timings?.nativeRecoveryErrorMs : cycle.timings?.nativeUncoverErrorMs)
      }))
  };
}

function schedulerEvidence(scheduler) {
  if (!scheduler) return null;
  const snapshot = scheduler.snapshot();
  return {
    scope: 'Currently armed packet snapshot; bounded historical outcomes are in packetJournal when available',
    observerFailures: Number.isSafeInteger(snapshot.retention?.observerFailures) ? snapshot.retention.observerFailures : null,
    actions: scheduler.actions.slice(0, 1000).map((action, index) => ({
      ordinal: index + 1,
      action: ['REPLACE', 'INSERT', 'SKIP', 'MUTE'].includes(action.type) ? action.type : 'unknown',
      outcome: statuses.has(snapshot.statuses[action.id]) ? snapshot.statuses[action.id] : 'unknown'
    }))
  };
}

export function createPrimePlaybackEvidence({ trials, metrics, scheduler = null, journal = null }) {
  return {
    schemaVersion: 1,
    kind: 'prime-playback-evidence',
    executingBuild: EXECUTING_BUILD,
    manualTrials: trials.snapshot(),
    automaticPacketPlayback: automaticPacketEvidence(metrics.snapshot()),
    currentPacketScheduler: schedulerEvidence(scheduler),
    packetJournal: journal?.snapshot() ?? null,
    limitations: [
      'Timing deltas are measured receipts, not private source positions.',
      'A successful execution status does not establish timing, clean pixels, audio continuity or native restoration acceptance.',
      'Automatic records have no title assignment or perceptual rating; missing samples remain null.',
      'Native presentation is an adapter receipt classification, not proof of displayed pixels; legacy records have no classification.',
      'Seek-entry offsets are not trigger errors. Unknown entry modes in legacy records must not be pooled with from-start trigger samples.',
      'Trigger errors require their recorded basis. Legacy planned cuts may contain the scheduled wake coordinate rather than a native-clock observation; callback and media-clock deltas are not optical display timing.',
      'Only attempted local transitions have cycle receipts. Bounded journal events distinguish skips, replay, preflight and arming outcomes; do not sum all events as independent trials.',
      'Private-picker failures before packet acceptance are outside the journal. Evicted events, observer faults and missing title/perceptual attribution prevent complete denominator certification.'
    ]
  };
}
