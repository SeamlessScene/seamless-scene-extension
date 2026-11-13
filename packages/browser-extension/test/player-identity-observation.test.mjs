import test from 'node:test';
import assert from 'node:assert/strict';
import { observePlayerIdentity, freshPlayerIdentityObservation, sessionCheckIn, PLAYER_IDENTITY_FRESH_MS } from '../src/player-identity-observation.mjs';

function fixture() {
  const player = {};
  return { getPlayer: () => player, getSource: () => 1,
    readIdentity: async () => ({ activeItemId: 'local-only-item' }),
    usableIdentity: identity => Boolean(identity?.activeItemId), now: () => 100_000 };
}

test('identity observations distinguish observed absence, missing ID and identified player', async () => {
  const f = fixture();
  assert.deepEqual((await observePlayerIdentity(f)).observation, { state: 'identified', observedAt: 100_000 });
  assert.equal((await observePlayerIdentity({ ...f, readIdentity: async () => ({ activeItemId: null }) })).observation.state, 'missing-id');
  assert.equal((await observePlayerIdentity({ ...f, getPlayer: () => null })).observation.state, 'no-player');
  assert.equal((await observePlayerIdentity({ ...f, getPlayer: () => null, readIdentity: async () => { throw Error('unavailable'); } })).observation.state, 'no-player');
});

test('failed player/identity probes remain unknown without changing returned playback identity', async () => {
  const f = fixture();
  const failedPlayer = await observePlayerIdentity({ ...f, getPlayer: () => { throw Error('probe'); } });
  assert.equal(failedPlayer.observation.state, 'unknown');
  assert.deepEqual(failedPlayer.identity, { activeItemId: 'local-only-item' });
  assert.equal((await observePlayerIdentity({ ...f, readIdentity: async () => { throw Error('identity'); } })).observation.state, 'unknown');
  assert.equal((await observePlayerIdentity({ ...f, usableIdentity: () => { throw Error('malformed'); } })).observation.state, 'unknown');
});

for (const change of ['player', 'source', 'closed']) test(`an awaited identity cannot certify a changed ${change}`, async () => {
  let player = {}, source = 1, closed = false, release, started;
  const began = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const task = observePlayerIdentity({ ...fixture(), getPlayer: () => player, getSource: () => source,
    isClosed: () => closed, readIdentity: async () => { started(); await pending; return {activeItemId:'old'}; } });
  await began;
  if (change === 'player') player = {};
  if (change === 'source') source++;
  if (change === 'closed') closed = true;
  release();
  const result = await task;
  assert.equal(result.observation.state, 'unknown');
  assert.deepEqual(result.identity, {activeItemId:'old'}, 'diagnostics do not redefine playback identity handling');
});

test('only fresh exact enum observations enter the worker cache', () => {
  const now = 100_000;
  for (const state of ['identified','missing-id','no-player','unknown']) {
    assert.deepEqual(freshPlayerIdentityObservation({state,observedAt:now},now), {state,observedAt:now});
  }
  for (const value of [null, [], {}, {state:'identified'}, {state:'garbage',observedAt:now},
    {state:'identified',observedAt:now,sourceKey:'private'}, {state:'identified',observedAt:now+1},
    {state:'identified',observedAt:NaN}, {state:'identified',observedAt:now-PLAYER_IDENTITY_FRESH_MS}]) {
    assert.equal(freshPlayerIdentityObservation(value,now),null);
  }
});

test('session body allowlists only an enum, never provider objects or identifiers', () => {
  assert.deepEqual(sessionCheckIn({clientVersion:'0.60.0'}), {disconnect:false,clientVersion:'0.60.0'});
  for (const value of ['identified','missing-id','no-player','unknown']) {
    assert.deepEqual(sessionCheckIn({getPlayerIdentityState:()=>value}), {disconnect:false,playerIdentityState:value});
  }
  for (const value of [{state:'identified',title:'private'}, 'x'.repeat(10000), null, undefined]) {
    assert.deepEqual(sessionCheckIn({getPlayerIdentityState:()=>value}), {disconnect:false,playerIdentityState:'unknown'});
  }
  assert.deepEqual(sessionCheckIn({getPlayerIdentityState:()=>{throw Error('probe');}}), {disconnect:false,playerIdentityState:'unknown'});
});
