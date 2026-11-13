function nonNegative(value) {
  return Math.max(0, Number(value) || 0);
}

export function rectCoverageRatio(coverRect, playerRect) {
  const playerArea = nonNegative(playerRect.width) * nonNegative(playerRect.height);
  if (!playerArea) return 0;
  const overlapWidth = Math.max(0, Math.min(coverRect.right, playerRect.right) - Math.max(coverRect.left, playerRect.left));
  const overlapHeight = Math.max(0, Math.min(coverRect.bottom, playerRect.bottom) - Math.max(coverRect.top, playerRect.top));
  return Math.min(1, (overlapWidth * overlapHeight) / playerArea);
}

export class StandardPlayerCover {
  constructor({ document, passiveAdapter, now = () => performance.now() }) {
    this.document = document;
    this.passiveAdapter = passiveAdapter;
    this.now = now;
    this.cover = null;
    this.host = null;
    this.ownedHostPosition = null;
  }

  mount() {
    this.teardown();
    const player = this.passiveAdapter.activePlayer();
    if (!player) throw new Error("No active long-form player candidate is available");

    const playerRect = player.getBoundingClientRect();
    const fullscreenHost = this.document.fullscreenElement;
    const cover = this.document.createElement("div");
    cover.id = "scene-substitution-test-cover";
    cover.dataset.mode = fullscreenHost ? "fullscreen" : "windowed";
    cover.setAttribute("role", "presentation");
    cover.textContent = "Local replacement overlay test · playback remains with Prime";
    Object.assign(cover.style, {
      zIndex: "2147483646",
      display: "grid",
      placeItems: "center",
      boxSizing: "border-box",
      background: "#000",
      color: "#fff",
      font: "600 15px ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      textAlign: "center",
      pointerEvents: "none"
    });

    if (fullscreenHost) {
      this.host = fullscreenHost;
      const computedPosition = this.document.defaultView.getComputedStyle(fullscreenHost).position;
      if (computedPosition === "static") {
        this.ownedHostPosition = { prior: fullscreenHost.style.position, applied: "relative" };
        fullscreenHost.style.position = "relative";
      }
      Object.assign(cover.style, { position: "absolute", inset: "0" });
    } else {
      this.host = this.document.documentElement;
      Object.assign(cover.style, {
        position: "fixed",
        left: `${playerRect.left}px`,
        top: `${playerRect.top}px`,
        width: `${playerRect.width}px`,
        height: `${playerRect.height}px`
      });
    }

    this.host.append(cover);
    this.cover = cover;
    const coverRect = cover.getBoundingClientRect();
    return {
      mode: cover.dataset.mode,
      coverageRatio: rectCoverageRatio(coverRect, playerRect),
      mountedInFullscreenHost: Boolean(fullscreenHost && fullscreenHost.contains(cover)),
      pointerEvents: this.document.defaultView.getComputedStyle(cover).pointerEvents
    };
  }

  async showFor(durationMs = 3000) {
    const startedAt = this.now();
    const evidence = this.mount();
    try {
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    } finally {
      this.teardown();
    }
    return {
      command: `${evidence.mode}-cover`,
      confirmed: evidence.coverageRatio >= 0.99,
      durationMs: Math.round((this.now() - startedAt) * 1000) / 1000,
      evidence
    };
  }

  teardown() {
    this.cover?.remove();
    this.cover = null;
    if (this.host && this.ownedHostPosition && this.host.style.position === this.ownedHostPosition.applied) {
      this.host.style.position = this.ownedHostPosition.prior;
    }
    this.host = null;
    this.ownedHostPosition = null;
  }
}
