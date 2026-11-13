// Local edits (.ss, 0.63.0): importing a file once into the extension's storage, the
// collision rules, removal and the Local tab's rows. Pure logic with injected storage:
// the Local tab passes the viewer store, the OPFS "local" directory and the page's media
// validator; tests pass memory doubles.
import { readSsArchive, ssArchiveMessage } from './ss-archive.mjs';
import { normalizeEditPack, opfsStage, memoryStage } from './ss-normalize.mjs';
import { readinessText } from './edit-pack-fields.mjs';
import { loadFixturePacket } from './fixture-local-packet.mjs';
import { sourceKey } from './viewer-model.mjs';

export const LOCAL_DIRECTORY = 'local';
export const LOCAL_FILE = 'edit.ss';

/** The OPFS directory that holds every stored copy (local/<archive_id>/edit.ss). */
export async function localRoot(storage = globalThis.navigator?.storage) {
  const root = await storage.getDirectory();
  return root.getDirectoryHandle(LOCAL_DIRECTORY, { create: true });
}
/** The stored copy of one local edit, as a File (the renderer plays from its slices). */
export async function openLocalCopy(root, archiveId) {
  if (!/^[a-f0-9]{64}$/.test(archiveId ?? '')) throw Error('viewer-local-invalid');
  try {
    const dir = await root.getDirectoryHandle(archiveId);
    return await (await dir.getFileHandle(LOCAL_FILE)).getFile();
  } catch { throw Error('viewer-local-missing'); }
}

const gtiUrl = id => /^amzn1\.dv\.gti\.[A-Za-z0-9-]{8,64}$/.test(id ?? '') ? `https://www.amazon.com/gp/video/detail/${id}` : null;
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
/**
 * What an edit does, independent of where it came from: the same clips at the same times.
 * A local edit with the same signature as a catalog edit is "also in the catalog".
 */
export async function editSignature(packet, cryptoApi = globalThis.crypto) {
  const segments = (packet?.manifest?.segments ?? []).map(s => [s.action, s.trigger_time_ms, s.resume_time_ms, s.asset?.sha256 ?? null])
    .sort((a, b) => a[1] - b[1] || String(a[3]).localeCompare(String(b[3])));
  const source = packet?.manifest?.source ?? {};
  return hex(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source.service, source.service_content_id, segments]))));
}

/** The index row for an archive (display and matching data only). */
export async function localRow(archive, file, { now = Date.now(), cryptoApi = globalThis.crypto } = {}) {
  const packet = archive.packet, m = packet.manifest, source = m.source;
  const episodeLine = Number.isSafeInteger(source.season) && Number.isSafeInteger(source.episode) ? ` S${source.season} E${source.episode}` : '';
  const fileBase = String(file?.name ?? '').replace(/\.ss$/i, '').slice(0, 120);
  const name = archive.details.title ?? (source.title ? `${source.title}${episodeLine}` : null) ?? fileBase ?? packet.packet_id;
  return {
    archiveId: archive.archiveId, packetId: packet.packet_id, editId: m.edit_id, revision: m.manifest_version, name, baseName: name,
    titleName: archive.details.show_title ?? source.title ?? null, episodeName: archive.details.episode_title ?? null,
    season: Number.isSafeInteger(source.season) ? source.season : null, episode: Number.isSafeInteger(source.episode) ? source.episode : null,
    creatorName: archive.details.creator_name ?? null, fileName: String(file?.name ?? '').slice(0, 200),
    bytes: archive.size, clips: archive.clipCount, scenes: m.segments.length,
    sourceKey: sourceKey({ serviceId: source.service, activeItemId: source.service_content_id, mediaType: source.episode === null ? 'movie' : 'episode',
      season: source.season, episode: source.episode, runtimeMs: source.expected_runtime_ms, versionTag: source.version_tag, territory: source.territory, plan: source.service_tier }),
    runtimeToleranceMs: Number.isSafeInteger(source.runtime_tolerance_ms) ? source.runtime_tolerance_ms : null,
    streamingUrl: gtiUrl(source.service_content_id),
    signature: archive.signature.status === 'verified' ? { status: 'verified', signer: archive.signature.signer, keyId: archive.signature.keyId } : { status: 'unsigned' },
    editSignature: await editSignature(packet, cryptoApi),
    conflict: false, updatedFrom: null, addedAt: now, lastWatchedAt: null
  };
}

