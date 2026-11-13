// Use only browser-supplied MessageSender metadata. A Port's lifecycle value
// describes connection time, not a live navigation/parent-document proof.
// Chrome may serialize document tokens as compact hex or hyphenated UUIDs.
// Preserve the exact browser token for comparisons and document-targeted calls.
const DOCUMENT_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?![\s\S])/i;
export function documentOrigin(url) {
  return url.protocol === 'chrome-extension:' ? `chrome-extension://${url.hostname}` : url.origin;
}
export function runtimeDocument(sender, extensionId) {
  if (sender?.id !== extensionId || !Number.isSafeInteger(sender.tab?.id) || sender.tab.id < 0 ||
      !Number.isSafeInteger(sender.frameId) || sender.frameId < 0 ||
      typeof sender.documentId !== 'string' || !DOCUMENT_ID.test(sender.documentId) || sender.documentLifecycle !== 'active') return null;
  try {
    const url = new URL(sender.url), tab = new URL(sender.tab.url);
    const origin = documentOrigin(url), topOrigin = documentOrigin(tab);
    if (url.username || url.password || tab.username || tab.password || origin === 'null' || topOrigin === 'null' || sender.origin !== origin) return null;
    return { tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, origin, topOrigin };
  } catch { return null; }
}
