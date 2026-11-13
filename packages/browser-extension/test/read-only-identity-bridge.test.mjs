import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_BRIDGE_PROTOCOL,
  IDENTITY_BRIDGE_SCHEMA_VERSION,
  sanitizeIdentitySnapshot
} from "../src/identity-bridge-protocol.mjs";
import {
  installReadOnlyIdentityBridgeEndpoint,
  ReadOnlyIdentityBridgeClient
} from "../src/read-only-identity-bridge.mjs";

const CHANNEL_ID = "0123456789abcdef0123456789abcdef";
const ORIGIN = "http://127.0.0.1:4173";

class FakeWindow {
  constructor(origin = ORIGIN) {
    this.origin = origin;
    this.listeners = new Set();
  }

  addEventListener(name, listener) {
    if (name === "message") this.listeners.add(listener);
  }

  removeEventListener(name, listener) {
    if (name === "message") this.listeners.delete(listener);
  }

  postMessage(data, targetOrigin) {
    if (targetOrigin !== this.origin) return;
    queueMicrotask(() => this.dispatch({ source: this, origin: this.origin, data }));
  }

  dispatch(event) {
    for (const listener of [...this.listeners]) listener(event);
  }
}

function identitySnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    serviceId: "cleared-fixture",
    activeItemId: "fixture-episode-001",
    mediaType: "episode",
    season: 1,
    episode: 1,
    canonicalTimeMs: 3000,
    runtimeMs: 20_000,
    versionTag: "fixture-native-v1",
    territory: "fixture",
    plan: "fixture",
    lifecycleGeneration: 1,
    provenance: {
      activeItemId: "fixture-player-state",
      mediaType: "fixture-player-state",
      season: "fixture-player-state",
      episode: "fixture-player-state",
      canonicalTimeMs: "standard-media-element",
      runtimeMs: "standard-media-element",
      versionTag: "fixture-manifest",
      territory: "fixture-manifest",
      plan: "fixture-manifest",
      lifecycleGeneration: "fixture-player-state"
    },
    ...overrides
  };
}

test("connects, reads one strict snapshot, and tears down its bound session", async () => {
  const window = new FakeWindow();
  let currentIdentity = identitySnapshot();
  const endpoint = installReadOnlyIdentityBridgeEndpoint({
    window,
    origin: ORIGIN,
    readSnapshot: () => currentIdentity
  });
  const client = new ReadOnlyIdentityBridgeClient({
    window,
    origin: ORIGIN,
    channelId: CHANNEL_ID,
    timeoutMs: 100
  });

  await client.connect();
  assert.equal(endpoint.sessionCount(), 1);
  assert.deepEqual(await client.readIdentity(), identitySnapshot());
  let notification = null;
  const unsubscribe = client.subscribe((snapshot) => { notification = snapshot; });
  currentIdentity = identitySnapshot({
    activeItemId: "fixture-episode-002",
    episode: 2,
    lifecycleGeneration: 2
  });
  await endpoint.notifyIdentityChanged();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notification.activeItemId, "fixture-episode-002");
  assert.equal(notification.lifecycleGeneration, 2);
  unsubscribe();
  await client.close();
  assert.equal(endpoint.sessionCount(), 0);
  endpoint.close();
  assert.equal(window.listeners.size, 0);
});

test('a disposed endpoint never publishes a late read or lifecycle notification', async () => {
  for (const notification of [false, true]) {
    const window = new FakeWindow(), replies = [];
    let resolveRead;
    const pending = new Promise(resolve => { resolveRead = resolve; });
    const endpoint = installReadOnlyIdentityBridgeEndpoint({ window, origin: ORIGIN, readSnapshot: () => pending });
    const request = kind => ({ protocol: IDENTITY_BRIDGE_PROTOCOL, schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION, kind, channelId: CHANNEL_ID, requestId: 'request-1' });
    window.postMessage = value => replies.push(value);
    window.dispatch({ source: window, origin: ORIGIN, data: request('connect') });
    const work = notification ? endpoint.notifyIdentityChanged() : window.dispatch({ source: window, origin: ORIGIN, data: request('read-identity') });
    endpoint.close(); resolveRead(identitySnapshot()); await work; await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length, 1); assert.equal(replies[0].payload.connected, true); assert.equal(window.listeners.size, 0);
  }
});

test("rejects unknown snapshot fields instead of silently carrying page data", () => {
  assert.throws(
    () => sanitizeIdentitySnapshot({ ...identitySnapshot(), title: "must-not-cross-the-bridge" }),
    /identity-snapshot-schema-invalid/
  );
});

test("returns only a bounded error when the page reader produces an invalid snapshot", async () => {
  const window = new FakeWindow();
  const endpoint = installReadOnlyIdentityBridgeEndpoint({
    window,
    origin: ORIGIN,
    readSnapshot: () => ({ ...identitySnapshot(), arbitraryPageObject: {} })
  });
  const client = new ReadOnlyIdentityBridgeClient({
    window,
    origin: ORIGIN,
    channelId: CHANNEL_ID,
    timeoutMs: 100
  });

  await client.connect();
  await assert.rejects(client.readIdentity(), /^Error: identity-bridge-snapshot-invalid$/);
  await client.close();
  endpoint.close();
});

test("ignores forged responses from the wrong source and wrong origin", async () => {
  const window = new FakeWindow();
  const client = new ReadOnlyIdentityBridgeClient({
    window,
    origin: ORIGIN,
    channelId: CHANNEL_ID,
    timeoutMs: 100
  });
  client.connected = true;
  const read = client.readIdentity();
  const response = {
    protocol: IDENTITY_BRIDGE_PROTOCOL,
    schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION,
    kind: "response",
    channelId: CHANNEL_ID,
    requestId: "request-1",
    ok: true,
    payload: identitySnapshot()
  };
  window.dispatch({ source: {}, origin: ORIGIN, data: response });
  window.dispatch({ source: window, origin: "https://wrong.example", data: response });
  window.dispatch({ source: window, origin: ORIGIN, data: response });
  assert.deepEqual(await read, identitySnapshot());
  client.connected = false;
  await client.close();
});

test("requires a connected channel before returning identity", async () => {
  const window = new FakeWindow();
  const endpoint = installReadOnlyIdentityBridgeEndpoint({
    window,
    origin: ORIGIN,
    readSnapshot: () => identitySnapshot()
  });
  const client = new ReadOnlyIdentityBridgeClient({
    window,
    origin: ORIGIN,
    channelId: CHANNEL_ID,
    timeoutMs: 100
  });
  client.connected = true;
  await assert.rejects(client.readIdentity(), /^Error: identity-bridge-not-connected$/);
  client.connected = false;
  await client.close();
  endpoint.close();
});
