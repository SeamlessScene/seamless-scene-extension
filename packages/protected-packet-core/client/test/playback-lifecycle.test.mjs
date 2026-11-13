import { accountSignout } from './support/account-signout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup as websiteFixture } from '../../test/support/website-fixture.mjs';
import { directory } from './support/node-directory.mjs';
import { createDiskVault } from '../disk-vault.mjs';
import { createLeaseCache } from '../lease-cache.mjs';
import { createInstallationStore } from '../installation-store.mjs';
import { createLicenseManager } from '../license-manager.mjs';
import { ProtectedPlaybackSession } from '../../../browser-extension/src/protected-playback-session.mjs';
import { CatalogActivationStore } from '../../../browser-extension/src/catalog-activation-store.mjs';
import { refreshCatalogControl } from '../../../browser-extension/src/catalog-control-updates.mjs';
const integration = (name, fn) => test(name, { skip: !process.env.PROTECTED_WEBSITE_CORE }, fn);
const release = '50000000-0000-4000-8000-000000000001';
const pause = () => new Promise(r => setImmediate(r));
async function fixture(t, media = false) {
  const f = await websiteFixture({ media }); f.path = await mkdtemp(join(tmpdir(), 'protected-lifecycle-')); f.name = crypto.randomUUID();
  t.after(() => rm(f.path, { recursive: true, force: true })); f.activationRecords = {}; f.urls = new Set(); f.events = []; f.owners = [];
  f.store = new CatalogActivationStore({ storageArea: { async get(k) { return { [k]: f.activationRecords[k] }; }, async set(v) { Object.assign(f.activationRecords, structuredClone(v)); } }, locks: { request: async (name, options, fn) => fn() } });
  f.policy = { trustedKeys: f.catalogTrust, capabilities: f.capabilities, adapterVersion: '0.1.0', service: 'cleared-fixture' };
  const s = f.packet.manifest.source;
  f.source = { serviceId: s.service, activeItemId: s.service_content_id, runtimeMs: s.expected_runtime_ms, season: s.season, episode: s.episode, mediaType: 'episode', versionTag: s.version_tag, territory: s.territory, plan: s.service_tier };
  f.create = async ({ estimate } = {}) => {
    const installationStore = createInstallationStore({ indexedDB, name: f.name + '-keys' });
    const cache = createLeaseCache({ indexedDB, name: f.name + '-cache', now: () => f.now });
    const client = f.makeClient({ getInstallation: () => installationStore.getInstallation() });
    const manager = createLicenseManager({ cache, installationStore, client, licenseTrust: f.licenseTrust, issuer: 'https://license.invalid', now: () => f.now, monotonic: () => 0 });
    const root = directory(f.path), vault = await createDiskVault({ root, descriptorTrust: f.descriptorTrust, assertOwner: () => {} });
    const executor = { async preloadLocal() { f.events.push('preload'); }, async executeLocal(action) {
      f.events.push(action.type); await new Promise(r => { f.finish = r; }); f.events.push('native-restored'); return { status: 'success' };
    }, async executeSkip() { f.events.push('SKIP'); return { status: 'success' }; }, async startMute() { f.events.push('MUTE'); },
    async finishMute() { f.events.push('unmuted'); }, async honorNativeSeek() {}, invalidate() {}, async cancel() { f.events.push('cancel-restored'); f.finish?.(); }, async cancelPreload() { f.events.push('preload-stopped'); } };
    const owner = new ProtectedPlaybackSession({ client, manager, vault, root, account: f.credentials.accountId,
      catalogOptions: { activationStore: f.store, readPolicy: async () => f.policy, expectedService: 'cleared-fixture',
        validateAsset: async file => { assert.equal(file.size, f.packet.asset_bindings[0].bytes); return { ok: true }; },
        createObjectURL: () => { const url = 'blob:private-' + crypto.randomUUID(); f.urls.add(url); return url; }, revokeObjectURL: url => f.urls.delete(url) },
      executor, readSource: async () => f.source,
      refreshControl: (editId, { signal }) => refreshCatalogControl({ editId, store: f.store, policy: f.policy, origin: 'https://license.invalid', signal,
        fetcher: async () => f.control ? Response.json(f.control) : new Response(null, { status: 204 }) }),
      now: () => f.now, setTimer: () => 1, clearTimer: () => {}, estimate });
    f.owners.push(owner); t.after(async () => { await owner.stop().catch(() => {}); cache.close(); installationStore.close(); });
    return { owner, cache, installationStore, manager, vault };
  }; return f;
}

