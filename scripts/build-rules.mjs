// Builds everything derived from the single rules source (E75 / W9, extension 0.65.0):
//   packages/browser-extension/rules/seamless-rules-v1.json   (the source; edit only this)
//   -> packages/browser-extension/src/seamless-rules.mjs       (frozen rules + version gating; a
//                                                             PROVENANCE input of the protected build)
//   -> docs/technical/seamless-edit-pack-v1.schema.json      (edit.json JSON Schema; the website
//                                                             publishes a byte-identical copy)
//   -> packages/browser-extension/rules/vectors/boundaries-v1.json  (accept/refuse cases at every
//                                                             boundary, for the extension and website)
//
//   node scripts/build-rules.mjs            # write
//   node scripts/build-rules.mjs --check    # regenerate in memory and compare ("current" / "stale")
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the pathname is /D:/..., which path.resolve turns into D:\D:\...
const root = fileURLToPath(new URL('..', import.meta.url));
// The public repository keeps the extension in packages/, the private one in spikes/.
const ext = path.join(root, existsSync(path.join(root, 'packages', 'browser-extension')) ? 'packages' : 'spikes', 'browser-extension');
const SOURCE = path.join(ext, 'rules', 'seamless-rules-v1.json');
const OUTPUTS = {
  module: path.join(ext, 'src', 'seamless-rules.mjs'),
  schema: path.join(root, 'docs', 'technical', 'seamless-edit-pack-v1.schema.json'),
  vectors: path.join(ext, 'rules', 'vectors', 'boundaries-v1.json')
};
const KNOWN_RELAXATIONS = new Set(['clip-under-5000', 'season-or-episode-0']);
const PROFILES = ['local-user', 'catalog-v2', 'mvp'];

export function validateRules(rules) {
  const fail = message => { throw Error(`seamless-rules-v1.json: ${message}`); };
  if (!/^\d+\.\d+\.\d+$/.test(rules?.rules_version ?? '')) fail('rules_version must be x.y.z');
  for (const profile of PROFILES) {
    const d = rules.clip?.duration_ms?.[profile];
    if (!Number.isSafeInteger(d?.min) || !Number.isSafeInteger(d?.max) || d.min < 1 || d.max <= d.min) fail(`clip.duration_ms.${profile} needs min < max`);
  }
  for (const r of rules.relaxations ?? []) {
    if (!KNOWN_RELAXATIONS.has(r.id)) fail(`unknown relaxation ${r.id} (add its predicate to build-rules.mjs)`);
    if (!PROFILES.includes(r.profile) || !/^\d+\.\d+\.\d+$/.test(r.requires_client ?? '')) fail(`relaxation ${r.id} needs a profile and requires_client`);
  }
  // 1.2.0 (owner, 2026-10-19): a local file may say its tier is unverified; the catalog keeps its two tiers.
  const s = rules.source ?? {};
  if (!Array.isArray(s.tiers) || !Array.isArray(s.local_tiers) || !s.tiers.every(t => s.local_tiers.includes(t))) fail('source.local_tiers must include every catalog tier');
  if (!s.local_tiers.includes(s.local_default_tier) || s.tiers.includes(s.local_default_tier)) fail('source.local_default_tier must be a local-only tier');
  // 1.3.0 (E78, 2026-10-19): a local file that doesn't give its country says "ZZ" (CLDR Unknown Region), never a guessed US.
  if (s.local_unknown_territory !== 'ZZ' || !new RegExp(s.territory).test(s.local_unknown_territory)) fail('source.local_unknown_territory must be ZZ, a valid territory');
  const t = rules.source?.tolerance_ms;
  if (!(t?.max <= t?.legacy_read_max) || !(t.default <= t.max)) fail('source.tolerance_ms needs default <= max <= legacy_read_max');
  return rules;
}

const HELPERS = String.raw`
const deepFreeze = value => { if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); } return value; };
export const RULES = deepFreeze(SOURCE_JSON);
export const RULES_VERSION = RULES.rules_version;

const parse = value => typeof value === 'string' && value.length <= 32 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map(Number) : null;
/** Whether dotted version actual is at least minimum (false when either is malformed). */
export function versionAtLeast(actual, minimum) {
  const a = parse(actual), b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
const later = (a, b) => versionAtLeast(a, b) ? a : b;

/** Clip duration bounds for a profile (unknown profiles get the legacy mvp bounds). */
export const clipDurationRule = profile => RULES.clip.duration_ms[profile] ?? RULES.clip.duration_ms.mvp;

/** The relaxations a manifest uses under a profile: each names the first client that accepts it. */
export function relaxationsUsed(manifest, profile) {
  const used = [], segments = Array.isArray(manifest?.segments) ? manifest.segments : [];
  for (const relaxation of RULES.relaxations) {
    if (relaxation.profile !== profile) continue;
    if (relaxation.id === 'clip-under-5000' && segments.some(s => Number.isFinite(s?.asset?.expected_duration_ms) && s.asset.expected_duration_ms < relaxation.below_ms)) used.push(relaxation);
    if (relaxation.id === 'season-or-episode-0' && (manifest?.source?.season === 0 || manifest?.source?.episode === 0)) used.push(relaxation);
  }
  return used;
}

/**
 * The oldest extension that accepts this manifest under this profile: the catalog's
 * required_client_version, or a local .ss file's min_extension.
 */
export function requiredClientFor(manifest, profile) {
  const base = profile === 'catalog-v2' ? RULES.catalog.min_client : RULES.archive.min_extension;
  return relaxationsUsed(manifest, profile).reduce((version, relaxation) => later(version, relaxation.requires_client), base);
}
`;

