import { assertActive } from './operation-context.mjs';
import { jumpTargetMs } from './jump-target.mjs';

// Finish the old replacement's restoration before issuing another command:
// restoration owns native mute/play writes and may supersede a pending seek.
export async function navigateReplacement({ targetMs, commandAdapter, engine, scheduler, signal, assertCurrent = () => {} }) {
  const guard = () => { assertActive(signal); assertCurrent(); };
  guard();
  if (engine?.running && scheduler) {
    const paused = engine.localControllable ? engine.localPaused === true : commandAdapter.readState().paused;
    await scheduler.handleSeek(targetMs);
    guard();
    if (paused) await commandAdapter.pause(signal, undefined, { assertCurrent: guard });
  }
  guard();
  // Prime can defer a paused seek indefinitely. Warm only after replacement
  // recovery has removed its native-play guard; the command restores pause
  // and audio state before reporting the destination ready.
  return commandAdapter.seekToWithPlaybackWarmup(targetMs, 'navigate-replacement', { signal, assertCurrent: guard, settlePaused: true });
}

export function normalizePrerollMs(value, { fallbackMs = 5_000, maximumMs = 30_000 } = {}) {
  if (!Number.isFinite(value)) return fallbackMs;
  return Math.min(maximumMs, Math.max(0, Math.round(value)));
}

export function formatProgramTime(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new TypeError("A non-negative integer time is required");
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  const body = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

export function buildReplacementNavigationItems(packet, prerollMs = 5_000) {
  const normalizedPrerollMs = normalizePrerollMs(prerollMs);
  if (!Array.isArray(packet?.manifest?.segments)) throw new TypeError("A packet with segments is required");
  const scenes = packet.manifest.segments.map(segment => ({ type: segment.action, startMs: segment.trigger_time_ms, resumeMs: segment.resume_time_ms }));
  return Object.freeze(packet.manifest.segments.map((segment, index) => {
    if (!Number.isSafeInteger(segment.trigger_time_ms) || segment.trigger_time_ms < 0) {
      throw new TypeError("Each segment requires a non-negative integer trigger");
    }
    const targetMs = jumpTargetMs(scenes, index, normalizedPrerollMs);
    return Object.freeze({
      id: segment.segment_id,
      ordinal: index + 1,
      action: segment.action,
      triggerMs: segment.trigger_time_ms,
      resumeMs: segment.resume_time_ms,
      targetMs,
      triggerLabel: formatProgramTime(segment.trigger_time_ms),
      targetLabel: formatProgramTime(targetMs)
    });
  }));
}
