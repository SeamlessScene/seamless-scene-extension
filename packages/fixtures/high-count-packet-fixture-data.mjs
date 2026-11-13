export function clearedCountFilename(index) {
  if (!Number.isInteger(index) || index < 0 || index > 1000) throw Error('Invalid cleared file index');
  return `cleared-count-${String(index + 1).padStart(4, '0')}.mp4`;
}

// A bounded copy of the small cleared baseline plus a valid 12-byte free box.
// The ordinal changes container bytes/hash, not the encoded five-second clip.
export function tagClearedMp4(source, index) {
  clearedCountFilename(index);
  if (!(source instanceof Uint8Array) || source.byteLength < 8 || source.byteLength > 2 * 1024 * 1024) throw Error('Invalid cleared baseline buffer');
  const bytes = new Uint8Array(source.byteLength + 12); bytes.set(source);
  const view = new DataView(bytes.buffer, source.byteLength, 12);
  view.setUint32(0, 12); bytes.set([102, 114, 101, 101], source.byteLength + 4); view.setUint32(8, index);
  return bytes;
}

export function createClearedCountPacket(base, hashes) {
  if (!Array.isArray(hashes) || hashes.length < 1 || hashes.length > 1000 || new Set(hashes).size !== hashes.length || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Invalid cleared count hashes');
  const packet = structuredClone(base), first = structuredClone(packet.manifest.segments[0]);
  packet.packet_id = 'cleared-high-count-packet'; packet.purpose = 'local-user-edit';
  packet.manifest.edit_id = 'cleared-high-count-edit'; packet.manifest.status = 'local-only'; packet.manifest.signature = null;
  packet.manifest.source = { ...packet.manifest.source, service: 'cleared-fixture', service_content_id: 'cleared-count-fixture', expected_runtime_ms: (hashes.length + 1) * 6000 };
  packet.manifest.rights.classification = 'user-supplied';
  packet.manifest.feature_flags.skip_enabled = false; packet.manifest.feature_flags.mute_enabled = false;
  packet.manifest.segments = hashes.map((sha256, i) => ({ ...structuredClone(first), segment_id: `cleared-count-${i + 1}`, action: 'REPLACE',
    trigger_time_ms: i * 6000, resume_time_ms: i * 6000 + 5000, asset: { ...first.asset, sha256 } }));
  packet.asset_bindings = hashes.map((sha256, i) => ({ sha256, relative_path: clearedCountFilename(i) }));
  return packet;
}
