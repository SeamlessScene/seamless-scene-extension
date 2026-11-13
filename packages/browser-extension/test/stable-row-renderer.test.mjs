import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableRowRenderer } from '../src/stable-row-renderer.mjs';

// DOM ownership double: detachment loses focus. Assert user interaction and
// current handler data, rather than requiring a particular sequence of DOM calls.
function fixture() {
  const container = { children: [], mutations: 0, focused: null,
    insertBefore(node, at) {
      this.mutations++;
      if (this.children.includes(node)) node.remove();
      this.children.splice(at === null ? this.children.length : this.children.indexOf(at), 0, node);
    } };
  const created = [];
  const render = createStableRowRenderer(container, row => {
    if (row.fail) throw Error('render-failed');
    const node = { row, checked: false, disabled: false, invoke: () => row.updateReleaseId,
      remove() { container.mutations++; container.children.splice(container.children.indexOf(this), 1); if (container.focused === this) container.focused = null; } };
    created.push(node); return node;
  });
  return { container, created, render };
}
const row = (releaseId, extra = {}) => ({ releaseId, name: `Edit ${releaseId}`, ...extra });

test('idle refresh preserves focused, selected and pending controls without DOM mutations', () => {
  const f = fixture(), rows = [row('a'), row('b')]; f.render(rows);
  const first = f.container.children[0]; first.checked = true; first.disabled = true; f.container.focused = first;
  const mutations = f.container.mutations;
  for (let i = 0; i < 10; i++) f.render(structuredClone(rows));
  assert.equal(f.container.focused, first); assert.equal(first.checked, true); assert.equal(first.disabled, true);
  assert.equal(f.container.mutations, mutations); assert.equal(f.created.length, 2);
});

test('a changed neighboring row updates its handler without replacing unchanged controls', () => {
  const f = fixture(); f.render([row('a'), row('b', { updateReleaseId: 'old' })]);
  const first = f.container.children[0]; f.container.focused = first;
  f.render([row('a'), row('b', { updateReleaseId: 'new' })]);
  assert.equal(f.container.focused, first); assert.equal(f.container.children[0], first);
  assert.equal(f.container.children[1].invoke(), 'new');
});

test('removed entries disappear and later reappearance uses fresh data', () => {
  const f = fixture(); f.render([row('a'), row('b')]); const first = f.container.children[0];
  f.render([row('b')]); assert.deepEqual(f.container.children.map(n => n.row.releaseId), ['b']);
  f.render([row('a'), row('b')]); assert.notEqual(f.container.children[0], first);
  assert.deepEqual(f.container.children.map(n => n.row.releaseId), ['a', 'b']);
});

test('a failed preparation leaves the live list and cache usable for retry', () => {
  const f = fixture(); f.render([row('a')]); const first = f.container.children[0]; f.container.focused = first;
  assert.throws(() => f.render([row('a', { name: 'Changed' }), row('b', { fail: true })]), /render-failed/);
  assert.equal(f.container.children[0], first); assert.equal(f.container.focused, first);
  f.render([row('a')]); assert.equal(f.container.children[0], first);
  assert.throws(() => f.render([row('a'), row('a')]), /row-identity-invalid/);
});
