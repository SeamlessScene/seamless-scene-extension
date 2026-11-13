import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSourceFingerprintCoverage,
  buildPrimeDepth0Identity,
  evaluateSourceCompatibility,
  inferTitleScope,
  resolvePrimeRouteIdentity
} from "../src/source-identity.mjs";

test("marks active item, episode coordinates, and runtime ready for the internal spike", () => {
  assert.deepEqual(assessSourceFingerprintCoverage({
    activeItemId: "amzn1.dv.gti.example-episode",
    mediaType: "episode",
    season: 1,
    episode: 2,
    runtimeMs: 2_700_000,
    territory: null,
    plan: null,
    versionTag: null
  }), {
    status: "spike-ready",
    reason: "active-item-episode-runtime-available",
    missingFields: []
  });
});

test("keeps structurally incomplete fingerprints unknown", () => {
  assert.deepEqual(assessSourceFingerprintCoverage({
    activeItemId: "amzn1.dv.gti.example-episode",
    mediaType: "episode",
    season: 1,
    episode: null,
    runtimeMs: 2_700_000,
    territory: "US",
    plan: "ad-free"
  }), {
    status: "unknown",
    reason: "episode-unavailable",
    missingFields: ["episode"]
  });
});

test("classifies title scope without treating a season page as an episode", () => {
  assert.deepEqual(inferTitleScope("Example Series - Season 2 | Amazon"), {
    scope: "season",
    season: 2,
    episode: null
  });
  assert.deepEqual(inferTitleScope("Example Series S2 E4 | Amazon"), {
    scope: "episode",
    season: 2,
    episode: 4
  });
});

test("keeps Prime route and page-context identifiers separate", () => {
  assert.deepEqual(resolvePrimeRouteIdentity({
    pathname: "/gp/video/detail/B0B9D02783",
    search: "?pageTypeId=B01A4A32C3"
  }), {
    routeCandidateId: "B0B9D02783",
    pageTypeCandidateId: "B01A4A32C3",
    candidateRelation: "distinct"
  });
});

test("fails closed when a season route is not linked to the playing episode", () => {
  const result = buildPrimeDepth0Identity({
    location: {
      pathname: "/gp/video/detail/B0B9D02783",
      search: ""
    },
    documentTitle: "Example Series - Season 1 | Amazon",
    runtimeMs: 2_700_000
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "season-context-not-linked-to-playing-episode");
  assert.equal(result.activeItemIdAvailable, false);
  assert.equal(result.exactVersionAvailable, false);
});

test("never calls depth-zero route and runtime evidence compatible", () => {
  const result = buildPrimeDepth0Identity({
    location: {
      pathname: "/gp/video/detail/B0B9D02783",
      search: ""
    },
    documentTitle: "Example Film | Amazon",
    runtimeMs: 7_200_000
  });

  assert.equal(result.status, "candidate");
  assert.equal(result.reason, "exact-version-not-independently-confirmed");
});

test("blocks known mismatches and leaves missing required evidence unknown", () => {
  assert.deepEqual(evaluateSourceCompatibility({
    serviceId: "prime-video",
    activeItemId: "ITEM-B",
    runtimeMs: 10_000
  }, {
    serviceId: "prime-video",
    serviceContentId: "ITEM-A",
    runtimeMs: 10_000
  }), { status: "incompatible", reason: "active-item-mismatch" });

  assert.deepEqual(evaluateSourceCompatibility({
    serviceId: "prime-video",
    activeItemId: null,
    runtimeMs: 10_000
  }, {
    serviceId: "prime-video",
    serviceContentId: "ITEM-A",
    runtimeMs: 10_000
  }), { status: "unknown", reason: "service-content-id-unavailable" });
});

test("returns compatible only after all required fields and exact version are confirmed", () => {
  assert.deepEqual(evaluateSourceCompatibility({
    serviceId: "prime-video",
    activeItemId: "ITEM-A",
    runtimeMs: 10_020,
    season: 1,
    episode: 2,
    territory: "test-territory",
    plan: "ad-free-test",
    versionTag: "fixture-native-v1"
  }, {
    serviceId: "prime-video",
    serviceContentId: "ITEM-A",
    runtimeMs: 10_000,
    runtimeToleranceMs: 50,
    season: 1,
    episode: 2,
    territory: "test-territory",
    plan: "ad-free-test",
    versionTag: "fixture-native-v1"
  }), { status: "compatible", reason: "all-required-signals-match" });
});

test("blocks a known version-tag mismatch even when ID and runtime agree", () => {
  assert.deepEqual(evaluateSourceCompatibility({
    serviceId: "prime-video",
    activeItemId: "ITEM-A",
    runtimeMs: 10_000,
    versionTag: "cut-b"
  }, {
    serviceId: "prime-video",
    serviceContentId: "ITEM-A",
    runtimeMs: 10_000,
    versionTag: "cut-a"
  }), { status: "incompatible", reason: "version-tag-mismatch" });
});

test("matches the internal ID, episode, and runtime check without a standalone version tag", () => {
  assert.deepEqual(evaluateSourceCompatibility({
    serviceId: "prime-video",
    activeItemId: "amzn1.dv.gti.example-episode",
    mediaType: "episode",
    season: 1,
    episode: 2,
    runtimeMs: 2_700_025,
    versionTag: null
  }, {
    serviceId: "prime-video",
    serviceContentId: "amzn1.dv.gti.example-episode",
    mediaType: "episode",
    season: 1,
    episode: 2,
    runtimeMs: 2_700_000,
    runtimeToleranceMs: 50
  }), { status: "compatible", reason: "all-required-signals-match" });
});

test("blocks a runtime mismatch even when active item and episode match", () => {
  assert.deepEqual(evaluateSourceCompatibility({
    serviceId: "prime-video",
    activeItemId: "amzn1.dv.gti.example-episode",
    mediaType: "episode",
    season: 1,
    episode: 2,
    runtimeMs: 2_705_000
  }, {
    serviceId: "prime-video",
    serviceContentId: "amzn1.dv.gti.example-episode",
    mediaType: "episode",
    season: 1,
    episode: 2,
    runtimeMs: 2_700_000,
    runtimeToleranceMs: 50
  }), { status: "incompatible", reason: "runtime-mismatch" });
});
