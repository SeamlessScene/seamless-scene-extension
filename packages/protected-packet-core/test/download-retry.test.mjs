import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';
import { FORMAT, PROFILE, signDescriptor, verifyDescriptor, descriptorToken, requireDescriptor } from '../src/contract.mjs';
import { newContentKey, encryptObject } from '../src/files.mjs';
import { createProtectedWebsiteClient, retryAfterMs } from '../client/website-client.mjs';
import { createDiskStaging } from '../client/disk-staging.mjs';

// E61 (0.62.20): per-object download retries that resume with HTTP Range from the bytes
// already staged, falling back to a restart when the server ignores the range.
const keys = await generateKeyPair('EdDSA');
const trusted = new Map([['publisher', { key: keys.publicKey, status: 'active' }]]);
const releaseId = '50000000-0000-4000-8000-000000000001';
const origin = 'https://license.invalid';
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function release(sizes = [300_000, 200_000]) {
  const context = { format: FORMAT, release_id: releaseId, key_access: 'platform-key', publication: 'reviewed-catalog-v2', crypto_profile: PROFILE, required_capabilities: [PROFILE, 'platform-key'] };
  const objects = [], bodies = new Map();
  for (const [i, size] of sizes.entries()) {
    const objectId = i === 0 ? 'packet' : `clip-${i}`;
    const encrypted = await encryptObject(new Blob([new Uint8Array(size).fill(i + 1)]), await newContentKey(), { ...context, object_id: objectId, kind: i === 0 ? 'packet' : 'media' });
    objects.push(encrypted.binding); bodies.set(objectId, new Uint8Array(await (encrypted.blob ?? encrypted.ciphertext).arrayBuffer()));
  }
  const token = await signDescriptor({ ...context, objects }, keys.privateKey, 'publisher');
  const descriptor = await verifyDescriptor(token, trusted);
  return { descriptor, bodies, token: descriptorToken(descriptor) };
}

// A memory origin-private file system whose writable streams support truncate/seek.
// writeDelayMs makes every write slow (a busy disk); writes are recorded.
function memoryDirectory({ writeDelayMs = 0, writes = [] } = {}) {
  const children = new Map();
  const notFound = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
  return {
    async getDirectoryHandle(child, { create = false } = {}) { let d = children.get(child); if (!d) { if (!create) throw notFound(); d = memoryDirectory({ writeDelayMs, writes }); children.set(child, d); } return d; },
    async getFileHandle(child, { create = false } = {}) {
      let f = children.get(child);
      if (!f) {
        if (!create) throw notFound();
        f = { data: new Uint8Array(0), async getFile() { return new Blob([this.data]); },
          async createWritable() {
            const file = this; let buffer = new Uint8Array(0), position = 0;
            return { async write(value) { if (writeDelayMs) await new Promise(r => setTimeout(r, writeDelayMs)); writes.push({ at: performance.now(), bytes: value.length }); const next = new Uint8Array(Math.max(buffer.length, position + value.length)); next.set(buffer); next.set(value, position); buffer = next; position += value.length; },
              async truncate(size) { buffer = buffer.slice(0, size); if (position > size) position = size; }, async seek(at) { position = at; },
              async close() { file.data = buffer; }, async abort() {} };
          } };
        children.set(child, f);
      }
      return f;
    },
    async removeEntry(child) { if (!children.delete(child)) throw notFound(); }
  };
}

