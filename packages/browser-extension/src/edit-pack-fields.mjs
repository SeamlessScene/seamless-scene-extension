// E70 R2/R3 (0.64.1): every publication setting of an edit pack, one table shared by the
// edit.json reader, the creator side panel's Listing section and Save as edit pack, the
// builder bridge, and the published schema (docs/technical/seamless-edit-pack-v1.schema.json).
// Nothing is filled with a default: a missing or invalid setting is reported, by field, as
// "Not ready to submit"; local playback never depends on these fields.
// Spoilers, synthetic_media, real_person_likeness and warnings are not settings; edit.json keys
// with those names are ignored. Tags are the descriptive system.
// Categories: the website's creator categories.
// 0.65.0: every limit and list comes from the single rules source (rules/seamless-rules-v1.json).
import { RULES } from './seamless-rules.mjs';

/** The R2 table for a rules document: edit.json key, label, rule. Order is the Listing section's order. */
export function listingFields(rules = RULES) {
  const l = rules.listing;
  return Object.freeze([
    { key: 'title', label: 'Title', type: 'string', min: l.title[0], max: l.title[1], rule: `${l.title[0]}–${l.title[1]} characters` },
    { key: 'description', label: 'Description', type: 'string', min: l.description[0], max: l.description[1], rule: `${l.description[0]}–${l.description[1]} characters` },
    { key: 'category', label: 'Category', type: 'enum', values: Object.keys(l.categories), rule: 'one of the website’s edit types' },
    { key: 'tags', label: 'Tags', type: 'list', maxItems: l.tags.max, itemMin: l.tags.length[0], itemMax: l.tags.length[1], rule: `0–${l.tags.max} tags of ${l.tags.length[0]}–${l.tags.length[1]} characters (the primary way to describe and filter)` },
    { key: 'mature', label: '18+ only', type: 'boolean', rule: 'true or false' },
    { key: 'release_notes', label: 'Release notes', type: 'string', min: 0, max: l.release_notes_max, rule: `at most ${l.release_notes_max} characters; required from revision 2` },
    { key: 'imdb_url', label: 'IMDb link', type: 'string', min: 0, max: l.imdb.max, optional: true, rule: 'an imdb.com/title/tt… link, or ""' },
    { key: 'revision', label: 'Revision', type: 'integer', min: 1, rule: 'a whole number from 1' }
  ]);
}
export const PACK_CATEGORIES = RULES.listing.categories;
const IMDB = new RegExp(RULES.listing.imdb.pattern);
export const LISTING_FIELDS = listingFields();

function check(field, value, revision) {
  if (field.type === 'string') {
    if (typeof value !== 'string') return field.rule;
    const length = value.trim().length;
    if (length < field.min || value.length > field.max) return field.rule;
    if (field.key === 'imdb_url' && value !== '' && !IMDB.test(value.trim())) return field.rule;
    if (field.key === 'release_notes' && revision > 1 && !length) return 'required from revision 2';
    return null;
  }
  if (field.type === 'enum') return field.values.includes(value) ? null : field.rule;
  if (field.type === 'boolean') return typeof value === 'boolean' ? null : field.rule;
  if (field.type === 'integer') return Number.isSafeInteger(value) && value >= field.min ? null : field.rule;
  if (field.type === 'list') return Array.isArray(value) && value.length <= field.maxItems &&
    value.every(v => typeof v === 'string' && v.trim().length >= field.itemMin && v.length <= field.itemMax) ? null : field.rule;
  return field.rule;
}

/**
 * The listing an edit.json (or a stored details.listing) gives: the valid values, and every
 * field that is missing or breaks its rule. release_notes is required only from revision 2;
 * imdb_url is optional.
 */
