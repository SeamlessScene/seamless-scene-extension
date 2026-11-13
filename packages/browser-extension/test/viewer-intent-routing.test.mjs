import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerService } from '../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

const releaseId = '11111111-1111-4111-8111-111111111111';
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
};
const deferred = () => {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
};
const event = () => ({
  listeners: [],
  addListener(fn) {
    this.listeners.push(fn);
  },
  emit(v) {
    for (const fn of this.listeners) fn(v);
  }
});

async function harness({ loadGate, failLoad = false } = {}) {
  const id = 'a'.repeat(32),
    origin = `chrome-extension://${id}`;
  const runtime = { id, getURL: p => `${origin}/${p}`, onConnect: event(), onMessage: event() };
  const calls = [],
    opened = [],
    players = [],
    ports = [],
    readGates = new Map();
  let intents = [];
  const data = {
    preferences: { autoArm: false },
    selections: {},
    library: [
      {
        id: releaseId,
        title: 'Kept edit',
        sourceKey: 'same-source',
        origin: 'website',
        transport: 'protected',
        availability: 'downloaded',
        streamingUrl: 'https://www.amazon.com/gp/video/detail/test-title'
      }
    ]
  };
  const store = {
    read: async () => structuredClone(data),
    remember: async () => {},
    intents: async () => structuredClone(intents),
    addIntent: async releaseId => {
      intents = [{ releaseId, attemptId: crypto.randomUUID() }];
    },
    consumeIntent: async (id, attempt) => {
      intents = intents.filter(x => x.releaseId !== id || x.attemptId !== attempt);
    }
  };
  const service = registerViewerService(
    runtime,
    {},
    {
      store,
      deviceJournal: {},
      authorizeRenderer: () => true,
      tabs: {
        update: async () => {},
        create: async args => {
          opened.push(args);
          return { id: 90 };
        }
      }
    }
  );
  for (const tabId of [1, 2]) {
    const player = { state: 'idle', sourceKey: 'same-source', generation: '1', canStop: false };
    players.push(player);
    for (const name of ['viewer-controller-v1', 'viewer-renderer-v1']) {
      const port = {
        name,
        sender: {
          id,
          origin: 'https://www.amazon.com',
          url: 'https://www.amazon.com/gp/video/detail/test-title',
          tab: { id: tabId, url: 'https://www.amazon.com/gp/video/detail/test-title' },
          frameId: 0,
          documentId: `${tabId}`.repeat(32),
          documentLifecycle: 'active'
        },
        onMessage: event(),
        onDisconnect: event(),
        disconnect() {
          this.onDisconnect.emit();
        },
        postMessage(m) {
          if (!m.id) return;
          calls.push({ tabId, ...m });
          queueMicrotask(async () => {
            try {
              if (name === 'viewer-controller-v1' && m.method === 'read')
                await readGates.get(tabId)?.promise;
              if (m.method === 'load') {
                await loadGate?.promise;
                if (failLoad) throw Error('viewer-owner-busy');
                Object.assign(player, {
                  state: 'loaded',
                  editId: releaseId,
                  canArm: true,
                  canStop: true
                });
              }
              if (m.method === 'arm') Object.assign(player, { state: 'armed', canArm: false });
              port.onMessage.emit({
                id: m.id,
                ok: true,
                value:
                  m.method === 'connection-report'
                    ? { schema: 1, state: 'connected', dropped: 0, events: [] }
                    : { ...player },
                build: EXECUTING_BUILD
              });
            } catch (error) {
              port.onMessage.emit({
                id: m.id,
                ok: false,
                code: error.message,
                build: EXECUTING_BUILD
              });
            }
          });
        }
      };
      ports.push(port);
      runtime.onConnect.emit(port);
      port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
    }
  }
  await flush();
  return {
    service,
    calls,
    opened,
    players,
    progress: state => ports.find(p => p.name === 'viewer-renderer-v1').onMessage.emit({
      progress: { releaseId, state, bytes: 12, total: 24 }, build: EXECUTING_BUILD
    }),
    data,
    store,
    readGates,
    call: (method, args, { tabId = 90, page = 'viewer-settings.html', top = false } = {}) =>
      new Promise(resolve =>
        runtime.onMessage.listeners[0](
          { kind: 'viewer-v1', method, args, build: EXECUTING_BUILD },
          top
            ? ports.find(p => p.name === 'viewer-controller-v1' && p.sender.tab.id === tabId).sender
            : { id, origin, url: `${origin}/${page}`, tab: { id: tabId }, frameId: 0 },
          resolve
        )
      ),
    request: args =>
      new Promise(resolve =>
        runtime.onMessage.listeners[0](
          { kind: 'viewer-v1', method: 'watch-intent', args, build: EXECUTING_BUILD },
          { id, origin, url: `${origin}/viewer-settings.html` },
          resolve
        )
      ),
    close() {
      loadGate?.resolve();
      for (const port of ports) port.disconnect();
    }
  };
}

test('bound Settings uses its original player by default but honors an explicit connected selection', async () => {
  const h = await harness();
  try {
    h.players[0].state = 'armed';
    const opened = await h.call('open-settings', { tabId: 2 }, { tabId: 1, top: true });
    assert.equal(opened.ok, true);
    const initial = await h.call('snapshot', { tabId: 90 });
    assert.equal(
      initial.value.target,
      1,
      'the opening page remains the default, ignoring a page-supplied target'
    );
    assert.equal(initial.value.playback.state, 'armed');
    const selected = await h.call('snapshot', { tabId: 2 });
    assert.equal(
      selected.value.target,
      2,
      'explicit selection must override the initial Settings binding'
    );
    assert.equal(selected.value.playback.state, 'idle');
    assert.equal((await h.call('connection-report', { tabId: 2 })).ok, true);
    assert.equal(h.calls.filter(c => c.method === 'connection-report').at(-1).tabId, 2);
    assert.equal(
      (await h.call('command', { tabId: 2, command: 'stop', generation: '1' })).ok,
      true
    );
    assert.equal(h.calls.filter(c => c.method === 'stop').at(-1).tabId, 2);
    assert.equal((await h.call('snapshot', { tabId: 1 })).value.target, 1);
  } finally {
    h.close();
    await flush();
  }
});

