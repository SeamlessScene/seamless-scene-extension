export const fixtureManifest = Object.freeze({
  schema_version: "1.0.0",
  edit_id: "edit_fixture_001",
  manifest_version: 2,
  status: "released",
  source: Object.freeze({
    service: "cleared-fixture",
    territory: "fixture",
    service_content_id: "fixture-episode-001",
    title: "Cleared Fixture Episode",
    season: 1,
    episode: 1,
    expected_runtime_ms: 20_000,
    runtime_tolerance_ms: 50,
    service_tier: "fixture",
    version_tag: "fixture-native-v1"
  }),
  compatibility: Object.freeze({
    min_adapter_version: "0.1.0",
    max_adapter_version: "0.x",
    verified_at: "2026-08-25T00:00:00.000Z"
  }),
  segments: Object.freeze([
    Object.freeze({
      segment_id: "fixture-replacement-001",
      action: "REPLACE",
      trigger_time_ms: 3_000,
      resume_time_ms: 8_000,
      asset: Object.freeze({
        sha256: "7bf794f50cc86596de9eed7d9a691a16bafa917f346daf68d5a7743df055eb9d",
        expected_duration_ms: 5_000,
        container: "video/mp4",
        video_codec: "avc1",
        audio_codec: "mp4a",
        width: 1280,
        height: 720,
        dynamic_range: "sdr"
      }),
      transition: Object.freeze({ type: "hard_cut" }),
      failure_policy: "continue_native"
    }),
    Object.freeze({
      segment_id: "fixture-insert-001",
      action: "INSERT",
      trigger_time_ms: 10_000,
      resume_time_ms: 10_000,
      asset: Object.freeze({
        sha256: "7bf794f50cc86596de9eed7d9a691a16bafa917f346daf68d5a7743df055eb9d",
        expected_duration_ms: 5_000,
        container: "video/mp4",
        video_codec: "avc1",
        audio_codec: "mp4a",
        width: 1280,
        height: 720,
        dynamic_range: "sdr"
      }),
      transition: Object.freeze({ type: "hard_cut" }),
      failure_policy: "continue_native"
    }),
    Object.freeze({
      segment_id: "fixture-mute-001",
      action: "MUTE",
      trigger_time_ms: 12_000,
      resume_time_ms: 14_000,
      asset: null,
      transition: Object.freeze({ type: "hard_cut" }),
      failure_policy: "continue_native"
    }),
    Object.freeze({
      segment_id: "fixture-skip-001",
      action: "SKIP",
      trigger_time_ms: 15_000,
      resume_time_ms: 17_000,
      asset: null,
      transition: Object.freeze({ type: "hard_cut" }),
      failure_policy: "continue_native"
    })
  ]),
  feature_flags: Object.freeze({
    replace_enabled: true,
    insert_enabled: true,
    skip_enabled: true,
    mute_enabled: true,
    emergency_disable: false
  }),
  content: Object.freeze({
    spoilers: true,
    warnings: Object.freeze([]),
    synthetic_media: true,
    real_person_likeness: false
  }),
  rights: Object.freeze({
    classification: "cleared-test",
    approval_reference: "fixture-clearance-001"
  }),
  signature: Object.freeze({
    algorithm: "Ed25519",
    key_id: "fixture-manifest-key-2026-01",
    value: "smU3YJxz+iXrF9oxJnzFRlaRz8CRRbsS5hJH5CuAW96RENqJGoszdoriEu3HnqTs8ZQ3j3Y1pjS5RTgLiILYAQ=="
  })
});

export const fixtureTrustedManifestKeys = Object.freeze({
  "fixture-manifest-key-2026-01": Object.freeze({
    status: "active",
    publicKey: "2vXYudFA9o8CCEwqmT060xq7OiWzEhzI9f8kBkb5SL4="
  })
});
