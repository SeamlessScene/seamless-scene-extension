import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { A, until, harness } from './helpers/download-harness.mjs';

// E93 (0.66.1, 11-05 store test): a removed edit downloaded again (through a load) showed a rate
// measured from the first download (253 B/s - 3 KB/s for ~48 KB/s) and got no download log row.

test('E93: a removed edit loaded again starts a new rate and is logged as its own download', async t => {
  const h = await harness(t, { downloadTiming: { stallMs: 10_000, tickMs: 1_000 } });
  const port = h.renderer(1);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'acquisition');
  const [tab] = h.acquireCalls()[0];
  h.progress(tab, A, { state: 'downloading', bytes: 0, total: 2_000_000 });
  await new Promise(r => setTimeout(r, 1_050));
  h.progress(tab, A, { state: 'downloading', bytes: 2_000_000, total: 2_000_000 });
  h.finish(tab, A);
  await until(async () => (await h.job(A))?.state === 'ready', 'first download ready');
  assert.equal((await h.snapshot()).downloadStats.length, 1);
  // Later the edit is gone from the vault, and Watch with edit loads it: the load downloads it again.
  await new Promise(r => setTimeout(r, 600));
  const load = p => port.onMessage.emit({ progress: { releaseId: A, operation: 'load', ...p }, build: EXECUTING_BUILD });
  load({ state: 'restoring', bytes: 0, total: 0 });
  assert.equal((await h.job(A)).bytesPerSecond, undefined, 'the first download’s rate is not shown for the new one');
  load({ state: 'downloading', bytes: 100_000, total: 2_000_000 });
  await new Promise(r => setTimeout(r, 1_050));
  load({ state: 'downloading', bytes: 1_100_000, total: 2_000_000 });
  const rate = (await h.job(A)).bytesPerSecond;
  // From this acquisition's own start: ~1 MB/s (less on a busy machine). The 0.66.0 rate divided by the
  // time since the first download (~0.4 MB/s here).
  assert.ok(rate > 600_000 && rate <= 1_000_000, `rate ${rate}`);
  load({ state: 'ready', bytes: 0, total: 0 });
  await until(async () => (await h.snapshot()).downloadStats.length === 2, 'the re-download has its own log row');
  const row = (await h.snapshot()).downloadStats[1];
  assert.equal(row.bytes, 2_000_000); assert.ok(row.ms >= 1_000 && row.ms < 2_400, `ms ${row.ms}`);
  // A load of an edit that is still kept downloads nothing and logs nothing.
  load({ state: 'restoring', bytes: 0, total: 0 }); load({ state: 'licensing', bytes: 0, total: 0 }); load({ state: 'ready', bytes: 0, total: 0 });
  await new Promise(r => setTimeout(r, 30));
  assert.equal((await h.snapshot()).downloadStats.length, 2);
});
