import {stateIcon} from './viewer-icons.mjs';
import {formatTime,viewerFailureCode,viewerFailureMessage} from './viewer-model.mjs';
import {viewerView,chooserItems,supportDetails,problemFor,episodeDetails,episodeDetailsText} from './viewer-display.mjs';

// The player menu: the badge on the video and the menu under it. It says which edit
// is on and what happens next, jumps between scenes, and gets out of the way. Every
// line comes from structured playback fields (viewer-display.mjs), never from the
// developer panel's output.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const IDLE_MS=3000;
const STYLE=`:host{position:fixed;top:20px;left:20px;z-index:2147483646;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark;
 --x-scrim:rgba(13,19,16,.94);--x-line:#2b3731;--x-ink:#eef3ef;--x-muted:#a6b4ac;--x-faint:#71807a;--x-on:#2f9e6a;--x-on-ink:#06140d;--x-ready:#8fd3b0;--x-bad:#e0675f;--x-btn:#1c2723;--x-btn-h:#24322c}
#chip{display:block;padding:0;border:0;background:transparent;width:44px;height:44px;border-radius:12px;box-shadow:0 3px 12px #0006;cursor:pointer;transition:opacity .35s ease}
#chip svg{display:block;width:44px;height:44px}
:host(.idle) #chip{opacity:0}
button:focus-visible,summary:focus-visible{outline:3px solid var(--x-ready);outline-offset:2px}
#menu{margin-top:8px;box-sizing:border-box;width:min(340px,calc(100vw - 40px));max-height:calc(100vh - 100px);overflow:auto;background:var(--x-scrim);color:var(--x-ink);border:1px solid var(--x-line);border-radius:14px;padding:14px;display:grid;gap:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);backdrop-filter:blur(6px)}
#head{display:grid;gap:8px}
/* Grid children may shrink, so long names ellipsise inside the fixed width (E59). */
#head>*,#body>*{min-width:0}
.chip{justify-self:start;display:inline-flex;align-items:center;gap:6px;font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:5px 8px;border-radius:6px}
.c-off{background:#26302c;color:var(--x-muted)}.c-ready{background:#16372a;color:var(--x-ready)}.c-on{background:var(--x-on);color:var(--x-on-ink)}.c-bad{background:#3b1c1a;color:#f2a39c}
p{margin:0}
.ename{font-weight:600;font-size:17px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ename.show{font-size:15px}
.v{font:500 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--x-muted);margin-left:6px;padding:1px 5px;border:1px solid var(--x-line);border-radius:4px;vertical-align:2px}
.src{color:var(--x-muted);font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status,.err{font-size:14px}.status b{font-weight:600}
/* One line that never reflows: the menu keeps its size as the status changes (E59). */
.status{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:1.4em;font-variant-numeric:tabular-nums}
#body{display:grid;gap:12px}
.prog{display:grid;gap:6px}.bar{height:6px;border-radius:3px;background:#26302c;overflow:hidden}.bar i{display:block;height:100%;background:var(--x-on)}
.prog small,.note{color:var(--x-muted);font-size:12.5px}.prog small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.row{display:flex;gap:8px;flex-wrap:wrap}
.xb{flex:1 1 auto;min-height:38px;padding:8px 12px;border-radius:9px;border:1px solid var(--x-line);background:var(--x-btn);color:var(--x-ink);font:inherit;font-weight:500;text-align:center;cursor:pointer}
.xb:hover:not([disabled]){background:var(--x-btn-h)}
.xb.p{background:var(--x-on);border-color:var(--x-on);color:var(--x-on-ink);font-weight:600}.xb.p:hover:not([disabled]){background:#38b178}
.xb[disabled],.xl[disabled],.scenes button[disabled],.choose button[disabled]{opacity:.45;cursor:not-allowed}
.xl{background:none;border:0;color:var(--x-ready);padding:4px 0;font:inherit;font-size:13.5px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:24px;text-align:left}
.foot{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid var(--x-line);padding-top:10px}
.foot .xb{flex:0 1 auto}
.sechead{display:flex;justify-content:space-between;align-items:baseline}
.sechead span{font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--x-muted)}.sechead small{color:var(--x-faint);font-size:12px}
.scenes{position:relative;display:grid;gap:2px;max-height:190px;overflow:auto;margin:0;padding:0;list-style:none}
.scenes button{width:100%;display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;min-height:36px;padding:7px 8px;border-radius:8px;border:0;background:transparent;color:var(--x-ink);font:inherit;text-align:left;cursor:pointer}
.scenes button:hover:not([disabled]){background:var(--x-btn-h)}
.scenes .n{font:500 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--x-muted);text-align:center}
.scenes .t{font:500 13px ui-monospace,SFMono-Regular,Menlo,monospace}.scenes .d{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--x-muted)}.scenes .k{font-size:12.5px;color:var(--x-muted)}.scenes .st{font-size:12px;color:var(--x-faint);min-width:50px;text-align:right}
.scenes .w{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.scenes li.played .t,.scenes li.played .k{color:var(--x-faint)}
.scenes li.playing button{background:#16372a}.scenes li.playing .n{color:var(--x-ready)}
.scenes li.next .st{color:var(--x-ready)}
.choose{display:grid;gap:6px}
.choose button{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;min-height:44px;text-align:left;padding:10px 12px;border-radius:9px;border:1px solid var(--x-line);background:var(--x-btn);color:var(--x-ink);font:inherit;cursor:pointer}
.choose button:hover:not([disabled]){background:var(--x-btn-h)}
.choose small{display:block;color:var(--x-muted);font-size:12.5px}
.choose .go{color:var(--x-ready);font-weight:600}
details{font-size:13px;color:var(--x-muted)}details summary{cursor:pointer;min-height:24px}
details code{display:block;margin:6px 0;padding:6px 8px;border-radius:6px;background:#0f1512;color:var(--x-ink);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;user-select:all}
.feedback{font-size:13px;color:var(--x-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:1.4em}.feedback.bad{color:#f2a39c}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#rail{position:fixed;right:18px;top:15vh;height:70vh;width:32px;background:rgba(13,19,16,.8);border-radius:8px;border:1px solid var(--x-line);pointer-events:none}
.tick{position:absolute;left:10px;width:12px;border-top:1px solid var(--x-faint)}.region{position:absolute;left:4px;width:22px;background:#b9dfc3}.insert{background:#37784a}.skip{height:2px!important;background:#777}.mute{background:repeating-linear-gradient(45deg,#ddd 0 3px,#777 3px 5px)}#cursor{position:absolute;left:0;width:32px;border-top:4px solid #8fd3b0}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){#chip{transition:none}}`;

