import test from 'node:test';
import assert from 'node:assert/strict';
import { readEditJson } from '../src/ss-normalize.mjs';
import { editPackSchema } from '../src/edit-pack-fields.mjs';
import { episodeDetails } from '../src/viewer-display.mjs';

// 0.64.3 / website r39 (joint schema revision): territory, tier and runtime_tolerance_ms are checked
// and an invalid value is reported, never kept or replaced. Website r38 found "tier": "prime-video".
const EPISODE = { gti: 'amzn1.dv.gti.4a8535a2-1dac-42fe-8783-3101673b0f08', show: 'Deep Current', season: 1, episode: 2, runtime_ms: 3_047_656 };
const edit = episode => ({ id: 'tier-check', episode: { ...EPISODE, ...episode }, scenes: [{ action: 'REPLACE', start: 300_000, end: 302_000, clip: 'clips/a.mp4' }] });
const entries = new Map([['clips/a.mp4', {}]]);
const errorsOf = episode => { try { readEditJson(edit(episode), entries); return []; } catch (error) { return error.errors ?? [error.message]; } };

test('episode facts: invalid tier, territory and tolerance are reported by field, in the website\'s order', () => {
  assert.deepEqual(errorsOf({ tier: 'prime-video' }), ['episode.tier must be "ad-free" or "ad-supported" or "unverified"']);
  assert.deepEqual(errorsOf({ territory: 'usa' }), ['episode.territory must be a two-letter country code, such as US']);
  assert.deepEqual(errorsOf({ runtime_tolerance_ms: 6000 }), ['episode.runtime_tolerance_ms must be 0–5000']);
  assert.deepEqual(errorsOf({ runtime_tolerance_ms: 6000, territory: 'us', tier: 'free', service: 'netflix' }), [
    'episode.runtime_tolerance_ms must be 0–5000', 'episode.territory must be a two-letter country code, such as US',
    'episode.tier must be "ad-free" or "ad-supported" or "unverified"', 'episode.service must be "prime-video"']);
  for (const ok of [{}, { tier: 'ad-supported', territory: 'GB', runtime_tolerance_ms: 5000 }, { tier: 'ad-free', runtime_tolerance_ms: 0 }]) assert.deepEqual(errorsOf(ok), [], JSON.stringify(ok));
});

test('absent facts keep their defaults (3000 ms); an absent tier is unverified (0.65.4) and an absent territory ZZ, unknown (0.65.5); valid ones are kept as given', () => {
  const { source } = readEditJson(edit({}), entries);
  assert.deepEqual([source.territory, source.service_tier, source.runtime_tolerance_ms], ['ZZ', 'unverified', 3000]);
  const given = readEditJson(edit({ territory: 'GB', tier: 'ad-supported', runtime_tolerance_ms: 5000 }), entries).source;
  assert.deepEqual([given.territory, given.service_tier, given.runtime_tolerance_ms], ['GB', 'ad-supported', 5000]);
  const schema = editPackSchema().properties.episode.properties;
  assert.deepEqual(schema.tier, { enum: ['ad-free', 'ad-supported', 'unverified'] });
  assert.deepEqual(schema.territory, { type: 'string', pattern: '^[A-Z]{2}$' });
  assert.deepEqual(schema.runtime_tolerance_ms, { type: 'integer', minimum: 0, maximum: 5000 });
});

test('Copy episode details never emits a territory or tier (so never an invalid one), and whole ms', () => {
  const playback = { title: 'Watch Deep Current | Prime Video', show: { title: 'Deep Current', season: 1, episode: 2 },
    sourceKey: JSON.stringify(['prime-video', EPISODE.gti, 'episode', 1, 2, 3047656.7, 'x', 'usa', 'prime-video']) };
  const block = episodeDetails(playback);
  assert.equal('tier' in block || 'territory' in block || 'runtime_tolerance_ms' in block, false);
  assert.equal(block.runtime_ms, 3047657);
  assert.deepEqual(errorsOf({ ...block }), []);
});
