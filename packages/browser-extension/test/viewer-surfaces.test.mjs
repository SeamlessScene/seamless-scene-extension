import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPlayback, sourceKey, viewerFailureMessage, viewerFailureCode, GENERIC_FAILURE, sourceMismatchCode, sameEpisodeOtherTitleId, primeTitleId } from '../src/viewer-model.mjs';
import { viewerView, popupPlan, popupEditLine, sceneJump, sceneList, showLine, cleanPageTitle, toolbarState, findEditUrl, problemFor, supportDetails, viewerTime } from '../src/viewer-display.mjs';
import { menuMarkup } from '../src/viewer-overlay.mjs';
import { loadedEditMetadata } from '../src/loaded-edit-display.mjs';
import { toolbarBadge, toolbarTone } from '../src/viewer-icons.mjs';
import { viewerLoadMessage } from '../src/viewer-load-error.mjs';

// Realistic keys (the 0.60.3 lesson): Prime reports its own source key, which never
// equals the packet's manifest key stored with the library row.
const primeKey = sourceKey({ serviceId: 'prime-video', activeItemId: 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185', mediaType: 'episode', season: 1, episode: 4, runtimeMs: 2701032 });
const packetKey = sourceKey({ serviceId: 'prime-video', activeItemId: 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185', mediaType: 'episode', season: 1, episode: 4, runtimeMs: 2701000, versionTag: 'published', territory: 'US', plan: 'prime' });
const release = '3f1c2d4e-0000-4000-8000-000000000001', other = '7a2b9c10-0000-4000-8000-000000000002';
const library = [{ id: release, origin: 'website', transport: 'protected', version: '1', name: 'Harbor Lights', title: 'Orbit Station', sourceKey: packetKey, bytes: 41_000_000 }];
const t = (m, s, ms = 0) => (m * 60 + s) * 1000 + ms;
const starts = [t(19, 52, 659), t(20, 32, 824), t(20, 46, 100), t(32, 12, 517), t(34, 1, 655), t(35, 54, 612), t(36, 33, 200)];
const scenes = statuses => starts.map((startMs, i) => ({ type: 'REPLACE', startMs, resumeMs: startMs + 4800, status: statuses[i] ?? 'pending' }));
const played3 = ['played', 'played', 'played'];
const m1 = { id: release, title: 'Harbor Lights', name: 'Harbor Lights', version: '1', bytes: 41_000_000, downloaded: true };
const m2 = { id: other, title: 'Rowan’s Video Diary, Recast', name: 'Rowan’s Video Diary, Recast', version: '1', bytes: 18_000_000, downloaded: true };
// A controller snapshot as main.mjs sends it, including developer output that must never show.
function controller(state, extra = {}) {
  const raw = { state, sourceKey: primeKey, title: 'Watch Orbit Station - Season 1 | Prime Video', show: { title: '', season: 1, episode: 4 }, generation: 'g',
    reason: 'Armed 3 actions. Seek before a trigger, then play normally.', ...extra };
  const playback = publicPlayback(raw);
  return { ...playback, ...loadedEditMetadata(playback, library) };
}
const edit = { editId: release, version: '1', canStop: true, show: { title: 'Orbit Station', season: 1, episode: 4 } };
const text = html => html.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const menu = (playback, options = {}) => {
  const view = viewerView({ playback, matches: options.matches ?? [], load: options.load, prefs: { leadInMs: 5000 }, problem: options.problem });
  const markup = menuMarkup(view, { matches: options.matches ?? [], details: view.problem ? supportDetails(view.problem.code, '0.61.0', new Date('2026-09-30T17:42:00Z')) : '' });
  return { view, html: markup.head + markup.body, text: text(markup.head + ' ' + markup.body) };
};
const popup = (playback, options = {}) => {
  const view = viewerView({ playback, matches: options.matches ?? [], load: options.load, prefs: { leadInMs: 5000 }, problem: options.problem });
  const plan = popupPlan(view, { account: { state: 'saved' }, onSupportedSite: true, siteAllowed: true });
  return { chip: view.chip.text, show: view.show, edit: popupEditLine(view), sub: plan.sub ?? view.popupSub, main: plan.main?.label ?? null, row: plan.row.map(b => b.label), list: plan.list === true };
};

test('player menu and popup text for every state', () => {
  const none = controller('idle');
  assert.match(menu(none).text, /^Off Orbit Station · S1 E4 No downloaded edit for this episode\. Find an edit Opens this episode’s edits on the website\.$/);
  assert.deepEqual(popup(none), { chip: 'Off', show: 'Orbit Station · S1 E4', edit: 'No edit on', sub: 'No downloaded edit for this episode.', main: 'Find an edit', row: [], list: false });

  const ready = controller('idle');
  assert.match(menu(ready, { matches: [m1] }).text, /1 downloaded edit matches: Harbor Lights · v1 Watch with edit Change edit…$/);
  assert.deepEqual(popup(ready, { matches: [m1] }), { chip: 'Off', show: 'Orbit Station · S1 E4', edit: 'Harbor Lights · v1 downloaded', sub: 'Ready to watch. Scenes switch as you watch.', main: 'Watch with edit', row: ['Change edit…'], list: false });

  const two = menu(ready, { matches: [m1, m2] });
  assert.match(two.text, /2 downloaded edits match this episode\. Harbor Lights · v1 41 MB Watch Rowan’s Video Diary, Recast · v1 18 MB Watch Find more for this episode on the website ↗$/);
  assert.deepEqual(popup(ready, { matches: [m1, m2] }), { chip: 'Off', show: 'Orbit Station · S1 E4', edit: '2 edits match', sub: 'Choose one to watch.', main: null, row: [], list: true });

  const load = { state: 'downloading', busy: true, bytes: 12_300_000, total: 29_100_000, releaseId: release, name: 'Harbor Lights', version: '1' };
  assert.match(menu(ready, { load }).text, /^Getting ready Harbor Lights v1 Orbit Station · S1 E4 Downloading · 42% · 12\.3 of 29\.1 MB It turns on by itself when the download finishes\.$/);
  assert.equal(popup(ready, { load }).sub, 'Downloading · 42%');

  const waiting = controller('armed', { ...edit, currentTimeMs: t(31, 5, 0), scenes: scenes(played3) });
  const w = menu(waiting);
  assert.match(w.text, /^On Harbor Lights v1 Orbit Station · S1 E4 Next: 4 of 7 in 1m 8s 3 of 7 scenes played Previous scene Next scene Scenes each jumps to 5 s before 1 19:52 played 2 20:32 played 3 20:46 played 4 32:12 next 5 34:01/);
  assert.match(w.text, /Stop edit Change edit…$/);
  assert.match(w.html, /title="Jumps to 32:07 \(5 s before\)"/);
  assert.equal(w.view.badge, 'ready');
  assert.deepEqual(popup(waiting), { chip: 'On', show: 'Orbit Station · S1 E4', edit: 'Harbor Lights · v1', sub: 'Next: 4 of 7 in 1m 8s', main: 'Stop edit', row: ['Next scene', 'Change edit…'], list: false });

  const playing = controller('active', { ...edit, currentTimeMs: t(32, 14, 0), scenes: scenes([...played3, 'playing']) });
  const p = menu(playing);
  assert.match(p.text, /On Harbor Lights v1 Orbit Station · S1 E4 Playing 4 of 7 3 of 7 scenes played/);
  assert.match(p.html, /<li class="playing" data-index="3"><button[^>]*aria-current="true"/);
  assert.equal(p.view.badge, 'on');
  assert.equal(popup(playing).sub, 'Playing 4 of 7');

  const behind = controller('armed', { ...edit, skippedCount: 4, currentTimeMs: t(33, 0), scenes: scenes(['skipped', 'skipped', 'skipped', 'skipped']) });
  assert.match(menu(behind).text, /Next: 5 of 7 in 1m 2s · 4 behind 0 of 7 scenes played Jump to scene 1 Next scene/);
  assert.deepEqual(popup(behind).main, 'Jump to scene 1');
  assert.deepEqual(popup(behind).row, ['Next scene', 'Stop edit', 'Change edit…'], 'an edit that is on always offers Stop edit');
  assert.equal(popup(behind).sub, 'Next: 5 of 7 in 1m 2s · 4 behind');

  const finished = controller('finished', { ...edit, currentTimeMs: t(40, 0), scenes: scenes(Array(7).fill('played')) });
  // E50: Finished keeps the edit loaded, so it offers Stop edit (menu and popup) to free it for another tab.
  assert.match(menu(finished).text, /^Finished Harbor Lights v1 Orbit Station · S1 E4 Finished 7 of 7 7 of 7 scenes played Watch again Find another edit Stop edit$/);
  assert.match(menu(finished).html, /data-act="stop"/);
  assert.deepEqual([popup(finished).main, popup(finished).row], ['Watch again', ['Find another edit', 'Stop edit']]);
  // 0.65.2: started part-way in, scenes 1-3 were behind the start and never played.
  const finishedLate = controller('finished', { ...edit, currentTimeMs: t(40, 0), scenes: scenes(['skipped', 'skipped', 'skipped', 'played', 'played', 'played', 'played']) });
  assert.match(menu(finishedLate).text, /^Finished Harbor Lights v1 Orbit Station · S1 E4 Finished · 4 of 7 played 4 of 7 scenes played Watch again/);
  assert.equal(popup(finishedLate).sub, 'Finished · 4 of 7 played');

  // A stop that is a fault (the player restarted under the edit) is still a Problem.
  const stopped = controller('idle', { notice: 'viewer-player-changed' });
  const problem = menu(stopped);
  assert.match(problem.text, /^Problem Orbit Station · S1 E4 /);
  assert.match(problem.html, /<code>viewer-player-changed · 0\.61\.0 · 2026-09-30 17:42 UTC<\/code>/);
  assert.equal(problem.view.badge, 'bad');
  assert.deepEqual([popup(stopped).chip, popup(stopped).sub, popup(stopped).main], ['Problem', 'The player restarted, so the edit stopped.', 'Watch with edit']);
});

// E110: the service moving on to the next episode is not a fault. The episode that follows shows
// what it would have shown had it been opened directly.
test('an episode change is not a Problem: the next episode shows its normal Off state', () => {
  const moved = controller('idle', { notice: 'viewer-episode-changed' });
  const none = menu(moved);
  assert.equal(none.view.kind, 'none');
  assert.deepEqual([none.view.chip.text, none.view.badge, none.view.problem], ['Off', 'off', null]);
  assert.match(none.text, /^Off Orbit Station · S1 E4 No downloaded edit for this episode\. Find an edit /);
  assert.deepEqual([popup(moved).chip, popup(moved).sub, popup(moved).main], ['Off', 'No downloaded edit for this episode.', 'Find an edit']);
  // A downloaded edit for the new episode is offered as usual.
  assert.equal(menu(moved, { matches: [m1] }).view.kind, 'ready');
  assert.equal(popup(moved, { matches: [m1] }).chip, 'Off');
  // A real failure in the same moment still shows.
  assert.equal(menu(moved, { problem: 'viewer-owner-busy' }).view.kind, 'problem');
});

// An edit already on this device (a local .ss file, or a kept download) is only opened and checked:
// its note does not speak of a download.
test('opening an edit that is already on this device does not mention a download', () => {
  const idle = controller('idle');
  for (const state of ['opening', 'licensing', 'verifying', 'checking'])
    assert.match(menu(idle, { load: { busy: true, state, bytes: 0, total: 0 } }).text, / It turns on by itself when it is ready\.$/, state);
  for (const state of ['queued', 'requesting', 'downloading', 'saving'])
    assert.match(menu(idle, { load: { busy: true, state, bytes: 0, total: 0 } }).text, / It turns on by itself when the download finishes\.$/, state);
  // A queued download says so through all of its steps.
  assert.match(menu(idle, { load: { busy: true, download: true, releaseId: release, state: 'checking', bytes: 1, total: 4 } }).text, /when the download finishes\./);
});

test('Stop edit shows only while an edit is on; Change edit opens the same chooser', () => {
  assert.doesNotMatch(menu(controller('idle'), { matches: [m1] }).text, /Stop edit/);
  const on = controller('armed', { ...edit, currentTimeMs: 0, scenes: scenes([]) });
  const view = viewerView({ playback: on, prefs: {} });
  view.currentId = release;
  const change = menuMarkup(view, { matches: [m1, m2], changing: true });
  const t2 = text(change.body);
  assert.match(t2, /^Change edit Harbor Lights · v1 41 MB On Rowan’s Video Diary, Recast · v1 18 MB Watch Find more for this episode on the website ↗ Back$/);
  assert.match(change.body, /data-act="choose" data-arg="3f1c2d4e[^"]*"[^>]* disabled/, 'the edit that is on cannot be chosen again');
});

test('no developer output, raw reason or error code reaches viewer text', () => {
  const leaks = /Armed|armed|packet|actions|trigger|catalog|renderer|release|viewer-[a-z]|Code:|SET|web portal/;
  const states = [
    controller('idle'), controller('loaded', { ...edit, canArm: true, reason: 'Local edit armed · 0/1 completed · 0 skipped' }),
    controller('armed', { ...edit, scenes: scenes(played3), currentTimeMs: t(31, 0) }), controller('active', { ...edit, scenes: scenes([...played3, 'playing']), currentTimeMs: t(32, 13) }),
    controller('idle', { notice: 'viewer-ads-detected' }), controller('idle', { notice: 'viewer-renderer-lost' }), controller('idle', { notice: 'viewer-unheard-of' })
  ];
  for (const s of states) {
    assert.equal('reason' in s, false, 'publicPlayback drops the developer reason');
    const m = menu(s, { matches: [m1] }), p = popup(s, { matches: [m1] });
    assert.doesNotMatch(m.text, leaks, m.text);
    assert.doesNotMatch(JSON.stringify(p), leaks, JSON.stringify(p));
  }
  for (const error of ['viewer-load-unavailable', 'viewer-account-link-required', 'https://private.test/?token=1']) {
    const failed = menu(controller('idle'), { load: { state: 'failed', busy: false, error } });
    assert.equal(failed.view.kind, 'problem'); assert.doesNotMatch(failed.text, leaks, failed.text);
  }
  assert.equal(publicPlayback({ notice: 'Armed 3 actions' }).notice, '', 'a notice is a code, never text');
});

test('every code the service can emit has a plain sentence; unknown codes read as the generic sentence', () => {
  for (const code of ['viewer-operation-failed', 'viewer-request-denied', 'viewer-sender-denied', 'viewer-method-denied', 'viewer-preview-not-ready', 'viewer-diagnostics-unavailable',
    'viewer-not-ready', 'viewer-not-armed', 'viewer-unavailable', 'viewer-source-unavailable', 'viewer-busy', 'viewer-action-timeout', 'viewer-controller-disconnected',
    'viewer-controller-unavailable', 'viewer-release-invalid', 'viewer-edit-not-matched', 'viewer-stop-before-switching', 'viewer-scene-unavailable', 'viewer-website-unconfigured']) {
    const sentence = viewerFailureMessage(Error(code));
    assert.doesNotMatch(sentence, /viewer-|Code|Click Enable|Settings & Library|Open Settings and library|web portal|packet/, `${code}: ${sentence}`);
    assert.match(sentence, /^[A-Z].*\.$/, `${code} is one plain sentence`);
    if (code !== 'viewer-operation-failed') assert.notEqual(sentence, GENERIC_FAILURE, `${code} is mapped`);
  }
  for (const raw of ['viewer-made-up-code', 'TypeError: x is undefined', 'Site access was not granted.', undefined])
    assert.equal(viewerFailureMessage(raw === undefined ? undefined : Error(raw)), 'Something went wrong. Try again, or copy the details for support.');
  assert.equal(viewerFailureCode(Error('TypeError: secret')), 'unknown', 'raw exception text is never a support code');
  assert.equal(viewerLoadMessage('viewer-renderer-unavailable'), viewerFailureMessage(Error('viewer-load-unavailable')), 'near-duplicates merged');
  assert.equal(problemFor('viewer-renderer-lost').fix.act, 'reload');
  assert.equal(problemFor('viewer-account-link-required').fix.label, 'Connect your account');
});

test('scene jumps land the lead-in before the scene, clamp at 0 and stop at the ends', () => {
  const list = scenes([]);
  assert.deepEqual(sceneJump(list, { currentMs: 0, leadInMs: 5000 }, 3), { index: 3, targetMs: t(32, 7, 517) });
  assert.deepEqual(sceneJump([{ startMs: 2000, status: 'pending' }], { leadInMs: 5000 }, 0), { index: 0, targetMs: 0 }, 'never before 0');
  assert.deepEqual(sceneJump(list, { currentMs: 0, leadInMs: 10000 }, 0), { index: 0, targetMs: t(19, 42, 659) });
  assert.equal(sceneJump(list, { currentMs: 0 }, 7), null);
  // Next from the gap after scene 3: scene 4. Again from scene 4's jump point: scene 5.
  assert.equal(sceneJump(list, { currentMs: t(31, 0), leadInMs: 5000 }, 'next').index, 3);
  assert.equal(sceneJump(list, { currentMs: t(32, 7, 517), leadInMs: 5000 }, 'next').index, 4);
  // Previous from the same gap: scene 3; pressed again from scene 3's jump point: scene 2.
  assert.equal(sceneJump(list, { currentMs: t(31, 0), leadInMs: 5000 }, 'previous').index, 2);
  assert.equal(sceneJump(list, { currentMs: t(20, 41, 100), leadInMs: 5000 }, 'previous').index, 1);
  // While scene 4 plays, Previous goes to scene 3 and Next to scene 5.
  const playing = scenes([...played3, 'playing']);
  assert.equal(sceneJump(playing, { currentMs: t(32, 14), leadInMs: 5000 }, 'previous').index, 2);
  assert.equal(sceneJump(playing, { currentMs: t(32, 14), leadInMs: 5000 }, 'next').index, 4);
  // At the ends there is nothing to jump to.
  assert.equal(sceneJump(list, { currentMs: t(10, 0), leadInMs: 5000 }, 'previous'), null);
  assert.equal(sceneJump(list, { currentMs: t(40, 0), leadInMs: 5000 }, 'next'), null);
  const view = viewerView({ playback: controller('armed', { ...edit, currentTimeMs: t(40, 0), scenes: scenes(Array(7).fill('played')) }) });
  assert.equal(view.canNext, false); assert.equal(view.canPrevious, true);
  assert.equal(sceneList({ scenes: list }, { leadInMs: 3000 })[3].title, 'Jumps to 32:09 (3 s before)');
});

test('show line comes from the edit or Prime identity; the page title is only a cleaned fallback', () => {
  assert.equal(showLine({ title: 'Orbit Station', season: 1, episode: 4 }), 'Orbit Station · S1 E4');
  assert.equal(showLine({ title: '', season: 1, episode: 4 }, 'Watch Orbit Station - Season 1 | Prime Video'), 'Orbit Station · S1 E4');
  assert.equal(showLine(null, 'Watch Lighthouse | Prime Video'), 'Lighthouse');
  assert.equal(cleanPageTitle('Watch Lighthouse Season 1 | Prime Video'), 'Lighthouse Season 1');
  assert.equal(viewerTime(t(62, 14)), '1:02:14'); assert.equal(viewerTime(t(32, 12, 517)), '32:12');
  assert.equal(findEditUrl('https://seamlessscene.com', { title: 'Orbit Station' }), 'https://seamlessscene.com/search?q=Orbit+Station');
});

test('Find an edit searches for the show when Prime reports only the season and episode (field testing 0.61.0)', () => {
  const origin = 'https://seamlessscene.com';
  // The idle menu read "Lighthouse Season 1 · S1 E1" but opened /search unfiltered.
  assert.equal(findEditUrl(origin, { title: '', season: 1, episode: 1 }, 'Watch Lighthouse Season 1 | Prime Video'), `${origin}/search?q=Lighthouse`);
  assert.equal(findEditUrl(origin, null, 'Watch Gatekeepers (Season 01) | Prime Video'), `${origin}/search?q=Gatekeepers`);
  assert.equal(findEditUrl(origin, undefined, 'Watch Orbit Station - Season 1 | Prime Video'), `${origin}/search?q=Orbit+Station`);
  assert.equal(findEditUrl(origin, { title: 'Night Shift', season: 1, episode: 2 }, 'Something else'), `${origin}/search?q=Night+Shift`, 'a reported title wins');
  assert.equal(findEditUrl(origin), `${origin}/search`, 'nothing known: the whole catalogue');
});

test('toolbar badge reads ON only while an edit is on; the tooltip names it', () => {
  for (const state of ['armed', 'active', 'paused']) {
    assert.equal(toolbarBadge(toolbarTone({ state })).text, 'ON', state);
    assert.equal(toolbarState({ state }, 'Harbor Lights').title, 'Seamless Scene · On: Harbor Lights');
  }
  for (const state of ['idle', 'loaded', 'finished', 'unavailable', 'restoring']) {
    assert.equal(toolbarBadge(toolbarTone({ state })).text, '', state);
    assert.equal(toolbarState({ state }, 'Harbor Lights').title, 'Seamless Scene · Off');
  }
  assert.doesNotMatch(JSON.stringify(['armed', 'active', 'idle'].map(state => toolbarBadge(toolbarTone({ state })))), /SET/);
});

test('an edit already loaded and checked turns on directly with Watch with edit', () => {
  const loaded = controller('loaded', { ...edit, canArm: true, scenes: scenes([]) });
  const view = viewerView({ playback: loaded, prefs: {} });
  assert.equal(view.kind, 'ready'); assert.equal(view.armDirect, true);
  assert.match(menu(loaded).text, /Ready to watch: Harbor Lights · v1 Watch with edit/);
  assert.equal(popup(loaded).edit, 'Harbor Lights · v1 downloaded');
});

test('E50: Try again on an owner-busy Problem repeats the same edit, and a chooser replaces a stale Problem', () => {
  const idle = controller('idle');
  const load = { state: 'failed', busy: false, error: 'viewer-owner-busy', releaseId: release, failedAt: Date.now() };
  const failed = menu(idle, { load, matches: [m1, m2] });
  assert.equal(failed.view.kind, 'problem');
  assert.equal(failed.view.releaseId, release, 'the retry names the edit whose load failed');
  assert.match(failed.html, new RegExp(`data-act="watch" data-arg="${release}" data-k="fix"`));
  const view = viewerView({ playback: idle, matches: [m1, m2], load, prefs: {} });
  assert.deepEqual(popupPlan(view, { account: { state: 'saved' } }).main, { act: 'watch', label: 'Watch with edit', releaseId: release });
  // A failed command keeps the edit it asked for.
  const commandFailed = viewerView({ playback: idle, matches: [m1, m2], prefs: {}, problem: 'viewer-owner-busy', problemReleaseId: other });
  assert.equal(commandFailed.releaseId, other);
  // A fix that is not a retry never carries an edit.
  const relink = viewerView({ playback: idle, prefs: {}, load: { ...load, error: 'viewer-account-link-required' } });
  assert.equal(relink.releaseId, undefined);
  // Once the service drops the failed load (a chooser was returned), the choices show again.
  assert.equal(viewerView({ playback: idle, matches: [m1, m2], load: null, prefs: {} }).kind, 'choose');
});

test('E51: the same episode under a new Prime title ID gets its own sentence and the Find fix', () => {
  const p = problemFor('viewer-title-id-changed');
  assert.equal(p.code, 'viewer-title-id-changed');
  assert.match(p.sentence, /different title ID/);
  assert.equal(p.fix.act, 'find');
  // A real case: the manifest names one title ID, Prime now plays another for the same S1E1.
  const expected = { serviceContentId: 'amzn1.dv.gti.b4689d1b-576e-41be-8564-68a3dd914a61', mediaType: 'episode', season: 1, episode: 1 };
  const observed = { activeItemId: 'amzn1.dv.gti.50946088-13e9-4b60-8edc-5948d3b66843', mediaType: 'episode', season: 1, episode: 1 };
  assert.equal(sameEpisodeOtherTitleId(observed, expected), true);
  assert.equal(sourceMismatchCode('active-item-mismatch', { titleIdChanged: true }), 'viewer-title-id-changed');
  for (const other of [{ ...observed, episode: 2 }, { ...observed, season: 2 }, { ...observed, mediaType: 'film', season: null, episode: null }, { ...observed, activeItemId: expected.serviceContentId }])
    assert.equal(sameEpisodeOtherTitleId(other, expected), false, JSON.stringify(other));
  assert.equal(sourceMismatchCode('active-item-mismatch'), 'viewer-episode-mismatch', 'another episode keeps its own sentence');
  assert.equal(sourceMismatchCode('runtime-mismatch', { titleIdChanged: true }), 'viewer-runtime-mismatch');
  assert.equal(viewerFailureMessage(Error('viewer-title-id-changed')), p.sentence);
  // Page links name a title for discovery only.
  assert.equal(primeTitleId('https://www.amazon.com/gp/video/detail/amzn1.dv.gti.b4689d1b-576e-41be-8564-68a3dd914a61/ref=atv'), expected.serviceContentId);
  assert.equal(primeTitleId('https://www.primevideo.com/detail/?gti=amzn1.dv.gti.f14ea779-920d-4779-8429-0ce2ed6d1705'), 'amzn1.dv.gti.f14ea779-920d-4779-8429-0ce2ed6d1705');
  for (const url of ['https://evil.test/gp/video/detail/amzn1.dv.gti.b4689d1b-576e-41be-8564-68a3dd914a61', 'http://www.amazon.com/gp/video/detail/B0F27FEF3C', 'not a url', null])
    assert.equal(primeTitleId(url), null, String(url));
});
