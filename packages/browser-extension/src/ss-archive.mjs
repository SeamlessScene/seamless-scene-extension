// Seamless Scene edit files (.ss) v1: a store-only ZIP with a fixed set of entries
// (docs/technical/SS_ARCHIVE_V1.md). The reader parses the central directory, checks
// every local header and returns each entry as a zero-copy File.slice; it refuses
// anything outside the profile (traversal, duplicates, unexpected or compressed
// entries, encryption, ZIP64, header mismatches, overlaps, size lies). Clip bytes are
// not read here: their SHA-256, probe and decode are checked by the local import.
// Hardening ported from the website's own archive checks.
import { validateLocalUserEditPacket } from './local-edit-packet.mjs';
import { RULES, requiredClientFor } from './seamless-rules.mjs';
import { listingStatus } from './edit-pack-fields.mjs';

export const SS_FORMAT = 'seamless-scene-edit';
export const SS_VERSION = 1;
export const SS_MIN_EXTENSION = RULES.archive.min_extension;
// A file that uses a relaxation older readers refuse asks for the first reader that accepts it
// (rules relaxations; requiredClientFor), so they say "This edit needs a newer Seamless Scene"
// instead of "invalid packet": a clip under 5 s needs 0.64.2 (E71); season or episode 0, 0.65.0.
export const SS_SHORT_CLIP_MIN_EXTENSION = RULES.relaxations.find(r => r.profile === 'local-user' && r.id === 'clip-under-5000').requires_client;
export const SS_LIMITS = Object.freeze({
  totalBytes: 2_147_483_648, clipBytes: 536_870_912, clips: 1000,
  jsonBytes: 1_048_576, detailsBytes: 65_536, signatureBytes: 4096, posterBytes: 2_097_152
});
const HEADER = 'seamless-edit.json', PACKET = 'edit-packet.json', DETAILS = 'details.json', POSTER = 'poster.jpg', SIGNATURE = 'signature.json';
const CLIP = /^clips\/([a-f0-9]{64})\.mp4$/;
const SIG_PREFIX = 'seamless-scene-edit-signature/1\n';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

export class SsArchiveError extends Error {
  constructor(code, detail = '') { super(code); this.name = 'SsArchiveError'; this.code = code; if (detail) this.detail = detail; }
}
const fail = (code, detail) => { throw new SsArchiveError(code, detail); };
const insist = (condition, code, detail) => { if (!condition) fail(code, detail); };

const table = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export async function crc32(blob, signal) {
  let n = 0xffffffff;
  for (let p = 0; p < blob.size; p += 4_194_304) {
    signal?.throwIfAborted?.();
    const chunk = new Uint8Array(await blob.slice(p, p + 4_194_304).arrayBuffer());
    for (let i = 0; i < chunk.length; i++) n = table[(n ^ chunk[i]) & 255] ^ (n >>> 8);
  }
  return (n ^ 0xffffffff) >>> 0;
}
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(cryptoApi, value) { return hex(await cryptoApi.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value)); }

/** JSON with sorted object keys and no whitespace (the identity's canonical form). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** archive_id: SHA-256 over the canonical packet's hash and the sorted unique clip hashes. */
export async function ssArchiveId(packet, cryptoApi = globalThis.crypto) {
  const hashes = [...new Set((packet?.asset_bindings ?? []).map(b => b?.sha256))].sort();
  return sha256(cryptoApi, `seamless-scene-edit/1\n${await sha256(cryptoApi, canonicalJson(packet))}\n${hashes.join('\n')}`);
}
export const signatureMessage = archiveId => encoder.encode(SIG_PREFIX + archiveId);

/** A safe entry path: forward slashes, no traversal, absolute paths, backslashes or device names. */
export function safeEntryPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 256 && !path.includes('\\') && !path.startsWith('/') &&
    !/^[A-Za-z]:/.test(path) && /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(path) &&
    !path.split('/').some(p => p === '.' || p === '..' || p.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
const versionParts = v => typeof v === 'string' && /^\d{1,4}(\.\d{1,5}){0,2}$/.test(v) ? v.split('.').map(Number) : null;
export function versionAtLeast(have, need) {
  const a = versionParts(have), b = versionParts(need);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; }
  return true;
}
const base64url = bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromBase64url = text => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==');
  return Uint8Array.from(binary, c => c.charCodeAt(0));
};
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, keys) => plain(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const text = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

function readDetails(value) {
  if (!plain(value)) fail('ss-details-invalid');
  const out = {};
  for (const [key, max] of [['title', 200], ['description', 2000], ['creator_name', 120], ['show_title', 200], ['episode_title', 200]]) {
    const t = text(value[key], max); if (t) out[key] = t;
  }
  if (Array.isArray(value.tags)) out.tags = value.tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 20).map(t => t.trim().slice(0, 40));
  // E70 R2: the publication settings an edit pack gave (valid values only), and what is still missing.
  const status = listingStatus(value.listing);
  out.listing = Object.freeze(status.listing); out.listingMissing = Object.freeze(status.missing.map(m => Object.freeze(m)));
  return Object.freeze(out);
}

