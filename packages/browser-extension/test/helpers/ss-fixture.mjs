// Builds local-user packets and .ss files for tests: N small clips (fake bytes with real
// SHA-256 values), a Prime source, and the packet layout .ss v1 requires.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { writeSsArchive } from '../../src/ss-archive.mjs';

export const GTI = 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const template = JSON.parse(await readFile(new URL('../../media/edit-packet.json', import.meta.url), 'utf8'));

/** A valid local-user packet with `count` clips; options change its identity fields. */
export function localPacket({ count = 2, packetId = 'tilly-tin-courier', revision = 1, episode = 4, title = 'Tilly, the Tin Courier', seed = 'a', runtimeMs = 2_701_032, source = null } = {}) {
  const packet = structuredClone(template);
  packet.packet_id = packetId; packet.purpose = 'local-user-edit';
  const m = packet.manifest;
  m.status = 'local-only'; m.signature = null; m.manifest_version = revision; m.edit_id = packetId;
  if (m.rights) m.rights.classification = 'user-supplied';
  m.feature_flags.skip_enabled = false; m.feature_flags.mute_enabled = false;
  m.source = source ?? { service: 'prime-video', territory: 'US', service_content_id: GTI, title: 'Orbit Station', season: 1, episode,
    expected_runtime_ms: runtimeMs, runtime_tolerance_ms: 3000, service_tier: 'ad-free', version_tag: null };
  const base = m.segments.find(s => s.action === 'REPLACE');
  const clips = new Map();
  m.segments = Array.from({ length: count }, (_, i) => {
    const bytes = new TextEncoder().encode(`clip ${seed} ${i} `.repeat(40 + i));
    const hash = sha(bytes); clips.set(hash, new Blob([bytes]));
    return { ...structuredClone(base), segment_id: `scene-${i + 1}`, trigger_time_ms: 60_000 * (i + 1), resume_time_ms: 60_000 * (i + 1) + 5000,
      asset: { ...base.asset, sha256: hash, width: 1280, height: 720 } };
  });
  packet.asset_bindings = [...clips.keys()].map(hash => ({ sha256: hash, relative_path: `clips/${hash}.mp4` }));
  return { packet, clips, title };
}

/** A .ss File built from localPacket() options plus writer options. */
export async function ssFile(options = {}, writer = {}) {
  const { packet, clips, title } = localPacket(options);
  const details = options.details === undefined ? { title, creator_name: options.creator ?? 'Test Creator', show_title: 'Orbit Station' } : options.details;
  const { blob, archiveId } = await writeSsArchive({ packet, clips, details, createdAt: '2026-10-11T12:00:00.000Z', generator: 'test', ...writer });
  return { file: new File([blob], options.fileName ?? `${options.packetId ?? 'riley'}.ss`), archiveId, packet, clips };
}

/** An in-memory stand-in for the OPFS "local" directory (local/<archive_id>/edit.ss). */
export function memoryRoot() {
  const dirs = new Map();
  const notFound = () => Object.assign(Error('missing'), { name: 'NotFoundError' });
  return {
    dirs,
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!dirs.has(name)) { if (!create) throw notFound(); dirs.set(name, new Map()); }
      const files = dirs.get(name);
      return {
        async getFileHandle(file, { create = false } = {}) {
          if (!files.has(file)) { if (!create) throw notFound(); files.set(file, new Blob([])); }
          return {
            async getFile() { return new File([files.get(file)], file); },
            async createWritable() { const parts = []; return { async write(b) { parts.push(b); }, async close() { files.set(file, new Blob(parts)); }, async abort() {} }; }
          };
        }
      };
    },
    async removeEntry(name) { if (!dirs.delete(name)) throw notFound(); }
  };
}
