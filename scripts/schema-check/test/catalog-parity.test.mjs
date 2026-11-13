import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogSchemas } from '../catalog-schemas.mjs';
import { fixtureManifest } from '../../../packages/browser-extension/src/fixture-signed-manifest.mjs';
import { validateManifestSchema } from '../../../packages/browser-extension/src/manifest-security.mjs';
import { validateCatalogPacket } from '../../../packages/browser-extension/src/catalog-packet.mjs';
import { catalogObservedSource } from '../../../packages/browser-extension/src/catalog-runtime-service.mjs';
import { key, packet } from '../../../packages/browser-extension/test/support/catalog-fixture.mjs';

const schemas = await loadCatalogSchemas(), catalog = packet(key(), { media: true });
const contracts = [
  { name: 'manifest-v1', value: fixtureManifest, runtime: value => validateManifestSchema(value) },
  { name: 'manifest-v2', value: catalog.manifest, runtime: value => validateManifestSchema(value, { profileClass: 'catalog-v2' }) },
  { name: 'catalog-packet-v2', value: catalog, runtime: validateCatalogPacket }
];
function replace(value, path, replacement, remove = false) {
  const copy = structuredClone(value); let parent = copy;
  for (const item of path.slice(0, -1)) parent = parent[item];
  if (remove) delete parent[path.at(-1)]; else parent[path.at(-1)] = replacement;
  return copy;
}
function paths(value, prefix = []) {
  const result = [prefix];
  if (value && typeof value === 'object') {
    for (const name of Object.keys(value)) result.push(...paths(value[name], [...prefix, name]));
  }
  return result;
}
function at(value, keys) { return keys.reduce((parent, key) => parent[key], value); }

test('checked-in catalog schemas compile strictly and baseline documents agree with runtime structural checks', () => {
  for (const contract of contracts) {
    assert.equal(schemas[contract.name](contract.value), true, JSON.stringify(schemas[contract.name].errors));
    assert.equal(contract.runtime(contract.value).ok, true, contract.name);
  }
});

test('runtime cannot admit schema-invalid types, missing fields or extra fields in any catalog object', t => {
  const failures = []; let refusals = 0;
  for (const { name, value, runtime } of contracts) {
    const variants = [{ label: 'root-null', value: null }, { label: 'root-array', value: [] }];
    for (const field of paths(value).filter(path => path.length)) {
      const current = at(value, field);
      for (const candidate of [null, 0, true, '', [], {}, [current]]) variants.push({ label: `${field.join('.')}:${JSON.stringify(candidate)}`, value: replace(value, field, candidate) });
      if (!Array.isArray(at(value, field.slice(0, -1)))) variants.push({ label: `${field.join('.')}:missing`, value: replace(value, field, null, true) });
      if (current && typeof current === 'object' && !Array.isArray(current)) variants.push({ label: `${field.join('.')}:extra`, value: replace(value, field, { ...current, unexpected: true }) });
    }
    variants.push({ label: 'root-extra', value: { ...value, unexpected: true } });
    for (const variant of variants) {
      if (schemas[name](variant.value)) continue; // Cross-field semantics are tested separately below.
      refusals++;
      try { if (runtime(variant.value).ok) failures.push(`${name}:${variant.label}`); }
      catch (error) { failures.push(`${name}:${variant.label}:threw ${error.message}`); }
    }
  }
  assert.ok(refusals > 1000);
  t.diagnostic(`${refusals} schema-invalid document mutations compared across three contracts`);
  assert.deepEqual(failures, []);
});

test('v2 valid boundaries include movie/special coordinates, Unicode text, source-sized and two-minute assets', () => {
  const variants = [];
  const add = change => { const value = structuredClone(catalog); change(value); variants.push(value); };
  add(p => { p.manifest.source.season = p.manifest.source.episode = null; });
  add(p => { p.manifest.source.season = p.manifest.source.episode = 0; });
  add(p => { p.manifest.content.warnings = ['🎬'.repeat(128)]; p.manifest.source.title = '🎬'.repeat(256); });
  for (const duration of [5000, 60000, 90000, 120000]) for (const [width, height] of [[320, 180], [624, 480], [4096, 2160]]) {
    add(p => { Object.assign(p.manifest.segments[0].asset, { expected_duration_ms: duration, width, height }); });
  }
  for (const value of variants) {
    assert.equal(schemas['catalog-packet-v2'](value), true);
    assert.equal(validateCatalogPacket(value).ok, true, JSON.stringify(validateCatalogPacket(value)));
    assert.equal(validateManifestSchema(value.manifest).ok, false, 'Legacy must continue refusing v2');
  }
});

