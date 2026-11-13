import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadedRows, downloadRows, storageSummary, formatBytes, followedNotice, handoffNotice } from '../src/edits-model.mjs';
import { loadStatusMessage, mirroredLoadNotice } from '../src/viewer-load-status.mjs';
import { readFile } from 'node:fs/promises';

const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n, extra = {}) => ({ id: id(n), origin: 'website', transport: 'protected', title: `Edit ${n}`, version: '1', ...extra });

test('the library lists only downloaded edits, each with one status in priority order', () => {
  const rows = downloadedRows({
    library: [item(1, { name: 'Bar fight', creatorName: 'Maker', streamingUrl: 'https://www.amazon.com/gp/video/detail/B04A826A41', lastWatchedAt: 5 }), item(2), item(3), item(4), item(5), item(6), item(7)],
    vault: [{ releaseId: id(1), bytes: 2e9 }, { releaseId: id(3), bytes: 1e9, problem: 'vault-object-size' }, { releaseId: id(4), bytes: 1e9 }, { releaseId: id(5), bytes: 1e9 }],
    jobs: [{ releaseId: id(2), state: 'downloading', bytes: 450, total: 1000 }, { releaseId: id(6), state: 'failed' }],
    updates: { [id(4)]: { latestReleaseId: id(40), latestVersion: 2, availability: 'available' }, [id(5)]: { latestReleaseId: id(5), availability: 'withdrawn' } }
  });
  const by = n => rows.find(r => r.releaseId === id(n));
  assert.deepEqual(rows.map(r => r.releaseId).sort(), [id(1), id(3), id(4), id(5)], 'not-downloaded, downloading and failed edits are not library rows');
  assert.equal(by(1).status.kind, 'ready'); assert.equal(by(1).status.label, 'Ready'); assert.equal(by(1).creator, 'Maker'); assert.deepEqual(by(1).actions, ['watch', 'remove']);
  assert.equal(by(3).status.kind, 'corrupt'); assert.ok(by(3).actions.includes('repair'));
  assert.equal(by(4).status.label, 'Update to v2'); assert.ok(by(4).actions.includes('update'));
  assert.equal(by(5).status.kind, 'unavailable');
  assert.equal(rows[0].releaseId, id(1), 'most recently watched first');
});

test('a kept edit the library does not know is listed; a busy vault lists recorded downloads without a false status', () => {
  const rows = downloadedRows({ library: [], vault: [{ releaseId: id(9), bytes: 10 }] });
  assert.equal(rows[0].name, 'Edit from the website', 'never a short release ID'); assert.equal(rows[0].status.kind, 'ready');
  assert.deepEqual(downloadedRows({ library: [item(1)], vault: null }), [], 'never downloaded');
  assert.equal(downloadedRows({ library: [item(1, { downloadedAt: 1 })], vault: null })[0].status.kind, 'unknown');
});

test('storage summaries', () => {
  assert.equal(formatBytes(3_200_000_000), '3.2 GB'); assert.equal(formatBytes(512), '512 B');
  assert.match(storageSummary({ vault: [{ bytes: 3.2e9 }], budgetBytes: 10e9, estimate: { quota: 20e9, usage: 8e9 } }).label, /Using 3.2 GB of 10.0 GB · 12.0 GB free/);
});

test('downloads in progress and failed downloads have their own rows with phase, percentage and code', () => {
  const rows = downloadRows({ library: [item(1, { name: 'Highlights' })], vault: [{ releaseId: id(3), bytes: 1 }], jobs: [
    { releaseId: id(1), state: 'downloading', bytes: 25_000_000, total: 100_000_000 },
    { releaseId: id(2), state: 'failed', error: 'viewer-account-link-required' },
    { releaseId: id(3), state: 'licensing' },
    { releaseId: id(4), state: 'requesting', bytes: 0, total: 0 },
    { releaseId: id(5), state: 'ready' }
  ] });
  assert.deepEqual(rows.map(r => r.releaseId), [id(1), id(2), id(4)], 'kept and finished jobs are not download rows');
  const [downloading, failed, requesting] = rows;
  assert.equal(downloading.name, 'Highlights'); assert.equal(downloading.status.label, 'Downloading · 25% · 25.0 of 100 MB'); assert.equal(downloading.status.percent, 25);
  assert.match(failed.status.label, /not connected/); assert.doesNotMatch(failed.status.label, /Code|viewer-/); assert.deepEqual(failed.actions, ['retry', 'clear']);
  assert.equal(requesting.status.label, 'Asking Seamless Scene for the edit…'); assert.equal(requesting.status.percent, null);
});

