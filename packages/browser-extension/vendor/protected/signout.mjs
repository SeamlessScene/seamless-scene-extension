// packet-core/client/installation-store.mjs
function createInstallationStore({
  indexedDB = globalThis.indexedDB,
  cryptoApi = globalThis.crypto,
  name = "seamless-protected-installation-candidate-1"
} = {}) {
  if (!indexedDB?.open || !cryptoApi?.subtle || !cryptoApi.randomUUID) throw Error("installation-storage-unavailable");
  let opening;
  let database;
  let closed = false;
  const active = () => {
    if (closed) throw Error("installation-store-closed");
  };
  async function open() {
    active();
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("private")) request.result.createObjectStore("private");
      };
      request.onerror = () => {
        failed = true;
        reject(Error("installation-storage-unavailable"));
      };
      request.onblocked = () => {
        failed = true;
        reject(Error("installation-storage-blocked"));
      };
      request.onsuccess = () => {
        if (failed || closed) {
          request.result.close();
          reject(Error("installation-store-closed"));
          return;
        }
        database = request.result;
        database.onversionchange = () => {
          closed = true;
          database.close();
        };
        resolve(database);
      };
    });
    return opening;
  }
  function valid(record) {
    if (!record || record.version !== 1 || typeof record.generation !== "string" || !/^[a-f0-9-]{36}$/.test(record.generation)) throw Error("installation-record-invalid");
    if (record.keys !== null) {
      const { publicKey, privateKey } = record.keys ?? {};
      if (!(publicKey instanceof CryptoKey) || !(privateKey instanceof CryptoKey) || publicKey.type !== "public" || privateKey.type !== "private" || publicKey.algorithm.name !== "ECDH" || privateKey.algorithm.name !== "ECDH" || publicKey.algorithm.namedCurve !== "P-256" || privateKey.algorithm.namedCurve !== "P-256" || privateKey.extractable || !publicKey.extractable || privateKey.usages.length !== 1 || privateKey.usages[0] !== "deriveBits") throw Error("installation-key-invalid");
    }
    return record;
  }
  async function transact2(update, discardInvalid = false) {
    const db = await open();
    active();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("private", "readwrite");
      const store = transaction.objectStore("private");
      let result;
      let error;
      const read = store.get("installation");
      read.onsuccess = () => {
        try {
          active();
          const current = read.result === void 0 ? null : discardInvalid ? read.result : valid(read.result);
          const next = update(current);
          result = next;
          if (next !== current) store.put(next, "installation");
        } catch (e) {
          error = e;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        try {
          active();
          resolve(valid(result));
        } catch (e) {
          reject(e);
        }
      };
      transaction.onerror = () => {
      };
      transaction.onabort = () => reject(error ?? Error("installation-write-failed"));
    });
  }
  const empty = () => ({ version: 1, generation: cryptoApi.randomUUID(), keys: null });
  return Object.freeze({
    async getInstallation() {
      const initial = await transact2((current) => current ?? empty());
      if (initial.keys) return Object.freeze(initial.keys);
      const keys = await cryptoApi.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      active();
      const committed = await transact2((current) => {
        if (!current || current.generation !== initial.generation) throw Error("installation-generation-changed");
        return current.keys ? current : { ...current, keys };
      });
      return Object.freeze(committed.keys);
    },
    async clear() {
      await transact2(() => empty(), true);
    },
    close() {
      closed = true;
      database?.close();
    }
  });
}

// packet-core/client/lease-cache.mjs
function createLeaseCache({
  indexedDB = globalThis.indexedDB,
  cryptoApi = globalThis.crypto,
  now = () => Date.now(),
  name = "seamless-protected-leases-candidate-1"
} = {}) {
  let db;
  let opening;
  let closed = false;
  const active = () => {
    if (closed) throw Error("lease-cache-closed");
  };
  function open() {
    active();
    return opening ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      let failed = false;
      r.onupgradeneeded = () => r.result.createObjectStore("private");
      r.onerror = r.onblocked = () => {
        failed = true;
        reject(Error("lease-cache-unavailable"));
      };
      r.onsuccess = () => {
        if (failed || closed) {
          r.result.close();
          reject(Error("lease-cache-closed"));
          return;
        }
        db = r.result;
        db.onversionchange = () => {
          closed = true;
          db.close();
        };
        resolve(db);
      };
    });
  }
  const key = (account, digest) => {
    if (typeof account !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(account) || !/^[a-f0-9]{64}$/.test(digest)) throw Error("lease-cache-identity");
    return `${account}:${digest}`;
  };
  function valid(s) {
    if (!s || s.version !== 1 || typeof s.generation !== "string" || !Number.isFinite(s.floor) || s.floor < 0 || !s.entries || typeof s.entries !== "object" || Array.isArray(s.entries) || Object.keys(s.entries).length > 32) throw Error("lease-cache-corrupt");
    for (const [id, entry] of Object.entries(s.entries)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,127}:[a-f0-9]{64}$/.test(id) || !entry || Object.keys(entry).sort().join(",") !== "expiresAt,token" || typeof entry.token !== "string" || entry.token.length > 128e3 || !Number.isFinite(entry.expiresAt) || entry.expiresAt < 0) throw Error("lease-cache-corrupt");
    }
    return s;
  }
  async function transaction(operation, { clear = false, observedTime } = {}) {
    const database = await open();
    active();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("private", "readwrite");
      const store = tx.objectStore("private");
      const read = store.get("state");
      let result;
      let error;
      read.onsuccess = () => {
        try {
          active();
          const time = observedTime === void 0 ? now() : observedTime;
          if (!Number.isFinite(time) || time < 0) throw Error("clock-invalid");
          const s = clear || read.result === void 0 ? { version: 1, generation: cryptoApi.randomUUID(), floor: time, entries: {} } : valid(read.result);
          if (time < s.floor) throw Error("clock-regression-revalidate");
          s.floor = time;
          result = operation(s);
          store.put(s, "state");
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        try {
          active();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      tx.onerror = () => {
      };
      tx.onabort = () => reject(error ?? Error("lease-cache-write-failed"));
    });
  }
  return Object.freeze({
    async checkpoint(generation, observedTime) {
      return transaction((s) => {
        if (generation !== void 0 && generation !== s.generation) throw Error("lease-cache-generation-changed");
        return s.generation;
      }, { observedTime });
    },
    async read(account, digest) {
      const id = key(account, digest);
      return transaction((s) => ({ generation: s.generation, entry: structuredClone(s.entries[id] ?? null) }));
    },
    async save({ generation, account, descriptorSha256, token, expiresAt }) {
      const id = key(account, descriptorSha256);
      if (typeof token !== "string" || token.length > 128e3 || !Number.isFinite(expiresAt)) throw Error("lease-cache-entry");
      return transaction((s) => {
        if (s.generation !== generation) throw Error("lease-cache-generation-changed");
        if (expiresAt <= s.floor) throw Error("lease-cache-expired");
        for (const [k, value] of Object.entries(s.entries)) if (value.expiresAt <= s.floor) delete s.entries[k];
        if (!s.entries[id] && Object.keys(s.entries).length >= 32) throw Error("lease-cache-capacity");
        if (!s.entries[id] || s.entries[id].expiresAt <= expiresAt) s.entries[id] = { token, expiresAt };
      });
    },
    async clear() {
      await transaction(() => {
      }, { clear: true });
    },
    close() {
      closed = true;
      db?.close();
    }
  });
}

