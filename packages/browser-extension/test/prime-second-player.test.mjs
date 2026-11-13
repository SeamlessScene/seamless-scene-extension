import test from "node:test";
import assert from "node:assert/strict";
import { createPassiveServiceAdapter } from "../src/passive-service-adapter.mjs";
import { readReviewedPrimePlayerState } from "../src/prime-identity-reader.mjs";

// Observed on amazon.com 2026-09-24 (a real series episode): Prime keeps an idle
// #dv-web-player (0x0 video, no duration, no titleId) and plays the episode in
// #dv-web-player-2. The extension must follow the container that is playing.
const GTI = "amzn1.dv.gti.d5122377-b6e8-484b-84be-0e7ce7221c09";
const video = (width, height, duration) => ({ duration, currentTime: 987, paused: false, muted: false, volume: 1, readyState: duration ? 4 : 0, dataset: {},
  getBoundingClientRect: () => ({ width, height }) });
const player = (id, v, titleId) => ({ id, _reactRootContainer: { _internalRoot: { current: { memoizedState: { element: { props: { context: {
  webPlayer: { player: { contentConfig: { titleId } }, currentTime: { currentPosition: 987000 } },
  metadataService: { metadata: { catalogMetadataV2: { resourceData: { catalog: { type: "EPISODE", seasonNumber: 1, episodeNumber: 1 } } } } } } } } } } } },
  querySelector: s => (s === "video" ? v : null), querySelectorAll: s => (s === "video" ? [v] : []) });

function page() {
  const hero = video(1177, 663, NaN), idleVideo = video(0, 0, NaN), liveVideo = video(1177, 1133, 2967.368);
  const idle = player("dv-web-player", idleVideo, undefined), live = player("dv-web-player-2", liveVideo, GTI);
  const containers = [idle, live];
  const document = { title: "Watch Example Series Season 1 | Prime Video", fullscreenElement: null,
    querySelector: s => (/dv-web-player/.test(s) ? containers[0] : null),
    querySelectorAll: s => (/dv-web-player/.test(s) && !/atvwebplayersdk/.test(s) ? containers : s === "video" ? [hero, idleVideo, liveVideo] : []) };
  return { document, liveVideo, live };
}

test("the probe finds the episode playing in Prime's second player container", async () => {
  const { document, liveVideo } = page();
  const adapter = createPassiveServiceAdapter({ document, location: { hostname: "www.amazon.com", pathname: "/gp/video/detail/B03E8C3A0E" } });
  assert.equal(adapter.activePlayer(), liveVideo);
  const evidence = await adapter.probe();
  assert.equal(evidence.playerFound, true);
  assert.equal(evidence.runtimeMs, 2967368);
});

test("the identity reader reads the playing container, not the idle one", () => {
  const { document, live } = page();
  const state = readReviewedPrimePlayerState(document);
  assert.equal(state.playerContainer, live);
  assert.equal(state.activeItemId, GTI);
  assert.equal(state.runtimeMs, 2967368);
  assert.equal(state.mediaType, "episode");
});
