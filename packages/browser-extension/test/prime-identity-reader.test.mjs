import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeIdentitySnapshot } from "../src/identity-bridge-protocol.mjs";
import {
  createPrimeIdentitySnapshotReader,
  readReviewedPrimePlayerState
} from "../src/prime-identity-reader.mjs";

function playerContext({
  titleId = "B04A826A41",
  type = "EPISODE",
  entityType = "TV_EPISODE",
  seasonNumber = 1,
  episodeNumber = 2,
  currentPosition = 1_234_567,
  contentRelativeTimeMs,
  methodCurrentPosition,
  getTimeData,
  title = "Must not cross",
  seriesTitle = "Must not cross either"
} = {}) {
  const timeDataManager = {
    getTimeData: getTimeData ?? (() => ({ currentPosition: methodCurrentPosition }))
  };
  return {
    webPlayer: {
      player: {
        contentConfig: { titleId },
        playlistPlaybackController: { timeDataManager }
      },
      currentTime: { currentPosition, contentRelativeTimeMs }
    },
    metadataService: {
      metadata: {
        catalogMetadataV2: {
          resourceData: {
            catalog: { type, entityType, seasonNumber, episodeNumber, title, seriesTitle }
          }
        }
      }
    }
  };
}

function container({ context = playerContext(), video = { duration: 2700 } } = {}) {
  return {
    _reactRootContainer: {
      _internalRoot: {
        current: {
          memoizedState: {
            element: { props: { context } }
          }
        }
      }
    },
    querySelector(selector) {
      assert.equal(selector, "video");
      return video;
    }
  };
}

function documentWith(getContainer) {
  return {
    querySelector(selector) {
      assert.equal(selector, "div#dv-web-player");
      return getContainer();
    }
  };
}

test("reads only the reviewed Prime player path and emits a strict bounded snapshot", () => {
  const playerContainer = container();
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => playerContainer)
  });

  const snapshot = sanitizeIdentitySnapshot(reader.readSnapshot());
  assert.equal(snapshot.serviceId, "prime-video");
  assert.equal(snapshot.activeItemId, "B04A826A41");
  assert.equal(snapshot.mediaType, "episode");
  assert.equal(snapshot.season, 1);
  assert.equal(snapshot.episode, 2);
  assert.equal(snapshot.runtimeMs, 2_700_000);
  assert.equal(snapshot.canonicalTimeMs, 1_234_567);
  assert.equal(snapshot.versionTag, null);
  assert.equal(snapshot.territory, null);
  assert.equal(snapshot.plan, null);
  assert.equal("title" in snapshot, false);
  assert.equal("seriesTitle" in snapshot, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /Must not cross/);
});

test("returns unknown fields when the exact reviewed root is missing or malformed", () => {
  const missing = readReviewedPrimePlayerState(documentWith(() => null));
  assert.deepEqual(missing, {
    playerContainer: null,
    playerVideo: null,
    activeItemId: null,
    mediaType: "unknown",
    season: null,
    episode: null,
    canonicalTimeMs: null,
    canonicalTimeProvenance: "not-available",
    runtimeMs: null
  });

  const throwing = {};
  Object.defineProperty(throwing, "_reactRootContainer", {
    get() { throw new Error("page getter must remain bounded"); }
  });
  const malformed = readReviewedPrimePlayerState(documentWith(() => throwing));
  assert.equal(malformed.activeItemId, null);
  assert.equal(malformed.mediaType, "unknown");
  assert.equal(malformed.runtimeMs, null);
});

test("rejects malformed IDs and incomplete episode coordinates without guessing", () => {
  const state = readReviewedPrimePlayerState(documentWith(() => container({
    context: playerContext({ titleId: "not an asin", episodeNumber: null })
  })));
  assert.equal(state.activeItemId, null);
  assert.equal(state.mediaType, "unknown");
  assert.equal(state.season, null);
  assert.equal(state.episode, null);
});

test("accepts only bounded Prime ASIN and internal GTI active-item forms", () => {
  const gti = "amzn1.dv.gti.67ef7dcf-ccb6-49ea-879c-7bca3db2790e";
  const state = readReviewedPrimePlayerState(documentWith(() => container({
    context: playerContext({ titleId: gti })
  })));
  assert.equal(state.activeItemId, gti);

  const oversized = `${gti}${"x".repeat(120)}`;
  const rejected = readReviewedPrimePlayerState(documentWith(() => container({
    context: playerContext({ titleId: oversized })
  })));
  assert.equal(rejected.activeItemId, null);
});

test("increments lifecycle generation only for reviewed player, video, or item changes", () => {
  const videoOne = { duration: 2700 };
  const contextOne = playerContext();
  const containerOne = container({ context: contextOne, video: videoOne });
  let currentContainer = containerOne;
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => currentContainer)
  });

  assert.equal(reader.readSnapshot().lifecycleGeneration, 1);
  videoOne.duration = 2701;
  assert.equal(reader.readSnapshot().lifecycleGeneration, 1, "metadata changes are not player lifecycle changes");

  currentContainer = container({ context: contextOne, video: { duration: 2701 } });
  assert.equal(reader.readSnapshot().lifecycleGeneration, 2, "a player/video replacement advances generation");

  const contextTwo = playerContext({ titleId: "B07760460C", episodeNumber: 3 });
  currentContainer = container({ context: contextTwo, video: currentContainer.querySelector("video") });
  assert.equal(reader.readSnapshot().lifecycleGeneration, 3, "an active item change advances generation");
  assert.equal(reader.readSnapshot().lifecycleGeneration, 3, "stable reads do not advance generation");
});