// The fake server: `plan(objectId, attempt, rangeStart)` decides each object response.
function server(r, plan, { rejectRange = false, chunkDelayMs = 0, etags = false, quota = Infinity } = {}) {
  let gets = 0;
  const calls = [], reject = new Set(rejectRange ? r.bodies.keys() : []);
  const reads = [];
  const fetchImpl = async (url, init) => {
    const headers = new Headers({ 'cache-control': 'no-store' });
    if (url.endsWith('/descriptor')) { gets += 1; return new Response(r.token, { status: 200, headers }); }
    const objectId = url.split('/objects/')[1], body = r.bodies.get(objectId);
    const range = init.headers?.Range ?? null, start = range ? Number(/^bytes=(\d+)-$/.exec(range)[1]) : 0;
    const attempt = calls.filter(c => c.objectId === objectId).length + 1;
    calls.push({ objectId, attempt, range, ifRange: init.headers?.['If-Range'] ?? null });
    // The deployed read quota answers 403 once an account exceeds its GETs per window.
    if ((gets += 1) > quota) return new Response('x', { status: 403, headers });
    if (etags) headers.set('etag', `"${objectId}-v1"`);
    const decision = plan(objectId, attempt, start) ?? 'ok';
    if (decision === 'status-503') return new Response('x', { status: 503, headers });
    if (decision === 'rate-limited') { headers.set('retry-after', '0'); return new Response('x', { status: 429, headers }); }
    // The deployed object route (2026-10): 400 for any Range header, no Content-Length.
    if (range && reject.has(objectId)) return new Response('x', { status: 400, headers });
    const honour = decision !== 'ignore-range' && start > 0;
    const slice = honour ? body.subarray(start) : body;
    const cut = decision === 'drop-half' ? Math.floor(slice.length / 2) : slice.length;
    if (honour) headers.set('content-range', `bytes ${start}-${body.length - 1}/${body.length}`);
    let at = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (chunkDelayMs) return new Promise(resolve => setTimeout(resolve, chunkDelayMs)).then(() => next(controller));
      return next(controller);
    }, cancel() {} }), { status: honour ? 206 : 200, headers });
    function next(controller) {
      if (at < cut) { controller.enqueue(slice.slice(at, Math.min(cut, at + 65_536))); at += 65_536; reads.push(performance.now()); return; }
      if (decision === 'drop-half') controller.error(new TypeError('network connection lost')); else controller.close();
    }
  };
  return { calls, reads, fetchImpl };
}
const session = { accountId: id(2), pairingId: id(3), accessToken: 'dummy-test-token', expiresAt: Date.now() + 3_600_000 };
const client = (fetchImpl, options = {}) => createProtectedWebsiteClient({ retryBackoffMs: 5, ...options, origin, issuer: origin, descriptorTrust: trusted, licenseTrust: new Map(),
  getCredentials: async () => ({ ...session }),
  getInstallation: async () => { throw Error('unused'); }, fetchImpl });
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());

test('E61: a dropped connection resumes the object with HTTP Range from the staged bytes; progress never double counts', async () => {
  const r = await release(), s = server(r, (objectId, attempt) => objectId === 'clip-1' && attempt === 1 ? 'drop-half' : 'ok');
  const area = await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 });
  const retries = [], progress = [];
  const running = client(s.fetchImpl).acquire(releaseId, { staging: area, onRetry: info => retries.push(info), onProgress: (n, total) => progress.push([n, total]) });
  const acquired = await running;
  const clip = s.calls.filter(c => c.objectId === 'clip-1');
  assert.equal(clip.length, 2); assert.match(clip[1].range, /^bytes=\d+-$/, 'the retry asked for the rest');
  assert.equal(retries.length, 1); assert.equal(retries[0].code, 'network-error'); assert.equal(retries[0].attempt, 1); assert.ok(retries[0].written > 0);
  for (const [objectId, blob] of acquired.entries) assert.deepEqual(await bytesOf(blob), r.bodies.get(objectId), `${objectId} intact`);
  const total = requireDescriptor(acquired.descriptor).objects.reduce((n, o) => n + o.ciphertext_bytes, 0);
  assert.equal(progress.at(-1)[0], total, 'ends exactly at the total');
  assert.ok(progress.every(([n]) => n <= total));
});

test('E61: a server that ignores the Range restarts the object from byte 0, and the result is still exact', async () => {
  const r = await release(), s = server(r, (objectId, attempt) => objectId === 'clip-1' ? (attempt === 1 ? 'drop-half' : 'ignore-range') : 'ok');
  const area = await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 });
  const progress = [];
  const running = client(s.fetchImpl).acquire(releaseId, { staging: area, onProgress: n => progress.push(n) });
  const acquired = await running;
  for (const [objectId, blob] of acquired.entries) assert.deepEqual(await bytesOf(blob), r.bodies.get(objectId));
  const total = requireDescriptor(acquired.descriptor).objects.reduce((n, o) => n + o.ciphertext_bytes, 0);
  assert.equal(progress.at(-1), total);
});

