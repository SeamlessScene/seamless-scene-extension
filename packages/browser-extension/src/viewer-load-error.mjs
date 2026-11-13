// Only these constants cross the private renderer boundary. Never forward a
// lower-level message merely because its spelling resembles an error code.
const messages = Object.freeze({
  'viewer-renderer-unavailable': 'The player is not ready. Refresh this Prime Video tab, then try again.',
  'viewer-release-invalid': 'This edit link is not valid. Choose the edit again on the website.',
  'viewer-release-unavailable': 'This edit is no longer on Seamless Scene. Choose another edit on the website.',
  'viewer-access-refused': 'Seamless Scene cannot open this edit on this device. It may have been withdrawn, or your account connection changed. Check the edit on the website, then try again.',
  'viewer-rate-limited': 'Seamless Scene is busy right now. Wait a minute, then try again.',
  // E91 (0.66.1): the website's per-edit re-download allowance (3 copies in 24 hours). Surfaces that
  // know when it ends show downloadLimitMessage() instead, with the wait.
  'viewer-download-limit': 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again later.',
  'viewer-server-unavailable': 'Seamless Scene cannot be reached right now. Try again in a minute.',
  'viewer-extension-updated': 'Seamless Scene was updated. Refresh this tab to keep watching with edits.',
  'viewer-player-not-active': 'Another Prime Video tab is playing your edits. Close it, refresh this tab, then try again.',
  'viewer-account-link-removed': 'This browser is no longer connected to your Seamless Scene account. Connect it again in Settings → Account & sites.',
  'viewer-link-check-offline': 'Seamless Scene cannot be reached to check your account connection. Check your internet connection, then try again.',
  'viewer-link-check-interrupted': 'Checking your account connection was interrupted. Try again.',
  'viewer-link-check-failed': 'Seamless Scene could not confirm your account connection. Try again; if it keeps happening, connect your account again in Settings → Account & sites.',
  'viewer-account-changed': 'Your downloaded edits belong to a different account. Connect that account again, or remove them in Settings → Library.',
  'viewer-extension-no-reply': 'Seamless Scene did not respond. Refresh this Prime Video tab; if it keeps happening, restart Chrome.',
  'viewer-owner-busy': 'Another Prime Video tab is using your downloaded edits. Stop the edit there, then try again.',
  'viewer-budget-exceeded': 'There is not enough space for this edit. Free some space in Settings → Library.',
  'viewer-account-link-required': 'This browser is not connected to your Seamless Scene account. Connect your account, then try again.',
  'viewer-download-stalled': 'The download stopped. Check your connection, then try again.',
  // 0.63.0 local edits (.ss) kept in the extension's storage.
  'viewer-local-missing': 'This local edit’s copy is missing from the extension’s storage. Add the .ss file again in Settings → Local.',
  'viewer-local-invalid': 'This local edit could not be read. Add the .ss file again in Settings → Local.',
  'viewer-download-cancelled': 'Download cancelled. Choose Watch on the website to download it again.',
  // 0.62.21: a download that stopped part-way (connection, server busy, pause) is not a refusal.
  'viewer-download-interrupted': 'Download interrupted. Choose Retry to continue.',
  'viewer-import-restoration-failed': 'The original video could not be restored before loading the edit. Refresh this tab, then try again.',
  'viewer-import-cleanup-failed': 'The previous edit could not be closed. Refresh this tab, then try again.',
  'viewer-protected-owner-failed': 'The edit could not be set up. Try again; if it keeps happening, copy the details for support.',
  'viewer-local-storage-unavailable': 'Chrome could not open the storage for your edits. Restart Chrome, then try again.',
  // Unknown cause (E41: after an update no request reached the server; restarting Chrome fixed it).
  'viewer-protected-open-failed': 'The downloaded edit could not be opened on this device. Refresh the Prime Video tab and try again; if it keeps happening, restart Chrome.',
  'viewer-catalog-import-failed': 'This edit could not be checked. Try again, or download it again from the website.',
  'viewer-packet-import-failed': 'This edit could not be checked. Add its .ss file again in Settings → Local, then try again.',
  'viewer-packet-import-timeout': 'Checking the edit took too long. Try again.',
  'viewer-media-prepare-failed': 'The scenes of this edit could not be prepared for playback. Try again.',
  'viewer-packet-delivery-failed': 'The edit could not be sent to the player. Refresh this tab, then try again.',
  'viewer-import-cancelled': 'Loading stopped because another edit was chosen.',
  // 0.65.0 (W9, A2): a catalog edit made for a newer extension (for example clips under 5 s).
  'viewer-client-update-required': 'This edit needs a newer Seamless Scene. Update the extension, then try again.'
});
const known = Object.freeze({
  'protected-release-unavailable': 'viewer-release-unavailable',
  'protected-access-refused': 'viewer-access-refused',
  'protected-download-limit': 'viewer-download-limit',
  'protected-rate-limited': 'viewer-rate-limited',
  'protected-server-unavailable': 'viewer-server-unavailable',
  'extension-build-changed': 'viewer-extension-updated',
  'protected-renderer-not-authorized': 'viewer-player-not-active',
  'protected-link-removed': 'viewer-account-link-removed',
  'protected-link-check-offline': 'viewer-link-check-offline',
  'protected-link-check-interrupted': 'viewer-link-check-interrupted',
  'protected-link-check-failed': 'viewer-link-check-failed',
  'protected-credentials-no-reply': 'viewer-extension-no-reply',
  'protected-owner-busy': 'viewer-owner-busy',
  'vault-budget-exceeded': 'viewer-budget-exceeded',
  'paired-session-required': 'viewer-account-link-required',
  'paired-session-changed': 'viewer-account-link-required',
  'catalog-protected-pairing-required': 'viewer-account-link-required',
  'protected-offline-account-unavailable': 'viewer-account-link-required',
  'protected-account-changed': 'viewer-account-changed',
  'protected-account-generation-changed': 'viewer-account-changed',
  'protected-signout-race': 'viewer-account-link-required',
  'protected-account-storage': 'viewer-local-storage-unavailable',
  // The edits' storage or its owner closed or is held by another Chrome context (E41).
  'installation-storage-unavailable': 'viewer-local-storage-unavailable',
  'installation-storage-blocked': 'viewer-local-storage-unavailable',
  'installation-store-closed': 'viewer-local-storage-unavailable',
  'protected-owner-closed': 'viewer-local-storage-unavailable',
  'protected-vault-closed': 'viewer-local-storage-unavailable',
  'protected-download-stalled': 'viewer-download-stalled',
  'protected-download-cancelled': 'viewer-download-cancelled',
  // 0.62.21: the server's read quota refused an object mid-download with 403, and
  // the panel said the edit "may have been withdrawn". Only a refused descriptor (the
  // entitlement check) keeps that message; any failure part-way through is "interrupted".
  'protected-object-refused': 'viewer-download-interrupted',
  'request-paused': 'viewer-download-interrupted',
  'request-aborted': 'viewer-download-interrupted',
  'response-size': 'viewer-download-interrupted',
  'response-body': 'viewer-download-interrupted',
  'protected-range-unsupported': 'viewer-download-interrupted',
  'client-cancelled': 'viewer-download-interrupted',
  'staging-cancelled': 'viewer-download-interrupted',
  'private-packet-import-timeout': 'viewer-packet-import-timeout',
  'client-update-required': 'viewer-client-update-required',
  'inner-catalog-client-update-required': 'viewer-client-update-required',
  'catalog-client-update-required': 'viewer-client-update-required'
});
const stages = Object.freeze({ restoration: 'viewer-import-restoration-failed', cleanup: 'viewer-import-cleanup-failed',
  owner: 'viewer-protected-owner-failed', protected: 'viewer-protected-open-failed', catalog: 'viewer-catalog-import-failed',
  packet: 'viewer-packet-import-failed', media: 'viewer-media-prepare-failed', delivery: 'viewer-packet-delivery-failed' });
