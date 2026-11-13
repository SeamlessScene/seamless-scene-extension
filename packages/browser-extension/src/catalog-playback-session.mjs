import { loadCatalogPacket } from './catalog-file-import.mjs';
import { OperationContext, assertActive } from './operation-context.mjs';
import { catalogRecordDigest } from './catalog-activation-store.mjs';

/** Owns a single explicit catalog import inside the extension origin. Policy is
 * supplied by trusted extension configuration, never a packet or page message.
 * The caller cancels/restores its scheduler before replacing or clearing files.
 */
export class CatalogPlaybackSession {
  constructor({ activationStore, readPolicy, expectedService, validateAsset, createObjectURL = file => URL.createObjectURL(file),
    revokeObjectURL = url => URL.revokeObjectURL(url), prepareFiles = async files => files }) {
    if (!activationStore?.accept || !activationStore?.compile || typeof readPolicy !== 'function' ||
      typeof expectedService !== 'string' || !expectedService) throw Error('catalog-session-configuration-invalid');
    this.store = activationStore; this.readPolicy = readPolicy; this.expectedService = expectedService;
    this.validateAsset = validateAsset; this.createObjectURL = createObjectURL; this.revokeObjectURL = revokeObjectURL;
    this.prepareFiles = prepareFiles;
    this.operations = new OperationContext(); this.current = null;
  }

  clear() {
    this.operations.invalidate('catalog-import-cleared');
    if (this.current) for (const url of this.current.urls.values()) this.revokeObjectURL(url);
    this.current = null;
    // Version floors and signed disables deliberately survive unlink/cancel.
  }

  async importFiles(files, { signal: callerSignal, onProgress } = {}) {
    assertActive(callerSignal);
    this.clear();
    const operation = this.operations.capture(), urls = new Map();
    const signal = callerSignal ? AbortSignal.any([operation.signal, callerSignal]) : operation.signal;
    const assertCurrent = () => { assertActive(signal); operation.assertCurrent(); };
    try {
      const policy = await this.readPolicy({ signal }); assertCurrent();
      const loaded = await loadCatalogPacket(files, policy.trustedKeys, { capabilities: policy.capabilities,
        expectedService: this.expectedService, signal, validateAsset: this.validateAsset, onAssetChecked: onProgress });
      assertCurrent();
      // Re-read policy after hashing/decoding; keys may have changed meanwhile.
      const latest = await this.readPolicy({ signal }); assertCurrent();
      const activation = await this.store.accept(loaded.packet, { ...latest, signal });
      assertCurrent();
      if (activation.status === 'disabled') throw Error('catalog-playback-disabled');
      if (!/^[a-f0-9]{64}$/.test(activation.storageRevisionDigest ?? '')) throw Error('catalog-storage-revision-required');
      const playable = await this.prepareFiles(loaded.files, { signal }); assertCurrent();
      for (const [hash, file] of playable) urls.set(hash, this.createObjectURL(file));
      this.current = { packet: structuredClone(loaded.packet), urls, storageRevisionDigest: activation.storageRevisionDigest };
      // Public summary contains no bindings, relative names, file objects,
      // URLs, signatures, account data or policy configuration.
      return Object.freeze({ releaseId: loaded.packet.packet_id, playbackEditId: loaded.packet.manifest.edit_id,
        version: loaded.packet.manifest.manifest_version, actionCount: loaded.packet.manifest.segments.length, assetCount: urls.size });
    } catch (error) {
      for (const url of urls.values()) this.revokeObjectURL(url);
      throw error;
    }
  }

  async actions(observedSource, { signal: callerSignal } = {}) {
    assertActive(callerSignal);
    const operation = this.operations.capture(), current = this.current;
    const signal = callerSignal ? AbortSignal.any([operation.signal, callerSignal]) : operation.signal;
    const assertCurrent = () => { assertActive(signal); operation.assertCurrent(); };
    if (!current) throw Error('catalog-import-required');
    const policy = await this.readPolicy({ signal }); assertCurrent();
    const actions = await this.store.compile(current.packet, { ...policy, observedSource, signal,
      resolveAssetUrl: hash => current.urls.has(hash) ? `asset:${hash}` : null });
    assertCurrent();
    return actions;
  }

  description() {
    if (!this.current) throw Error('catalog-import-required');
    // The signed manifest contains public instructions but no binding names.
    // It is display input only; actions() remains the authorization boundary.
    return structuredClone({ packet_id: this.current.packet.packet_id, manifest: this.current.packet.manifest });
  }

  async storageChangeRequiresInvalidation(record) {
    const current = this.current;
    if (!current) return false;
    let revision = null;
    try { revision = await catalogRecordDigest(record); } catch {}
    // Chrome may deliver this import's own storage event after its RPC response.
    // Ignore only the exact read-back record authenticated by the worker. A
    // disable, replacement, deletion or any cache mutation still cancels.
    return this.current === current && revision !== current.storageRevisionDigest;
  }

  // Only the private renderer may resolve an opaque scheduler reference.
  resolveAsset(reference) {
    if (typeof reference !== 'string' || !/^asset:[a-f0-9]{64}$/.test(reference)) throw Error('catalog-asset-reference-invalid');
    const url = this.current?.urls.get(reference.slice(6));
    if (!url) throw Error('catalog-local-asset-unresolved');
    return url;
  }
}
