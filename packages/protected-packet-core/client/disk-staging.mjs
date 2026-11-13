import { insist, isId, requireDescriptor } from '../src/contract.mjs';

// root is a private OPFS directory, or an equivalent trusted test adapter.
// Each area owns exactly one random child directory, never a caller path.
export async function createDiskStaging({ root, budgetBytes, signal, authorize = () => {}, estimate, cryptoApi = globalThis.crypto }) {
  insist(root?.getDirectoryHandle && root?.removeEntry && Number.isSafeInteger(budgetBytes) && budgetBytes > 0 && budgetBytes <= 4_010_000_000, 'staging-policy');
  const check = () => { if (signal?.aborted) throw Error('staging-cancelled'); authorize(); };
  check();
  if (estimate) { const quota = await estimate(); check(); insist(Number.isFinite(quota.quota) && Number.isFinite(quota.usage) && quota.quota - quota.usage >= budgetBytes, 'staging-quota'); }
  const name = `job-${cryptoApi.randomUUID()}`; const directory = await root.getDirectoryHandle(name, { create: true });
  let closed = false; let reserved = 0; const files = new Map(); const pending = new Set();
  const active = () => { check(); if (closed) throw Error('staging-closed'); };
  function track(fn) { const p = Promise.resolve().then(fn); pending.add(p); p.finally(() => pending.delete(p)).catch(() => {}); return p; }
  const area = {
    async createSink(id, maximum, expected) {
      active(); insist(isId(id) && !files.has(id) && Number.isSafeInteger(maximum) && maximum > 0 &&
        (expected === undefined || (Number.isSafeInteger(expected) && expected > 0 && expected <= maximum)) && reserved + maximum <= budgetBytes, 'staging-reservation');
      reserved += maximum;
      const record = { handle: null, writer: null, state: 'opening', written: 0, maximum, expected, tail: Promise.resolve() }; files.set(id, record);
      try {
        await track(async () => { record.handle = await directory.getFileHandle(id, { create: true }); active(); record.writer = await record.handle.createWritable(); active(); record.state = 'writing'; });
      } catch (e) { await area.abort(); throw e; }
      const serial = operation => { const p = record.tail.then(() => track(operation)); record.tail = p.catch(() => {}); return p; };
      return Object.freeze({
        write(value) {
          // Copy before awaiting to avoid mutation of a reused network/cipher buffer.
          insist(!record.inFlight, 'staging-write-busy');
          insist(value instanceof Uint8Array && value.byteLength <= 4_194_304, 'staging-chunk'); record.inFlight = true; const owned = value.slice();
          return serial(async () => {
            try { active(); insist(record.state === 'writing' && record.written + owned.length <= maximum, 'staging-byte-limit');
              await record.writer.write(owned); record.written += owned.length; active();
            } finally { owned.fill(0); record.inFlight = false; }
          });
        },
        // E61 (0.62.20): an interrupted object restarts from byte 0 when the server ignores a
        // Range request; the area and its other objects are kept.
        reset() { return serial(async () => {
          active(); insist(record.state === 'writing', 'staging-reset');
          await record.writer.truncate(0); await record.writer.seek?.(0); record.written = 0; active();
        }); },
        get written() { return record.written; },
        commit() { return serial(async () => {
          active(); insist(record.state === 'writing' && record.written > 0 && (expected === undefined || record.written === expected), 'staging-incomplete');
          await record.writer.close(); record.writer = null; active();
          const file = await record.handle.getFile(); active(); insist(file instanceof Blob && file.size === record.written, 'staging-size'); record.state = 'committed'; return file;
        }); },
        async abort() { await area.abort(); },
      });
    },
    async read(id) { active(); const record = files.get(id); insist(record?.state === 'committed', 'staging-not-committed'); const blob = await record.handle.getFile(); active(); insist(blob.size === record.written, 'staging-size'); return blob; },
    async abort() {
      closed = true;
      // Await writes/opening before deletion; no failed async operation may recreate
      // files after cleanup. Retry remains possible if disk deletion itself fails.
      await Promise.allSettled([...pending]); await Promise.allSettled([...files.values()].map(r => r.tail));
      const stopped = await Promise.allSettled([...files.values()].map(async r => { if (r.writer) { await r.writer.abort(); r.writer = null; } }));
      try { await root.removeEntry(name, { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw Error('staging-cleanup-failed'); }
      if (stopped.some(r => r.status === 'rejected')) throw Error('staging-writer-cleanup-failed');
    },
  };
  try { check(); return Object.freeze(area); } catch (e) { await area.abort(); throw e; }
}

export function createDiskQuarantine(descriptor, area) {
  const bindings = new Map(requireDescriptor(descriptor).objects.map(o => [o.object_id, o])); const opened = new Set(); const complete = new Set(); let committed = false;
  return Object.freeze({
    async open(binding) {
      const expected = bindings.get(binding.object_id);
      insist(expected && JSON.stringify(binding) === JSON.stringify(expected) && !opened.has(binding.object_id), 'quarantine-object'); opened.add(binding.object_id);
      const sink = await area.createSink(binding.object_id, binding.plaintext_bytes, binding.plaintext_bytes);
      return { write: value => sink.write(value), async commit(evidence) { insist(evidence.bytes === binding.plaintext_bytes, 'quarantine-evidence'); await sink.commit(); complete.add(binding.object_id); }, abort: () => area.abort() };
    },
    async commit(evidence) { insist(complete.size === bindings.size && evidence.length === bindings.size, 'quarantine-incomplete'); committed = true; },
    async read(id) { insist(committed && bindings.has(id), 'quarantine-not-committed'); return area.read(id); },
    async abort() { committed = false; await area.abort(); },
  });
}
