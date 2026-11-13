// Edit packs (E70, 0.64.0): an ordinary ZIP (named .zip or .ss) with edit.json (or a full
// edit-packet.json) and clips/*.mp4 under any names (a poster.jpg is ignored), normalised into
// the strict .ss v1 the extension stores and plays (docs/technical/SS_ARCHIVE_V1.md, "Edit
// pack import profile"). The reader is lenient where ordinary zip tools differ (deflate, data
// descriptors, ZIP64 extras and end records, directory entries, one wrapper folder, CP437 or
// UTF-8 names, macOS and Windows junk) and strict where it matters (encryption, traversal,
// duplicates, Deflate64, sizes and CRCs). Normalisation is deterministic, so the same pack
// always gives the same archive_id. Conformance: test/fixtures/edit-pack-vectors/.
import { writeSsArchive, SS_LIMITS } from './ss-archive.mjs';
import { validateLocalUserEditPacket, supportsLocalEditDimensions, jsonTooDeep } from './local-edit-packet.mjs';
import { inspectMp4Format } from './mp4-format-probe.mjs';
import { sha256Hex } from './local-file-hash.mjs';
import { isSystemFilePath } from './system-files.mjs';
import { listingStatus } from './edit-pack-fields.mjs';
import { minimumAssetDurationMs, maximumAssetDurationMs } from './asset-duration-policy.mjs';
import { RULES } from './seamless-rules.mjs';
const SOURCE_RULES = RULES.source, TERRITORY = new RegExp(SOURCE_RULES.territory), VERSION_TAG = new RegExp(SOURCE_RULES.version_tag.pattern);

export const PACK_FORMAT = 'seamless-edit-pack';
export const PACK_VERIFIED_AT = '2026-01-01T00:00:00.000Z';
export const PACK_GENERATOR = 'Seamless Scene edit pack import 1';
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
// Edit packs are local-user edits: the same clip bounds as .ss and folders (0.64.2: 1.5–120 s).
const MIN_CLIP_MS = minimumAssetDurationMs('local-user'), MAX_CLIP_MS = maximumAssetDurationMs('local-user');

export class PackError extends Error {
  constructor(code, message, errors = []) { super(message); this.name = 'PackError'; this.code = code; this.errors = errors; }
}
const fail = (code, message, errors) => { throw new PackError(code, message, errors); };

/** Plain sentences for the Local tab (the message itself names the clip or field). */
export const PACK_MESSAGES = Object.freeze({
  'pack-deflate64': 'This zip uses Deflate64 (Windows makes it for large folders), which browsers cannot read. Re-zip with 7-Zip (Deflate or Store).',
  'pack-encrypted': 'This zip is password-protected. Zip the folder again without a password.',
  'pack-not-zip': 'This is not a zip or .ss file.'
});

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const utf8 = new TextDecoder('utf-8', { fatal: true });
const decodeName = (bytes, flags) => {
  if (flags & 0x800) { try { return utf8.decode(bytes); } catch { fail('pack-not-zip', 'A file name in this zip is not valid UTF-8.'); } }
  let out = ''; for (const b of bytes) out += b < 128 ? String.fromCharCode(b) : CP437[b - 128]; return out;
};
const table = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crcUpdate = (crc, chunk) => { let n = crc; for (let i = 0; i < chunk.length; i++) n = table[(n ^ chunk[i]) & 255] ^ (n >>> 8); return n; };
const u64 = (v, p) => v.getUint32(p, true) + v.getUint32(p + 4, true) * 2 ** 32;
// 0.64.4 (security review F2): an entry may unpack at most this many times its packed size
// (H.264/AAC barely compresses; JSON may). Entries under 1 MiB are not limited (harmless).
export const PACK_RATIO_LIMITS = Object.freeze({ clip: RULES.archive.ratio.clip, other: RULES.archive.ratio.other, minBytes: RULES.archive.ratio.exempt_below });
// F2: a clip's first bytes (its MP4 header) are checked before the rest is unpacked.
export const PACK_HEADER_BYTES = 4_194_304;
// F5: bounds on hostile structures.
export const PACK_MAX_MP4_BOXES = 10_000, PACK_MAX_JSON_DEPTH = RULES.archive.json_depth;
const damaged = () => fail('pack-not-zip', 'This zip is damaged, so it was not read.');

/**
 * Reads a zip's directory: returns Map(path → entry) after skipping directories and system
 * files and removing one wrapper folder. Entry data is not read here.
 */
