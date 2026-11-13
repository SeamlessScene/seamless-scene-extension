const MIN_PLAYBACK_WIDTH = 320;
const MIN_PLAYBACK_HEIGHT = 180;
const MIN_LONG_FORM_DURATION_SECONDS = 60;

export function isPlausibleLongFormVideo({ duration, width, height }) {
  return Number.isFinite(duration)
    && duration >= MIN_LONG_FORM_DURATION_SECONDS
    && width >= MIN_PLAYBACK_WIDTH
    && height >= MIN_PLAYBACK_HEIGHT;
}

export function classifyVideoSnapshot({ duration, width, height, readyState }) {
  const largeVisibleSurface = width >= MIN_PLAYBACK_WIDTH && height >= MIN_PLAYBACK_HEIGHT;
  const finiteLongForm = Number.isFinite(duration) && duration >= MIN_LONG_FORM_DURATION_SECONDS;
  if (largeVisibleSurface && finiteLongForm) return "active-long-form";
  if (largeVisibleSurface && !Number.isFinite(duration) && readyState < 2) return "visible-loading";
  if (!largeVisibleSurface && finiteLongForm) return "hidden-stale-long-form";
  return "other";
}

// Scope candidates to the service's own player container when it is present, so a
// detail-page trailer or preview can never be commanded while identity, clock and
// commands all describe the main player. Fall back to the whole page if the
// container is missing or empty (layout changes must not silently disable playback).
function candidateVideos(document, playerScopeSelector) {
  // Prime may have several player containers (an idle one and the one playing).
  const scopes = playerScopeSelector && typeof document.querySelectorAll === "function"
    ? [...document.querySelectorAll(playerScopeSelector)]
    : [];
  const scoped = scopes.flatMap(scope => (scope?.querySelectorAll ? [...scope.querySelectorAll("video")] : []));
  return scoped.length ? scoped : [...document.querySelectorAll("video")];
}

function inspectVideoElements(document, playerScopeSelector = null) {
  return candidateVideos(document, playerScopeSelector)
    .filter(video => video.dataset?.sceneSubstitutionOverlay !== "true")
    .map((video) => {
      const bounds = video.getBoundingClientRect();
      const candidate = {
        video,
        width: Math.max(0, bounds.width),
        height: Math.max(0, bounds.height),
        duration: video.duration,
        readyState: video.readyState
      };
      return {
        ...candidate,
        area: candidate.width * candidate.height,
        classification: classifyVideoSnapshot(candidate)
      };
    });
}

function largestPlausibleVideo(document, playerScopeSelector) {
  return inspectVideoElements(document, playerScopeSelector)
    .filter(({ classification }) => classification === "active-long-form")
    .sort((left, right) => right.area - left.area)[0]?.video ?? null;
}

function normalizedTitle(document, serviceName) {
  const title = document.title?.trim() ?? "";
  return title.replace(new RegExp(`\\s*[-|]\\s*${serviceName}\\s*$`, "i"), "").trim() || null;
}

export function resolveNetflixRouteCandidateId(pathname) {
  return pathname.match(/^\/watch\/(\d+)/)?.[1] ?? null;
}

export function resolvePrimeRouteCandidateId(pathname) {
  const candidates = [
    pathname.match(/\/detail\/([A-Z0-9]+)/i)?.[1],
    pathname.match(/\/dp\/([A-Z0-9]+)/i)?.[1],
    pathname.match(/\/gp\/video\/detail\/([A-Z0-9]+)/i)?.[1]
  ];
  return candidates.find(Boolean)?.toUpperCase() ?? null;
}

export class PassiveServiceAdapter {
  constructor({ document, location, serviceId, serviceName, resolveRouteCandidateId, playerScopeSelector = null, adIndicatorSelector = null }) {
    this.document = document;
    this.playerScopeSelector = playerScopeSelector;
    this.adIndicatorSelector = adIndicatorSelector;
    this.location = location;
    this.serviceId = serviceId;
    this.serviceName = serviceName;
    this.resolveRouteCandidateId = resolveRouteCandidateId;
  }

  // Prime stitches ads into the same media timeline, so after an ad the element
  // time no longer equals programme time and every later trigger would land in
  // the wrong place. Callers stop an armed edit when this reports true.
  adBreakVisible() {
    if (!this.adIndicatorSelector || typeof this.document.querySelectorAll !== "function") return false;
    return [...this.document.querySelectorAll(this.adIndicatorSelector)].some(element =>
      (typeof element.checkVisibility === "function" ? element.checkVisibility() : true)
      && Boolean(element.textContent?.trim()));
  }

  activePlayer() {
    const routeCandidateId = this.resolveRouteCandidateId(this.location.pathname);
    return routeCandidateId ? largestPlausibleVideo(this.document, this.playerScopeSelector) : null;
  }

  // E20 diagnostics are stricter than command selection: loading/hidden media,
  // an unsupported route, or multiple plausible players are unknown, not an
  // assertion that no player exists. Null is an observed absence of native video.
  identityObservationPlayer() {
    const candidates = inspectVideoElements(this.document, this.playerScopeSelector);
    if (!candidates.length) return null;
    if (!this.resolveRouteCandidateId(this.location.pathname)) return undefined;
    const active = candidates.filter(candidate => candidate.classification === 'active-long-form');
    return active.length === 1 ? active[0].video : undefined;
  }

