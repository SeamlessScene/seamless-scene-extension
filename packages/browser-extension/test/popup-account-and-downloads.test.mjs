import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { joinParts, popupAccountLine } from '../src/viewer-display.mjs';
import { previousRows } from '../src/edits-model.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('E96: the popup names the linked account with the display name Settings shows, and nothing otherwise', async () => {
  assert.equal(popupAccountLine({ state: 'saved', displayName: 'Test account', expiresAt: '2026-12-01T00:00:00Z' }), 'Connected as Test account');
  assert.equal(popupAccountLine({ state: 'saved', displayName: `  ${'x'.repeat(200)} ` }), `Connected as ${'x'.repeat(80)}`, 'bounded');
  for (const account of [null, undefined, { state: 'unpaired' }, { state: 'pending' }, { state: 'revocation-pending' }, { state: 'unconfigured' }, { state: 'saved', displayName: ' ' }, { state: 'saved' }])
    assert.equal(popupAccountLine(account), '', JSON.stringify(account));
  const popup = await read('viewer-popup.html');
  assert.match(popup, /<p class="muted" id="popup-version"><\/p><p class="muted popup-account" id="popup-account" hidden><\/p>/, 'one compact line under the version');
  const viewer = await read('viewer.mjs');
  assert.match(viewer, /accountLine\.textContent = snapshot\.fixtureOnly \? '' : popupAccountLine\(snapshot\.account\);\s*accountLine\.hidden = !accountLine\.textContent;/);
  // Settings uses the same stored name.
  assert.match(viewer, /`Connected as \$\{a\.displayName\} until/);
});

test('E89: download rows drop empty parts instead of showing a bare " · "', async () => {
  assert.equal(joinParts('Avery Cut', ''), 'Avery Cut');
  assert.equal(joinParts('', null, undefined, '  '), '');
  assert.equal(joinParts(' Homeland ', 'Episode 2'), 'Homeland · Episode 2');
  assert.equal(previousRows([{ releaseId: 'x', name: '', titleName: '', episodeName: '' }])[0].name, 'An edit');
  assert.equal(previousRows([{ releaseId: 'x', name: ' ', titleName: 'Homeland', episodeName: '' }])[0].name, 'Homeland');
  const viewer = await read('viewer.mjs');
  assert.doesNotMatch(viewer, /li\.append\(name, ' · ', label\)/, 'the unguarded separator is gone');
  assert.match(viewer, /text\.append\(name, \.\.\.\(label \? \[' · ', label\] : \[\]\)\);/);
});
