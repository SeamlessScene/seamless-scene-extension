import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The edit picker frame shares the packet row with Arm/Cancel/Export. Without
// wrapping, flex squeezed the frame and stretched the buttons into tall pills.
test("the edit picker takes its own row and the packet buttons wrap below it", async () => {
  const panel = await readFile(new URL("../src/developer-panel.mjs", import.meta.url), "utf8");
  assert.match(panel, /\[data-packet-controls\] \.actions \{[^}]*flex-wrap: wrap;/);
  assert.match(panel, /\[data-private-picker\] \{[^}]*flex: 1 0 100%;/);
  assert.doesNotMatch(panel, /<div data-private-picker style=/);
});

// Prime exposes the active item, runtime and episode only once its player opens;
// the panel says so instead of showing a column of "unknown".
test("the panel tells the viewer to press Play when no player is open", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /not open yet — press Play, then Refresh/);
});
