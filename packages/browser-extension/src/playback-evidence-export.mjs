import { createPrimePlaybackEvidence as createEvidence } from './packet-playback-evidence.mjs';

// The Prime panel's evidence export and manual-trial clear buttons. main.mjs passes its
// panel nodes and recorders; tests import this module with doubles.
export function installEvidenceExport({ shadow, panelHost, commandOutput, updateTrialSummary, trials, metrics, getScheduler, journal, spikeBuild, readTimingReport, readEngineEvents,
  document = globalThis.document, URL = globalThis.URL, Blob = globalThis.Blob, setTimeout = globalThis.setTimeout.bind(globalThis),
  createPrimePlaybackEvidence = createEvidence }) {
  const exportPlaybackEvidence = () => {
    const evidence = createPrimePlaybackEvidence({ trials, metrics, scheduler: getScheduler(), journal });
    const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `prime-playback-evidence-v${spikeBuild}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  shadow.querySelector('[data-action="export-trials"]').addEventListener('click', exportPlaybackEvidence);
  const packetEvidenceButton = shadow.querySelector('[data-action="export-packet-evidence"]');
  packetEvidenceButton.disabled = false;
  packetEvidenceButton.addEventListener('click', exportPlaybackEvidence);

  // Keep Prime foreground while collecting detailed timing. Switching to Settings
  // changes the document visibility and can itself suppress frame callbacks.
  const timingButton = shadow.querySelector('[data-action="export-scene-timing"]');
  if (timingButton && typeof readTimingReport === 'function') {
    timingButton.disabled = false;
    timingButton.addEventListener('click', async () => {
      if (timingButton.disabled) return;
      timingButton.disabled = true;
      let url = null;
      try {
        const report = await readTimingReport();
        if (!report?.transitionCount) {
          commandOutput.textContent = 'No scenes recorded yet. Enable Record scene timing in Advanced Settings, then play through a scene.';
          return;
        }
        url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `scene-timing-${report.recordedAt.replace(/[:.]/g, '-')}.json`;
        anchor.click();
        commandOutput.textContent = `${report.transitionCount} scene${report.transitionCount === 1 ? '' : 's'} recorded. Report saved to Downloads.`;
      } catch {
        commandOutput.textContent = 'Scene timing could not be saved. Try again.';
      } finally {
        if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000); }
        timingButton.disabled = false;
      }
    });
  }

  // 0.65.9: the developer-mode engine event log (engine-event-log.mjs).
  const engineButton = shadow.querySelector('[data-action="export-engine-events"]');
  if (engineButton && typeof readEngineEvents === 'function') {
    engineButton.disabled = false;
    engineButton.addEventListener('click', () => {
      if (engineButton.disabled) return;
      engineButton.disabled = true;
      let url = null;
      try {
        let report;
        try { report = readEngineEvents(); } catch {
          commandOutput.textContent = 'The engine event log is recorded only in developer mode. Turn on Settings → Advanced, play through the scenes, then save.';
          return;
        }
        url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `engine-events-${String(report.recordedAt).replace(/[:.]/g, '-')}.json`;
        anchor.click();
        const count = report.engineEvents.length + report.schedulerEvents.length + report.syncMarks.length;
        commandOutput.textContent = `${count} engine event${count === 1 ? '' : 's'} saved to Downloads.`;
      } catch {
        commandOutput.textContent = 'The engine event log could not be saved. Try again.';
      } finally {
        if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000); }
        engineButton.disabled = false;
      }
    });
  }

  shadow.querySelector('[data-action="clear-trials"]').addEventListener("click", () => {
    trials.clear();
    delete panelHost.dataset.lastTrialSequence;
    delete panelHost.dataset.lastTrialOutcome;
    delete panelHost.dataset.lastTrialErrorCode;
    updateTrialSummary();
    commandOutput.textContent = "Manual trial evidence cleared. Automatic packet history and timing remain available until this page is refreshed.";
  });

  updateTrialSummary();
}
