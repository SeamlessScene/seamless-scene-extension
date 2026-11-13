import { exportJWK, compactDecrypt, base64url } from 'jose';
import { exact, insist, requireDescriptor, verifyDescriptor, isHash, descriptorToken, bytes } from '../src/contract.mjs';
import { installationId, openLicense, closeLicense } from '../src/license.mjs';
import { splitTransport } from '../src/transport.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const decoder = new TextDecoder('utf-8', { fatal: true });
const integer = value => Number.isSafeInteger(value) && value >= 0;
// E61 (0.62.20): per-object retry policy for downloads. A 429 (the server's per-account
// read quota) waits as its Retry-After says and has its own, larger budget.
const RETRIES = 4, BACKOFF_MS = 1_000, BACKOFF_MAX_MS = 16_000, RATE_RETRIES = 8, RETRY_AFTER_MAX_MS = 60_000;
const TRANSIENT = new Set(['request-aborted', 'protected-server-unavailable', 'protected-rate-limited', 'response-size', 'response-body', 'protected-range-unsupported', 'request-paused', 'protected-object-refused']);
// E61 (0.62.21): an object refused (403) after this acquisition's descriptor was granted is
// almost always the server's per-account read quota (120 GETs a minute, which the deployed
// route answers with 403, not 429): wait into the next minute and try again, twice.
const REFUSED_RETRIES = 2, REFUSED_WAIT_MS = 30_000;
// A strong validator only (If-Range never takes a weak one).
const strongTag = value => typeof value === 'string' && /^"[\x21\x23-\x7e]{1,200}"$/.test(value) ? value : null;
// E61: the network stream is read independently of storage writes. Chunks queue in a
// bounded buffer (BUFFER_MAX) and reach storage in batches of WRITE_MIN..WRITE_MAX, so a
// slow write never stops the socket being read (HTTP/2 flow control would otherwise
// throttle the server to the write rate: 0.62.19's ~80 KB/s).
const WRITE_MIN = 1_048_576, WRITE_MAX = 4_194_304, BUFFER_MAX = 16_777_216;
// Retry-After: delta-seconds or an HTTP date, bounded; null when absent or unreadable.
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const ms = /^\d{1,6}$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(ms) ? Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms)) : null;
}
// E91 (0.66.1): the per-edit re-download allowance. The server answers 403 with
// {"error":{"code":"PROTECTED_DOWNLOAD_LIMIT","retryAfterSeconds":N}} (and Retry-After) when an
// account has downloaded the same edit too often in 24 hours. Only that exact code is read from
// a small JSON body; any other 403 stays 'protected-access-refused'. The wait is bounded and,
// unlike retryAfterMs, not capped at a minute: it is shown to the viewer, never slept on.
const LIMIT_BODY_MAX = 2048, LIMIT_WAIT_MAX_S = 7 * 86_400;
const limitSeconds = value => Number.isSafeInteger(value) && value > 0 ? Math.min(LIMIT_WAIT_MAX_S, value) : null;
async function downloadLimit(response) {
  let reader = null;
  try {
    if ((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return null;
    const length = response.headers.get('content-length');
    if (length !== null && !(/^\d{1,6}$/.test(length) && Number(length) <= LIMIT_BODY_MAX)) return null;
    if (!response.body) return null;
    reader = response.body.getReader(); const parts = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > LIMIT_BODY_MAX) return null; parts.push(value);
    }
    const body = JSON.parse(decoder.decode(concat(parts, size)));
    if (body?.error?.code !== 'PROTECTED_DOWNLOAD_LIMIT') return null;
    const header = response.headers.get('retry-after');
    return { retryAfterSeconds: limitSeconds(body.error.retryAfterSeconds) ?? (/^\d{1,7}$/.test(header?.trim() ?? '') ? limitSeconds(Number(header.trim())) : null) };
  } catch { return null; } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
const concat = (parts, size) => { const out = new Uint8Array(size); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
const errorCode = error => (typeof error?.message === 'string' && /^[a-z0-9-]{1,60}$/.test(error.message)) ? error.message : error?.name === 'TypeError' ? 'network-error' : 'download-error';
// A dropped connection surfaces as a TypeError from fetch or the body reader.
const retryable = error => TRANSIENT.has(error?.message) || error?.name === 'TypeError' || error?.name === 'AbortError' && error?.message !== 'client-cancelled';
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(Error('client-cancelled')); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(Error('client-cancelled')); };
  signal?.addEventListener('abort', onAbort, { once: true });
});
const nonce = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && base64url.encode(base64url.decode(value)) === value;