test('E61: 5xx is retried with exponential backoff; it gives up after the retry budget; refusals are not retried', async () => {
  const r = await release();
  const flaky = server(r, (objectId, attempt) => objectId === 'clip-1' && attempt <= 2 ? 'status-503' : 'ok'), retries = [];
  const running = client(flaky.fetchImpl).acquire(releaseId, { staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 }), onRetry: x => retries.push(x) });
  await running;
  assert.deepEqual(retries.map(x => [x.attempt, x.delayMs, x.code]), [[1, 5, 'protected-server-unavailable'], [2, 10, 'protected-server-unavailable']]);
  const down = server(r, objectId => objectId === 'clip-1' ? 'status-503' : 'ok'), seen = [];
  const failing = client(down.fetchImpl).acquire(releaseId, { staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 }), onRetry: x => seen.push(x) });
  failing.catch(() => {});
  await assert.rejects(failing, /protected-server-unavailable/);
  assert.equal(seen.length, 4, 'four retries, then the failure is reported');
  const refused = server(r, () => 'ok'); const original = refused.fetchImpl; let objectCalls = 0;
  const refusing = async (url, init) => url.includes('/objects/') ? (objectCalls += 1, new Response('x', { status: 403, headers: { 'cache-control': 'no-store' } })) : original(url, init);
  // 0.62.21: an object refused after the descriptor was granted is the read quota (403 on the
  // deployed route): it waits into the next minute twice, then reports an interrupted download.
  const refusals = [];
  await assert.rejects(client(refusing, { refusedWaitMs: 5 }).acquire(releaseId, { onRetry: x => refusals.push(x) }), /protected-object-refused/);
  assert.equal(objectCalls, 3);
  assert.deepEqual(refusals.map(x => [x.code, x.delayMs]), [['protected-object-refused', 5], ['protected-object-refused', 10]]);
  // A refused descriptor (entitlement, withdrawal) is final.
  let descriptorCalls = 0;
  const deny = async (url, init) => url.endsWith('/descriptor') ? (descriptorCalls += 1, new Response('x', { status: 403, headers: { 'cache-control': 'no-store' } })) : original(url, init);
  await assert.rejects(client(deny).acquire(releaseId), /protected-access-refused/);
  assert.equal(descriptorCalls, 1, 'a descriptor refusal is final');
});

test('E61: cancelling during a backoff stops at once', async () => {
  const r = await release(), s = server(r, objectId => objectId === 'clip-1' ? 'status-503' : 'ok'), controller = new AbortController();
  const running = client(s.fetchImpl).acquire(releaseId, { signal: controller.signal, staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 }),
    onRetry: () => controller.abort() });
  running.catch(() => {});
  await assert.rejects(running, /cancel/);
});

test('E61: the deployed route refuses Range with 400: the object is fetched again whole, and Range is not asked again', async () => {
  const r = await release([300_000, 200_000, 200_000]);
  const s = server(r, (objectId, attempt) => ['clip-1', 'clip-2'].includes(objectId) && attempt === 1 ? 'drop-half' : 'ok', { rejectRange: true });
  const retries = [];
  const acquired = await client(s.fetchImpl).acquire(releaseId, { staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 }), onRetry: x => retries.push(x) });
  for (const [objectId, blob] of acquired.entries) assert.deepEqual(await bytesOf(blob), r.bodies.get(objectId));
  const clip1 = s.calls.filter(c => c.objectId === 'clip-1'), clip2 = s.calls.filter(c => c.objectId === 'clip-2');
  assert.deepEqual(clip1.map(c => Boolean(c.range)), [false, true, false], 'one Range try (400), then the whole object');
  assert.deepEqual(clip2.map(c => Boolean(c.range)), [false, false], 'Range support is remembered as absent');
  assert.ok(retries.some(x => x.code === 'protected-range-unsupported' && x.delayMs === 0));
});

test('E61: 429 waits as Retry-After says and has its own budget (more than the transient retries)', async () => {
  const r = await release(), s = server(r, (objectId, attempt) => objectId === 'clip-1' && attempt <= 6 ? 'rate-limited' : 'ok'), retries = [];
  const acquired = await client(s.fetchImpl).acquire(releaseId, { onRetry: x => retries.push(x) });
  assert.equal(acquired.entries.length, 2);
  assert.equal(retries.length, 6);
  assert.ok(retries.every(x => x.code === 'protected-rate-limited' && x.delayMs === 0), 'Retry-After: 0 is honoured');
  assert.equal(retryAfterMs('3'), 3000);
  assert.equal(retryAfterMs('9999'), 60_000, 'bounded');
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(retryAfterMs('soon'), null);
  assert.equal(retryAfterMs(null), null);
});