  async probe() {
    const videoCandidates = inspectVideoElements(this.document, this.playerScopeSelector);
    const videoElementCount = videoCandidates.length;
    const playerCandidate = videoCandidates
      .filter(({ classification }) => classification === "active-long-form")
      .sort((left, right) => right.area - left.area)[0]?.video ?? null;
    const visibleLoadingVideoCount = videoCandidates
      .filter(({ classification }) => classification === "visible-loading").length;
    const hiddenStaleLongFormVideoCount = videoCandidates
      .filter(({ classification }) => classification === "hidden-stale-long-form").length;
    const routeCandidateId = this.resolveRouteCandidateId(this.location.pathname);
    const player = routeCandidateId ? playerCandidate : null;
    const runtimeMs = player ? Math.round(player.duration * 1000) : null;
    const primeIdentity = this.serviceId === "prime-video"
      ? buildPrimeDepth0Identity({
          location: {
            pathname: this.location.pathname,
            search: this.location.search ?? ""
          },
          documentTitle: this.document.title,
          runtimeMs,
          serviceName: this.serviceName
        })
      : null;
    const sourceIdentityStatus = primeIdentity?.status
      ?? (routeCandidateId && runtimeMs ? "candidate" : "unknown");
    const sourceIdentityReason = primeIdentity?.reason
      ?? (routeCandidateId && runtimeMs
        ? "route-and-runtime-not-independently-linked-to-active-item"
        : routeCandidateId
          ? "no-active-runtime"
          : "no-route-candidate");
    const playerLifecycleStatus = player
      ? "active"
      : visibleLoadingVideoCount
        ? "loading-visible-player"
        : hiddenStaleLongFormVideoCount
          ? "stale-hidden-player-only"
          : "no-player-candidate";
    return {
      schemaVersion: 4,
      capturedAt: new Date().toISOString(),
      serviceId: this.serviceId,
      integrationDepth: 0,
      pageKind: routeCandidateId ? "watch-or-detail" : "unknown",
      routeCandidateId,
      pageContextCandidateId: primeIdentity?.pageTypeCandidateId ?? null,
      candidateRelation: primeIdentity?.candidateRelation ?? "insufficient",
      activeItemId: null,
      versionTag: null,
      versionEvidenceAvailable: false,
      title: normalizedTitle(this.document, this.serviceName),
      playerFound: Boolean(player),
      videoElementCount,
      plausibleLongFormVideoFound: Boolean(playerCandidate),
      visibleLoadingVideoCount,
      hiddenStaleLongFormVideoCount,
      playerLifecycleStatus,
      runtimeMs,
      currentTimeMs: player ? Math.round(player.currentTime * 1000) : null,
      paused: player?.paused ?? null,
      muted: player?.muted ?? null,
      volume: player?.volume ?? null,
      readyState: player?.readyState ?? null,
      buffering: player ? player.readyState < 3 : null,
      fullscreen: Boolean(this.document.fullscreenElement),
      adBreakVisible: this.adBreakVisible(),
      canonicalClock: "unverified-html-media-element",
      sourceIdentityStatus,
      sourceIdentityReason,
      sourceConfidence: sourceIdentityStatus === "candidate" ? "candidate-only" : "unknown",
      capabilities: {
        observesDomPlayer: Boolean(player),
        observesPrivatePlayer: false,
        issuesPlaybackCommands: false,
        observesNetworkTraffic: false,
        readsCredentialsOrCookies: false,
        readsDrmOrMediaUrls: false
      }
    };
  }
}

export function createPassiveServiceAdapter({ document, location }) {
  if (location.hostname === "www.netflix.com") {
    return new PassiveServiceAdapter({
      document,
      location,
      serviceId: "netflix",
      serviceName: "Netflix",
      resolveRouteCandidateId: resolveNetflixRouteCandidateId
    });
  }

  if (["www.amazon.com", "www.primevideo.com"].includes(location.hostname)) {
    return new PassiveServiceAdapter({
      document,
      location,
      serviceId: "prime-video",
      serviceName: location.hostname === "www.amazon.com" ? "Amazon" : "Prime Video",
      resolveRouteCandidateId: resolvePrimeRouteCandidateId,
      // The same containers the identity reader chooses from (prime-identity-reader.mjs).
      playerScopeSelector: PRIME_PLAYER_CONTAINER_SELECTOR,
      // Ad countdown and "Ad 1 of 2" indicators in the Prime web player SDK.
      adIndicatorSelector: "[id^=\"dv-web-player\"] .atvwebplayersdk-ad-timer-remaining-time, [id^=\"dv-web-player\"] .atvwebplayersdk-adtimeindicator-text"
    });
  }

  return null;
}
import { buildPrimeDepth0Identity } from "./source-identity.mjs";
import { PRIME_PLAYER_CONTAINER_SELECTOR } from "./prime-identity-reader.mjs";