const quoted = name => `“${name}”`;
/**
 * 0.64.4 (security review F3): the episode a row plays on (service and content id), or null.
 * "The same edit" is the same packet_id on the same episode; a pack whose id matches an edit
 * for another episode is a separate edit, never a replacement.
 */
export function sourceIdentity(row) {
  try { const parts = JSON.parse(row?.sourceKey ?? ''); return Array.isArray(parts) && typeof parts[0] === 'string' && typeof parts[1] === 'string' && parts[1] ? `${parts[0]}|${parts[1]}` : null; }
  catch { return null; }
}
/** Whether two files have the same bytes (compared in 4 MiB slices, never whole in memory). */
export async function sameBytes(a, b, signal) {
  if (!a || !b || a.size !== b.size) return false;
  for (let at = 0; at < a.size; at += 4_194_304) {
    signal?.throwIfAborted?.();
    const [x, y] = await Promise.all([a.slice(at, at + 4_194_304).arrayBuffer(), b.slice(at, at + 4_194_304).arrayBuffer()]);
    const u = new Uint8Array(x), v = new Uint8Array(y);
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  }
  return true;
}
async function removeCopy(root, archiveId) {
  try { await root.removeEntry(archiveId, { recursive: true }); } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
}

/**
 * Imports one .ss file. Returns { status, message, row?, code? } where status is one of
 * added | updated | conflict | already | older | refused | skipped (collision table).
 */
// 0.64.0 (E70): strict-read refusals that an edit pack (an ordinary zip) produces; such files
// are normalised into a strict .ss first (ss-normalize.mjs). Signature, identity, damage and
// limit refusals stay refusals.
const PACK_ROUTED = new Set(['ss-compressed', 'ss-flags', 'ss-zip64', 'ss-unexpected-entry', 'ss-header-invalid', 'ss-packet-invalid',
  'ss-entry-path', 'ss-clips-mismatch', 'ss-header-mismatch', 'ss-directory']);
