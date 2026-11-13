import test from 'node:test';
import assert from 'node:assert/strict';
import { installEvidenceExport } from '../src/playback-evidence-export.mjs';

function harness(readTimingReport, click = () => {}) {
  const nodes = new Map(), blobs = [], anchors = [], timers = [], revoked = [], output = {};
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { disabled: true, events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
    return nodes.get(selector);
  };
  installEvidenceExport({ shadow: { querySelector: node }, panelHost: { dataset: {} }, commandOutput: output,
    updateTrialSummary() {}, trials: {}, metrics: {}, getScheduler() { throw Error('must not touch playback'); },
    readTimingReport, Blob,
    document: { createElement() { const anchor = { click }; anchors.push(anchor); return anchor; } },
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:timing'; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(callback) { timers.push(callback); }
  });
  const button = node('[data-action="export-scene-timing"]');
  return { button, output, blobs, anchors, timers, revoked };
}

test('foreground timing export serializes the same report without touching playback', async () => {
  const report = { recordedAt: '2026-09-27T19:00:00.000Z', transitionCount: 2, transitions: [{ entry: { status: 'insufficient-evidence' } }] };
  const h = harness(async () => report);
  await h.button.events.click();
  assert.deepEqual(JSON.parse(await h.blobs[0].text()), report);
  assert.equal(h.anchors[0].download, 'scene-timing-2026-09-27T19-00-00-000Z.json');
  assert.equal(h.button.disabled, false);
  assert.match(h.output.textContent, /2 scenes recorded/);
  h.timers.forEach(fn => fn());
  assert.deepEqual(h.revoked, ['blob:timing']);
});

test('pending export suppresses duplicate clicks and a failure permits retry', async () => {
  let reject, calls = 0;
  const h = harness(() => { calls++; return new Promise((_resolve, no) => { reject = no; }); });
  const first = h.button.events.click();
  await h.button.events.click();
  assert.equal(calls, 1);
  assert.equal(h.button.disabled, true);
  reject(Error('PRIVATE-DETAIL'));
  await first;
  assert.equal(h.button.disabled, false);
  assert.equal(h.blobs.length, 0);
  assert.doesNotMatch(h.output.textContent, /PRIVATE/);
  const second = h.button.events.click();
  assert.equal(calls, 2);
  reject(Error('retry failure'));
  await second;
});

test('no samples do not create an empty success file or enable recording implicitly', async () => {
  const h = harness(async () => ({ transitionCount: 0 }));
  await h.button.events.click();
  assert.equal(h.blobs.length, 0);
  assert.equal(h.button.disabled, false);
  assert.match(h.output.textContent, /No scenes recorded yet/);
});

test('a failed download releases its allocated object URL', async () => {
  const h = harness(async () => ({ recordedAt: '2026-09-27', transitionCount: 1 }), () => { throw Error('download refused'); });
  await h.button.events.click();
  h.timers.forEach(fn => fn());
  assert.deepEqual(h.revoked, ['blob:timing']);
  assert.equal(h.button.disabled, false);
  assert.match(h.output.textContent, /could not be saved/);
});
