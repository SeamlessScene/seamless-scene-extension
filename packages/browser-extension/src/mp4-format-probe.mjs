import { assertActive } from './operation-context.mjs';
const MAX_METADATA = 8 * 1024 * 1024, MAX_BOXES = 10000;
const text = (b, p) => String.fromCharCode(...b.subarray(p, p + 4));
const u32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p);
const fail = () => { throw Error('unsupported-or-malformed-mp4-format'); };
function boxes(b, p = 0, end = b.length) {
  const out = [];
  while (p < end) {
    if (out.length >= MAX_BOXES || end - p < 8) fail();
    let size = u32(b, p), header = 8;
    if (size === 1) { if (end - p < 16) fail(); size = u32(b, p + 8) * 2 ** 32 + u32(b, p + 12); header = 16; }
    if (!size) size = end - p;
    if (!Number.isSafeInteger(size) || size < header || p + size > end) fail();
    out.push({ type: text(b, p + 4), payload: p + header, end: p + size }); p += size;
  }
  return out;
}
function child(b, parent, type) {
  const found = boxes(b, parent.payload, parent.end).filter(box => box.type === type);
  if (found.length !== 1) fail(); return found[0];
}
class Bits {
  constructor(bytes) { this.bytes = bytes; this.p = 0; }
  read(n) { if (n > 32 || this.p + n > this.bytes.length * 8) fail(); let v = 0; for (let i = 0; i < n; i++, this.p++) v = v * 2 + ((this.bytes[this.p >> 3] >> (7 - (this.p & 7))) & 1); return v; }
  ue() { let n = 0; while (!this.read(1)) { if (++n > 24) fail(); } return 2 ** n - 1 + this.read(n); }
  se() { const v = this.ue(); return v % 2 ? (v + 1) / 2 : -v / 2; }
}
function spsTransfer(nal) {
  if (nal.length < 4 || (nal[0] & 128) || (nal[0] & 31) !== 7) fail();
  const rbsp = [];
  for (let i = 1; i < nal.length; i++) { if (i > 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue; rbsp.push(nal[i]); }
  const bits = new Bits(Uint8Array.from(rbsp)), profile = bits.read(8);
  if (![66, 77, 88, 100].includes(profile)) fail();
  bits.read(16); bits.ue();
  if (profile === 100) {
    const chroma = bits.ue(); if (chroma > 3) fail(); if (chroma === 3) bits.read(1);
    if (bits.ue() !== 0 || bits.ue() !== 0) fail(); // SPS luma/chroma must actually be 8-bit.
    bits.read(1);
    if (bits.read(1)) for (let list = 0; list < (chroma === 3 ? 12 : 8); list++) {
      if (!bits.read(1)) continue;
      let last = 8, next = 8;
      for (let i = 0; i < (list < 6 ? 16 : 64); i++) { if (next) next = (last + bits.se() + 256) % 256; last = next === 0 ? last : next; }
    }
  }
  bits.ue(); const order = bits.ue();
  if (order === 0) bits.ue();
  else if (order === 1) { bits.read(1); bits.se(); bits.se(); const cycle = bits.ue(); if (cycle > 255) fail(); for (let i = 0; i < cycle; i++) bits.se(); }
  else if (order !== 2) fail();
  bits.ue(); bits.read(1); bits.ue(); bits.ue(); if (!bits.read(1)) bits.read(1);
  bits.read(1); if (bits.read(1)) for (let i = 0; i < 4; i++) bits.ue();
  if (bits.read(1)) {
    if (bits.read(1) && bits.read(8) === 255) { bits.read(16); bits.read(16); }
    if (bits.read(1)) bits.read(1);
    if (bits.read(1)) { bits.read(3); bits.read(1); if (bits.read(1)) { bits.read(8); const transfer = bits.read(8); bits.read(8); return transfer; } }
  }
  return null;
}
function avcFormat(b, entry) {
  if (!['avc1', 'avc3'].includes(entry.type) || entry.end - entry.payload < 78) fail();
  if (b[entry.payload + 6] !== 0 || b[entry.payload + 7] !== 1) fail();
  const children = boxes(b, entry.payload + 78, entry.end), configurations = children.filter(box => box.type === 'avcC'), avcc = configurations[0];
  if (configurations.length !== 1) fail();
  if (!avcc || avcc.end - avcc.payload < 7 || b[avcc.payload] !== 1) fail();
  if ((b[avcc.payload + 4] & 252) !== 252 || (b[avcc.payload + 4] & 3) === 2 || (b[avcc.payload + 5] & 224) !== 224) fail();
  const count = b[avcc.payload + 5] & 31; if (!count) fail();
  const transfers = []; let p = avcc.payload + 6;
  for (let i = 0; i < count; i++) {
    if (p + 2 > avcc.end) fail(); const length = b[p] * 256 + b[p + 1]; p += 2;
    if (!length || p + length > avcc.end) fail(); transfers.push(spsTransfer(b.subarray(p, p + length))); p += length;
  }
  // Validate the rest of the record, not just the first successful SPS. avc3
  // can carry PPS in-band; avc1 requires a nonempty configured PPS collection.
  if (p >= avcc.end) fail(); const ppsCount = b[p++]; if (!ppsCount && entry.type === 'avc1') fail();
  function parameterSets(count, nalType) {
    for (let i = 0; i < count; i++) {
      if (p + 2 > avcc.end) fail(); const length = b[p] * 256 + b[p + 1]; p += 2;
      if (length < 2 || p + length > avcc.end || (b[p] & 128) || (b[p] & 31) !== nalType) fail(); p += length;
    }
  }
  parameterSets(ppsCount, 8);
  if (p < avcc.end) {
    if (b[avcc.payload + 1] !== 100 || avcc.end - p < 4 || (b[p] & 252) !== 252 || b[p + 1] !== 248 || b[p + 2] !== 248) fail();
    const extensions = b[p + 3]; p += 4; parameterSets(extensions, 13);
  }
  if (p !== avcc.end) fail();
  for (const colr of children.filter(box => box.type === 'colr')) {
    if (!['nclx', 'nclc'].includes(text(b, colr.payload)) || colr.end - colr.payload < 10) fail();
    transfers.push(b[colr.payload + 6] * 256 + b[colr.payload + 7]);
  }
  if (transfers.some(v => v !== null && ![1, 2, 4, 5, 6, 7, 13, 14, 15].includes(v))) fail();
  return { videoCodec: 'h264', bitDepth: 8, dynamicRange: 'sdr', colorEvidence: transfers.some(v => v !== null && v !== 2) ? 'sps-or-colr-sdr-transfer' : '8-bit-avc-no-hdr-signaling' };
}
function aacFormat(b, entry) {
  if (entry.type !== 'mp4a' || entry.end - entry.payload < 28 || b[entry.payload + 8] || b[entry.payload + 9]) fail();
  if (b[entry.payload + 6] !== 0 || b[entry.payload + 7] !== 1) fail();
  const configs = boxes(b, entry.payload + 28, entry.end).filter(box => box.type === 'esds'), esds = configs[0];
  if (configs.length !== 1 || esds.end - esds.payload < 4 || u32(b, esds.payload) !== 0) fail();
  let audioType = null, objectType = null, esCount = 0, descriptorCount = 0;
  function descriptors(p, end, depth = 0) {
    if (depth > 4) fail();
    while (p < end) {
      if (++descriptorCount > 128) fail();
      const tag = b[p++]; let length = 0, next, count = 0;
      do { if (p >= end || ++count > 4) fail(); next = b[p++]; length = length * 128 + (next & 127); } while (next & 128);
      const finish = p + length; if (finish > end) fail();
      if (tag === 3) {
        if (length < 3 || ++esCount !== 1 || depth !== 0) fail(); const flags = b[p + 2]; let offset = p + 3;
        if (flags & 128) offset += 2;
        if (flags & 64) { if (offset >= finish) fail(); offset += 1 + b[offset]; }
        if (flags & 32) offset += 2;
        if (offset > finish) fail(); descriptors(offset, finish, depth + 1);
      } else if (tag === 4) { if (length < 13 || objectType !== null || depth !== 1 || (b[p + 1] >> 2) !== 5) fail(); objectType = b[p]; descriptors(p + 13, finish, depth + 1); }
      else if (tag === 5) { if (audioType !== null || depth !== 2) fail(); const bits = new Bits(b.subarray(p, finish)); audioType = bits.read(5); if (audioType === 31) audioType = 32 + bits.read(6); }
      p = finish;
    }
  }
  descriptors(esds.payload + 4, esds.end);
  if (objectType !== 0x40 || ![2, 5, 29].includes(audioType)) fail(); return { audioCodec: 'aac' };
}
export function parseMp4Movie(b) {
  const movie = boxes(b).find(box => box.type === 'moov'); if (!movie) fail();
  let video = null, audio = null, count = 0;
  for (const track of boxes(b, movie.payload, movie.end).filter(box => box.type === 'trak')) {
    if (++count > 16) fail(); const media = child(b, track, 'mdia'), handler = child(b, media, 'hdlr'); if (handler.end - handler.payload < 12) fail(); const type = text(b, handler.payload + 8);
    if (!['vide', 'soun'].includes(type)) continue;
    const information = child(b, media, 'minf'), references = child(b, child(b, information, 'dinf'), 'dref');
    if (references.end - references.payload < 8 || u32(b, references.payload) !== 0 || u32(b, references.payload + 4) !== 1) fail();
    const locations = boxes(b, references.payload + 8, references.end);
    // Local import may not turn a decoder into an external media/file fetch.
    // Only the single self-contained data reference is admitted; never return
    // or log a location embedded in untrusted container metadata.
    if (locations.length !== 1 || locations[0].type !== 'url ' || locations[0].end - locations[0].payload !== 4 || u32(b, locations[0].payload) !== 1) fail();
    const description = child(b, child(b, information, 'stbl'), 'stsd');
    if (description.end - description.payload < 8 || u32(b, description.payload + 4) !== 1) fail();
    const entries = boxes(b, description.payload + 8, description.end); if (entries.length !== 1) fail();
    if (type === 'vide') { if (video) fail(); video = avcFormat(b, entries[0]); } else { if (audio) fail(); audio = aacFormat(b, entries[0]); }
  }
  if (!video || !audio) fail(); return Object.freeze({ container: 'mp4', ...video, ...audio, formatProvenance: 'bounded-iso-bmff-sample-descriptions' });
}
export async function inspectMp4Format(file, { signal } = {}) {
  assertActive(signal); if (!Number.isSafeInteger(file?.size) || file.size < 16 || typeof file.slice !== 'function') fail();
  const fileSize = file.size;
  async function read(start, end) {
    assertActive(signal);
    let buffer; try { buffer = await file.slice(start, end).arrayBuffer(); } catch { assertActive(signal); fail(); }
    assertActive(signal);
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - start || file.size !== fileSize) fail();
    return new Uint8Array(buffer);
  }
  // Keep the first header precise. Only a validated small preceding box
  // enables speculation, bounded independently of metadata and file size.
  const HEADER_CACHE_BYTES = 64 * 1024, SPECULATIVE_BYTES = 160000;
  let cache = null, cacheStart = 0, speculativeBytes = 0, readAhead = false;
  async function header(start) {
    assertActive(signal); if (file.size !== fileSize) fail();
    const end = Math.min(fileSize, start + 16);
    if (cache && start >= cacheStart && end <= cacheStart + cache.length) {
      return cache.subarray(start - cacheStart, end - cacheStart);
    }
    const extra = readAhead ? Math.min(HEADER_CACHE_BYTES - (end - start), SPECULATIVE_BYTES - speculativeBytes, fileSize - end) : 0;
    // Retire the previous buffer before awaiting the next bounded read.
    cache = null;
    const bytes = await read(start, end + extra);
    speculativeBytes += extra; cacheStart = start; cache = bytes;
    return bytes.subarray(0, end - start);
  }
  let offset = 0, count = 0, movie = null, brand = false, fileTypeSeen = false;
  while (offset < fileSize) {
    if (++count > MAX_BOXES || fileSize - offset < 8) fail();
    const h = await header(offset);
    let size = u32(h, 0), minimum = 8; const type = text(h, 4);
    if (size === 1) { if (h.length < 16) fail(); size = u32(h, 8) * 2 ** 32 + u32(h, 12); minimum = 16; }
    else if (!size) size = fileSize - offset;
    if (!Number.isSafeInteger(size) || size < minimum || offset + size > fileSize) fail();
    if (type === 'ftyp') {
      if (fileTypeSeen || size < minimum + 8 || size > 1024 || (size - minimum) % 4) fail(); fileTypeSeen = true;
      const value = await read(offset, offset + size), supported = value => /^(isom|iso[2-9]|mp4[12]|avc1)$/.test(value);
      brand = supported(text(value, minimum));
      for (let p = minimum + 8; p < size; p += 4) brand ||= supported(text(value, p));
    }
    if (type === 'moov') { if (movie || size > MAX_METADATA) fail(); movie = await read(offset, offset + size); }
    readAhead = size <= HEADER_CACHE_BYTES;
    offset += size;
  }
  assertActive(signal); if (!brand || !movie) fail(); return parseMp4Movie(movie);
}
