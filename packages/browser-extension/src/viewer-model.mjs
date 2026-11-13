// Presentation only. Existing packet/source/license owners retain authority.
// 0.63.0 local edits (.ss): showLocal (Advanced, on), localBudgetBytes (5 GB, separate from the
// catalog's space), keepBothRevisions (off: a newer revision replaces the older), unverifiedFiles
// (allow | ask | block; allow by default), localAutoCheck (check the default folder on open).
export const VIEWER_DEFAULTS = Object.freeze({version:1, mode:'viewer', overlay:'minimal', corner:'left', theme:'system', autoArm:true, timing:false, storageBudgetBytes:null, autoMakeRoom:true, continueEdits:false, advanced:false, leadInMs:5000, smoothAudio:true, exitReveal:'precise', shortGapPriming:true,
  showLocal:true, localBudgetBytes:5_000_000_000, keepBothRevisions:false, unverifiedFiles:'allow', localAutoCheck:true});
const enums={mode:['viewer','creator'],overlay:['none','minimal','detailed'],corner:['left','right'],theme:['system','light','dark'],unverifiedFiles:['allow','ask','block'],exitReveal:['new','previous','precise']};
// exitReveal (E72, 0.64.3, Settings → Advanced): how the episode reappears at a scene's end;
// 'previous' is the 0.64.2 behaviour, kept for A/B timing captures. 0.65.7 (X1): 'precise' is the
// default; 'new' is 0.64.3-0.65.6's default, kept for the A/B.
// shortGapPriming (0.65.7, Settings → Advanced, on): a scene that follows the previous one after a
// short stretch of the episode (under 500 ms) is prepared before the previous scene has finished.
// Off is exactly 0.65.6.
export const LOCAL_BUDGET_CHOICES=Object.freeze([1_000_000_000,2_000_000_000,5_000_000_000,10_000_000_000,20_000_000_000,50_000_000_000]);
// Scene jumps land this long before the scene starts (Settings → Playback).
export const LEAD_IN_CHOICES=Object.freeze([3000,5000,10000]);
// smoothAudio: the E58 audio crossfade at scene hand-overs (Settings → Playback), on by default.
const FLAGS=['autoArm','timing','autoMakeRoom','continueEdits','advanced','smoothAudio','showLocal','keepBothRevisions','localAutoCheck','shortGapPriming'];
// Space for kept website edits, chosen on the Edits page: 1 GB to 500 GB; null = default.
const validBudget=v=>Number.isSafeInteger(v)&&v>=1_000_000_000&&v<=500_000_000_000;
export function preferences(value={}) {
  const out={...VIEWER_DEFAULTS};
  for(const [key,allowed] of Object.entries(enums)) if(allowed.includes(value?.[key]))out[key]=value[key];
  for(const flag of FLAGS)if(typeof value?.[flag]==='boolean')out[flag]=value[flag];
  if(validBudget(value?.storageBudgetBytes))out.storageBudgetBytes=value.storageBudgetBytes;
  if(LEAD_IN_CHOICES.includes(value?.leadInMs))out.leadInMs=value.leadInMs;
  if(LOCAL_BUDGET_CHOICES.includes(value?.localBudgetBytes))out.localBudgetBytes=value.localBudgetBytes;
  return Object.freeze(out);
}
export function preferenceChange(current,patch) {
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!FLAGS.includes(k)&&k!=='storageBudgetBytes'&&k!=='leadInMs'&&k!=='localBudgetBytes'&&!Object.hasOwn(enums,k)))throw Error('viewer-preference-invalid');
  for(const [k,v] of Object.entries(patch))if(k==='storageBudgetBytes'?!(v===null||validBudget(v)):k==='leadInMs'?!LEAD_IN_CHOICES.includes(v):k==='localBudgetBytes'?!LOCAL_BUDGET_CHOICES.includes(v):FLAGS.includes(k)?typeof v!=='boolean':!enums[k].includes(v))throw Error('viewer-preference-invalid');
  return preferences({...current,...patch});
}
const text=(v,max=200)=>typeof v==='string'?v.slice(0,max):'';
import { viewerLoadMessage } from './viewer-load-error.mjs';
const number=v=>Number.isFinite(v)&&v>=0?v:null;
export function sourceKey(source) {
  if(!source||typeof source.serviceId!=='string'||typeof source.activeItemId!=='string'||!source.activeItemId||!Number.isFinite(source.runtimeMs))return null;
  return JSON.stringify(['serviceId','activeItemId','mediaType','season','episode','runtimeMs','versionTag','territory','plan'].map(k=>source[k]??null));
}
export const SCENE_TYPES=Object.freeze(['REPLACE','INSERT','SKIP','MUTE']);
const SCENE_STATUSES=['pending','played','playing','skipped','failed'];
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=10000?v:null;
const noticeCode=v=>typeof v==='string'&&/^viewer-[a-z-]{1,60}$/.test(v)?v:'';
/** The episode being watched, for display: series title and season/episode numbers only. */
function publicShow(v){
  if(!v||typeof v!=='object')return null;
  const title=text(v.title).trim(),season=count(v.season),episode=count(v.episode);
  return title||season!==null||episode!==null?{title,season,episode}:null;
}
/** The loaded edit's scenes in source order: start/resume times, type and play status. */
function publicScenes(list){
  if(!Array.isArray(list)||list.length>1000)return [];
  const out=[];
  for(const s of list){
    if(!s||!SCENE_TYPES.includes(s.type)||!Number.isSafeInteger(s.startMs)||s.startMs<0||!Number.isSafeInteger(s.resumeMs)||s.resumeMs<s.startMs)return [];
    out.push({type:s.type,startMs:s.startMs,resumeMs:s.resumeMs,status:SCENE_STATUSES.includes(s.status)?s.status:'pending',
      // The clip's length for Replaced and Added scenes (what the viewer watches).
      ...(Number.isSafeInteger(s.lengthMs)&&s.lengthMs>=0&&s.lengthMs<=7_200_000?{lengthMs:s.lengthMs}:{})});
  }
  return out;
}
export function publicPlayback(value={}) {
  const states=['unavailable','idle','loaded','ready','armed','active','paused','restoring','failed','finished'];
  // Only structured fields reach viewer surfaces: a status code (notice) and safe
  // values. The developer panel's own output text never leaves the page.
  return {state:states.includes(value.state)?value.state:'unavailable',title:text(value.title),notice:noticeCode(value.notice),sourceKey:text(value.sourceKey,2048),
    skippedCount:Number.isSafeInteger(value.skippedCount)&&value.skippedCount>0?value.skippedCount:0,
    editId:text(value.editId,128),version:text(value.version,64),currentTimeMs:number(value.currentTimeMs),durationMs:number(value.durationMs),
    // Position inside the clip that is playing (time left in the scene).
    ...(number(value.sceneTimeMs)!==null?{sceneTimeMs:number(value.sceneTimeMs)}:{}),
    paused:value.paused===true,buffering:value.buffering===true,canArm:value.canArm===true,canStop:value.canStop===true,
    show:publicShow(value.show),scenes:publicScenes(value.scenes),
    // A creator's clip preview (E57 C4): the surfaces use preview wording and the scene's name.
    ...(value.preview===true?{preview:true,previewName:text(value.previewName,120)}:{}),
    generation:text(value.generation,4096),timeline:publicTimeline(value.timeline)};
}
/** Native video is held beneath INSERT/REPLACE; only controllable local
 * playback reports a viewer pause. Preparation/restoration holds are not pauses. */