test('E61: a transient descriptor failure is retried too', async () => {
  const r = await release(), s = server(r, () => 'ok'); let failures = 1;
  const flaky = async (url, init) => url.endsWith('/descriptor') && failures-- > 0 ? new Response('x', { status: 503, headers: { 'cache-control': 'no-store' } }) : s.fetchImpl(url, init);
  const retries = [];
  await client(flaky).acquire(releaseId, { onRetry: x => retries.push(x) });
  assert.deepEqual(retries.map(x => [x.object, x.code]), [[0, 'protected-server-unavailable']]);
});

test('E61: slow storage writes never stop the network read (fast server, 400 ms writes), writes are batched, and write progress keeps the silence timer alive', async () => {
  const size = 12 * 1_048_576, r = await release([100_000, size]);
  const writes = [], root = memoryDirectory({ writeDelayMs: 400, writes });
  const s = server(r, () => 'ok');
  const started = performance.now();
  // timeoutMs 1 s: the network is done long before the last write; only write progress re-arms the timer.
  const acquired = await client(s.fetchImpl, { timeoutMs: 1_000 }).acquire(releaseId, { staging: await createDiskStaging({ root, budgetBytes: 30_000_000 }) });
  const elapsed = performance.now() - started;
  for (const [objectId, blob] of acquired.entries) assert.deepEqual(await bytesOf(blob), r.bodies.get(objectId));
  assert.ok(writes.length <= 12, `few writes: ${writes.length}`);
  assert.ok(writes.filter(w => w.bytes >= 1_048_576).length >= 2 && writes.every(w => w.bytes <= 4_194_304), 'writes of 1 to 4 MiB');
  // 0.62.19 wrote every 64 KB chunk (190+ writes x 400 ms > 75 s); the read finished before the writes.
  assert.ok(elapsed < 6_000, `took ${Math.round(elapsed)} ms`);
  const lastRead = Math.max(...s.reads), lastWrite = Math.max(...writes.map(w => w.at));
  // The whole 12 MiB arrived while the first 4 MiB write was still pending.
  assert.ok(lastRead < lastWrite - 150, 'the network was read ahead of storage');
});

// The renderer's pause control, as the client sees it.
function pauseGate() {
  let paused = false, controller = new AbortController(), waiters = [];
  return { get paused() { return paused; }, signal: () => controller.signal, resumed: () => paused ? new Promise(r => waiters.push(r)) : Promise.resolve(),
    pause() { if (!paused) { paused = true; controller.abort(); } },
    resume() { if (paused) { paused = false; controller = new AbortController(); for (const w of waiters.splice(0)) w(); } } };
}
const objectCalls = s => s.calls.filter(c => c.objectId !== undefined);
async function pauseResume({ rejectRange = false, quota = Infinity } = {}) {
  const r = await release([100_000, 300_000, 300_000, 300_000, 300_000]);
  const s = server(r, () => 'ok', { chunkDelayMs: 2, etags: true, rejectRange, quota });
  const gate = pauseGate(), progress = [];
  let pausedAt = null;
  const running = client(s.fetchImpl).acquire(releaseId, { staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 }), pause: gate,
    onProgress: n => { progress.push(n); if (pausedAt === null && n > 550_000) { pausedAt = n; gate.pause(); } } });
  await new Promise(resolve => setTimeout(resolve, 150));
  const whilePaused = s.calls.length;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(s.calls.length, whilePaused, 'nothing is fetched while paused');
  assert.ok(gate.paused);
  gate.resume();
  const acquired = await running;
  for (const [objectId, blob] of acquired.entries) assert.deepEqual(await bytesOf(blob), r.bodies.get(objectId), `${objectId} intact`);
  return { r, s, progress, pausedAt };
}

