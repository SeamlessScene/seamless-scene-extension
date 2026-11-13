import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { generateKeyPair, CompactEncrypt } from 'jose';
import { fixtureManifest } from '../../browser-extension/src/fixture-signed-manifest.mjs';
import { canonicalizeManifest } from '../../browser-extension/src/manifest-security.mjs';
import { digest, bytes } from '../src/contract.mjs';
import { assertLicense } from '../src/license.mjs';
import { importProtectedCatalog } from '../src/catalog.mjs';
import { createProtectedWebsiteClient } from '../client/website-client.mjs';

const websiteRoot = process.env.PROTECTED_WEBSITE_CORE;
const available = websiteRoot && existsSync(join(websiteRoot, 'server/service.mjs'));
const integration = (name, fn) => test(name, { skip: !available && 'Set PROTECTED_WEBSITE_CORE to the read-only website candidate checkout' }, fn);
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const origin = 'https://license.invalid';

test('descriptor refusal names each status (404 unavailable, 403 refused, 429, 5xx) and cancels unread bodies without disclosing response content', async () => {
  for (const status of [401, 403, 404, 429, 500]) for (const combined of [false, true]) {
    let cancelled = false, calls = 0, signal; const expiresAt = Date.now() + 60000;
    const client = createProtectedWebsiteClient({ origin, issuer: origin, descriptorTrust: new Map(), licenseTrust: new Map(), retryBackoffMs: 1,
      getCredentials: async () => ({ accountId: id(2), pairingId: id(3), accessToken: 'dummy-test-token', expiresAt }),
      getInstallation: async () => { throw Error('must not license a refused release'); },
      fetchImpl: async (url, init) => {
        calls++; signal = init.signal; assert.ok(url.endsWith('/descriptor'));
        return new Response(new ReadableStream({ start(c) { c.enqueue(bytes('private response body')); }, cancel() { cancelled = true; } }), { status });
      } });
    try {
      await assert.rejects(client.acquire(id(1), { combined }), error => error.message === ({ 403: 'protected-access-refused', 404: 'protected-release-unavailable', 429: 'protected-rate-limited', 500: 'protected-server-unavailable' }[status] ?? 'protected-response'));
      // E61: a split acquisition retries 429 (8 times) and 5xx (4 times) before reporting them.
      assert.equal(calls, combined ? 1 : ({ 429: 9, 500: 5 }[status] ?? 1)); assert.equal(cancelled, true); assert.equal(signal.aborted, true);
    } finally { client.close(); }
  }
});

function quarantine() {
  const values = new Map();
  return { async open(object) { const chunks = []; return { async write(b) { chunks.push(b.slice()); }, async commit() { values.set(object.object_id, new Blob(chunks)); }, async abort() { values.delete(object.object_id); } }; },
    async commit() {}, async abort() { values.clear(); }, async read(id) { return values.get(id); } };
}

integration('actual website HTTP adapter: split and combined acquisition, nonextractable possession proof and catalog import', async () => {
  const f = await setup(); assert.equal(f.installation.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', f.installation.privateKey));
  for (const combined of [false, true]) {
    const acquired = await f.client.acquire(id(1), { combined }); const license = await f.client.license(acquired.descriptor);
    const result = await importProtectedCatalog({ ...acquired, license, store: quarantine(), catalogTrust: f.catalogTrust, capabilities: f.capabilities });
    assert.equal(result.status, 'catalog-verified-quarantine'); assert.equal(license.expiresAt, f.now + 604800000);
  }
  assert.equal(f.used.size, 2);
  for (const { init } of f.calls) {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer');
    if (init.body) { const body = JSON.parse(init.body); assert.deepEqual(Object.keys(body.installationPublicKey).sort(), ['crv', 'kty', 'x', 'y']); }
  }
});

integration('renewal proves possession again and rechecks website entitlement', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1)); await f.client.license(acquired.descriptor);
  await f.client.license(acquired.descriptor); assert.equal(f.used.size, 2);
  f.allowed = false; await assert.rejects(f.client.license(acquired.descriptor), { message: 'protected-access-refused' }); assert.equal(f.used.size, 2);
});

