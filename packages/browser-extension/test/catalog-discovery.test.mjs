import test from 'node:test';import assert from 'node:assert/strict';
import {createCatalogDiscovery,mergeMatches,sourceIdentity,releaseDisplay} from '../src/catalog-discovery.mjs';
import {downloadedRows} from '../src/edits-model.mjs';
const key=JSON.stringify(['prime-video','B04A826A41','movie',null,null,5400000,null,'US','included']),release='11111111-1111-4111-8111-111111111111';
const config={pairingOrigin:'https://preview.seamlessscene.com',deviceLinkLifetimeSeconds:2592000},runtime={id:'a'.repeat(32)};
const display={editId:'33333333-3333-4333-8333-333333333333',name:'Complete',creatorName:'Maker',titleName:'Series',episodeName:'Pilot',releaseVersion:2,
 streamingUrl:'https://www.amazon.com/gp/video/detail/B04A826A41',
 source:{serviceId:'prime-video',activeItemId:'B04A826A41',mediaType:'episode',season:1,episode:1,runtimeMs:2886000,versionTag:null,territory:'US',plan:'ad-free'}};
function fixture({token='b'.repeat(64),status=200,body,calls=[]}={}){
 const journal={read:async()=>({active:token?{token}:null})};
 const fetcher=async(url,init)=>{calls.push({url,init});return {status,text:async()=>typeof body==='string'?body:JSON.stringify(body??{data:{state:'paired',withheld:1,items:[{releaseId:release,name:'Reviewed edit',version:2,creatorName:'Maker',runtimeMatch:true,ready:true},{releaseId:'22222222-2222-4222-8222-222222222222',name:'Not ready',version:1,ready:false},{releaseId:'bad',name:'x',version:1,ready:true}]}})};};
 let clock=1000;return {calls,discovery:createCatalogDiscovery(runtime,config,{journal,fetcher,now:()=>clock}),tick:ms=>{clock+=ms;}};
}
test('source identity comes from the controller source key only',()=>{
 assert.deepEqual(sourceIdentity(key),{service:'prime-video',contentId:'B04A826A41',runtimeMs:5400000});
 assert.equal(sourceIdentity('exact-source'),null);assert.equal(sourceIdentity(JSON.stringify(['Prime','x',null,null,null,1,null,null,null])),null);
 assert.equal(sourceIdentity(JSON.stringify(['prime-video','../x',null,null,null,1,null,null,null])),null);
 assert.equal(sourceIdentity(JSON.stringify(['fixture','clip-1','movie',null,null,-5,null,null,null])).runtimeMs,null);
});

test('exact-release display stays separate from successor metadata and carries no trust fields',async()=>{
 const successor='22222222-2222-4222-8222-222222222222';
 const f=fixture({body:{data:{state:'paired',items:[{releaseId:release,latestReleaseId:successor,latestVersion:3,availability:'available',streamingUrl:'https://www.amazon.com/gp/video/detail/B0SUCCESSOR',display:{...display,trusted:true,license:'not-projected'}}]}}});
 const [item]=await f.discovery.checkReleases([release]);
 assert.equal(item.latestVersion,3);assert.equal(item.display.releaseVersion,2);
 assert.equal(item.display.streamingUrl,display.streamingUrl);assert.notEqual(item.display.streamingUrl,item.streamingUrl);
 assert.equal(item.display.sourceKey,JSON.stringify(['prime-video','B04A826A41','episode',1,1,2886000,null,'US','ad-free']));
 assert.equal(item.display.trusted,undefined);assert.equal(item.display.license,undefined);
});

