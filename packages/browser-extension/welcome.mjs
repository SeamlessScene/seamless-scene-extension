import {viewerRequest} from './src/viewer-client.mjs';
import {siteAccessOrigins,viewerFailureMessage} from './src/viewer-model.mjs';
import {findEditUrl} from './src/viewer-display.mjs';
import {noteLinkIntent,pageStorage} from './src/link-intent.mjs';

// First-run checklist: link the account, allow Prime Video, then find an edit on the
// website. Each step ticks itself when done (the page rechecks every two seconds);
// the third ticks once the first website edit has downloaded.
const $=q=>document.querySelector(q),prime=siteAccessOrigins('https://www.amazon.com');
const done=(id,yes,detail)=>{const step=$(id);step.classList.toggle('done',yes);step.querySelector('.welcome-mark').textContent=yes?'✓':step.querySelector('.welcome-mark').dataset.n??step.querySelector('.welcome-mark').textContent;if(detail)step.querySelector('p').textContent=detail;};
for(const mark of document.querySelectorAll('.welcome-mark'))mark.dataset.n=mark.textContent;
async function refresh(){
 try{
  const snapshot=await viewerRequest('snapshot',{});
  const linked=snapshot.account?.state==='saved';
  done('#step-link',linked,linked?`Connected as ${snapshot.account.displayName}.`:null);$('#link').hidden=linked;
  if(snapshot.websiteOrigin)$('#browse').href=findEditUrl(snapshot.websiteOrigin);
  const downloaded=(snapshot.library??[]).some(item=>item.origin==='website'&&item.downloadedAt);
  done('#step-browse',downloaded,downloaded?'Your first edit is downloaded. Open its episode on Prime Video and press play.':null);
 }catch(error){$('#notice').textContent=viewerFailureMessage(error);}
 let allowed=false;try{allowed=await chrome.permissions.contains({origins:prime});}catch{}
 done('#step-site',allowed,allowed?'Prime Video is allowed.':null);$('#allow').hidden=allowed;
}
$('#link').onclick=()=>{noteLinkIntent(pageStorage());void chrome.tabs.create({url:chrome.runtime.getURL('catalog-account.html')});};
$('#allow').onclick=()=>void chrome.permissions.request({origins:prime}).then(ok=>{$('#notice').textContent=ok?'Prime Video allowed.':viewerFailureMessage(Error('viewer-site-not-allowed'));return refresh();});
$('#browse').onclick=event=>{if($('#browse').getAttribute('href')==='#'){event.preventDefault();$('#notice').textContent='Connect your account first; the website address comes from it.';}};
void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},2000);addEventListener('pagehide',()=>clearInterval(timer),{once:true});
