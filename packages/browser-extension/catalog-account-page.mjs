import {EXECUTING_BUILD} from './src/build-info.mjs';
import {sameExecutingBuild} from './src/build-identity.mjs';

// Account and device-link page logic. The page entry passes the real globals;
// tests pass doubles (timers, clock, runtime) and import this module directly.
export function startAccountPage({ document, chrome, catalogTrustConfig, linkIntent = false, Date = globalThis.Date,
  setTimeout = globalThis.setTimeout.bind(globalThis), clearTimeout = globalThis.clearTimeout.bind(globalThis) }) {
const status=document.querySelector('#status'),approval=document.querySelector('#approval'),code=document.querySelector('#code'),link=document.querySelector('#approve');
const buttons=[...document.querySelectorAll('button')];
// After the person approves on the website the link completes here by itself: while a code is pending this page asks the
// service every few seconds (the same exchange the "Check now" button performs) until the link is paired, refused or expired.
// It keeps asking while this tab is in the background (E55): the website opens in a new tab, so the approval
// normally happens while this one is hidden, and waiting for the person to come back could outlive the code.
// Chrome only rounds a hidden tab's timers to whole seconds until it has been hidden for 5 minutes (a 5-minute code's
// whole life; a longer code, E95, is checked less often after that), and coming back to the tab still checks at once.
// E95 (0.66.1): the code's lifetime is the website's (5 minutes today, up to 30): the page says how long it has left.
let poll=null,pollUntil=0,inFlight=false,sawPending=false;
// One press links: "Link your account" asks for a code and opens the website's approval page with the code in the
// address, so nobody has to find a second link or type anything. Only the configured website origin is ever opened.
const openWebsite=url=>{try{if(typeof url!=='string'||new URL(url).origin!==new URL(catalogTrustConfig.pairingOrigin).origin||typeof chrome.tabs?.create!=='function')return false;
  Promise.resolve(chrome.tabs.create({url})).catch(()=>{});return true;}catch{return false;}};
const codeExpiry=expiresAt=>{const left=Math.round(((Date.parse(expiresAt)||0)-Date.now())/60000),node=document.querySelector('#code-expiry');
  if(node)node.textContent=left>=1?`The code expires in ${left} minute${left===1?'':'s'}.`:'The code expires in less than a minute.';};
const stopPolling=()=>{if(poll){clearTimeout(poll);poll=null;}};
const schedulePoll=expiresAt=>{stopPolling();pollUntil=Date.parse(expiresAt)||0;if(pollUntil>Date.now())poll=setTimeout(()=>{poll=null;void action('finish',{quiet:true});},4000);};
async function action(method,{quiet=false,open=false}={}){
  if(inFlight)return null;inFlight=true;
  if(!quiet)stopPolling();
  buttons.forEach(button=>button.disabled=true);
  try{
    const result=await chrome.runtime.sendMessage({kind:'device-link-v1',method,build:EXECUTING_BUILD});
    if(result?.ok===false&&sameExecutingBuild(result.build)&&result.code==='catalog-protected-signout-incomplete')throw Error('protected-cleanup');
    if(!result?.ok||!sameExecutingBuild(result.build))throw Error();
    const value=result.value,hasCode=value.state==='pending'&&typeof value.code==='string'&&value.code.length>0;
    // At the device limit the request stays pending: keep finishing it quietly
    // so linking completes once a device is removed on the website.
    const atLimit=value.state==='limit';
    if(value.state!=='pending'&&!atLimit){stopPolling();pollUntil=0;}
    approval.hidden=!hasCode;document.querySelector('#finish').hidden=!hasCode&&!atLimit;
    document.querySelector('#retry-guidance').hidden=value.state!=='pending'||hasCode;
    document.querySelector('#start').textContent=value.state==='pending'&&!hasCode?'Try again':'Connect your account';
    if(value.state==='pending'){code.textContent=hasCode?value.code.match(/.{1,4}/g).join('-'):'';if(hasCode)link.href=value.approvalUrl;else link.removeAttribute('href');if(hasCode)codeExpiry(value.expiresAt);const opened=hasCode&&open&&openWebsite(value.approvalUrl);if(hasCode)sawPending=true;
     status.textContent=hasCode?`${opened?'The website opened in a new tab. Press Connect extension there':'Waiting for you to confirm on the website'}. This page finishes by itself once you do; keep it open.`:'Your request is saved, but no code has arrived yet.';if(hasCode)schedulePoll(value.expiresAt);else stopPolling();}
    else if(atLimit){
     status.textContent='This account already has 5 connected devices, the most allowed. Remove one you no longer use on the website, and this page finishes connecting by itself. ';
     const manage=document.createElement('a');manage.textContent='Manage connected devices';manage.target='_blank';manage.rel='noopener';
     try{manage.href=new URL('/account/device-links',catalogTrustConfig.pairingOrigin).href;}catch{}
     status.append(manage);
     schedulePoll(new Date(pollUntil>Date.now()?pollUntil:Date.now()+5*60_000).toISOString());
    }
    else if(value.state==='paired'){status.textContent=`Connected as ${value.displayName} until ${new Date(value.expiresAt).toLocaleString()}.${sawPending?' You can close this tab.':''}`;sawPending=false;}
    else status.textContent=({unconfigured:'Connecting an account is not set up for this build.',unavailable:'This connection is no longer valid. Connect your account again.',disconnected:'Disconnected. Downloaded website edits were removed from this device; your history remains.',unpaired:'This extension is not connected to an account.','retry-start':'Press Connect your account again to recover the pending request.'})[value.state]??'The connection could not be confirmed.';
    // While a code is waiting the one thing to do is on the website, so the start button steps aside for it.
    document.querySelector('#start').hidden=value.state==='paired'||hasCode;
    document.querySelector('#renew').hidden=value.state!=='paired';
    document.querySelector('#cancel').hidden=value.state!=='pending';
    // Unlink and Check status only make sense for a link that exists.
    const hasLink=['paired','expired','revocation-pending'].includes(value.state);
    document.querySelector('#disconnect').hidden=!hasLink;
    document.querySelector('#refresh').hidden=!['paired','expired'].includes(value.state);
    if(value.state==='revocation-pending')status.textContent='Disconnected on this device. The website has not confirmed yet; press Disconnect again when you are online.';
    if(value.state==='expired')status.textContent='Your account connection expired. Connect again to open or renew edits.';
    return value;
  }catch(error){if(quiet){if(pollUntil>Date.now())schedulePoll(new Date(pollUntil).toISOString());return null;}status.textContent=error.message==='protected-cleanup'?'Disconnecting is incomplete: playback restoration or cleanup failed. Try again before opening another edit.':'The connection could not be confirmed right now. Retry the same action; your saved request has not been removed.';return null;}
  finally{inFlight=false;buttons.forEach(button=>button.disabled=false);}
}
for(const button of buttons)button.addEventListener('click',()=>void action(button.id==='refresh'?'status':button.id,{open:button.id==='start'||button.id==='renew'}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&pollUntil>Date.now()&&!inFlight){stopPolling();void action('finish',{quiet:true});}});
// Arriving from a "Link your account" button (linkIntent) continues without a second press: an unlinked browser asks
// for a code and opens the website; a code that is already waiting just reopens the website. Opening this page any
// other way (a reload, a restored tab, Manage account link) only shows the status.
void action('status').then(value=>{
  if(!linkIntent||!value)return;
  if(value.state==='unpaired')return action('start',{open:true});
  if(value.state==='pending'&&typeof value.code==='string'&&value.code&&openWebsite(value.approvalUrl))status.textContent='The website opened in a new tab. Press Connect extension there. This page finishes by itself once you do; keep it open.';
});

document.querySelector('#lifetime').textContent=catalogTrustConfig.deviceLinkLifetimeSeconds?`This connection is remembered in this Chrome profile for up to ${Math.round(catalogTrustConfig.deviceLinkLifetimeSeconds/86400)} day${catalogTrustConfig.deviceLinkLifetimeSeconds>=172800?'s':''}. Renewing early needs another confirmation on the website; signing out there or removing the connection ends it sooner. Downloaded edits stay playable for seven days after you open them.`:'Connecting an account is not set up for this build.';
}
