// Server-side discovery for a paired viewer. The website answers with reviewed
// releases that match the source being watched and that this account may
// acquire now. Replies are picker hints only: acquisition, verification and
// playback keep their existing owners and recheck every condition again.
import {primeStreamingUrl,sourceKey} from './viewer-model.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Website r30: the release's 1-based position in its edit ("v4"). Display only: never
// used to match, select or verify; `version`/`releaseVersion` stay manifest_version.
export const displayVersionOf=v=>Number.isSafeInteger(v)&&v>=1&&v<=2147483647?v:null;
// Exact-release display/discovery hints, never packet verification or entitlement.
export function releaseDisplay(value){
 if(!value||typeof value!=='object'||!UUID.test(value.editId??'')||typeof value.name!=='string'||!value.name.trim()||value.name.length>200||!Number.isSafeInteger(value.releaseVersion)||value.releaseVersion<1||value.releaseVersion>2147483647)return null;
 const s=value.source;
 if(!s||s.serviceId!=='prime-video'||typeof s.activeItemId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(s.activeItemId)||!['movie','episode'].includes(s.mediaType)||!Number.isSafeInteger(s.runtimeMs)||s.runtimeMs<=0||s.runtimeMs>86400000)return null;
 const episodeNumber=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
 if(s.mediaType==='movie'?(s.season!=null||s.episode!=null):(!episodeNumber(s.season)||!episodeNumber(s.episode)))return null;
 for(const key of ['versionTag','territory','plan'])if(s[key]!=null&&(typeof s[key]!=='string'||s[key].length>256))return null;
 const out={editId:value.editId,name:value.name,releaseVersion:value.releaseVersion,sourceKey:sourceKey(s)};
 if(displayVersionOf(value.displayVersion))out.displayVersion=value.displayVersion;
 for(const [key,max] of [['creatorName',120],['titleName',200],['episodeName',200]]){
  if(value[key]!=null&&(typeof value[key]!=='string'||value[key].length>max))return null;
  if(typeof value[key]==='string')out[key]=value[key];
 }
 const url=primeStreamingUrl(value.streamingUrl);if(url)out.streamingUrl=url;
 return out;
}
export function sourceIdentity(sourceKey){
 let parts;try{parts=JSON.parse(sourceKey);}catch{return null;}
 if(!Array.isArray(parts)||parts.length!==9)return null;
 const [service,contentId,,,,runtimeMs]=parts;
 if(typeof service!=='string'||!/^[a-z][a-z0-9-]{1,39}$/.test(service)||typeof contentId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(contentId))return null;
 return {service,contentId,runtimeMs:Number.isFinite(runtimeMs)&&runtimeMs>=0&&runtimeMs<=86_400_000?Math.round(runtimeMs):null};
}
function candidate(item){
 if(!item||typeof item!=='object'||!UUID.test(item.releaseId)||typeof item.name!=='string'||!item.name||!Number.isSafeInteger(item.version)||item.ready!==true)return null;
 const creator=typeof item.creatorName==='string'&&item.creatorName?` · ${item.creatorName.slice(0,40)}`:'';
 const runtime=item.runtimeMatch===false?' · runtime differs':'';
 const shown=displayVersionOf(item.displayVersion);
 return {id:item.releaseId,title:`${item.name.slice(0,120)} · v${shown??item.version}${creator}${runtime}`,downloaded:false,remote:true,...(shown?{displayVersion:shown}:{}),
  ...(UUID.test(item.editId??'')?{editId:item.editId}:{}),name:item.name.slice(0,120),creatorName:typeof item.creatorName==='string'?item.creatorName.slice(0,80):null,version:item.version,
  ...(primeStreamingUrl(item.streamingUrl)?{streamingUrl:primeStreamingUrl(item.streamingUrl)}:{}),...(typeof item.titleName==='string'&&item.titleName?{titleName:item.titleName.slice(0,200)}:{})};
}
export function createCatalogDiscovery(runtime,config,{journal,fetcher=fetch,ttlMs=60000,now=Date.now}={}){
 const cache=new Map();
 async function discover(playback){
  const identity=playback?.state!=='unavailable'&&playback?.sourceKey?sourceIdentity(playback.sourceKey):null;
  if(!identity||!config.deviceLinkLifetimeSeconds)return {state:'unconfigured',items:[],withheld:0};
  const cached=cache.get(playback.sourceKey);if(cached&&now()-cached.at<ttlMs)return cached.value;
  const state=await journal.read();const token=state?.active?.token;
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return {state:'unpaired',items:[],withheld:0};
  const r=await fetcher(config.pairingOrigin+'/api/v1/catalog/matches',{method:'POST',body:JSON.stringify(identity),headers:{'Content-Type':'application/json',Origin:`chrome-extension://${runtime.id}`,Authorization:'Bearer '+token},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)});
  const text=await r.text();if(text.length>65536)throw Error('discovery-response-too-large');
  if(r.status===429)return {state:'busy',items:[],withheld:0};
  if(r.status===401||r.status===403)return {state:'unpaired',items:[],withheld:0};
  if(r.status!==200)throw Error('discovery-unavailable');
  const data=JSON.parse(text)?.data;if(!data||typeof data!=='object')throw Error('discovery-unavailable');
  // The next episode's edits, for "Continue with edits" (offer or download ahead of autoplay).
  const next=(Array.isArray(data.next)?data.next:[]).filter(x=>UUID.test(x?.releaseId)).slice(0,5).map(x=>({id:x.releaseId,releaseId:x.releaseId,editId:UUID.test(x.editId)?x.editId:null,
   name:String(x.name??'').slice(0,200),creatorName:String(x.creatorName??'').slice(0,80),titleName:String(x.titleName??'').slice(0,200)}));
  const value=data.state==='paired'?{state:'paired',items:(Array.isArray(data.items)?data.items:[]).map(candidate).filter(Boolean).slice(0,20),withheld:Number.isSafeInteger(data.withheld)?data.withheld:0,next}:{state:'unpaired',items:[],withheld:0,next:[]};
  cache.set(playback.sourceKey,{at:now(),value});if(cache.size>32)cache.delete(cache.keys().next().value);
  return value;
 }
 // Edits page "Check for updates": for kept releases, the newest published version
 // of the same edit and whether it is still available. Ids only go out.
 async function checkReleases(releaseIds){
  const ids=[...new Set(releaseIds)].filter(id=>UUID.test(id)).slice(0,50);if(!ids.length||!config.deviceLinkLifetimeSeconds)return [];
  const state=await journal.read();const token=state?.active?.token;if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('viewer-account-unlinked');
  const r=await fetcher(config.pairingOrigin+'/api/v1/catalog/releases/status',{method:'POST',body:JSON.stringify({releaseIds:ids}),headers:{'Content-Type':'application/json',Origin:`chrome-extension://${runtime.id}`,Authorization:'Bearer '+token},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(r.status!==200)throw Error('viewer-updates-unavailable');
  const body=await r.text();if(body.length>262144)throw Error('viewer-updates-unavailable');
  const data=JSON.parse(body)?.data;
  const parsed=(Array.isArray(data?.items)?data.items:[]).filter(x=>UUID.test(x?.releaseId)&&ids.includes(x.releaseId)).map(x=>({releaseId:x.releaseId,
   latestReleaseId:UUID.test(x.latestReleaseId)?x.latestReleaseId:null,latestVersion:Number.isSafeInteger(x.latestVersion)?x.latestVersion:null,
   availability:['available','withdrawn','paused','no-access'].includes(x.availability)?x.availability:'unknown',...(primeStreamingUrl(x.streamingUrl)?{streamingUrl:primeStreamingUrl(x.streamingUrl)}:{}),...(releaseDisplay(x.display)?{display:releaseDisplay(x.display)}:{})}));
  // One item per requested release. A release answered twice with different
  // descriptions keeps its first status and loses its ambiguous display hint.
  const out=new Map();
  for(const item of parsed){const prior=out.get(item.releaseId);if(!prior)out.set(item.releaseId,item);else if(JSON.stringify(prior)!==JSON.stringify(item))delete prior.display;}
  return [...out.values()];
 }
 return {discover,checkReleases,forget(){cache.clear();}};
}
export function mergeMatches(local,remote){
 const seen=new Set(local.map(x=>x.id));
 return [...local,...remote.filter(x=>!seen.has(x.id))];
}
