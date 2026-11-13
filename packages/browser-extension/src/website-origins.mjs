// Website origins whose pages may use the extension's page bridges: the pairing origin plus
// the release-configured extras (the root domain while the website moves to it). API requests
// and links still use the pairing origin only.
export function websiteOrigins(config) {
  const origins = new Set();
  for (const value of [config?.pairingOrigin, ...(Array.isArray(config?.websiteOrigins) ? config.websiteOrigins : [])]) {
    if (typeof value !== 'string' || !value) continue;
    try { origins.add(new URL(value).origin); } catch {}
  }
  return origins;
}

export function senderWebsiteOrigin(origins, sender) {
  let senderOrigin = null;
  try { senderOrigin = new URL(sender?.url ?? '').origin; } catch {}
  return origins.has(senderOrigin) && (!sender?.origin || sender.origin === senderOrigin) ? senderOrigin : null;
}
