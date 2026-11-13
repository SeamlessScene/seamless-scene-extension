# Edit packets

An edit packet is a JSON manifest (`edit-packet.json`) plus the clips it names by SHA-256.

- The schemas are in `packages/browser-extension/schemas`. `scripts/schema-check` keeps them in step with the validators.
- A **local packet** (`src/local-edit-packet.mjs`) is unsigned and for personal use. Its clips are H.264 8-bit SDR with AAC audio in MP4, 5–120 s long, and matched by hash.
- A **catalog packet** (`src/catalog-packet.mjs`, `src/manifest-security.mjs`) is Ed25519-signed by the website. The public verification keys are in `catalog-trust-config.mjs`.
- A **protected packet** (`packages/protected-packet-core`; format details in its README) is encrypted, with a renewable licence tied to a linked device.

Each segment is one of `REPLACE` (play a clip instead of `[trigger, resume)`), `INSERT` (pause the original at `trigger`, play a clip, then carry on), `SKIP`, or `MUTE`. Check a packet with `node scripts/check-edit-packet.mjs <folder>`.