test('0.62.21: Pause holds the download and Resume continues it: finished objects are not fetched again; the paused one resumes with Range and If-Range', async () => {
  const { s, progress } = await pauseResume();
  const calls = objectCalls(s), byObject = id => calls.filter(c => c.objectId === id); 
  const resumed = calls.filter(c => c.range);
  assert.equal(resumed.length, 1, 'one object was interrupted');
  assert.match(resumed[0].range, /^bytes=\d+-$/);
  assert.equal(resumed[0].ifRange, `"${resumed[0].objectId}-v1"`, 'the resume carries the object\'s ETag');
  for (const id of ['packet', 'clip-1', 'clip-2', 'clip-3', 'clip-4']) assert.ok(byObject(id).length <= 2 && byObject(id).length >= 1);
  assert.equal(calls.length, 6, 'five objects plus one resumed request');
  assert.ok(progress.every((n, i) => i === 0 || n >= progress[i - 1] || n >= 400_000), 'progress returns only to the bytes kept');
});

test('0.62.21: without Range support only the paused object starts again', async () => {
  const { s } = await pauseResume({ rejectRange: true });
  const calls = objectCalls(s);
  assert.equal(calls.filter(c => c.range).length, 1, 'one Range try (400)');
  assert.equal(calls.length, 7, 'five objects, the refused Range try and one whole re-fetch');
});

test('0.62.21: pause and resume stay within the server read quota that a restart from zero exceeded', async () => {
  // 1 descriptor + 5 objects + 1 resume = 7 reads; a restart from 0 needed 1 + ~3 + 1 + 5 = 10.
  await pauseResume({ quota: 8 });
});

test('0.62.21: Cancel while paused ends the download at once', async () => {
  const r = await release(), s = server(r, () => 'ok', { chunkDelayMs: 2 });
  const gate = pauseGate(), stop = new AbortController();
  gate.pause();
  const running = client(s.fetchImpl).acquire(releaseId, { signal: stop.signal, pause: gate, staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 10_000_000 }) });
  running.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(s.calls.length, 0, 'a download paused before it began fetches nothing');
  stop.abort();
  await assert.rejects(running, /client-cancelled/);
});

test('E91: the per-edit download limit (403 PROTECTED_DOWNLOAD_LIMIT) is its own final error with the wait, on the descriptor or an object', async () => {
  const r = await release(), s = server(r, () => 'ok'), original = s.fetchImpl;
  const limit = (body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 403,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '82800', ...headers } });
  const code = { error: { code: 'PROTECTED_DOWNLOAD_LIMIT', retryAfterSeconds: 82800 } };
  for (const where of ['/descriptor', '/objects/clip-1']) {
    let calls = 0; const retries = [];
    const fetchImpl = async (url, init) => url.endsWith(where) ? (calls += 1, limit(code)) : original(url, init);
    await assert.rejects(client(fetchImpl, { refusedWaitMs: 5 }).acquire(releaseId, { onRetry: x => retries.push(x) }),
      error => error.message === 'protected-download-limit' && error.retryAfterSeconds === 82800);
    assert.equal(calls, 1, `${where}: the limit is never retried (it lasts hours)`); assert.deepEqual(retries, []);
  }
  // The body's wait wins; without one the Retry-After header is used; absurd values are bounded.
  const once = response => async (url, init) => url.endsWith('/descriptor') ? response() : original(url, init);
  const limited = async response => { try { await client(once(response)).acquire(releaseId); } catch (error) { return error; } assert.fail('must refuse'); };
  assert.equal((await limited(() => limit({ error: { code: 'PROTECTED_DOWNLOAD_LIMIT' } }, { 'retry-after': '3600' }))).retryAfterSeconds, 3600);
  assert.equal((await limited(() => limit({ error: { code: 'PROTECTED_DOWNLOAD_LIMIT', retryAfterSeconds: 1e9 } }))).retryAfterSeconds, 7 * 86400);
  const noWait = await limited(() => limit({ error: { code: 'PROTECTED_DOWNLOAD_LIMIT', retryAfterSeconds: -5 } }, { 'retry-after': 'soon' }));
  assert.equal(noWait.message, 'protected-download-limit'); assert.equal(noWait.retryAfterSeconds, undefined);
  // Every other 403 keeps today's refusal: another code, no JSON type, malformed or oversized bodies.
  for (const response of [() => limit({ error: { code: 'PROTECTED_REQUEST_REFUSED' } }), () => limit(code, { 'content-type': 'text/plain' }),
    () => limit('{"error":'), () => limit({ error: { code: 'PROTECTED_DOWNLOAD_LIMIT', pad: 'x'.repeat(4096) } }),
    () => limit({ ...code, pad: 'x'.repeat(4096) }, { 'content-length': '5000' })])
    assert.equal((await limited(response)).message, 'protected-access-refused');
});
