import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerLoadCode, downloadFailureCode, downloadLimitMessage, downloadLimitSeconds, viewerLoadMessage } from '../src/viewer-load-error.mjs';
import { loadStatusMessage } from '../src/viewer-load-status.mjs';
import { downloadRows } from '../src/edits-model.mjs';
import { viewerView } from '../src/viewer-display.mjs';
import { A, until, harness } from './helpers/download-harness.mjs';

// E91 (0.66.1, 11-05 store test): the server refuses a 4th copy of an edit within 24 hours with
// 403 PROTECTED_DOWNLOAD_LIMIT. The viewer is told so, with the wait, instead of "cannot open this
// edit on this device" (which suggested the edit was withdrawn).

test('E91: the download-limit refusal has its own code and a message with the wait', () => {
  assert.equal(viewerLoadCode(Error('protected-download-limit'), 'protected'), 'viewer-download-limit');
  assert.equal(downloadFailureCode(Error('protected-download-limit')), 'viewer-download-limit');
  assert.equal(downloadFailureCode(Error('protected-access-refused')), 'viewer-access-refused', 'any other refusal is unchanged');
  const now = 1_000_000_000;
  assert.equal(downloadLimitMessage(now + 82_800_000, now), 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again in about 23 hours.');
  assert.equal(downloadLimitMessage(now + 3_600_000, now), 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again in about 1 hour.');
  assert.equal(downloadLimitMessage(now + 25 * 60_000, now), 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again in about 25 minutes.');
  assert.equal(downloadLimitMessage(now + 10_000, now), 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again in about 1 minute.');
  assert.equal(downloadLimitMessage(now - 1, now), 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again now.');
  assert.equal(downloadLimitMessage(undefined), viewerLoadMessage('viewer-download-limit'));
  assert.match(viewerLoadMessage('viewer-download-limit'), /again later\.$/);
  assert.equal(downloadLimitSeconds(Object.assign(Error('protected-download-limit'), { retryAfterSeconds: 82800 })), 82800);
  for (const bad of [undefined, 0, -1, 1.5, '3600', Infinity]) assert.equal(downloadLimitSeconds({ retryAfterSeconds: bad }), null, String(bad));
  assert.equal(downloadLimitSeconds({ retryAfterSeconds: 1e9 }), 7 * 86_400);
});

test('E91: a limited download fails with the wait in the popup, the Library row and the player panel; other failures are unchanged', async t => {
  const h = await harness(t);
  h.renderer(1);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'acquisition');
  const [tab] = h.acquireCalls()[0], before = Date.now();
  h.progress(tab, A, { state: 'failed:viewer-download-limit', bytes: 0, total: 0, cause: 'protected-download-limit', retryAfterSeconds: 82_800 });
  h.acquires.get(`${tab}|${A}`).reject(Error('viewer-download-limit'));
  await until(async () => (await h.job(A))?.state === 'failed', 'failed');
  const job = await h.job(A);
  assert.equal(job.error, 'viewer-download-limit');
  assert.ok(job.limitUntil >= before + 82_800_000 && job.limitUntil <= Date.now() + 82_800_000, 'an absolute time from the server’s wait');
  const sentence = 'You’ve downloaded this edit 3 times in the last 24 hours. You can download it again in about 23 hours.';
  assert.equal(loadStatusMessage(job), sentence);
  assert.equal((await h.snapshot()).downloads.find(d => d.releaseId === A).limitUntil, job.limitUntil, 'the popup’s Downloads card gets it');
  assert.equal(downloadRows({ jobs: [job] })[0].status.label, sentence, 'the Library’s download row');
  assert.deepEqual(downloadRows({ jobs: [job] })[0].actions, ['retry', 'clear']);
  const view = viewerView({ playback: { state: 'idle' }, load: { ...job, failedAt: Date.now() } });
  assert.equal(view.kind, 'problem'); assert.equal(view.problem.sentence, sentence); assert.equal(view.popupSub, sentence);
  assert.doesNotMatch(view.problem.sentence, /withdrawn|cannot open this edit on this device/);
  assert.equal(h.service.job(A).error, 'viewer-download-limit', 'the website’s job reports the limit, not a refusal');
});

test('E91: an unusable wait is ignored (the message says "later"), and a limit wait is never accepted on other states', async t => {
  const h = await harness(t);
  h.renderer(1);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'acquisition');
  const [tab] = h.acquireCalls()[0];
  h.progress(tab, A, { state: 'downloading', bytes: 5, total: 10, retryAfterSeconds: 60 });
  assert.equal((await h.job(A)).limitUntil, undefined);
  h.progress(tab, A, { state: 'failed:viewer-download-limit', bytes: 0, total: 0, retryAfterSeconds: 1e12 });
  await until(async () => (await h.job(A))?.state === 'failed', 'failed');
  const job = await h.job(A);
  assert.equal(job.limitUntil, undefined);
  assert.match(loadStatusMessage(job), /You can download it again later\.$/);
});
