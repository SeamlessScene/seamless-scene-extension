import assert from "node:assert/strict";
import test from "node:test";
import { OwnershipLedger } from "../src/ownership-ledger.mjs";

test("restores a value only when the ledger still owns the applied value", async () => {
  let muted = false;
  const ledger = new OwnershipLedger();
  await ledger.apply({
    key: "muted",
    read: async () => muted,
    write: async (value) => { muted = value; },
    value: true
  });
  assert.equal(muted, true);
  assert.deepEqual(await ledger.restore(), [{ key: "muted", restored: true }]);
  assert.equal(muted, false);
});

test("preserves an external change made during the owned interval", async () => {
  let visibility = "visible";
  const ledger = new OwnershipLedger();
  await ledger.apply({
    key: "visibility",
    read: async () => visibility,
    write: async (value) => { visibility = value; },
    value: "hidden"
  });
  visibility = "collapse";
  assert.deepEqual(await ledger.restore(), [
    { key: "visibility", restored: false, reason: "value-changed-externally" }
  ]);
  assert.equal(visibility, "collapse");
});
