// Local diagnostic metadata only. No identifiers, messages, paths or binding secrets.
const reasons = Object.freeze({
  renderer: ['lease-expired', 'pagehide', 'port-closed', 'send-failed', 'handshake-rejected', 'command-rejected', 'request-budget'],
  relay: ['handshake-timeout', 'handshake-rejected', 'message-rejected', 'sequence-rejected', 'request-budget', 'request-timeout', 'result-rejected', 'send-failed'],
  controller: ['port-closed', 'frame-owner-lost', 'handshake-rejected', 'message-rejected', 'import-sequence-rejected', 'result-rejected', 'send-failed', 'disposed', 'reconnect-failed', 'frame-source-replaced']
});
export function validDisconnectNotice(value, component) {
  try {
  if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields);
  if (keys.some(key => typeof key !== 'string') || keys.sort().join(',') !== 'component,leaseAgeMs,reason,type,visibility' ||
      Object.values(fields).some(field => !Object.hasOwn(field, 'value'))) return false;
  return value.type === 'disconnect-notice' && typeof value.component === 'string' && typeof value.reason === 'string' && (!component || value.component === component) &&
    Object.hasOwn(reasons, value.component) && reasons[value.component].includes(value.reason) &&
    (value.leaseAgeMs === null || Number.isSafeInteger(value.leaseAgeMs) && value.leaseAgeMs >= 0 && value.leaseAgeMs <= 3_600_000) &&
    ['visible', 'hidden', 'unknown'].includes(value.visibility);
  } catch { return false; }
}
export function disconnectNotice(component, reason, { leaseAgeMs = null, visibility = 'unknown' } = {}) {
  const value = { type: 'disconnect-notice', component, reason,
    leaseAgeMs: Number.isFinite(leaseAgeMs) && leaseAgeMs >= 0 ? Math.min(3_600_000, Math.round(leaseAgeMs)) : null,
    visibility: ['visible', 'hidden'].includes(visibility) ? visibility : 'unknown' };
  if (!validDisconnectNotice(value)) throw Error('connection-diagnostic-invalid');
  return value;
}
export class ConnectionDiagnostics {
  constructor({ now = () => performance.now() } = {}) { this.now = now; this.startedAt = now(); this.sequence = 0; this.dropped = 0; this.events = []; }
  record(notice) {
    if (!validDisconnectNotice(notice)) return;
    const elapsed = this.now() - this.startedAt;
    this.events.push({ sequence: ++this.sequence, elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null,
      component: notice.component, reason: notice.reason, leaseAgeMs: notice.leaseAgeMs, visibility: notice.visibility });
    if (this.events.length > 16) { this.events.shift(); this.dropped++; }
  }
  snapshot() { return { schema: 1, dropped: this.dropped, events: this.events.map(row => ({ ...row })) }; }
}
export function safeConnectionReport(value) {
  try {
    const plain = row => row && typeof row === 'object' && Object.getPrototypeOf(row) === Object.prototype;
    const exact = (row, keys) => plain(row) && Reflect.ownKeys(row).every(key => typeof key === 'string') &&
      Reflect.ownKeys(row).sort().join(',') === keys.split(',').sort().join(',') &&
      Object.values(Object.getOwnPropertyDescriptors(row)).every(field => Object.hasOwn(field, 'value'));
    const count = number => Number.isSafeInteger(number) && number >= 0;
    if (!exact(value, 'schema,dropped,events,state') || value.schema !== 1 || !count(value.dropped) ||
        !['disposed', 'disconnected', 'connecting', 'connected', 'unavailable'].includes(value.state) ||
        !Array.isArray(value.events) || value.events.length > 16) return null;
    let sequence = value.dropped;
    const events = [];
    for (const row of value.events) {
      if (!exact(row, 'sequence,elapsedMs,component,reason,leaseAgeMs,visibility') || !count(row.sequence) || row.sequence !== ++sequence ||
          !(row.elapsedMs === null || count(row.elapsedMs)) || !validDisconnectNotice({ type: 'disconnect-notice', component: row.component,
            reason: row.reason, leaseAgeMs: row.leaseAgeMs, visibility: row.visibility })) return null;
      events.push({ sequence: row.sequence, elapsedMs: row.elapsedMs, component: row.component, reason: row.reason, leaseAgeMs: row.leaseAgeMs, visibility: row.visibility });
    }
    return { schema: 1, state: value.state, dropped: value.dropped, events };
  } catch { return null; }
}
/**
 * 0.65.4: the recorded reason a lost private renderer gives, for the panel and its
 * data-renderer-reason attribute, e.g. "relay handshake-timeout" or, when the reconnect attempts
 * ended differently, "relay handshake-timeout; last attempt: controller reconnect-failed".
 * Component and reason codes only (both from the fixed lists above); null without a valid event.
 */
export function disconnectSummary(cause, last = null) {
  const words = event => event && validDisconnectNotice({ type: 'disconnect-notice', component: event.component, reason: event.reason,
    leaseAgeMs: event.leaseAgeMs ?? null, visibility: event.visibility ?? 'unknown' }) ? `${event.component} ${event.reason}` : null;
  const first = words(cause), final = words(last);
  if (!first) return final;
  return final && final !== first ? `${first}; last attempt: ${final}` : first;
}