export async function readEditPack(file, options = {}) {
  // F5 (0.64.4): anything unexpected in a malformed zip is a plain refusal, not a RangeError.
  try { return await readEditPackDirectory(file, options); }
  catch (error) { if (error instanceof PackError || error?.name === 'AbortError') throw error; damaged(); }
}
async function readEditPackDirectory(file, { signal } = {}) {
  if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size) || file.size < 22) fail('pack-not-zip', PACK_MESSAGES['pack-not-zip']);
  const bytesOf = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
  const tailStart = Math.max(0, file.size - 65_557), tail = await bytesOf(tailStart, file.size), tv = new DataView(tail.buffer);
  let end = -1;
  for (let p = tail.length - 22; p >= 0; p--) if (tv.getUint32(p, true) === 0x06054b50 && p + 22 + tv.getUint16(p + 20, true) === tail.length) { end = p; break; }
  if (end < 0) fail('pack-not-zip', PACK_MESSAGES['pack-not-zip']);
  let count = tv.getUint16(end + 10, true), cdSize = tv.getUint32(end + 12, true), cdOffset = tv.getUint32(end + 16, true);
  // ZIP64 end record (tolerated): its locator sits just before the end record.
  if (end >= 20 && tv.getUint32(end - 20, true) === 0x07064b50) {
    const at = u64(tv, end - 12);
    if (at + 56 > file.size) damaged();
    const rec = await bytesOf(at, at + 56), rv = new DataView(rec.buffer);
    if (rv.getUint32(0, true) !== 0x06064b50) fail('pack-not-zip', 'This zip’s ZIP64 directory is damaged.');
    count = u64(rv, 32); cdSize = u64(rv, 40); cdOffset = u64(rv, 48);
  }
  if (count > 4000 || cdSize > 8_388_608 || cdOffset + cdSize > file.size) fail('pack-not-zip', 'This zip’s directory is damaged or too large.');
  const cd = await bytesOf(cdOffset, cdOffset + cdSize), v = new DataView(cd.buffer);
  const raw = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted?.();
    if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) fail('pack-not-zip', 'This zip’s directory is damaged.');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    let packed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    if (p + 46 + nl + xl + cl > cd.length) fail('pack-not-zip', 'This zip’s directory is damaged.');
    let local = v.getUint32(p + 42, true);
    let name = decodeName(cd.subarray(p + 46, p + 46 + nl), flags);
    const extraEnd = p + 46 + nl + xl;
    for (let q = p + 46 + nl; q + 4 <= extraEnd;) {
      const id = v.getUint16(q, true), len = v.getUint16(q + 2, true); let r = q + 4;
      if (q + 4 + len > extraEnd) fail('pack-not-zip', 'This zip’s directory is damaged.');
      const u64In = () => { if (r + 8 > q + 4 + len) fail('pack-not-zip', 'This zip’s directory is damaged.'); const value = u64(v, r); r += 8; return value; };
      if (id === 0x0001) {
        if (size === 0xffffffff) size = u64In();
        if (packed === 0xffffffff) packed = u64In();
        if (local === 0xffffffff) local = u64In();
      } else if (id === 0x7075 && len > 5) { try { name = utf8.decode(cd.subarray(q + 9, q + 4 + len)); } catch {} }
      q += 4 + len;
    }
    raw.push({ name, flags, method, crc, packed, size, local });
    p += 46 + nl + xl + cl;
  }
  const kept = [];
  for (const e of raw) {
    const path = e.name.replaceAll('\\', '/').replace(/^\.\//, '');
    if (path.endsWith('/')) continue;
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(s => s === '..' || s === '.'))
      fail('pack-traversal', `“${e.name}” points outside the pack, so the zip was not read.`);
    if (isSystemFilePath(path)) continue;
    if (e.flags & 0x41) fail('pack-encrypted', PACK_MESSAGES['pack-encrypted']);
    if (e.method === 9) fail('pack-deflate64', PACK_MESSAGES['pack-deflate64']);
    if (e.method !== 0 && e.method !== 8) fail('pack-method', `“${path}” uses a compression this browser cannot read (method ${e.method}). Zip the folder again with Deflate or Store.`);
    // F2 (0.64.4): a compression ratio no clip or edit file has is refused before anything is unpacked.
    const cap = /\.json$/i.test(path) ? PACK_RATIO_LIMITS.other : /\.mp4$/i.test(path) || /^clips\//i.test(path) ? PACK_RATIO_LIMITS.clip : PACK_RATIO_LIMITS.other;
    if (e.method === 8 && e.size > PACK_RATIO_LIMITS.minBytes && e.size > cap * Math.max(1, e.packed))
      fail('pack-ratio', `“${path}” unpacks to ${Math.round(e.size / Math.max(1, e.packed))} times its packed size, which no clip or edit file does, so the zip was not read.`);
    kept.push({ ...e, path });
  }
  // One wrapper folder ("My Edit/edit.json") is removed.
  const rootHas = name => kept.some(e => e.path === name);
  if (!rootHas('edit.json') && !rootHas('edit-packet.json')) {
    const tops = new Set(kept.map(e => e.path.split('/')[0]));
    if (tops.size === 1 && kept.every(e => e.path.includes('/'))) {
      const [top] = tops;
      for (const e of kept) e.path = e.path.slice(top.length + 1);
    }
  }
  const entries = new Map(), folded = new Set();
  let total = 0;
  for (const e of kept) {
    if (folded.has(e.path.toLowerCase())) fail('pack-duplicate', `“${e.path}” appears twice in the zip.`);
    folded.add(e.path.toLowerCase());
    total += e.size;
    if (total > SS_LIMITS.totalBytes) fail('pack-limits', 'This pack is larger than 2 GiB.');
    // The local header gives where the data starts (its own name and extra lengths).
    if (!Number.isSafeInteger(e.local) || e.local + 30 > file.size) fail('pack-not-zip', `“${e.path}” is damaged in the zip.`);
    const h = await bytesOf(e.local, e.local + 30), hv = new DataView(h.buffer);
    if (h.length < 30 || hv.getUint32(0, true) !== 0x04034b50) fail('pack-not-zip', `“${e.path}” is damaged in the zip.`);
    const dataStart = e.local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    if (dataStart + e.packed > file.size) fail('pack-not-zip', `“${e.path}” is cut short in the zip.`);
    entries.set(e.path, { ...e, dataStart });
  }
  // F2: unpacking may never produce more than the directory declares in total.
  return { entries, file, budget: total, inflated: 0 };
}

