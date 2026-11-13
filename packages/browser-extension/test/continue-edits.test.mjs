import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContinuation, shouldPrefetchNext, preferences, preferenceChange } from '../src/viewer-model.mjs';

test('continue with edits picks the same creator, else the only edit, never a guess', () => {
  const a = { id: 'a', creatorName: 'Maker' }, b = { id: 'b', creatorName: 'Other' }, c = { id: 'c', creatorName: 'Maker' };
  assert.equal(chooseContinuation('Maker', [b, a]), a);
  assert.equal(chooseContinuation('Nobody', [b]), b, 'the only edit');
  assert.equal(chooseContinuation('Nobody', [a, b]), null, 'several edits by others are the viewer\'s choice');
  assert.equal(chooseContinuation('Maker', [a, c]), null, 'two by the same creator: ask');
  assert.equal(chooseContinuation(null, []), null);
});

test('the next episode downloads from 80% of an edited episode', () => {
  assert.equal(shouldPrefetchNext({ editId: 'e', currentTimeMs: 80, durationMs: 100 }), true);
  assert.equal(shouldPrefetchNext({ editId: 'e', currentTimeMs: 79, durationMs: 100 }), false);
  assert.equal(shouldPrefetchNext({ editId: '', currentTimeMs: 90, durationMs: 100 }), false, 'no edit on, nothing to continue');
  assert.equal(shouldPrefetchNext({ editId: 'e', currentTimeMs: 90, durationMs: 0 }), false);
});

test('continue with edits is off by default and a plain on/off preference', () => {
  assert.equal(preferences({}).continueEdits, false);
  assert.equal(preferenceChange(preferences({}), { continueEdits: true }).continueEdits, true);
  assert.throws(() => preferenceChange(preferences({}), { continueEdits: 'yes' }));
});
