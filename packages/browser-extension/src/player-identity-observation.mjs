// E20 is diagnostic only: never use these values for playback or credential authority.
export const PLAYER_IDENTITY_FRESH_MS = 60_000;
export const PLAYER_IDENTITY_HEARTBEAT_MS = 30_000;
const states = new Set(['identified', 'missing-id', 'no-player', 'unknown']);
export const playerIdentityState = value => states.has(value) ? value : 'unknown';

export function freshPlayerIdentityObservation(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'observedAt,state' ||
      !states.has(value.state) || !Number.isFinite(value.observedAt) ||
      !Number.isFinite(now) || value.observedAt > now ||
      now - value.observedAt >= PLAYER_IDENTITY_FRESH_MS) return null;
  return { state: value.state, observedAt: value.observedAt };
}

// Reuse the controller's identity read. Local player/source references fence an
// asynchronous result; only the enum and observation time cross the local port.
export async function observePlayerIdentity({ getPlayer, getSource, readIdentity,
  usableIdentity, isClosed = () => false, now = () => Date.now() }) {
  const observedAt = now();
  let identity = null, state = 'unknown', player, source, probeSucceeded = false;
  // Diagnostic probe failures must not suppress the identity read used by the
  // existing playback snapshot.
  try {
    player = getPlayer(); source = getSource(); probeSucceeded = !isClosed();
  } catch {}
  let readSucceeded = false;
  try { identity = await readIdentity(); readSucceeded = true; } catch {}
  try {
    if (probeSucceeded && !isClosed() && player === getPlayer() && source === getSource()) {
      if (player === null) state = 'no-player';
      else if (player && readSucceeded) state = usableIdentity(identity) ? 'identified' : 'missing-id';
    }
  } catch {}
  return { identity, observation: { state, observedAt } };
}

// Construct each existing session request at dispatch time. No new network timer.
// An omitted provider preserves older-client wire behavior, including omission.
export function sessionCheckIn({ clientVersion, getPlayerIdentityState } = {}) {
  const body = { disconnect: false };
  if (typeof clientVersion === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(\.\d{1,4})?$/.test(clientVersion)) body.clientVersion = clientVersion;
  if (typeof getPlayerIdentityState === 'function') {
    try { body.playerIdentityState = playerIdentityState(getPlayerIdentityState()); }
    catch { body.playerIdentityState = 'unknown'; }
  }
  return body;
}