export function listingStatus(source) {
  const from = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const revision = Number.isSafeInteger(from.revision) ? from.revision : 1;
  const listing = {}, missing = [];
  for (const field of LISTING_FIELDS) {
    const present = Object.hasOwn(from, field.key) && from[field.key] !== undefined && from[field.key] !== null;
    if (!present) {
      const required = !field.optional && !(field.key === 'release_notes' && revision <= 1);
      if (required) missing.push({ key: field.key, label: field.label, reason: 'missing from edit.json' });
      continue;
    }
    const problem = check(field, from[field.key], revision);
    if (problem) { missing.push({ key: field.key, label: field.label, reason: problem }); continue; }
    listing[field.key] = Array.isArray(from[field.key]) ? from[field.key].map(v => v.trim()) : typeof from[field.key] === 'string' ? from[field.key].trim() : from[field.key];
  }
  return { listing, missing, ready: missing.length === 0 };
}

/** "Not ready to submit: title (missing from edit.json), description (20–5000 characters)", or ''. */
export function readinessText(missing) {
  return missing?.length ? `Not ready to submit: ${missing.map(m => `${m.key} (${m.reason})`).join(', ')}` : '';
}

/**
 * The JSON Schema for edit.json, generated from the tables above (the website publishes the
 * same document at /schemas/seamless-edit-pack-v1.json; a test compares the pinned copy).
 * Listing fields are optional in the schema (a pack without them still plays locally).
 */
export function editPackSchema(rules = RULES) {
  const src = rules.source;
  const time = { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', pattern: '^(?:\\d+:)?\\d{1,2}:\\d{2}(?:\\.\\d{1,3})?$' }] };
  const listing = {};
  for (const f of listingFields(rules)) {
    listing[f.key] = f.type === 'string' ? { type: 'string', maxLength: f.max, ...(f.min ? { minLength: f.min } : {}), description: f.rule }
      : f.type === 'enum' ? { enum: f.values, description: f.rule }
        : f.type === 'boolean' ? { type: 'boolean', description: f.rule }
          : f.type === 'integer' ? { type: 'integer', minimum: f.min, description: f.rule }
            : { type: 'array', maxItems: f.maxItems, items: { type: 'string', minLength: f.itemMin, maxLength: f.itemMax }, description: f.rule };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://seamlessscene.com/schemas/seamless-edit-pack-v1.json',
    title: 'Seamless Scene edit pack (edit.json) v1',
    type: 'object',
    required: ['id', 'episode', 'scenes'],
    properties: {
      format: { const: 'seamless-edit-pack' }, version: { const: 1 },
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' },
      creator_name: { type: 'string', maxLength: 120, description: 'display text for local use only' },
      ...listing,
      episode: { type: 'object', required: ['gti', 'show', 'season', 'episode', 'runtime_ms'], properties: {
        service: { const: 'prime-video' }, gti: { type: 'string', minLength: 1 }, show: { type: 'string', minLength: 1 },
        season: { type: 'integer', minimum: src.season[0] }, episode: { type: 'integer', minimum: src.episode[0] }, episode_title: { type: 'string', maxLength: 200 },
        runtime_ms: { type: 'integer', minimum: 1 }, runtime_tolerance_ms: { type: 'integer', minimum: 0, maximum: src.tolerance_ms.max },
        territory: { type: 'string', pattern: src.territory }, tier: { enum: [...src.local_tiers] }, version_tag: { type: 'string', maxLength: src.version_tag.max, pattern: src.version_tag.pattern } } },
      scenes: { type: 'array', minItems: 1, items: { oneOf: [
        { type: 'object', required: ['action', 'start', 'end', 'clip'], properties: { action: { const: 'REPLACE' }, start: time, end: time, clip: { type: 'string' }, gain_db: { type: 'integer', minimum: rules.segments.gain_db[0], maximum: rules.segments.gain_db[1] }, note: { type: 'string' } } },
        { type: 'object', required: ['action', 'at', 'clip'], properties: { action: { const: 'INSERT' }, at: time, clip: { type: 'string' }, gain_db: { type: 'integer', minimum: rules.segments.gain_db[0], maximum: rules.segments.gain_db[1] }, note: { type: 'string' } } }
      ] } }
    }
  };
}
