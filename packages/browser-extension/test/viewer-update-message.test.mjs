import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerFailureMessage } from '../src/viewer-model.mjs';

// Owner 2026-09-24: after updating, arming showed Chrome's "Extension context invalidated".
test('an extension update tells the viewer to refresh the tab, in plain words', () => {
  assert.equal(viewerFailureMessage(new Error('Extension context invalidated.')), 'Seamless Scene was updated. Refresh this tab to keep watching with edits.');
});