integration('online acquisition reserves the descriptor footprint, so a small release loads on a small quota and a tiny quota still refuses', async t => {
  for (const combined of [false, true]) {
    // Far below the 2 GB format maximum, comfortably above this fixture's ciphertext.
    const f = await fixture(t); const a = await f.create({ estimate: async () => ({ quota: 64 * 1024 * 1024, usage: 0 }) });
    await a.owner.open(release, { combined }); await a.owner.stop();
    assert.deepEqual(await readdir(f.path), ['library']);
    assert.deepEqual(await readdir(join(f.path, 'library')), [release]);
  }
  const g = await fixture(t); const b = await g.create({ estimate: async () => ({ quota: 1024, usage: 512 }) });
  await assert.rejects(b.owner.open(release), /staging-quota/);
  assert.deepEqual(await readdir(g.path).then(x => x.filter(n => n.startsWith('job-'))), []);
});

integration('split/combined acquisition uses real catalog activation, source checks and offline restart', async t => {
  for (const combined of [false, true]) {
    const f = await fixture(t); const a = await f.create(); await a.owner.open(release, { combined }); await a.owner.arm();
    await a.owner.observe({ currentTimeMs: 0, paused: false }); await a.owner.observe({ currentTimeMs: 15000, paused: false }); assert(f.events.includes('SKIP'));
    await a.owner.stop(); const floor = structuredClone(f.activationRecords); const b = await f.create();
    f.fetch = async () => { throw Error('offline'); }; await b.owner.open(release, { online: false }); await b.owner.arm();
    assert.deepEqual(f.activationRecords, floor); assert.deepEqual(await readdir(f.path).then(x => x.filter(n => n.startsWith('job-'))).then(x => x.length), 1);
    await b.owner.stop(); assert.deepEqual(await readdir(f.path), ['library']);
    assert.deepEqual(await readdir(join(f.path, 'library')), [release]);
  }
});
integration('renewal uses fresh proof; unavailable renewal retries without replacing a valid lease', async t => {
  const f = await fixture(t); const a = await f.create(); await a.owner.open(release); const expiry = a.owner.license.expiresAt;
  f.now += 6 * 86400000; f.credentials.expiresAt = f.now + 1800000;
  const response = f.respond; f.respond = async () => { throw Error('offline'); };
  await a.owner.tick(); assert.equal(a.owner.license.expiresAt, expiry); assert.equal(a.owner.retryAt, f.now + 60000);
  f.respond = response; f.now += 60001; await a.owner.tick(); assert(a.owner.license.expiresAt > expiry); assert.equal(f.used.size, 2);
});
integration('ordinary expiry finishes running replacement, restores and refuses following INSERT', async t => {
  const f = await fixture(t, true); const a = await f.create(); await a.owner.open(release); await a.owner.arm();
  await a.owner.observe({ currentTimeMs: 0, paused: false }); const running = a.owner.observe({ currentTimeMs: 3000, paused: false });
  while (!f.finish) await pause(); f.now = a.owner.license.expiresAt; await a.owner.tick(); assert.equal(a.owner.state, 'expired'); assert.equal(f.urls.size, 1);
  f.finish(); await running; await a.owner.observe({ currentTimeMs: 10000, paused: false }); assert(!f.events.includes('INSERT')); assert(f.events.includes('native-restored'));
  await a.owner.tick(); assert.equal(f.urls.size, 0); assert.equal(a.owner.state, 'closed');
});
integration('explicit sign-out cancels active replacement, clears keys/grants/ciphertext and preserves activation floors', async t => {
  const f = await fixture(t, true); const a = await f.create(); await a.owner.open(release); await a.owner.arm(); const floors = structuredClone(f.activationRecords);
  await a.owner.observe({ currentTimeMs: 0, paused: false }); const running = a.owner.observe({ currentTimeMs: 3000, paused: false });
  while (!f.finish) await pause(); await a.owner.signOut(); await running;
  assert(f.events.includes('cancel-restored')); assert.equal(f.urls.size, 0); assert.deepEqual(f.activationRecords, floors); assert.deepEqual(await readdir(f.path), []);
  const b = await f.create(); await assert.rejects(b.owner.open(release, { online: false }));
});
integration('verified higher-version emergency disable cancels/restores even during an expired running action', async t => {
  const f = await fixture(t, true); const a = await f.create(); await a.owner.open(release); await a.owner.arm();
  await a.owner.observe({ currentTimeMs: 0, paused: false }); const running = a.owner.observe({ currentTimeMs: 3000, paused: false });
  while (!f.finish) await pause(); f.control = f.disable(); f.now = a.owner.license.expiresAt; await a.owner.tick(); assert.equal(a.owner.state, 'closed'); await running;
  assert.equal(a.owner.state, 'closed'); assert(f.events.includes('cancel-restored')); assert.equal(f.urls.size, 0);
});
integration('forged disable does not cancel a valid grant; wrong source refuses arming', async t => {
  const f = await fixture(t); const a = await f.create(); await a.owner.open(release); f.control = f.disable(); f.control.signature.value = 'invalid';
  await a.owner.tick(); assert.equal(a.owner.state, 'ready'); f.source.activeItemId = 'wrong'; await assert.rejects(a.owner.arm());
});
integration('interrupted download and crash-orphan cleanup remove tentative bytes, retaining unrelated entries', async t => {
  const f = await fixture(t); const a = await f.create(); const respond = f.respond;
  f.respond = async (url, init) => url.includes('/objects/') ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.error(Error('connection-lost')); } }), { headers: { 'cache-control': 'no-store' } }) : respond(url, init);
  await assert.rejects(a.owner.open(release)); assert.deepEqual(await readdir(f.path), []);
  await mkdir(join(f.path, 'job-' + crypto.randomUUID())); await mkdir(join(f.path, 'saved')); await writeFile(join(f.path, 'saved', 'object-0'), 'uncommitted'); await writeFile(join(f.path, 'unrelated'), 'preserve');
  await a.vault.cleanup(); assert.deepEqual(await readdir(f.path), ['unrelated']);
});
integration('expired offline restoration and corrupted retained ciphertext fail before playable URLs', async t => {
  const f = await fixture(t, true); const a = await f.create(); await a.owner.open(release); const expires = a.owner.license.expiresAt; await a.owner.stop();
  await writeFile(join(f.path, 'library', release, 'object-0'), new Uint8Array(2));
  const b = await f.create(); await assert.rejects(b.owner.open(release, { online: false }), { message: 'vault-object-size' }); assert.equal(f.urls.size, 0);
  const c = await f.create(); await c.owner.open(release); await c.owner.stop(); f.now = expires;
  const d = await f.create(); await assert.rejects(d.owner.open(release, { online: false })); assert.equal(f.urls.size, 0);
});
integration('sign-out during delayed acquisition fences completion and cleans disk before returning', async t => {
  const f = await fixture(t); const a = await f.create(); const respond = f.respond; let releaseWait, entered;
  const wait = new Promise(r => { entered = r; });
  f.respond = async (url, init) => { if (url.endsWith('/descriptor')) { entered(); await new Promise(r => { releaseWait = r; }); } return respond(url, init); };
  const opening = a.owner.open(release); const rejected = assert.rejects(opening); await wait;
  const stopping = a.owner.signOut(); releaseWait(); await rejected; await stopping;
  assert.equal(f.urls.size,0);assert.deepEqual(await readdir(f.path),[]);assert.equal(a.owner.state,'closed');
});
integration('sign-out during renewal cannot save a late license or start another action', async t => {
  const f = await fixture(t); const a = await f.create(); await a.owner.open(release);
  f.now += 6*86400000;f.credentials.expiresAt=f.now+1800000; const respond=f.respond;let releaseWait,entered;
  const wait=new Promise(r=>{entered=r;});f.respond=async(url,init)=>{if(url.endsWith('/license')){entered();await new Promise(r=>{releaseWait=r;});}return respond(url,init);};
  const ticking=a.owner.tick();const rejected=assert.rejects(ticking);await wait;await a.owner.signOut();releaseWait();await rejected;
  assert.equal((await a.cache.read(f.credentials.accountId,a.owner.descriptor.sha256)).entry,null);await assert.rejects(a.owner.arm());
});
integration('ordinary expiry completes an active MUTE before discarding private media', async t => {
  const f=await fixture(t,true);const a=await f.create();await a.owner.open(release);await a.owner.arm();
  await a.owner.observe({currentTimeMs:11999,paused:false});await a.owner.observe({currentTimeMs:12000,paused:false});assert(f.events.includes('MUTE'));
  f.now=a.owner.license.expiresAt;await a.owner.tick();assert(!f.events.includes('unmuted'));
  await a.owner.observe({currentTimeMs:14000,paused:false});assert(f.events.includes('unmuted'));await a.owner.tick();assert.equal(a.owner.state,'closed');
});
integration('authenticated disable floor survives offline restart and refuses the retained older packet', async t => {
  const f=await fixture(t);const a=await f.create();await a.owner.open(release);f.control=f.disable();await a.owner.tick();assert.equal(a.owner.state,'closed');
  const floor=structuredClone(f.activationRecords);const b=await f.create();await assert.rejects(b.owner.open(release,{online:false}),/downgrade|disabled/);assert.deepEqual(f.activationRecords,floor);assert.equal(f.urls.size,0);
});
integration('ordinary expiry during INSERT allows completion but rejects the next native edit', async t => {
  const f=await fixture(t,true);const a=await f.create();await a.owner.open(release);await a.owner.arm();
  await a.owner.observe({currentTimeMs:9999,paused:false});const running=a.owner.observe({currentTimeMs:10000,paused:false});while(!f.finish)await pause();
  f.now=a.owner.license.expiresAt;await a.owner.tick();assert.equal(f.urls.size,1);f.finish();await running;
  await a.owner.observe({currentTimeMs:12000,paused:false});assert(!f.events.includes('MUTE'));await a.owner.tick();assert.equal(a.owner.state,'closed');
});
integration('source change after arming refuses dispatch through fresh compilation', async t => {
  const f=await fixture(t);const a=await f.create();await a.owner.open(release);await a.owner.arm();await a.owner.observe({currentTimeMs:0,paused:false});
  f.source.activeItemId='changed-after-arm';await a.owner.observe({currentTimeMs:15000,paused:false});assert(!f.events.includes('SKIP'));
});
integration('active source replacement cancels the current action and restores before URL cleanup', async t => {
  const f=await fixture(t,true);const a=await f.create();await a.owner.open(release);await a.owner.arm();await a.owner.observe({currentTimeMs:0,paused:false});
  const running=a.owner.observe({currentTimeMs:3000,paused:false});while(!f.finish)await pause();f.source.activeItemId='new-program';
  await assert.rejects(a.owner.tick());await running;assert(f.events.includes('cancel-restored'));assert.equal(f.urls.size,0);assert.equal(a.owner.state,'closed');
});

