import { ManifestActionExecutor as Executor } from "./manifest-action-executor.mjs";
import { ManifestActionScheduler as Scheduler } from "./manifest-action-scheduler.mjs";
import { createGuardedExecutor as guard } from "./playback-session.mjs";
import { withCatalogActivity as catalogActivity } from "./catalog-activity-executor.mjs";
import { compileLocalUserEditActions as compileLocal } from "./local-edit-packet.mjs";

// Arms and clears the Prime controller's loaded packet. `state` holds the loaded session,
// its armed scheduler and an arm in progress; main.mjs owns the UI nodes and collaborators.
// Tests import this module and pass doubles.
// 0.65.9 (eventLog, developer-mode engine event export): the scheduler's own events, source checks
// and catalog-activity round trips are also timed there. Without it nothing changes.
export function createPacketSessionController({ state, operations, journal, ui, engine, adapter, overlay, commandAdapter, assertSource, eventLog = null, deps = {} }) {
  const { ManifestActionExecutor = Executor, ManifestActionScheduler = Scheduler, createGuardedExecutor = guard,
    withCatalogActivity = catalogActivity, compileLocalUserEditActions = compileLocal } = deps;
  const { armButton, cancelButton, navigation, navigationList, navigationOutput, packetOutput, panelHost } = ui;
  const clear = async (reason = "local-packet-replaced") => {
    operations.invalidate(reason);
    const cleanup = operations.capture();
    const oldScheduler = state.scheduler, oldSession = state.session;
    state.scheduler = null;
    state.session = null;
    packetOutput.textContent = reason === "viewer-user-stopped"
      ? "Edit stopped. Select an edit to enable replacements again."
      : "No edit armed.";
    armButton.disabled = true;
    cancelButton.disabled = true;
    navigation.hidden = true;
    navigationList.replaceChildren();
    navigationOutput.textContent = "Choose an altered portion to seek before its trigger.";
    delete panelHost.dataset.localPacketStatus;
    delete panelHost.dataset.localPacketId;
    delete panelHost.dataset.localPacketSegmentCount;
    delete panelHost.dataset.localPacketQualityStatus;
    await oldScheduler?.cancelAll(reason).catch(error => { throw error; });
    // 0.65.7: the run records which caller cleared it (log only), and so does the timing export.
    oldSession?.evidenceRun?.close('cleared', oldScheduler?.observerFailures, reason);
    try { engine?.noteCleared?.(reason); } catch {}
    if (!cleanup.signal.aborted && reason !== 'new-folder-selected') await overlay?.clear().catch(error => { throw error; });
  };

  const arm = async () => {
    if (!state.session || state.scheduler || state.arming) throw Error("viewer-not-ready");
    const operation = operations.capture();
    const session = state.session;
    const evidenceRun = journal.beginRun(session.packet.manifest.segments.map(segment => ({ id: segment.segment_id, type: segment.action })), session.trust === 'catalog' ? 'catalog-v2' : 'local-user');
    session.evidenceRun = evidenceRun; state.arming = evidenceRun;
    let evidencePhase = 'source-check';
    let ownedScheduler = null;
    armButton.disabled = true;
    packetOutput.textContent = "Matching the open Prime item…";
    try {
      const sourceCheck = await assertSource(session.packet, operation);
      operation.assertCurrent();
      evidencePhase = 'compile';
      const baseExecutor = new ManifestActionExecutor({
        transitionEngine: engine,
        adapter: adapter,
        evidenceRun
      });
      const packet = session.packet;
      const record = eventLog ? (name, detail) => { try { eventLog.record('scheduler', name, detail); } catch {} } : null;
      const activityExecutor = session.trust === 'catalog' ? (record ? withCatalogActivity(baseExecutor, overlay, { onEvent: record, enabled: () => eventLog.enabled === true }) : withCatalogActivity(baseExecutor, overlay)) : baseExecutor;
      // The guarded executor (a protected-bundle input) is unchanged: its source check is timed here,
      // around the same promise it awaits.
      const checkPacketSource = !record ? operation => assertSource(packet, operation) : operation => {
        if (eventLog.enabled !== true) return assertSource(packet, operation);
        record('source-check-start', {});
        const checking = Promise.resolve(assertSource(packet, operation));
        checking.then(() => record('source-check-end', { result: 'passed' }), error => record('source-check-end', { result: error?.name === 'AbortError' ? 'aborted' : 'failed' }));
        return checking;
      };
      const guardedExecutor = createGuardedExecutor(activityExecutor, checkPacketSource);
      const onSchedulerEvent = record ? event => { if (eventLog.enabled === true) record(`scheduler-${event?.outcome}`, { actionId: event?.actionId, type: event?.type, reason: event?.reason }); return evidenceRun.onSchedulerEvent(event); } : evidenceRun.onSchedulerEvent;
      const actions = session.trust === 'catalog' ? sourceCheck.catalogActions : compileLocalUserEditActions(session.packet, {
        resolveAssetUrl: (hash) => session.assetUrls.get(hash)
      });
      evidencePhase = 'scheduler-arm';
      // Scenes starting within 50 ms (about a frame) of the previous join play inside one cover.
      ownedScheduler = new ManifestActionScheduler({ actions, executor: guardedExecutor, chainGapMs: 50, enterReplacedOnSeek: true, onEvent: onSchedulerEvent });
      state.scheduler = ownedScheduler;
      const playback = commandAdapter.readState();
      await ownedScheduler.observe({ currentTimeMs: playback.currentTimeMs, paused: playback.paused, event: "seek" });
      operation.assertCurrent();
      evidenceRun.armed();
      panelHost.dataset.localPacketStatus = "armed";
      cancelButton.disabled = false;
      packetOutput.textContent = `Armed ${actions.length} actions. Seek before a trigger, then play normally.`;
    } catch (error) {
      // A partially armed scheduler may already own a preload. Drain only
      // that scheduler before closing its evidence or permitting another arm.
      if (state.scheduler === ownedScheduler) state.scheduler = null;
      await ownedScheduler?.cancelAll('packet-arm-failed').catch(() => {});
      evidenceRun.refuse(evidencePhase, operation.signal.aborted, ownedScheduler?.observerFailures);
      if (operation.signal.aborted) throw error;
      armButton.disabled = false;
      packetOutput.textContent = `Could not arm: ${error.message}`;
      throw error;
    } finally {
      if (state.arming === evidenceRun) state.arming = null;
    }
  };

  const invalidateCatalog = async ({ isCurrent = () => true } = {}) => {
    if (!isCurrent()) return;
    const cleanup = clear('catalog-state-changed');
    const operation = operations.capture();
    const current = () => isCurrent() && !operation.signal.aborted;
    try { await cleanup; }
    catch (error) { if (current()) throw error; return; }
    // Clear restores the old edit asynchronously. A replacement connection or
    // packet owns its own status even if this old restoration finishes later.
    if (current()) packetOutput.textContent = 'Catalog permissions or version changed. Reimport an eligible packet before arming.';
  };

  return { clear, arm, invalidateCatalog };
}
