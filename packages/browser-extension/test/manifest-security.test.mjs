import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { fixtureManifest, fixtureTrustedManifestKeys } from "../src/fixture-signed-manifest.mjs";
import {
  canonicalizeManifest,
  evaluateAdapterCompatibility,
  evaluateManifestVersion,
  resolveManifestActivation,
  validateManifestSchema,
  verifySignedManifest
} from "../src/manifest-security.mjs";

const adapterVersion = "0.1.0";

function baseManifest(overrides = {}) {
  return {
    schema_version: "1.0.0",
    edit_id: "edit_fixture_001",
    manifest_version: 1,
    status: "released",
    source: {
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
    },
    compatibility: {
      min_adapter_version: "0.1.0",
      max_adapter_version: "0.x",
      verified_at: "2026-08-25T00:00:00.000Z"
    },
    segments: [{
      segment_id: "fixture-replacement-001",
      action: "REPLACE",
      trigger_time_ms: 3_000,
      resume_time_ms: 8_000,
      asset: {
        sha256: "7bf794f50cc86596de9eed7d9a691a16bafa917f346daf68d5a7743df055eb9d",
        expected_duration_ms: 5_000,
        container: "video/mp4",
        video_codec: "avc1",
        audio_codec: "mp4a",
        width: 1280,
        height: 720,
        dynamic_range: "sdr"
      },
      transition: { type: "hard_cut" },
      failure_policy: "continue_native"
    }],
    feature_flags: {
      replace_enabled: true,
      insert_enabled: false,
      skip_enabled: false,
      mute_enabled: false,
      emergency_disable: false
    },
    content: {
      spoilers: true,
      warnings: [],
      synthetic_media: true,
      real_person_likeness: false
    },
    rights: {
      classification: "cleared-test",
      approval_reference: "fixture-clearance-001"
    },
    signature: {
      algorithm: "Ed25519",
      key_id: "manifest-key-2026-01",
      value: ""
    },
    ...overrides
  };
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function signingHarness(keyId = "manifest-key-2026-01") {
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const trustedKeys = { [keyId]: { status: "active", publicKey } };
  const sign = async (manifest) => {
    const candidate = structuredClone(manifest);
    candidate.signature.key_id = keyId;
    candidate.signature.value = "";
    const signature = await webcrypto.subtle.sign(
      { name: "Ed25519" },
      keyPair.privateKey,
      new TextEncoder().encode(canonicalizeManifest(candidate))
    );
    candidate.signature.value = toBase64(signature);
    return candidate;
  };
  return { keyPair, trustedKeys, sign };
}

test("validates the strict fixture manifest and rejects unknown or overlapping content", () => {
  const validSignature = `${"A".repeat(86)}==`;
  assert.equal(validateManifestSchema({ ...baseManifest(), signature: { ...baseManifest().signature, value: validSignature } }).ok, true);

  const hostile = baseManifest({
    execute: "alert(1)",
    segments: [
      baseManifest().segments[0],
      { ...baseManifest().segments[0], segment_id: "segment-2", trigger_time_ms: 7_000, resume_time_ms: 9_000 }
    ]
  });
  const result = validateManifestSchema({ ...hostile, signature: { ...hostile.signature, value: validSignature } });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "unknown-field"), true);
  assert.equal(result.errors.some((error) => error.code === "overlapping-or-unsorted"), true);
});

test("accepts only bounded integer replacement gain", () => {
  const validSignature = `${"A".repeat(86)}==`;
  const withGain = baseManifest();
  withGain.segments[0].transition.gain_db = -8;
  withGain.signature.value = validSignature;
  assert.equal(validateManifestSchema(withGain).ok, true);

  withGain.segments[0].transition.gain_db = -25;
  assert.equal(validateManifestSchema(withGain).errors.some((error) =>
    error.path.endsWith("transition.gain_db") && error.code === "out-of-range"), true);
  withGain.segments[0].transition.gain_db = -2.5;
  assert.equal(validateManifestSchema(withGain).errors.some((error) =>
    error.path.endsWith("transition.gain_db") && error.code === "out-of-range"), true);
});

test("verifies the packaged fixture manifest against its committed public key", async () => {
  assert.deepEqual(await verifySignedManifest(fixtureManifest, fixtureTrustedManifestKeys, webcrypto), {
    ok: true,
    code: "verified",
    errors: []
  });
});

test("canonicalization is key-order independent and excludes only the signature value", () => {
  const left = baseManifest();
  const right = JSON.parse(JSON.stringify(left, Object.keys(left).reverse()));
  assert.equal(canonicalizeManifest(left).includes('"value"'), false);
  assert.equal(canonicalizeManifest(left).includes('"key_id":"manifest-key-2026-01"'), true);
  assert.notEqual(canonicalizeManifest(right), canonicalizeManifest(left));
  const reordered = Object.fromEntries(Object.entries(left).reverse());
  assert.equal(canonicalizeManifest(reordered), canonicalizeManifest(left));
});

test("verifies Ed25519 and rejects a tampered manifest", async () => {
  const { trustedKeys, sign } = await signingHarness();
  const signed = await sign(baseManifest());
  assert.deepEqual(await verifySignedManifest(signed, trustedKeys, webcrypto), { ok: true, code: "verified", errors: [] });
  signed.source.expected_runtime_ms += 1;
  assert.equal((await verifySignedManifest(signed, trustedKeys, webcrypto)).code, "signature-invalid");
});