export async function importLocalEdit(input, options = {}) {
  const { root, signal, trustedKeys = [], extensionVersion = null, cryptoApi = globalThis.crypto, onProgress = () => {} } = options;
  const progress = (phase, done = 0, total = 0) => { try { onProgress({ phase, done, total }); } catch {} };
  progress('reading');
  let archive = null, file = input, staging = null;
  try {
    if (!/\.zip$/i.test(input?.name ?? '')) {
      try { archive = await readSsArchive(input, { signal, trustedKeys, extensionVersion, cryptoApi }); }
      catch (error) { if (!PACK_ROUTED.has(error?.code)) return { status: 'refused', code: error?.code ?? 'ss-not-archive', message: ssArchiveMessage(error?.code) }; }
    }
    if (!archive) {
      progress('converting');
      staging = options.stage ?? await opfsStage(root, cryptoApi).catch(() => memoryStage());
      try {
        file = (await normalizeEditPack(input, { stage: staging, signal, cryptoApi, onProgress: p => progress('converting', p.done, p.total),
          ...(options.hash ? { hash: options.hash } : {}), ...(options.inspectFormat ? { inspectFormat: options.inspectFormat } : {}) })).file;
        archive = await readSsArchive(file, { signal, trustedKeys, extensionVersion, cryptoApi });
      } catch (error) {
        return { status: 'refused', code: error?.code ?? 'pack-invalid', message: error?.name === 'PackError' ? error.message : ssArchiveMessage(error?.code), ...(error?.errors?.length ? { errors: error.errors } : {}) };
      }
    }
    const result = await importCanonical(file, archive, { ...options, sourceName: input?.name });
    return result;
  } finally {
    if (staging && staging !== options.stage) await staging.cleanup?.().catch?.(() => {});
  }
}
async function importCanonical(file, archive, { store, root, preferences = {}, catalog = [], sourceName = null,
  validate = null, confirmUnverified = async () => true, confirmReplace = async () => true, onProgress = () => {}, signal, now = Date.now(), cryptoApi = globalThis.crypto } = {}) {
  const progress = (phase, done = 0, total = 0) => { try { onProgress({ phase, done, total }); } catch {} };
  const packet = archive.packet, revision = packet.manifest.manifest_version;
  const existing = await store.localEdits();
  // 0.63.3: archive_id covers the declared hashes only, so a file with the same identity is
  // "already added" only when its bytes equal the stored copy. Different bytes (a damaged or
  // altered clip) go through the full clip check, which refuses them.
  const same = existing.find(row => row.archiveId === archive.archiveId);
  let sameIdentity = null;
  if (same) {
    let identical = false;
    try { identical = await sameBytes(file, await openLocalCopy(root, same.archiveId), signal); } catch {}
    if (identical) return { status: 'already', row: same, message: `${quoted(same.name)} is already added.` };
    sameIdentity = same;
  }
  if (archive.signature.status !== 'verified') {
    if (preferences.unverifiedFiles === 'block') return { status: 'refused', code: 'viewer-local-unverified', message: 'Unsigned files are blocked (Local tab settings). It was not added.' };
    if (preferences.unverifiedFiles === 'ask' && !(await confirmUnverified(file.name))) return { status: 'skipped', message: 'Not added.' };
  }
  const row = await localRow(archive, sourceName ? { name: sourceName } : file, { now, cryptoApi });
  // 0.64.0: the description on the row. 0.64.1 (R2): the publication settings still missing.
  if (archive.details.description) row.description = archive.details.description.slice(0, 300);
  row.listingMissing = (archive.details.listingMissing ?? []).map(m => ({ key: m.key, reason: m.reason }));
  const episode = sourceIdentity(row);
  const family = sameIdentity ? [] : existing.filter(r => r.packetId === row.packetId && episode !== null && sourceIdentity(r) === episode);
  const newest = family.reduce((n, r) => Math.max(n, r.revision), -Infinity);
  let status = 'added', replaced = [];
  if (family.length && revision < newest)
    return { status: 'older', message: `You already have a newer revision of ${quoted(family.find(r => r.revision === newest).name)} (revision ${newest}).` };
  if (family.length && revision > newest) {
    status = 'updated'; row.updatedFrom = newest;
    if (preferences.keepBothRevisions !== true) {
      // F3: replacing an edit that came from another file (or was signed) is confirmed first.
      const previous = family.find(r => r.revision === newest);
      const otherFile = family.some(r => r.fileName !== row.fileName || r.signature?.status === 'verified');
      if (otherFile && !(await confirmReplace(previous, row))) return { status: 'skipped', message: `Not added: ${quoted(previous.name)} (revision ${newest}) was kept.` };
      replaced = family;
    }
  } else if (family.length && revision === newest) {
    // Same edit and revision, different content: keep both, and say whose copy this is.
    status = 'conflict'; row.conflict = true;
    const who = row.creatorName && !family.some(r => r.creatorName === row.creatorName) ? row.creatorName : row.fileName.replace(/\.ss$/i, '') || 'copy';
    row.name = `${row.baseName} · ${who}`;
  }
  const catalogTwin = catalog.find(item => item?.editSignature && item.editSignature === row.editSignature);
  if (catalogTwin) row.alsoInCatalog = catalogTwin.id;
  const used = existing.filter(r => !replaced.includes(r)).reduce((n, r) => n + (r.bytes ?? 0), 0);
  const budget = Number.isSafeInteger(preferences.localBudgetBytes) ? preferences.localBudgetBytes : 5_000_000_000;
  if (!sameIdentity && used + file.size > budget)
    return { status: 'refused', code: 'viewer-local-space', message: `Not enough space for local edits (${formatGB(used)} of ${formatGB(budget)} used). Remove a local edit, or allow more space below.` };
  // Check once: every clip's hash, probe and decode, as a byte-range slice of the file.
  try {
    const check = validate ?? ((files, options) => loadFixturePacket(files, null, { expectedService: 'prime-video', ...options }));
    await check(archive.files(), { signal, onProgress: (done, total) => progress('checking', done, total) });
  } catch (error) {
    return { status: 'refused', code: 'viewer-local-check-failed', message: `This edit’s clips did not pass the check, so it was not added. (${String(error?.message ?? 'check failed').slice(0, 160)})` };
  }
  // Same identity, different bytes, and every clip still checks out (e.g. repacked): it is the same edit.
  if (sameIdentity) return { status: 'already', row: sameIdentity, message: `${quoted(sameIdentity.name)} is already added.` };
  progress('copying', 0, file.size);
  try {
    const dir = await root.getDirectoryHandle(row.archiveId, { create: true });
    const handle = await dir.getFileHandle(LOCAL_FILE, { create: true }), writable = await handle.createWritable();
    try {
      if (typeof WritableStream !== 'undefined' && writable instanceof WritableStream && file.stream) await file.stream().pipeTo(writable);
      else { await writable.write(file); await writable.close(); }
    } catch (error) { await writable.abort?.().catch(() => {}); throw error; }
    if ((await handle.getFile()).size !== file.size) throw Error('viewer-local-copy-size');
  } catch (error) {
    await removeCopy(root, row.archiveId).catch(() => {});
    return { status: 'refused', code: 'viewer-local-copy-failed', message: `The edit could not be saved in the extension’s storage (${String(error?.message ?? 'write failed').slice(0, 80)}).` };
  }
  await store.saveLocalEdit(row);
  for (const old of replaced) { await removeCopy(root, old.archiveId).catch(() => {}); await store.removeLocalEdit(old.archiveId); }
  progress('done', file.size, file.size);
  const message = status === 'updated' ? `Updated ${quoted(row.name)} to revision ${revision}.`
    : status === 'conflict' ? `Added ${quoted(row.name)} as a conflicting copy: another file has the same edit and revision with different content.`
      : `Added ${quoted(row.name)}. It shows as “Local: ${row.name}” when you watch ${row.titleName ? `${row.titleName}${row.season !== null ? ` S${row.season} E${row.episode}` : ''}` : 'its episode'}.`;
  return { status, row, message };
}
const formatGB = bytes => `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 0 : 1)} GB`;

