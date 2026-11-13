// Privileged extension-origin database. Never expose this module as a page RPC.
export function createDeviceJournal({indexedDB=globalThis.indexedDB,name='seamless-device-links-v1'}={}) {
 let opening;
 function open(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('private');r.onerror=r.onblocked=()=>reject(Error('device-storage-unavailable'));r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};});}
 async function update(expected,fn){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('private','readwrite'),s=tx.objectStore('private'),r=s.get('state');let result,error;
  r.onsuccess=()=>{try{const v=r.result??{version:1,generation:0,active:null,pending:null,revocations:[]};if(v.version!==1||!Number.isSafeInteger(v.generation)||v.generation<0||!Array.isArray(v.revocations)||v.revocations.length>32)throw Error('device-storage-invalid');if(expected!==undefined&&v.generation!==expected)throw Error('device-generation-changed');result=fn(v);s.put(v,'state');}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>resolve(structuredClone(result));tx.onabort=()=>reject(error??Error('device-storage-write-failed'));tx.onerror=()=>{};
 });}
 return Object.freeze({read:()=>update(undefined,v=>v),change:update,
  invalidate:()=>update(undefined,v=>{if(v.active)v.revocations.push({active:v.active});if(v.pending)v.revocations.push({pending:v.pending});if(v.revocations.length>32)throw Error('device-revocation-capacity');v.active=null;v.pending=null;v.generation++;return v;})});
}
