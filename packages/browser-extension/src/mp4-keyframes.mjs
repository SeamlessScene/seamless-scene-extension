// Presentation times (seconds, on the media element's timeline) of the video
// track's sync samples, read from an MP4's sample tables. A seek that lands on a
// keyframe decodes one frame; a seek between keyframes decodes every frame back to
// the previous one, which for a typical export (a keyframe every 2–10 s) costs
// hundreds of milliseconds to seconds. Returns null when the file cannot be read;
// callers then seek exactly, as before.
const MAX_MOVIE_BYTES = 8 * 1024 * 1024, MAX_SAMPLES = 2_000_000, MAX_BOXES = 10_000;

const text = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);

function boxes(b, p, end) {
  const out = [], d = view(b);
  while (p + 8 <= end) {
    if (out.length >= MAX_BOXES) throw Error('mp4-boxes');
    let size = d.getUint32(p), header = 8;
    if (size === 1) { if (p + 16 > end) throw Error('mp4-box'); size = Number(d.getBigUint64(p + 8)); header = 16; }
    else if (size === 0) size = end - p;
    if (size < header || p + size > end) throw Error('mp4-box');
    out.push({ type: text(b, p + 4), payload: p + header, end: p + size });
    p += size;
  }
  return out;
}
const find = (b, parent, type) => boxes(b, parent.payload, parent.end).find(box => box.type === type) ?? null;

async function readMovie(blob) {
  let offset = 0;
  while (offset + 8 <= blob.size) {
    const h = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer()), d = view(h);
    let size = d.getUint32(0);
    if (size === 1) size = Number(d.getBigUint64(8)); else if (size === 0) size = blob.size - offset;
    if (size < 8 || offset + size > blob.size) return null;
    if (text(h, 4) === 'moov') return size > MAX_MOVIE_BYTES ? null : new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
    offset += size;
  }
  return null;
}

export function keyframeTimesFromMovie(b) {
  const d = view(b), movie = { payload: 8, end: b.length };
  for (const track of boxes(b, movie.payload, movie.end).filter(box => box.type === 'trak')) {
    const media = find(b, track, 'mdia'), handler = media && find(b, media, 'hdlr');
    if (!handler || text(b, handler.payload + 8) !== 'vide') continue;
    const header = find(b, media, 'mdhd'), version = b[header.payload];
    const timescale = d.getUint32(header.payload + (version === 1 ? 20 : 12));
    if (!timescale) return null;
    // An edit list moves the media timeline (ffmpeg shifts B-frame delay this way).
    let mediaOffset = 0;
    const edits = find(b, track, 'edts'), list = edits && find(b, edits, 'elst');
    if (list) {
      const v = b[list.payload], count = d.getUint32(list.payload + 4);
      for (let i = 0, p = list.payload + 8; i < count; i += 1, p += v === 1 ? 20 : 12) {
        const mediaTime = v === 1 ? Number(d.getBigInt64(p + 8)) : d.getInt32(p + 4);
        if (mediaTime >= 0) { mediaOffset = mediaTime; break; }
      }
    }
    const table = find(b, find(b, media, 'minf'), 'stbl'), stts = find(b, table, 'stts');
    const ctts = find(b, table, 'ctts'), stss = find(b, table, 'stss');
    // Decode times, run-length encoded.
    const decode = [];
    for (let i = 0, n = d.getUint32(stts.payload + 4), p = stts.payload + 8, t = 0; i < n; i += 1, p += 8) {
      const count = d.getUint32(p), delta = d.getUint32(p + 4);
      if (decode.length + count > MAX_SAMPLES) return null;
      for (let k = 0; k < count; k += 1) { decode.push(t); t += delta; }
    }
    const offsets = new Array(decode.length).fill(0);
    if (ctts) {
      const signed = b[ctts.payload] === 1;
      for (let i = 0, n = d.getUint32(ctts.payload + 4), p = ctts.payload + 8, s = 0; i < n; i += 1, p += 8) {
        const count = d.getUint32(p), offset = signed ? d.getInt32(p + 4) : d.getUint32(p + 4);
        for (let k = 0; k < count && s < offsets.length; k += 1) offsets[s++] = offset;
      }
    }
    const sync = stss ? Array.from({ length: d.getUint32(stss.payload + 4) }, (_, i) => d.getUint32(stss.payload + 8 + i * 4) - 1) : decode.map((_, i) => i);
    const times = sync.filter(i => i >= 0 && i < decode.length).map(i => Math.max(0, (decode[i] + offsets[i] - mediaOffset) / timescale));
    return times.sort((a, b2) => a - b2);
  }
  return null;
}

export async function keyframeTimes(blob) {
  try {
    const movie = await readMovie(blob);
    return movie ? keyframeTimesFromMovie(movie) : null;
  } catch { return null; }
}

export const ENTRY_KEYFRAME_TOLERANCE_SECONDS = 0.25;

/** Prefer a nearby keyframe for fast entry, but decode to the exact target
 * when the index is absent or its closest keyframe would replay/skip too much. */
export function entryPosition(targetSeconds, keyframes, { nearSeconds = ENTRY_KEYFRAME_TOLERANCE_SECONDS } = {}) {
  if (!Array.isArray(keyframes) || !keyframes.length) return targetSeconds;
  let nearest = null;
  for (const k of keyframes) {
    if (nearest === null || Math.abs(k - targetSeconds) < Math.abs(nearest - targetSeconds)) nearest = k;
  }
  if (Math.abs(nearest - targetSeconds) <= nearSeconds) return nearest;
  return targetSeconds;
}