export const isViewerLoadCode = value => typeof value === 'string' && Object.hasOwn(messages, value);
export const viewerLoadCode = (error, stage = 'packet') => Object.hasOwn(known, error?.message) ? known[error.message]
  : isViewerLoadCode(error?.message) ? error.message : Object.hasOwn(stages, stage) ? stages[stage] : 'viewer-packet-import-failed';
/**
 * 0.63.3: the code for a failed download (not a load). A network failure after the client's
 * reconnects (a TypeError from fetch, an aborted read) is an interruption with Retry, never
 * "could not be opened on this device… restart Chrome".
 */
export function downloadFailureCode(error) {
  const code = viewerLoadCode(error, 'protected');
  if (code !== 'viewer-protected-open-failed') return code;
  const name = typeof error?.name === 'string' ? error.name : '', message = typeof error?.message === 'string' ? error.message : '';
  if (name === 'TypeError' || name === 'AbortError' || name === 'NetworkError' || /network|fetch|connection|ERR_/i.test(message)) return 'viewer-download-interrupted';
  return code;
}
/** A short, safe token for diagnostics: an error code or name, never free text. */
export function failureCause(error) {
  const token = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value) ? value : null;
  const message = typeof error?.message === 'string' ? error.message : '', name = typeof error?.name === 'string' ? error.name : '';
  // A sentence keeps its words (0.62.2 lost "why" to "Error"): addresses and IDs are dropped, the
  // rest becomes a hyphenated token of at most 80 characters.
  const words = message.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ').replace(/amzn1\.[\w.:-]+/gi, ' ').replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{3,})*\b/gi, ' ')
    .replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^[^A-Za-z]+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  return token(error?.detail) ?? token(message) ?? token(words) ?? token(name) ?? 'unknown';
}
/** E91: the wait the server gave a download-limit refusal, in whole seconds (bounded), or null. */
export const downloadLimitSeconds = error => Number.isSafeInteger(error?.retryAfterSeconds) && error.retryAfterSeconds > 0
  ? Math.min(error.retryAfterSeconds, 7 * 86_400) : null;
/** E91: "… You can download it again in about 23 hours." from the time the allowance frees up. */
export function downloadLimitMessage(until, now = Date.now()) {
  const base = messages['viewer-download-limit'];
  if (!Number.isFinite(until)) return base;
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  const hours = Math.round(minutes / 60);
  const wait = minutes < 60 ? `about ${minutes} minute${minutes === 1 ? '' : 's'}` : `about ${hours} hour${hours === 1 ? '' : 's'}`;
  return until <= now ? base.replace(' later.', ' now.') : base.replace(' later.', ` in ${wait}.`);
}
export const viewerLoadMessage = code => isViewerLoadCode(code) ? messages[code] : null;
/** The message with its code, for diagnostics and the developer panel only. Viewer
 * surfaces show the sentence; the code sits under "Details for support". */
export const viewerLoadReport = code => isViewerLoadCode(code) ? `${messages[code]} (Code: ${code})` : null;
