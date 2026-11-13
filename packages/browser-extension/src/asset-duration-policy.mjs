// Explicit caller context selects private bounds; packet fields never widen
// the default catalog/signature validation profile.
// Clip bounds per profile come from the single rules source (rules/seamless-rules-v1.json, via the
// generated seamless-rules.mjs). 0.64.2 (E71): local-user from 1.5 s. 0.65.0 (W9): catalog-v2 from
// 1.5 s too; a catalog packet with a clip under 5 s needs required_client_version 0.65.0
// (catalog-packet.mjs). Legacy signed (mvp) stays 5–60 s. Shorter clips than 1.5 s end before
// native's join seek is reliably done on Prime (docs/research/short-clips-2026-10-13/README.md).
import { RULES, clipDurationRule } from './seamless-rules.mjs';
export const MIN_ASSET_DURATION_MS = RULES.clip.duration_ms.mvp.min;
export const LOCAL_USER_MIN_ASSET_DURATION_MS = RULES.clip.duration_ms['local-user'].min;
export const CATALOG_V2_MIN_ASSET_DURATION_MS = RULES.clip.duration_ms['catalog-v2'].min;
export const CATALOG_MAX_ASSET_DURATION_MS = RULES.clip.duration_ms.mvp.max;
export const LOCAL_USER_MAX_ASSET_DURATION_MS = RULES.clip.duration_ms['local-user'].max;
export const CATALOG_V2_MAX_ASSET_DURATION_MS = RULES.clip.duration_ms['catalog-v2'].max;

export function supportsBoundedAssetDimensions(width, height) {
  const { min, max, even } = RULES.clip.dimensions;
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= min[0] && height >= min[1] &&
    width <= max[0] && height <= max[1] && (!even || (width % 2 === 0 && height % 2 === 0));
}

export function maximumAssetDurationMs(profileClass = "mvp") { return clipDurationRule(profileClass).max; }

export function minimumAssetDurationMs(profileClass = "mvp") { return clipDurationRule(profileClass).min; }

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
