import { readFile } from 'node:fs/promises';

export async function packagedMp4() { return readFile(new URL('../../media/replacement.mp4', import.meta.url)); }
export function box(type, payload) { const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4); return Buffer.concat([header, payload]); }
function children(bytes, start = 0, end = bytes.length) {
  const entries = [];
  while (start < end) { const length = bytes.readUInt32BE(start); if (length < 8 || start + length > end) throw Error('Fixture box shape changed'); entries.push({ start, end: start + length, type: bytes.toString('ascii', start + 4, start + 8) }); start += length; }
  return entries;
}
// Mutations are deliberately malformed fixtures, not a production MP4 editor.
const offsets = { stsd: 8, avc1: 78, avc3: 78, mp4a: 28, dref: 8 };
export function replaceBox(bytes, path, mutate) {
  const [selector, ...rest] = path, [name, index = '0'] = selector.split('#'), entry = children(bytes).filter(entry => entry.type === name)[Number(index)];
  if (!entry) throw Error('Fixture box missing: ' + name);
  const original = bytes.subarray(entry.start, entry.end);
  let replacement;
  if (!rest.length) replacement = mutate(Buffer.from(original));
  else { const prefix = 8 + (offsets[name] ?? 0); replacement = box(name, Buffer.concat([original.subarray(8, prefix), replaceBox(original.subarray(prefix), rest, mutate)])); }
  return Buffer.concat([bytes.subarray(0, entry.start), replacement, bytes.subarray(entry.end)]);
}
export const videoEntryPath = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1'];
export function malformedConfigurations(bytes) {
  const avccPath = [...videoEntryPath, 'avcC'];
  const audioPath = ['moov', 'trak#1', 'mdia', 'minf', 'stbl', 'stsd', 'mp4a', 'esds'];
  const descriptor = (tag, payload) => Buffer.concat([Buffer.from([tag, payload.length]), payload]);
  const asc = descriptor(5, Buffer.from([0x11, 0x88]));
  const decoder = tail => descriptor(4, Buffer.concat([Buffer.from([0x40, 0x15]), Buffer.alloc(11), tail]));
  const esds = contents => box('esds', Buffer.concat([Buffer.alloc(4), descriptor(3, Buffer.concat([Buffer.from([0, 1, 0]), contents]))]));
  return [
    ['duplicate-avcc', replaceBox(bytes, avccPath, original => Buffer.concat([original, original]))],
    ['missing-pps-record', replaceBox(bytes, avccPath, original => {
      let p = 14; for (let i = 0; i < (original[13] & 31); i++) p += 2 + original.readUInt16BE(p);
      return box('avcC', original.subarray(8, p));
    })],
    ['oversized-pps', replaceBox(bytes, avccPath, original => {
      let p = 14; for (let i = 0; i < (original[13] & 31); i++) p += 2 + original.readUInt16BE(p);
      original.writeUInt16BE(65535, p + 1); return original;
    })],
    ['reserved-nal-length', replaceBox(bytes, avccPath, original => { original[12] = 254; return original; })],
    ['external-data-reference', replaceBox(bytes, ['moov', 'trak', 'mdia', 'minf', 'dinf', 'dref', 'url '], original => { original.writeUInt32BE(0, 8); return original; })],
    ['unknown-data-reference-index', replaceBox(bytes, videoEntryPath, original => { original.writeUInt16BE(2, 14); return original; })],
    ['duplicate-esds', replaceBox(bytes, audioPath, original => Buffer.concat([original, original]))],
    ['duplicate-aac-config', replaceBox(bytes, audioPath, () => esds(Buffer.concat([decoder(asc), decoder(asc)])))],
    ['duplicate-aac-specific-info', replaceBox(bytes, audioPath, () => esds(decoder(Buffer.concat([asc, asc]))))],
    ['nested-aac-es-descriptor', replaceBox(bytes, audioPath, () => esds(descriptor(3, Buffer.concat([Buffer.from([0, 2, 0]), decoder(asc)]))))]
  ];
}
