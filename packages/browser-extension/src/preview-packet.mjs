import { validateLocalUserEditPacket } from './local-edit-packet.mjs';
import { RULES } from './seamless-rules.mjs';

// What marks a creator preview (E57 C4). The packet and manifest schemas are exact and
// shared with website edits (manifest-security.mjs is a protected module), so the packet
// itself cannot carry a new field: a preview is a one-scene private packet whose scene id
// is PREVIEW_SEGMENT_ID, and the renderer, which alone knows it imported the panel's
// preview, sends `preview: { name }` beside it. The player accepts that flag only for a
// packet isPreviewPacket() recognises, then shows preview wording instead of viewer wording.
export const PREVIEW_SEGMENT_ID = 'preview';
export function isPreviewPacket(packet) {
  const segments = packet?.manifest?.segments;
  return packet?.purpose === 'local-user-edit' && Array.isArray(segments) && segments.length === 1 && segments[0]?.segment_id === PREVIEW_SEGMENT_ID;
}
/** The scene's name as the player menu shows it: plain text, at most 120 characters. */
export function previewSceneName(value) {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '';
  return name || 'Scene';
}

// A one-scene private packet for previewing a clip over the stream from the
// creator panel. Its source is the identity the player controller is observing
// right now (the viewer snapshot's sourceKey), so the usual source check at arm
// time passes only on this exact episode. Defaults match the website builder.
export function previewPacket({ sourceKey, title, scene, asset, id = crypto.randomUUID(), now = new Date() }) {
  let key;
  try { key = JSON.parse(sourceKey); } catch { key = null; }
  if (!Array.isArray(key) || key.length !== 9) throw Error('Seamless Scene has not identified this episode yet. Press play on Prime Video, then preview again.');
  const [service, contentId, mediaType, season, episode, runtimeMs, versionTag, territory, plan] = key;
  if (service !== 'prime-video' || typeof contentId !== 'string' || !Number.isSafeInteger(runtimeMs)) throw Error('Preview needs a Prime Video episode or film that the extension has identified.');
  const episodic = mediaType === 'episode' && Number.isSafeInteger(season) && Number.isSafeInteger(episode);
  const resumeMs = scene.action === 'INSERT' ? scene.startMs : scene.resumeMs;
  const packet = { packet_schema_version: '1.0.0', packet_id: id, purpose: 'local-user-edit',
    manifest: { schema_version: '1.0.0', edit_id: id, manifest_version: 1, status: 'local-only',
      // E78: Prime never reports a country either, so a preview's territory is "ZZ" (unknown), never a guessed US.
      source: { service, territory: /^[A-Z]{2}$/.test(territory ?? '') ? territory : RULES.source.local_unknown_territory, service_content_id: contentId,
        title: String(title || 'Preview').slice(0, 256), season: episodic ? season : null, episode: episodic ? episode : null,
        expected_runtime_ms: runtimeMs, runtime_tolerance_ms: 1000,
        // 0.65.4: Prime never reports a plan, so a preview's tier is "unverified", never a guessed "ad-free".
        service_tier: /^[a-z0-9][a-z0-9._-]{0,127}$/.test(plan ?? '') ? plan : RULES.source.local_default_tier,
        version_tag: /^[a-z0-9][a-z0-9._-]{0,127}$/.test(versionTag ?? '') ? versionTag : 'creator-reported' },
      compatibility: { min_adapter_version: '0.42.0', max_adapter_version: '0.x', verified_at: now.toISOString() },
      segments: [{ segment_id: PREVIEW_SEGMENT_ID, action: scene.action, trigger_time_ms: scene.startMs, resume_time_ms: resumeMs, asset,
        transition: { type: 'hard_cut' }, failure_policy: 'continue_native' }],
      feature_flags: { replace_enabled: true, insert_enabled: true, skip_enabled: false, mute_enabled: false, emergency_disable: false },
      content: { spoilers: false, warnings: [], synthetic_media: false, real_person_likeness: false },
      rights: { classification: 'user-supplied', approval_reference: id }, signature: null },
    asset_bindings: [{ sha256: asset.sha256, relative_path: `${asset.sha256}.mp4` }] };
  const checked = validateLocalUserEditPacket(packet);
  if (!checked.ok) throw Error(`This scene cannot be previewed: ${checked.errors[0]?.code ?? 'invalid'} (${checked.errors[0]?.path ?? ''}).`);
  return packet;
}
