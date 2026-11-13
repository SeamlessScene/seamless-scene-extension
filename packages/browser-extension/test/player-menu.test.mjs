import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicPlayback } from '../src/viewer-model.mjs';
import { viewerView, shortDuration, sceneList } from '../src/viewer-display.mjs';
import { menuMarkup, mountViewerOverlay, scrollPositions, restoreScroll, followTop } from '../src/viewer-overlay.mjs';

const t = (m, s, ms = 0) => (m * 60 + s) * 1000 + ms;
const starts = [t(7, 3), t(9, 0), t(12, 30), t(26, 8)];
const scene = (i, status, extra = {}) => ({ type: 'REPLACE', startMs: starts[i], resumeMs: starts[i] + 30_000, lengthMs: 42_000, status, ...extra });
const playback = (state, statuses, extra = {}) => publicPlayback({ state, sourceKey: 'k', editId: 'e', version: '1', canStop: true,
  scenes: statuses.map((status, i) => scene(i, status)), ...extra });
const line = view => `${view.status.strong}${view.status.rest}`;
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('durations: "Ys" under a minute, else "Xm Ys"; a countdown rounds up', () => {
  assert.equal(shortDuration(0), '0s');
  assert.equal(shortDuration(42_000), '42s');
  assert.equal(shortDuration(59_400), '59s');
  assert.equal(shortDuration(72_000), '1m 12s');
  assert.equal(shortDuration(600_000), '10m 0s');
  assert.equal(shortDuration(41_001, { roundUp: true }), '42s');
  assert.equal(shortDuration(42_000, { roundUp: true }), '42s');
  assert.equal(shortDuration(-1), ''); assert.equal(shortDuration(NaN), '');
});

test('one-line status for every state', () => {
  // Before the first scene and between scenes.
  assert.equal(line(viewerView({ playback: playback('armed', ['pending', 'pending', 'pending', 'pending'], { currentTimeMs: t(5, 51) }) })), 'Next: 1 of 4 in 1m 12s');
  assert.equal(line(viewerView({ playback: playback('armed', ['played', 'pending', 'pending', 'pending'], { currentTimeMs: t(8, 59, 100) }) })), 'Next: 2 of 4 in 1s');
  assert.equal(line(viewerView({ playback: playback('armed', ['played', 'pending', 'pending', 'pending']) })), 'Next: 2 of 4 at 9:00', 'no clock: the start time');
  // Playing: time left in the clip before the original comes back.
  assert.equal(line(viewerView({ playback: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: t(9, 0), sceneTimeMs: 0 }) })), 'Playing 2 of 4 (42s)');
  assert.equal(line(viewerView({ playback: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: t(9, 0), sceneTimeMs: 29_500 }) })), 'Playing 2 of 4 (13s)');
  assert.equal(line(viewerView({ playback: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: t(9, 0) }) })), 'Playing 2 of 4', 'no clip clock: no count');
  const mute = publicPlayback({ state: 'active', sourceKey: 'k', editId: 'e', canStop: true, currentTimeMs: t(9, 10),
    scenes: [{ type: 'MUTE', startMs: t(9, 0), resumeMs: t(10, 30), status: 'playing' }] });
  assert.equal(line(viewerView({ playback: mute })), 'Playing 1 of 1 (1m 20s)', 'a muted stretch counts down on the episode clock');
  // Behind, none ahead, finished.
  assert.equal(line(viewerView({ playback: playback('armed', ['skipped', 'skipped', 'pending', 'pending'], { skippedCount: 2, currentTimeMs: t(12, 0) }) })), 'Next: 3 of 4 in 30s · 2 behind');
  assert.equal(line(viewerView({ playback: playback('armed', ['played', 'played', 'played', 'played'], { currentTimeMs: t(30, 0) }) })), 'No more scenes ahead');
  assert.equal(line(viewerView({ playback: playback('finished', ['played', 'played', 'played', 'played']) })), 'Finished 4 of 4');
  for (const view of [viewerView({ playback: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: 0, sceneTimeMs: 0 }) })])
    assert.equal(view.popupSub, line(view), 'the popup says the same');
});