test('a streaming page cannot select another player or export its diagnostics', async () => {
  const h = await harness();
  try {
    h.players[0].state = 'armed';
    const snapshot = await h.call('snapshot', { tabId: 2 }, { tabId: 1, top: true });
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.value.playback.state, 'armed');
    const result = await h.call(
      'command',
      { tabId: 2, command: 'stop', generation: '1' },
      { tabId: 1, top: true }
    );
    assert.equal(result.ok, true);
    assert.equal(h.calls.filter(c => c.method === 'stop').at(-1).tabId, 1);
    const diagnostic = await h.call('connection-report', { tabId: 2 }, { tabId: 1, top: true });
    assert.equal(diagnostic.code, 'viewer-sender-denied');
    assert.equal(
      h.calls.some(c => c.method === 'connection-report'),
      false
    );
  } finally {
    h.close();
    await flush();
  }
});

test('one website Watch loads exactly one of two matching players', async () => {
  const gate = deferred(),
    h = await harness({ loadGate: gate });
  try {
    await h.service.recordIntent(releaseId);
    await flush();
    assert.equal(
      h.calls.filter(x => x.method === 'load').length,
      1,
      'one intent must not open two protected owners'
    );
    gate.resolve();
    await flush();
    assert.equal(h.calls.filter(x => x.method === 'arm').length, 1);
    assert.deepEqual(await h.store.intents(), []);
  } finally {
    h.close();
    await flush();
  }
});

test('a failed claimed Watch retains the intent and a new explicit Watch can retry', async () => {
  const h = await harness({ failLoad: true });
  try {
    await h.service.recordIntent(releaseId);
    await flush();
    assert.equal(h.calls.filter(x => x.method === 'load').length, 1);
    assert.equal((await h.store.intents()).length, 1);
    await h.service.recordIntent(releaseId);
    await flush();
    assert.equal(h.calls.filter(x => x.method === 'load').length, 2);
  } finally {
    h.close();
    await flush();
  }
});

test('library Watch reuses its matching player without opening or switching another tab', async () => {
  const h = await harness();
  try {
    const result = await h.request({ releaseId, open: true, tabId: 2 });
    await flush();
    assert.equal(result.ok, true);
    assert.match(result.value.message, /Edit on/);
    assert.deepEqual(h.opened, []);
    assert.deepEqual(
      h.calls.filter(x => x.method === 'load').map(x => x.tabId),
      [2]
    );
    assert.equal(
      h.calls.some(x => x.method === 'acquire'),
      false,
      'kept files need no background download'
    );
    assert.deepEqual(await h.store.intents(), []);
  } finally {
    h.close();
    await flush();
  }
});

test('library Watch for another title retains the open-title handoff', async () => {
  const h = await harness();
  try {
    for (const player of h.players) player.sourceKey = 'other-source';
    const result = await h.request({ releaseId, open: true, tabId: 2 });
    await flush();
    assert.equal(result.ok, true);
    assert.equal(h.opened.length, 1);
    assert.equal(
      h.calls.some(x => x.method === 'load'),
      false
    );
    assert.equal((await h.store.intents()).length, 1);
  } finally {
    h.close();
    await flush();
  }
});

test('a delayed contender does not retry a failed attempt in another player', async () => {
  const h = await harness({ failLoad: true }),
    gate = deferred();
  try {
    h.readGates.set(2, gate);
    await h.service.recordIntent(releaseId);
    await flush();
    assert.equal(h.calls.filter(x => x.method === 'load').length, 1);
    gate.resolve();
    await flush();
    assert.equal(h.calls.filter(x => x.method === 'load').length, 1);
  } finally {
    gate.resolve();
    h.close();
    await flush();
  }
});

test('a failed library switch reports the failure without opening or retrying another player', async () => {
  const h = await harness({ failLoad: true });
  try {
    const result = await h.request({ releaseId, open: true, tabId: 2 });
    await flush();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'viewer-owner-busy');
    assert.deepEqual(h.opened, []);
    assert.deepEqual(
      h.calls.filter(x => x.method === 'load').map(x => x.tabId),
      [2]
    );
  } finally {
    h.close();
    await flush();
  }
});

test('extension download response preserves the precise phase while website jobs stay compatible', async () => {
  const h = await harness();
  try {
    h.progress('verifying');
    const result = await h.request({ releaseId, replaces: '22222222-2222-4222-8222-222222222222' });
    assert.equal(result.ok, true);
    assert.equal(result.value.job.state, 'verifying');
    assert.equal(h.service.job(releaseId).state, 'downloading');
    h.progress('ready');
    await flush();
    const snapshot = await h.call('snapshot', {});
    assert.equal(snapshot.value.jobs.find(job => job.releaseId === releaseId).state, 'ready');
  } finally { h.close(); await flush(); }
});

test('a catalog-only entry still goes through acquisition instead of pretending its files are kept', async () => {
  const h = await harness();
  try {
    h.data.library[0].availability = 'missing';
    const result = await h.request({ releaseId, open: true, tabId: 2 });
    await flush();
    assert.equal(result.ok, true);
    assert.equal(h.calls.filter(x => x.method === 'acquire').length, 1);
    assert.equal(h.opened.length, 1);
  } finally {
    h.close();
    await flush();
  }
});
