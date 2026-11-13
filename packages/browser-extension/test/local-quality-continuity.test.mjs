import assert from "node:assert/strict";
import test from "node:test";

import { assessLocalQualityContinuity } from "../src/local-quality-continuity.mjs";

test("warns when a local asset is materially lower resolution than native playback", () => {
  const result = assessLocalQualityContinuity([
    { assetId: "table", width: 1056, height: 608 }
  ], { width: 1920, height: 1080 });
  assert.equal(result.status, "warning");
  assert.equal(result.warnings.some((warning) => warning.code === "materially-lower-resolution"), true);
  assert.deepEqual(result.unassessed, ["bitrate", "frame-rate"]);
});

test("accepts matching resolution and reports unavailable native resolution as unknown", () => {
  assert.equal(assessLocalQualityContinuity([
    { assetId: "full-hd", width: 1920, height: 1080 }
  ], { width: 1920, height: 1080 }).status, "compatible-resolution");
  assert.equal(assessLocalQualityContinuity([
    { assetId: "full-hd", width: 1920, height: 1080 }
  ], { width: 0, height: 0 }).status, "unknown");
});