/**
 * Removes a local edit: its index row at once (it is no longer offered), and its stored copy.
 * 0.63.3: a copy still open in a Prime tab can refuse deletion; the caller stops the edit
 * there first, and a copy that still cannot go is deleted later (cleanupLocalOrphans).
 */
export async function removeLocalEdit(archiveId, { store, root, attempts = 3, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try { await removeCopy(root, archiveId); lastError = null; break; } catch (error) { lastError = error; if (i + 1 < attempts) await wait(400); }
  }
  await store.removeLocalEdit(archiveId);
  if (lastError) {
    const orphans = await Promise.resolve(store.localOrphans?.()).catch(() => []) ?? [];
    await Promise.resolve(store.localOrphans?.([...orphans, archiveId])).catch(() => {});
    return { deferred: true };
  }
  return { deferred: false };
}
/** Deletes stored copies whose removal had to wait. Returns how many are still waiting. */
export async function cleanupLocalOrphans({ store, root }) {
  const orphans = await Promise.resolve(store.localOrphans?.()).catch(() => []) ?? [];
  if (!orphans.length) return 0;
  const left = [];
  for (const id of orphans) { try { await removeCopy(root, id); } catch { left.push(id); } }
  await Promise.resolve(store.localOrphans?.(left)).catch(() => {});
  return left.length;
}

// The episode a source key names: content id, season, episode (qualifiers and runtime aside).
const episodeOf = key => { try { const p = JSON.parse(key); return Array.isArray(p) && p.length === 9 ? `${p[1]}|${p[3]}|${p[4]}` : null; } catch { return null; } };
/** 0.63.3: a kept website edit for the same episode (both are offered in the player). */
export function websiteTwin(row, library = []) {
  const episode = episodeOf(row?.sourceKey);
  return Boolean(episode) && library.some(item => item?.origin === 'website' && (item.availability === 'downloaded' || item.downloadedAt) && episodeOf(item.sourceKey) === episode);
}