integration('malformed outer challenge bindings never reach the license route', async () => {
  for (const mutate of [c => c.releaseId = id(77), c => c.descriptorSha256 = '0'.repeat(64), c => c.installationId = 'other', c => c.expiresAt += 1,
    c => c.expiresAt -= 60, c => c.extra = true, c => c.id = 'bad']) {
    const f = await setup(); const acquired = await f.client.acquire(id(1)); const original = f.respond;
    f.respond = async (url, init) => { const r = await original(url, init); if (!url.endsWith('/challenge')) return r; const value = await r.json(); mutate(value); return Response.json(value, { headers: r.headers }); };
    await assert.rejects(f.client.license(acquired.descriptor)); assert.equal(f.calls.some(c => c.url.endsWith('/license')), false);
  }
});

integration('encrypted challenge substitution and wrong JWE type fail before proof disclosure', async () => {
  for (const altered of ['type', 'nonce', 'id', 'extra']) {
    const f = await setup(); const acquired = await f.client.acquire(id(1)); const original = f.respond;
    f.respond = async (url, init) => {
      const r = await original(url, init); if (!url.endsWith('/challenge')) return r; const outer = await r.json();
      const { proofJwe, ...binding } = outer; const inner = { ...binding, nonce: 'A'.repeat(43) };
      if (altered === 'nonce') inner.nonce = 'short'; if (altered === 'id') inner.id = id(77); if (altered === 'extra') inner.extra = true;
      outer.proofJwe = await new CompactEncrypt(bytes(JSON.stringify(inner))).setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', typ: altered === 'type' ? 'other' : 'seamless-installation-challenge+jwe' }).encrypt(f.installation.publicKey);
      return Response.json(outer, { headers: r.headers });
    };
    await assert.rejects(f.client.license(acquired.descriptor)); assert.equal(f.calls.some(c => c.url.endsWith('/license')), false);
  }
});

integration('wrong installation private key cannot disclose possession proof', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1));
  const wrong = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  f.installation = { publicKey: f.installation.publicKey, privateKey: wrong.privateKey };
  await assert.rejects(f.client.license(acquired.descriptor)); assert.equal(f.used.size, 0);
});

integration('pairing changes across awaited challenge invalidate the flow', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1)); const original = f.respond;
  f.respond = async (url, init) => { const r = await original(url, init); if (url.endsWith('/challenge')) f.credentials = { ...f.credentials, pairingId: id(77) }; return r; };
  await assert.rejects(f.client.license(acquired.descriptor), /paired-session-changed/); assert.equal(f.used.size, 0);
});

integration('close invalidates issued licenses and cancels further acquisition', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1)); const license = await f.client.license(acquired.descriptor);
  f.client.close(); assert.throws(() => assertLicense(license, acquired.descriptor), /session-required/);
  await assert.rejects(f.client.acquire(id(1)), /client-cancelled/);
});

integration('redirect, cacheable response, oversized body and wrong JSON type refuse', async () => {
  for (const kind of ['redirect', 'cache', 'oversize', 'type']) {
    const f = await setup(); const acquired = await f.client.acquire(id(1)); const original = f.respond;
    f.respond = async (url, init) => {
      if (!url.endsWith('/challenge')) return original(url, init);
      if (kind === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://other.invalid', 'cache-control': 'no-store' } });
      if (kind === 'oversize') return new Response(' '.repeat(8193), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      const r = await original(url, init); const headers = new Headers(r.headers);
      if (kind === 'cache') headers.set('cache-control', 'public'); else headers.set('content-type', 'text/plain');
      return new Response(await r.text(), { headers });
    };
    await assert.rejects(f.client.license(acquired.descriptor)); assert.equal(f.used.size, 0);
  }
});

integration('tampered license response metadata cannot authorize a session', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1)); const original = f.respond;
  f.respond = async (url, init) => { const r = await original(url, init); if (!url.endsWith('/license')) return r; const body = await r.json(); body.expiresAt++; return Response.json(body, { headers: r.headers }); };
  await assert.rejects(f.client.license(acquired.descriptor), /response-expiry/);
});

