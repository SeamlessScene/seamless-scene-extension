import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerWebBridge, WATCH_KIND } from '../src/viewer-web-bridge.mjs';

function bridge(service) {
  const listeners = [];
  const runtime = { onMessageExternal: { addListener: fn => listeners.push(fn) } };
  registerViewerWebBridge(runtime, { pairingOrigin: 'https://preview.seamlessscene.com' }, { service, permissions: { contains: async () => true } });
  return (message, sender) => new Promise(resolve => { if (listeners[0](message, sender, resolve) === false) {} });
}
const site = { url: 'https://preview.seamlessscene.com/edits/x', origin: 'https://preview.seamlessscene.com' };
const release = '50000000-0000-4000-8000-000000000301';

test('only the configured website may ask, and it gets setup state, a queued watch and progress', async () => {
  const intents = [];
  const call = bridge({ account: async () => 'linked', recordIntent: async id => { intents.push(id); return { job: { releaseId: id, state: 'queued', bytes: 0, total: 0 } }; }, job: id => ({ releaseId: id, state: 'downloading', bytes: 5, total: 10 }) });
  assert.deepEqual(await call({ kind: WATCH_KIND, op: 'status' }, { url: 'https://evil.example/' }), { ok: false, error: 'origin-refused' });
  assert.deepEqual(await call({ kind: WATCH_KIND, op: 'status' }, { url: 'https://preview.seamlessscene.com.evil.example/' }), { ok: false, error: 'origin-refused' });
  const status = await call({ kind: WATCH_KIND, op: 'status' }, site);
  assert.equal(status.ok, true); assert.equal(status.account, 'linked'); assert.equal(status.siteAccess, true); assert.equal(status.supportsWatch, true);
  assert.equal((await call({ kind: WATCH_KIND, op: 'watch', releaseId: 'not-a-release' }, site)).error, 'release-invalid');
  assert.equal((await call({ kind: WATCH_KIND, op: 'watch', releaseId: release, url: 'https://evil.example' }, site)).job.state, 'queued');
  assert.deepEqual(intents, [release], 'only the release id is used');
  assert.equal((await call({ kind: WATCH_KIND, op: 'job', releaseId: release }, site)).job.state, 'downloading');
});

test('status checks site access for the streaming host the website names, from the optional host list only', async () => {
  const asked = [], listeners = [];
  const runtime = { onMessageExternal: { addListener: fn => listeners.push(fn) } };
  registerViewerWebBridge(runtime, { pairingOrigin: 'https://preview.seamlessscene.com' }, { service: { account: async () => 'linked' },
    permissions: { contains: async ({ origins }) => { asked.push(origins[0]); return origins[0] === 'https://www.primevideo.com/*'; } } });
  const call = message => new Promise(resolve => listeners[0](message, site, resolve));
  assert.equal((await call({ kind: WATCH_KIND, op: 'status', host: 'www.primevideo.com' })).siteAccess, true);
  assert.equal((await call({ kind: WATCH_KIND, op: 'status', host: 'www.amazon.com' })).siteAccess, false);
  // No host (older website) keeps the previous check; an unknown host is never queried.
  assert.equal((await call({ kind: WATCH_KIND, op: 'status' })).siteAccess, false);
  assert.equal((await call({ kind: WATCH_KIND, op: 'status', host: 'evil.example' })).siteAccess, false);
  assert.deepEqual(asked, ['https://www.primevideo.com/*', 'https://www.amazon.com/*', 'https://www.amazon.com/*']);
});

test('a configured extra website origin may ask too; a mismatched sender origin may not', async () => {
  const listeners = [];
  const runtime = { onMessageExternal: { addListener: fn => listeners.push(fn) } };
  registerViewerWebBridge(runtime, { pairingOrigin: 'https://preview.seamlessscene.com', websiteOrigins: ['https://seamlessscene.com'] },
    { service: { account: async () => 'linked' }, permissions: { contains: async () => true } });
  const call = sender => new Promise(resolve => listeners[0]({ kind: WATCH_KIND, op: 'status' }, sender, resolve));
  assert.equal((await call({ url: 'https://seamlessscene.com/edits/x', origin: 'https://seamlessscene.com' })).ok, true);
  assert.equal((await call(site)).ok, true);
  assert.equal((await call({ url: 'https://seamlessscene.com/edits/x', origin: 'https://evil.example' })).error, 'origin-refused');
  assert.equal((await call({ url: 'https://www.seamlessscene.com/edits/x' })).error, 'origin-refused');
  assert.equal((await call({ url: 'http://seamlessscene.com/edits/x' })).error, 'origin-refused');
});