/** Memory staging (tests and small entries). */
export function memoryStage() {
  return { async sink() { const parts = []; return { write: async c => { parts.push(c.slice()); }, close: async () => new Blob(parts), abort: async () => {} }; }, async cleanup() {} };
}
/** OPFS staging under local/.staging/<uuid>/ (removed by cleanup, and by cleanupPackStaging). */
// F4 (0.64.4): each import stages in its own local/.staging/<uuid>/ with a "started" marker;
// cleanup removes only directories older than this, never a running import's.
export const STAGING_STALE_MS = 6 * 3_600_000;
export async function opfsStage(root, cryptoApi = globalThis.crypto) {
  const staging = await root.getDirectoryHandle('.staging', { create: true }), name = cryptoApi.randomUUID();
  const dir = await staging.getDirectoryHandle(name, { create: true });
  try { const marker = await (await dir.getFileHandle('started', { create: true })).createWritable(); await marker.write(String(Date.now())); await marker.close(); } catch {}
  let n = 0;
  return {
    async sink() {
      const handle = await dir.getFileHandle(`${n++}.bin`, { create: true }), writable = await handle.createWritable();
      return { write: c => writable.write(c), close: async () => { await writable.close(); return handle.getFile(); }, abort: () => writable.abort?.() };
    },
    async cleanup() { try { await staging.removeEntry(name, { recursive: true }); } catch {} }
  };
}
/** Removes staging left by closed pages: only directories whose marker (or newest file) is older than staleMs. */
export async function cleanupPackStaging(root, { staleMs = STAGING_STALE_MS, now = Date.now() } = {}) {
  let staging; try { staging = await root.getDirectoryHandle('.staging'); } catch { return 0; }
  let removed = 0;
  try {
    for await (const [name, entry] of staging.entries()) {
      if (entry.kind !== 'directory') continue;
      let newest = -Infinity;
      try {
        for await (const [, child] of entry.entries()) if (child.kind === 'file') newest = Math.max(newest, (await child.getFile()).lastModified);
      } catch { continue; }
      if (newest === -Infinity || now - newest > staleMs) { try { await staging.removeEntry(name, { recursive: true }); removed += 1; } catch {} }
    }
  } catch {}
  return removed;
}

