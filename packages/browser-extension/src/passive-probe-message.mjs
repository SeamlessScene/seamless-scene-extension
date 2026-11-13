import { EXECUTING_BUILD } from './build-info.mjs';
import { sameExecutingBuild } from './build-identity.mjs';

export function createPassiveProbeMessageHandler({ refresh, serialize }) {
  return (message, _sender, sendResponse) => {
    if (message?.kind !== 'passive-probe-read') return;
    if (!sameExecutingBuild(message.build)) {
      sendResponse({ ok: false, build: EXECUTING_BUILD, errorCode: 'authoring-build-mismatch-refresh-required' });
      return;
    }
    void Promise.resolve().then(refresh)
      .then(() => sendResponse({ ok: true, build: EXECUTING_BUILD, probe: serialize() }))
      .catch(error => sendResponse({
        ok: false, build: EXECUTING_BUILD,
        errorCode: String(error?.message ?? 'passive-probe-refresh-failed').slice(0, 160)
      }));
    return true;
  };
}