/**
 * Reads a .ss file. trustedKeys: [{ kid, jwk }] Ed25519 keys a "site" signature may use.
 * Returns the header, packet, details, signature status, archive_id and zero-copy entries.
 */
export async function readSsArchive(file, { signal, trustedKeys = [], extensionVersion = null, cryptoApi = globalThis.crypto } = {}) {
  insist(file && typeof file.slice === 'function' && Number.isSafeInteger(file.size), 'ss-not-archive');
  insist(file.size >= 22, 'ss-not-archive');
  insist(file.size <= SS_LIMITS.totalBytes, 'ss-limits', 'file');
  const bytesOf = async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
  // End of central directory: the last signature whose comment reaches the end of the file.
  const tailStart = Math.max(0, file.size - 65_557), tail = await bytesOf(tailStart, file.size), tv = new DataView(tail.buffer);
  let end = -1;
  for (let p = tail.length - 22; p >= 0; p--) if (tv.getUint32(p, true) === 0x06054b50 && p + 22 + tv.getUint16(p + 20, true) === tail.length) { end = p; break; }
  insist(end >= 0, 'ss-not-archive');
  // A ZIP64 end-of-central-directory locator sits just before the end record.
  if (end >= 20 && tv.getUint32(end - 20, true) === 0x07064b50) fail('ss-zip64');
  const disk = tv.getUint16(end + 4, true), cdDisk = tv.getUint16(end + 6, true), countHere = tv.getUint16(end + 8, true), count = tv.getUint16(end + 10, true);
  const cdSize = tv.getUint32(end + 12, true), cdOffset = tv.getUint32(end + 16, true);
  if (count === 0xffff || countHere === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail('ss-zip64');
  insist(disk === 0 && cdDisk === 0 && countHere === count, 'ss-multivolume');
  const endOffset = tailStart + end;
  insist(count >= 2 && count <= SS_LIMITS.clips + 5, 'ss-limits', 'entries');
  insist(cdSize <= 1_048_576 && cdOffset + cdSize === endOffset, 'ss-directory');
  const cd = await bytesOf(cdOffset, cdOffset + cdSize), v = new DataView(cd.buffer);
  const entries = new Map(), folded = new Set(), ranges = [];
  let p = 0, total = 0;
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted?.();
    insist(p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50, 'ss-directory');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const packed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true), nl = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true), diskStart = v.getUint16(p + 34, true), external = v.getUint32(p + 38, true), local = v.getUint32(p + 42, true);
    insist(p + 46 + nl + extra + comment <= cd.length, 'ss-directory');
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff || diskStart === 0xffff) fail('ss-zip64');
    for (let q = p + 46 + nl; q + 4 <= p + 46 + nl + extra;) { const id = v.getUint16(q, true), len = v.getUint16(q + 2, true); if (id === 0x0001) fail('ss-zip64'); q += 4 + len; }
    let path;
    try { path = decoder.decode(cd.subarray(p + 46, p + 46 + nl)); } catch { fail('ss-entry-path'); }
    insist(safeEntryPath(path), path.endsWith('/') ? 'ss-unexpected-entry' : 'ss-entry-path', path.slice(0, 80));
    insist(!folded.has(path.toLowerCase()), 'ss-duplicate', path);
    folded.add(path.toLowerCase());
    if (flags & 0x0001) fail('ss-encrypted', path);
    insist((flags & ~0x0800) === 0, 'ss-flags', path);
    insist(method === 0, CLIP.test(path) ? 'ss-compressed' : 'ss-compressed', path);
    insist(comment === 0 && diskStart === 0, 'ss-directory', path);
    insist(((external >>> 16) & 0xf000) !== 0xa000 && ((external >>> 16) & 0xf000) !== 0x4000, 'ss-unexpected-entry', path);
    insist(packed === size, 'ss-size', path);
    const allowed = [HEADER, PACKET, DETAILS, POSTER, SIGNATURE].includes(path) || CLIP.test(path);
    insist(allowed, 'ss-unexpected-entry', path);
    const max = CLIP.test(path) ? SS_LIMITS.clipBytes : path === POSTER ? SS_LIMITS.posterBytes : path === DETAILS ? SS_LIMITS.detailsBytes
      : path === SIGNATURE ? SS_LIMITS.signatureBytes : SS_LIMITS.jsonBytes;
    insist(size <= max, 'ss-limits', path);
    total += size;
    insist(total <= SS_LIMITS.totalBytes, 'ss-limits', 'total');
    // The local header must agree with the central record (no data descriptors).
    insist(local + 30 <= cdOffset, 'ss-header-mismatch', path);
    const h = await bytesOf(local, local + 30), hv = new DataView(h.buffer);
    insist(hv.getUint32(0, true) === 0x04034b50, 'ss-header-mismatch', path);
    const lnl = hv.getUint16(26, true), lextra = hv.getUint16(28, true);
    insist(hv.getUint16(6, true) === flags && hv.getUint16(8, true) === method && hv.getUint32(14, true) === crc &&
      hv.getUint32(18, true) === packed && hv.getUint32(22, true) === size && lnl === nl, 'ss-header-mismatch', path);
    const lname = await bytesOf(local + 30, local + 30 + lnl);
    let localPath = null; try { localPath = decoder.decode(lname); } catch {}
    insist(localPath === path, 'ss-header-mismatch', path);
    if (lextra) {
      const ex = await bytesOf(local + 30 + lnl, local + 30 + lnl + lextra), ev = new DataView(ex.buffer);
      for (let q = 0; q + 4 <= ex.length;) { if (ev.getUint16(q, true) === 0x0001) fail('ss-zip64'); q += 4 + ev.getUint16(q + 2, true); }
    }
    const start = local + 30 + lnl + lextra, stop = start + size;
    insist(stop <= cdOffset, 'ss-size', path);
    insist(!ranges.some(([a, b]) => local < b && stop > a), 'ss-overlap', path);
    ranges.push([local, stop]);
    entries.set(path, { path, local, offset: start, size, crc });
    p += 46 + nl + extra + comment;
  }
  insist(p === cd.length, 'ss-directory');
  const header = entries.get(HEADER);
  insist(header && header.local === 0, 'ss-header-invalid', 'seamless-edit.json must be the first entry');
  insist(entries.has(PACKET), 'ss-packet-invalid', 'missing edit-packet.json');
  // Small entries: CRC-32 and JSON; clip bytes are checked by SHA-256 on import.
  const blobOf = e => file.slice(e.offset, e.offset + e.size);
  const checked = async e => { const blob = blobOf(e); insist(await crc32(blob, signal) === e.crc, 'ss-crc', e.path); return blob; };
  const json = async (e, code) => { try { return JSON.parse(decoder.decode(await (await checked(e)).arrayBuffer())); } catch (error) { if (error instanceof SsArchiveError) throw error; fail(code); } };
  const head = await json(header, 'ss-header-invalid');
  insist(exactKeys(head, ['format', 'version', 'archive_id', 'created_at', 'generator', 'min_extension']) && head.format === SS_FORMAT &&
    head.version === SS_VERSION && /^[a-f0-9]{64}$/.test(head.archive_id) && typeof head.created_at === 'string' && head.created_at.length <= 40 &&
    !Number.isNaN(Date.parse(head.created_at)) && typeof head.generator === 'string' && head.generator.length <= 100 && versionParts(head.min_extension),
  'ss-header-invalid');
  if (extensionVersion && !versionAtLeast(extensionVersion, head.min_extension)) fail('ss-newer-extension', head.min_extension);
  const packetBlob = await checked(entries.get(PACKET));
  let packetText, packet;
  try { packetText = decoder.decode(await packetBlob.arrayBuffer()); packet = JSON.parse(packetText); } catch { fail('ss-packet-invalid'); }
  const validation = validateLocalUserEditPacket(packet);
  insist(validation.ok, 'ss-packet-invalid', JSON.stringify(validation.errors?.[0] ?? '').slice(0, 160));
  // Clip entries and bindings match one to one, by name.
  const clipPaths = [...entries.keys()].filter(path => CLIP.test(path));
  insist(clipPaths.length <= SS_LIMITS.clips, 'ss-limits', 'clips');
  const bound = new Set();
  for (const binding of packet.asset_bindings) {
    insist(binding.relative_path === `clips/${binding.sha256}.mp4`, 'ss-clips-mismatch', binding.relative_path);
    insist(entries.has(binding.relative_path), 'ss-clips-mismatch', `missing ${binding.relative_path}`);
    bound.add(binding.relative_path);
  }
  insist(clipPaths.every(path => bound.has(path)), 'ss-unexpected-entry', clipPaths.find(path => !bound.has(path)));
  const archiveId = await ssArchiveId(packet, cryptoApi);
  insist(head.archive_id === archiveId, 'ss-archive-id');
  let details = readDetails({});
  if (entries.has(DETAILS)) details = readDetails(await json(entries.get(DETAILS), 'ss-details-invalid'));
  let poster = null;
  if (entries.has(POSTER)) {
    poster = await checked(entries.get(POSTER));
    const magic = new Uint8Array(await poster.slice(0, 3).arrayBuffer());
    insist(magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff, 'ss-poster-invalid');
  }
  let signature = Object.freeze({ status: 'unsigned' });
  if (entries.has(SIGNATURE)) {
    // Present means it must verify: fail closed.
    const sig = await json(entries.get(SIGNATURE), 'ss-signature-invalid');
    insist(exactKeys(sig, ['alg', 'key_id', 'signer', 'over', 'sig']) && sig.alg === 'Ed25519' && sig.over === 'archive_id' && sig.signer === 'site' &&
      typeof sig.key_id === 'string' && sig.key_id.length <= 128, 'ss-signature-invalid');
    const raw = fromBase64url(sig.sig);
    const trusted = trustedKeys.find(key => key?.kid === sig.key_id && key.jwk?.kty === 'OKP' && key.jwk?.crv === 'Ed25519');
    insist(raw && raw.length === 64 && trusted, 'ss-signature-invalid', 'unknown key');
    let ok = false;
    try {
      const key = await cryptoApi.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: trusted.jwk.x }, { name: 'Ed25519' }, false, ['verify']);
      ok = await cryptoApi.subtle.verify({ name: 'Ed25519' }, key, raw, signatureMessage(archiveId));
    } catch {}
    insist(ok, 'ss-signature-invalid');
    signature = Object.freeze({ status: 'verified', signer: 'site', keyId: sig.key_id });
  }
  const clipBlob = sha => { const e = entries.get(`clips/${sha}.mp4`); return e ? blobOf(e) : null; };
  return Object.freeze({
    header: Object.freeze(head), packet, packetText, details, poster, signature, archiveId,
    size: file.size, clipBytes: clipPaths.reduce((n, path) => n + entries.get(path).size, 0), clipCount: clipPaths.length,
    entries: Object.freeze([...entries.values()].map(e => Object.freeze({ path: e.path, offset: e.offset, size: e.size }))),
    clipBlob,
    /** The packet and its clips as Files (zero-copy slices) for the local import path. */
    files(prefix = 'edit/') {
      const named = (blob, path, type) => {
        const f = new File([blob], path.split('/').at(-1), { type });
        Object.defineProperty(f, 'webkitRelativePath', { value: prefix + path });
        return f;
      };
      return [named(packetBlob, PACKET, 'application/json'), ...packet.asset_bindings.map(b => named(clipBlob(b.sha256), b.relative_path, 'video/mp4'))];
    }
  });
}

