import test from 'node:test';
import assert from 'node:assert/strict';
import { primeStreamingUrl } from '../src/viewer-model.mjs';

// Owner 2026-09-24: the Edits tab link opened primevideo.com and the edit did not load.
const gti = 'amzn1.dv.gti.af78695d-47f1-44d8-870f-18bcd85ceab4';
test('playback-ID links open on amazon.com', () => {
  assert.equal(primeStreamingUrl(`https://www.primevideo.com/detail/?gti=${gti}`), `https://www.amazon.com/gp/video/detail/${gti}`);
  assert.equal(primeStreamingUrl(`https://www.amazon.com/gp/video/detail/${gti}`), `https://www.amazon.com/gp/video/detail/${gti}`);
});
test('ASIN links stay on amazon.com and unsafe links are still refused', () => {
  assert.equal(primeStreamingUrl('https://www.amazon.com/gp/video/detail/B0486E72D6'), 'https://www.amazon.com/gp/video/detail/B0486E72D6');
  assert.equal(primeStreamingUrl('https://evil.example/gp/video/detail/B0486E72D6'), null);
});

test('allowing either Prime Video site grants both, so either address works', async () => {
  const { siteAccessOrigins } = await import('../src/viewer-model.mjs');
  const both = ['https://www.amazon.com/*', 'https://www.primevideo.com/*'];
  assert.deepEqual(siteAccessOrigins('https://www.amazon.com'), both);
  assert.deepEqual(siteAccessOrigins('https://www.primevideo.com'), both);
  assert.deepEqual(siteAccessOrigins('https://www.netflix.com'), ['https://www.netflix.com/*']);
});
