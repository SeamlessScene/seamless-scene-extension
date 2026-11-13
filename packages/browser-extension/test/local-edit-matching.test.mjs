import test from 'node:test';
import assert from 'node:assert/strict';
import { localEditMatches } from '../src/viewer-candidates.mjs';
import { sourceKey } from '../src/viewer-model.mjs';

// A private packet as the website builder writes it (creator-source.ts): Prime
// never reports version tag, territory or plan, but the builder fills them in.
const gti = 'amzn1.dv.gti.6f8806ab-7072-49f0-896d-ba3cefd52c64';
const builderSource = { service: 'prime-video', service_content_id: gti, title: 'Lighthouse', season: 1, episode: 2,
  expected_runtime_ms: 2998000, runtime_tolerance_ms: 1000, version_tag: 'creator-reported', territory: 'US', service_tier: 'ad-free' };
// The local index row's matching fields, as local-library.mjs localRow() records them.
const summary = (source = builderSource) => ({ name: 'My cut', runtimeToleranceMs: source.runtime_tolerance_ms,
  sourceKey: sourceKey({ serviceId: source.service, activeItemId: source.service_content_id, mediaType: source.episode === null ? 'movie' : 'episode',
    season: source.season, episode: source.episode, runtimeMs: source.expected_runtime_ms, versionTag: source.version_tag, territory: source.territory, plan: source.service_tier }) });
// The key the Prime controller reports for the playing episode (prime-identity-reader: null qualifiers).
const live = (changes = {}) => sourceKey({ serviceId: 'prime-video', activeItemId: gti, mediaType: 'episode', season: 1, episode: 2,
  runtimeMs: 2998000, versionTag: null, territory: null, plan: null, ...changes });

test('builder private packet matches the playing Prime episode despite qualifiers Prime does not report', () => {
  const saved = summary();
  assert.notEqual(saved.sourceKey, live(), 'precondition: the keys are not byte-equal');
  assert.equal(saved.runtimeToleranceMs, 1000);
  assert.equal(localEditMatches(live(), saved), true);
  assert.equal(localEditMatches(live({ runtimeMs: 2998000 + 1000 }), saved), true, 'runtime inside the packet tolerance');
  assert.equal(localEditMatches(live({ runtimeMs: 2998000 - 640 }), saved), true);
  // Known qualifiers that agree are fine too.
  assert.equal(localEditMatches(live({ territory: 'US', plan: 'ad-free', versionTag: 'creator-reported' }), saved), true);
  // A packet that leaves a qualifier empty makes no claim about it.
  assert.equal(localEditMatches(live({ territory: 'GB' }), summary({ ...builderSource, territory: null })), true);
  // Exact keys (older summaries, non-JSON fixture keys) still match.
  assert.equal(localEditMatches('exact-source', { sourceKey: 'exact-source' }), true);
});

test('a packet for a different episode, season, title, service, media type or runtime is not offered', () => {
  const saved = summary();
  for (const [label, key] of [
    ['episode', live({ episode: 3 })], ['season', live({ season: 2 })],
    ['GTI', live({ activeItemId: 'amzn1.dv.gti.70797734-4d97-4fed-8003-17a3e30a451a' })],
    ['service', live({ serviceId: 'other-service' })], ['media type', live({ mediaType: 'movie', season: null, episode: null })],
    ['runtime beyond the 2.5 s floor', live({ runtimeMs: 2998000 + 2501 })], ['much shorter runtime', live({ runtimeMs: 2600000 })],
    ['episode not reported', live({ season: null, episode: null })]
  ]) assert.equal(localEditMatches(key, saved), false, label);
  // A summary saved before the tolerance was recorded gets the same 2.5 s floor as every source
  // check: Prime's reported runtime drifts by about a second between sessions (0.62.2).
  const { runtimeToleranceMs, ...legacy } = saved;
  assert.equal(runtimeToleranceMs, 1000);
  assert.equal(localEditMatches(live(), legacy), true);
  assert.equal(localEditMatches(live({ runtimeMs: 2998000 - 1032 }), legacy), true);
  assert.equal(localEditMatches(live({ runtimeMs: 2998000 + 2501 }), legacy), false);
  for (const bad of [null, {}, { sourceKey: 'not json' }, { sourceKey: '[1,2]' }]) assert.equal(localEditMatches(live(), bad), false);
  assert.equal(localEditMatches('', saved), false); assert.equal(localEditMatches(null, saved), false);
});

test('a known live qualifier that contradicts the packet still refuses the match', () => {
  const saved = summary();
  for (const [label, key] of [['territory', live({ territory: 'GB' })], ['plan', live({ plan: 'with-ads' })],
    ['version tag', live({ versionTag: 'extended' })]]) assert.equal(localEditMatches(key, saved), false, label);
});