export function moduleText(rules) {
  return `// GENERATED by scripts/build-rules.mjs from rules/seamless-rules-v1.json.\n` +
    `// Do not edit: change the rules file, run npm run build:rules, and commit both (npm run check:rules compares).\n` +
    HELPERS.replace('SOURCE_JSON', JSON.stringify(rules, null, 1)).replace(/^\n/, '');
}

/** Accept/refuse cases at every boundary, per profile. Shared with the website (rules/vectors). */
export function vectors(rules) {
  const cases = { rules_version: rules.rules_version, clip_duration_ms: [], season_episode: [], tolerance_ms: [], required_client: [], version_tag: [], territory: [], tier: [] };
  for (const profile of PROFILES) {
    const { min, max } = rules.clip.duration_ms[profile];
    for (const ms of [...new Set([999, 1000, 1499, 1500, 4999, 5000, min - 1, min, max, max + 1])].sort((a, b) => a - b))
      cases.clip_duration_ms.push({ profile, ms, accept: ms >= min && ms <= max });
    const [low, high] = rules.source.season;
    for (const value of [low - 1, low, 1, high, high + 1]) cases.season_episode.push({ profile, season: value, episode: 1, accept: value >= low && value <= high });
  }
  const t = rules.source.tolerance_ms;
  for (const [where, maximum] of [['edit.json', t.max], ['catalog-v2', t.max], ['local-user-read', t.legacy_read_max], ['mvp-read', t.legacy_read_max]])
    for (const ms of [0, t.default, t.max, t.max + 1, t.legacy_read_max, t.legacy_read_max + 1]) cases.tolerance_ms.push({ where, ms, accept: ms <= maximum });
  const relax = (profile, id) => rules.relaxations.find(r => r.profile === profile && r.id === id);
  for (const profile of ['local-user', 'catalog-v2']) {
    const base = profile === 'catalog-v2' ? rules.catalog.min_client : rules.archive.min_extension;
    const short = relax(profile, 'clip-under-5000'), zero = relax(profile, 'season-or-episode-0');
    for (const shortest of [1500, 4999, 5000]) for (const season of [0, 1]) {
      const list = [base, ...(short && shortest < short.below_ms ? [short.requires_client] : []), ...(zero && season === 0 ? [zero.requires_client] : [])];
      const requires = list.reduce((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b; return a; });
      cases.required_client.push({ profile, shortest_clip_ms: shortest, season, requires });
    }
  }
  const tagMax = rules.source.version_tag.max;
  for (const [value, accept] of [['creator-reported', true], ['user-capture-20261014', true], ['a'.repeat(tagMax), true], ['a'.repeat(tagMax + 1), false], ['User Capture', false], ['-x', false], ['', false]])
    cases.version_tag.push({ value, accept });
  for (const [value, accept] of [['US', true], ['GB', true], [rules.source.local_unknown_territory, true], ['us', false], ['USA', false], ['', false]]) cases.territory.push({ value, accept });
  // accept: edit.json and local files (local_tiers); catalog: a published edit (tiers).
  for (const value of [...rules.source.local_tiers, 'prime-video', 'free']) cases.tier.push({ value, accept: rules.source.local_tiers.includes(value), catalog: rules.source.tiers.includes(value) });
  return cases;
}

async function generate() {
  const rules = validateRules(JSON.parse(await readFile(SOURCE, 'utf8')));
  // The schema comes from edit-pack-fields with these rules passed in, so a stale generated
  // module cannot leak into the comparison.
  const { editPackSchema } = await import(pathToFileURL(path.join(ext, 'src', 'edit-pack-fields.mjs')).href);
  return {
    module: moduleText(rules),
    schema: JSON.stringify(editPackSchema(rules), null, 1) + '\n',
    vectors: JSON.stringify(vectors(rules), null, 1) + '\n'
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check');
  const outputs = await generate(), stale = [];
  for (const [key, text] of Object.entries(outputs)) {
    let current = null; try { current = await readFile(OUTPUTS[key], 'utf8'); } catch {}
    if (current !== text) {
      stale.push(path.relative(root, OUTPUTS[key]));
      if (!check) { await mkdir(path.dirname(OUTPUTS[key]), { recursive: true }); await writeFile(OUTPUTS[key], text); }
    }
  }
  console.log(JSON.stringify(check ? { check: stale.length ? 'stale' : 'current', stale } : { written: stale }));
  if (check && stale.length) process.exitCode = 1;
}
