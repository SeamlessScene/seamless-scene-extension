import {test} from 'node:test';import assert from 'node:assert/strict';
import {formatPlayhead} from '../src/viewer-model.mjs';
test('playhead formats to the millisecond and rejects non-times',()=>{assert.equal(formatPlayhead(441785),'0:07:21.785');assert.equal(formatPlayhead(3010634),'0:50:10.634');assert.equal(formatPlayhead(0),'0:00:00.000');assert.equal(formatPlayhead(NaN),'');assert.equal(formatPlayhead(-5),'');});