integration('external native scheduler fences all starts and holds plaintext until expired action restoration', async t => {
  const f=await fixture(t,true);const a=await f.create();a.owner.external=true;await a.owner.open(release);
  const actions=await a.owner.actions(f.source);const local=actions.find(a=>a.type==='REPLACE');
  await assert.rejects(a.owner.activity('unknown',true));
  await a.owner.activity(local.id,true);await a.owner.beginLocal();assert(await a.owner.resolveAsset(local.clipUrl));
  f.now=a.owner.license.expiresAt;await a.owner.tick();assert.equal(a.owner.state,'expired');assert.equal(f.urls.size,1);
  await assert.rejects(a.owner.actions(f.source));await assert.rejects(a.owner.beginLocal());await assert.rejects(a.owner.activity(local.id,true));
  await a.owner.activity(local.id,false);await a.owner.tick();assert.equal(a.owner.state,'closed');assert.equal(f.urls.size,0);
});
integration('external native owner retains source enforcement and authenticated disable',async t=>{
  const f=await fixture(t,true);const a=await f.create();a.owner.external=true;await a.owner.open(release);
  await assert.rejects(a.owner.actions({...f.source,activeItemId:'wrong'}));
  const actions=await a.owner.actions(f.source);await a.owner.activity(actions[0].id,true);f.control=f.disable();await a.owner.tick();
  assert.equal(a.owner.state,'closed');assert(f.events.includes('cancel-restored'));assert.equal(f.urls.size,0);
});

