import { validateLocalUserEditPacket } from './local-edit-packet.mjs';
import { validateLocalAsset } from './local-asset-validator.mjs';
import { evaluateAdapterCompatibility } from './manifest-security.mjs';
import { ADAPTER_VERSION } from './build-info.mjs';
import { assertActive } from './operation-context.mjs';
import { withoutSystemFiles } from './system-files.mjs';
import { MAX_LOCAL_ASSET_BYTES, HASH_CHUNK_BYTES } from './local-file-hash.mjs';

export const LOCAL_IMPORT_LIMITS = Object.freeze({ files: 1001, packetBytes: 2_147_483_648, clipBytes: MAX_LOCAL_ASSET_BYTES, manifestBytes: 1_048_576 });

// Windows authors and cameras drift in case (Clip01.MP4). Accept it only when exactly one
// selected path matches; the SHA-256 validation below still pins the bytes.
function uniqueCaseInsensitive(byName, path) {
  const lower = path.toLowerCase(), matches = [...byName].filter(([name]) => name.toLowerCase() === lower);
  return matches.length === 1 ? matches[0][1] : undefined;
}

// The fixture can exercise real generated assets without claiming movie alignment.
// onProgress(checked, total): clips checked so far (the Local tab's import bar). context: passed to
// validateAsset (the validated cache keys a local edit by its archive_id and build).
export async function loadFixturePacket(files, expectedSource, { validateAsset = validateLocalAsset, adapterVersion = ADAPTER_VERSION, signal, expectedService, onProgress, context } = {}) {
  files = withoutSystemFiles(files);
  if (files.length < 2 || files.length > 1001) throw Error('Select edit-packet.json and its local clips');
  const byName = new Map();
  let totalBytes = 0;
  for (const file of files) {
    assertActive(signal);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw Error('Invalid local file size');
    totalBytes += file.size;
    if (file.size > LOCAL_IMPORT_LIMITS.clipBytes || totalBytes > LOCAL_IMPORT_LIMITS.packetBytes) throw Error('Local packet byte budget exceeded (512 MiB per clip, 2 GiB total)');
    const path = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
    if (byName.has(path)) throw Error('Duplicate local paths');
    byName.set(path, file);
  }
  const manifests = [...byName].filter(([path]) => path.split('/').at(-1) === 'edit-packet.json');
  if (manifests.length !== 1) throw Error('Select exactly one edit-packet.json');
  const [manifestPath, manifestFile] = manifests[0];
  const prefix = manifestPath.slice(0, manifestPath.length - 'edit-packet.json'.length);
  if (!manifestFile || manifestFile.size > 1_048_576) throw Error('Select one edit-packet.json under 1 MiB');
  const packet = JSON.parse(await manifestFile.text());
  assertActive(signal);
  const validation = validateLocalUserEditPacket(packet);
  if (!validation.ok) throw Error(`Invalid local packet: ${JSON.stringify(validation.errors[0])}`);
  if (expectedService !== undefined && packet.manifest.source.service !== expectedService) throw Error('wrong-service');
  for (const key of ['service', 'service_content_id', 'season', 'episode', 'expected_runtime_ms', 'runtime_tolerance_ms', 'version_tag', 'territory', 'service_tier']) {
    if (expectedSource && packet.manifest.source[key] !== expectedSource[key]) throw Error(`Fixture source mismatch: ${key}`);
  }
  if (!evaluateAdapterCompatibility(adapterVersion, packet.manifest.compatibility).ok) throw Error('Fixture adapter is incompatible');
  const assets = new Map(packet.manifest.segments.map(s => [s.asset.sha256, s.asset]));
  const validated = new Map();
  // Small files fit within one existing hash chunk. Validate at most two of
  // those at once; larger clips remain serial so CPU contention does not
  // consume their per-file hash deadline. Never publish a partially valid batch.
  const bindings = packet.asset_bindings.map(binding => {
    const file = byName.get(prefix + binding.relative_path) ?? uniqueCaseInsensitive(byName, prefix + binding.relative_path), asset = assets.get(binding.sha256);
    if (!file || !asset) throw Error('Missing bound local clip');
    return { binding, file, asset };
  });
  for (let index = 0; index < bindings.length;) {
    assertActive(signal);
    const batch = [bindings[index++]];
    if (batch[0].file.size <= HASH_CHUNK_BYTES && bindings[index]?.file.size <= HASH_CHUNK_BYTES) batch.push(bindings[index++]);
    const controller = new AbortController();
    const batchSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const outcomes = await Promise.allSettled(batch.map(async ({ binding, file, asset }) => {
      try {
        assertActive(batchSignal);
        const result = await validateAsset(file, {
          sha256: asset.sha256, durationMs: asset.expected_duration_ms, durationToleranceMs: 100,
          container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
          width: asset.width, height: asset.height, dynamicRange: asset.dynamic_range
        }, { profileClass: 'local-user', signal: batchSignal, ...(context ? { context } : {}) });
        assertActive(batchSignal);
        if (!result.ok) throw Error(`Local clip rejected: ${result.errors.join(', ')}`);
        return [binding.sha256, file];
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }));
    assertActive(signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
      validated.set(...outcome.value);
    }
    try { onProgress?.(validated.size, bindings.length); } catch {}
  }
  return { packet, files: validated };
}
