// Discovery hints grant no authority: the privileged renderer rechecks source, trust and lease.
import { sourceIdentity } from './catalog-discovery.mjs';
import { evaluateSourceCompatibility } from './source-identity.mjs';

// A downloaded release can describe a runtime rounded differently from Prime,
// or optional version/territory/plan fields which Prime does not expose. Keep
// that episode available for explicit checking instead of showing only the last
// remembered edition. This is discovery, never a substitute for the manifest's
// compatibility predicates at arm time.
function sameDownloadedItem(observedKey, savedKey) {
 const observed=sourceIdentity(observedKey),saved=sourceIdentity(savedKey);
 if(!observed||!saved||observed.runtimeMs===null||saved.runtimeMs===null||
  observed.service!==saved.service||observed.contentId!==saved.contentId)return false;
 const actual=JSON.parse(observedKey),expected=JSON.parse(savedKey);
 // Unknown optional fields may be checked later; known contradictions are not
 // useful episode choices. Runtime tolerance remains owned by the manifest.
 return [2,3,4,6,7,8].every(i=>actual[i]==null||expected[i]==null||actual[i]===expected[i]);
}

const KEY_FIELDS=['serviceId','activeItemId','mediaType','season','episode','runtimeMs','versionTag','territory','plan'];
function keyFields(key){
 let parts;try{parts=JSON.parse(key);}catch{return null;}
 return Array.isArray(parts)&&parts.length===KEY_FIELDS.length?Object.fromEntries(KEY_FIELDS.map((k,i)=>[k,parts[i]??null])):null;
}
/**
 * Whether one of the viewer's local edits (Settings → Local, .ss files) is for the episode
 * being played. A builder packet records qualifiers (version tag, territory,
 * plan) that Prime never reports, so its key is never byte-equal to the live
 * key. The fields Prime does report must agree (service, content ID/GTI, media
 * type, season, episode, runtime within the packet's own tolerance); a packet
 * qualifier may stand only while the live value is unknown. This is discovery:
 * the renderer re-reads the stored copy and repeats the source check before arming.
 * Summaries saved before the tolerance was recorded compare runtime exactly.
 */
export function localEditMatches(playbackKey,summary){
 if(typeof playbackKey!=='string'||!playbackKey||typeof summary?.sourceKey!=='string')return false;
 if(summary.sourceKey===playbackKey)return true;
 const observed=keyFields(playbackKey),saved=keyFields(summary.sourceKey);
 if(!observed||!saved||typeof saved.serviceId!=='string'||typeof saved.activeItemId!=='string'||!Number.isFinite(saved.runtimeMs))return false;
 const tolerance=Number.isSafeInteger(summary.runtimeToleranceMs)&&summary.runtimeToleranceMs>=0&&summary.runtimeToleranceMs<=10_000?summary.runtimeToleranceMs:0;
 const {activeItemId:serviceContentId,...expected}=saved;
 // A qualifier the packet leaves empty is not a claim to compare.
 for(const k of ['versionTag','territory','plan'])if(expected[k]===null)delete expected[k];
 return evaluateSourceCompatibility(observed,{...expected,serviceContentId,runtimeToleranceMs:tolerance}).status==='compatible';
}
export function matchingEdits(playback,library,configured=null,remembered=null){
 if(!playback.sourceKey||playback.state==='unavailable')return [];
 const found=new Map();
 for(const item of library){
  // The manifest key can differ from the observed runtime/optional identity
  // fields even after arming validates compatibility. A saved choice for this
  // exact live source and version is also a discovery hint. Stop disables
  // auto-arm, not the viewer's ability to explicitly choose that kept edit.
  const previouslyArmed=item.availability==='downloaded'&&remembered?.id===item.id&&
   typeof remembered.version==='string'&&remembered.version.length>0&&remembered.version===item.version;
  const exact=item.sourceKey===playback.sourceKey;
  const candidate=item.availability==='downloaded'&&sameDownloadedItem(playback.sourceKey,item.sourceKey);
  // The website's edit name distinguishes editions of the same title. The
  // renderer's older title/short-ID label remains a fallback for legacy entries.
  const title=typeof item.name==='string'&&item.name.trim()?item.name.trim():item.title;
  if(item.origin==='website'&&item.transport==='protected'&&(exact||previouslyArmed||candidate)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id))found.set(item.id,{
   id:item.id,title,check:candidate&&!exact&&!previouslyArmed,version:item.version,displayVersion:Number.isSafeInteger(item.displayVersion)&&item.displayVersion>=1?item.displayVersion:null,
   downloaded:item.availability==='downloaded'
  });
 }
 // Kept versions of one edit share its name (an update keeps the previous
 // download); their version labels tell the choices apart.
 const named=new Map();for(const x of found.values())named.set(x.title,(named.get(x.title)??0)+1);
 for(const [id,x] of found){
  const shown=x.displayVersion??(typeof x.version==='string'&&/^[0-9]{1,10}$/.test(x.version)?x.version:null);
  const label=named.get(x.title)>1&&shown!==null?`${x.title} · v${shown}`:x.title;
  found.set(id,{id:x.id,title:x.check?`${label} · check compatibility`:label,downloaded:x.downloaded});
 }
 if(configured?.sourceKey===playback.sourceKey&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(configured.id)&&!found.has(configured.id))found.set(configured.id,{id:configured.id,title:configured.title,downloaded:false});
 return [...found.values()];
}
