import { assertActive } from "./operation-context.mjs";

export class OwnershipLedger {
  constructor() {
    this.entries = [];
  }

  async apply({ key, read, write, value, signal, assertCurrent = () => {} }) {
    assertActive(signal);
    assertCurrent();
    if (!this.entries.some((entry) => entry.key === key)) {
      const before = await read();
      assertActive(signal); assertCurrent();
      if (!this.entries.some((entry) => entry.key === key)) this.entries.push({ key, read, write, before, applied: value });
    }
    assertActive(signal);
    assertCurrent();
    await write(value, { restoring: false, signal });
  }

  async restore({ signal, assertCurrent = () => {} } = {}) {
    const outcomes = [];
    for (const entry of [...this.entries].reverse()) {
      assertActive(signal);
      assertCurrent();
      if (!this.entries.includes(entry)) continue;
      const current = await entry.read();
      assertActive(signal);
      assertCurrent();
      if (!this.entries.includes(entry)) continue;
      if (Object.is(current, entry.applied)) {
        await entry.write(entry.before, { restoring: true, signal });
        assertActive(signal); assertCurrent();
        outcomes.push({ key: entry.key, restored: true });
      } else {
        outcomes.push({ key: entry.key, restored: false, reason: "value-changed-externally" });
      }
      // Do not erase entries added while an asynchronous restore was pending.
      this.entries = this.entries.filter(candidate => candidate !== entry);
    }
    return outcomes;
  }
}
