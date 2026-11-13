import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startAccountPage } from '../catalog-account-page.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { LINK_INTENT_KEY, LINK_INTENT_MAX_MS, noteLinkIntent, takeLinkIntent } from '../src/link-intent.mjs';

// Connecting an account used to take three presses in the extension: open the account page, "Start linking", then a small text
// link to the website. These cover the one-press path: the button asks for a code and opens the website's approval
// page itself, and a press on "Connect your account" elsewhere in the extension carries through to the same result.
// The link protocol is untouched: the same device-link-v1 messages, the same sender, the same approval address.

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const reply = value => ({ ok: true, build: EXECUTING_BUILD, value });
const pendingValue = { state: 'pending', code: 'AAAABBBBCCCC', expiresAt: new Date(1_000_000 + 240_000).toISOString(),
  approvalUrl: 'https://site.example/account/device-links?code=AAAABBBBCCCC' };

function harness({ results = [], linkIntent = false, tabs = true, pairingOrigin = 'https://site.example' } = {}) {
  const nodes = new Map(), opened = [], sent = [];
  const node = id => ({ id: id.replace('#', ''), hidden: false, disabled: false, textContent: '', href: null, children: [],
    listeners: new Map(), addEventListener(kind, fn) { this.listeners.set(kind, fn); }, removeAttribute(name) { this[name] = null; },
    append(...items) { this.children.push(...items); } });
  const lookup = selector => { if (!nodes.has(selector)) nodes.set(selector, node(selector)); return nodes.get(selector); };
  const ids = ['#start', '#finish', '#renew', '#cancel', '#refresh', '#disconnect'];
  const queue = [...results];
  startAccountPage({
    linkIntent,
    catalogTrustConfig: { deviceLinkLifetimeSeconds: 2592000, pairingOrigin },
    document: { querySelector: lookup, createElement: tag => node(tag), querySelectorAll: () => ids.map(lookup),
      visibilityState: 'visible', addEventListener() {} },
    chrome: { runtime: { sendMessage: async message => { sent.push(message.method); return queue.shift() ?? reply({ state: 'unpaired' }); } },
      ...(tabs ? { tabs: { create: async ({ url }) => { opened.push(url); } } } : {}) },
    Date: class extends Date { static now() { return 1_000_000; } static parse(value) { return Date.parse(value); } },
    setTimeout: () => 1, clearTimeout() {},
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { nodes, opened, sent, settle, text: id => lookup(id).textContent,
    press: async id => { lookup(id).listeners.get('click')(); await settle(); } };
}

test('one press asks for a code and opens the website approval page', async () => {
  const h = harness({ results: [reply({ state: 'unpaired' }), reply(pendingValue)] });
  await h.settle();
  assert.deepEqual(h.sent, ['status'], 'opening the page without a connect press only checks the status');
  assert.deepEqual(h.opened, []);
  assert.equal(h.text('#start'), 'Connect your account');
  await h.press('#start');
  assert.deepEqual(h.sent, ['status', 'start']);
  assert.deepEqual(h.opened, [pendingValue.approvalUrl], 'the code travels in the address; nothing to type');
  assert.match(h.text('#status'), /^The website opened in a new tab\. Press Connect extension there\./);
  assert.equal(h.nodes.get('#approve').href, pendingValue.approvalUrl, 'the same address stays on the page as a button');
  assert.equal(h.nodes.get('#start').hidden, true, 'no second start button competes with the website step');
  assert.equal(h.nodes.get('#approval').hidden, false);
  assert.equal(h.text('#code'), 'AAAA-BBBB-CCCC');
});

test('a connect press elsewhere in the extension carries through without a second press', async () => {
  const h = harness({ linkIntent: true, results: [reply({ state: 'unpaired' }), reply(pendingValue)] });
  await h.settle();
  assert.deepEqual(h.sent, ['status', 'start']);
  assert.deepEqual(h.opened, [pendingValue.approvalUrl]);
});

test('a connect press with a code already waiting reopens the website instead of asking for another code', async () => {
  const h = harness({ linkIntent: true, results: [reply(pendingValue)] });
  await h.settle();
  assert.deepEqual(h.sent, ['status']);
  assert.deepEqual(h.opened, [pendingValue.approvalUrl]);
});

test('a connect press never renews, replaces or restarts an existing connection by itself', async () => {
  for (const state of ['paired', 'expired', 'revocation-pending', 'disconnected', 'unconfigured', 'limit', 'retry-start']) {
    const h = harness({ linkIntent: true, results: [reply({ state, displayName: 'Test account', expiresAt: new Date(2_000_000).toISOString() })] });
    await h.settle();
    assert.deepEqual(h.sent, ['status'], state);
    assert.deepEqual(h.opened, [], state);
  }
});

test('only the configured website origin is ever opened', async () => {
  const elsewhere = { ...pendingValue, approvalUrl: 'https://elsewhere.example/account/device-links?code=AAAABBBBCCCC' };
  const h = harness({ results: [reply({ state: 'unpaired' }), reply(elsewhere)] });
  await h.settle(); await h.press('#start');
  assert.deepEqual(h.opened, []);
  assert.match(h.text('#status'), /^Waiting for you to confirm on the website\./, 'the page still offers its own button');
});

test('without the tabs API the page falls back to its website button', async () => {
  const h = harness({ tabs: false, results: [reply({ state: 'unpaired' }), reply(pendingValue)] });
  await h.settle(); await h.press('#start');
  assert.deepEqual(h.opened, []);
  assert.match(h.text('#status'), /^Waiting for you to confirm on the website\./);
  assert.equal(h.nodes.get('#approve').href, pendingValue.approvalUrl);
});

test('renewing opens the website too, and a finished connection says the tab can be closed', async () => {
  const paired = { state: 'paired', displayName: 'Test account', expiresAt: new Date(2_000_000).toISOString() };
  const h = harness({ results: [reply(paired), reply(pendingValue), reply(paired)] });
  await h.settle();
  assert.doesNotMatch(h.text('#status'), /close this tab/, 'managing an existing connection is not a finished flow');
  await h.press('#renew');
  assert.deepEqual(h.opened, [pendingValue.approvalUrl]);
  await h.press('#finish');
  assert.match(h.text('#status'), /^Connected as Test account until .*\. You can close this tab\.$/);
  assert.equal(h.nodes.get('#start').hidden, true);
});

test('the connect note is one-shot and short-lived', () => {
  const store = new Map();
  const storage = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  assert.equal(takeLinkIntent(storage, 5000), false, 'nothing noted');
  assert.equal(noteLinkIntent(storage, 5000), true);
  assert.equal(takeLinkIntent(storage, 6000), true);
  assert.equal(takeLinkIntent(storage, 6001), false, 'taken once');
  noteLinkIntent(storage, 5000);
  assert.equal(takeLinkIntent(storage, 5000 + LINK_INTENT_MAX_MS + 1), false, 'a stale note starts nothing');
  assert.equal(store.has(LINK_INTENT_KEY), false, 'and is cleared all the same');
  noteLinkIntent(storage, 9000);
  assert.equal(takeLinkIntent(storage, 8000), false, 'a note from the future is ignored');
  store.set(LINK_INTENT_KEY, 'soon');
  assert.equal(takeLinkIntent(storage, 8000), false);
  assert.equal(takeLinkIntent(null, 8000), false, 'no storage, no intent');
  assert.equal(noteLinkIntent(null, 8000), false);
});

test('the account page markup leads with one website button and keeps the protocol wiring', async () => {
  const page = await read('catalog-account.html');
  assert.match(page, /<a id="approve" class="button-link primary" target="_blank" rel="noopener noreferrer">Open the website to finish<\/a>/);
  assert.match(page, /<button id="start" class="primary">Connect your account<\/button><button id="finish" hidden>Check now<\/button>/);
  assert.match(page, /Only confirm a connection you started here\./);
  assert.doesNotMatch(page, /Enter this code|Start linking|Open the approval page/);
  assert.match(await read('viewer.css'), /\.account-page a\.button-link\.primary\{background:var\(--ss-accent\)/);
  // The service accepts device-link-v1 only from exactly catalog-account.html, so no opener may decorate the address.
  for (const name of ['viewer.mjs', 'welcome.mjs']) {
    const source = await read(name);
    assert.doesNotMatch(source, /catalog-account\.html[?#]/, name);
    assert.match(source, /noteLinkIntent\(pageStorage\(\)\)/, name);
  }
  assert.match(await read('catalog-account.mjs'), /linkIntent: takeLinkIntent\(pageStorage\(\)\)/);
  const manifest = JSON.parse(await read('manifest.json'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'sidePanel'], 'no new permission');
});
