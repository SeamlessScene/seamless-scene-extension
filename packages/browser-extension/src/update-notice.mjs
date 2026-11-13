import { EDITION } from './build-info.mjs';

// Tells an installed build that the website now distributes a newer reviewed
// version. Advisory only: nothing here downloads, installs or changes trust.
// The store edition never asks: the Chrome Web Store updates it.
export function compareVersions(a,b){
 const parse=v=>typeof v==='string'&&/^\d+(?:\.\d+){2,3}$/.test(v)?v.split('.').map(Number):null;
 const x=parse(a),y=parse(b);if(!x||!y)return null;
 for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]??0)-(y[i]??0);if(d)return Math.sign(d);}
 return 0;
}
export function createUpdateCheck(config,{fetcher=fetch,installed,ttlMs=6*3600_000,now=Date.now,edition=EDITION}={}){
 let cached=null;
 async function check(){
  if(edition==='viewer'||!config.pairingOrigin||config.fixtureOnly===true)return null;
  if(cached&&now()-cached.at<ttlMs)return cached.value;
  let value=null;
  try{
   const r=await fetcher(config.pairingOrigin+'/api/v1/extension/version',{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});
   const text=await r.text();if(r.status===200&&text.length<=4096){const data=JSON.parse(text)?.data;if(data&&compareVersions(data.version,installed)===1)value={version:data.version,channel:typeof data.channel==='string'?data.channel.slice(0,40):null};}
  }catch{value=null;}
  cached={at:now(),value};return value;
 }
 return {check,forget(){cached=null;}};
}
