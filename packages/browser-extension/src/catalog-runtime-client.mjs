import { boundedOperation } from './operation-context.mjs';
import { catalogObservedSource } from './catalog-runtime-service.mjs';
import { EXECUTING_BUILD } from './build-info.mjs';
import { sameExecutingBuild } from './build-identity.mjs';

export function createCatalogRuntimeClient(runtime) {
  const request = async (method, fields = {}, signal) => {
    const requestId = crypto.randomUUID();
    let dispatched = false;
    let response;
    try {
      response = await boundedOperation(() => {
        dispatched = true;
        return runtime.sendMessage({ kind: 'catalog-v2', method, requestId, ...fields, build: EXECUTING_BUILD });
      }, { signal, timeoutMs: 8000, label: 'catalog-service' });
    } catch (error) {
      if (dispatched && (signal?.aborted || error?.message === 'catalog-service-timeout')) {
        // Best effort only: the worker has its own deadline if this message is
        // lost. No File, packet, source or caller-supplied authority is repeated.
        try { void Promise.resolve(runtime.sendMessage({ kind: 'catalog-v2', method: 'cancel', requestId, build: EXECUTING_BUILD })).catch(() => {}); } catch {}
      }
      throw error;
    }
    if (!response?.ok) throw Error(response?.code ?? 'catalog-service-unavailable');
    if (!sameExecutingBuild(response.build)) throw Error('catalog-mixed-client-build');
    return response.value;
  };
  return {
    refresh: (playbackEditId, {signal} = {}) => request('refresh', {playbackEditId}, signal),
    readPolicy: ({ signal } = {}) => request('policy', {}, signal),
    accept: (packet, { signal } = {}) => request('accept', { packet }, signal),
    compile: (packet, { observedSource, signal } = {}) => request('compile', { packet, observedSource: catalogObservedSource(observedSource) }, signal)
  };
}