test('malformed display is discarded without breaking old status responses',async()=>{
 for(const bad of [null,{}, {...display,releaseVersion:0}, {...display,name:'x'.repeat(201)}, {...display,source:{...display.source,runtimeMs:NaN}}, {...display,source:{...display.source,activeItemId:'../private'}}, {...display,source:{...display.source,episode:'1'}}, {...display,source:{...display.source,plan:{secret:'x'}}}])assert.equal(releaseDisplay(bad),null);
 const safe=releaseDisplay({...display,streamingUrl:'https://private.example/token'});assert.equal(safe.streamingUrl,undefined);
 const f=fixture({body:{data:{state:'paired',items:[{releaseId:release,availability:'withdrawn',display:{...display,releaseVersion:-1}}]}}});
 assert.equal((await f.discovery.checkReleases([release]))[0].display,undefined);
 await assert.rejects(fixture({body:'x'.repeat(262145)}).discovery.checkReleases([release]),/updates-unavailable/);
});
test('duplicate status items collapse to one per release and conflicting descriptions lose their display',async()=>{
 const other='22222222-2222-4222-8222-222222222222',item=x=>({releaseId:x,latestReleaseId:x,latestVersion:2,availability:'available',display});
 const f=fixture({body:{data:{state:'paired',items:[item(release),item(release),item(other),{...item(other),display:{...display,name:'Other'}},item('33333333-3333-4333-8333-333333333333')]}}});
 const items=await f.discovery.checkReleases([release,other,release,'bad']);
 assert.deepEqual(JSON.parse(f.calls[0].init.body).releaseIds,[release,other]);
 assert.deepEqual(items.map(x=>x.releaseId),[release,other],'one item per requested release; unrequested ones dropped');
 assert.equal(items[0].display.name,'Complete');assert.equal(items[1].display,undefined);assert.equal(items[1].latestVersion,2);
});
test('paired discovery posts the identity with the device token and keeps only ready, well-formed candidates',async()=>{
 const f=fixture();const r=await f.discovery.discover({state:'idle',sourceKey:key});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://preview.seamlessscene.com/api/v1/catalog/matches');
 assert.equal(f.calls[0].init.headers.Authorization,'Bearer '+'b'.repeat(64));assert.equal(f.calls[0].init.headers.Origin,'chrome-extension://'+'a'.repeat(32));assert.equal(f.calls[0].init.credentials,'omit');
 assert.deepEqual(JSON.parse(f.calls[0].init.body),{service:'prime-video',contentId:'B04A826A41',runtimeMs:5400000});
 assert.deepEqual(r,{state:'paired',withheld:1,next:[],items:[{id:release,title:'Reviewed edit · v2 · Maker',downloaded:false,remote:true,name:'Reviewed edit',creatorName:'Maker',version:2}]});
});
test('replies are cached per source for a minute and never requested without a link or identity',async()=>{
 const f=fixture();await f.discovery.discover({state:'idle',sourceKey:key});await f.discovery.discover({state:'idle',sourceKey:key});assert.equal(f.calls.length,1);
 f.tick(61000);await f.discovery.discover({state:'idle',sourceKey:key});assert.equal(f.calls.length,2);
 assert.deepEqual(await f.discovery.discover({state:'idle',sourceKey:'exact-source'}),{state:'unconfigured',items:[],withheld:0});
 assert.deepEqual(await f.discovery.discover({state:'unavailable',sourceKey:key}),{state:'unconfigured',items:[],withheld:0});
 const unpaired=fixture({token:null});assert.deepEqual(await unpaired.discovery.discover({state:'idle',sourceKey:key}),{state:'unpaired',items:[],withheld:0});assert.equal(unpaired.calls.length,0);
 const off=createCatalogDiscovery(runtime,{pairingOrigin:config.pairingOrigin},{journal:{read:async()=>({})},fetcher:async()=>{throw Error('never');}});assert.equal((await off.discover({state:'idle',sourceKey:key})).state,'unconfigured');
});
test('rejected, throttled and malformed replies degrade to no remote matches without throwing into the picker',async()=>{
 assert.equal((await fixture({status:401}).discovery.discover({state:'idle',sourceKey:key})).state,'unpaired');
 assert.equal((await fixture({status:429}).discovery.discover({state:'idle',sourceKey:key})).state,'busy');
 await assert.rejects(fixture({status:500}).discovery.discover({state:'idle',sourceKey:key}),/discovery-unavailable/);
 await assert.rejects(fixture({body:'x'.repeat(70000)}).discovery.discover({state:'idle',sourceKey:key}),/too-large/);
 assert.deepEqual((await fixture({body:{data:{state:'unavailable'}}}).discovery.discover({state:'idle',sourceKey:key})).items,[]);
});
test('local library matches stay first and remote duplicates are dropped',()=>{
 assert.deepEqual(mergeMatches([{id:release,title:'Saved',downloaded:true}],[{id:release,title:'Remote',downloaded:false,remote:true},{id:'22222222-2222-4222-8222-222222222222',title:'Other',downloaded:false,remote:true}]).map(x=>x.title),['Saved','Other']);
});
test('the next episode\'s edits come back well-formed and bounded, for continue with edits',async()=>{
 const next=[{releaseId:release,editId:'33333333-3333-4333-8333-333333333333',name:'Next edit',creatorName:'Maker',titleName:'Series · S1E2',version:1},{releaseId:'bad',name:'x'},...Array.from({length:6},(_,i)=>({releaseId:`4444444${i}-4444-4444-8444-444444444444`,name:'More '+i,creatorName:'Other'}))];
 const f=fixture({body:{data:{state:'paired',withheld:0,items:[],next}}});const r=await f.discovery.discover({state:'idle',sourceKey:key});
 assert.equal(r.next.length,5,'at most five, malformed dropped');
 assert.deepEqual(r.next[0],{id:release,releaseId:release,editId:'33333333-3333-4333-8333-333333333333',name:'Next edit',creatorName:'Maker',titleName:'Series · S1E2'});
});

test('unavailable release status tolerates omitted or null successor fields and disables watch/update',async()=>{
 for (const availability of ['withdrawn','paused','no-access']) {
  for (const fields of [{},{latestReleaseId:null,latestVersion:null,streamingUrl:null}]) {
   const f=fixture({body:{data:{items:[{releaseId:release,availability,...fields}]}}});
   const updates=await f.discovery.checkReleases([release]);
   assert.deepEqual(updates,[{releaseId:release,availability,latestReleaseId:null,latestVersion:null}]);
   assert.equal(f.calls[0].url,config.pairingOrigin+'/api/v1/catalog/releases/status');
   assert.deepEqual(JSON.parse(f.calls[0].init.body),{releaseIds:[release]});
   const [row]=downloadedRows({library:[{id:release,origin:'website',transport:'protected',name:'Kept edit',streamingUrl:'https://www.amazon.com/gp/video/detail/B04A826A41'}],
    vault:[{releaseId:release,bytes:10}],updates:{[release]:updates[0]}});
   assert.equal(row.status.kind,'unavailable');assert.deepEqual(row.actions,['remove']);
  }
 }
});