// Private-context candidate adapter. getCredentials/getInstallation are trusted
// boundaries; never expose this object or credentials to provider page scripts.
export function createProtectedWebsiteClient({ origin, issuer, descriptorTrust, licenseTrust, getCredentials, getInstallation,
  fetchImpl = globalThis.fetch, now = () => Date.now(), monotonic = () => performance.now(), timeoutMs = 30_000, retryBackoffMs = BACKOFF_MS, refusedWaitMs = REFUSED_WAIT_MS }) {
  const configured = new URL(origin);
  insist(configured.protocol === 'https:' && configured.origin === origin && !configured.username && !configured.password, 'protected-origin');
  insist(typeof issuer === 'string' && issuer.startsWith('https://') && typeof getCredentials === 'function' && typeof getInstallation === 'function', 'client-policy');
  insist(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, 'client-timeout');
  insist(Number.isSafeInteger(retryBackoffMs) && retryBackoffMs > 0 && retryBackoffMs <= BACKOFF_MS, 'client-backoff');
  insist(Number.isSafeInteger(refusedWaitMs) && refusedWaitMs > 0 && refusedWaitMs <= REFUSED_WAIT_MS, 'client-backoff');
  let closed = false; const pending = new Set(); const leases = new Set();
  // E61: Range support is detected: a 400 or a plain 200 to a Range request turns it off
  // for this client, and later retries re-fetch whole objects.
  let rangeSupported = true;
  const checkOpen = signal => { insist(!closed && !signal?.aborted, 'client-cancelled'); };
  async function credentials(signal) {
    checkOpen(signal); const c = structuredClone(await getCredentials(signal)); checkOpen(signal);
    insist(exact(c, ['accountId', 'pairingId', 'accessToken', 'expiresAt']) && uuid(c.accountId) && uuid(c.pairingId) &&
      typeof c.accessToken === 'string' && c.accessToken.length > 0 && c.accessToken.length <= 4096 && !/[\r\n]/.test(c.accessToken) &&
      Number.isFinite(c.expiresAt) && c.expiresAt > now(), 'paired-session-required');
    return c;
  }
  async function unchanged(c, signal) {
    const current = await credentials(signal);
    insist(current.accountId === c.accountId && current.pairingId === c.pairingId && current.accessToken === c.accessToken && current.expiresAt === c.expiresAt, 'paired-session-changed');
  }
  function path(releaseId, suffix) { insist(uuid(releaseId), 'release-id'); return `${origin}/api/v1/protected-candidate/releases/${releaseId}/${suffix}`; }
  // resumeFrom (E61, 0.62.20): continue an object after `resumeFrom` bytes already in `sink`
  // with an HTTP Range request. A 206 with the exact Content-Range continues; a plain 200
  // (no range support) resets the sink and restarts from byte 0 (onRestart reports the bytes
  // dropped). keepSinkOnError leaves the sink for a retry and records error.written.
  // pauseSignal (0.62.21): Pause stops this request but keeps what was staged
  // (error 'request-paused', with error.written), so Resume continues it. ifRange sends the
  // object's ETag with a Range request: a changed object then comes back whole (200).
  async function request(c, url, { body, maximum, signal, json = false, exactBytes, sink, onBytes, descriptorRequest = false,
    resumeFrom = 0, keepSinkOnError = false, onRestart, pauseSignal, ifRange = null } = {}) {
    await unchanged(c, signal);
    const controller = new AbortController(); pending.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    pauseSignal?.addEventListener('abort', abort, { once: true });
    let etag = null;
    // timeoutMs bounds silence, not size: every received chunk re-arms it, so a
    // large release on a slow link completes while a stalled one still fails. An
    // overall cap (a 32 KiB/s floor over the permitted size) bounds a trickle.
    let timer = setTimeout(abort, timeoutMs);
    const rearm = () => { clearTimeout(timer); timer = setTimeout(abort, timeoutMs); };
    const cap = setTimeout(abort, timeoutMs + Math.ceil((maximum ?? 0) / 32_768) * 1000);
    const ensure = () => { checkOpen(signal); insist(!controller.signal.aborted, 'request-aborted'); };
    let reader; let response; let written = resumeFrom;
    try {
      insist(Number.isSafeInteger(resumeFrom) && resumeFrom >= 0 && (resumeFrom === 0 || (sink && !body && exactBytes !== undefined && resumeFrom < exactBytes)), 'resume-policy');
      insist(!pauseSignal?.aborted, 'request-paused');
      // A whole-object re-fetch starts from an empty sink.
      if (sink && resumeFrom === 0 && (sink.written ?? 0) > 0) await sink.reset();
      ensure(); response = await fetchImpl(url, { method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${c.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-`, ...(strongTag(ifRange) ? { 'If-Range': ifRange } : {}) } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      ensure();
      insist(!response.redirected && (!response.url || response.url === url), 'protected-response');
      etag = strongTag(response.headers.get('etag'));
      // Fixed codes per outcome, so a failure says which request was refused and how.
      // The server answers 403 for a withdrawn release as well as for a refused
      // link, entitlement or origin, so 403 is "refused", not "withdrawn".
      insist(!descriptorRequest || response.status !== 404, 'protected-release-unavailable');
      if (response.status === 403) {
        const limit = await downloadLimit(response);
        if (limit) throw Object.assign(Error('protected-download-limit'), limit.retryAfterSeconds ? { retryAfterSeconds: limit.retryAfterSeconds } : {});
        throw Error('protected-access-refused');
      }
      if (response.status === 429 || response.status >= 500) {
        const error = Error(response.status === 429 ? 'protected-rate-limited' : 'protected-server-unavailable');
        const wait = retryAfterMs(response.headers.get('retry-after'));
        if (wait !== null) error.retryAfterMs = wait;
        throw error;
      }
      // The object route without Range support answers 400 to a Range request.
      if (resumeFrom > 0 && response.status === 400) { rangeSupported = false; throw Error('protected-range-unsupported'); }
      // A resumed object: 206 must be exactly the rest of this object.
      const partial = resumeFrom > 0 && response.status === 206;
      insist(response.status === 200 || partial, 'protected-response');
      if (partial) {
        if (response.headers.get('content-range') !== `bytes ${resumeFrom}-${exactBytes - 1}/${exactBytes}`) { rangeSupported = false; throw Error('protected-range-unsupported'); }
      } else if (resumeFrom > 0) { rangeSupported = false; await sink.reset(); written = 0; try { onRestart?.(resumeFrom); } catch {} }
      insist((response.headers.get('cache-control') ?? '').split(',').map(x => x.trim().toLowerCase()).includes('no-store'), 'private-response-required');
      if (json) insist((response.headers.get('content-type') ?? '').split(';')[0] === 'application/json', 'response-type');
      const length = response.headers.get('content-length');
      insist(length === null || (/^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) + written <= maximum), 'response-limit');
      insist(response.body, 'response-body'); reader = response.body.getReader(); const chunks = []; let total = written;
      if (sink) {
        // E61: a reader and a writer joined by a bounded queue. Either one's progress re-arms
        // the silence timer. A network failure still flushes what arrived, so a retry
        // resumes from every byte received; a storage failure stops both.
        const queue = []; let buffered = 0, finished = false, readError = null, writeError = null, wakeWriter = null, wakeReader = null;
        const kick = waiter => { const wake = waiter === 'writer' ? wakeWriter : wakeReader; if (waiter === 'writer') wakeWriter = null; else wakeReader = null; wake?.(); };
        const writer = (async () => {
          while (!writeError) {
            if (buffered < WRITE_MIN && !finished) { await new Promise(resolve => { wakeWriter = resolve; }); continue; }
            if (!buffered) return;
            const parts = []; let size = 0;
            while (queue.length && (size === 0 || size + queue[0].length <= WRITE_MAX)) { const part = queue.shift(); parts.push(part); size += part.length; }
            checkOpen(signal);
            const batch = parts.length === 1 ? parts[0] : concat(parts, size);
            for (let offset = 0; offset < batch.length; offset += WRITE_MAX) await sink.write(batch.subarray(offset, offset + WRITE_MAX));
            buffered -= size; written += size; rearm(); kick('reader');
          }
        })().catch(error => { writeError = error; kick('reader'); });
        try {
          while (!writeError) {
            ensure(); const { done, value } = await reader.read(); ensure(); if (done) break;
            total += value.length; insist(total <= maximum, 'response-limit'); rearm(); onBytes?.(value.length);
            queue.push(value); buffered += value.length; if (buffered >= WRITE_MIN) kick('writer');
            while (buffered >= BUFFER_MAX && !writeError) await new Promise(resolve => { wakeReader = resolve; });
            // Every byte of the object is here: a pause from now on must not discard it.
            if (exactBytes !== undefined && total === exactBytes) break;
          }
        } catch (error) { readError = error; }
        finished = true; kick('writer');
        await writer;
        if (writeError) throw writeError;
        if (readError) throw readError;
      } else {
        while (true) {
          ensure(); const { done, value } = await reader.read(); ensure(); if (done) break;
          total += value.length; insist(total <= maximum, 'response-limit'); rearm(); onBytes?.(value.length); chunks.push(value);
        }
      }
      insist(exactBytes === undefined || total === exactBytes, 'response-size');
      // The body is complete: only a cancel (not a pause or the silence timer) stops it now.
      pauseSignal?.removeEventListener('abort', abort); clearTimeout(timer); clearTimeout(cap);
      await unchanged(c, signal); checkOpen(signal);
      const blob = sink ? await sink.commit() : new Blob(chunks);
      await unchanged(c, signal); checkOpen(signal);
      return json ? JSON.parse(decoder.decode(await blob.arrayBuffer())) : blob;
    } catch (caught) {
      // A pause (not a cancel) reads as 'request-paused' whatever the stream reported.
      const error = pauseSignal?.aborted && !signal?.aborted && !closed && caught?.message !== 'paired-session-changed' && caught?.message !== 'paired-session-required' ? Error('request-paused') : caught;
      if (sink && keepSinkOnError) { try { error.written = written; if (etag) error.etag = etag; } catch {} }
      else if (sink) await sink.abort();
      throw error;
    } finally {
      clearTimeout(timer); clearTimeout(cap); signal?.removeEventListener('abort', abort); pauseSignal?.removeEventListener('abort', abort); pending.delete(controller); controller.abort();
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      else await response?.body?.cancel().catch(() => {});
    }
  }
  async function descriptor(c, releaseId, signal) {
    const blob = await request(c, path(releaseId, 'descriptor'), { maximum: 180_000, signal, descriptorRequest: true });
    const handle = await verifyDescriptor(decoder.decode(await blob.arrayBuffer()), descriptorTrust);
    insist(requireDescriptor(handle).release_id === releaseId, 'descriptor-release');
    await unchanged(c, signal); return handle;
  }
  function challengeBinding(value, expected) {
    insist(uuid(value.id) && value.releaseId === expected.releaseId && value.descriptorSha256 === expected.descriptorSha256 && isHash(value.descriptorSha256) &&
      value.installationId === expected.installationId && integer(value.expiresAt) && value.expiresAt * 1000 > now() && value.expiresAt * 1000 <= now() + 60_000, 'challenge-binding');
  }
  return Object.freeze({
    // `staging` is either a prepared area or a factory `(bytes) => area` called
    // once the verified descriptor states the exact ciphertext footprint, so a
    // quota check reserves what this release needs rather than the format maximum.
    // onProgress(receivedBytes, totalBytes) reports ciphertext received; the total is
    // known from the verified descriptor before any object is fetched.
    // E61 (0.62.20): each object is retried after a transient failure (silence timeout,
    // 5xx, 429, a dropped connection or short body), up to RETRIES times with exponential
    // backoff, resuming with HTTP Range from the bytes already staged. onRetry({ object,
    // attempt, code, written, delayMs }) reports each retry (telemetry only).
    // pause (0.62.21): { paused, signal(), resumed() } from the caller. While paused the
    // acquisition holds its staged objects and its place; Resume continues the current
    // object (with Range when the server supports it) and skips every finished object.
    async acquire(releaseId, { combined = false, signal, staging, onProgress, onRetry, pause: gate } = {}) {
      let area = typeof staging === 'function' ? undefined : staging;
      let received = 0, expectedTotal = 0;
      const progress = n => { received += n; try { onProgress?.(received, expectedTotal); } catch {} };
      const reserve = async total => {
        if (typeof staging === 'function' && !area) {
          area = await staging(total);
          insist(area && typeof area.createSink === 'function' && typeof area.abort === 'function', 'staging-area');
        }
        return area;
      };
      try {
      let c = await credentials(signal);
      // Waits while paused; a cancel still ends the wait. The session may have been
      // refreshed meanwhile: the same account and pairing continue with the new token.
      const hold = async () => {
        if (!gate?.paused) return;
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(Error('client-cancelled'));
          if (signal?.aborted) { onAbort(); return; }
          signal?.addEventListener('abort', onAbort, { once: true });
          Promise.resolve(gate.resumed()).then(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, reject);
        });
        checkOpen(signal);
        const next = await credentials(signal);
        insist(next.accountId === c.accountId && next.pairingId === c.pairingId, 'paired-session-changed');
        c = next;
      };
      if (combined) {
        const expected = await descriptor(c, releaseId, signal);
        const size = 12 + bytes(descriptorToken(expected)).length + requireDescriptor(expected).objects.reduce((sum, o) => sum + 8 + bytes(o.object_id).length + o.ciphertext_bytes, 0);
        const sink = (await reserve(size)) ? await area.createSink('combined', size, size) : undefined;
        expectedTotal = size; progress(0);
        const blob = await request(c, path(releaseId, 'combined'), { maximum: size, exactBytes: size, signal, sink, onBytes: progress });
        const result = await splitTransport(blob, descriptorTrust);
        insist(requireDescriptor(result.descriptor).release_id === releaseId && result.descriptor.sha256 === expected.sha256, 'descriptor-release');
        await unchanged(c, signal); return result;
      }
      // E61: one retry policy for the descriptor and every object. Transient failures back
      // off exponentially (RETRIES); a 429 waits its Retry-After (RATE_RETRIES); a server
      // without Range support is retried at once from byte 0.
      const retrying = async (index, count, attempt, fn, { objectRequest = false } = {}) => {
        let tries = 0, rated = 0, refused = 0;
        while (true) {
          await hold();
          try { return await fn(); } catch (caught) {
            let error = caught;
            if (objectRequest && error?.message === 'protected-access-refused') error = Object.assign(Error('protected-object-refused'), { written: error.written, etag: error.etag });
            if (!retryable(error) || signal?.aborted || closed) throw error;
            const code = errorCode(error), rangeless = code === 'protected-range-unsupported';
            if (code === 'request-paused') { attempt(error); continue; }
            if (code === 'protected-rate-limited') { if (rated >= RATE_RETRIES) throw error; rated += 1; }
            else if (code === 'protected-object-refused') { if (refused >= REFUSED_RETRIES) throw error; refused += 1; }
            else if (!rangeless) { if (tries >= RETRIES) throw error; tries += 1; }
            const backoff = Math.min(BACKOFF_MAX_MS, retryBackoffMs * 2 ** Math.max(0, tries - 1));
            const delayMs = rangeless ? 0 : code === 'protected-object-refused' ? Math.min(RETRY_AFTER_MAX_MS, refusedWaitMs * refused)
              : Number.isFinite(error.retryAfterMs) ? Math.max(error.retryAfterMs, code === 'protected-rate-limited' ? 0 : backoff) : backoff;
            const written = attempt(error);
            try { onRetry?.({ object: index, objects: count, attempt: tries + rated + refused + (rangeless ? 1 : 0), code, written, delayMs }); } catch {}
            if (delayMs) await pause(delayMs, signal);
            checkOpen(signal);
          }
        }
      };
      const handle = await retrying(0, 0, () => 0, () => descriptor(c, releaseId, signal)); const entries = [];
      const objects = requireDescriptor(handle).objects;
      expectedTotal = objects.reduce((sum, o) => sum + o.ciphertext_bytes, 0);
      await reserve(expectedTotal); progress(0);
      for (const [index, object] of objects.entries()) {
        const sink = area ? await area.createSink(object.object_id, object.ciphertext_bytes, object.ciphertext_bytes) : undefined;
        let counted = 0, staged = 0, etag = null;
        const objectBytes = n => { counted += n; progress(n); };
        const blob = await retrying(index + 1, objects.length, error => {
          // Resume from the bytes on disk when the server takes Range; else from byte 0.
          staged = sink && rangeSupported && Number.isSafeInteger(error.written) && error.written < object.ciphertext_bytes ? error.written : 0;
          etag = error.etag ?? etag;
          // Progress returns to what is actually kept for this object.
          if (counted !== staged) { progress(staged - counted); counted = staged; }
          return staged;
        }, () => request(c, path(releaseId, `objects/${object.object_id}`), { maximum: object.ciphertext_bytes, exactBytes: object.ciphertext_bytes,
          signal, sink, onBytes: objectBytes, resumeFrom: sink ? staged : 0, keepSinkOnError: Boolean(sink), pauseSignal: gate?.signal?.(), ifRange: etag,
          onRestart: dropped => { counted -= dropped; progress(-dropped); } }), { objectRequest: true });
        entries.push([object.object_id, blob]);
      }
      await unchanged(c, signal); requireDescriptor(handle);
      return { descriptor: handle, entries };
      } catch (error) { if (area) await area.abort(); throw error; }
    },
    async license(handle, { signal, onVerifiedGrant } = {}) {
      const c = await credentials(signal); const d = requireDescriptor(handle);
      insist(uuid(d.release_id), 'release-id'); const installation = await getInstallation(); await unchanged(c, signal);
      const exported = await exportJWK(installation.publicKey);
      const installationPublicKey = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
      const id = await installationId(installation.publicKey);
      const expected = { releaseId: d.release_id, descriptorSha256: handle.sha256, installationId: id };
      const challenge = await request(c, path(d.release_id, 'challenge'), { body: { releaseId: d.release_id, installationPublicKey }, maximum: 8192, signal, json: true });
      insist(exact(challenge, ['id', 'releaseId', 'descriptorSha256', 'installationId', 'expiresAt', 'proofJwe']) && typeof challenge.proofJwe === 'string' && challenge.proofJwe.length <= 4096, 'challenge-shape');
      challengeBinding(challenge, expected);
      const opened = await compactDecrypt(challenge.proofJwe, installation.privateKey, { keyManagementAlgorithms: ['ECDH-ES'], contentEncryptionAlgorithms: ['A256GCM'] });
      let proof;
      try {
        const h = opened.protectedHeader;
        insist(exact(h, ['alg', 'enc', 'typ', 'epk']) && h.typ === 'seamless-installation-challenge+jwe' &&
          exact(h.epk, ['kty', 'crv', 'x', 'y']) && h.epk.kty === 'EC' && h.epk.crv === 'P-256' && opened.plaintext.length <= 2048, 'challenge-envelope');
        const inner = JSON.parse(decoder.decode(opened.plaintext));
        insist(exact(inner, ['id', 'releaseId', 'descriptorSha256', 'installationId', 'expiresAt', 'nonce']), 'challenge-payload');
        challengeBinding(inner, expected);
        insist(inner.id === challenge.id && inner.expiresAt === challenge.expiresAt && nonce(inner.nonce), 'challenge-inner-binding');
        proof = inner.nonce;
      } finally { opened.plaintext.fill(0); }
      await unchanged(c, signal); challengeBinding(challenge, expected); requireDescriptor(handle);
      const result = await request(c, path(d.release_id, 'license'), { body: { releaseId: d.release_id, challengeId: challenge.id, installationPublicKey, proof }, maximum: 128_000, signal, json: true });
      proof = undefined;
      insist(exact(result, ['token', 'expiresAt', 'installationId', 'descriptorSha256']) && result.installationId === id && result.descriptorSha256 === handle.sha256 && integer(result.expiresAt), 'license-response');
      const session = await openLicense(result.token, { descriptor: handle, trustedKeys: licenseTrust, installationPrivateKey: installation.privateKey,
        installationPublicKey: installation.publicKey, account: c.accountId, issuer, now, monotonic });
      try {
        insist(session.expiresAt === result.expiresAt * 1000, 'license-response-expiry');
        await unchanged(c, signal);
        if (onVerifiedGrant) await onVerifiedGrant(Object.freeze({ token: result.token, accountId: c.accountId, expiresAt: session.expiresAt }));
        await unchanged(c, signal); leases.add(session);
        return session;
      } catch (error) { closeLicense(session); throw error; }
    },
    close() { closed = true; for (const controller of pending) controller.abort(); for (const lease of leases) closeLicense(lease); leases.clear(); },
  });
}
