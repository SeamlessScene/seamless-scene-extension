export function abortError(reason = "Operation cancelled") {
  return new DOMException(reason, "AbortError");
}

export function assertActive(signal) {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

// Settles the caller, consumes late rejection, and never runs a continuation
// after abort. Mutating callers must also check their context before each write.
export function boundedOperation(operation, { signal, timeoutMs = 5000, label = "operation" } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(signal.reason ?? abortError());
    const timer = setTimeout(() => finish(new Error(`${label}-timeout`)), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => { assertActive(signal); return operation(); }).then(
      value => finish(null, value), error => finish(error)
    );
  });
}

export class OperationContext {
  constructor() { this.generation = 0; this.controller = new AbortController(); }
  capture() {
    const generation = this.generation, signal = this.controller.signal;
    return Object.freeze({ generation, signal, assertCurrent: () => {
      assertActive(signal);
      if (this.generation !== generation) throw abortError("Stale operation");
    } });
  }
  invalidate(reason = "Session changed") {
    this.controller.abort(abortError(reason));
    this.generation += 1;
    this.controller = new AbortController();
  }
}