/** An entry's bytes: STORED entries as a zero-copy slice, DEFLATE streamed through staging; CRC and size checked. */
export async function entryBlob(pack, entry, { stage, signal, headerCheck = null, headerBytes = PACK_HEADER_BYTES } = {}) {
  const slice = pack.file.slice(entry.dataStart, entry.dataStart + entry.packed);
  let crc = 0xffffffff, size = 0, blob;
  if (entry.method === 0) {
    if (entry.packed !== entry.size) fail('pack-clip-size', `${entry.path}: its size in the zip does not match its data.`);
    // F2: the header is checked before the rest is read.
    if (headerCheck) await headerCheck(new Uint8Array(await slice.slice(0, Math.min(headerBytes, entry.size)).arrayBuffer()));
    const reader = slice.stream().getReader();
    for (;;) { signal?.throwIfAborted?.(); const { done, value } = await reader.read(); if (done) break; crc = crcUpdate(crc, value); size += value.length; }
    blob = slice;
  } else {
    const sink = await (stage ?? memoryStage()).sink();
    try {
      const reader = slice.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      // F2 (0.64.4): the first headerBytes are held and checked before anything more is unpacked.
      let head = headerCheck ? [] : null, headSize = 0;
      const checkHead = async () => { const parts = head; head = null; const bytes = new Uint8Array(headSize); let at = 0; for (const c of parts) { bytes.set(c, at); at += c.length; } await headerCheck(bytes.subarray(0, Math.min(headSize, headerBytes))); };
      try {
        for (;;) {
          signal?.throwIfAborted?.();
          let step; try { step = await reader.read(); } catch { fail('pack-clip-crc', `${entry.path}: its compressed data is damaged.`); }
          if (step.done) break;
          size += step.value.length;
          if (size > entry.size) fail('pack-clip-size', `${entry.path}: it unpacks larger than the zip says.`);
          if (pack.budget !== undefined && (pack.inflated += step.value.length) > pack.budget) fail('pack-limits', 'This zip unpacks to more than its directory declares, so it was not read.');
          crc = crcUpdate(crc, step.value);
          await sink.write(step.value);
          if (head) { head.push(step.value.slice()); headSize += step.value.length; if (headSize >= headerBytes) await checkHead(); }
        }
        if (head) await checkHead();
      } finally { reader.cancel?.().catch?.(() => {}); }
      blob = await sink.close();
    } catch (error) { await sink.abort?.()?.catch?.(() => {}); throw error; }
  }
  if (size !== entry.size) fail('pack-clip-size', `${entry.path}: its size does not match the zip directory.`);
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail('pack-clip-crc', `${entry.path}: it is damaged (checksum mismatch). Zip the folder again.`);
  return blob;
}

/** Duration (mvhd, rounded half up to ms) and the video track's tkhd size: container values, the same in every implementation. */
export async function measureMp4(blob) {
  const read = async (a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());
  let p = 0, moov = null, count = 0;
  while (p + 8 <= blob.size) {
    if (++count > PACK_MAX_MP4_BOXES) return null; // F5: a file of millions of tiny boxes
    const h = await read(p, p + 16), hv = new DataView(h.buffer);
    let size = hv.getUint32(0), header = 8; const type = String.fromCharCode(...h.subarray(4, 8));
    if (size === 1) { size = hv.getUint32(8) * 2 ** 32 + hv.getUint32(12); header = 16; }
    if (size === 0) size = blob.size - p;
    if (size < header) break;
    if (type === 'moov') { if (size > 16_777_216) return null; moov = await read(p + header, p + size); break; }
    p += size;
  }
  if (!moov) return null;
  const v = new DataView(moov.buffer);
  const boxes = (s, e) => { const out = []; let q = s; while (q + 8 <= e && out.length < PACK_MAX_MP4_BOXES) { let size = v.getUint32(q), header = 8; if (size === 1) { size = v.getUint32(q + 8) * 2 ** 32 + v.getUint32(q + 12); header = 16; } if (size === 0) size = e - q; if (size < header || q + size > e) break; out.push({ type: String.fromCharCode(...moov.subarray(q + 4, q + 8)), s: q + header, e: q + size }); q += size; } return out; };
  const top = boxes(0, moov.length), mvhd = top.find(b => b.type === 'mvhd');
  if (!mvhd) return null;
  let timescale, duration;
  if (moov[mvhd.s] === 1) { timescale = v.getUint32(mvhd.s + 20); duration = v.getUint32(mvhd.s + 24) * 2 ** 32 + v.getUint32(mvhd.s + 28); }
  else { timescale = v.getUint32(mvhd.s + 12); duration = v.getUint32(mvhd.s + 16); }
  if (!timescale) return null;
  const durationMs = Math.floor((duration * 1000 + Math.floor(timescale / 2)) / timescale);
  for (const trak of top.filter(b => b.type === 'trak')) {
    const inner = boxes(trak.s, trak.e), mdia = inner.find(b => b.type === 'mdia'), tkhd = inner.find(b => b.type === 'tkhd');
    const hdlr = mdia && boxes(mdia.s, mdia.e).find(b => b.type === 'hdlr');
    if (!hdlr || !tkhd || String.fromCharCode(...moov.subarray(hdlr.s + 8, hdlr.s + 12)) !== 'vide') continue;
    return { durationMs, width: v.getUint32(tkhd.e - 8) >>> 16, height: v.getUint32(tkhd.e - 4) >>> 16 };
  }
  return null;
}

