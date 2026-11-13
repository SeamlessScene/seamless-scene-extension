import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

test('settings player selection survives polling and delayed responses', async t => {
  const saved = Object.fromEntries(
    ['document', 'chrome', 'setInterval', 'clearInterval', 'addEventListener'].map(k => [
      k,
      globalThis[k]
    ])
  );
  let interval,
    nextSnapshot = null,
    targets = [11, 22];
  const requests = [];
  const element = () => ({
    children: [],
    dataset: {},
    style: {},
    value: '',
    textContent: '',
    append(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
      this.value = '';
    },
    addEventListener() {}
  });
  const nodes = new Map(
    ['#target-tab', '#now', '#creator', '#player', '#notice'].map(id => [id, element()])
  );
  const select = nodes.get('#target-tab');
  const snapshot = id => ({
    target: id,
    targets: [...targets],
    preferences: { theme: 'system', mode: 'viewer' },
    playback: { state: 'idle', title: `Player ${id}` },
    matches: [],
    library: [],
    downloads: []
  });
  globalThis.document = {
    querySelector: id => nodes.get(id) ?? null,
    querySelectorAll: () => [],
    createElement: element,
    documentElement: { style: {} }
  };
  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 11 }],
      get: async id => ({ url: 'https://www.amazon.com/gp/video/detail/test', title: id === 22 ? 'Watch Orbit Station | Prime Video' : `Watch Show ${id} | Prime Video` })
    },
    runtime: {
      async sendMessage(message) {
        requests.push(message);
        const value = nextSnapshot ? await nextSnapshot(message) : snapshot(message.args.tabId);
        return { ok: true, build: EXECUTING_BUILD, value };
      }
    }
  };
  globalThis.setInterval = fn => {
    interval = fn;
    return 1;
  };
  globalThis.clearInterval = () => {};
  globalThis.addEventListener = () => {};
  try {
    await import('../viewer.mjs?target-selection-regression');
    await settle();
    await t.test('idle refresh keeps option nodes and an uncommitted menu choice', async () => {
      const firstOption = select.children[0];
      select.value = '22'; // Native select highlight before its change event.
      await interval();
      assert.equal(select.children[0], firstOption);
      assert.equal(select.value, '22');
    });
    await t.test('committed selection becomes the subsequent request target', async () => {
      select.value = '22';
      select.onchange();
      await settle();
      assert.equal(requests.at(-1).args.tabId, 22);
      assert.equal(select.value, '22');
      assert.equal(select.children.find(x => x.value === '22').textContent, 'Orbit Station', 'players are listed by title, not tab number');
    });
    await t.test('old in-flight snapshot cannot undo a newer selection', async () => {
      let release;
      nextSnapshot = () =>
        new Promise(resolve => {
          release = resolve;
        });
      const oldRefresh = interval();
      await settle();
      select.value = '11';
      select.onchange();
      nextSnapshot = null;
      release(snapshot(22));
      await oldRefresh;
      await settle();
      assert.equal(requests.at(-1).args.tabId, 11);
      assert.equal(select.value, '11');
    });
    await t.test('connected-player inventory changes still appear', async () => {
      targets = [11, 33];
      await interval();
      assert.deepEqual(
        select.children.map(x => x.value),
        ['11', '33']
      );
      assert.equal(select.value, '11');
    });
    await t.test(
      'an old failure cannot replace newer selection feedback; rapid choices coalesce',
      async () => {
        targets = [11, 22, 33];
        await interval();
        let reject;
        nextSnapshot = () =>
          new Promise((resolve, fail) => {
            reject = fail;
          });
        const oldRefresh = interval();
        await settle();
        select.value = '22';
        select.onchange();
        select.value = '33';
        select.onchange();
        nodes.get('#notice').textContent = 'Current feedback';
        nextSnapshot = null;
        const before = requests.length;
        reject(Error('old player went away'));
        await oldRefresh;
        await settle();
        assert.equal(requests.length, before + 1);
        assert.equal(requests.at(-1).args.tabId, 33);
        assert.equal(select.value, '33');
        assert.equal(nodes.get('#notice').textContent, 'Current feedback');
      }
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
