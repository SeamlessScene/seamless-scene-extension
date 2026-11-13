import test from 'node:test';
import assert from 'node:assert/strict';
import { pausableDeadline } from '../src/pausable-deadline.mjs';

const clock = t => { t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); return () => Date.now(); };

test('pausing suspends the deadline; it expires after the remaining running time', t => {
  const now = clock(t); let fired = 0;
  const d = pausableDeadline(1000, () => { fired++; }, { now, budgetMs: 60_000 });
  t.mock.timers.tick(600); d.pause(); t.mock.timers.tick(30_000); assert.equal(fired, 0);
  d.resume(); t.mock.timers.tick(399); assert.equal(fired, 0); t.mock.timers.tick(1); assert.equal(fired, 1);
});

test('the pause budget is shared and bounded, and seek-back extensions draw on it', t => {
  const now = clock(t); let fired = 0;
  const d = pausableDeadline(1000, () => { fired++; }, { now, budgetMs: 5000 });
  d.extend(3000); t.mock.timers.tick(3999); assert.equal(fired, 0);
  d.pause(); t.mock.timers.tick(1999); assert.equal(fired, 0); t.mock.timers.tick(1); assert.equal(fired, 1, 'a pause past the remaining budget expires');
  d.resume(); d.extend(5000); t.mock.timers.tick(60_000); assert.equal(fired, 1, 'expires once');
});

test('clear stops it', t => {
  clock(t); let fired = 0; const d = pausableDeadline(10, () => { fired++; }, { now: () => Date.now() });
  d.clear(); t.mock.timers.tick(100); assert.equal(fired, 0);
});