/** "h:mm:ss.mmm" / "mm:ss.mmm" / milliseconds → ms, or null. */
export function packTimeMs(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!m) return null;
  const [, h, mi, se, frac] = m;
  if (Number(se) > 59 || (h !== undefined && Number(mi) > 59)) return null;
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + Number((frac ?? '0').padEnd(3, '0'));
}
const clock = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
const seconds = ms => `${+(ms / 1000).toFixed(3)} s`;
const text = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** The source, scenes and details from edit.json; every problem is listed, by field. */
export function readEditJson(edit, entries) {
  const errors = [];
  const need = (ok, message) => { if (!ok) errors.push(message); return ok; };
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) fail('pack-field', 'edit.json must be a JSON object.', ['edit.json must be a JSON object']);
  need(edit.format === undefined || edit.format === PACK_FORMAT, `format must be "${PACK_FORMAT}"`);
  need(edit.version === undefined || edit.version === 1, 'version must be 1');
  need(typeof edit.id === 'string' && ID.test(edit.id), 'id missing or invalid (lowercase letters, digits, . _ -; at most 128)');
  // R2 (0.64.1): publication settings (title … revision) never block local play; they are read
  // into the listing with what is missing or invalid ("Not ready to submit").
  const status = listingStatus(edit);
  const ep = edit.episode;
  if (need(ep && typeof ep === 'object', 'episode missing')) {
    need(typeof ep.gti === 'string' && ep.gti.trim(), 'episode.gti missing');
    need(typeof ep.show === 'string' && ep.show.trim(), 'episode.show missing');
    need(Number.isSafeInteger(ep.season) && ep.season >= 0, 'episode.season must be a whole number');
    need(Number.isSafeInteger(ep.episode) && ep.episode >= 0, 'episode.episode must be a whole number');
    need(Number.isSafeInteger(ep.runtime_ms) && ep.runtime_ms > 0, 'episode.runtime_ms missing (the episode length in ms)');
    // 0.64.3 / website r39 (joint revision): the optional source facts are checked, never kept when
    // invalid (the catalog accepts only these). Absent ones keep their defaults: US and 3000. 0.65.4 (owner, 2026-10-19):
    // an absent tier is "unverified", never a guessed "ad-free"; the catalog asks for ad-free or ad-supported.
    need(ep.runtime_tolerance_ms === undefined || (Number.isSafeInteger(ep.runtime_tolerance_ms) && ep.runtime_tolerance_ms >= 0 && ep.runtime_tolerance_ms <= SOURCE_RULES.tolerance_ms.max), `episode.runtime_tolerance_ms must be 0–${SOURCE_RULES.tolerance_ms.max}`);
    need(ep.territory === undefined || (typeof ep.territory === 'string' && TERRITORY.test(ep.territory)), 'episode.territory must be a two-letter country code, such as US');
    need(ep.tier === undefined || SOURCE_RULES.local_tiers.includes(ep.tier), `episode.tier must be ${SOURCE_RULES.local_tiers.map(t => `"${t}"`).join(' or ')}`);
    // 0.64.4 (F8, with the website): the manifest's ID rule, capped at the catalog's 120.
    need(ep.version_tag === undefined || (typeof ep.version_tag === 'string' && ep.version_tag.length <= SOURCE_RULES.version_tag.max && VERSION_TAG.test(ep.version_tag)), `episode.version_tag must be at most ${SOURCE_RULES.version_tag.max} characters: lowercase letters, digits, . _ - (starting with a letter or digit)`);
    need(ep.service === undefined || ep.service === 'prime-video', 'episode.service must be "prime-video"');
  }
  const scenes = [];
  if (need(Array.isArray(edit.scenes) && edit.scenes.length > 0, 'scenes missing (at least one)')) {
    for (const [i, s] of edit.scenes.entries()) {
      const n = i + 1;
      if (!need(s && typeof s === 'object', `scene ${n} must be an object`)) continue;
      if (!need(s.action === 'REPLACE' || s.action === 'INSERT', `scene ${n}: action must be REPLACE or INSERT`)) continue;
      let start, end;
      if (s.action === 'INSERT') { start = end = packTimeMs(s.at ?? s.start); need(start !== null, `scene ${n}: at missing or not a time (ms, or h:mm:ss.mmm)`); }
      else {
        start = packTimeMs(s.start); end = packTimeMs(s.end);
        need(start !== null, `scene ${n}: start missing or not a time (ms, or h:mm:ss.mmm)`);
        need(end !== null, `scene ${n}: end missing or not a time (ms, or h:mm:ss.mmm)`);
        if (start !== null && end !== null) need(end > start, `scene ${n}: end must be after start`);
      }
      if (ep && Number.isSafeInteger(ep.runtime_ms) && start !== null && end !== null) need(end <= ep.runtime_ms, `scene ${n}: ${clock(end)} is past the episode’s end (${clock(ep.runtime_ms)})`);
      need(s.gain_db === undefined || (Number.isSafeInteger(s.gain_db) && s.gain_db >= -24 && s.gain_db <= 6), `scene ${n}: gain_db must be a whole number from -24 to 6`);
      const clip = typeof s.clip === 'string' ? s.clip.replaceAll('\\', '/').replace(/^\.\//, '') : null;
      if (need(clip, `scene ${n}: clip missing`) && !entries.has(clip)) {
        const loose = [...entries.keys()].filter(k => k.toLowerCase() === clip.toLowerCase());
        if (loose.length !== 1) fail('pack-clip-missing', `scene ${n}: ${clip} is not in the pack.`, [`scene ${n}: ${clip} is not in the pack`]);
        scenes.push({ n, action: s.action, start, end, clip: loose[0], gain: s.gain_db });
        continue;
      }
      scenes.push({ n, action: s.action, start, end, clip, gain: s.gain_db });
    }
  }
  if (errors.length) fail('pack-field', `edit.json: ${errors.join('; ')}.`, errors);
  // Sorted by time (file order breaks ties); overlaps and double inserts are named by file number.
  scenes.sort((a, b) => a.start - b.start || a.end - b.end || a.n - b.n);
  let lastReplace = null; const insertsAt = new Map();
  for (const s of scenes) {
    if (s.action === 'REPLACE') {
      if (lastReplace && s.start < lastReplace.end) errors.push(`scene ${s.n} overlaps scene ${lastReplace.n}`);
      if (!lastReplace || s.end > lastReplace.end) lastReplace = s;
    } else {
      if (insertsAt.has(s.start)) errors.push(`scene ${s.n} and scene ${insertsAt.get(s.start)} insert at the same time`);
      else insertsAt.set(s.start, s.n);
      if (lastReplace && s.start > lastReplace.start && s.start < lastReplace.end) errors.push(`scene ${s.n} inserts inside scene ${lastReplace.n}`);
    }
  }
  if (errors.length) fail('pack-field', `edit.json: ${errors.join('; ')}.`, errors);
  const source = { service: ep.service ?? 'prime-video', territory: ep.territory ?? SOURCE_RULES.local_unknown_territory, service_content_id: ep.gti.trim(), title: ep.show.trim(),
    season: ep.season, episode: ep.episode, expected_runtime_ms: ep.runtime_ms, runtime_tolerance_ms: ep.runtime_tolerance_ms ?? SOURCE_RULES.tolerance_ms.default,
    service_tier: ep.tier ?? SOURCE_RULES.local_default_tier, version_tag: ep.version_tag ?? 'creator-reported' };
  const details = {};
  for (const [key, value, max] of [['title', edit.title, 200], ['description', edit.description, 2000], ['creator_name', edit.creator_name, 120], ['episode_title', ep.episode_title, 200]]) {
    const t = text(value, max); if (t) details[key] = t;
  }
  details.show_title = ep.show.trim().slice(0, 200);
  if (Array.isArray(status.listing.tags)) details.tags = status.listing.tags;
  details.listing = status.listing;
  // R3: the manifest schema requires content.spoilers and content.warnings; generated packets carry
  // the fixed format constants {spoilers:false, warnings:[]} (not settings; edit.json's spoilers,
  // synthetic_media, real_person_likeness and warnings keys are ignored). A pack without a revision
  // plays as manifest_version 1 and is reported "Not ready to submit: revision".
  const content = { spoilers: false, warnings: [] };
  return { id: edit.id, revision: status.listing.revision ?? 1, source, scenes, details, content, missing: status.missing };
}