test("reads only the reviewed bounded currentPosition scalar as the clock candidate", () => {
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container())
  });
  const snapshot = reader.readSnapshot();
  assert.equal(snapshot.canonicalTimeMs, 1_234_567);
  assert.equal(snapshot.provenance.canonicalTimeMs, "provider-current-position");
  assert.equal(snapshot.versionTag, null);
  assert.equal(snapshot.territory, null);
  assert.equal(snapshot.plan, null);
  assert.equal(snapshot.provenance.versionTag, "not-available");
});

test("uses only the reviewed content-relative scalar when currentPosition is unavailable", () => {
  const fallbackOnlyContext = playerContext({ currentPosition: Number.NaN, contentRelativeTimeMs: 123_456 });
  const fallbackOnly = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container({ context: fallbackOnlyContext }))
  });
  const snapshot = fallbackOnly.readSnapshot();
  assert.equal(snapshot.canonicalTimeMs, 123_456);
  assert.equal(snapshot.provenance.canonicalTimeMs, "provider-content-relative-time");

  const preferred = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container({
      context: playerContext({ currentPosition: 222_222, contentRelativeTimeMs: 123_456 })
    }))
  });
  assert.equal(preferred.readSnapshot().canonicalTimeMs, 222_222);
  assert.equal(preferred.readSnapshot().provenance.canonicalTimeMs, "provider-current-position");
});

test("rejects invalid or out-of-runtime provider clock values without masking anomalies", () => {
  for (const currentPosition of [-1, 90_000_000, 2_800_000]) {
    const reader = createPrimeIdentitySnapshotReader({
      document: documentWith(() => container({
        context: playerContext({ currentPosition, contentRelativeTimeMs: 123_456 }),
        video: { duration: 2700 }
      }))
    });
    assert.equal(reader.readSnapshot().canonicalTimeMs, null);
  }

  for (const contentRelativeTimeMs of [-1, 90_000_000, 2_800_000]) {
    const reader = createPrimeIdentitySnapshotReader({
      document: documentWith(() => container({
        context: playerContext({ currentPosition: Number.NaN, contentRelativeTimeMs }),
        video: { duration: 2700 }
      }))
    });
    assert.equal(reader.readSnapshot().canonicalTimeMs, null);
  }
});

test("uses only the reviewed time-data method when both shallow scalars are unavailable", () => {
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container({
      context: playerContext({
        currentPosition: Number.NaN,
        contentRelativeTimeMs: Number.NaN,
        methodCurrentPosition: 345_678
      })
    }))
  });
  const snapshot = reader.readSnapshot();
  assert.equal(snapshot.canonicalTimeMs, 345_678);
  assert.equal(snapshot.provenance.canonicalTimeMs, "provider-time-data-method");
});

test("does not invoke the deeper time-data method when a shallow scalar is finite", () => {
  let methodCalls = 0;
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container({
      context: playerContext({
        currentPosition: 222_222,
        contentRelativeTimeMs: 123_456,
        getTimeData() {
          methodCalls += 1;
          return { currentPosition: 345_678 };
        }
      })
    }))
  });
  assert.equal(reader.readSnapshot().canonicalTimeMs, 222_222);
  assert.equal(methodCalls, 0);
});

test("does not invoke the deeper time-data method during lifecycle-only polling", () => {
  let methodCalls = 0;
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container({
      context: playerContext({
        currentPosition: Number.NaN,
        contentRelativeTimeMs: Number.NaN,
        getTimeData() {
          methodCalls += 1;
          return { currentPosition: 345_678 };
        }
      })
    }))
  });
  const snapshot = reader.readSnapshot({ includeCanonicalClock: false });
  assert.equal(snapshot.canonicalTimeMs, null);
  assert.equal(methodCalls, 0);
});

test("contains time-data method failures without discarding bounded identity", () => {
  const reader = createPrimeIdentitySnapshotReader({
    document: documentWith(() => container({
      context: playerContext({
        currentPosition: Number.NaN,
        contentRelativeTimeMs: Number.NaN,
        getTimeData() { throw new Error("provider method failed"); }
      })
    }))
  });
  const snapshot = reader.readSnapshot();
  assert.equal(snapshot.activeItemId, "B04A826A41");
  assert.equal(snapshot.canonicalTimeMs, null);
  assert.equal(snapshot.provenance.canonicalTimeMs, "not-available");
});

test("reads the same player context through a React 18 createRoot container", () => {
  const legacy = container();
  const modern = { querySelector: legacy.querySelector, ["__reactContainer$abc123"]: legacy._reactRootContainer._internalRoot.current };
  const state = readReviewedPrimePlayerState(documentWith(() => modern));
  assert.equal(state.activeItemId, "B04A826A41");
  assert.equal(state.mediaType, "episode");
  assert.equal(readReviewedPrimePlayerState(documentWith(() => ({ querySelector: legacy.querySelector }))).activeItemId, null);
});
