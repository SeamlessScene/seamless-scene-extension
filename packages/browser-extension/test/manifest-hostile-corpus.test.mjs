import assert from "node:assert/strict";
import test from "node:test";
import { fixtureManifest } from "../src/fixture-signed-manifest.mjs";
import { canonicalizeManifest, ManifestSecurityError, validateManifestSchema } from "../src/manifest-security.mjs";

function manifest() {
  return structuredClone(fixtureManifest);
}

const hostileCorpus = [
  ["top-level executable field", (value) => { value.execute = "alert(1)"; }],
  ["external asset URL field", (value) => { value.segments[0].asset.url = "https://attacker.invalid/payload"; }],
  ["script-shaped action", (value) => { value.segments[0].action = "javascript:alert(1)"; }],
  ["oversized source identifier", (value) => { value.source.service_content_id = "a".repeat(257); }],
  ["oversized warning list", (value) => { value.content.warnings = Array(33).fill("warning"); }],
  ["oversized warning text", (value) => { value.content.warnings = ["x".repeat(129)]; }],
  ["oversized segment list", (value) => { value.segments = Array(1001).fill(value.segments[2]); }],
  ["invalid signature bytes", (value) => { value.signature.value = "AAAA"; }],
  ["non-semver adapter minimum", (value) => { value.compatibility.min_adapter_version = "latest"; }],
  ["inverted adapter range", (value) => {
    value.compatibility.min_adapter_version = "2.0.0";
    value.compatibility.max_adapter_version = "1.x";
  }],
  ["fractional timeline", (value) => { value.segments[0].trigger_time_ms = 2999.5; }],
  ["disabled declared action", (value) => { value.feature_flags.replace_enabled = false; }],
  ["overlapping source intervals", (value) => { value.segments[1].trigger_time_ms = 7000; value.segments[1].resume_time_ms = 7000; }],
  ["unknown nested transition field", (value) => { value.segments[0].transition.command = "eval"; }]
];

test("rejects the maintained hostile JSON manifest corpus without executing or resolving payloads", async (t) => {
  for (const [name, mutate] of hostileCorpus) {
    await t.test(name, () => {
      const candidate = manifest();
      mutate(candidate);
      const reparsed = JSON.parse(JSON.stringify(candidate));
      assert.equal(validateManifestSchema(reparsed).ok, false);
    });
  }
});

test("canonicalization rejects non-JSON numeric and object values", () => {
  const withNaN = manifest();
  withNaN.manifest_version = Number.NaN;
  assert.throws(() => canonicalizeManifest(withNaN), (error) =>
    error instanceof ManifestSecurityError && error.code === "non-canonical-number");

  const withDate = manifest();
  withDate.content = new Date();
  assert.throws(() => canonicalizeManifest(withDate), (error) =>
    error instanceof ManifestSecurityError && error.code === "non-canonical-value");
});
