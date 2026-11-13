import {
  IDENTITY_BRIDGE_PROTOCOL,
  CLEARED_FIXTURE_BRIDGE_PROTOCOL,
  IDENTITY_BRIDGE_SCHEMA_VERSION,
  sanitizeIdentitySnapshot,
  validateBridgeNotification,
  validateBridgeRequest,
  validateBridgeResponse
} from "./identity-bridge-protocol.mjs";

function randomChannelId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function responseFor(request, result) {
  const base = {
    protocol: request.protocol,
    schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION,
    kind: "response",
    channelId: request.channelId,
    requestId: request.requestId
  };
  return result.ok
    ? { ...base, ok: true, payload: result.payload }
    : { ...base, ok: false, errorCode: result.errorCode };
}

function selectProtocol(origin, clearedFixture) {
  if (!clearedFixture) return IDENTITY_BRIDGE_PROTOCOL;
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('identity-fixture-origin-invalid');
  return CLEARED_FIXTURE_BRIDGE_PROTOCOL;
}

export function installReadOnlyIdentityBridgeEndpoint({ window, origin, readSnapshot, clearedFixture = false }) {
  if (!window || typeof window.addEventListener !== "function" || typeof window.postMessage !== "function") {
    throw new TypeError("identity-bridge-window-invalid");
  }
  if (typeof origin !== "string" || !origin) throw new TypeError("identity-bridge-origin-invalid");
  if (typeof readSnapshot !== "function") throw new TypeError("identity-bridge-reader-invalid");
  const protocol = selectProtocol(origin, clearedFixture);

  const sessions = new Set();
  let closed = false;
  const onMessage = async (event) => {
    if (closed || event.source !== window || event.origin !== origin) return;
    const request = event.data;
    if (!validateBridgeRequest(request, protocol)) return;

    if (request.kind === "connect") {
      sessions.add(request.channelId);
      window.postMessage(responseFor(request, { ok: true, payload: { connected: true } }), origin);
      return;
    }

    if (!sessions.has(request.channelId)) {
      window.postMessage(responseFor(request, { ok: false, errorCode: "not-connected" }), origin);
      return;
    }

    if (request.kind === "close") {
      sessions.delete(request.channelId);
      window.postMessage(responseFor(request, { ok: true, payload: { closed: true } }), origin);
      return;
    }

    try {
      const snapshot = sanitizeIdentitySnapshot(await readSnapshot());
      if (closed || !sessions.has(request.channelId)) return;
      window.postMessage(responseFor(request, { ok: true, payload: snapshot }), origin);
    } catch (error) {
      if (closed || !sessions.has(request.channelId)) return;
      const errorCode = error instanceof TypeError ? "snapshot-invalid" : "read-failed";
      window.postMessage(responseFor(request, { ok: false, errorCode }), origin);
    }
  };

  window.addEventListener("message", onMessage);
  return {
    async notifyIdentityChanged() {
      if (closed || sessions.size === 0) return;
      let snapshot;
      try {
        snapshot = sanitizeIdentitySnapshot(await readSnapshot());
      } catch {
        return;
      }
      if (closed) return;
      for (const channelId of sessions) {
        window.postMessage({
          protocol,
          schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION,
          kind: "identity-changed",
          channelId,
          payload: snapshot
        }, origin);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      sessions.clear();
      window.removeEventListener("message", onMessage);
    },
    sessionCount() {
      return sessions.size;
    }
  };
}

export class ReadOnlyIdentityBridgeClient {
  constructor({ window, origin, channelId = randomChannelId(), timeoutMs = 1000, clearedFixture = false }) {
    if (!window || typeof window.addEventListener !== "function" || typeof window.postMessage !== "function") {
      throw new TypeError("identity-bridge-window-invalid");
    }
    this.window = window;
    this.origin = origin;
    this.protocol = selectProtocol(origin, clearedFixture);
    this.channelId = channelId;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    this.identityListeners = new Set();
    this.connected = false;
    this.closed = false;
    this.onMessage = this.onMessage.bind(this);
    this.window.addEventListener("message", this.onMessage);
  }

  onMessage(event) {
    if (event.source !== this.window || event.origin !== this.origin) return;
    const response = event.data;
    if (!response || response.protocol !== this.protocol || response.channelId !== this.channelId) return;
    if (response.kind === "identity-changed") {
      if (!this.connected) return;
      if (!validateBridgeNotification(response, this.protocol)) return;
      let snapshot;
      try {
        snapshot = sanitizeIdentitySnapshot(response.payload);
      } catch {
        return;
      }
      for (const listener of this.identityListeners) {
        try {
          listener(snapshot);
        } catch {
          // A consumer cannot break bridge validation or other subscribers.
        }
      }
      return;
    }
    if (response.kind !== "response" || typeof response.requestId !== "string") return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    if (!validateBridgeResponse(response, this.protocol)) {
      pending.reject(new Error("identity-bridge-response-invalid"));
      return;
    }
    if (!response.ok) {
      pending.reject(new Error(`identity-bridge-${response.errorCode}`));
      return;
    }
    pending.resolve(response.payload);
  }

  request(kind) {
    if (this.closed) return Promise.reject(new Error("identity-bridge-closed"));
    const requestId = `request-${++this.sequence}`;
    const request = {
      protocol: this.protocol,
      schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION,
      kind,
      channelId: this.channelId,
      requestId
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("identity-bridge-timeout"));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.window.postMessage(request, this.origin);
    });
  }

  async connect() {
    const result = await this.request("connect");
    if (!result || result.connected !== true) throw new Error("identity-bridge-connect-invalid");
    this.connected = true;
  }

  async readIdentity() {
    if (!this.connected) throw new Error("identity-bridge-not-connected");
    return sanitizeIdentitySnapshot(await this.request("read-identity"));
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("identity-bridge-listener-invalid");
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  async close() {
    if (this.closed) return;
    try {
      if (this.connected) await this.request("close");
    } finally {
      this.closed = true;
      this.connected = false;
      this.window.removeEventListener("message", this.onMessage);
      this.identityListeners.clear();
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("identity-bridge-closed"));
      }
      this.pending.clear();
    }
  }
}
