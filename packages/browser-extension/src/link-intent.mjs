// "Link your account" pressed in the popup, on the welcome page or in Settings leaves a short-lived note that the
// account page reads once when it opens: the page then asks for a code and opens the website by itself, so the press
// that opened it is the only press in the extension. The note lives in the extension's own localStorage (all extension
// pages share one origin); the account page's address stays exactly catalog-account.html, which the device-link
// service requires of its sender. A stale or missing note changes nothing: the page just shows its button.
export const LINK_INTENT_KEY = 'seamless-link-intent-v1';
export const LINK_INTENT_MAX_MS = 30_000;

export function noteLinkIntent(storage, now = Date.now()) {
  try { storage.setItem(LINK_INTENT_KEY, String(now)); return true; } catch { return false; }
}

// Reads and always clears the note, so a reloaded or session-restored account page never starts a link by itself.
export function takeLinkIntent(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(LINK_INTENT_KEY);
    storage.removeItem(LINK_INTENT_KEY);
    const at = Number(raw);
    return raw !== null && Number.isFinite(at) && now - at >= 0 && now - at <= LINK_INTENT_MAX_MS;
  } catch { return false; }
}

export function pageStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
