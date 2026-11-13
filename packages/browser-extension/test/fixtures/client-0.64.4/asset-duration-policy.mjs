// Explicit caller context selects private bounds; packet fields never widen
// the default catalog/signature validation profile.
// Shortest clip per profile (E71, 0.64.2). Legacy signed (mvp) and catalog-v2 keep 5 s until the
// website, worker and publisher change together and catalog packets gate the client version
// (W9). Explicit local-user edits (.ss, folders, edit packs) go down to 1.5 s: shorter clips end
// before native's join seek is reliably done on Prime (docs/research/short-clips-2026-10-13/README.md).
export const MIN_ASSET_DURATION_MS = 5_000;
export const LOCAL_USER_MIN_ASSET_DURATION_MS = 1_500;
export const CATALOG_V2_MIN_ASSET_DURATION_MS = 5_000;
export const CATALOG_MAX_ASSET_DURATION_MS = 60_000;
export const LOCAL_USER_MAX_ASSET_DURATION_MS = 120_000;
export const CATALOG_V2_MAX_ASSET_DURATION_MS = 120_000;

export function supportsBoundedAssetDimensions(width, height) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 320 && height >= 180 &&
    width <= 4096 && height <= 2160 && width % 2 === 0 && height % 2 === 0;
}

export function maximumAssetDurationMs(profileClass = "mvp") {
  return profileClass === "local-user" ? LOCAL_USER_MAX_ASSET_DURATION_MS :
    profileClass === "catalog-v2" ? CATALOG_V2_MAX_ASSET_DURATION_MS : CATALOG_MAX_ASSET_DURATION_MS;
}

export function minimumAssetDurationMs(profileClass = "mvp") {
  return profileClass === "local-user" ? LOCAL_USER_MIN_ASSET_DURATION_MS :
    profileClass === "catalog-v2" ? CATALOG_V2_MIN_ASSET_DURATION_MS : MIN_ASSET_DURATION_MS;
}

export function supportsAssetDuration(durationMs, profileClass = "mvp") {
  return Number.isFinite(durationMs) && durationMs >= minimumAssetDurationMs(profileClass) && durationMs <= maximumAssetDurationMs(profileClass);
}

// Cumulative buffering a local clip may spend without progress before it is
// abandoned (local-stall); the playback deadlines below allow for it.
export const LOCAL_STALL_BUDGET_MS = 8_000;

export function localPlaybackTimeoutMs(durationMs, profileClass = "mvp") {
  // Keep the historical watchdog for legacy/short actions. A validated long
  // private action gets its authored duration plus five seconds and the stall
  // budget, at most 133s (the renderer and relay deadlines sit above that).
  return supportsAssetDuration(durationMs, profileClass) ? Math.max(65_000, durationMs + 5_000 + LOCAL_STALL_BUDGET_MS) : 65_000;
}