/**
 * Normalises an edit pack into a strict .ss File. hash(blob) → sha256 hex; stage provides
 * staging sinks for deflated entries. Returns { file, archiveId, fromPack: true }.
 */
export async function normalizeEditPack(file, { stage = null, hash = blob => sha256Hex(blob, { maxBytes: SS_LIMITS.clipBytes }), inspectFormat = inspectMp4Format,
  signal, onProgress = () => {}, cryptoApi = globalThis.crypto } = {}) {
  const progress = (done, total) => { try { onProgress({ phase: 'converting', done, total }); } catch {} };
  const pack = await readEditPack(file, { signal });
  const { entries } = pack;
  const jsonOf = async (path, max = 1_048_576) => {
    const entry = entries.get(path);
    if (entry.size > max) fail('pack-field', `${path} is larger than ${Math.round(max / 1024)} KiB.`);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await (await entryBlob(pack, entry, { signal })).arrayBuffer())); }
    catch (error) { if (error instanceof PackError || error?.name === 'AbortError') throw error; fail('pack-json', `${path} is not valid JSON: ${String(error?.message ?? '').slice(0, 120)}`); }
    // F5 (0.64.4): deep nesting is refused before anything copies it.
    if (jsonTooDeep(value, PACK_MAX_JSON_DEPTH)) fail('pack-json', `${path} is nested more than ${PACK_MAX_JSON_DEPTH} levels deep.`);
    return value;
  };
  // F2 (0.64.4): a clip's MP4 header, checked on its first bytes before the rest is unpacked: it
  // must start with ftyp and, when its moov comes first (as in streamable MP4s), be H.264 + AAC.
  const formatRefusal = path => fail('pack-clip-format', `${path}: not H.264 + AAC in an MP4 (one video and one audio stream).`);
  const mp4Header = path => async prefix => {
    if (prefix.length < 8 || String.fromCharCode(...prefix.subarray(4, 8)) !== 'ftyp') formatRefusal(path);
    const v = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    for (let q = 0, n = 0; q + 8 <= prefix.length && n < 64; n++) {
      let size = v.getUint32(q); const type = String.fromCharCode(...prefix.subarray(q + 4, q + 8));
      if (size === 1) { if (q + 16 > prefix.length) break; size = v.getUint32(q + 8) * 2 ** 32 + v.getUint32(q + 12); }
      if (size === 0 || type === 'mdat') break;
      if (size < 8) formatRefusal(path);
      if (type === 'moov') {
        if (q + size > prefix.length) break;
        let format = null; try { format = await inspectFormat(new Blob([prefix.subarray(0, q + size)]), { signal }); } catch {}
        if (!format || format.videoCodec !== 'h264' || format.audioCodec !== 'aac') formatRefusal(path);
        break;
      }
      q += size;
    }
  };
  const clipOf = async path => {
    const entry = entries.get(path);
    if (entry.size > SS_LIMITS.clipBytes) fail('pack-clip-size', `${path}: ${Math.round(entry.size / 1e6)} MB; clips must be at most 512 MiB.`);
    return entryBlob(pack, entry, { stage, signal, headerCheck: mp4Header(path) });
  };
  let packet, details = {}, clips = new Map();
  if (entries.has('edit.json')) {
    const plan = readEditJson(await jsonOf('edit.json'), entries);
    const byPath = new Map(), unique = [...new Set(plan.scenes.map(s => s.clip))];
    for (const [i, path] of unique.entries()) {
      progress(i, unique.length);
      const blob = await clipOf(path), sha = await hash(blob);
      let format = null; try { format = await inspectFormat(blob, { signal }); } catch {}
      if (!format || format.videoCodec !== 'h264' || format.audioCodec !== 'aac') formatRefusal(path);
      const measured = await measureMp4(blob);
      if (!measured) fail('pack-clip-format', `${path}: its MP4 header could not be read.`);
      if (measured.durationMs < MIN_CLIP_MS || measured.durationMs > MAX_CLIP_MS) fail('pack-clip-duration', `${path}: ${seconds(measured.durationMs)}; clips must be ${MIN_CLIP_MS / 1000}–${MAX_CLIP_MS / 1000} s.`);
      if (!supportsLocalEditDimensions(measured.width, measured.height)) fail('pack-clip-dimensions', `${path}: ${measured.width}×${measured.height}; clips must be even sizes from 320×180 to 4096×2160.`);
      byPath.set(path, { sha, blob, ...measured });
    }
    progress(unique.length, unique.length);
    const segments = [], bindings = [];
    for (const [i, s] of plan.scenes.entries()) {
      const c = byPath.get(s.clip);
      segments.push({ segment_id: `scene-${i + 1}`, action: s.action, trigger_time_ms: s.start, resume_time_ms: s.end,
        asset: { sha256: c.sha, expected_duration_ms: c.durationMs, container: 'video/mp4', video_codec: 'avc1', audio_codec: 'mp4a', width: c.width, height: c.height, dynamic_range: 'sdr' },
        transition: { type: 'hard_cut', ...(s.gain !== undefined ? { gain_db: s.gain } : {}) }, failure_policy: 'continue_native' });
      if (!bindings.some(b => b.sha256 === c.sha)) { bindings.push({ sha256: c.sha, relative_path: `clips/${c.sha}.mp4` }); clips.set(c.sha, c.blob); }
    }
    packet = { packet_schema_version: '1.0.0', packet_id: plan.id, purpose: 'local-user-edit',
      manifest: { schema_version: '1.0.0', edit_id: plan.id, manifest_version: plan.revision, status: 'local-only', source: plan.source,
        compatibility: { min_adapter_version: '0.1.0', max_adapter_version: '0.x', verified_at: PACK_VERIFIED_AT }, segments,
        feature_flags: { replace_enabled: true, insert_enabled: true, skip_enabled: false, mute_enabled: false, emergency_disable: false },
        content: plan.content, signature: null },
      asset_bindings: bindings };
    details = plan.details;
  } else if (entries.has('edit-packet.json')) {
    // A full packet (builder export, make_ss.py, or a repacked .ss): friendly paths are rewritten.
    packet = await jsonOf('edit-packet.json');
    if (!Array.isArray(packet?.asset_bindings)) fail('pack-packet-invalid', 'edit-packet.json has no asset_bindings.');
    // 0.64.4 (consistency with edit.json and the catalog): the runtime tolerance is at most 5000 ms.
    const tolerance = packet?.manifest?.source?.runtime_tolerance_ms;
    if (Number.isSafeInteger(tolerance) && tolerance > SOURCE_RULES.tolerance_ms.max) packet.manifest.source.runtime_tolerance_ms = SOURCE_RULES.tolerance_ms.max;
    for (const [i, binding] of packet.asset_bindings.entries()) {
      progress(i, packet.asset_bindings.length);
      const path = String(binding?.relative_path ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
      const found = entries.has(path) ? path : [...entries.keys()].find(k => k.toLowerCase() === path.toLowerCase());
      if (!found) fail('pack-clip-missing', `${path || `binding ${i + 1}`} is not in the pack.`);
      const blob = await clipOf(found), sha = await hash(blob);
      if (sha !== binding.sha256) fail('pack-clip-mismatch', `${found}: its bytes do not match its SHA-256 in edit-packet.json.`);
      binding.relative_path = `clips/${sha}.mp4`; clips.set(sha, blob);
    }
    if (entries.has('details.json')) { const d = await jsonOf('details.json', 65_536); if (d && typeof d === 'object') details = d; }
  } else fail('pack-no-edit', 'This zip has no edit.json (or edit-packet.json). Put it next to the clips folder and zip again.');
  const validation = validateLocalUserEditPacket(packet);
  if (!validation.ok) {
    const errors = validation.errors.slice(0, 8).map(e => `${e.path}: ${e.code}`);
    fail('pack-packet-invalid', `The edit does not pass the packet check: ${errors.join('; ')}.`, errors);
  }
  // R1 (0.64.1): a poster.jpg in a pack is ignored (tolerated, never stored).
  const { blob, archiveId } = await writeSsArchive({ packet, clips, details: Object.keys(details).length ? details : null,
    createdAt: PACK_VERIFIED_AT, generator: PACK_GENERATOR, cryptoApi, signal });
  const name = String(file.name ?? 'edit').replace(/\.(zip|ss)$/i, '') + '.ss';
  return { file: new File([blob], name, { type: 'application/octet-stream' }), archiveId, fromPack: true };
}
