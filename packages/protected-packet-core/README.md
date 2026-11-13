# Protected packet core

The client side of protected website edits: descriptor and licence verification, installation keys, and streaming decryption of encrypted packet objects. It is bundled into the extension as `packages/browser-extension/vendor/protected/owner.mjs` (see `docs/building.md`). Private keys and the licence service are not part of this repository.

```sh
npm ci
npm test
```

Identifiers such as `seamless-protected-candidate-1` are the format names in use, not a promise of a stable public API.

## Descriptor and ciphertext

`src/contract.mjs` is the strict validator. The outer compact JWS uses EdDSA, type `seamless-protected-descriptor+jws` and a configured active `kid`; embedded key URLs/keys and extra header fields are rejected. Verification returns an opaque authentic handle and a frozen snapshot; trust is rechecked at use. SHA-256 of the exact UTF-8 compact JWS identifies the descriptor for licensing.

Payload fields, all required and no extras:

| Field | Candidate value / meaning |
|---|---|
| `format` | `seamless-protected-candidate-1` |
| `release_id` | Bounded opaque lowercase identifier for the published release |
| `key_access` | `platform-key`; `creator-secret` is reserved in design validation and explicitly refused by v1 reader |
| `publication` | `reviewed-catalog-v2` for platform mode; `creator-private` for future secret mode |
| `crypto_profile` | `secretstream-xchacha20poly1305-1m-v1` |
| `required_capabilities` | Exactly the crypto profile followed by the key-access mode; no unknown-required fallback |
| `objects` | One packet object and up to 200 media objects, unique bounded IDs |

Each object has exactly `object_id`, `kind` (`packet` or `media`), `plaintext_bytes`, `ciphertext_bytes`, `ciphertext_sha256`. Packet <=2,000,000 bytes; each media <=250,000,000 bytes; aggregate media <=2,000,000,000 bytes. Ciphertext limits account for framing separately. Plaintext hashes/paths/profile remain in the encrypted signed inner catalog packet; public object IDs are not filenames or URLs.

Each object is libsodium secretstream: 24-byte header followed by records of 1,048,576 plaintext bytes (last shorter), each with 17-byte overhead. Plaintext size determines record boundaries. All nonfinal tags must be MESSAGE; the last must be FINAL. Zero-byte objects, trailing data, reorder, truncation, unknown tags and incorrect signed digest are refused. No custom cipher or random-access decryption is introduced.

Per-record additional authenticated data is UTF-8 JSON serialization of this exact array:

```text
[format, release_id, key_access, publication, crypto_profile,
 object_id, kind, plaintext_bytes]
```

No descriptor-digest circularity: ciphertext depends on these identity/profile fields, then the signed descriptor binds its resulting hashes/lengths. Issuers must generate fresh random per-object keys. The prototype signs the descriptor only after encrypting all objects. Exact inner catalog bytes and both inner signatures remain intact.

## Transport

Separate delivery consists of the descriptor JWS and objects obtained independently. Combined delivery is the same bytes in the `SSPC0001` candidate binary transport:

1. Eight ASCII magic bytes.
2. Big-endian uint32 descriptor-token byte count (maximum180,000), then UTF-8 compact JWS.
3. One record per signed object: big-endian uint32 ID byte count, UTF-8 ID, big-endian uint32 ciphertext byte count, ciphertext.

The reader verifies the descriptor before iterating objects, requires exact unique object membership/sizes and rejects truncation/extras. There is no compression or archive path interpretation. The in-memory map is resolved through the same importer as split delivery. Website resolver endpoints and storage URLs remain outside content identity; a network acquisition adapter is still required. The binary format deliberately avoids a ZIP parser.

## License and installation binding

Installation public keys use P-256; installation identity is the JWK thumbprint. The service wraps a small JSON grant with JOSE ECDH-ES/A256GCM, type `seamless-content-keys+jwe`. The grant binds the exact descriptor digest, installation identity and a complete object-ID/key set. Secret content keys are never in the public descriptor or combined transport.

A separate EdDSA JWT, type `seamless-playback-license+jwt`, carries exactly `iss`, `aud`, `sub`, `jti`, `iat`, `nbf`, `exp`, `descriptor_sha256`, `installation_id`, `keys_jwe`. Audience is `seamless-desktop-chrome-protected-candidate`. `sub` is the authorized account identity; issuer is mandatory verifier configuration. `nbf=iat`, `exp=iat+604800`, no clock tolerance; renewal becomes due with <=86400 seconds remaining. Issuer and descriptor signing keys have separate configured trust maps.
