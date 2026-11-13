import test from 'node:test';
import assert from 'node:assert/strict';
import {loadedEditMetadata, loadedEditLabel, createLoadedEditDisplayReader} from '../src/loaded-edit-display.mjs';

const loaded={state:'armed',editId:'release-v2',sourceKey:'episode-a',version:'2',canStop:true};
const row={id:'release-v2',sourceKey:'episode-a',version:'2',name:'Council Meets',title:'Series'};
test('loaded label binds the exact release, source and version rather than the selected or latest edit',()=>{
  assert.deepEqual(loadedEditMetadata(loaded,[row]),{editName:'Council Meets'});
  assert.equal(loadedEditLabel({...loaded,...loadedEditMetadata(loaded,[row])}),'Council Meets · v2');
  for(const patch of [{id:'successor'},{version:'3'}])
    assert.deepEqual(loadedEditMetadata(loaded,[{...row,...patch}]),{});
  assert.deepEqual(loadedEditMetadata(loaded,[row,{...row,name:'Conflicting'}]),{});
  assert.deepEqual(loadedEditMetadata(loaded,[row,{...row,origin:'local'}]),{editName:'Council Meets'});
});
test('library source keys come from the packet and never equal the key observed from Prime (0.60.3 regression)',()=>{
  const packetKey=JSON.stringify(['prime','amzn1.dv.gti.x','episode',1,10,2701032,null,'US','ad-free']);
  const observedKey=JSON.stringify(['prime','amzn1.dv.gti.x','episode',1,10,2716016,null,null,null]);
  const playing={...loaded,sourceKey:observedKey};
  assert.deepEqual(loadedEditMetadata(playing,[{...row,sourceKey:packetKey,version:2}]),{editName:'Council Meets'});
});
test('cleared and unavailable playback cannot keep a prior name; unknown names stay empty',()=>{
  for(const state of ['idle','unavailable']){
    assert.deepEqual(loadedEditMetadata({...loaded,state},[row]),{});
    assert.equal(loadedEditLabel({...loaded,state,editName:row.name}),'');
  }
  assert.equal(loadedEditLabel(loaded),'');
  assert.deepEqual(loadedEditMetadata(loaded,[{...row,name:'',title:'My local edit'}]),{editName:'My local edit'});
  assert.deepEqual(loadedEditMetadata(loaded,[{...row,name:'x'.repeat(201),title:null}]),{});
});
test('display reader clears a cached title when the loaded release changes and a stale worker reply arrives',async()=>{
  let current={...loaded},reply={...loaded,editName:row.name},requests=0,time=0;
  const labels=[];
  const read=createLoadedEditDisplayReader({read:async()=>current,request:async()=>{requests++;return {playback:reply};},show:label=>labels.push(label),now:()=>time});
  assert.equal((await read()).editName,row.name);
  time=250;await read();assert.equal(requests,1,'do not ask the worker at each overlay tick');
  current={...loaded,editId:'release-v3',version:'3'};
  assert.equal((await read()).editName,undefined);assert.equal(labels.at(-1),'');
  reply={...current,editName:'Another edit'};time=3300;
  assert.equal((await read()).editName,'Another edit');assert.equal(labels.at(-1),'Another edit · v3');
  current={state:'idle',editId:'',sourceKey:'episode-a',version:'',canStop:false};
  await read();assert.equal(labels.at(-1),'');
});
test('source/version mismatch or worker failure hides the label while keeping playback and load status usable',async()=>{
  for(const patch of [{sourceKey:'other'},{version:'1'},{editId:'other'}]){
    const read=createLoadedEditDisplayReader({read:async()=>loaded,request:async()=>({playback:{...loaded,...patch,editName:'Wrong'}})});
    assert.equal((await read()).editName,undefined);
  }
  const failure=createLoadedEditDisplayReader({read:async()=>({...loaded,editName:'Unbound name'}),request:async()=>{throw Error('worker offline');}});
  const result=await failure();assert.equal(result.state,'armed');assert.equal(result.editName,undefined);
  const loading=createLoadedEditDisplayReader({read:async()=>({state:'idle',canStop:false}),request:async()=>({load:{state:'downloading',busy:true}})});
  assert.deepEqual((await loading()).load,{state:'downloading',busy:true});
});
