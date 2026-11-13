// Library metadata recovery for protected releases that were downloaded without
// being opened (Update, Watch, next-episode prefetch). The website's release
// status can describe an exact release (`display`), but that description is a
// display/discovery hint only: it names the release, locates its title and
// supplies the source key its signed manifest declares. It never proves that
// the release is kept, entitled or compatible. A new library row therefore
// needs separate evidence that this device keeps the release: an entry of the
// protected vault listing or the authenticated renderer's ready receipt.
// Opening, arming, source and license checks stay with the signed packet.
import { sourceIdentity } from './catalog-discovery.mjs';
import { primeStreamingUrl } from './viewer-model.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** The status endpoint accepts at most this many release IDs per request. */
export const STATUS_BATCH = 50;
/** Bound on IDs one recovery pass may ask about (the library holds at most 256 rows). */
export const RECOVERY_LIMIT = 256;
export const isReleaseId = value => typeof value === 'string' && UUID.test(value);

// Re-check a parsed display hint (catalog-discovery releaseDisplay output) after
// it crosses a message or storage boundary. Only the bounded projection survives.
export function displayHint(value) {
  if (!value || typeof value !== 'object' || !isReleaseId(value.editId)) return null;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return null;
  if (!Number.isSafeInteger(value.releaseVersion) || value.releaseVersion < 1 || value.releaseVersion > 2147483647) return null;
  if (typeof value.sourceKey !== 'string' || value.sourceKey.length > 2048) return null;
  let parts;
  try { parts = JSON.parse(value.sourceKey); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 9 || JSON.stringify(parts) !== value.sourceKey || parts[0] !== 'prime-video') return null;
  const identity = sourceIdentity(value.sourceKey);
  if (!identity || identity.runtimeMs === null) return null;
  const out = { editId: value.editId, name: value.name, releaseVersion: value.releaseVersion, sourceKey: value.sourceKey };
  // Display only (website r30): the release's position in its edit, shown as "v4".
  if (Number.isSafeInteger(value.displayVersion) && value.displayVersion >= 1 && value.displayVersion <= 2147483647) out.displayVersion = value.displayVersion;
  for (const [key, max] of [['creatorName', 120], ['titleName', 200], ['episodeName', 200]])
    if (typeof value[key] === 'string' && value[key].length <= max) out[key] = value[key];
  const url = primeStreamingUrl(value.streamingUrl);
  if (url) out.streamingUrl = url;
  return out;
}

/** Whether a website library row still lacks the details a kept edit needs to be named, matched and watched. */
export function needsMetadata(row) {
  // displayVersion (website r30) too, so kept rows learn their "v4"; older servers never send it,
  // which costs one throttled status request per release, as for any other missing detail.
  return !row || !row.name || !row.sourceKey || !row.version || !row.streamingUrl || !Number.isSafeInteger(row.displayVersion);
}

/** Release IDs of usable vault entries (a damaged entry is not evidence of a kept release). */
export function keptIds(vault) {
  return new Set((Array.isArray(vault) ? vault : [])
    .filter(entry => isReleaseId(entry?.releaseId) && !entry.problem)
    .map(entry => entry.releaseId));
}

/** Kept releases whose library row is missing or incomplete, in vault order. */
export function metadataGaps(library, vault) {
  const rows = new Map((library ?? []).filter(x => x?.origin === 'website').map(x => [x.id, x]));
  return [...keptIds(vault)].filter(id => needsMetadata(rows.get(id))).slice(0, RECOVERY_LIMIT);
}

/** Distinct valid release IDs, bounded, first occurrence first. */
export function distinctIds(ids, limit = RECOVERY_LIMIT) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(isReleaseId))].slice(0, limit);
}

export function batches(ids, size = STATUS_BATCH) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Status items joined to evidence of what this device keeps. Each entry carries
 * the exact-release hint and `kept: true` only when `isKept` confirms that very
 * release ID. Items without a valid hint, and IDs answered more than once with
 * different hints, are dropped: an ambiguous description names nothing.
 */
export function recoveryEntries(items, isKept = () => false) {
  const seen = new Map(), conflicted = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!isReleaseId(item?.releaseId)) continue;
    const hint = displayHint(item.display);
    if (!hint) continue;
    const prior = seen.get(item.releaseId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(hint)) conflicted.add(item.releaseId);
    else seen.set(item.releaseId, hint);
  }
  return [...seen].filter(([releaseId]) => !conflicted.has(releaseId)).slice(0, RECOVERY_LIMIT)
    .map(([releaseId, display]) => ({ releaseId, display, kept: isKept(releaseId) === true }));
}
