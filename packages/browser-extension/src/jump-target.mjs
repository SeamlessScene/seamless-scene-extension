// Where a scene jump lands: the lead-in before the scene, but never inside another scene.
// A lead-in that reached back into the previous replacement made the scheduler enter that
// scene part-way, which superseded the jump's own seek and reported a false failure
// (field testing 0.61.1, Rowan: scene 2 starts 250 ms after scene 1 resumes).
//
// scenes: [{ type, startMs, resumeMs }] in source order. The floor is the latest point an
// earlier scene leaves behind: its resume time, or just past an insertion point (landing on
// the point itself would play the insertion again).
export function jumpTargetMs(scenes, index, leadInMs) {
  const scene = scenes?.[index];
  if (!scene || !Number.isFinite(scene.startMs)) return null;
  let floor = 0;
  for (const [i, other] of scenes.entries()) {
    if (i === index || !(other?.startMs < scene.startMs)) continue;
    const end = other.type === 'INSERT' || !(other.resumeMs > other.startMs) ? other.startMs + 1 : other.resumeMs;
    if (end <= scene.startMs) floor = Math.max(floor, end);
  }
  return Math.max(floor, scene.startMs - Math.max(0, leadInMs));
}

/** A jump whose seek was superseded because playback entered a scene there: the player went
 * where it was sent, so the jump succeeded. Any other error, or an abort with no scene entered,
 * is still a failure. */
export function supersededByEntry(error, scheduler, engine) {
  if (error?.name !== 'AbortError' || !scheduler) return false;
  return Boolean(scheduler.snapshot?.().runningActionId || scheduler.immediateEntry || engine?.running);
}