test("supports key rotation and rejects revoked signing keys", async () => {
  const oldHarness = await signingHarness("manifest-key-old");
  const newHarness = await signingHarness("manifest-key-new");
  const trustedKeys = { ...oldHarness.trustedKeys, ...newHarness.trustedKeys };
  const oldSigned = await oldHarness.sign(baseManifest());
  const newSigned = await newHarness.sign({ ...baseManifest(), manifest_version: 2 });
  assert.equal((await verifySignedManifest(oldSigned, trustedKeys, webcrypto)).ok, true);
  assert.equal((await verifySignedManifest(newSigned, trustedKeys, webcrypto)).ok, true);
  trustedKeys["manifest-key-old"].status = "revoked";
  assert.equal((await verifySignedManifest(oldSigned, trustedKeys, webcrypto)).code, "signing-key-revoked");
});

test("allows exact replay but rejects downgrade, immutable conflicts, and revoked versions", () => {
  const current = { ...baseManifest(), manifest_version: 2, signature: { ...baseManifest().signature, value: "AA==" } };
  assert.equal(evaluateManifestVersion(structuredClone(current), current).code, "verified-replay");
  assert.equal(evaluateManifestVersion({ ...current, manifest_version: 1 }, current).code, "downgrade-rejected");
  assert.equal(evaluateManifestVersion({ ...current, source: { ...current.source, title: "Changed" } }, current).code, "immutable-version-conflict");
  assert.equal(evaluateManifestVersion({ ...current, manifest_version: 3 }, current, { revokedVersions: [3] }).code, "manifest-version-revoked");
});

test("falls back to a verified last-known-good manifest on tamper and disables when none is safe", async () => {
  const { trustedKeys, sign } = await signingHarness();
  const lastKnownGood = await sign(baseManifest());
  const candidate = await sign({ ...baseManifest(), manifest_version: 2 });
  candidate.segments[0].resume_time_ms = 8_001;
  const rolledBack = await resolveManifestActivation({
    candidate,
    lastKnownGood,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto,
    now: () => "2026-08-25T01:00:00.000Z"
  });
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(rolledBack.manifest.manifest_version, 1);
  assert.equal(rolledBack.audit.reason, "signature-invalid");

  const disabled = await resolveManifestActivation({
    candidate,
    lastKnownGood,
    trustedKeys,
    adapterVersion,
    revokedVersions: [1],
    cryptoApi: webcrypto
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.manifest, null);
});

test("a signed emergency disable enters native-only mode", async () => {
  const { trustedKeys, sign } = await signingHarness();
  const lastKnownGood = await sign(baseManifest());
  const disabledCandidate = await sign({
    ...baseManifest(), manifest_version: 2,
    feature_flags: { ...baseManifest().feature_flags, emergency_disable: true }
  });
  const result = await resolveManifestActivation({
    candidate: disabledCandidate,
    lastKnownGood,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(result.status, "disabled");
  assert.equal(result.audit.reason, "emergency-disabled");
});

test("a current emergency disable suppresses fallback from a rejected later candidate", async () => {
  const { trustedKeys, sign } = await signingHarness();
  const lastKnownGood = await sign(baseManifest());
  const currentVerified = await sign({
    ...baseManifest(), manifest_version: 2,
    feature_flags: { ...baseManifest().feature_flags, emergency_disable: true }
  });
  const rejected = await sign({ ...baseManifest(), manifest_version: 1 });
  const result = await resolveManifestActivation({
    candidate: rejected,
    currentVerified,
    lastKnownGood,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(result.status, "disabled");
  assert.equal(result.manifest, null);
  assert.equal(result.audit.reason, "downgrade-rejected");
});

test("enforces exact and wildcard adapter semantic-version bounds", () => {
  const compatibility = { min_adapter_version: "0.1.0", max_adapter_version: "0.x" };
  assert.equal(evaluateAdapterCompatibility("0.1.0", compatibility).code, "adapter-version-compatible");
  assert.equal(evaluateAdapterCompatibility("0.99.4", compatibility).ok, true);
  assert.equal(evaluateAdapterCompatibility("0.0.9", compatibility).code, "adapter-version-below-minimum");
  assert.equal(evaluateAdapterCompatibility("1.0.0", compatibility).code, "adapter-version-above-maximum");
  assert.equal(evaluateAdapterCompatibility("0.1", compatibility).code, "adapter-version-invalid");
  assert.equal(evaluateAdapterCompatibility("0.1.0", {
    min_adapter_version: "0.1.0",
    max_adapter_version: "9007199254740991.x"
  }).code, "adapter-version-invalid");
  assert.equal(evaluateAdapterCompatibility("1.0.0", {
    min_adapter_version: "2.0.0",
    max_adapter_version: "1.x"
  }).code, "adapter-version-range-invalid");
});

test("falls back for an incompatible candidate but lets a signed kill switch disable every adapter", async () => {
  const { trustedKeys, sign } = await signingHarness();
  const lastKnownGood = await sign(baseManifest());
  const incompatible = await sign({
    ...baseManifest(),
    manifest_version: 2,
    compatibility: { ...baseManifest().compatibility, min_adapter_version: "1.0.0", max_adapter_version: "1.x" }
  });
  const fallback = await resolveManifestActivation({
    candidate: incompatible,
    lastKnownGood,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(fallback.status, "rolled-back");
  assert.equal(fallback.audit.reason, "adapter-version-below-minimum");

  const disable = await sign({
    ...incompatible,
    manifest_version: 3,
    feature_flags: { ...incompatible.feature_flags, emergency_disable: true }
  });
  const disabled = await resolveManifestActivation({
    candidate: disable,
    lastKnownGood,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.audit.reason, "emergency-disabled");
});
