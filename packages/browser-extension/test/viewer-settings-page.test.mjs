import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { viewerSurface } from '../src/viewer-service.mjs';
import { DEVELOPER_PANEL_HTML, DEVELOPER_LAUNCHER_HTML, developerSummary, developerSceneRow } from '../src/developer-panel.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Settings is one page with a side menu: Library, Playback, Account & sites, Creator, Advanced', async () => {
  const html = await read('viewer-settings.html');
  const links = [...html.matchAll(/<a href="#([a-z]+)" data-tab="\1">([^<]+)<\/a>/g)].map(m => [m[1], m[2].replace('&amp;', '&')]);
  assert.deepEqual(links, [['library', 'Library'], ['playback', 'Playback'], ['account', 'Account & sites'], ['creator', 'Creator'], ['advanced', 'Advanced']]);
  for (const section of ['library', 'playback', 'account', 'creator', 'advanced']) assert.match(html, new RegExp(`data-tab-panel="${section}"`));
  // The duplicate playback cards are gone; so are raw tab numbers.
  for (const gone of ['Now playing', 'Check for edits', 'Enable selected edit', 'Stop edits', 'Matching edits', 'Load selected edit', 'Player tab', 'Reset display preferences', 'Settings and library'])
    assert.doesNotMatch(html, new RegExp(gone), gone);
  assert.match(html, /<th>Edit<\/th><th>Show<\/th><th>Size<\/th><th>Last watched<\/th><th>Status<\/th>/);
  assert.match(html, /data-preference="leadInMs"[^>]*>.*3 s.*5 s.*10 s/);
  assert.match(html, /data-preference="advanced"/);
  assert.match(html, /What the timeline shows/, 'the timeline legend is help for the badge option');
  assert.match(html, /Reset all settings…/);
  assert.match(html, /id="copy-build"/);
  const viewer = await read('viewer.mjs');
  assert.doesNotMatch(viewer, /\$\('#library'\)|Remove from history|'Player tab '/, 'the dead #library rendering and tab numbers are gone');
  assert.match(viewer, /chrome\.sidePanel\.open\(\{ tabId \}\)/, 'Creator tools open for the player tab');
});

test('settings sections and their old links are accepted viewer pages', () => {
  const id = 'a'.repeat(32), origin = `chrome-extension://${id}`;
  for (const hash of ['#library', '#playback', '#account', '#creator', '#advanced', '#edits', '#settings', ''])
    assert.equal(viewerSurface({ id, url: `${origin}/viewer-settings.html${hash}`, origin, frameId: 0 }, id), true, hash);
  assert.equal(viewerSurface({ id, url: `${origin}/viewer-settings.html#other`, origin, frameId: 0 }, id), false);
});

test('the developer panel exists only in Advanced mode, as a small "Developer" launcher', async () => {
  const main = await read('src/main.mjs');
  assert.match(main, /const setAdvancedMode = advanced => \{[\s\S]*?if \(advanced !== true \|\| !commandAdapter\) \{[\s\S]*?launcherHost\?\.remove\(\)/);
  assert.match(main, /setAdvancedMode\(false\);/, 'off until preferences say otherwise');
  assert.match(main, /onPreferences:p=>\{[^}]*setAdvancedMode\(p\.advanced===true\)/);
  assert.match(DEVELOPER_PANEL_HTML, /:host \{ all: initial; display: none !important; \}\s*:host\(\[data-advanced="true"\]\[data-playback-controls="visible"\]\)/);
  assert.match(DEVELOPER_LAUNCHER_HTML, />Developer<\/button>/);
  for (const gone of ['Local playback controls', 'Enable read-only Prime identity', 'Level 0', 'observation only', 'Arm local edit'])
    assert.doesNotMatch(main + DEVELOPER_PANEL_HTML + DEVELOPER_LAUNCHER_HTML, new RegExp(gone), gone);
  for (const section of ['Scenes', 'Load a test edit', 'Player readings', 'Command tests', 'Evidence &amp; timing export'])
    assert.match(DEVELOPER_PANEL_HTML, new RegExp(`<summary>${section}`), section);
  assert.match(DEVELOPER_PANEL_HTML, /data-action="arm-local-packet"[^>]*>Watch with edit</);
});

test('developer summary and scene rows use plain type names and millisecond times', () => {
  assert.equal(developerSummary({ label: 'Harbor Lights · v1', state: 'armed', scenes: [{ status: 'played' }, { status: 'pending' }], sourceReady: true, sourceCheck: 'compatible' }),
    'Harbor Lights · v1 · On · 1 of 2 played · source check ✓');
  // 0.62.2 showed ✓ while turning on failed the check: the summary follows the arm-time result.
  assert.equal(developerSummary({ label: 'Harbor Lights · v1', state: 'loaded', sourceReady: true, sourceCheck: 'runtime-mismatch' }),
    'Harbor Lights · v1 · Loaded, off · source check ✗ runtime-mismatch');
  assert.equal(developerSummary({ state: 'idle', sourceReady: true }), 'No edit loaded · Off · source check not run yet');
  assert.deepEqual(developerSceneRow({ ordinal: 4, action: 'REPLACE', triggerLabel: '32:12.517', targetLabel: '32:07.517' }), { number: '4', text: 'Replaced · 32:12.517', jump: 'jump 32:07.517' });
});

test('the popup has a flat footer and one main action; the account page hides Disconnect when not connected', async () => {
  const popup = await read('viewer-popup.html');
  assert.match(popup, /<nav class="popup-footer"[^>]*>.*id="library">Library<.*id="settings">Settings<.*id="portal">Website/s);
  for (const gone of ['<details', 'Account <', 'Settings and library', 'Start from the beginning', 'web portal']) assert.doesNotMatch(popup, new RegExp(gone), gone);
  const account = await read('catalog-account.html');
  assert.match(account, /<button id="refresh" hidden>Check status<\/button><button id="disconnect"[^>]*hidden>Disconnect<\/button>/);
  assert.match(account, /href="viewer\.css"/, 'shared page styling');
  assert.doesNotMatch(account, /Unlinking keeps your local clips/);
  const welcome = await read('welcome.mjs');
  assert.match(welcome, /findEditUrl\(snapshot\.websiteOrigin\)/, 'Find an edit goes where the popup sends it');
  assert.match(welcome, /done\('#step-browse',downloaded/, 'step 3 ticks after the first download');
});

test('Settings text uses US spelling', async () => {
  const html = await readFile(new URL('../viewer-settings.html', import.meta.url), 'utf8');
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /\b(coloured|colours?|behaviours?|favourites?|recognis\w+|customis\w+|organis\w+)\b/i);
  assert.match(text, /a small colored square/);
});
