// Keyboard control of a replacement clip. While the engine plays a local clip,
// Space/K pause and resume it, the arrows move 5 s within it and M mutes it.
// The listener runs in the capture phase so the player page does not also act on
// the key (which would target the paused native video under the cover). A
// native play (for example from a hardware media key, which bypasses keydown)
// is paused again while the clip plays, except the engine's own: its seek to the
// join briefly plays native, muted and covered, to warm the decoder.
const SEEK_MS = 5000;
const editable = node => Boolean(node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)));

export function installViewerKeys({ window, document, engine, isNativePlayer, ownsNativePlay = () => false, signal }) {
  const handled = new Set();
  const actionFor = event => {
    if (!engine.localControllable || event.ctrlKey || event.metaKey || event.altKey) return null;
    if (editable(event.composedPath?.()[0] ?? event.target)) return null;
    switch (event.key) {
      case ' ': case 'k': case 'K': return event.repeat ? () => {} : () => engine.toggleLocalPause();
      case 'ArrowLeft': return () => engine.seekLocal(-SEEK_MS);
      case 'ArrowRight': return () => engine.seekLocal(SEEK_MS);
      case 'm': case 'M': return event.repeat ? () => {} : () => engine.toggleLocalMute();
      default: return null;
    }
  };
  const swallow = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  window.addEventListener('keydown', event => {
    const action = actionFor(event);
    if (!action) return;
    swallow(event); handled.add(event.code || event.key);
    void Promise.resolve().then(action).catch(() => {});
  }, { capture: true, signal });
  // A focused button activates on keyup; keep the page from acting on a key we took.
  window.addEventListener('keyup', event => {
    if (handled.delete(event.code || event.key)) swallow(event);
  }, { capture: true, signal });
  document.addEventListener('play', event => {
    if (!engine.localControllable || !isNativePlayer(event.target) || ownsNativePlay()) return;
    try { event.target.pause(); } catch {}
  }, { capture: true, signal });
}
