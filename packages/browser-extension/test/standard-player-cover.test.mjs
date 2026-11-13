import assert from "node:assert/strict";
import test from "node:test";
import { rectCoverageRatio } from "../src/standard-player-cover.mjs";

test("computes full and partial player-cover geometry", () => {
  const player = { left: 100, top: 50, right: 900, bottom: 500, width: 800, height: 450 };
  assert.equal(rectCoverageRatio(player, player), 1);
  assert.equal(rectCoverageRatio(
    { left: 100, top: 50, right: 500, bottom: 500, width: 400, height: 450 },
    player
  ), 0.5);
  assert.equal(rectCoverageRatio(
    { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 },
    player
  ), 0);
});