/** Signs an archive identity (tests and the website's export, phase P4). */
export async function signSsArchiveId(archiveId, privateKey, keyId, cryptoApi = globalThis.crypto) {
  const sig = await cryptoApi.subtle.sign({ name: 'Ed25519' }, privateKey, signatureMessage(archiveId));
  return { alg: 'Ed25519', key_id: keyId, signer: 'site', over: 'archive_id', sig: base64url(sig) };
}

/**
 * Writes a .ss file. clips: Map(sha256 → Blob). Returns { blob, archiveId }.
 * `raw` (tests only) lets a caller add or override entries to build refused files.
 */
export async function writeSsArchive({ packet, clips, details = null, poster = null, signature = null, createdAt = new Date().toISOString(),
  generator = 'Seamless Scene', minExtension = SS_MIN_EXTENSION, packetText = null, cryptoApi = globalThis.crypto, signal } = {}) {
  const validation = validateLocalUserEditPacket(packet);
  insist(validation.ok, 'ss-packet-invalid', JSON.stringify(validation.errors?.[0] ?? ''));
  for (const b of packet.asset_bindings) insist(b.relative_path === `clips/${b.sha256}.mp4` && clips?.get(b.sha256), 'ss-clips-mismatch', b.relative_path);
  const archiveId = await ssArchiveId(packet, cryptoApi);
  // 0.65.0 (A9): new files carry at most the rules' 5000 ms tolerance (older files still read).
  insist(!(packet.manifest.source.runtime_tolerance_ms > RULES.source.tolerance_ms.max), 'ss-packet-invalid', 'runtime_tolerance_ms');
  const needed = requiredClientFor(packet.manifest, 'local-user');
  if (!versionAtLeast(minExtension, needed)) minExtension = needed;
  const files = [[HEADER, new Blob([JSON.stringify({ format: SS_FORMAT, version: SS_VERSION, archive_id: archiveId, created_at: createdAt, generator, min_extension: minExtension })])],
    [PACKET, new Blob([packetText ?? JSON.stringify(packet, null, 1)])]];
  if (details) files.push([DETAILS, new Blob([JSON.stringify(details)])]);
  if (poster) files.push([POSTER, poster]);
  if (typeof signature === 'function') signature = await signature(archiveId);
  if (signature) files.push([SIGNATURE, new Blob([JSON.stringify(signature)])]);
  for (const b of packet.asset_bindings) files.push([b.relative_path, clips.get(b.sha256)]);
  return { blob: await zipStored(files, { signal, modified: new Date(createdAt) }), archiveId };
}

