# SHA-256 dependency provenance

Reviewed September 7, 2026 by Engineering for F07/F12 local-file hashing.

- Upstream: [noble-hashes](https://github.com/paulmillr/noble-hashes), MIT, Paul Miller.
- Pinned package: `@noble/hashes@2.0.1`.
- Retrieval: `https://registry.npmjs.org/@noble/hashes/-/hashes-2.0.1.tgz`.
- Archive SHA-512 (base64): `XlOlEbQcE9fmuXxrVTXCTlG2nlRXa9Rj3rr5Ue/+tX+nmkgbX720YHh0VR3hBF9xDvwnb8D2shVGOwNx+ulArw==`.
- Archive integrity was checked against the registry metadata before extraction into memory. This is an integrity check, not an independent signature/audit claim for this exact release.
- Only `sha2.js` and its three static dependencies are included; no remote runtime fetch, package install scripts, eval, WASM, or Node polyfill is needed. Only SHA-256 is called. Unused upstream exports remain intact to avoid maintaining a cryptographic fork.
- Source/license text is unchanged except for an appended final newline. Source maps are not packaged. Preserve `LICENSE` in distributed artifacts.
- Build admission explicitly allows these four paths; their bytes participate in the content-derived build identity. Other vendor dependencies require review.

Local SHA-256 checksums:

| File | SHA-256 |
|---|---|
| sha2.js | c73e91ce417c966e4de50c4c88a242432c9e200e09792bce96d180621679ca90 |
| _md.js | d811ab3678945eec01ad9f15198c6de01b275719dd6708e0e7bec82923ced114 |
| _u64.js | 912f24f4411df1381589afd2fbd8ba7476c42e7313c9e707aab82b97a9148f0c |
| utils.js | 2b23bcb8a282ae9617e258a136aa922fe38166d72800f1650e63fa7318b469c6 |
| LICENSE | 3239e134eb6e6d64538ca76498c7fcb08a395249dd9d4af9927bf6d0169ee429 |

On upgrade, verify a newly pinned archive, review the complete dependency graph and license, update checksums, run `local-file-hash.test.mjs` plus the extension/build suites, and repeat browser boundary/performance/cancellation checks. WebCrypto remains the existing signature verifier; this change does not change manifest trust.
