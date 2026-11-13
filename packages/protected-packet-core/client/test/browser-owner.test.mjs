import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedBrowserOwner } from '../browser-owner.mjs';

test('browser owner refuses provider pages and non-admitted extension documents before opening storage', async () => {
  for (const locationApi of [{protocol:'https:',hostname:'www.primevideo.com',pathname:'/'},{protocol:'chrome-extension:',hostname:'test',pathname:'/catalog-account.html'}]) {
    await assert.rejects(createProtectedBrowserOwner({ locationApi, chromeApi:{runtime:{id:'test'}}, navigatorApi:{storage:{getDirectory(){throw Error('must not open');}},locks:{request(){throw Error('must not lock');}}} }), /private-renderer/);
  }
});
test('browser owner requires independent configured trust and an explicit sign-out subscription', async () => {
  const options={locationApi:{protocol:'chrome-extension:',hostname:'test',pathname:'/local-playback-frame.html'},chromeApi:{runtime:{id:'test'}},navigatorApi:{storage:{getDirectory(){}},locks:{request(){throw Error('must not lock');}}}};
  await assert.rejects(createProtectedBrowserOwner(options), /private-renderer/);
  await assert.rejects(createProtectedBrowserOwner({...options,subscribeSignOut(){},descriptorTrust:new Map(),licenseTrust:new Map()}), /release-trust/);
});
test('active owner excludes a second context from crash cleanup', async () => {
  let opened=false;
  await assert.rejects(createProtectedBrowserOwner({locationApi:{protocol:'chrome-extension:',hostname:'test',pathname:'/local-playback-frame.html'},chromeApi:{runtime:{id:'test'}},navigatorApi:{storage:{getDirectory(){opened=true;}},locks:{request:async(name,opts,callback)=>{assert.equal(opts.ifAvailable,true);return callback(null);}}},subscribeSignOut(){},descriptorTrust:new Map([['a',{}]]),licenseTrust:new Map([['b',{}]])}),/owner-busy/);
  assert.equal(opened,false);
});
