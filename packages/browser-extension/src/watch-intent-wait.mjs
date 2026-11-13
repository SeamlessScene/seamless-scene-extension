// "Watch this edit" opens the title tab first (inside the click) and records the
// intent a moment later, so the title page keeps asking for a short while
// instead of trusting its first answer.
export async function waitForWatchIntent(request, { attempts = 20, intervalMs = 500, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try { if ((await request())?.pending === true) return true; } catch {}
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return false;
}