test('schema types are necessary but runtime also enforces timeline, source and binding relationships', () => {
  const cases = [
    ['paired episode coordinates', p => { p.manifest.source.season = null; }],
    ['runtime ceiling', p => { p.manifest.segments[0].trigger_time_ms = p.manifest.segments[0].resume_time_ms = 30000; }],
    ['equal insertion anchor', p => { p.manifest.segments[0].resume_time_ms++; }],
    ['duplicate anchor and segment', p => { p.manifest.segments.push(structuredClone(p.manifest.segments[0])); }],
    ['enabled action', p => { p.manifest.feature_flags.insert_enabled = false; }],
    ['version range', p => { p.manifest.compatibility.min_adapter_version = '1.0.0'; }],
    ['missing bound asset', p => { p.asset_bindings = []; }],
    ['case duplicate path', p => { p.asset_bindings.push({ ...p.asset_bindings[0], relative_path: 'PRIVATE-NAME.mp4' }); }],
    ['Windows reserved filename', p => { p.asset_bindings[0].relative_path = 'con.mp4'; }],
    ['minimum v2 client', p => { p.required_client_version = '0.41.0'; }]
  ];
  for (const [label, change] of cases) {
    const value = structuredClone(catalog); change(value);
    assert.equal(schemas['catalog-packet-v2'](value), true, `${label} is intentionally a runtime relationship`);
    assert.equal(validateCatalogPacket(value).ok, false, label);
  }
});

test('declared date-time format rejects a date-only string before signature verification', () => {
  const value = structuredClone(catalog); value.manifest.compatibility.verified_at = '2026-09-06';
  assert.equal(schemas['catalog-packet-v2'](value), false);
  assert.equal(validateCatalogPacket(value).ok, false);
});

test('calendar dates, explicit zones and leap-second boundaries agree across schema and runtime', () => {
  const valid = ['2024-02-29T12:30:00Z', '2026-09-06t23:01:02.123z', '2026-09-06T12:30:01-06:00', '2016-12-31T23:59:60Z', '2017-01-01T00:59:60+01:00'];
  const invalid = ['2026-02-29T12:30:00Z', '2026-04-31T12:30:00Z', '2026-09-06T24:00:00Z',
    '2026-09-06 12:30:00Z', '2026-09-06T12:30:00', '2026-09-06T12:30:00+0600', '2026-09-06T12:30:00+06',
    '2026-09-06T12:60:00Z', '2026-09-06T12:30:60Z', '2026-09-06T12:30:00+24:00'];
  for (const [expected, dates] of [[true, valid], [false, invalid]]) for (const date of dates) for (const contract of contracts) {
    const value = structuredClone(contract.value), manifest = value.manifest ?? value;
    manifest.compatibility.verified_at = date;
    assert.equal(schemas[contract.name](value), expected, `${contract.name}:${date}:schema`);
    assert.equal(contract.runtime(value).ok, expected, `${contract.name}:${date}:runtime`);
  }
});

test('non-array segments cannot supply a forged loop length and source RPC preserves schema-valid Unicode', () => {
  const value = structuredClone(catalog); value.manifest.segments = { length: 10000000000 };
  assert.equal(validateCatalogPacket(value).ok, false);
  assert.equal(schemas['catalog-packet-v2'](value), false);
  assert.equal(catalogObservedSource({ activeItemId: '🎬'.repeat(256) }).activeItemId, '🎬'.repeat(256));
  assert.throws(() => catalogObservedSource({ activeItemId: '🎬'.repeat(257) }), /catalog-source-invalid/);
});
