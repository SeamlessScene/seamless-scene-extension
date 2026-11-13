import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fixtureTrustedManifestKeys } from "../src/fixture-signed-manifest.mjs";
import {
  compileLocalUserEditActions,
  isSafeRelativeMediaPath,
  localBindingMap,
  manifestAssetHashes,
  validateLocalEditPacket,
  validateLocalUserEditPacket,
  verifyLocalEditPacket
} from "../src/local-edit-packet.mjs";

const exampleUrl = new URL("../media/edit-packet.json", import.meta.url);

async function examplePacket() {
  return JSON.parse(await readFile(exampleUrl, "utf8"));
}

test("accepts the committed folder-local packet and verifies its signed manifest", async () => {
  const packet = await examplePacket();
  assert.deepEqual(validateLocalEditPacket(packet), { ok: true, errors: [] });
  assert.deepEqual(await verifyLocalEditPacket(packet, fixtureTrustedManifestKeys), {
    ok: true,
    code: "verified",
    errors: []
  });
  assert.deepEqual(manifestAssetHashes(packet.manifest), [packet.asset_bindings[0].sha256]);
  assert.equal(localBindingMap(packet).get(packet.asset_bindings[0].sha256), "replacement.mp4");

  const media = await readFile(new URL("../media/replacement.mp4", import.meta.url));
  assert.equal(createHash("sha256").update(media).digest("hex"), packet.asset_bindings[0].sha256);
});

test("allows only bounded relative MP4 paths", () => {
  assert.equal(isSafeRelativeMediaPath("clips/insert-01.mp4"), true);
  assert.equal(isSafeRelativeMediaPath("insert-01.mp4"), true);
  for (const unsafe of [
    "../insert.mp4",
    "clips/../../insert.mp4",
    "/clips/insert.mp4",
    "C:/clips/insert.mp4",
    "clips\\insert.mp4",
    "https://example.invalid/insert.mp4",
    "clips/insert.mov"
  ]) {
    assert.equal(isSafeRelativeMediaPath(unsafe), false, unsafe);
  }
});

test("fails closed for missing, duplicate, and orphan asset bindings", async () => {
  const missing = await examplePacket();
  missing.asset_bindings = [];
  assert.equal(validateLocalEditPacket(missing).ok, false);

  const duplicate = await examplePacket();
  duplicate.asset_bindings.push({ ...duplicate.asset_bindings[0], relative_path: "copy.mp4" });
  assert.equal(
    validateLocalEditPacket(duplicate).errors.some((error) => error.code === "duplicate-hash-binding"),
    true
  );

  const orphan = await examplePacket();
  orphan.asset_bindings.push({ sha256: "0".repeat(64), relative_path: "orphan.mp4" });
  assert.equal(
    validateLocalEditPacket(orphan).errors.some((error) => error.code === "orphan-binding"),
    true
  );
});

test("keeps relative bindings outside signed manifest trust", async () => {
  const packet = await examplePacket();
  packet.asset_bindings[0].relative_path = "clips/replacement.mp4";
  assert.equal((await verifyLocalEditPacket(packet, fixtureTrustedManifestKeys)).ok, true);

  packet.manifest.segments[0].trigger_time_ms += 1;
  const tampered = await verifyLocalEditPacket(packet, fixtureTrustedManifestKeys);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, "signature-invalid");
});

test("accepts and compiles an explicitly imported unsigned local-user packet", async () => {
  const packet = await examplePacket();
  packet.purpose = "local-user-edit";
  packet.manifest.status = "local-only";
  packet.manifest.rights.classification = "user-supplied";
  packet.manifest.signature = null;
  packet.manifest.segments = [packet.manifest.segments.find((segment) => segment.action === "REPLACE")];
  packet.manifest.feature_flags.insert_enabled = false;
  packet.manifest.feature_flags.skip_enabled = false;
  packet.manifest.feature_flags.mute_enabled = false;
  packet.manifest.segments[0].transition.gain_db = -8;
  for (const segment of packet.manifest.segments) {
    if (segment.asset) {
      segment.asset.width = 1056;
      segment.asset.height = 608;
    }
  }

  assert.deepEqual(validateLocalUserEditPacket(packet), { ok: true, errors: [] });
  assert.deepEqual(compileLocalUserEditActions(packet, {
    resolveAssetUrl: (hash) => `blob:${hash}`
  }), [{
    id: packet.manifest.segments[0].segment_id,
    type: packet.manifest.segments[0].action,
    triggerMs: packet.manifest.segments[0].trigger_time_ms,
    resumeMs: packet.manifest.segments[0].resume_time_ms,
    clipUrl: `blob:${packet.asset_bindings[0].sha256}`,
    expectedDurationMs: packet.manifest.segments[0].asset.expected_duration_ms,
    profileClass: "local-user",
    gainDb: -8
  }]);
  assert.equal((await verifyLocalEditPacket(packet, fixtureTrustedManifestKeys)).ok, false);
});
