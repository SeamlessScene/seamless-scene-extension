# Seamless Scene rules (single source)

`seamless-rules-v1.json` is the one place a limit or rule changes. The extension, the website (builder, worker, publisher), the guides and the pipeline all take their limits from it (E75 / W9, extension 0.65.0).

**After editing the rules file:**
- Run `npm run build:rules` and commit the outputs with it.
- `npm run check:rules` regenerates in memory and compares. `test/rules-v1.test.mjs` does the same in `npm test`.

**Generated outputs:**

| File | What it is |
|---|---|
| `src/seamless-rules.mjs` | The frozen rules, plus `requiredClientFor(manifest, profile)`. It is a PROVENANCE input of the protected build (`npm run build:protected` / `check:protected`). |
| `docs/technical/seamless-edit-pack-v1.schema.json` | The edit.json schema. The website publishes it byte-identically, and each side pins the other's copy. |
| `rules/vectors/boundaries-v1.json` | Accept and refuse cases at every boundary, per profile. The extension tests run them, and the website runs the same file against its own layers. |

**Profiles:**
- `local-user`: `.ss` files, folders and edit packs;
- `catalog-v2`: published catalog edits;
- `mvp`: legacy signed 1.0.0 manifests.

**Rules for changing rules:**
- **Relaxations.** A relaxation that older clients would refuse goes in `relaxations` with `requires_client`: the first extension that accepts it. For catalog packets, `requiredClientFor` sets `required_client_version`; for local `.ss` files, `min_extension`. A new relaxation id needs its predicate in `scripts/build-rules.mjs` (an unknown id fails the build).
- **Versioning.** Bump `rules_version`: minor for a relaxation, major for a tightening.
- **Shipping order.** The website may not ship a relaxation before the extension version it requires is live.