// Skip-to-scene glyphs as inline vectors: fonts on the page may lack ⏮ and ⏭.
const ICONS={previous:'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="vertical-align:-1px"><path d="M2 1h1.6v10H2zM11 1v10L4 6z" fill="currentColor"/></svg>',next:'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="vertical-align:-1px"><path d="M1 1v10l7-5zM8.4 1H10v10H8.4z" fill="currentColor"/></svg>'};
const CHIP_CLASS={off:'c-off',ready:'c-ready',on:'c-on',bad:'c-bad'};
const BUSY_TEXT={watch:'Turning the edit on…',arm:'Turning the edit on…',stop:'Stopping the edit…','find-another':'Opening the website…','jump-scene':'Jumping to the scene…','next-scene':'Jumping to the next scene…','previous-scene':'Jumping to the previous scene…',download:'Updating the download…'};

// E59: the scene list keeps its scroll position when the menu re-renders (after each
// scene, and as the status counts down). Lists carry data-scroll="name".
export function scrollPositions(el){const out={};for(const n of el?.querySelectorAll?.('[data-scroll]')??[])if(Number.isFinite(n.scrollTop))out[n.dataset.scroll]=n.scrollTop;return out;}
export function restoreScroll(el,positions){const set=[];for(const n of el?.querySelectorAll?.('[data-scroll]')??[]){const top=positions?.[n.dataset.scroll];if(Number.isFinite(top)&&n.scrollTop!==top){n.scrollTop=top;set.push(n);}}return set;}
/** Where to scroll a list so an item shows (with one row of context), or null when it already does. */
export function followTop({scrollTop,height,itemTop,itemHeight}){
 if(![scrollTop,height,itemTop,itemHeight].every(Number.isFinite)||height<=0)return null;
 if(itemTop<scrollTop)return Math.max(0,itemTop-itemHeight);
 if(itemTop+itemHeight>scrollTop+height)return Math.max(0,itemTop+itemHeight*2-height);
 return null;
}

