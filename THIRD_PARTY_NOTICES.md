# Third-party notices

| Component | Where | Licence |
| --- | --- | --- |
| hash-wasm 4.12.0 (SHA-256) | `packages/browser-extension/vendor/hash-wasm` | MIT — see `LICENSE` and `LICENSE-SHA256` there |
| noble-hashes (SHA-2) | `packages/browser-extension/vendor/noble-hashes` | MIT — see `LICENSE` there |
| jose 6.2.12 | bundled into `packages/browser-extension/vendor/protected/owner.mjs` | MIT |
| libsodium-wrappers-sumo 0.8.4, libsodium-sumo | bundled into `packages/browser-extension/vendor/protected/owner.mjs` | ISC |

The full licence texts for the bundled packages are in `packages/browser-extension/vendor/protected/LICENSES.txt`. Development-only dependencies (Ajv, ajv-formats) are MIT and are not shipped in the extension.
