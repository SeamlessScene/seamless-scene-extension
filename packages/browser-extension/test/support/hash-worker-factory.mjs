import { Worker } from 'node:worker_threads';

// Runs the actual browser-worker entry/core/vendor modules in a Node worker.
// Only the Worker event API is adapted; this is not Chrome origin/CSP evidence.
export function nodeHashWorker({ moduleURL } = {}) {
  const worker = new Worker(new URL('./hash-worker-bridge.mjs', import.meta.url), { workerData: { moduleURL } });
  const listeners = new Map();
  return {
    postMessage: message => worker.postMessage(message),
    terminate: () => { void worker.terminate(); },
    addEventListener(name, listener) {
      const wrapper = name === 'message' ? data => listener({ data }) : listener;
      listeners.set(listener, wrapper); worker.on(name, wrapper);
    },
    removeEventListener(name, listener) {
      const wrapper = listeners.get(listener); if (wrapper) worker.off(name, wrapper);
    }
  };
}
