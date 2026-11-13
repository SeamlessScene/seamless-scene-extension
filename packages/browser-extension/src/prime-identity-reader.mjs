import { IDENTITY_BRIDGE_SCHEMA_VERSION } from "./identity-bridge-protocol.mjs";

const PRIME_ASIN_PATTERN = /^[A-Z0-9]{8,32}$/;
const PRIME_GTI_PATTERN = /^amzn1\.dv\.gti\.[A-Za-z0-9][A-Za-z0-9._:-]{7,111}$/i;
const MAX_RUNTIME_MS = 24 * 60 * 60 * 1000;

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function normalizeActiveItemId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const upper = normalized.toUpperCase();
  if (PRIME_ASIN_PATTERN.test(upper)) return upper;
  if (PRIME_GTI_PATTERN.test(normalized)) return normalized.toLowerCase();
  return null;
}

function normalizeMediaType(catalog, season, episode) {
  const type = [catalog?.type, catalog?.entityType]
    .find((value) => typeof value === "string")
    ?.trim()
    .toUpperCase();
  if (type === "EPISODE" && season !== null && episode !== null) return "episode";
  if (type === "MOVIE" || type === "FILM") return "film";
  return "unknown";
}

function runtimeFromVideo(video) {
  const runtimeMs = Math.round(Number(video?.duration) * 1000);
  return Number.isInteger(runtimeMs) && runtimeMs >= 1000 && runtimeMs <= MAX_RUNTIME_MS
    ? runtimeMs
    : null;
}

function canonicalClockFromWebPlayer(webPlayer, runtimeMs) {
  const currentTime = webPlayer?.currentTime;
  const currentPosition = currentTime?.currentPosition;
  const contentRelativeTimeMs = currentTime?.contentRelativeTimeMs;
  let candidate = typeof currentPosition === "number" && Number.isFinite(currentPosition)
    ? { value: currentPosition, provenance: "provider-current-position" }
    : typeof contentRelativeTimeMs === "number" && Number.isFinite(contentRelativeTimeMs)
      ? { value: contentRelativeTimeMs, provenance: "provider-content-relative-time" }
      : null;

  if (!candidate) {
    try {
      const timeDataManager = webPlayer?.player?.playlistPlaybackController?.timeDataManager;
      const getTimeData = timeDataManager?.getTimeData;
      if (typeof getTimeData === "function") {
        const methodCurrentPosition = getTimeData.call(timeDataManager)?.currentPosition;
        if (typeof methodCurrentPosition === "number" && Number.isFinite(methodCurrentPosition)) {
          candidate = {
            value: methodCurrentPosition,
            provenance: "provider-time-data-method"
          };
        }
      }
    } catch {
      return { timeMs: null, provenance: "not-available" };
    }
  }
  if (!candidate) return { timeMs: null, provenance: "not-available" };

  const timeMs = Math.round(candidate.value);
  if (timeMs < 0 || timeMs > MAX_RUNTIME_MS) return { timeMs: null, provenance: "not-available" };
  if (runtimeMs !== null && timeMs > runtimeMs) return { timeMs: null, provenance: "not-available" };
  return { timeMs, provenance: candidate.provenance };
}

// The same host-root fiber is reachable through the legacy ReactDOM.render root
// and through a React 18+ createRoot container key; reading either is the same
// read-only access, so a React upgrade on Prime does not silently drop identity.
function hostRootFiber(container) {
  const legacy = container?._reactRootContainer?._internalRoot?.current;
  if (legacy) return legacy;
  if (!container || typeof container !== "object") return null;
  const key = Object.keys(container).find(name => name.startsWith("__reactContainer$"));
  return key ? container[key] ?? null : null;
}

// Prime may keep an idle #dv-web-player and play in #dv-web-player-2 (seen
// 2026-09-24). Every reviewed container is a candidate; the one whose video has a
// real duration and the largest visible area is the player in use.
export const PRIME_PLAYER_CONTAINER_SELECTOR = 'div#dv-web-player, div[id^="dv-web-player-"]';
const PRIME_PLAYER_CONTAINER_ID = /^dv-web-player(?:-\d{1,3})?$/;

