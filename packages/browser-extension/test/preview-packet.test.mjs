import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPacket } from '../src/preview-packet.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { compileLocalUserEditActions } from '../src/local-edit-packet.mjs';

const asset = { sha256: 'a'.repeat(64), expected_duration_ms: 12_000, container: 'video/mp4', video_codec: 'avc1', audio_codec: 'mp4a', width: 1920, height: 1080, dynamic_range: 'sdr' };
const key = sourceKey({ serviceId: 'prime-video', activeItemId: 'amzn1.dv.gti.example', mediaType: 'episode', season: 1, episode: 3, runtimeMs: 2_967_368, versionTag: null, territory: null, plan: null });

test('a preview packet targets exactly the observed episode and validates as a private edit', () => {
  const packet = previewPacket({ sourceKey: key, title: 'Example Show', scene: { action: 'REPLACE', startMs: 61_250, resumeMs: 75_500 }, asset, id: '11111111-2222-4333-8444-555555555555', now: new Date('2026-09-23T00:00:00Z') });
  assert.deepEqual(packet.manifest.source, { service: 'prime-video', territory: 'ZZ', service_content_id: 'amzn1.dv.gti.example', title: 'Example Show', season: 1, episode: 3,
    expected_runtime_ms: 2_967_368, runtime_tolerance_ms: 1000, service_tier: 'unverified', version_tag: 'creator-reported' });
  const [action] = compileLocalUserEditActions(packet, { resolveAssetUrl: () => 'asset:x' });
  assert.equal(action.type, 'REPLACE'); assert.equal(action.triggerMs, 61_250); assert.equal(action.resumeMs, 75_500);
  assert.equal(previewPacket({ sourceKey: key, title: 't', scene: { action: 'INSERT', startMs: 90_000, resumeMs: 99_000 }, asset }).manifest.segments[0].resume_time_ms, 90_000);
});

test('previews refuse an unidentified or non-Prime source and an invalid scene', () => {
  for (const bad of [null, '', 'not json', JSON.stringify(['netflix', 'x', 'movie', null, null, 1, null, null, null])]) {
    assert.throws(() => previewPacket({ sourceKey: bad, title: 't', scene: { action: 'REPLACE', startMs: 1000, resumeMs: 5000 }, asset }), /Identify|Prime Video/);
  }
  assert.throws(() => previewPacket({ sourceKey: key, title: 't', scene: { action: 'REPLACE', startMs: 5000, resumeMs: 1000 }, asset }), /cannot be previewed/);
});
