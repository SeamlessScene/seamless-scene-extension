// Library → Remove with Undo (0.63.2). The kept files are deleted when the Undo window
// closes. Until 0.63.1 the window lived only in the page: closing Settings inside it ran
// the removal during page unload, where its asynchronous vault work never finished (the
// service answered viewer-no-owner with no Prime tab open, and the page's own fallback was
// cut off), so the edit came back. The pending removal is now stored first and finished
// by the next Settings visit, and the vault is reached directly when no player owns it.
export const UNDO_MS = 30_000;

export function createLibraryRemoval({ store, removeFromVault, undoMs = UNDO_MS, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  const timers = new Map();
  async function commit(releaseId) {
    clearTimer(timers.get(releaseId)); timers.delete(releaseId);
    await removeFromVault(releaseId);
    await store.remove(releaseId, 'website');
    await store.setPendingRemoval(releaseId, null);
  }
  return {
    /** Hides the row now; the files go when the window closes (or on the next visit). */
    async schedule(releaseId, onDone = () => {}) {
      await store.setPendingRemoval(releaseId, now());
      timers.set(releaseId, setTimer(() => { void commit(releaseId).then(() => onDone(null), error => onDone(error)); }, undoMs));
    },
    async undo(releaseId) {
      clearTimer(timers.get(releaseId)); timers.delete(releaseId);
      await store.setPendingRemoval(releaseId, null);
    },
    commit,
    /** Removals whose window closed with the page: finish them now. Returns the failures. */
    async resume() {
      const failures = [];
      for (const pending of await store.pendingRemovals()) {
        if (timers.has(pending.releaseId)) continue;
        try { await commit(pending.releaseId); } catch (error) { failures.push({ releaseId: pending.releaseId, error }); }
      }
      return failures;
    },
    async pendingIds() { return new Set((await store.pendingRemovals()).map(r => r.releaseId)); }
  };
}

/**
 * Removes a kept release's files: through the player tab that holds them, else directly
 * through the vault manager (no Prime tab needed); a busy owner says so.
 */
export function vaultRemover({ viewerRequest, openManager }) {
  let manager = null;
  return async releaseId => {
    try { await viewerRequest('edits-remove', { releaseId }); return; }
    catch (error) { if (!['viewer-no-owner', 'viewer-renderer-unavailable'].includes(error?.message)) throw error; }
    manager ??= await openManager();
    if (!manager) throw Error('protected-owner-busy');
    await manager.remove(releaseId);
  };
}
