import { preferences, preferenceChange, primeStreamingUrl } from './viewer-model.mjs';
import { displayHint, isReleaseId, RECOVERY_LIMIT } from './library-recovery.mjs';
const text=(v,max)=>typeof v==='string'&&v.length<=max?v:undefined;
function metadata(x={}){
 const out={};
 if(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x.editId??''))out.editId=x.editId;
 for(const [key,max] of [['name',200],['creatorName',120],['titleName',200],['episodeName',200]])if(text(x[key],max)!==undefined)out[key]=x[key];
 const url=primeStreamingUrl(x.streamingUrl);if(url)out.streamingUrl=url;
 for(const key of ['downloadedAt','lastWatchedAt'])if(Number.isSafeInteger(x[key])&&x[key]>0)out[key]=x[key];
 // Website r30 display version ("v4"); never part of identity (`version` is manifest_version).
 if(Number.isSafeInteger(x.displayVersion)&&x.displayVersion>=1&&x.displayVersion<=2147483647)out.displayVersion=x.displayVersion;
 // 0.63.0: what the edit does (clips and times), so an identical local .ss is offered once.
 if(/^[a-f0-9]{64}$/.test(x.editSignature??''))out.editSignature=x.editSignature;
 return out;
}
export function createViewerStore({indexedDB=globalThis.indexedDB,name='seamless-viewer-v1'}={}) {
  let opening;
  const open=()=>opening??=new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onerror=r.onblocked=()=>reject(Error('viewer-storage-unavailable'));r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};});
  async function transaction(operation){const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let result,error;
    const r=store.get('model');r.onsuccess=()=>{try{const s=r.result??{version:1,preferences:preferences(),library:[],selections:{}};
      if(s.version!==1||!Array.isArray(s.library)||s.library.length>256||!s.selections||typeof s.selections!=='object')throw Error('viewer-storage-corrupt');
      result=operation(s);store.put(s,'model');}catch(e){error=e;tx.abort();}};
    tx.oncomplete=()=>resolve(structuredClone(result));tx.onabort=()=>reject(error??Error('viewer-storage-write-failed'));tx.onerror=()=>{};
  });}
  return Object.freeze({
    read:()=>transaction(s=>({...s,preferences:preferences(s.preferences)})),
    preferences:patch=>transaction(s=>s.preferences=preferenceChange(s.preferences,patch)),
    reset:()=>transaction(s=>s.preferences=preferences()),
    remember:(key,id,disabled=false,version="")=>transaction(s=>{
      if(typeof key!=='string'||key.length>2048||typeof id!=='string'||id.length>128)throw Error('viewer-selection-invalid');
      if(!Object.hasOwn(s.selections,key)&&Object.keys(s.selections).length>=256)throw Error('viewer-selection-capacity');
      // After the first Stop/authoring action the player has no edit ID. Later
      // seeks and captures must keep its explicit choice while disabling auto-arm.
      const prior=disabled&&!id&&Object.hasOwn(s.selections,key)?s.selections[key]:null;
      s.selections[key]={id:prior?.id??id,disabled,version:prior?.version??String(version).slice(0,64)};
    }),
    upsert:item=>transaction(s=>{if(!item||!['website','local'].includes(item.origin)||typeof item.id!=='string'||!/^[a-zA-Z0-9._:-]{1,128}$/.test(item.id)||typeof item.title!=='string'||item.title.length>200)throw Error('viewer-library-invalid');
      // Explicit projection: no files, URL, paths, license bodies or arbitrary metadata.
      const i=s.library.findIndex(x=>x.id===item.id&&x.origin===item.origin),prior=i>=0?s.library[i]:{};
      const v={id:item.id,title:item.title,origin:item.origin,version:String(item.version??'').slice(0,64),sourceKey:String(item.sourceKey??'').slice(0,2048),
        transport:['protected','catalog','local'].includes(item.transport)?item.transport:'local',availability:['downloaded','interrupted','missing','reimport-required'].includes(item.availability)?item.availability:'missing',leaseExpiresAt:Number.isFinite(item.leaseExpiresAt)?item.leaseExpiresAt:null,bytes:Number.isSafeInteger(item.bytes)&&item.bytes>=0?item.bytes:null,
        // Website metadata for the Edits page; kept across updates that do not carry it.
        ...metadata(prior),...metadata(item)};
      // Several website edits stay downloaded now (the Edits page budget decides).
      if(i>=0)s.library[i]=v;else{if(s.library.length>=256)throw Error('viewer-library-capacity');s.library.push(v);}return v;}),
    annotate:(id,origin,fields)=>transaction(s=>{const item=s.library.find(x=>x.id===id&&x.origin===origin);if(item)Object.assign(item,metadata(fields));return item??null;}),
    // "Watch this edit" from the website: the release to fetch and enable, for a day.
    addIntent:(releaseId,now=Date.now(),replaces)=>transaction(s=>{const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;if(!id.test(releaseId)||(replaces!==undefined&&!id.test(replaces)))throw Error('viewer-release-invalid');s.intents=(s.intents??[]).filter(x=>x.releaseId!==releaseId&&x.expiresAt>now).slice(-9);s.intents.push({releaseId,attemptId:crypto.randomUUID(),createdAt:now,expiresAt:now+86_400_000,...(replaces?{replaces}:{})});return s.intents;}),
    // An updated release takes over the remembered choices of the one it replaces.
    repoint:(from,to)=>transaction(s=>{for(const selection of Object.values(s.selections))if(selection.id===from)selection.id=to;}),
    // Keep both downloads. Publish the new choice and consume only this attempt
    // in one transaction, after the replacement has its own library identity.
    completeUpdate:(releaseId,attempt)=>transaction(s=>{
      const intent=(s.intents??[]).find(x=>x.releaseId===releaseId&&(x.attemptId??x.createdAt)===attempt&&x.replaces);
      const replacement=s.library.find(x=>x.id===releaseId&&x.origin==='website');
      if(!intent||!replacement||replacement.transport!=='protected'||replacement.availability!=='downloaded'||!replacement.sourceKey||!replacement.version)return false;
      const old=s.library.find(x=>x.id===intent.replaces&&x.origin==='website');
      if(old){
        const inherited=metadata(old);
        for(const key of Object.keys(inherited))if(replacement[key]==null)replacement[key]=inherited[key];
      }
      for(const selection of Object.values(s.selections))if(selection.id===intent.replaces){selection.id=releaseId;selection.version=replacement.version;}
      s.intents=s.intents.filter(x=>x!==intent);
      return true;
    }),
    // Exact-release status hints (library-recovery.mjs). A hint fills only
    // missing descriptive fields and never replaces a source key, version or
    // edit ID recorded by opening the packet; a contradicting hint is ignored.
    // A key an earlier hint supplied is replaced by a kept release's hint. A
    // missing row is created only for entries the caller proved kept (vault entry or renderer
    // ready receipt). Opening the packet later replaces the hinted identity
    // through upsert, which also drops the metadataSource marker.
    recoverMetadata:(entries,now=Date.now())=>transaction(s=>{
      const changed=[];
      for(const entry of Array.isArray(entries)?entries.slice(0,RECOVERY_LIMIT):[]){
        const hint=displayHint(entry?.display),id=entry?.releaseId,kept=entry?.kept===true;
        if(!hint||!isReleaseId(id))continue;
        const version=String(hint.releaseVersion),{releaseVersion,sourceKey,...described}=hint,fill=metadata(described);
        const row=s.library.find(x=>x.id===id&&x.origin==='website');
        if(!row){
          if(!kept||s.library.length>=256)continue;
          s.library.push({id,title:hint.name,origin:'website',version,sourceKey,transport:'protected',availability:'downloaded',leaseExpiresAt:null,bytes:null,...fill,downloadedAt:now,metadataSource:'status-hint'});
          changed.push(id);continue;
        }
        if(row.transport!=='protected'||(row.editId&&row.editId!==hint.editId))continue;
        let touched=false;
        // A key that only an earlier status hint supplied is not a packet's
        // record: a kept release's newer exact-release hint replaces it (E51).
        // A key recorded by opening the packet still wins over any hint.
        if(kept&&row.metadataSource==='status-hint'&&(row.sourceKey!==sourceKey||row.version!==version)){row.sourceKey=sourceKey;row.version=version;touched=true;}
        else if((row.sourceKey&&row.sourceKey!==sourceKey)||(row.version&&row.version!==version))continue;
        if(kept&&(!row.sourceKey||!row.version)){row.sourceKey||=sourceKey;row.version||=version;row.metadataSource='status-hint';touched=true;}
        for(const [key,value] of Object.entries(fill))if(row[key]==null||row[key]===''){row[key]=value;touched=true;}
        // A release's position in its edit can move only if an earlier release is removed; follow it.
        if(fill.displayVersion&&row.displayVersion!==fill.displayVersion){row.displayVersion=fill.displayVersion;touched=true;}
        if(kept&&row.availability==='downloaded'&&!row.downloadedAt){row.downloadedAt=now;touched=true;}
        if(touched)changed.push(id);
      }
      return changed;
    }),
    intents:(now=Date.now())=>transaction(s=>(s.intents??[]).filter(x=>x.expiresAt>now)),
    // Refusal belongs to one Watch attempt. Keep the evidence, and never let an
    // old request mark a newer same-release request failed (even in the same ms).
    failIntent:(releaseId,attempt)=>transaction(s=>{const intent=(s.intents??[]).find(x=>x.releaseId===releaseId&&(x.attemptId??x.createdAt)===attempt);if(!intent)return false;intent.failureCode='viewer-release-unavailable';return true;}),
    // 0.63.2: a Watch the user paused, or one whose download failed, is marked so it never
    // restarts by itself (paused: resumes only on Resume; failedAt: only a new Watch or Retry).
    markIntent:(releaseId,patch)=>transaction(s=>{const intent=(s.intents??[]).find(x=>x.releaseId===releaseId);if(!intent)return false;
      if(typeof patch?.paused==='boolean')intent.paused=patch.paused;if(patch?.failedAt===null){delete intent.failedAt;delete intent.failedCode;}else if(Number.isSafeInteger(patch?.failedAt)){intent.failedAt=patch.failedAt;if(/^viewer-[a-z-]{1,60}$/.test(patch.failedCode??''))intent.failedCode=patch.failedCode;}return true;}),
    // 0.63.2: queued, failed or paused Watches that went stale (a browser restart, or 12 hours)
    // leave the queue for good and are listed once as "Previously queued" (Download again).
    expireIntents:(shouldExpire,now=Date.now())=>transaction(s=>{const moved=[];s.intents=(s.intents??[]).filter(x=>{if(x.expiresAt>now&&!shouldExpire(x))return true;moved.push(x);return false;});
      s.previous=[...(s.previous??[]).filter(p=>!moved.some(m=>m.releaseId===p.releaseId)),...moved.map(x=>({releaseId:x.releaseId,queuedAt:x.createdAt??null,expiredAt:now}))].slice(-20);return moved.map(x=>x.releaseId);}),
    // 0.63.3: names learned for releases (website status), so a restart keeps them (bounded).
    rememberRelease:(releaseId,info)=>transaction(s=>{if(!/^[a-f0-9-]{36}$/.test(releaseId??''))return;const clean={};for(const [k,max] of [['name',200],['titleName',200],['episodeName',200],['sourceKey',2048],['streamingUrl',2048]])if(typeof info?.[k]==='string'&&info[k])clean[k]=info[k].slice(0,max);
      if(!clean.name)return;const names={...(s.releaseNames??{})};delete names[releaseId];names[releaseId]=clean;const ids=Object.keys(names);for(const id of ids.slice(0,Math.max(0,ids.length-64)))delete names[id];s.releaseNames=names;}),
    previousQueue:(now=Date.now())=>transaction(s=>{s.previous=(s.previous??[]).filter(p=>now-p.expiredAt<86_400_000);return s.previous;}),
    clearPrevious:releaseId=>transaction(s=>{s.previous=releaseId?(s.previous??[]).filter(p=>p.releaseId!==releaseId):[];}),
    // 0.63.2: a Library Remove waiting out its Undo window, kept so closing the page cannot lose it.
    pendingRemovals:()=>transaction(s=>s.pendingRemovals??[]),
    setPendingRemoval:(releaseId,at)=>transaction(s=>{s.pendingRemovals=(s.pendingRemovals??[]).filter(r=>r.releaseId!==releaseId);if(at!==null)s.pendingRemovals.push({releaseId,at});s.pendingRemovals=s.pendingRemovals.slice(-50);return s.pendingRemovals;}),
    consumeIntent:(releaseId,attempt)=>transaction(s=>{s.intents=(s.intents??[]).filter(x=>x.releaseId!==releaseId||(attempt!==undefined&&(x.attemptId??x.createdAt)!==attempt));}),
    invalidateProtected:()=>transaction(s=>{const ids=new Set();for(const item of s.library)if(item.transport==='protected'){item.availability='missing';item.leaseExpiresAt=null;ids.add(item.id);}for(const selection of Object.values(s.selections))if(ids.has(selection.id))selection.disabled=true;}),
    remove:(id,origin)=>transaction(s=>{s.library=s.library.filter(x=>x.id!==id||x.origin!==origin);}),
    // Local edits (.ss, 0.63.0): one index row per stored copy (OPFS local/<archive_id>/edit.ss).
    // The rows are display and matching data; the renderer re-reads and checks the copy when used.
    async localEdits(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),r=tx.objectStore('state').getAll(IDBKeyRange.bound('local:','local:\uffff'));tx.oncomplete=()=>resolve((r.result??[]).filter(x=>x&&/^[a-f0-9]{64}$/.test(x.archiveId??'')).sort((a,b)=>(a.addedAt??0)-(b.addedAt??0)));tx.onabort=tx.onerror=()=>reject(Error('viewer-local-read-failed'));});},
    async saveLocalEdit(row){if(!row||!/^[a-f0-9]{64}$/.test(row.archiveId??'')||typeof row.packetId!=='string'||!Number.isSafeInteger(row.revision))throw Error('viewer-local-invalid');const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),value=structuredClone(row);tx.objectStore('state').put(value,'local:'+row.archiveId);tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(Error('viewer-local-write-failed'));});},
    async updateLocalEdit(archiveId,patch){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),r=store.get('local:'+archiveId);let value=null;r.onsuccess=()=>{if(r.result){value={...r.result,...structuredClone(patch),archiveId};store.put(value,'local:'+archiveId);}};tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(Error('viewer-local-write-failed'));});},
    // The default folder's last check ("Checked 2 min ago · 3 edits · 1 new"); no argument reads it.
    async localFolderCheck(value){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state',value===undefined?'readonly':'readwrite'),store=tx.objectStore('state');const r=value===undefined?store.get('localcheck'):store.put(structuredClone(value),'localcheck');tx.oncomplete=()=>resolve(value===undefined?r.result??null:value);tx.onabort=tx.onerror=()=>reject(Error('viewer-local-read-failed'));});},
    // 0.63.3: stored copies whose removal must wait (still open in a Prime tab); deleted later.
    // 0.63.3: download statistics and phase history for Copy diagnostics, kept on their own
    // (Clear only dismisses rows) and across restarts: the last 50 completed downloads, 120 phases.
    async downloadLog(append){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),r=store.get('downloadlog');let value;
      r.onsuccess=()=>{const prior=r.result??{stats:[],history:[]};value={stats:[...(prior.stats??[]),...(append?.stats??[])].slice(-50),history:[...(prior.history??[]),...(append?.history??[])].slice(-120)};if(append)store.put(structuredClone(value),'downloadlog');};
      tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(Error('viewer-storage-write-failed'));});},
    // 0.64.0: default-folder zips already converted: name|size|lastModified → archive_id (bounded).
    async localPackCache(map){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state',map===undefined?'readonly':'readwrite'),store=tx.objectStore('state');const r=map===undefined?store.get('localpackcache'):store.put(Object.fromEntries(Object.entries(map).filter(([k,v])=>typeof k==='string'&&k.length<=600&&(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)||(v&&typeof v==='object'&&typeof v.refused==='string'&&v.refused.length<=60&&typeof v.message==='string'&&v.message.length<=400&&Object.keys(v).length===2))).slice(-200)),'localpackcache');tx.oncomplete=()=>resolve(map===undefined?(r.result??{}):map);tx.onabort=tx.onerror=()=>reject(Error('viewer-local-write-failed'));});},
    async localOrphans(list){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state',list===undefined?'readonly':'readwrite'),store=tx.objectStore('state');const r=list===undefined?store.get('localorphans'):store.put([...new Set(list)].filter(id=>/^[a-f0-9]{64}$/.test(id)).slice(-50),'localorphans');tx.oncomplete=()=>resolve(list===undefined?(r.result??[]):list);tx.onabort=tx.onerror=()=>reject(Error('viewer-local-write-failed'));});},
    async removeLocalEdit(archiveId){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').delete('local:'+archiveId);tx.oncomplete=()=>resolve(true);tx.onabort=tx.onerror=()=>reject(Error('viewer-local-write-failed'));});},
    async folder(key,handle){if(!['imports','exports','local'].includes(key))throw Error('viewer-folder-invalid');const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state',handle===undefined?'readonly':'readwrite'),store=tx.objectStore('state');const r=handle===undefined?store.get('folder:'+key):handle===null?store.delete('folder:'+key):store.put(handle,'folder:'+key);tx.oncomplete=()=>resolve(r.result??null);tx.onabort=tx.onerror=()=>reject(Error('viewer-folder-write-failed'));});}
  });
}
