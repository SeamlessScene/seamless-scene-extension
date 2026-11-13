import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceCompatibility } from '../src/source-identity.mjs';

// Desktop 2026-09-24: arming a catalog Prime edit failed ("could not be verified").
// Prime never reports version tag, territory or plan (prime-identity-reader.mjs), but
// catalog releases always name them, so the check returned "unknown" and refused.
const gti = 'amzn1.dv.gti.af78695d-47f1-44d8-870f-18bcd85ceab4';
const expected = { serviceId: 'prime-video', serviceContentId: gti, runtimeMs: 3426621, runtimeToleranceMs: 1000,
  mediaType: 'episode', season: 1, episode: 1, versionTag: 'creator-reported', territory: 'US', plan: 'ad-free' };
const primeObserved = { serviceId: 'prime-video', activeItemId: gti, runtimeMs: 3426621, mediaType: 'episode', season: 1, episode: 1,
  versionTag: null, territory: null, plan: null };

test('a catalog edit is compatible when Prime cannot report version tag, territory or plan', () => {
  assert.deepEqual(evaluateSourceCompatibility(primeObserved, expected), { status: 'compatible', reason: 'all-required-signals-match' });
});

test('an observed but different territory or plan still refuses', () => {
  assert.equal(evaluateSourceCompatibility({ ...primeObserved, territory: 'GB' }, expected).reason, 'territory-mismatch');
  assert.equal(evaluateSourceCompatibility({ ...primeObserved, plan: 'ad-supported' }, expected).reason, 'plan-mismatch');
});

test('the playback ID, runtime and episode stay required', () => {
  assert.equal(evaluateSourceCompatibility({ ...primeObserved, activeItemId: 'amzn1.dv.gti.other' }, expected).reason, 'active-item-mismatch');
  assert.equal(evaluateSourceCompatibility({ ...primeObserved, runtimeMs: 3000000 }, expected).reason, 'runtime-mismatch');
  assert.equal(evaluateSourceCompatibility({ ...primeObserved, episode: null }, expected).status, 'unknown');
});