integration('aborted and timed-out requests produce no usable result', async () => {
  const f = await setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.client.acquire(id(1), { signal: controller.signal }), /client-cancelled/);
  const client = f.makeClient({ timeoutMs: 10, fetchImpl: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await assert.rejects(client.acquire(id(1)), /aborted/);
});

integration('rejected HTTP response cancels its body and request signal', async () => {
  const f = await setup(); let cancelled = false; let signal;
  const client = f.makeClient({ fetchImpl: async (_url, init) => { signal = init.signal; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 }); } });
  await assert.rejects(client.acquire(id(1)), { message: 'protected-access-refused' }); assert.equal(cancelled, true); assert.equal(signal.aborted, true);
});

integration('challenge expiry during decryption/return boundary cannot issue a grant', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1)); const original = f.respond;
  f.respond = async (url, init) => { const r = await original(url, init); if (url.endsWith('/challenge')) f.now += 60_000; return r; };
  await assert.rejects(f.client.license(acquired.descriptor), /challenge-binding/); assert.equal(f.used.size, 0);
});

integration('device-link owner feeds the protected client privately and rechecks the paired subject', async t => {
  const { createPairedProtectedWebsiteClient } = await import('../client/paired-website-client.mjs');
  const { registerDeviceLinkService } = await import('../../browser-extension/src/device-link-service.mjs');
  const { sessionRecheckMs } = await import('../../browser-extension/src/device-link-client.mjs');
  const { EXECUTING_BUILD } = await import('../../browser-extension/src/build-info.mjs');
  const f = await setup();
  t.mock.method(Date, 'now', () => f.now);
  const pairingConfig = { pairingOrigin: origin, deviceLinkLifetimeSeconds: 2592000 };
  let saved = { version: 1, generation: 0, active: { state: 'paired', origin, token: f.credentials.accessToken,
    accountId: f.credentials.accountId, pairingId: f.credentials.pairingId, displayName: 'Synthetic',
    expiresAt: new Date(f.credentials.expiresAt).toISOString() }, pending: null, revocations: [] };
  const journal = {
    async read() { return structuredClone(saved); },
    async change(generation, update) {
      assert.equal(generation, saved.generation);
      const next = structuredClone(saved), result = update(next); saved = next; return structuredClone(result);
    },
  };
  let includeSubject = true;
  let statusCalls = 0, brokerCalls = 0, listener;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/api/v1/pairing/session')) {
      statusCalls++; assert.equal(init.headers.Authorization, `Bearer ${f.credentials.accessToken}`);
      return Response.json({ data: { state: 'paired', id: f.credentials.pairingId, ...(includeSubject ? { accountId: f.credentials.accountId } : {}),
        scope: 'catalog:read', displayName: 'Viewer', expiresAt: new Date(f.credentials.expiresAt).toISOString() } });
    }
    return f.fetch(url, init);
  };
  const extensionId = 'a'.repeat(32), page = `chrome-extension://${extensionId}/catalog-account.html`;
  const renderer = { id: extensionId, url: `chrome-extension://${extensionId}/local-playback-frame.html#123`,
    origin: `chrome-extension://${extensionId}`, tab: { id: 1, url: page }, frameId: 2,
    documentId: 'b'.repeat(32), documentLifecycle: 'active' };
  const runtime = { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`,
    onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: message => { brokerCalls++; return new Promise(resolve => listener(message, renderer, resolve)); },
  };
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: { runtime } });
  t.after(() => { if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome); else delete globalThis.chrome; });
  registerDeviceLinkService(runtime, pairingConfig, { journal, fetcher: fetchImpl,
    locks: { async request(_name, _options, run) { return run(); } }, cleanup: async () => {}, authorizeRenderer: sender => sender === renderer });
  const publicSender = { ...renderer, url: page, frameId: 0 };
  const refused = await new Promise(resolve => listener({ kind: 'device-credentials-v1', build: EXECUTING_BUILD }, publicSender, resolve));
  assert.equal(refused.ok, false); assert.equal(refused.code, 'device-sender-denied'); assert.equal(refused.value, undefined);
  const client = createPairedProtectedWebsiteClient({ pairingConfig,
    fetchImpl, issuer: origin, descriptorTrust: f.descriptorTrust, licenseTrust: f.licenseTrust, getInstallation: async () => f.installation, now: () => f.now, monotonic: () => 0 });
  t.after(() => client.close());
  const acquired = await client.acquire(id(1)); const license = await client.license(acquired.descriptor);
  assert.equal(assertLicense(license, acquired.descriptor).renewalDue, false);
  assert.equal(saved.active.accountId, f.credentials.accountId); assert.equal(saved.active.pairingId, f.credentials.pairingId);
  assert.ok(brokerCalls > 1); assert.equal(statusCalls, 1, 'the owner reuses its bounded successful session check');
  includeSubject = false; f.now += sessionRecheckMs + 1;
  const before = f.calls.length;
  await assert.rejects(client.acquire(id(1)), { message: 'protected-link-check-failed' });
  assert.equal(statusCalls, 2); assert.equal(f.calls.length, before, 'a mismatched refreshed subject cannot reach protected delivery');
});

integration('real website split/combined downloads stream to disk and decrypt into a separate disk quarantine', async t => {
  const { createDiskStaging, createDiskQuarantine } = await import('../client/disk-staging.mjs');
  const { directory } = await import('../client/test/support/node-directory.mjs');
  const { mkdtemp, rm, readdir } = await import('node:fs/promises'); const { tmpdir } = await import('node:os');
  const path = await mkdtemp(join(tmpdir(), 'protected-client-disk-')); t.after(() => rm(path, { recursive: true, force: true }));
  const f = await setup();
  for (const combined of [false, true]) {
    const download = await createDiskStaging({ root: directory(path), budgetBytes: 2_003_000_000 });
    const acquired = await f.client.acquire(id(1), { combined, staging: download }); const license = await f.client.license(acquired.descriptor);
    const plain = await createDiskStaging({ root: directory(path), budgetBytes: 2_002_000_000 }); const store = createDiskQuarantine(acquired.descriptor, plain);
    const result = await importProtectedCatalog({ ...acquired, license, store, catalogTrust: f.catalogTrust, capabilities: f.capabilities });
    assert.equal(result.status, 'catalog-verified-quarantine'); assert.ok((await store.read('packet')).size > 0);
    await store.abort(); await download.abort(); assert.deepEqual(await readdir(path), []);
  }
  f.client.close();
});

integration('verified grant persistence callback is private and failed persistence refuses issuance', async () => {
  const f = await setup(); const acquired = await f.client.acquire(id(1)); let grant;
  await f.client.license(acquired.descriptor, { onVerifiedGrant: async g => { grant = g; } });
  assert.equal(grant.accountId, f.credentials.accountId); assert.equal(typeof grant.token, 'string'); assert.equal(grant.expiresAt, f.now + 604800000);
  await assert.rejects(f.client.license(acquired.descriptor, { onVerifiedGrant: async () => { throw Error('disk-full'); } }), /disk-full/);
  f.client.close();
});


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Re-serve ciphertext responses as a stream of pieces with a pause before each.
const paced = (f, pauses) => async (url, init) => {
  const response = await f.respond(url, init);
  if (!/\/(objects\/|combined)/.test(url)) return response;
  const body = new Uint8Array(await response.arrayBuffer()), size = Math.ceil(body.length / pauses.length);
  return new Response(new ReadableStream({ async start(controller) {
    for (let i = 0; i < pauses.length; i += 1) { await sleep(pauses[i]); if (i * size < body.length) controller.enqueue(body.subarray(i * size, (i + 1) * size)); }
    controller.close();
  } }), { status: 200, headers: response.headers });
};

integration('a slow but steady download completes and reports progress; a stalled one still fails', async () => {
  const f = await setup();
  for (const combined of [false, true]) {
    const steady = f.makeClient({ timeoutMs: 40, fetchImpl: paced(f, [15, 15, 15, 15, 15, 15]) }), seen = [];
    const acquired = await steady.acquire(id(1), { combined, onProgress: (bytes, total) => seen.push([bytes, total]) });
    assert.ok(acquired.descriptor, 'longer in total than the timeout, but never silent that long');
    const total = seen.at(-1)[1];
    assert.ok(total > 0 && seen.at(-1)[0] === total, 'ends at the descriptor total');
    assert.ok(seen.every(([bytes], i) => i === 0 || bytes >= seen[i - 1][0]), 'never goes backwards');
    steady.close();
  }
  const stalled = f.makeClient({ timeoutMs: 40, fetchImpl: paced(f, [5, 5, 200, 5]) });
  await assert.rejects(stalled.acquire(id(1)), /aborted|request-aborted/);
  stalled.close(); f.client.close();
});

import { setup } from './support/website-fixture.mjs';
