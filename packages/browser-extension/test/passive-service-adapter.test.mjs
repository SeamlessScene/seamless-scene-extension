import assert from "node:assert/strict";
import test from "node:test";
import {
  createPassiveServiceAdapter,
  classifyVideoSnapshot,
  isPlausibleLongFormVideo,
  resolveNetflixRouteCandidateId,
  resolvePrimeRouteCandidateId
} from "../src/passive-service-adapter.mjs";

test("extracts a Netflix route candidate without retaining the full URL", () => {
  assert.equal(resolveNetflixRouteCandidateId("/watch/81234567?trackId=ignored"), "81234567");
  assert.equal(resolveNetflixRouteCandidateId("/browse"), null);
});

test("extracts common Prime Video route candidates", () => {
  assert.equal(resolvePrimeRouteCandidateId("/detail/B0EDD2B71A/ref=atv_dp"), "B0EDD2B71A");
  assert.equal(resolvePrimeRouteCandidateId("/dp/b02bdf4389"), "B02BDF4389");
  assert.equal(resolvePrimeRouteCandidateId("/gp/video/detail/B0D97636BF"), "B0D97636BF");
  assert.equal(resolvePrimeRouteCandidateId("/storefront/home"), null);
});

test("selects only an explicitly supported passive service", () => {
  const document = {};
  assert.equal(
    createPassiveServiceAdapter({ document, location: { hostname: "example.com" } }),
    null
  );
  assert.equal(
    createPassiveServiceAdapter({ document, location: { hostname: "www.netflix.com" } }).serviceId,
    "netflix"
  );
  assert.equal(
    createPassiveServiceAdapter({ document, location: { hostname: "www.primevideo.com" } }).serviceId,
    "prime-video"
  );
});

test("rejects short or undersized promotional videos as long-form playback", () => {
  assert.equal(isPlausibleLongFormVideo({ duration: 30, width: 1920, height: 1080 }), false);
  assert.equal(isPlausibleLongFormVideo({ duration: 3600, width: 240, height: 135 }), false);
  assert.equal(isPlausibleLongFormVideo({ duration: Number.NaN, width: 1920, height: 1080 }), false);
  assert.equal(isPlausibleLongFormVideo({ duration: 3600, width: 1280, height: 720 }), true);
});

test("does not classify a storefront video as an active player without a content route", async () => {
  const video = {
    duration: 3600,
    currentTime: 0,
    paused: true,
    muted: true,
    volume: 0,
    readyState: 4,
    getBoundingClientRect: () => ({ width: 1280, height: 720 })
  };
  const document = {
    title: "Prime Video",
    fullscreenElement: null,
    querySelectorAll: () => [video]
  };
  const adapter = createPassiveServiceAdapter({
    document,
    location: { hostname: "www.amazon.com", pathname: "/gp/video/storefront" }
  });

  const evidence = await adapter.probe();
  assert.equal(evidence.videoElementCount, 1);
  assert.equal(evidence.plausibleLongFormVideoFound, true);
  assert.equal(evidence.playerFound, false);
  assert.equal(evidence.runtimeMs, null);
  assert.equal(evidence.routeCandidateId, null);
  assert.equal(evidence.activeItemId, null);
});

test("distinguishes active, loading, and hidden stale player candidates", () => {
  assert.equal(classifyVideoSnapshot({ duration: 3000, width: 1280, height: 720, readyState: 4 }), "active-long-form");
  assert.equal(classifyVideoSnapshot({ duration: Number.NaN, width: 1280, height: 720, readyState: 0 }), "visible-loading");
  assert.equal(classifyVideoSnapshot({ duration: 3000, width: 0, height: 0, readyState: 4 }), "hidden-stale-long-form");
  assert.equal(classifyVideoSnapshot({ duration: 30, width: 1280, height: 720, readyState: 4 }), "other");
});

test('identity diagnostic distinguishes observed absence from loading, hidden and multiple native players',()=>{
  const video=(duration=3600,width=960)=>({duration,readyState:4,dataset:{},getBoundingClientRect:()=>({width,height:width*9/16})});
  let videos=[];
  const document={querySelectorAll:selector=>selector==='video'?videos:[]};
  const location={hostname:'www.amazon.com',pathname:'/gp/video/detail/B04A826A41'};
  const adapter=createPassiveServiceAdapter({document,location});
  assert.equal(adapter.identityObservationPlayer(),null);
  const main=video();videos=[main];assert.equal(adapter.identityObservationPlayer(),main);
  videos=[video(NaN)];assert.equal(adapter.identityObservationPlayer(),undefined);
  videos=[video(3600,0)];assert.equal(adapter.identityObservationPlayer(),undefined);
  videos=[main,video()];assert.equal(adapter.identityObservationPlayer(),undefined);
  videos=[main];location.pathname='/gp/video/storefront';assert.equal(adapter.identityObservationPlayer(),undefined);
  assert.equal(adapter.activePlayer(),null,'ordinary command selection keeps its contract');
});

test("Prime commands the video inside the web player, not a larger trailer elsewhere on the page", () => {
  const video = (width, duration = 3_600) => ({ duration, readyState: 4, dataset: {}, getBoundingClientRect: () => ({ width, height: width * 9 / 16 }) });
  const main = video(960), trailer = video(1280, 120);
  const player = { querySelectorAll: () => [main] };
  let scoped = true;
  const document = {
    querySelectorAll: selector => (selector.includes("dv-web-player") ? (scoped ? [player] : []) : [trailer, main])
  };
  const adapter = createPassiveServiceAdapter({ document, location: { hostname: "www.amazon.com", pathname: "/gp/video/detail/B04A826A41" } });
  assert.equal(adapter.activePlayer(), main);
  // Without the container (a layout change) the page-wide rule still finds a player.
  scoped = false;
  assert.equal(adapter.activePlayer(), trailer);
});

test("Prime reports a visible ad countdown so an armed edit can stop instead of cutting on a shifted clock", () => {
  let indicators = [];
  const document = { querySelector: () => null, querySelectorAll: selector => (selector.includes("atvwebplayersdk-ad") ? indicators : []) };
  const adapter = createPassiveServiceAdapter({ document, location: { hostname: "www.primevideo.com", pathname: "/detail/B04A826A41" } });
  assert.equal(adapter.adBreakVisible(), false);
  indicators = [{ textContent: "", checkVisibility: () => true }, { textContent: "0:25", checkVisibility: () => false }];
  assert.equal(adapter.adBreakVisible(), false);
  indicators = [{ textContent: "Ad 1 of 2 · 0:25", checkVisibility: () => true }];
  assert.equal(adapter.adBreakVisible(), true);
  const netflix = createPassiveServiceAdapter({ document, location: { hostname: "www.netflix.com", pathname: "/watch/1" } });
  assert.equal(netflix.adBreakVisible(), false);
});
