import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifestSchema } from '../src/manifest-security.mjs';
import { validateLocalUserEditPacket } from '../src/local-edit-packet.mjs';
import { fixtureManifest } from '../src/fixture-signed-manifest.mjs';

// Owner decision 2026-09-24: no legal gates. The rights block and the synthetic-media /
// likeness flags are optional; files that still carry them (every release so far) keep
// validating, so already-published edits keep playing.
const errors = result => (result.errors ?? []).map(e => e.path + ':' + e.code);
const base = () => structuredClone(fixtureManifest);

test('a manifest without a rights block validates', () => {
  const m = base(); delete m.rights;
  assert.deepEqual(errors(validateManifestSchema(m)), []);
});

test('a manifest without synthetic-media or likeness flags validates', () => {
  const m = base(); delete m.content.synthetic_media; delete m.content.real_person_likeness;
  assert.deepEqual(errors(validateManifestSchema(m)), []);
});

test('manifests that still carry the old rights block and flags keep validating', () => {
  assert.deepEqual(errors(validateManifestSchema(base())), []);
  const m = base(); m.rights = { classification: 'licensed', approval_reference: 'seamless-scene-catalog' };
  assert.deepEqual(errors(validateManifestSchema(m)), []);
});

test('a local edit packet needs no rights block', () => {
  const m = base(); delete m.rights; m.status = 'local-only'; m.signature = null;
  m.segments = m.segments.filter(s => s.action === 'REPLACE' || s.action === 'INSERT');
  const result = validateLocalUserEditPacket({ packet_schema_version: '1.0.0', packet_id: 'local-test', purpose: 'local-user-edit', manifest: m, asset_bindings: [] });
  assert.equal(errors(result).some(e => e.includes('rights')), false);
});
