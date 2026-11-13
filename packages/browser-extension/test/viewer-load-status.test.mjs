import test from 'node:test';
import assert from 'node:assert/strict';
import {loadStatusMessage} from '../src/viewer-load-status.mjs';
test('download percentages require valid measured byte totals and stages remain distinct',()=>{
 assert.equal(loadStatusMessage({state:'downloading',bytes:7,total:20}),'Downloading · 35% · 7 of 20 B');
 assert.equal(loadStatusMessage({state:'downloading',bytes:12_300_000,total:29_100_000}),'Downloading · 42% · 12.3 of 29.1 MB');
 for(const [bytes,total] of [[0,0],[21,20],[-1,20],[1,NaN]])assert.equal(loadStatusMessage({state:'downloading',bytes,total}),'Downloading…');
 assert.match(loadStatusMessage({state:'opening'}),/storage/);
 assert.match(loadStatusMessage({state:'requesting'}),/Asking Seamless Scene/);
 assert.match(loadStatusMessage({state:'licensing'}),/Unlocking/);
 assert.match(loadStatusMessage({state:'verifying'}),/Checking the edit/);
 // Codes are details for support, never part of the sentence.
 assert.equal(loadStatusMessage({state:'failed',error:'viewer-link-check-offline'}),'Seamless Scene cannot be reached to check your account connection. Check your internet connection, then try again.');
 assert.doesNotMatch(loadStatusMessage({state:'failed',error:'viewer-link-check-offline'}),/Code|viewer-/);
 assert.equal(loadStatusMessage({state:'failed',error:'viewer-unknown-thing'}),'Loading failed. Try again, or copy the details for support.');
 assert.equal(loadStatusMessage({state:'ready'}),'Ready');
 assert.doesNotMatch(loadStatusMessage({state:'failed',error:'https://private.test/token'}),/private|token/);
});
