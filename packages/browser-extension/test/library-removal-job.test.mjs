import test from 'node:test';
import assert from 'node:assert/strict';
import { A, until, harness } from './helpers/download-harness.mjs';

// E94 (0.66.1, extension half): an edit removed from the Library while no Prime tab is open is
// removed by the page through the vault; its 'ready' download job must not outlive it, or the
// website's edit page (op 'job') keeps saying Ready.

test('E94: removing an edit ends its job even when no Prime tab can remove the files (the Library then removes them itself)', async t => {
  const h = await harness(t);
  const port = h.renderer(1);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'acquisition');
  h.finish(h.acquireCalls()[0][0], A);
  await until(() => h.service.job(A)?.state === 'ready', 'ready');
  port.disconnect();
  const reply = await h.send('edits-remove', { releaseId: A }, h.settings);
  assert.equal(reply.ok, false); assert.equal(reply.code, 'viewer-no-owner', 'the page falls back to the vault itself');
  assert.equal(h.service.job(A), null, 'the website’s status query no longer says Ready');
});
