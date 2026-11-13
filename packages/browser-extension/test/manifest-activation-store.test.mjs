import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { fixtureManifest, fixtureTrustedManifestKeys } from "../src/fixture-signed-manifest.mjs";
import {
  ManifestActivationStore,
  manifestActivationStoreLimits
} from "../src/manifest-activation-store.mjs";
import { canonicalizeManifest } from "../src/manifest-security.mjs";

const adapterVersion = "0.1.0";

function fakeStorage() {
  const values = {};
  return {
    values,
    async get(key) { return { [key]: values[key] }; },
    async set(entries) { Object.assign(values, structuredClone(entries)); },
    async remove(key) { delete values[key]; }
  };
}

async function signingHarness() {
  const keyId = "manifest-store-test-key";
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const trustedKeys = { [keyId]: { status: "active", publicKey } };
  const sign = async (manifest) => {
    const candidate = structuredClone(manifest);
    candidate.signature = { algorithm: "Ed25519", key_id: keyId, value: "" };
    const signature = await webcrypto.subtle.sign(
      { name: "Ed25519" },
      keyPair.privateKey,
      new TextEncoder().encode(canonicalizeManifest(candidate))
    );
    candidate.signature.value = Buffer.from(signature).toString("base64");
    return candidate;
  };
  return { trustedKeys, sign };
}

test("persists a verified manifest and independently reverifies it on read", async () => {
  const storageArea = fakeStorage();
  const store = new ManifestActivationStore({ storageArea });
  const activated = await store.activate({
    editId: fixtureManifest.edit_id,
    candidate: fixtureManifest,
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto,
    actor: "fixture-bootstrap",
    now: () => "2026-08-26T01:00:00.000Z"
  });
  assert.equal(activated.status, "activated");
  assert.equal(activated.durable, true);

  const restored = await new ManifestActivationStore({ storageArea }).read(fixtureManifest.edit_id, {
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(restored.status, "ready");
  assert.equal(restored.manifest.manifest_version, fixtureManifest.manifest_version);
  assert.deepEqual(restored.audit[0], {
    sequence: 1,
    actor: "fixture-bootstrap",
    action: "first-verified-version",
    reason: "verified-candidate",
    candidateVersion: fixtureManifest.manifest_version,
    activeVersion: fixtureManifest.manifest_version,
    at: "2026-08-26T01:00:00.000Z"
  });
});

test("rejects a corrupted or interrupted cache record instead of using its manifest", async () => {
  const storageArea = fakeStorage();
  const key = `manifestActivation.v1.${fixtureManifest.edit_id}`;
  storageArea.values[key] = {
    recordVersion: 1,
    editId: fixtureManifest.edit_id,
    currentVerified: fixtureManifest
  };
  const result = await new ManifestActivationStore({ storageArea }).read(fixtureManifest.edit_id, {
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(result.status, "invalid-cache");
  assert.equal(result.currentVerified, null);
  assert.equal(result.lastKnownGood, null);
});

test("detects post-write manifest tampering during cache revalidation", async () => {
  const storageArea = fakeStorage();
  const store = new ManifestActivationStore({ storageArea });
  await store.activate({
    editId: fixtureManifest.edit_id,
    candidate: fixtureManifest,
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  const key = `manifestActivation.v1.${fixtureManifest.edit_id}`;
  storageArea.values[key].lastKnownGood.source.expected_runtime_ms += 1;
  const result = await store.read(fixtureManifest.edit_id, {
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(result.status, "invalid-cache");
  assert.equal(result.code, "cache-signature-invalid");
});

test("persists an emergency-disable version floor and suppresses cached fallback after restart", async () => {
  const { trustedKeys, sign } = await signingHarness();
  const storageArea = fakeStorage();
  const store = new ManifestActivationStore({ storageArea });
  const version1 = await sign({ ...fixtureManifest, manifest_version: 1 });
  const disabledVersion2 = await sign({
    ...fixtureManifest,
    manifest_version: 2,
    feature_flags: { ...fixtureManifest.feature_flags, emergency_disable: true }
  });
  assert.equal((await store.activate({
    editId: fixtureManifest.edit_id,
    candidate: version1,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  })).status, "activated");
  assert.equal((await store.activate({
    editId: fixtureManifest.edit_id,
    candidate: disabledVersion2,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  })).status, "disabled");

  const restarted = new ManifestActivationStore({ storageArea });
  assert.equal((await restarted.read(fixtureManifest.edit_id, { trustedKeys, adapterVersion, cryptoApi: webcrypto })).status, "disabled");
  assert.equal((await restarted.read(fixtureManifest.edit_id, {
    trustedKeys,
    adapterVersion: "1.0.0",
    cryptoApi: webcrypto
  })).status, "disabled");
  const replayedOldVersion = await restarted.activate({
    editId: fixtureManifest.edit_id,
    candidate: version1,
    trustedKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(replayedOldVersion.status, "disabled");
  assert.equal(replayedOldVersion.audit.reason, "downgrade-rejected");
});

test("keeps a bounded sequence-ordered audit when wall-clock time moves backward", async () => {
  const store = new ManifestActivationStore();
  const total = manifestActivationStoreLimits.maxAuditEntries + 5;
  for (let index = 0; index < total; index += 1) {
    await store.activate({
      editId: fixtureManifest.edit_id,
      candidate: fixtureManifest,
      trustedKeys: fixtureTrustedManifestKeys,
      adapterVersion,
      cryptoApi: webcrypto,
      actor: "fixture-bootstrap",
      now: () => index % 2 === 0 ? "2026-08-26T02:00:00.000Z" : "2026-08-26T01:00:00.000Z"
    });
  }
  const restored = await store.read(fixtureManifest.edit_id, {
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  assert.equal(restored.audit.length, manifestActivationStoreLimits.maxAuditEntries);
  assert.equal(restored.audit[0].sequence, 6);
  assert.equal(restored.audit.at(-1).sequence, total);
  assert.equal(restored.audit.some((entry, index, all) => index > 0 && entry.at < all[index - 1].at), true);
});

test("revoked cached versions fail closed even when their signatures remain valid", async () => {
  const store = new ManifestActivationStore();
  await store.activate({
    editId: fixtureManifest.edit_id,
    candidate: fixtureManifest,
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  const result = await store.read(fixtureManifest.edit_id, {
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    revokedVersions: [fixtureManifest.manifest_version],
    cryptoApi: webcrypto
  });
  assert.equal(result.status, "invalid-cache");
  assert.equal(result.code, "cache-manifest-revoked");
});

test("a verified cache outside the current adapter range is unavailable, not activated", async () => {
  const storageArea = fakeStorage();
  const store = new ManifestActivationStore({ storageArea });
  await store.activate({
    editId: fixtureManifest.edit_id,
    candidate: fixtureManifest,
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion,
    cryptoApi: webcrypto
  });
  const result = await store.read(fixtureManifest.edit_id, {
    trustedKeys: fixtureTrustedManifestKeys,
    adapterVersion: "1.0.0",
    cryptoApi: webcrypto
  });
  assert.equal(result.status, "incompatible-cache");
  assert.equal(result.code, "cache-adapter-version-above-maximum");
  assert.equal(result.lastKnownGood, null);
});
