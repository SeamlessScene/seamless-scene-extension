const PRIME_ID_PATTERN = /^[A-Z0-9]{8,32}$/;

function normalizeId(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return PRIME_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTitle(title, serviceName = "Amazon") {
  return String(title ?? "")
    .trim()
    .replace(new RegExp(`\\s*[-|]\\s*${serviceName}\\s*$`, "i"), "")
    .trim();
}

export function inferTitleScope(title, serviceName = "Amazon") {
  const normalized = normalizeTitle(title, serviceName);
  if (!normalized) return { scope: "unknown", season: null, episode: null };
  const seasonEpisode = normalized.match(/\bS(?:eason)?\s*(\d{1,3})\s*E(?:pisode)?\s*(\d{1,3})\b/i)
    ?? normalized.match(/\bSeason\s*(\d{1,3})\s*[,·:\-]?\s*Episode\s*(\d{1,3})\b/i);
  if (seasonEpisode) {
    return { scope: "episode", season: Number(seasonEpisode[1]), episode: Number(seasonEpisode[2]) };
  }
  const season = normalized.match(/\bSeason\s*(\d{1,3})\b/i);
  if (season) return { scope: "season", season: Number(season[1]), episode: null };
  return { scope: "title", season: null, episode: null };
}

export function resolvePrimeRouteIdentity({ pathname = "", search = "" } = {}) {
  const routeCandidateId = normalizeId(
    pathname.match(/\/(?:detail|dp)\/([A-Z0-9]{8,32})(?:\/|$)/i)?.[1]
  );
  const parameters = new URLSearchParams(search);
  const pageTypeCandidateId = normalizeId(parameters.get("pageTypeId"));
  const candidateRelation = !routeCandidateId || !pageTypeCandidateId
    ? "insufficient"
    : routeCandidateId === pageTypeCandidateId
      ? "same"
      : "distinct";
  return { routeCandidateId, pageTypeCandidateId, candidateRelation };
}

export function buildPrimeDepth0Identity({ location, documentTitle, runtimeMs, serviceName = "Amazon" }) {
  const route = resolvePrimeRouteIdentity(location);
  const title = inferTitleScope(documentTitle, serviceName);
  let status = "unknown";
  let reason = "no-route-candidate";

  if (route.routeCandidateId && !Number.isFinite(runtimeMs)) {
    reason = "no-active-runtime";
  } else if (route.routeCandidateId && title.scope === "season") {
    reason = "season-context-not-linked-to-playing-episode";
  } else if (route.routeCandidateId && route.candidateRelation === "distinct") {
    reason = "distinct-route-and-page-type-candidates";
  } else if (route.routeCandidateId && Number.isFinite(runtimeMs)) {
    status = "candidate";
    reason = title.scope === "episode"
      ? "episode-label-not-independently-linked-to-player"
      : "exact-version-not-independently-confirmed";
  }

  return {
    integrationDepth: 0,
    status,
    reason,
    routeCandidateId: route.routeCandidateId,
    pageTypeCandidateId: route.pageTypeCandidateId,
    candidateRelation: route.candidateRelation,
    titleScope: title.scope,
    season: title.season,
    episode: title.episode,
    runtimeAvailable: Number.isFinite(runtimeMs),
    activeItemIdAvailable: false,
    exactVersionAvailable: false,
    territoryAvailable: false,
    planAvailable: false
  };
}

export function assessSourceFingerprintCoverage(observed) {
  if (!observed || typeof observed !== "object") {
    return Object.freeze({
      status: "unknown",
      reason: "missing-observation",
      missingFields: Object.freeze(["activeItemId", "runtimeMs", "mediaType"])
    });
  }

  const missingFields = [];
  if (!observed.activeItemId) missingFields.push("activeItemId");
  if (!Number.isInteger(observed.runtimeMs) || observed.runtimeMs < 1_000) missingFields.push("runtimeMs");
  if (!observed.mediaType || observed.mediaType === "unknown") missingFields.push("mediaType");
  if (observed.mediaType === "episode") {
    if (!Number.isInteger(observed.season)) missingFields.push("season");
    if (!Number.isInteger(observed.episode)) missingFields.push("episode");
  }
  const unavailableReason = {
    activeItemId: "active-item-unavailable",
    runtimeMs: "runtime-unavailable",
    mediaType: "media-type-unavailable",
    season: "season-unavailable",
    episode: "episode-unavailable"
  };
  const status = missingFields.length ? "unknown" : "spike-ready";
  const reason = missingFields.length
    ? unavailableReason[missingFields[0]]
    : "active-item-episode-runtime-available";
  return Object.freeze({
    status,
    reason,
    missingFields: Object.freeze(missingFields)
  });
}

export const RUNTIME_TOLERANCE_FLOOR_MS = 2_500;

export function evaluateSourceCompatibility(observed, expected) {
  if (!observed || !expected) return { status: "unknown", reason: "missing-comparison-input" };
  if (!expected.serviceId || !expected.serviceContentId || !Number.isFinite(expected.runtimeMs)) {
    return { status: "unknown", reason: "manifest-fingerprint-incomplete" };
  }
  if (expected.serviceId && observed.serviceId && expected.serviceId !== observed.serviceId) {
    return { status: "incompatible", reason: "service-mismatch" };
  }
  if (expected.serviceContentId && observed.activeItemId
    && expected.serviceContentId !== observed.activeItemId) {
    return { status: "incompatible", reason: "active-item-mismatch" };
  }
  if (Number.isFinite(expected.runtimeMs) && Number.isFinite(observed.runtimeMs)) {
    // Prime reports a slightly different runtime for the same title from one session to the next
    // (2,619,000 / 2,620,032 ms for one episode), so an edit published with 1 s of slack failed to
    // turn on at random (0.62.2). The title ID, season and episode still have to match exactly; a
    // reading well off (Prime's +15 s while the intro plays) is still refused.
    const toleranceMs = Math.max(Number.isFinite(expected.runtimeToleranceMs) ? expected.runtimeToleranceMs : 0, RUNTIME_TOLERANCE_FLOOR_MS);
    if (Math.abs(expected.runtimeMs - observed.runtimeMs) > toleranceMs) {
      return { status: "incompatible", reason: "runtime-mismatch" };
    }
  }
  if (expected.season !== undefined && observed.season !== null && expected.season !== observed.season) {
    return { status: "incompatible", reason: "season-mismatch" };
  }
  if (expected.episode !== undefined && observed.episode !== null && expected.episode !== observed.episode) {
    return { status: "incompatible", reason: "episode-mismatch" };
  }
  if (expected.mediaType !== undefined && observed.mediaType !== null && expected.mediaType !== observed.mediaType) {
    return { status: "incompatible", reason: "media-type-mismatch" };
  }
  if (expected.versionTag !== undefined && observed.versionTag !== null && expected.versionTag !== observed.versionTag) {
    return { status: "incompatible", reason: "version-tag-mismatch" };
  }
  if (expected.territory !== undefined && observed.territory !== null && expected.territory !== observed.territory) {
    return { status: "incompatible", reason: "territory-mismatch" };
  }
  if (expected.plan !== undefined && observed.plan !== null && expected.plan !== observed.plan) {
    return { status: "incompatible", reason: "plan-mismatch" };
  }

  const required = [
    ["service-id-unavailable", expected.serviceId, observed.serviceId],
    ["service-content-id-unavailable", expected.serviceContentId, observed.activeItemId],
    ["runtime-unavailable", expected.runtimeMs, observed.runtimeMs],
    ["media-type-unavailable", expected.mediaType, observed.mediaType],
    ["season-unavailable", expected.season, observed.season],
    ["episode-unavailable", expected.episode, observed.episode]
    // Version tag, territory and plan are compared above when a service reports them. Prime never
    // does, so they cannot be required, or no catalog Prime edit could ever arm (field testing 2026-09-24).
  ];
  for (const [reason, expectedValue, observedValue] of required) {
    if (expectedValue !== undefined && expectedValue !== null && (observedValue === undefined || observedValue === null)) {
      return { status: "unknown", reason };
    }
  }
  return { status: "compatible", reason: "all-required-signals-match" };
}