/** A store-only ZIP of [path, Blob] pairs, in order (no compression, no ZIP64). */
export async function zipStored(files, { signal, flags = 0x0800, modified = new Date(Date.UTC(1980, 0, 1)) } = {}) {
  const parts = [], central = [];
  // MS-DOS time and date fields (2-second resolution; 1980-01-01 when unknown).
  const when = Number.isNaN(modified?.getTime?.()) || modified.getUTCFullYear() < 1980 ? new Date(Date.UTC(1980, 0, 1)) : modified;
  const dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1);
  const dosDate = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  let offset = 0;
  for (const [path, blob] of files) {
    const name = encoder.encode(path), crc = await crc32(blob, signal);
    const h = new Uint8Array(30), hv = new DataView(h.buffer);
    hv.setUint32(0, 0x04034b50, true); hv.setUint16(4, 20, true); hv.setUint16(6, flags, true); hv.setUint16(10, dosTime, true); hv.setUint16(12, dosDate, true); hv.setUint32(14, crc, true);
    hv.setUint32(18, blob.size, true); hv.setUint32(22, blob.size, true); hv.setUint16(26, name.length, true);
    parts.push(h, name, blob);
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, flags, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, blob.size, true); cv.setUint32(24, blob.size, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); c.set(name, 46);
    central.push(c);
    offset += 30 + name.length + blob.size;
  }
  const size = central.reduce((n, c) => n + c.length, 0), e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e], { type: 'application/octet-stream' });
}