export function activePrimePlayerContainers(document) {
  if (typeof document?.querySelectorAll !== "function") {
    const only = document?.querySelector?.("div#dv-web-player") ?? null;
    return only ? [only] : [];
  }
  const score = (container) => {
    const video = container.querySelector?.("video");
    const bounds = video?.getBoundingClientRect?.();
    const area = bounds ? Math.max(0, bounds.width) * Math.max(0, bounds.height) : 0;
    return runtimeFromVideo(video) === null ? -1 : area;
  };
  return [...document.querySelectorAll(PRIME_PLAYER_CONTAINER_SELECTOR)]
    .filter(container => PRIME_PLAYER_CONTAINER_ID.test(container.id ?? ""))
    .map((container, index) => ({ container, index, score: score(container) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ container }) => container);
}

export function readReviewedPrimePlayerState(document, { includeCanonicalClock = true } = {}) {
  try {
    const playerContainer = activePrimePlayerContainers(document)[0] ?? null;
    const playerVideo = playerContainer?.querySelector?.("video") ?? null;
    const context = hostRootFiber(playerContainer)?.memoizedState?.element?.props?.context ?? null;
    const webPlayer = context?.webPlayer ?? null;
    const catalogRoot = context?.webPlayerContext ?? context;
    const catalog = catalogRoot?.metadataService?.metadata?.catalogMetadataV2
      ?.resourceData?.catalog ?? null;
    const activeItemId = normalizeActiveItemId(webPlayer?.player?.contentConfig?.titleId);
    const seasonCandidate = boundedInteger(catalog?.seasonNumber, 1, 999);
    const episodeCandidate = boundedInteger(catalog?.episodeNumber, 1, 9999);
    const mediaType = normalizeMediaType(catalog, seasonCandidate, episodeCandidate);
    const season = mediaType === "episode" ? seasonCandidate : null;
    const episode = mediaType === "episode" ? episodeCandidate : null;
    const runtimeMs = runtimeFromVideo(playerVideo);
    const canonicalClock = includeCanonicalClock
      ? canonicalClockFromWebPlayer(webPlayer, runtimeMs)
      : { timeMs: null, provenance: "not-available" };

    return {
      playerContainer,
      playerVideo,
      activeItemId,
      mediaType,
      season,
      episode,
      canonicalTimeMs: canonicalClock.timeMs,
      canonicalTimeProvenance: canonicalClock.provenance,
      runtimeMs
    };
  } catch {
    return {
      playerContainer: null,
      playerVideo: null,
      activeItemId: null,
      mediaType: "unknown",
      season: null,
      episode: null,
      canonicalTimeMs: null,
      canonicalTimeProvenance: "not-available",
      runtimeMs: null
    };
  }
}

export function createPrimeIdentitySnapshotReader({ document }) {
  if (!document || typeof document.querySelector !== "function") {
    throw new TypeError("prime-identity-document-invalid");
  }

  let initialized = false;
  let lifecycleGeneration = 1;
  let lastPlayerContainer = null;
  let lastPlayerVideo = null;
  let lastActiveItemId = null;

  return {
    readSnapshot({ includeCanonicalClock = true } = {}) {
      const state = readReviewedPrimePlayerState(document, { includeCanonicalClock });
      if (initialized && (
        state.playerContainer !== lastPlayerContainer
        || state.playerVideo !== lastPlayerVideo
        || state.activeItemId !== lastActiveItemId
      )) {
        lifecycleGeneration += 1;
      }
      initialized = true;
      lastPlayerContainer = state.playerContainer;
      lastPlayerVideo = state.playerVideo;
      lastActiveItemId = state.activeItemId;

      return {
        schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION,
        serviceId: "prime-video",
        activeItemId: state.activeItemId,
        mediaType: state.mediaType,
        season: state.season,
        episode: state.episode,
        canonicalTimeMs: state.canonicalTimeMs,
        runtimeMs: state.runtimeMs,
        versionTag: null,
        territory: null,
        plan: null,
        lifecycleGeneration,
        provenance: {
          activeItemId: state.activeItemId ? "provider-player-state" : "not-available",
          mediaType: state.mediaType === "unknown" ? "not-available" : "provider-player-state",
          season: state.season === null ? "not-available" : "provider-player-state",
          episode: state.episode === null ? "not-available" : "provider-player-state",
          canonicalTimeMs: state.canonicalTimeProvenance,
          runtimeMs: state.runtimeMs === null ? "not-available" : "standard-media-element",
          versionTag: "not-available",
          territory: "not-available",
          plan: "not-available",
          lifecycleGeneration: "provider-lifecycle-state"
        }
      };
    }
  };
}
