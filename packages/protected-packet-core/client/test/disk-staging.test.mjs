import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDiskStaging } from '../disk-staging.mjs';

// Real temporary-disk adapter for the FileSystemDirectoryHandle subset. It
// exercises disk I/O and cleanup, not browser OPFS permissions/quota behavior.
import { directory } from './support/node-directory.mjs';

async function setup(t, options = {}) {
  const path = await mkdtemp(join(tmpdir(), 'protected-staging-test-')); t.after(() => rm(path, { recursive: true, force: true }));
  return { path, area: await createDiskStaging({ root: directory(path, options.failWrite), budgetBytes: 4096, ...options }) };
}

test('tentative bytes are inaccessible until commit and removed on disposal', async t => {
  const { path, area } = await setup(t); const sink = await area.createSink('object', 10, 3);
  await sink.write(new Uint8Array([1, 2, 3])); await assert.rejects(area.read('object'), /not-committed/);
  const blob = await sink.commit(); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await area.read('object')).size, 3); await area.abort(); assert.deepEqual(await readdir(path), []);
});

test('per-file and aggregate reservation bounds refuse before excess allocation', async t => {
  const { area } = await setup(t); const sink = await area.createSink('one', 4000, 3);
  await assert.rejects(area.createSink('two', 100), /reservation/); await assert.rejects(area.createSink('../escape', 1), /reservation/);
  await sink.write(new Uint8Array(3)); await sink.commit(); await area.abort();
});

test('short, oversized and duplicate objects cannot commit', async t => {
  const { area } = await setup(t); const sink = await area.createSink('one', 4, 4);
  await sink.write(new Uint8Array(3)); await assert.rejects(sink.commit(), /incomplete/);
  await assert.rejects(sink.write(new Uint8Array(2)), /byte-limit/); await assert.rejects(area.createSink('one', 1), /reservation/); await area.abort();
});

test('disk failure removes all owned job files', async t => {
  const { area, path } = await setup(t, { failWrite: true }); const sink = await area.createSink('one', 5);
  await assert.rejects(sink.write(new Uint8Array(3)), /disk-full/); await sink.abort(); assert.deepEqual(await readdir(path), []);
});

test('cancelled staging refuses reads/writes but still cleans its directory', async t => {
  const controller = new AbortController(); const { area, path } = await setup(t, { signal: controller.signal }); const sink = await area.createSink('one', 5);
  await sink.write(new Uint8Array(3)); controller.abort(); await assert.rejects(sink.commit(), /cancelled/); await area.abort(); assert.deepEqual(await readdir(path), []);
});

test('quota preflight refuses without creating a job directory', async t => {
  const path = await mkdtemp(join(tmpdir(), 'protected-quota-test-')); t.after(() => rm(path, { recursive: true, force: true }));
  await assert.rejects(createDiskStaging({ root: directory(path), budgetBytes: 10, estimate: async () => ({ quota: 10, usage: 5 }) }), /quota/); assert.deepEqual(await readdir(path), []);
});
