// Cleared test data only. No production profile, size policy or trust changes.
export const PACKET_BOUNDARY_BYTES = 2_147_483_648;
export const CLIP_BOUNDARY_BYTES = 536_870_912;
export function createClearedBoundaryPacket(base, hashes) {
  if (!Array.isArray(hashes) || hashes.length !== 4 || new Set(hashes).size !== 4 || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Expected four distinct SHA-256 values');
  const packet = structuredClone(base), first = structuredClone(packet.manifest.segments[0]);
  packet.packet_id = 'cleared-physical-boundary-packet'; packet.purpose = 'local-user-edit';
  packet.manifest.edit_id = 'cleared-physical-boundary-edit';
  packet.manifest.status = 'local-only'; packet.manifest.signature = null;
  packet.manifest.source = { ...packet.manifest.source, service: 'cleared-fixture', service_content_id: 'cleared-boundary-fixture', expected_runtime_ms: 30000 };
  packet.manifest.rights.classification = 'user-supplied';
  packet.manifest.feature_flags.skip_enabled = false; packet.manifest.feature_flags.mute_enabled = false;
  packet.manifest.segments = hashes.map((sha256, i) => ({ ...structuredClone(first), segment_id: `cleared-clip-${i + 1}`, action: 'REPLACE',
    trigger_time_ms: i * 6000, resume_time_ms: i * 6000 + 5000, asset: { ...first.asset, sha256 } }));
  packet.asset_bindings = hashes.map((sha256, i) => ({ sha256, relative_path: `cleared-clip-${i + 1}.mp4` }));
  return packet;
}
export function boundaryFileSizes(manifestBytes) {
  if (!Number.isSafeInteger(manifestBytes) || manifestBytes < 4 || manifestBytes > 1_048_576) throw Error('Invalid cleared metadata size');
  return [CLIP_BOUNDARY_BYTES, CLIP_BOUNDARY_BYTES - 1, CLIP_BOUNDARY_BYTES - 2, CLIP_BOUNDARY_BYTES - manifestBytes + 3];
}
