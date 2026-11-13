import test from 'node:test';
import assert from 'node:assert/strict';
import {mountViewerOverlay} from '../src/viewer-overlay.mjs';

// A minimal stand-in for the page: the overlay's closed shadow root is replaced by
// named nodes, and the menu body is inspected as the markup the overlay writes.
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function page(){
 const listeners={root:{},document:{}},focused=[];
 const node=id=>({id,dataset:{},style:{},hidden:id==='menu'||id==='rail',attrs:{},innerHTML:'',textContent:'',
  setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},focus(){root.activeElement=this;focused.push(id);},
  contains:n=>n?.id===id,querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){},append(){},remove(){}});
 const nodes=new Map(['chip','menu','rail','live','head','body'].map(id=>[id,node(id)]));
 const root={activeElement:null,set innerHTML(v){},querySelector:q=>nodes.get(q.slice(1))??null,addEventListener:(k,f)=>{listeners.root[k]=f;}};
 const classes=new Set();
 const host={id:'',style:{},hidden:false,parentNode:null,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},attachShadow:()=>root,remove(){this.parentNode=null;}};
 const body={append(h){h.parentNode=body;}};
 const document={body,fullscreenElement:null,createElement:()=>host,addEventListener:(k,f)=>{listeners.document[k]=f;},removeEventListener(){}};
 return {document,host,nodes,root,listeners,focused,classes,mounted:()=>host.parentNode===body,
  text:()=>nodes.get('body').innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
  click:async act=>{listeners.root.click({target:{closest:()=>({dataset:{act},disabled:false})}});await turn();await turn();},
  open:async()=>{nodes.get('chip').onclick();for(const f of [listeners.root.click])void f;await turn();}};
}
const key=JSON.stringify(['prime-video','item','episode',1,4,2701032,null,null,null]);
async function mount(t,{state,canPlayEdits=true,prefs={overlay:'minimal',corner:'left'},command=async()=>({})}={}){
 const p=page();p.state=state;
 const overlay=mountViewerOverlay({document:p.document,read:async()=>p.state,command:async(...a)=>command(...a),openSettings(){},canPlayEdits,version:'0.61.0'});
 t.after(()=>overlay.close());overlay.preferences(prefs);await turn();await turn();
 p.overlay=overlay;p.refresh=async state=>{p.state=state;overlay.preferences(prefs);await turn();await turn();};
 p.openMenu=async()=>{p.nodes.get('chip').onclick();await p.refresh(p.state);};
 return p;
}

test('the badge is not mounted where edits cannot play, unless Advanced mode is on',async t=>{
 const netflix=await mount(t,{state:{state:'idle',sourceKey:key},canPlayEdits:false});
 assert.equal(netflix.mounted(),false);
 const advanced=await mount(t,{state:{state:'idle',sourceKey:key},canPlayEdits:false,prefs:{overlay:'minimal',corner:'left',advanced:true}});
 assert.equal(advanced.mounted(),true);
 const prime=await mount(t,{state:{state:'idle',sourceKey:key}});
 assert.equal(prime.mounted(),true,'the idle badge is always there on Prime');
 assert.match(prime.nodes.get('chip').innerHTML,/fill="#3a4641"/,'grey, never red, when nothing is on');
 assert.doesNotMatch(prime.nodes.get('chip').innerHTML,/#b43d3d|#e0675f/);
 const hidden=await mount(t,{state:{state:'idle',sourceKey:key},prefs:{overlay:'none',corner:'left'}});
 assert.equal(hidden.mounted(),false,'On-page indicator: Hidden still hides it');
});

test('Esc closes the menu and returns focus to the badge',async t=>{
 const p=await mount(t,{state:{state:'idle',sourceKey:key}});
 await p.openMenu();
 assert.equal(p.nodes.get('menu').hidden,false);
 assert.match(p.text(),/No downloaded edit for this episode/);
 p.listeners.root.keydown({key:'Escape',stopPropagation(){}});
 assert.equal(p.nodes.get('menu').hidden,true);
 assert.equal(p.nodes.get('chip').attrs['aria-expanded'],'false');
 assert.equal(p.focused.at(-1),'chip');
});

test('a failed action is the Problem state while off, and a line under the status while on',async t=>{
 const off=await mount(t,{state:{state:'idle',sourceKey:key,matches:[{id:'a',name:'A',version:'1'}]},command:async()=>{throw Error('viewer-action-failed');}});
 await off.openMenu();await off.click('watch');await off.refresh(off.state);
 assert.match(off.text(),/That did not work\. Try again; if it keeps happening, refresh the Prime Video tab\./);
 assert.doesNotMatch(off.text(),/account link/);
 assert.match(off.nodes.get('head').innerHTML,/Problem/);
 assert.match(off.nodes.get('body').innerHTML,/<code>viewer-action-failed · 0\.61\.0 · /,'the code sits under Details for support');
 assert.match(off.nodes.get('chip').innerHTML,/#e0675f/,'red dot for a real problem');
 const on={state:'armed',sourceKey:key,editId:'e',version:'1',canStop:true,currentTimeMs:1000,scenes:[{type:'REPLACE',startMs:60000,resumeMs:65000,status:'pending'}]};
 const p=await mount(t,{state:on,command:async()=>{throw Error('viewer-scene-unavailable');}});
 await p.openMenu();await p.click('next');await p.refresh(on);
 assert.match(p.nodes.get('head').innerHTML,/>On</);
 assert.match(p.text(),/There is no scene to jump to in that direction\./);
 assert.doesNotMatch(p.text(),/viewer-/);
});

test('the badge fades after about 3 s without pointer movement unless the menu is open',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await mount(t,{state:{state:'idle',sourceKey:key}});
 t.mock.timers.tick(3100);
 assert.equal(p.classes.has('idle'),true);
 p.listeners.document.pointermove();
 assert.equal(p.classes.has('idle'),false,'pointer movement brings it back');
 p.nodes.get('chip').onclick();
 t.mock.timers.tick(5000);
 assert.equal(p.classes.has('idle'),false,'stays while the menu is open');
});

test('the badge styles respect reduced motion and give disabled buttons their own look',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/viewer-overlay.mjs',import.meta.url),'utf8');
 assert.match(source,/@media \(prefers-reduced-motion:reduce\)\{#chip\{transition:none\}\}/);
 assert.match(source,/\.xb\[disabled\][^{]*\{opacity:\.45;cursor:not-allowed\}/);
 assert.doesNotMatch(source,/Settings and library/);
 assert.doesNotMatch(source,/pale green replacement/,'the timeline legend lives in Settings → Playback help');
});