/** The Local tab's rows, shaped like the Library's (name, show, size, last watched, status). */
export function localRows(rows, { library = [] } = {}) {
  return rows.map(row => {
    // 0.65.1: "newer revision" means the same edit, as on import: the same packet_id
    // on the same episode (sourceIdentity). A same-id pack for another episode is a separate edit.
    const episode = sourceIdentity(row);
    const newer = episode !== null && rows.some(r => r !== row && r.packetId === row.packetId && r.revision > row.revision && sourceIdentity(r) === episode);
    const status = row.conflict ? { kind: 'conflict', label: 'Conflicting copy' }
      : newer ? { kind: 'update', label: 'Newer revision available' }
        : row.updatedFrom !== null && row.updatedFrom !== undefined && !(row.lastWatchedAt > row.addedAt) ? { kind: 'ready', label: `Updated to revision ${row.revision}` }
          : row.alsoInCatalog ? { kind: 'ready', label: 'Also in the catalog' }
            : websiteTwin(row, library) ? { kind: 'ready', label: 'Also downloaded from the website' }
            // 0.63.4: neutral wording; unsigned files are allowed by design (owner decision 2).
            : row.signature?.status === 'verified' ? { kind: 'ready', label: 'Signed' } : { kind: 'unsigned', label: 'Unsigned' };
    return { archiveId: row.archiveId, name: row.name, titleName: row.titleName, episodeName: row.season !== null && row.season !== undefined ? `S${row.season} E${row.episode}` : row.episodeName,
      streamingUrl: row.streamingUrl, bytes: row.bytes, lastWatchedAt: row.lastWatchedAt ?? null, status, actions: ['watch', 'export', 'remove'],
      ...(row.description ? { description: row.description } : {}),
      ...(Array.isArray(row.listingMissing) && row.listingMissing.length ? { readiness: readinessText(row.listingMissing) } : {}) };
  }).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0) || a.name.localeCompare(b.name));
}

/** "Using 1.2 GB of 5 GB for local edits". */
export function localSpaceSummary(rows, budgetBytes) {
  const used = rows.reduce((n, r) => n + (r.bytes ?? 0), 0);
  return { used, budgetBytes, label: `Using ${formatGB(used)} of ${formatGB(budgetBytes)} for local edits` };
}

/** The export file name from the plan: "<show> S01E04 - <edit>.ss", safe on every platform. */
export function localExportName(row) {
  const clean = value => String(value ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 100);
  const pad = n => String(n).padStart(2, '0');
  const show = clean(row?.titleName), edit = clean(row?.baseName ?? row?.name) || 'Local edit';
  const episode = Number.isSafeInteger(row?.season) && Number.isSafeInteger(row?.episode) ? ` S${pad(row.season)}E${pad(row.episode)}` : '';
  return `${show ? `${show}${episode} - ` : ''}${edit}.ss`;
}

/**
 * Export (0.63.1): saves a local edit's stored copy as a .ss file, unchanged. Only local
 * edits can be exported: the id must be a local archive_id that is in the local index, and
 * the copy is read from the "local" directory only. Catalog, protected and cloud edits live
 * elsewhere (the encrypted vault) and no path here reaches them.
 */
export async function exportLocalEdit(archiveId, { store, root, save, trustedKeys = [], cryptoApi = globalThis.crypto }) {
  if (!/^[a-f0-9]{64}$/.test(archiveId ?? '')) throw Error('viewer-local-invalid');
  const row = (await store.localEdits()).find(r => r.archiveId === archiveId);
  if (!row) throw Error('viewer-local-missing');
  const file = await openLocalCopy(root, archiveId);
  // The copy is checked again (structure, identity, signature) before it leaves.
  let archive;
  try { archive = await readSsArchive(file, { trustedKeys, cryptoApi }); } catch { throw Error('viewer-local-invalid'); }
  if (archive.archiveId !== archiveId) throw Error('viewer-local-invalid');
  const name = localExportName(row);
  await save(file, name);
  return { name, bytes: file.size, message: `Saved “${name}”.` };
}
