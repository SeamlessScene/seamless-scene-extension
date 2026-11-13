export function installPageLifecycleRecovery({ window, cancel, restore, dispose }) {
  if (!window || typeof window.addEventListener !== "function" || typeof window.removeEventListener !== "function") {
    throw new TypeError("page-lifecycle-window-invalid");
  }
  for (const [name, callback] of Object.entries({ cancel, restore, dispose })) {
    if (typeof callback !== "function") throw new TypeError(`page-lifecycle-${name}-invalid`);
  }

  let disposed = false;
  const safelyStart = (operation) => {
    try {
      void Promise.resolve(operation()).catch(() => {});
    } catch {
      // Lifecycle cleanup is best-effort and must not block browser navigation.
    }
  };
  const detach = () => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
  const onPageHide = (event) => {
    if (disposed) return;
    safelyStart(() => cancel(event.persisted ? "pagehide-bfcache" : "pagehide"));
    if (event.persisted) return;
    disposed = true;
    detach();
    safelyStart(dispose);
  };
  const onPageShow = (event) => {
    if (disposed || !event.persisted) return;
    safelyStart(restore);
  };

  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    if (disposed) return;
    disposed = true;
    detach();
    safelyStart(dispose);
  };
}
