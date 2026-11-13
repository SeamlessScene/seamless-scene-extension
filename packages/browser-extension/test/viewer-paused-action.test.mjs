import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerPaused, publicPlayback, indicator } from '../src/viewer-model.mjs';

const badge = (state, playback) => indicator(publicPlayback({state, paused:viewerPaused(playback)}));

for (const actionType of ['INSERT', 'REPLACE']) {
  test(`${actionType} badge follows local pause/resume while native stays paused`, () => {
    const playback = {actionType, nativePaused:true, localControllable:true, localPaused:false};
    assert.deepEqual(badge('active', playback), {tone:'on', symbol:'▶', chip:'On', label:'Seamless Scene: On · playing a scene'});
    playback.localPaused = true;
    assert.deepEqual(badge('active', playback), {tone:'on', symbol:'Ⅱ', chip:'On', label:'Seamless Scene: On · paused'});
    playback.localPaused = false;
    assert.equal(badge('active', playback).label, 'Seamless Scene: On · playing a scene');
    assert.equal(playback.nativePaused, true);
  });
}

test('preparing/restoring local actions ignore the covered native pause and stale local pause', () => {
  for (const actionType of ['INSERT', 'REPLACE']) {
    assert.equal(badge('active', {actionType, nativePaused:true, localControllable:false, localPaused:true}).label, 'Seamless Scene: On · playing a scene');
    assert.equal(viewerPaused({actionType, nativePaused:true}), false);
  }
});

test('mute, ordinary armed playback and cleanup use native pause state', () => {
  for (const actionType of ['MUTE', undefined]) {
    const playback = {actionType, nativePaused:true, localControllable:false, localPaused:false};
    assert.equal(badge('active', playback).label, 'Seamless Scene: On · paused');
    playback.nativePaused = false;
    assert.equal(badge('active', playback).label, 'Seamless Scene: On · playing a scene');
    playback.localPaused = true;
    assert.equal(badge('armed', playback).label, 'Seamless Scene: On · waiting for the next scene');
    playback.nativePaused = true;
    assert.equal(badge('armed', playback).label, 'Seamless Scene: On · paused');
    assert.equal(badge('idle', playback).label, 'Seamless Scene: Off');
  }
});
