// Release-managed public verification material only. No private signing key,
// test key, user import, page message or pairing response can populate this file.
export const catalogTrustConfig = Object.freeze({
  fixtureOnly: false,
  // The root domain since 0.66.0 (the first store release). The protected licence issuer in
  // protected-trust-config.mjs keeps the preview origin: an identifier the website signs, not a host.
  controlOrigin: 'https://seamlessscene.com',
  pairingOrigin: 'https://seamlessscene.com',
  // Links made before the move (0.65.x and earlier) recorded the preview origin. It is the same website
  // and the same link token, so they stay valid and are rewritten to pairingOrigin on their next check.
  legacyPairingOrigins: Object.freeze(['https://preview.seamlessscene.com']),
  // Extra website origins that may use the extension's page bridges (none).
  websiteOrigins: Object.freeze([]),
  // Device links last 30 days and are renewable from the account screen.
  deviceLinkLifetimeSeconds: 2592000,
  trustedKeys: Object.freeze({
    'seamless-scene-beta-2026-09': Object.freeze({
      status: 'active',
      publicKey: 'wAlNXebai9iYbEbp7/GgIVCMc3X+6lF8nUQAUh4J5ic='
    }),
    // Offline recovery key (2026-11-03): its private half is kept off every server, so catalogues can be re-signed
    // without a store review if the server key is lost.
    'seamless-scene-recovery-2026-11': Object.freeze({
      status: 'active',
      publicKey: '1TpDwRS1EkY0ksM6viYhMZvw4yeYlZQn0j8PzD5+KQM='
    })
  }),
  revokedVersionsByEdit: Object.freeze({})
});
