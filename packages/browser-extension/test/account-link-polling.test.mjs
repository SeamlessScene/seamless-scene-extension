import test from 'node:test';
import assert from 'node:assert/strict';
import { startAccountPage } from '../catalog-account-page.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { sameExecutingBuild } from '../src/build-identity.mjs';

// The account page completes a device link by itself after the person approves on the website: while
// a code is pending it re-asks the service every four seconds. These cover the polling lifetime --
// that it stops on a settled state, keeps running while the tab is hidden (E55), and never outlives the
// code's expiry -- which is what decides whether an approved link is ever picked up.

function harness({ results = [], lifetimeSeconds = 2592000 } = {}) {
  const timers = new Map();
  let timerId = 0, now = 1_000_000, visibility = 'visible';
  const state = { sent: [], statusText: () => nodes.get('#status').textContent };
  const node = id => ({ id, hidden: false, disabled: false, textContent: '', value: '', children: [],
    listeners: new Map(), addEventListener(kind, fn) { this.listeners.set(kind, fn); },
    append(...items) { this.children.push(...items); } });
  const nodes = new Map();
  const lookup = selector => { if (!nodes.has(selector)) nodes.set(selector, node(selector)); return nodes.get(selector); };
  for (const id of ['#status', '#approval', '#code', '#approve', '#finish', '#cancel', '#lifetime', '#refresh']) lookup(id);
  const documentListeners = new Map();
  const queue = [...results];
  startAccountPage({
    catalogTrustConfig: { deviceLinkLifetimeSeconds: lifetimeSeconds, pairingOrigin: 'https://site.example' },
    document: {
      querySelector: lookup, createElement: tag => node(tag),
      querySelectorAll: () => [lookup('#refresh')],
      get visibilityState() { return visibility; },
      addEventListener: (kind, fn) => documentListeners.set(kind, fn),
    },
    chrome: { runtime: { sendMessage: async message => {
      state.sent.push(message.method);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? { ok: true, build: EXECUTING_BUILD, value: { state: 'linked' } };
    } } },
    Date: class extends Date { static now() { return now; } static parse(value) { return Date.parse(value); } },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, due: now + ms, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { state, nodes, timers, sent: state.sent,
    pending: () => [...timers.values()],
    advance: async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); } await Promise.resolve(); await Promise.resolve(); },
    hide() { visibility = 'hidden'; }, show() { visibility = 'visible'; },
    fireVisibility: () => documentListeners.get('visibilitychange')?.(),
    settle: async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}

const pending = expiresAt => ({ ok: true, build: EXECUTING_BUILD, value: { state: 'pending', code: 'AAAA-BBBB-CCCC', expiresAt } });
const linked = { ok: true, build: EXECUTING_BUILD, value: { state: 'linked' } };
const future = () => new Date(1_000_000 + 600_000).toISOString();

test('a pending code arms a four-second poll that stops once the link settles', async () => {
  const h = harness({ results: [pending(future()), linked] });
  await h.settle();
  assert.deepEqual(h.sent, ['status']);
  assert.equal(h.pending().length, 1, 'a pending code arms exactly one timer');
  assert.equal(h.pending()[0].ms, 4000);
  await h.advance(4000); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish'], 'the poll performs the same exchange as Check now');
  assert.equal(h.pending().length, 0, 'a settled link disarms the poll');
});

test('E55: a hidden tab keeps checking, so a link approved in another tab completes without coming back', async () => {
  // Seen in testing: approved at 16:13:45Z, completed only at 16:16:51Z when the tab came to the front.
  const paired = { ok: true, build: EXECUTING_BUILD, value: { state: 'paired', displayName: 'Test account', expiresAt: future() } };
  const h = harness({ results: [pending(future()), pending(future()), paired] });
  await h.settle();
  h.hide(); // "Open the approval page" opens a new tab in front of this one.
  await h.advance(4000); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish'], 'a hidden tab still asks the service');
  assert.equal(h.pending().length, 1, 'still pending: it re-arms');
  await h.advance(4000); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish', 'finish']);
  assert.equal(h.pending().length, 0, 'paired while hidden: polling stops');
  assert.match(h.state.statusText(), /Connected as Test account/);
});

test('coming back to the tab checks at once and replaces the scheduled check', async () => {
  const h = harness({ results: [pending(future()), linked, linked] });
  await h.settle();
  h.hide(); h.show(); h.fireVisibility(); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish'], 'returning checks immediately');
  await h.advance(4000); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish'], 'the old timer cannot send a second request');
});

test('polling never outlives the code expiry', async () => {
  const h = harness({ results: [pending(new Date(1_000_000 + 2000).toISOString()), linked] });
  await h.settle();
  assert.equal(h.pending().length, 1);
  await h.advance(4000); await h.settle();
  // The timer fired past the expiry, so nothing re-arms behind it.
  assert.equal(h.pending().length, 0, 'an expired code leaves no timer running');
});

test('an expired code never arms a poll at all', async () => {
  const h = harness({ results: [pending(new Date(900_000).toISOString())] });
  await h.settle();
  assert.equal(h.pending().length, 0);
  assert.deepEqual(h.sent, ['status']);
});

test('returning while the link check is in flight does not submit a second exchange',async()=>{
 let finish;
 const h=harness({results:[pending(future()),new Promise(resolve=>{finish=resolve;})]});await h.settle();
 h.hide();h.show();h.fireVisibility();await h.settle();
 h.fireVisibility();await h.settle();assert.deepEqual(h.sent,['status','finish']);
 finish({ok:true,build:EXECUTING_BUILD,value:{state:'paired',displayName:'Test account',expiresAt:future()}});await h.settle();
 assert.equal(h.pending().length,0);assert.match(h.state.statusText(),/Connected as Test account/);
});

test('at the five-device limit the page says so, links to device management and keeps finishing', async () => {
  const limit = { ok: true, build: EXECUTING_BUILD, value: { state: 'limit' } };
  const h = harness({ results: [limit, limit, linked] });
  await h.settle();
  assert.match(h.state.statusText(), /5 connected devices/);
  const manage = h.nodes.get('#status').children[0];
  assert.equal(manage.href, 'https://site.example/account/device-links');
  assert.equal(h.nodes.get('#finish').hidden, false, 'Finish stays available');
  assert.equal(h.pending().length, 1, 'it keeps checking quietly');
  await h.advance(4000); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish']);
  assert.equal(h.pending().length, 1, 'still at the limit: it re-arms');
  await h.advance(4000); await h.settle();
  assert.deepEqual(h.sent, ['status', 'finish', 'finish']);
  assert.equal(h.pending().length, 0, 'linked: polling stops');
});

test('E95: the approval section says how long the code has left, whatever lifetime the website chose', async () => {
  for (const [ms, text] of [[300_000, 'The code expires in 5 minutes.'], [1_800_000, 'The code expires in 30 minutes.'], [60_000, 'The code expires in 1 minute.'], [20_000, 'The code expires in less than a minute.']]) {
    const h = harness({ results: [pending(new Date(1_000_000 + ms).toISOString())] });
    await h.settle();
    assert.equal(h.nodes.get('#code-expiry').textContent, text);
  }
});
