import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingEdits } from '../src/viewer-candidates.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { viewerView, chooserItems } from '../src/viewer-display.mjs';

const live = {
  serviceId: 'prime-video', activeItemId: 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185',
  mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2967368
};
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const playback = { state: 'idle', sourceKey: sourceKey(live) };
const kept = (n, patch = {}) => ({
  id: id(n), origin: 'website', transport: 'protected', availability: 'downloaded',
  version: '1', title: `Saved edit ${n}`,
  sourceKey: sourceKey({ ...live, runtimeMs: 2967000, versionTag: 'published', territory: 'US', plan: 'prime' }),
  ...patch
});

test('all kept editions remain candidates when Prime omits manifest qualifiers, not only the last choice', () => {
  const library = [kept(1), kept(2), kept(3)];
  const matches = matchingEdits(playback, library, null, { id: id(2), version: '1', disabled: true });
  assert.deepEqual(matches.map(x => x.id), library.map(x => x.id));
  assert.equal(viewerView({ playback, matches }).kind, 'choose');
  assert.equal(chooserItems(matches)[0].detail, 'checked when you watch');
  assert.doesNotMatch(chooserItems(matches)[0].name, /check compatibility/);
  assert.equal(matches[0].downloaded, true);
  assert.match(matches[0].title, /check compatibility/i);
});

test('same-title candidate hints never include catalog-only, missing or interrupted editions', () => {
  for (const availability of ['missing', 'interrupted', 'reimport-required', undefined]) {
    assert.deepEqual(matchingEdits(playback, [kept(1, { availability })]), [], String(availability));
  }
});

test('same-item hints reject other services, IDs and contradictory known source qualifiers', () => {
  for (const patch of [
    { serviceId: 'netflix' }, { activeItemId: 'another-item' }, { season: 2 }, { episode: 2 },
    { mediaType: 'movie' }
  ]) {
    assert.deepEqual(matchingEdits(playback, [kept(1, { sourceKey: sourceKey({ ...live, ...patch }) })]), [], JSON.stringify(patch));
  }
  for (const field of ['versionTag', 'territory', 'plan']) {
    const known = { ...playback, sourceKey: sourceKey({ ...live, [field]: 'actual' }) };
    assert.deepEqual(matchingEdits(known, [kept(1, { sourceKey: sourceKey({ ...live, [field]: 'different' }) })]), [], field);
  }
});

test('malformed source keys and nonprotected entries cannot gain same-item discovery', () => {
  for (const source of ['[]', '{}', 'not-json', JSON.stringify(['prime-video', live.activeItemId])]) {
    assert.deepEqual(matchingEdits(playback, [kept(1, { sourceKey: source })]), []);
  }
  assert.deepEqual(matchingEdits(playback, [kept(1, { origin: 'local' }), kept(2, { transport: 'catalog' })]), []);
  assert.deepEqual(matchingEdits({ ...playback, state: 'unavailable' }, [kept(1)]), []);
});

test('runtime differences are candidate hints with a check label, never compatibility confirmation', () => {
  const matches = matchingEdits(playback, [kept(1, { sourceKey: sourceKey({ ...live, runtimeMs: 3000000 }) })]);
  assert.equal(matches.length, 1);
  assert.match(matches[0].title, /check compatibility/i);
  assert.equal(matches[0].compatible, undefined);
});