test('the progress bar shows the whole time an edit is on or finished, never for a preview', () => {
  const states = {
    before: playback('armed', ['pending', 'pending', 'pending', 'pending'], { currentTimeMs: 0 }),
    between: playback('armed', ['played', 'pending', 'pending', 'pending'], { currentTimeMs: t(8, 0) }),
    playing: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: t(9, 0), sceneTimeMs: 1000 }),
    paused: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: t(9, 0), paused: true }),
    behind: playback('armed', ['skipped', 'skipped', 'pending', 'pending'], { skippedCount: 2, currentTimeMs: t(12, 0) }),
    ahead: playback('armed', ['played', 'played', 'played', 'played'], { currentTimeMs: t(30, 0) }),
    finished: playback('finished', ['played', 'played', 'played', 'played'])
  };
  for (const [name, s] of Object.entries(states)) {
    const view = viewerView({ playback: s });
    assert.ok(view.progress && view.progress.total === 4, name);
    assert.match(menuMarkup(view).body, /class="prog".*scenes played/, `${name}: bar in the menu`);
  }
  const preview = publicPlayback({ state: 'armed', sourceKey: 'k', editId: 'e', preview: true, previewName: 'Scene 1', currentTimeMs: 0, scenes: [scene(0, 'pending')] });
  assert.equal(viewerView({ playback: preview }).progress, null);
});

