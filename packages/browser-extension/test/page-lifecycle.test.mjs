import assert from "node:assert/strict";
import test from "node:test";
import { installPageLifecycleRecovery } from "../src/page-lifecycle.mjs";

function lifecycleEvent(type, persisted) {
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

test("preserves the page session across BFCache freeze and restores it on pageshow", async () => {
  const window = new EventTarget();
  const calls = [];
  installPageLifecycleRecovery({
    window,
    cancel(reason) { calls.push(`cancel:${reason}`); },
    restore() { calls.push("restore"); },
    dispose() { calls.push("dispose"); }
  });

  window.dispatchEvent(lifecycleEvent("pagehide", true));
  window.dispatchEvent(lifecycleEvent("pageshow", true));
  await Promise.resolve();

  assert.deepEqual(calls, ["cancel:pagehide-bfcache", "restore"]);
});

test("permanently disposes a page session only when the document is destroyed", async () => {
  const window = new EventTarget();
  const calls = [];
  installPageLifecycleRecovery({
    window,
    cancel(reason) { calls.push(`cancel:${reason}`); },
    restore() { calls.push("restore"); },
    dispose() { calls.push("dispose"); }
  });

  window.dispatchEvent(lifecycleEvent("pagehide", false));
  window.dispatchEvent(lifecycleEvent("pageshow", true));
  await Promise.resolve();

  assert.deepEqual(calls, ["cancel:pagehide", "dispose"]);
});