// packet-core/client/browser-account.mjs
async function transact(operation, indexedDB = globalThis.indexedDB) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("seamless-protected-account-candidate-1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("private");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error("protected-account-storage"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("private", "readwrite"), store = tx.objectStore("private");
      let result, error;
      const epoch = store.get("generation");
      epoch.onsuccess = () => {
        const generation = epoch.result ?? crypto.randomUUID();
        if (!epoch.result) store.put(generation, "generation");
        const read = store.get("account");
        read.onsuccess = () => {
          try {
            result = operation({ account: read.result ?? null, generation }, store);
          } catch (e) {
            error = e;
            tx.abort();
          }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(error ?? Error("protected-account-storage"));
    });
  } finally {
    db.close();
  }
}
function privateAccount(value, indexedDB) {
  return transact((state, store) => {
    if (value === void 0) return state.account;
    if (value !== null) throw Error("protected-account-generation-required");
    store.put(crypto.randomUUID(), "generation");
    store.delete("account");
    return null;
  }, indexedDB);
}

// packet-core/client/browser-signout.mjs
import { EXECUTING_BUILD as EXECUTING_BUILD2 } from "../../src/build-info.mjs";

// extension/src/build-identity.mjs
import { EXECUTING_BUILD } from "../../src/build-info.mjs";
function sameExecutingBuild(value, expected = EXECUTING_BUILD) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === "adapterVersion,id,mode,version" && ["version", "adapterVersion", "id", "mode"].every((key) => value[key] === expected[key]);
}

// packet-core/client/browser-signout.mjs
var SIGNOUT_KEY = "protectedSignout.candidate1";
async function signOutProtected({
  chromeApi = globalThis.chrome,
  indexedDB = globalThis.indexedDB,
  navigatorApi = globalThis.navigator,
  createCache = createLeaseCache,
  createInstallation = createInstallationStore,
  clearAccount = () => privateAccount(null, indexedDB)
} = {}) {
  const cache = createCache({ indexedDB }), installation = createInstallation({ indexedDB });
  const failures = [];
  const collect = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      failures.push(e);
    }
  };
  try {
    await collect(() => chromeApi.storage.local.set({ [SIGNOUT_KEY]: crypto.randomUUID() }));
    await Promise.all([collect(() => cache.clear()), collect(() => installation.clear()), collect(clearAccount)]);
    const clearDiskIfUnowned = () => navigatorApi.locks.request("seamless-protected-owner-candidate-1", { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      const root = await navigatorApi.storage.getDirectory();
      await root.removeEntry("seamless-protected-candidate-1", { recursive: true }).catch((e) => {
        if (e.name !== "NotFoundError") throw e;
      });
      return true;
    });
    const unowned = await collect(clearDiskIfUnowned);
    if (unowned !== true) {
      await collect(async () => {
        let timer;
        let response;
        try {
          response = await Promise.race([
            chromeApi.runtime.sendMessage({ kind: "protected-signout", build: EXECUTING_BUILD2 }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error("protected-signout-timeout")), 15e3);
              timer.unref?.();
            })
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (response?.ok !== true || !sameExecutingBuild(response.build)) throw Error("protected-native-cleanup-unconfirmed");
      });
      if (await collect(clearDiskIfUnowned) !== true) failures.push(Error("protected-owner-cleanup-unconfirmed"));
    }
    if (failures.length) throw Error("protected-signout-cleanup-failed");
  } finally {
    cache.close();
    installation.close();
  }
}
export {
  SIGNOUT_KEY,
  signOutProtected
};
