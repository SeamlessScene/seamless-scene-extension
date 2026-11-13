import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForWatchIntent } from '../src/watch-intent-wait.mjs';

// Field testing 2026-09-24: the website opens the title tab inside the click and
// only then sends the watch message, so the title page's first pending-watch
// question can come before the intent exists. One "no" must not mean "never".
const noSleep = () => Promise.resolve();

test('a watch intent recorded just after the title page asks still starts the page', async () => {
  let asked = 0;
  const request = async () => ({ pending: ++asked >= 3 });
  assert.equal(await waitForWatchIntent(request, { sleep: noSleep }), true);
  assert.equal(asked, 3);
});

test('with no intent the page stops asking after a bounded window and keeps waiting for the player', async () => {
  let asked = 0;
  const request = async () => { asked += 1; return { pending: false }; };
  assert.equal(await waitForWatchIntent(request, { sleep: noSleep, attempts: 5 }), false);
  assert.equal(asked, 5);
});

test('a failing service is treated as no intent, not as a crash', async () => {
  const request = async () => { throw Error('viewer-sender-denied'); };
  assert.equal(await waitForWatchIntent(request, { sleep: noSleep, attempts: 2 }), false);
});
