import { moveConnectedNode } from './private-local-overlay.mjs';

// Own only the overlay and the exact positioning style we applied. The native
// video is never reparented or sampled for pixels.
export class PresentationHost {
  constructor({ document, getPlayer, onError = () => {} }) {
    this.document = document; this.getPlayer = getPlayer; this.onError = onError;
    this.host = null; this.listeners = []; this.position = null; this.frame = null;
  }
  mount() {
    const host = this.document.createElement('div'); this.host = host;
    host.id = 'scene-substitution-local-overlay-host';
    Object.assign(host.style, { zIndex: '2147483645', overflow: 'hidden', background: '#000', pointerEvents: 'none' });
    this.update();
    const view = this.document.defaultView;
    let stopped = false;
    const fail = error => {
      if (stopped || this.host !== host) return;
      stopped = true;
      if (this.frame !== null) view?.cancelAnimationFrame?.(this.frame);
      this.frame = null;
      this.onError(error);
    };
    const schedule = () => {
      if (stopped || this.frame !== null || this.host !== host) return;
      const update = () => {
        if (stopped || this.host !== host) return;
        this.frame = null;
        try { this.update(); } catch (error) { fail(error); return; }
        // Transforms and animations can move the rendered rectangle without
        // changing the element's layout size or producing scroll/resize events.
        if (view?.requestAnimationFrame) schedule();
      };
      if (view?.requestAnimationFrame) this.frame = view.requestAnimationFrame(update); else update();
    };
    for (const [target, event] of [[this.document, 'fullscreenchange'], [this.document, 'scroll'], [view, 'resize']]) {
      if (!target?.addEventListener) continue;
      target.addEventListener(event, schedule, true);
      this.listeners.push(() => target.removeEventListener(event, schedule, true));
    }
    // PiP may hide the page and suspend animation callbacks. Refuse it on
    // the actual media event instead of waiting for another geometry frame.
    const onPictureInPicture = () => {
      if (stopped || this.host !== host) return;
      try { this.update(); } catch (error) { fail(error); }
    };
    this.document.addEventListener?.('enterpictureinpicture', onPictureInPicture, true);
    this.listeners.push(() => this.document.removeEventListener?.('enterpictureinpicture', onPictureInPicture, true));
    if (view?.ResizeObserver) { this.resizeObserver = new view.ResizeObserver(schedule); this.resizeObserver.observe(this.getPlayer()); }
    if (view?.requestAnimationFrame) schedule();
    return host;
  }
  restorePosition() {
    if (this.position && this.position.node.style.position === 'relative') this.position.node.style.position = this.position.prior;
    this.position = null;
  }
  update() {
    if (!this.host) return;
    const player = this.getPlayer(), fullscreen = this.document.fullscreenElement;
    if (this.document.pictureInPictureElement) throw Error('Picture-in-picture cannot contain the replacement; return to the page');
    if (fullscreen === player || fullscreen?.tagName === 'VIDEO') throw Error('Native-video fullscreen cannot contain the replacement; use container fullscreen');
    if (fullscreen && !fullscreen.contains?.(player)) throw Error('Fullscreen target does not contain the bound source');
    const parent = fullscreen ?? this.document.documentElement;
    if (this.position?.node !== fullscreen) this.restorePosition();
    if (fullscreen && this.document.defaultView?.getComputedStyle(fullscreen).position === 'static' && !this.position) {
      this.position = { node: fullscreen, prior: fullscreen.style.position }; fullscreen.style.position = 'relative';
    }
    moveConnectedNode(parent, this.host);
    const rect = player.getBoundingClientRect(), fullRect = fullscreen?.getBoundingClientRect();
    // Absolute offsets start at the fullscreen container's padding edge.
    // Its bounding rectangle includes the border; client offsets remove it.
    const x = rect.left - (fullRect?.left ?? 0) - (fullscreen?.clientLeft ?? 0) + (fullscreen?.scrollLeft ?? 0);
    const y = rect.top - (fullRect?.top ?? 0) - (fullscreen?.clientTop ?? 0) + (fullscreen?.scrollTop ?? 0);
    // At fractional display scaling (Windows 125%/150%) the player rectangle falls
    // between device pixels; snap every edge outward so no strip of native video shows.
    const ratio = Number(this.document.defaultView?.devicePixelRatio) > 0 ? Number(this.document.defaultView.devicePixelRatio) : 1;
    const outward = (start, size) => {
      const left = Math.floor(start * ratio + 1e-6) / ratio, right = Math.ceil((start + size) * ratio - 1e-6) / ratio;
      return [left, right - left];
    };
    const [left, width] = outward(x, rect.width), [top, height] = outward(y, rect.height);
    const style = {
      position: fullscreen ? 'absolute' : 'fixed', right: 'auto', bottom: 'auto',
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
    };
    for (const [key, value] of Object.entries(style)) if (this.host.style[key] !== value) this.host.style[key] = value;
    const mode = fullscreen ? 'fullscreen' : 'windowed';
    if (this.host.dataset.mode !== mode) this.host.dataset.mode = mode;
  }
  dispose() {
    for (const remove of this.listeners) remove(); this.listeners = [];
    this.resizeObserver?.disconnect();
    if (this.frame !== null) this.document.defaultView?.cancelAnimationFrame?.(this.frame);
    this.frame = null; this.host?.remove(); this.host = null; this.restorePosition();
  }
}
