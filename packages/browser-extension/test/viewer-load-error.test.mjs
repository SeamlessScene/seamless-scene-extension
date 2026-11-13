import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerLoadCode, viewerLoadMessage, isViewerLoadCode } from '../src/viewer-load-error.mjs';
import { validLocalMessage } from '../src/local-message-schema.mjs';
import { viewerFailureMessage } from '../src/viewer-model.mjs';

test('each import stage has an explicit safe fallback and private text never becomes a diagnostic code', () => {
  const codes = new Set();
  for (const stage of ['restoration', 'cleanup', 'owner', 'protected', 'catalog', 'packet', 'media', 'delivery']) {
    const code = viewerLoadCode(Error('file:///private/path?token=secret'), stage);
    codes.add(code); assert.equal(isViewerLoadCode(code), true);
    assert.equal(validLocalMessage({ type: 'import-error', code }, 'renderer'), true);
    assert.doesNotMatch(viewerLoadMessage(code), /private\/path|token=secret/);
  }
  assert.equal(codes.size, 8);
  for (const raw of ['viewer-arbitrary-secret', 'https://private.invalid', '__proto__', 'constructor']) {
    assert.equal(isViewerLoadCode(raw), false);
    assert.equal(validLocalMessage({ type: 'import-error', code: raw }, 'renderer'), false);
    assert.equal(viewerLoadCode(Error(raw)), 'viewer-packet-import-failed');
  }
});

test('descriptor refusal, ownership, storage and account errors keep actionable viewer meanings', () => {
  for (const [raw, code] of [['protected-release-unavailable', 'viewer-release-unavailable'], ['protected-owner-busy', 'viewer-owner-busy'],
    ['vault-budget-exceeded', 'viewer-budget-exceeded'], ['paired-session-required', 'viewer-account-link-required'], ['protected-download-stalled', 'viewer-download-stalled']]) {
    assert.equal(viewerLoadCode(Error(raw), 'protected'), code);
    assert.equal(viewerFailureMessage(Error(code)), viewerLoadMessage(code));
  }
});

test('pairing and local account failures retain actionable safe categories at owner setup', () => {
  for (const raw of ['catalog-protected-pairing-required', 'protected-offline-account-unavailable', 'protected-signout-race']) {
    assert.equal(viewerLoadCode(Error(raw), 'owner'), 'viewer-account-link-required');
  }
  for (const raw of ['protected-account-changed', 'protected-account-generation-changed']) assert.equal(viewerLoadCode(Error(raw), 'owner'), 'viewer-account-changed');
  // Each cause found on 2026-09-26 names its own step instead of one generic owner failure.
  for (const [raw, code] of [['extension-build-changed', 'viewer-extension-updated'], ['protected-renderer-not-authorized', 'viewer-player-not-active'],
    ['protected-link-removed', 'viewer-account-link-removed'], ['protected-link-check-offline', 'viewer-link-check-offline'],
    ['protected-link-check-interrupted', 'viewer-link-check-interrupted'], ['protected-link-check-failed', 'viewer-link-check-failed'],
    ['protected-credentials-no-reply', 'viewer-extension-no-reply'], ['protected-access-refused', 'viewer-access-refused'],
    ['protected-rate-limited', 'viewer-rate-limited'], ['protected-server-unavailable', 'viewer-server-unavailable']]) {
    assert.equal(viewerLoadCode(Error(raw), 'owner'), code); assert.ok(viewerLoadMessage(code));
  }
  assert.equal(viewerLoadCode(Error('protected-account-storage'), 'owner'), 'viewer-local-storage-unavailable');
  assert.doesNotMatch(viewerLoadMessage('viewer-protected-owner-failed'), /Close other player tabs/);
});

test('E41: storage and owner-lifetime failures name the real problem, and an unknown open failure no longer blames the account connection', async () => {
  for (const raw of ['installation-storage-unavailable', 'installation-storage-blocked', 'installation-store-closed', 'protected-owner-closed', 'protected-vault-closed'])
    assert.equal(viewerLoadCode(Error(raw), 'protected'), 'viewer-local-storage-unavailable', raw);
  assert.equal(viewerLoadCode(Error('protected-owner-busy'), 'protected'), 'viewer-owner-busy');
  // After the 0.61.0 update no request reached the server and a Chrome restart fixed it.
  const unknown = viewerLoadMessage(viewerLoadCode(Error('something-new'), 'protected'));
  assert.doesNotMatch(unknown, /account link|connection/);
  assert.match(unknown, /restart Chrome/);
  const { failureCause } = await import('../src/viewer-load-error.mjs');
  assert.equal(failureCause(Error('installation-store-closed')), 'installation-store-closed');
  assert.equal(failureCause(new DOMException('file:///private/path', 'NotReadableError')), 'NotReadableError');
  assert.equal(failureCause(Error('file:///private/path?token=secret')), 'Error');
});