test('scene list rows: number, start and watched length; (cut) for a Cut; no action word', () => {
  const s = publicPlayback({ state: 'armed', sourceKey: 'k', editId: 'e', canStop: true, currentTimeMs: 0, scenes: [
    { type: 'REPLACE', startMs: t(7, 3), resumeMs: t(7, 40), lengthMs: 42_000, status: 'pending' },
    { type: 'INSERT', startMs: t(9, 0), resumeMs: t(9, 0), lengthMs: 95_400, status: 'pending' },
    { type: 'MUTE', startMs: t(10, 0), resumeMs: t(10, 7), status: 'pending' },
    { type: 'SKIP', startMs: t(11, 0), resumeMs: t(11, 30), status: 'pending' },
    { type: 'REPLACE', startMs: t(12, 0), resumeMs: t(12, 30), status: 'pending' }] });
  assert.deepEqual(sceneList(s).map(x => x.duration), ['42s', '1m 35s', '7s', 'cut', '']);
  const rows = text(menuMarkup(viewerView({ playback: s })).body);
  assert.match(rows, /1 7:03 \(42s\) next 2 9:00 \(1m 35s\) 3 10:00 \(7s\) 4 11:00 \(cut\) 5 12:00/);
  assert.doesNotMatch(rows, /Replaced|Added|Muted|· Cut/);
  assert.match(menuMarkup(viewerView({ playback: s })).body, /title="Replaced · Jumps to/, 'the type stays in the tooltip');
  assert.equal(publicPlayback({ scenes: [{ type: 'REPLACE', startMs: 1, resumeMs: 2, lengthMs: -5 }] }).scenes[0].lengthMs, undefined);
  assert.equal(publicPlayback({ sceneTimeMs: 'x' }).sceneTimeMs, undefined);
  assert.equal(publicPlayback({ sceneTimeMs: 1200 }).sceneTimeMs, 1200);
});

test('stable menu: one-line status, name and progress text, and a reserved feedback line', async () => {
  const source = await readFile(new URL('../src/viewer-overlay.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.status\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:1\.4em/);
  assert.match(source, /\.ename\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  assert.match(source, /\.feedback\{[^}]*white-space:nowrap[^}]*min-height:1\.4em\}/);
  assert.doesNotMatch(source, /\.feedback:empty\{display:none\}/);
  assert.match(source, /#menu\{[^}]*width:min\(340px,calc\(100vw - 40px\)\)/, 'fixed width');
  const view = viewerView({ playback: playback('active', ['played', 'playing', 'pending', 'pending'], { currentTimeMs: 0, sceneTimeMs: 0 }) });
  const quiet = menuMarkup(view).body, busy = menuMarkup(view, { feedback: 'Jumping to the next scene…' }).body;
  assert.match(quiet, /<p class="feedback"><\/p>/, 'the line is there while empty');
  assert.equal(quiet.split('<').length, busy.split('<').length, 'the same elements with or without feedback');
  assert.match(quiet, /<p class="status" title="Playing 2 of 4 \(42s\)">/);
});

test('scroll helpers keep a list position and bring a scene into view only when needed', () => {
  const list = { dataset: { scroll: 'scenes' }, scrollTop: 640 };
  const container = { querySelectorAll: () => [list] };
  const saved = scrollPositions(container);
  assert.deepEqual(saved, { scenes: 640 });
  const fresh = { dataset: { scroll: 'scenes' }, scrollTop: 0 };
  assert.deepEqual(restoreScroll({ querySelectorAll: () => [fresh] }, saved), [fresh]);
  assert.equal(fresh.scrollTop, 640);
  assert.equal(followTop({ scrollTop: 0, height: 190, itemTop: 72, itemHeight: 38 }), null, 'visible: leave it');
  assert.equal(followTop({ scrollTop: 0, height: 190, itemTop: 1900, itemHeight: 38 }), 1786);
  assert.equal(followTop({ scrollTop: 1000, height: 190, itemTop: 380, itemHeight: 38 }), 342);
});

// A page whose menu body really is re-rendered: each write makes a new scene list at the top.
function page() {
  const listeners = { root: {}, document: {} };
  const node = id => ({ id, dataset: {}, style: {}, hidden: id === 'menu' || id === 'rail', attrs: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, focus() {}, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {}, remove() {}, innerHTML: '' });
  const nodes = new Map(['chip', 'menu', 'rail', 'live', 'head'].map(id => [id, node(id)]));
  const body = node('body'); let html = '', list = null, writes = 0;
  const makeList = markup => {
    const items = [...markup.matchAll(/<li class="([^"]*)" data-index="(\d+)"/g)].map(([, mark, index]) => ({ mark, dataset: { index }, offsetTop: Number(index) * 38, offsetHeight: 38 }));
    return { dataset: { scroll: 'scenes' }, scrollTop: 0, clientHeight: 190, items,
      querySelector(q) { const mark = q.match(/li\.(\w+)/)?.[1]; return items.find(i => i.mark === mark) ?? null; } };
  };
  Object.defineProperty(body, 'innerHTML', { get: () => html, set(v) { html = v; writes += 1; list = /data-scroll="scenes"/.test(v) ? makeList(v) : null; } });
  body.querySelector = q => q === '[data-scroll="scenes"]' ? list : null;
  body.querySelectorAll = q => q === '[data-scroll]' && list ? [list] : [];
  nodes.set('body', body);
  const root = { activeElement: null, set innerHTML(v) {}, querySelector: q => nodes.get(q.slice(1)) ?? null, addEventListener: (k, f) => { listeners.root[k] = f; } };
  const host = { style: {}, hidden: false, parentNode: null, classList: { add() {}, remove() {} }, attachShadow: () => root, remove() { this.parentNode = null; } };
  const bodyEl = { append(h) { h.parentNode = bodyEl; } };
  const document = { body: bodyEl, fullscreenElement: null, createElement: () => host, addEventListener: (k, f) => { listeners.document[k] = f; }, removeEventListener() {} };
  return { document, nodes, listeners, list: () => list, writes: () => writes,
    userScroll(top) { list.scrollTop = top; listeners.root.scroll({ target: list }); } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
const many = (playingIndex, extra = {}) => publicPlayback({ state: 'active', sourceKey: 'k', editId: 'e', canStop: true, currentTimeMs: 0, sceneTimeMs: 0,
  scenes: Array.from({ length: 80 }, (_, i) => ({ type: 'REPLACE', startMs: i * 60_000, resumeMs: i * 60_000 + 30_000, lengthMs: 42_000,
    status: i < playingIndex ? 'played' : i === playingIndex ? 'playing' : 'pending' })), ...extra });

test('the scene list keeps the viewer\'s scroll position when the menu re-renders after a scene', async t => {
  const p = page(); let state = many(10);
  const overlay = mountViewerOverlay({ document: p.document, read: async () => state, command: async () => ({}), openSettings() {}, version: '0.62.9' });
  t.after(() => overlay.close());
  overlay.preferences({ overlay: 'minimal', corner: 'left' }); await turn(); await turn();
  p.nodes.get('chip').onclick(); await turn(); await turn();
  assert.ok(p.list(), 'the list is shown');
  // Before the viewer scrolls, the playing scene is brought into view.
  assert.equal(p.list().scrollTop, 10 * 38 + 76 - 190, 'scene 11 in view');
  p.userScroll(1500);
  const before = p.writes();
  state = many(11); overlay.preferences({ overlay: 'minimal', corner: 'left' }); await turn(); await turn();
  assert.ok(p.writes() > before, 'the body was rewritten');
  assert.equal(p.list().scrollTop, 1500, 'kept where the viewer left it, not back at the top');
  state = many(12, { sceneTimeMs: 5000 }); overlay.preferences({ overlay: 'minimal', corner: 'left' }); await turn(); await turn();
  assert.equal(p.list().scrollTop, 1500, 'never yanked to the playing scene once the viewer has scrolled');
});
