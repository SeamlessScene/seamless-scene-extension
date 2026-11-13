import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateAdapterCompatibility } from '../src/manifest-security.mjs';
import { EXECUTING_BUILD, BUILD_ID } from '../src/build-info.mjs';

// Regression (present since the 0.42.1 import): the Prime controller checked
// packet compatibility against its build id, a content hash in every built
// extension, so every renderer packet was refused as "Adapter mismatch".
// This scans the call site only; nothing is evaluated.
test('the Prime controller checks packet compatibility against the adapter version, never the build id', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/evaluateAdapterCompatibility\(([^,]+),/g)].map(match => match[1].trim());
  assert.deepEqual(calls, ['EXECUTING_BUILD.adapterVersion']);
  const range = { min_adapter_version: '0.42.0', max_adapter_version: '0.x', verified_at: '2026-09-23T00:00:00.000Z' };
  assert.equal(evaluateAdapterCompatibility(EXECUTING_BUILD.adapterVersion, range).ok, true);
  assert.equal(evaluateAdapterCompatibility(`sha256:${'a'.repeat(64)}`, range).ok, false, 'a build hash is not a version');
  assert.equal(BUILD_ID === null || !/^\d+\.\d+\.\d+$/.test(BUILD_ID), true);
});