test('the Library notice follows its download to the end and never keeps a finished job\'s progress text', async () => {
  const release = id(40), start = { releaseId: release, progress: null };
  // Not listed yet (the request is still on its way): nothing changes.
  assert.deepEqual(followedNotice(start, [], 'Waiting to start…'), { following: start });
  // The service could not be read: nothing changes.
  assert.deepEqual(followedNotice(start, null, 'Waiting to start…'), { following: start });
  // In progress: the text is shown and remembered.
  const checking = followedNotice(start, [{ releaseId: release, state: 'checking', bytes: 73, total: 75, etaMs: 900 }], 'Waiting to start…');
  assert.equal(checking.text, 'Checking clips 73 of 75 · about 1 s left');
  assert.deepEqual(checking.following, { releaseId: release, progress: checking.text });
  // Finished while still listed: "Ready", and the notice is no longer followed.
  assert.deepEqual(followedNotice(checking.following, [{ releaseId: release, state: 'ready', bytes: 75, total: 75 }], checking.text), { text: 'Ready', following: null });
  // The job is gone by the next look (the page was in the background while it finished): the
  // progress text goes with it.
  assert.deepEqual(followedNotice(checking.following, [{ releaseId: id(41), state: 'downloading', bytes: 1, total: 2 }], checking.text), { text: '', following: null });
  // Another message has replaced the progress text meanwhile: it is left alone.
  assert.deepEqual(followedNotice(checking.following, [], 'The edit was kept.'), { following: null });
  // The page uses this for its notice (and no longer leaves a missing job's text in place).
  const page = await readFile(new URL('../edits-page.mjs', import.meta.url), 'utf8');
  assert.match(page, /followedNotice\(followed, snapshot\?\.jobs \?\? null/);
  assert.doesNotMatch(page, /noticeRelease/);
});

// Settings' notice as viewer.mjs drives it from each snapshot's load (the same two calls).
function settingsNotice(start = '') {
  let shown = start, mirrored = null, showingLoad = false;
  return { get shown() { return shown; }, set(text) { shown = text; },
    refresh(load) {
      const progress = loadStatusMessage(load); let wrote = null;
      if ((load?.busy || showingLoad) && progress) { shown = progress; wrote = progress; }
      const settled = mirroredLoadNotice(mirrored, load, wrote, shown);
      if (settled.text !== undefined) shown = settled.text;
      mirrored = settled.mirrored; showingLoad = load?.busy === true;
      return shown;
    } };
}

test("Settings never keeps a player's load progress line after the load is over (0.66.2: \"Checking clips 6 of 8 · about 1 s left\" above a Ready Library)", async () => {
  const checking = { state: 'checking', busy: true, bytes: 6, total: 8, etaMs: 900 }, line = 'Checking clips 6 of 8 · about 1 s left';
  // Library Watch: the title loads the edit while Settings is in the background and sees one
  // progress report; when the viewer is back the load is gone (the player tab was closed).
  let page = settingsNotice('Opening the title. The edit turns on when you press play.');
  assert.equal(page.refresh(checking), line);
  assert.equal(page.refresh(null), '', 'the progress line goes with the load');
  assert.equal(page.refresh(null), '');
  // The load is still known but idle, with nothing to say.
  page = settingsNotice(); page.refresh(checking);
  assert.equal(page.refresh({ state: 'idle', busy: false, bytes: 0, total: 0 }), '');
  // It was seen to finish: "Ready" is shown and stays (it is a result, not progress).
  page = settingsNotice(); page.refresh(checking);
  assert.equal(page.refresh({ state: 'ready', busy: false, bytes: 8, total: 8 }), 'Ready');
  assert.equal(page.refresh(null), 'Ready');
  // It failed: the reason stays.
  page = settingsNotice(); page.refresh(checking);
  const failed = page.refresh({ state: 'failed', busy: false, error: 'viewer-download-stalled', bytes: 0, total: 0 });
  assert.ok(failed && failed !== line); assert.equal(page.refresh(null), failed);
  // Another message replaced the progress line meanwhile: it is left alone.
  page = settingsNotice(); page.refresh(checking); page.set('Every edit is up to date.');
  assert.equal(page.refresh(null), 'Every edit is up to date.');
  // Still busy: each new progress line replaces the last, and nothing is cleared between them.
  page = settingsNotice(); page.refresh(checking);
  assert.equal(page.refresh({ ...checking, bytes: 7 }), 'Checking clips 7 of 8 · about 1 s left');
  assert.equal(page.refresh({ state: 'arming', busy: true, bytes: 0, total: 0 }), 'Turning the edit on…');
  assert.equal(page.refresh(null), '');
  // No load was ever mirrored: an unrelated notice is never touched.
  page = settingsNotice('The edit was kept.');
  assert.equal(page.refresh(null), 'The edit was kept.');
  // The parts.
  assert.deepEqual(mirroredLoadNotice(null, checking, line, line), { mirrored: line });
  assert.deepEqual(mirroredLoadNotice(line, checking, null, line), { mirrored: line }, 'busy with nothing new to say: kept');
  assert.deepEqual(mirroredLoadNotice(line, null, null, line), { text: '', mirrored: null });
  assert.deepEqual(mirroredLoadNotice(line, null, null, 'Something else'), { mirrored: null });
  assert.deepEqual(mirroredLoadNotice(line, { state: 'ready', busy: false }, 'Ready', 'Ready'), { mirrored: null });
  // Settings uses it; the popup (which has #primary-action) does not.
  const viewer = await readFile(new URL('../viewer.mjs', import.meta.url), 'utf8');
  assert.match(viewer, /if \(!\$\('#primary-action'\)\) \{\s*const settled = mirroredLoadNotice\(mirroredLoad, snapshot\.load, wroteLoad, \$\('#notice'\)\?\.textContent \?\? ''\);/);
  assert.match(viewer, /message\(progress\); wroteLoad = progress;/);
});

test('a Watch hand-off line is cleared when the viewer comes back to Settings (0.66.2: "Opening the title…" stayed after the replacement had played)', async () => {
  const text = 'Opening the title. The edit turns on when you press play.';
  const visible = { hidden: false, focused: true }, hidden = { hidden: true, focused: false }, behind = { hidden: false, focused: false };
  // Written while Settings is still in front: it stays.
  let state = handoffNotice({ text }, visible, text);
  assert.deepEqual(state, { handoff: { text, hidden: false, blurred: false } });
  assert.deepEqual(handoffNotice(state.handoff, visible, text), state, 'nothing changes while the viewer has not left');
  // The title opens in a new tab: Settings is hidden. Still there (nobody is looking).
  state = handoffNotice(state.handoff, hidden, text);
  assert.deepEqual(state, { handoff: { text, hidden: true, blurred: true } });
  // Back on Settings after watching: cleared.
  assert.deepEqual(handoffNotice(state.handoff, visible, text), { text: '', handoff: null });
  // Shown again but without focus (an automated or background window): being shown again is enough.
  assert.deepEqual(handoffNotice(state.handoff, behind, text), { text: '', handoff: null });
  // The title was in another window: Settings stayed visible and only lost focus; cleared when focus returns.
  state = handoffNotice({ text }, behind, text);
  assert.deepEqual(state, { handoff: { text, hidden: false, blurred: true } });
  assert.deepEqual(handoffNotice(state.handoff, behind, text), state);
  assert.deepEqual(handoffNotice(state.handoff, visible, text), { text: '', handoff: null });
  // The reply arrived after the page was already hidden (the new tab opened first).
  state = handoffNotice({ text }, hidden, text);
  assert.deepEqual(handoffNotice(state.handoff, visible, text), { text: '', handoff: null });
  // Another message replaced it: left alone and forgotten.
  assert.deepEqual(handoffNotice(state.handoff, visible, 'Checking clips 6 of 8'), { handoff: null });
  assert.deepEqual(handoffNotice(null, visible, text), { handoff: null });
  // Both Watch buttons use it, and the page settles it on return and on each render.
  const page = await readFile(new URL('../edits-page.mjs', import.meta.url), 'utf8');
  assert.match(page, /noticeHandoff\(result\.message \?\? 'Opening the title\. The edit turns on when you press play\.'\)/);
  assert.match(page, /document\.addEventListener\('visibilitychange', settleHandoff\);\naddEventListener\('focus', settleHandoff\);/);
  assert.match(page, /followed = next\.following;\n  \}\n  settleHandoff\(\);/);
  assert.doesNotMatch(page, /[^a-zA-Z]notice\(result\.message \?\? 'Opening/);
  const local = await readFile(new URL('../src/local-tab.mjs', import.meta.url), 'utf8');
  assert.match(local, /noticeHandoff\(result\?\.message \?\? 'Opening the episode/);
});