/** A human sentence for each refusal (the Local tab shows it with the file name). */
export function ssArchiveMessage(code) {
  return ({
    'ss-not-archive': 'This is not a Seamless Scene edit file.',
    'ss-newer-extension': 'This edit needs a newer version of Seamless Scene. Update the extension, then try again.',
    'ss-signature-invalid': 'This file’s signature does not check out, so it may have been changed. It was not added.',
    'ss-archive-id': 'This file’s contents do not match its identity, so it may have been changed. It was not added.',
    'ss-crc': 'This file is damaged. Ask for a new copy.',
    'ss-limits': 'This file is larger than Seamless Scene allows (2 GiB, 512 MiB per clip, 1,000 clips).',
    'ss-packet-invalid': 'This file does not contain a valid edit.',
    'ss-clips-mismatch': 'This file’s clips do not match its edit. Ask for a new copy.',
    'ss-compressed': 'This file is a compressed zip, so it is read as an edit pack (edit.json or edit-packet.json, plus clips).',
    'ss-encrypted': 'This file is encrypted, which Seamless Scene does not support.',
    'ss-zip64': 'This file uses ZIP64, so it is read as an edit pack (edit.json or edit-packet.json, plus clips).'
  })[code] ?? 'This file is not a valid Seamless Scene edit file. It was not added.';
}