integration('initiating account disconnect fences a late renewal response and cannot repopulate grants',async t=>{
 const f=await fixture(t);const a=await f.create();await a.owner.open(release);
 f.now+=6*86400000;f.credentials.expiresAt=f.now+1800000;const respond=f.respond;let releaseWait,entered;
 const wait=new Promise(r=>entered=r);f.respond=async(url,init)=>{if(url.endsWith('/license')){entered();await new Promise(r=>releaseWait=r);}return respond(url,init);};
 const ticking=a.owner.tick(),rejected=assert.rejects(ticking);await wait;
 const account=accountSignout(()=>a.owner.signOut());const result=await account.disconnect();assert.equal(result.ok,true);
 releaseWait();await rejected;assert.equal((await a.cache.read(f.credentials.accountId,a.owner.descriptor.sha256)).entry,null);
 assert.deepEqual(await readdir(f.path),[]);await assert.rejects(a.owner.arm());
});

integration('initiating account waits for delayed descriptor cleanup and refuses late acquisition',async t=>{
 const f=await fixture(t);const a=await f.create();const respond=f.respond;let releaseWait,entered;
 const wait=new Promise(r=>entered=r);f.respond=async(url,init)=>{if(url.endsWith('/descriptor')){entered();await new Promise(r=>releaseWait=r);}return respond(url,init);};
 const opening=a.owner.open(release),rejected=assert.rejects(opening);await wait;
 const account=accountSignout(()=>a.owner.signOut());let result;const disconnect=account.disconnect().then(r=>result=r);
 await pause();assert.equal(result,undefined);assert.equal(account.record,null);releaseWait();await rejected;await disconnect;
 assert.equal(result.ok,true);assert.equal(f.urls.size,0);assert.deepEqual(await readdir(f.path),[]);assert.equal(a.owner.state,'closed');
 const b=await f.create();await assert.rejects(b.owner.open(release,{online:false}));
});
