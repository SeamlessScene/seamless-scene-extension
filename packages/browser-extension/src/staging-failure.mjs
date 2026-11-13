// Diagnostics are closed vocabularies: never retain exception text, stack,
// cause, private media identity or arbitrary adapter fields.
const phases = new Set(['prepare', 'overlay-host', 'overlay-mount', 'overlay-show']);
const kinds = new Set(['timeout', 'cancelled', 'error']);

export function sanitizeStagingFailure(value) {
  return Object.freeze({
    phase: phases.has(value?.phase) ? value.phase : 'unknown',
    kind: kinds.has(value?.kind) ? value.kind : 'unknown'
  });
}

export function stagingFailureFromError(error) {
  try {
    const name = error?.name;
    const typed = ['TransitionStepError', 'TransitionTimeoutError'].includes(name);
    return sanitizeStagingFailure({
      phase: typed ? error.phase : null,
      kind: name === 'AbortError' ? 'cancelled'
        : name === 'TransitionTimeoutError' ? 'timeout'
          : typed ? 'error' : null
    });
  } catch {
    // Even an unusual thrown value must not make diagnostics reject playback.
    return sanitizeStagingFailure(null);
  }
}
