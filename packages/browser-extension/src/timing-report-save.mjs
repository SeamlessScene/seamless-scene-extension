// Saving a scene timing report (0.62.21). The player menu saves its own tab's
// report directly (no other tab is asked); Settings asks the player it targets. Either way
// the result is a sentence saying what was saved, or why nothing was: never silence.
export const TIMING_FILE_PREFIX = 'scene-timing-';

export const timingSummary = report =>
  `${report.transitionCount} scene${report.transitionCount === 1 ? '' : 's'} recorded.`;

const REASONS = Object.freeze({
  'viewer-timing-empty': 'No scene recorded yet. With Record scene timing on, play through a scene, then try again.',
  'timing-unavailable': 'Scene timing is not running in this tab. Turn on Record scene timing in Settings → Advanced, then refresh this tab.',
  'viewer-player-ambiguous': 'Several Prime Video tabs are open. Choose the player above, or use Save timing report in that tab’s player menu.',
  'viewer-controller-unavailable': 'No Prime Video player is open. Open the title, play through a scene, then try again.',
  'viewer-controller-disconnected': 'That Prime Video tab closed or refreshed. Save from the tab that played the scenes.',
  'viewer-action-timeout': 'That Prime Video tab did not answer (Chrome may have paused it in the background). Bring it to the front, or use Save timing report in its player menu.',
  'viewer-timing-unanswered': 'That Prime Video tab did not answer (Chrome may have paused it in the background). Bring it to the front, or use Save timing report in its player menu.'
});
export function timingFailureMessage(error) {
  const code = typeof error?.message === 'string' ? error.message : '';
  return REASONS[code] ?? 'The scene timing report could not be saved. Try again from the player menu of the tab that played the scenes.';
}

/** Reads a report and saves it as a download. Returns { saved, message, count }. */
export async function saveTimingReport({ read, document = globalThis.document, URL = globalThis.URL, Blob = globalThis.Blob,
  setTimeout = globalThis.setTimeout.bind(globalThis), where = '' }) {
  let report;
  try { report = await read(); } catch (error) { return { saved: false, message: timingFailureMessage(error) }; }
  if (!report?.transitionCount) return { saved: false, message: REASONS['viewer-timing-empty'] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${TIMING_FILE_PREFIX}${String(report.recordedAt).replace(/[:.]/g, '-')}.json`;
    anchor.click();
  } catch {
    URL.revokeObjectURL(url);
    return { saved: false, message: 'The browser did not start the download. Try again.' };
  }
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { saved: true, count: report.transitionCount, message: `${timingSummary(report)} Report saved to Downloads${where ? ` (${where})` : ''}.` };
}
