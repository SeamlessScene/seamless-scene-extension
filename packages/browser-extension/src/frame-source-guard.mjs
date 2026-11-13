// 0.65.5 (seen testing 0.65.4, "Reason: relay handshake-timeout"): the private renderer's iframe gained an empty
// srcdoc attribute that this extension never sets. srcdoc wins over src, so the frame showed a blank document, the
// renderer never said hello and the relay closed the pair after 5 s. When the frame's srcdoc appears or its src
// changes, the attribute is removed and the extension's own src put back (removing srcdoc loads src again), a few
// times at most; after that onExhausted runs, so the controller can close with a reason that says what happened.
// Nothing here weakens the handshake: the restored frame still has to prove itself through bind-frame.
export const FRAME_SOURCE_RESTORES = 3;
export function guardFrameSource(frame, src, { MutationObserver: Observer = globalThis.MutationObserver, limit = FRAME_SOURCE_RESTORES, onExhausted } = {}) {
  let restores = 0, observer = null, done = false;
  // A real iframe always has the attribute API; a stand-in without it (unit-test doubles) is left unguarded.
  if (typeof frame?.hasAttribute !== 'function') return { check() {}, disconnect() {}, get restores() { return 0; } };
  const stop = () => { done = true; try { observer?.disconnect(); } catch {} };
  const check = () => {
    if (done || (!frame.hasAttribute('srcdoc') && frame.getAttribute('src') === src)) return;
    if (restores >= limit) { stop(); try { onExhausted?.(); } catch {} return; }
    restores++;
    frame.removeAttribute('srcdoc');
    if (frame.getAttribute('src') !== src) frame.src = src;
  };
  if (typeof Observer === 'function') {
    observer = new Observer(check);
    observer.observe(frame, { attributes: true, attributeFilter: ['srcdoc', 'src'] });
  }
  check();
  return { check, disconnect: stop, get restores() { return restores; } };
}
