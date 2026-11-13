import test from 'node:test';import assert from 'node:assert/strict';
import {compareVersions,createUpdateCheck} from '../src/update-notice.mjs';
const config={pairingOrigin:'https://preview.seamlessscene.com'};
test('version comparison is numeric per segment and refuses malformed input',()=>{
 assert.equal(compareVersions('0.44.0','0.43.0'),1);assert.equal(compareVersions('0.43.0','0.43.0.1'),-1);assert.equal(compareVersions('0.43.10','0.43.9'),1);assert.equal(compareVersions('0.43.0','0.43.0'),0);
 assert.equal(compareVersions('latest','0.43.0'),null);assert.equal(compareVersions(undefined,'0.43.0'),null);
});
test('a newer published version is reported once per cache window; same, older, malformed and failed replies are silent',async()=>{
 const calls=[];let body={data:{version:'0.44.0',channel:'private-zip'}},status=200,clock=0;
 const fetcher=async(url,init)=>{calls.push({url,init});return {status,text:async()=>JSON.stringify(body)};};
 const u=createUpdateCheck(config,{fetcher,installed:'0.43.0',now:()=>clock});
 assert.deepEqual(await u.check(),{version:'0.44.0',channel:'private-zip'});assert.equal(calls[0].url,'https://preview.seamlessscene.com/api/v1/extension/version');assert.equal(calls[0].init.credentials,'omit');
 await u.check();assert.equal(calls.length,1);clock=7*3600_000;body={data:{version:'0.43.0'}};assert.equal(await u.check(),null);assert.equal(calls.length,2);
 u.forget();body={data:{version:'0.42.9'}};assert.equal(await u.check(),null);u.forget();body={data:null};assert.equal(await u.check(),null);
 u.forget();status=500;body={data:{version:'9.9.9'}};assert.equal(await u.check(),null);
 const failing=createUpdateCheck(config,{fetcher:async()=>{throw Error('offline');},installed:'0.43.0'});assert.equal(await failing.check(),null);
 const fixture=createUpdateCheck({...config,fixtureOnly:true},{fetcher:async()=>{throw Error('never');},installed:'0.43.0'});assert.equal(await fixture.check(),null);
});

test('the store edition never checks the website for updates (the store updates it)',async()=>{
 let calls=0;
 const u=createUpdateCheck(config,{installed:'0.40.0',edition:'viewer',fetcher:async()=>{calls++;return new Response(JSON.stringify({data:{version:'0.41.0'}}),{status:200});}});
 assert.equal(await u.check(),null);assert.equal(calls,0);
});
