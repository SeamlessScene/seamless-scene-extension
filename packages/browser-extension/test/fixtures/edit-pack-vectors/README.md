# Edit pack conformance vectors (E70, extension 0.64.0)

These are synthetic packs (ffmpeg `testsrc` + `sine`; no episode material). Each folder holds one pack and `expected.json`, which gives either:
- the `archive_id` that importing the pack must produce, or
- the refusal code, plus a phrase the message must contain.

Both implementations must agree with these: the extension (`src/ss-normalize.mjs`, `test/edit-pack-vectors.test.mjs`) and the website. `make_vectors.py` computes the ids independently, in Python, and regenerates the folders.

| Case | What it exercises | Expected |
|---|---|---|
| 01-deflate | DEFLATE entries, `edit.json` at the root | id A |
| 02-stored | STORED entries | id A |
| 03-wrapper-folder | everything under `My Edit/`, plus directory entries | id A |
| 04-macos-junk | `__MACOSX/`, `._*`, `.DS_Store`, `Thumbs.db` | id A |
| 05-data-descriptors | general-purpose bit 3 (sizes after the data) | id A |
| 06-zip64-extras | ZIP64 local extra fields, plus a ZIP64 end record and locator | id A |
| 07-friendly-names | `.ss` name, clip names with spaces, times as ms and `h:mm:ss`, plus the removed R3 keys (`spoilers`, `synthetic_media`, `real_person_likeness`, `warnings`), which are ignored | id A |
| 08-full-packet-friendly-paths | a full `edit-packet.json` with friendly `relative_path`s, plus `details.json` and a poster | id B |
| 09-missing-clip | `edit.json` names a clip the zip lacks | refusal `pack-clip-missing` |
| 10-deflate64 | method 9 (Explorer's Deflate64) | refusal `pack-deflate64` |
| 11-listing-missing | `edit.json` with only `id`, `episode` and `scenes` (0.64.1, R2) | id C; plays, with every publication setting listed as missing |

Cases 01–07 hold the same edit in different containers, so they must give the same id. Their `edit.json` sets every publication setting explicitly (R2). A `poster.jpg` in a pack is ignored, so it is not in the normalised file (R1, 0.64.1); the ids are unchanged.

The normalisation rules are in `src/ss-normalize.mjs`. `SHA256SUMS` covers every pack.

**Current ids (0.65.4: an absent episode tier is `unverified`; 0.64.1, R3: generated content is always `{spoilers:false, warnings:[]}`):**

| Id | Cases | Value |
|---|---|---|
| A | 01–07 | `32a8bf7e46da05306bc4d78bc525cbbe7b6e513c821fa8fda914d4cb2012f691` (0.65.5, territory ZZ when absent; 0.65.4 had `0a79ec78…2934`; 0.64.1–0.65.3 had `2429a84f…3aac`, with the tier defaulted to ad-free; 0.64.0 had `79d66f23…5950`) |
| B | 08 | `4058072a40d6a2c14950086ea32963c5de5d507d143bbda419467f7e214805f2` (unchanged; a full packet is kept as written) |
| C | 11 | `9629f0fdb189b4edc0a4ec9a0a87b0eac5822e3dcfa5ef4c9c953d4c4e3feaab` (0.65.5; 0.65.4 had `a04b5ee3…e4c8`; 0.64.1–0.65.3 had `61c7abb3…db03`) |