/** The menu's header and body markup for one state, from the shared view model. */
export function menuMarkup(view,{matches=[],changing=false,busy=false,feedback='',feedbackBad=false,details='',timing=false,episode=false}={}){
 const chip=`<span class="chip ${CHIP_CLASS[view.chip.tone]??'c-off'}">${esc(view.chip.text)}</span>`;
 const name=view.name&&!['none','ready','choose','identifying','unavailable'].includes(view.kind);
 const head=chip+(name?`<div><p class="ename" title="${esc(view.name)}">${esc(view.name)}${view.version?`<span class="v">${esc(view.version)}</span>`:''}</p>${view.show?`<p class="src" title="${esc(view.show)}">${esc(view.show)}</p>`:''}</div>`
  :`<div><p class="ename show">${esc(view.show||'This episode')}</p></div>`);
 const dis=busy?' disabled':'';
 const button=(act,label,{primary=false,title='',arg='',disabled=false,k=act,icon=''}={})=>`<button class="xb${primary?' p':''}" type="button" data-act="${act}"${arg!==''?` data-arg="${esc(arg)}"`:''} data-k="${esc(k)}"${title?` title="${esc(title)}"`:''}${busy||disabled?' disabled':''}>${icon==='previous'?ICONS.previous+' ':''}${esc(label)}${icon==='next'?' '+ICONS.next:''}</button>`;
 const link=(act,label,k=act)=>`<button class="xl" type="button" data-act="${act}" data-k="${k}"${dis}>${esc(label)}</button>`;
 const progress=view.progress?`<div class="prog"><div class="bar"><i style="width:${Math.round(view.progress.played/Math.max(1,view.progress.total)*100)}%"></i></div><small>${view.progress.played} of ${view.progress.total} scenes played</small></div>`:'';
 const chooser=(items,current='')=>`<div class="choose">${chooserItems(items).map(m=>`<button type="button" data-act="choose" data-arg="${esc(m.id)}" data-k="choose:${esc(m.id)}"${busy||m.id===current?' disabled':''}><span>${esc(m.name)}${m.version?` · ${esc(m.version)}`:''}${m.detail?`<small>${esc(m.detail)}</small>`:''}</span><span class="go">${m.id===current?'On':'Watch'}</span></button>`).join('')}</div>`;
 const findMore=link('find','Find more for this episode on the website ↗','find-more');
 // Always present (one reserved line), so a busy or error line never moves the menu (E59).
 const fb=`<p class="feedback${feedbackBad?' bad':''}"${feedback?` title="${esc(feedback)}"`:''}>${esc(feedback)}</p>`;
 if(changing)return {head,body:`<p class="status"><b>Change edit</b></p>${matches.length?chooser(matches,view.currentId??''):'<p class="note">No other downloaded edit matches this episode.</p>'}${findMore}${fb}<div class="foot"><span></span>${link('back','Back')}</div>`};
 const scenes=view.scenes.length?`<div class="sechead"><span>Scenes</span><small>each jumps to ${view.leadInMs/1000} s before</small></div><ol class="scenes" data-scroll="scenes">${view.scenes.map(s=>`<li class="${s.mark}" data-index="${s.index}"><button type="button" data-act="jump" data-arg="${s.index}" data-k="jump:${s.index}" title="${esc(`${s.typeWord} · ${s.title}`)}"${s.mark==='playing'?' aria-current="true"':''}${dis}><span class="n">${s.number}</span><span class="w"><span class="t">${esc(s.time)}</span>${s.duration?` <span class="d">(${esc(s.duration)})</span>`:''}</span><span class="st">${s.mark}</span></button></li>`).join('')}</ol>`:'';
 const statusText=`${view.status.strong??''}${view.status.rest??''}${view.status.name?`${view.status.name}${view.status.version?` · ${view.status.version}`:''}`:''}`;
 const status=`<p class="status" title="${esc(statusText)}">${view.status.strong?`<b>${esc(view.status.strong)}</b>`:''}${esc(view.status.rest)}${view.status.name?`<b>${esc(view.status.name)}</b>${view.status.version?` · ${esc(view.status.version)}`:''}`:''}</p>`;
 const onFoot=`<div class="foot">${button('stop','Stop edit')}${link('change','Change edit…')}</div>`;
 const nav=`${button('previous','Previous scene',{title:view.previousTitle,disabled:!view.canPrevious,icon:'previous'})}${button('next','Next scene',{title:view.nextTitle,disabled:!view.canNext,icon:'next'})}`;
 let body='';
 switch(view.kind){
  case 'identifying':body=status;break;
  case 'none':body=`${status}<div class="row">${button('find','Find an edit',{primary:true})}</div><p class="note">Opens this episode’s edits on the website.</p>`;break;
  case 'ready':body=`${status}<div class="row">${button('watch','Watch with edit',{primary:true,arg:view.releaseId??''})}</div><div class="foot"><span></span>${link('change','Change edit…')}</div>`;break;
  case 'choose':body=`${status}${chooser(matches)}${findMore}`;break;
  // E61: Pause / Resume / Retry now / Cancel download for a queued or running download.
  case 'downloading':{const controls=view.download.controls??[],names={pause:'Pause',resume:'Resume',retry:'Retry now',cancel:'Cancel download'};
   const row=controls.length?`<div class="row">${controls.map(c=>button('dl-'+c,names[c],{arg:view.releaseId??'',primary:c==='resume'||c==='retry'})).join('')}</div>`:'';
   body=`<div class="prog"><div class="bar"><i style="width:${view.download.percent??0}%"></i></div><small>${esc(view.download.label)}</small></div>${row}${view.download.stalled?`<div class="row">${controls.includes('retry')?'':button('check-again','Check again',{arg:view.releaseId??''})}${button('copy-stall','Report')}</div><details hidden><summary>Details for support</summary><code>${esc(details)}</code></details>`:''}<p class="note">${esc(view.note)}</p>`;break;}
  case 'waiting':case 'playing':body=view.preview?`${status}<div class="row">${button('again','Preview again',{title:view.scenes[0]?.title??''})}</div><div class="foot">${button('stop','Stop preview')}<span></span></div>`
   :`${status}${progress}<div class="row">${nav}</div>${scenes}${onFoot}`;break;
  case 'behind':body=`${status}${progress}<div class="row">${button('jump-first','Jump to scene 1',{primary:true,title:view.scenes[0]?.title??''})}${button('next','Next scene',{title:view.nextTitle,disabled:!view.canNext,icon:'next'})}</div>${scenes}${onFoot}`;break;
  // A creator preview (E57 C4): Preview again and Stop preview, never Find another edit.
  case 'finished':body=view.preview?`${status}<div class="row">${button('again','Preview again',{primary:true,title:view.scenes[0]?.title??''})}</div><div class="foot">${button('stop','Stop preview')}<span></span></div>`
   :`${status}${progress}<div class="row">${button('again','Watch again',{primary:true,title:view.scenes[0]?.title??''})}${button('find','Find another edit')}</div><div class="foot">${button('stop','Stop edit')}<span></span></div>`;break;
  case 'problem':body=`<p class="err" role="alert">${esc(view.problem.sentence)}</p><div class="row">${button(view.problem.fix.act,view.problem.fix.label,{primary:true,k:'fix',arg:view.releaseId??''})}${view.clearRelease?button('dl-clear','Clear',{arg:view.clearRelease}):''}</div><details><summary>Details for support</summary><code>${esc(details)}</code>${link('copy','Copy details')}</details>`;break;
  default:body=status;
 }
 // 0.62.21: with Record scene timing on, the menu saves this tab's own report.
 if(timing&&view.kind!=='unavailable')body+=`<p class="note">${link('save-timing','Save scene timing report')}</p>`;
 // 0.64.0 (E70): the episode block for an edit pack's edit.json, from the live player.
 if(episode&&view.kind!=='unavailable')body+=`<p class="note">${link('copy-episode','Copy episode details')}</p>`;
 // 0.64.4 (security review F7): a replacer function, so "$`", "$'" or "$&" in the feedback text are never expanded.
 return {head,body:body.replace(/(<div class="foot">|<p class="note"><button class="xl" type="button" data-act="save-timing"|$)/,(_,marker)=>fb+marker)};
}

