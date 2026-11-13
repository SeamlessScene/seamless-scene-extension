// Local client-throughput benchmark (not a test): real HTTP server on 127.0.0.1, real
// website client, disk staging over an in-memory directory. Run: node test/bench-throughput.local.mjs
// WRITE_DELAY_MS=50 makes every storage write slow (a busy OPFS); 0.62.19 fell to 2.5 MB/s
// there, 0.62.20 (reads decoupled from batched writes) kept 37 MB/s (2026-10-11).
import http from 'node:http';
import { generateKeyPair } from 'jose';
import { FORMAT, PROFILE, signDescriptor, verifyDescriptor, descriptorToken } from '../src/contract.mjs';
import { newContentKey, encryptObject } from '../src/files.mjs';
import { createProtectedWebsiteClient } from '../client/website-client.mjs';
import { createDiskStaging } from '../client/disk-staging.mjs';

const writeDelayMs = Number(process.env.WRITE_DELAY_MS ?? 0);
const keys = await generateKeyPair('EdDSA');
const trusted = new Map([['publisher', { key: keys.publicKey, status: 'active' }]]);
const releaseId = '50000000-0000-4000-8000-000000000001', origin = 'https://license.invalid';
const sizes = [200_000, 40_000_000, 40_000_000, 40_000_000];
const context = { format: FORMAT, release_id: releaseId, key_access: 'platform-key', publication: 'reviewed-catalog-v2', crypto_profile: PROFILE, required_capabilities: [PROFILE, 'platform-key'] };
const objects = [], bodies = new Map();
for (const [i, size] of sizes.entries()) {
  const objectId = i === 0 ? 'packet' : `clip-${i}`;
  const e = await encryptObject(new Blob([new Uint8Array(size).fill(i)]), await newContentKey(), { ...context, object_id: objectId, kind: i === 0 ? 'packet' : 'media' });
  objects.push(e.binding); bodies.set(objectId, Buffer.from(await (e.blob ?? e.ciphertext).arrayBuffer()));
}
const token = descriptorToken(await verifyDescriptor(await signDescriptor({ ...context, objects }, keys.privateKey, 'publisher'), trusted));
const server = http.createServer((req, res) => {
  const headers = { 'cache-control': 'no-store' };
  if (req.url.endsWith('/descriptor')) { res.writeHead(200, headers); res.end(token); return; }
  const body = bodies.get(req.url.split('/objects/')[1]);
  res.writeHead(200, { ...headers, 'content-length': body.length }); res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const fetchImpl = async (url, init) => { const r = await fetch(url.replace(origin, `http://127.0.0.1:${port}`), init); return new Response(r.body, { status: r.status, headers: r.headers }); };
function memoryDirectory() {
  const children = new Map(); const nf = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
  return { async getDirectoryHandle(c, { create = false } = {}) { let d = children.get(c); if (!d) { if (!create) throw nf(); d = memoryDirectory(); children.set(c, d); } return d; },
    async getFileHandle(c, { create = false } = {}) { let f = children.get(c); if (!f) { if (!create) throw nf(); const parts = [];
      f = { async getFile() { return new Blob(parts); }, async createWritable() { return { async write(v) { if (writeDelayMs) await new Promise(r => setTimeout(r, writeDelayMs)); parts.push(v.slice()); }, async truncate() { parts.length = 0; }, async seek() {}, async close() {}, async abort() {} }; } }; children.set(c, f); } return f; },
    async removeEntry(c) { children.delete(c); } };
}
const session = { accountId: '50000000-0000-4000-8000-000000000002', pairingId: '50000000-0000-4000-8000-000000000003', accessToken: 'bench', expiresAt: Date.now() + 3_600_000 };
const client = createProtectedWebsiteClient({ origin, issuer: origin, descriptorTrust: trusted, licenseTrust: new Map(), getCredentials: async () => ({ ...session }), getInstallation: async () => { throw Error('unused'); }, fetchImpl });
const total = sizes.reduce((a, b) => a + b, 0);
for (const label of ['raw fetch (no client)', 'client, memory blobs', 'client, disk staging']) {
  const started = performance.now();
  if (label.startsWith('raw')) { for (const id of bodies.keys()) { const r = await fetchImpl(`${origin}/x/objects/${id}`, {}); for await (const _ of r.body); } }
  else await client.acquire(releaseId, label.includes('disk') ? { staging: await createDiskStaging({ root: memoryDirectory(), budgetBytes: 500_000_000 }) } : {});
  const s = (performance.now() - started) / 1000;
  console.log(`${label}: ${(total / 1e6).toFixed(1)} MB in ${s.toFixed(2)} s = ${(total / 1e6 / s).toFixed(1)} MB/s`);
}
server.close();
