// Minimal single-store IndexedDB fixture. Shared transactions run in creation
// order and commit only after their queued requests have completed.
export function fakeIndexedDB() {
  const data = new Map(), transactions = [];
  globalThis.IDBKeyRange ??= { bound: (lower, upper) => ({ lower, upper }) };
  const later = fn => setImmediate(fn);
  let active = null;
  function startNext() {
    if (active || !transactions.length) return;
    active = transactions.shift();
    active.start();
  }
  function transaction() {
    const tx = {}, requests = [];
    let staged, pending = 0, aborted = false, finished = false;
    function finish() {
      if (finished || active !== control || (!aborted && pending)) return;
      finished = true;
      if (aborted) tx.onabort?.();
      else {
        data.clear();
        for (const [key, value] of staged) data.set(key, value);
        tx.oncomplete?.();
      }
      active = null;
      later(startNext);
    }
    const request = operation => {
      const r = {};
      pending++;
      const run = () => later(() => {
        if (!aborted) {
          try { r.result = operation(staged); r.onsuccess?.(); }
          catch (error) { r.error = error; r.onerror?.(); aborted = true; }
        }
        pending--;
        later(finish);
      });
      if (staged) run(); else requests.push(run);
      return r;
    };
    tx.objectStore = () => ({
      get: key => request(s => structuredClone(s.get(key))),
      put: (value, key) => {
        const snapshot = structuredClone(value);
        return request(s => { s.set(key, snapshot); return key; });
      },
      delete: key => request(s => { s.delete(key); }),
      getAll: range => request(s => [...s].filter(([k]) => k >= range.lower && k <= range.upper).map(([, v]) => structuredClone(v)))
    });
    tx.abort = () => { aborted = true; later(finish); };
    const control = { start() {
      staged = structuredClone(data);
      for (const run of requests) run();
      later(finish);
    } };
    transactions.push(control);
    later(startNext);
    return tx;
  }
  return { data, open() {
    const r = {};
    later(() => {
      r.result = { onversionchange: null, createObjectStore() {}, transaction };
      r.onupgradeneeded?.(); r.onsuccess?.();
    });
    return r;
  } };
}