export function viewerPaused({nativePaused,actionType,localControllable=false,localPaused=false}={}) {
  return ['INSERT','REPLACE'].includes(actionType)
    ? localControllable===true&&localPaused===true
    : nativePaused===true;
}
/** The on-player badge: neutral grey when off, green outline while an edit is on and
 * waiting, solid green while a scene plays, red only for a real problem. */
export function indicator(state) {
  const paused=state.paused===true;
  if(state.problem)return {tone:'bad',symbol:'!',chip:'Problem',label:'Seamless Scene: Problem'};
  if(state.state==='active')return {tone:'on',symbol:paused?'Ⅱ':'▶',chip:'On',label:paused?'Seamless Scene: On · paused':'Seamless Scene: On · playing a scene'};
  if(['armed','paused','restoring'].includes(state.state))return {tone:'ready',symbol:paused?'Ⅱ':'',chip:'On',label:paused?'Seamless Scene: On · paused':'Seamless Scene: On · waiting for the next scene'};
  if(state.state==='finished')return {tone:'off',symbol:'✓',chip:'Finished',label:'Seamless Scene: Finished'};
  if(state.load?.busy===true)return {tone:'off',symbol:'…',chip:'Getting ready',label:'Seamless Scene: Getting ready'};
  return {tone:'off',symbol:'',chip:'Off',label:'Seamless Scene: Off'};
}
/** Source time typed by a creator: H:MM:SS, M:SS or MM:SS, or plain seconds, each with optional .mmm. */
export function parseTimestamp(value) {
  const text=typeof value==='string'?value.trim():'';
  const shape=/^(?:(\d{1,3}):(\d{2}):(\d{2})|(\d{1,3}):(\d{2})|(\d{1,6}))(?:\.(\d{1,3}))?$/.exec(text);
  if(!shape)throw Error('Use M:SS, H:MM:SS or seconds, e.g. 36:22 or 1:02:03.500.');
  const [,h3,m3,s3,m2,s2,plain,fraction='']=shape;
  const [h,m,s]=plain!==undefined?[0,0,Number(plain)]:h3!==undefined?[Number(h3),Number(m3),Number(s3)]:[0,Number(m2),Number(s2)];
  if((h3!==undefined&&m>=60)||(plain===undefined&&s>=60))throw Error('Minutes and seconds must be below 60.');
  return (h*3600+m*60+s)*1000+Number(fraction.padEnd(3,'0'));
}
export function formatTime(ms) {
  if(!Number.isFinite(ms))return 'Unknown';const s=Math.floor(ms/1000);return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function publicTimeline(t){
 if(!t||!Number.isFinite(t.durationMs)||t.durationMs<=0||!Array.isArray(t.segments)||t.segments.length>2001)return null;
 const segments=[];for(const s of t.segments){if(!['SOURCE','INSERT','REPLACE','SKIP','MUTE'].includes(s.type)||!Number.isFinite(s.startMs)||!Number.isFinite(s.endMs)||s.startMs<0||s.endMs<s.startMs||s.endMs>t.durationMs)return null;segments.push({type:s.type,startMs:s.startMs,endMs:s.endMs});}
 return {durationMs:t.durationMs,positionMs:Number.isFinite(t.positionMs)&&t.positionMs>=0&&t.positionMs<=t.durationMs?t.positionMs:null,segments};
}

// Viewer command and notice codes (load codes live in viewer-load-error.mjs). Every
// sentence names a place that exists and one fix; the code itself is only ever
// shown under "Details for support".
export const GENERIC_FAILURE='Something went wrong. Try again, or copy the details for support.';
const UPDATED='Seamless Scene was updated. Refresh this tab to keep watching with edits.';
const OWNER_BUSY=viewerLoadMessage('viewer-owner-busy');
const COMMAND_MESSAGES=Object.freeze({
 'viewer-stop-before-switching':'Stop the current edit before choosing another one.',
 'vault-release-open':'This edit is playing in a Prime Video tab. Stop it there, then remove it.',
 'protected-owner-busy':OWNER_BUSY,
 'viewer-source-changed':'The episode changed while this was happening. Try again.',
 'viewer-edit-not-matched':'That edit is not for this episode. Choose another edit.',
 'viewer-busy':'An edit is already getting ready. Wait for it to finish.',
 'viewer-load-unavailable':viewerLoadMessage('viewer-renderer-unavailable'),
 'viewer-action-failed':'That did not work. Try again; if it keeps happening, refresh the Prime Video tab.',
 'viewer-episode-mismatch':'This edit is for a different episode from the one playing. Open the episode it was made for, then try again.',
 'viewer-runtime-mismatch':'This edit was made for a slightly different version of this episode. Try reloading the episode; if it keeps happening, the edit needs an update.',
 // E51: the same season and episode under another Prime title ID (Prime sometimes re-lists a series).
 'viewer-title-id-changed':'This edit was made for Prime Video’s earlier listing of this episode: Prime now plays it under a different title ID, so the edit cannot be checked against it. The edit needs an update from its creator.',
 'viewer-source-check-failed':'The edit could not be matched to the episode playing. Refresh the Prime Video tab, then try again.',
 'viewer-controller-unavailable':'Open a title on Prime Video and press play first.',
 'viewer-controller-disconnected':'The Prime Video tab closed or refreshed. Open it again and press play.',
 'viewer-controller-busy':'The player is busy. Try again in a moment.',
 'viewer-edit-choose':'Choose which edit to watch.',
 'viewer-no-edit':'No downloaded edit for this episode.',
 'viewer-download-unavailable':'That download is no longer waiting or running.',
 'viewer-player-ambiguous':'Several Prime Video tabs are open. Choose the player above, or use Save timing report in that tab’s player menu.',
 'viewer-timing-unanswered':'That Prime Video tab did not answer (Chrome may have paused it in the background). Bring it to the front, or use Save timing report in its player menu.',
 'viewer-reimport-required':'This is one of your own edits. Choose its folder again in Settings → Library.',
 'viewer-export-cancelled':'Export cancelled.',
 'viewer-local-missing':'This local edit’s copy is missing from the extension’s storage. Add the .ss file again in Settings → Local.',
 'viewer-local-invalid':'This local edit could not be read. Add the .ss file again in Settings → Local.',
 'viewer-operation-failed':GENERIC_FAILURE,
 'viewer-request-denied':UPDATED,
 'viewer-sender-denied':'This page cannot control playback. Use the toolbar menu or the player menu.',
 'viewer-method-denied':'That action is not available in this version. Refresh this tab, then try again.',
 'viewer-preview-not-ready':'The preview could not start. Make sure the episode is playing, then try again.',
 'viewer-diagnostics-unavailable':'Diagnostics are not available for this player. Refresh the Prime Video tab, then try again.',
 'viewer-not-ready':'No edit is ready to turn on yet. Choose an edit first.',
 'viewer-not-armed':'Turn the edit on first.',
 'viewer-unavailable':'Seamless Scene did not respond. Close this menu and open it again.',
 'viewer-source-unavailable':'Seamless Scene could not identify this episode. Press play, wait a moment, then try again.',
 'viewer-action-timeout':'That took too long. Try again.',
 'viewer-no-owner':'Open a Prime Video tab, then try again.',
 'viewer-scene-unavailable':'There is no scene to jump to in that direction.',
 'viewer-jump-failed':'The player did not reach that scene. Try again, or move the player there yourself.',
 'viewer-preference-invalid':'That setting could not be saved. Try again.',
 'viewer-site-not-allowed':'Prime Video was not allowed. You can allow it any time from the toolbar menu.',
 'viewer-site-unsupported':'Open Prime Video in this tab first, then allow it here.',
 'viewer-website-unconfigured':'The website address is not set for this build.',
 'viewer-folder-picker-unavailable':'This browser cannot open folders from here.',
 'viewer-folder-no-edit':'That folder does not contain an edit.',
 'viewer-folder-invalid':'That edit folder is not valid. Export it again from Creator tools.',
 'viewer-timing-empty':'No scene recorded yet. With Record scene timing on, play through a scene, then try again.',
 // Why an edit stopped by itself (the player menu's Problem state).
 'viewer-ads-detected':'Ads came on, so the edit stopped: its scenes only line up with ad-free playback. Turn it on again after the ads.',
 'viewer-episode-changed':'Prime Video changed the episode, so the edit stopped. Turn it on again when the episode is playing.',
 'viewer-player-changed':'The Prime Video player restarted, so the edit stopped. Turn it on again.',
 'viewer-identity-lost':'Seamless Scene lost track of the episode, so the edit stopped. Turn it on again.',
 'viewer-playback-error':'Playback changed unexpectedly, so the edit stopped. Turn it on again.',
 'viewer-renderer-reconnecting':'Seamless Scene is reconnecting, so the edit stopped. It turns on again by itself.',
 'viewer-renderer-lost':'Seamless Scene lost its connection to this tab. Refresh this tab to keep watching with edits.',
 'viewer-folder-reselect':'Seamless Scene reconnected. Choose Watch with edit to turn your local edit on again.',
 'viewer-page-restored':'This page was restored from your history, so the edit stopped. Turn it on again.',
 'viewer-arm-failed':'The edit could not be turned on for this episode. Try again.',
 'viewer-edit-rejected':'This edit could not be opened. Try again, or choose another edit.',
 'viewer-edit-changed':'This edit changed on Seamless Scene, so it stopped. Turn it on again.'
});
/** The support code for an error: a known code, or "unknown" (never raw exception text). */
export function viewerFailureCode(error){
 const code=typeof error==='string'?error:error?.message;
 if(typeof code!=='string')return 'unknown';
 if(/context invalidated/i.test(code))return 'viewer-extension-updated';
 return viewerLoadMessage(code)||Object.hasOwn(COMMAND_MESSAGES,code)?code:'unknown';
}
export function viewerFailureMessage(error){
 const code=viewerFailureCode(error);
 return viewerLoadMessage(code)??COMMAND_MESSAGES[code]??GENERIC_FAILURE;
}
/** Human playhead for the popup: h:mm:ss.mmm, exact to the millisecond the player reports. */
export function formatPlayhead(ms){if(!Number.isFinite(ms)||ms<0)return '';const t=Math.round(ms),h=Math.floor(t/3600000),m=Math.floor(t%3600000/60000),s=Math.floor(t%60000/1000),f=t%1000;return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(f).padStart(3,'0')}`;}


/** Scenes the viewer is past without having seen them (enabled late or skipped
 * by a seek), and whether the whole edit has played. From the scheduler snapshot. */
export function editProgress(snapshot,actions,currentTimeMs){
 const statuses=snapshot?.statuses??{},local=(actions??[]).filter(a=>a&&Object.hasOwn(statuses,a.id));
 const skippedCount=local.filter(a=>statuses[a.id]==='skipped'&&a.triggerMs<currentTimeMs).length;
 const lastResume=Math.max(...local.map(a=>a.resumeMs??a.triggerMs??0),0);
 const finished=local.length>0&&!snapshot?.runningActionId&&local.every(a=>!['pending','running','active'].includes(statuses[a.id]))&&local.some(a=>statuses[a.id]==='completed')&&Number.isFinite(currentTimeMs)&&currentTimeMs>=lastResume;
 return {skippedCount,finished};
}

/** Default space for kept edits: 10 GB, or a quarter of the free space when that is less (at least 1 GB). */
export function defaultStorageBudget(estimate){
 const free=Number.isFinite(estimate?.quota)&&Number.isFinite(estimate?.usage)?estimate.quota-estimate.usage:Infinity;
 return Math.max(1_000_000_000,Math.min(10_000_000_000,Math.floor(free/4)));
}

/** A Prime Video title link, or null: only the two public title-page forms. */
export function primeStreamingUrl(value){
 if(typeof value!=='string'||value.length>512)return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  // Links open on www.amazon.com, where viewers allow the extension; playback-ID (GTI) links included.
  if(u.hostname==='www.amazon.com'&&/^\/gp\/video\/detail\/(?:[A-Z0-9]{10}|amzn1\.dv\.gti\.[a-f0-9-]{36})(?:\/[^?#]*)?$/.test(u.pathname))return `https://www.amazon.com${u.pathname}`;
  if(u.hostname==='www.primevideo.com'&&u.pathname==='/detail/'&&/^amzn1\.dv\.gti\.[a-f0-9-]{36}$/.test(u.searchParams.get('gti')??''))return `https://www.amazon.com/gp/video/detail/${u.searchParams.get('gti')}`;
  if(u.hostname==='www.primevideo.com'&&/^\/detail\/(?:[^/?#]+\/)?[A-Za-z0-9.]{1,128}\/?$/.test(u.pathname))return `https://www.primevideo.com${u.pathname}`;
  return null;}catch{return null;}
}

/**
 * The Prime title a page or streaming link names (a GTI, lower case, or an ASIN), or null.
 * Discovery only: which downloaded edit a page was opened for, never a source check.
 */
export function primeTitleId(value){
 if(typeof value!=='string'||value.length>2048)return null;
 let u;try{u=new URL(value);}catch{return null;}
 if(u.protocol!=='https:'||!['www.amazon.com','www.primevideo.com'].includes(u.hostname))return null;
 const gti=/^amzn1\.dv\.gti\.[A-Za-z0-9-]{8,64}$/;
 const query=u.searchParams.get('gti')??'';
 if(gti.test(query))return query.toLowerCase();
 const segment=/\/detail\/(?:[^/?#]+\/)?([A-Za-z0-9.-]{10,80})(?:\/|$)/.exec(u.pathname)?.[1]??'';
 if(gti.test(segment))return segment.toLowerCase();
 return /^[A-Z0-9]{10}$/i.test(segment)?segment.toUpperCase():null;
}

/** Streaming sites the extension supports; each needs the viewer's site access. */
export const STREAMING_ORIGINS=Object.freeze(['https://www.amazon.com','https://www.primevideo.com']);

/** Sites to request when the viewer allows a streaming service: Prime Video is the same service on both hosts. */
export function siteAccessOrigins(origin){
 return ['https://www.amazon.com','https://www.primevideo.com'].includes(origin)?['https://www.amazon.com/*','https://www.primevideo.com/*']:[origin+'/*'];
}

/** "Continue with edits": on the next episode, the same creator's edit, else the only
 * edit; several edits by other creators are a choice for the viewer, not a guess. */
export function chooseContinuation(previousCreator,candidates){
  const list=(candidates??[]).filter(item=>item&&typeof item.id==='string');
  if(previousCreator){const same=list.filter(item=>item.creatorName===previousCreator);if(same.length===1)return same[0];}
  return list.length===1?list[0]:null;
}
/** Near the end of an edited episode, when to start downloading the next one. */
export const CONTINUE_PREFETCH_AT=0.8;
export function shouldPrefetchNext(status){
  return Boolean(status?.editId)&&Number.isFinite(status?.durationMs)&&status.durationMs>0&&Number.isFinite(status?.currentTimeMs)&&status.currentTimeMs/status.durationMs>=CONTINUE_PREFETCH_AT;
}

/**
 * Whether a failed title-ID check is the same episode under a new Prime title ID: both
 * sides name an episode with the same season and episode number, and only the ID differs.
 * Wording only; the check itself still refuses the edit.
 */
export function sameEpisodeOtherTitleId(observed,expected){
 return observed?.mediaType==='episode'&&expected?.mediaType==='episode'&&Number.isSafeInteger(observed.season)&&Number.isSafeInteger(observed.episode)&&
  observed.season===expected.season&&observed.episode===expected.episode&&typeof observed.activeItemId==='string'&&typeof expected.serviceContentId==='string'&&
  observed.activeItemId!==expected.serviceContentId;
}
/** The viewer code for a failed source check: another episode, another length, or a check that could not be made. */
export function sourceMismatchCode(reason,{titleIdChanged=false}={}){
 if(reason==='active-item-mismatch'&&titleIdChanged)return 'viewer-title-id-changed';
 return ['active-item-mismatch','season-mismatch','episode-mismatch','media-type-mismatch'].includes(reason)?'viewer-episode-mismatch'
  :reason==='runtime-mismatch'?'viewer-runtime-mismatch':'viewer-source-check-failed';
}