export function mountViewerOverlay({document,read,command,openSettings,saveTiming,signal,canPlayEdits=true,version=''}) {
 const host=document.createElement('div');host.id='seamless-status';const root=host.attachShadow({mode:'closed'});
 root.innerHTML=`<style>${STYLE}</style><button id="chip" type="button" aria-expanded="false" aria-controls="menu" aria-label="Seamless Scene: Off"></button><section id="menu" hidden aria-label="Seamless Scene player menu"><div id="head"></div><div id="body"></div><p id="live" class="sr" role="status" aria-live="polite"></p></section><div id="rail" hidden role="img" aria-label="Edited playback timeline"></div>`;
 const chip=root.querySelector('#chip'),menu=root.querySelector('#menu'),rail=root.querySelector('#rail'),live=root.querySelector('#live');
 const head=root.querySelector('#head'),body=root.querySelector('#body');
 let prefs={overlay:'minimal',corner:'left'},closed=false,busy=false,acting=null,problem=null,problemRelease=null,problemAt=null,feedback='',feedbackBad=false,changing=false,last=null,lastView=null,announced='';
 const open=()=>!menu.hidden;
 // Follow the playing (or next) scene in the list until the viewer scrolls it
 // themselves; after that their position is kept until the menu is opened again.
 let userScrolled=false,followed=null;const programmatic=new WeakMap();
 const setOpen=value=>{menu.hidden=!value;chip.setAttribute('aria-expanded',String(value));if(!value)changing=false;if(value){userScrolled=false;followed=null;}wake();};
 root.addEventListener('scroll',e=>{const t=e.target;if(!t?.dataset?.scroll)return;const expected=programmatic.get(t);if(Number.isFinite(expected)&&Math.abs(t.scrollTop-expected)<=1)return;userScrolled=true;},true);
 const follow=()=>{
  if(userScrolled)return;const list=body.querySelector?.('[data-scroll="scenes"]');if(!list)return;
  const item=list.querySelector?.('li.playing')??list.querySelector?.('li.next');const key=item?.dataset?.index??null;
  if(!item||key===followed)return;followed=key;
  const top=followTop({scrollTop:list.scrollTop,height:list.clientHeight,itemTop:item.offsetTop,itemHeight:item.offsetHeight});
  if(top!==null){list.scrollTop=top;programmatic.set(list,list.scrollTop);}
 };
 // Replace a section only when its markup changes, keeping keyboard focus on the same control.
 const shown=new WeakMap();
 const put=(el,html)=>{if(shown.get(el)===html)return;const focused=root.activeElement&&el.contains(root.activeElement)?root.activeElement.dataset?.k:null;const positions=scrollPositions(el);el.innerHTML=html;shown.set(el,html);for(const n of restoreScroll(el,positions))programmatic.set(n,n.scrollTop);if(focused){const again=[...el.querySelectorAll('[data-k]')].find(node=>node.dataset.k===focused);(again&&!again.disabled?again:chip).focus();}};
 async function run(name,args={}){
  if(acting)return;acting=name;problem=null;problemRelease=null;feedbackBad=false;feedback=BUSY_TEXT[name]??'Updating playback…';void update();
  try{const result=await command(name,args);feedback='';if(result?.message)live.textContent=result.message;if(name==='watch')changing=false;}
  catch(e){const s=last?.state;
   // While an edit is on, a failed action is a line under the status; otherwise it is the Problem state.
   if(['armed','active','paused','restoring','finished'].includes(s)){feedback=viewerFailureMessage(e);feedbackBad=true;}
   else{feedback='';problem=viewerFailureCode(e)==='unknown'?'viewer-operation-failed':viewerFailureCode(e);problemRelease=typeof args.releaseId==='string'?args.releaseId:null;problemAt=new Date();}}
  finally{acting=null;void update();}
 }
 const act=(name,arg,button)=>{
  const view=lastView;
  if(name==='watch')return view?.armDirect&&!arg?run('arm'):run('watch',arg?{releaseId:arg}:{});
  if(name==='choose')return run('watch',{releaseId:arg});
  if(name==='stop')return run('stop');
  if(name==='find')return run('find-another');
  if(name==='jump')return run('jump-scene',{index:Number(arg)});
  if(name==='jump-first'||name==='again')return run('jump-scene',{index:0});
  if(name==='next')return run('next-scene');
  if(name==='previous')return run('previous-scene');
  if(name==='change'){changing=true;void update().then(()=>body.querySelector('.choose button:not([disabled]),[data-k="find-more"]')?.focus());return;}
  if(name==='back'){changing=false;void update().then(()=>body.querySelector('[data-k="change"]')?.focus());return;}
  if(name==='reload'){location.reload();return;}
  // E60: re-check every clip of this edit (after the page reloads), or copy what is stuck.
  if(name==='copy-episode'){
   const block=episodeDetails(last);if(!block)return;
   void Promise.resolve().then(()=>navigator.clipboard.writeText(episodeDetailsText(block))).then(()=>{feedback='Episode details copied. Paste them into edit.json.';feedbackBad=false;},()=>{feedback='Copy failed. Try again.';feedbackBad=true;}).finally(()=>{live.textContent=feedback;void update();});return;}
  if(name==='save-timing'){
   if(acting||typeof saveTiming!=='function')return;acting=name;feedback='Saving the scene timing report…';feedbackBad=false;void update();
   void Promise.resolve().then(()=>saveTiming()).then(r=>{feedback=r?.message??'';feedbackBad=r?.saved!==true;},()=>{feedback='The scene timing report could not be saved. Try again.';feedbackBad=true;})
    .finally(()=>{live.textContent=feedback;acting=null;void update();});return;}
  if(/^dl-(pause|resume|retry|cancel|clear)$/.test(name)&&arg)return run('download',{action:name.slice(3),releaseId:arg});
  if(name==='check-again'){void run('check-again',arg?{releaseId:arg}:{}).then(()=>{if(!problem)location.reload();});return;}
  if(name==='copy-stall'){const text=root.querySelector('details code')?.textContent??'';void Promise.resolve().then(()=>navigator.clipboard.writeText(text)).then(()=>{live.textContent='Details copied.';button.textContent='Copied';},()=>{live.textContent='Copy failed.';});return;}
  if(name==='link'){openSettings?.('account');return;}
  if(name==='library'){openSettings?.('library');return;}
  if(name==='local'){openSettings?.('local');return;}
  if(name==='copy'){const text=root.querySelector('details code')?.textContent??'';
   void Promise.resolve().then(()=>navigator.clipboard.writeText(text)).then(()=>{live.textContent='Details copied.';button.textContent='Copied';},()=>{const range=document.createRange();range.selectNodeContents(root.querySelector('details code'));const sel=getSelection?.();sel?.removeAllRanges();sel?.addRange(range);live.textContent='Select and copy the details above.';});return;}
  void view;
 };
 root.addEventListener('click',e=>{const b=e.target.closest?.('[data-act]');if(!b||b.disabled)return;act(b.dataset.act,b.dataset.arg,b);});
 chip.onclick=()=>{setOpen(!open());if(open()&&last)render(last);if(open())void update();};
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&open()){e.stopPropagation();setOpen(false);chip.focus();}});
 // Fade the badge after about 3 s without pointer movement, unless the menu is open or focused.
 let idleTimer=null;
 function wake(){host.classList?.remove('idle');clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!closed&&!open()&&!root.activeElement)host.classList?.add('idle');},IDLE_MS);}
 const onPointer=()=>wake();
 document.addEventListener('pointermove',onPointer,{capture:true,passive:true});
 root.addEventListener('focusin',wake);
 const place=()=>{const parent=document.fullscreenElement??document.body;if(host.parentNode!==parent)parent.append(host);};
 function render(s){
  last=s;
  const allowed=prefs.overlay!=='none'&&s.state!=='unavailable'&&(canPlayEdits||prefs.advanced===true);
  if(!allowed){host.remove?.();return;}
  place();host.hidden=false;
  host.style.left=prefs.corner==='right'?'auto':'20px';host.style.right=prefs.corner==='right'?'20px':'auto';
  const on=['armed','active','paused','restoring'].includes(s.state);
  if(problem&&(on||(problemAt&&Date.now()-problemAt.getTime()>120_000))){problem=null;problemRelease=null;problemAt=null;}
  const view=viewerView({playback:s,matches:s.matches??[],load:s.load,prefs,problem,problemReleaseId:problemRelease});
  view.currentId=on||s.state==='loaded'?s.editId:'';
  lastView=view;
  const iconState=`${view.badge}:${s.paused===true&&['on','ready'].includes(view.badge)}`;
  if(chip.dataset.iconState!==iconState){chip.innerHTML=stateIcon(view.badge,s.paused===true&&['on','ready'].includes(view.badge));chip.dataset.iconState=iconState;}
  const label=`Seamless Scene: ${view.chip.text}${view.name&&!['none','choose','identifying'].includes(view.kind)?` · ${view.name}`:''}`;
  chip.setAttribute('aria-label',label);chip.title=label;
  if(view.chip.text!==announced){if(announced)live.textContent=`Seamless Scene: ${view.chip.text}.`;announced=view.chip.text;}
  if(view.kind==='problem'&&!problemAt)problemAt=new Date();if(view.kind!=='problem')problemAt=null;
  const details=view.problem?supportDetails(view.problem.code,version,problemAt??new Date())
   :view.download?.stalled?supportDetails(`stalled:${view.download.step}:${view.download.done}/${view.download.total}`,version,new Date()):'';
  const markup=menuMarkup(view,{matches:s.matches??[],changing,busy:Boolean(acting),feedback,feedbackBad,details,timing:prefs.timing===true&&typeof saveTiming==='function',episode:Boolean(episodeDetails(s))});
  if(open()){put(head,markup.head);put(body,markup.body);follow();}
  rail.hidden=prefs.overlay!=='detailed'||!s.timeline;rail.replaceChildren();
  if(!rail.hidden){const t=s.timeline;for(let i=0;i<=8;i++){const tick=document.createElement('span');tick.className='tick';tick.style.top=`${i*12.5}%`;if(i%2===0)tick.style.width='18px';rail.append(tick);}
   for(const p of t.segments??[]){if(!['INSERT','REPLACE','MUTE','SKIP'].includes(p.type))continue;const r=document.createElement('span');r.className='region '+(p.type==='INSERT'?'insert':p.type==='MUTE'?'mute':p.type==='SKIP'?'skip':'');r.style.top=`${p.startMs/t.durationMs*100}%`;r.style.height=`${(p.endMs-p.startMs)/t.durationMs*100}%`;rail.append(r);}
   if(Number.isFinite(t.positionMs)){const p=document.createElement('span');p.id='cursor';p.style.top=`${t.positionMs/t.durationMs*100}%`;rail.append(p);}rail.setAttribute('aria-label',`Edited timeline ${formatTime(t.positionMs)} of ${formatTime(t.durationMs)}`);
  }
 }
 let lastState='unavailable',timer=null;
 async function update(){if(closed||busy)return;busy=true;try{const s=await read();lastState=s.state;render(s);}catch{host.remove?.();}finally{busy=false;}}
 // Four updates a second only while an edit is on; otherwise every 1.5 s.
 const tick=()=>{if(closed)return;timer=setTimeout(()=>{void update().finally(tick);},['armed','active'].includes(lastState)||open()?250:1500);};
 document.addEventListener('fullscreenchange',update);void update().finally(tick);wake();
 const close=()=>{closed=true;clearTimeout(timer);clearTimeout(idleTimer);document.removeEventListener('fullscreenchange',update);document.removeEventListener('pointermove',onPointer,{capture:true});host.remove();};signal?.addEventListener('abort',close,{once:true});
 return {preferences(value){prefs=value;void update();},close};
}

export {problemFor};
