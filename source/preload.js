const {ipcRenderer,webFrame}=require('electron');
// The isolated preload reads the DOM. Only counts/status and a fixed alert signal
// cross IPC; conversation text, cookies and account IDs stay in this renderer.
if(location.hostname==='business.facebook.com'){
  const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const allLabels=new Set(['tat ca tin nhan','all messages']);
  const channelLabels=new Set(['messenger','instagram','whatsapp']);
  let cachedTabs=[],lastDiscovery=0,counterObserver;
  function discoverTabs(){
    const tabs=[...document.querySelectorAll('a[aria-label], [role="tab"][aria-label]')].filter(el=>{
      const label=normalize(el.getAttribute('aria-label'));
      if(!allLabels.has(label)&&!channelLabels.has(label))return false;
      if(el.tagName==='A'){try{return new URL(el.getAttribute('href'),location.href).pathname.includes('/inbox/');}catch{return false;}}
      return true;
    });
    cachedTabs=tabs;lastDiscovery=Date.now();
    if(counterObserver){
      counterObserver.disconnect();
      for(const tab of tabs)counterObserver.observe(tab,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-live','role']});
    }
    return tabs;
  }
  function tabCount(tab){
    const live=[...tab.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]')];
    for(const el of live){const match=normalize(el.textContent).match(/^(\d+)\+?\s*(?:new|moi|tin nhan|unread|chua doc)\b/);if(match)return Number(match[1]);}
    // Meta's visible numeric badge. Ignore duplicate text labels and CSS names.
    let count=0;
    for(const el of tab.querySelectorAll('span,div')){
      if(el.children.length)continue;
      const match=(el.textContent||'').trim().match(/^(\d+)\+?$/);
      if(match)count=Math.max(count,Number(match[1]));
    }
    return count;
  }
  function readCounter(){
    // Reuse the tiny tab subtree. Avoid a full-page selector on every message
    // mutation or one-second poll; rediscover only after replacement/navigation.
    const valid=cachedTabs.length&&cachedTabs.every(tab=>tab.isConnected);
    const tabs=valid&&Date.now()-lastDiscovery<15000?cachedTabs:discoverTabs();
    const all=tabs.filter(el=>allLabels.has(normalize(el.getAttribute('aria-label'))));
    if(all.length)return {found:true,count:Math.max(...all.map(tabCount)),source:'all-messages'};
    const channels=tabs.filter(el=>channelLabels.has(normalize(el.getAttribute('aria-label'))));
    if(channels.length){
      const byChannel=new Map();
      for(const tab of channels){const key=normalize(tab.getAttribute('aria-label'));byChannel.set(key,Math.max(byChannel.get(key)||0,tabCount(tab)));}
      return {found:true,count:[...byChannel.values()].reduce((a,b)=>a+b,0),source:'channel-tabs'};
    }
    const title=document.title.match(/^\s*\((\d+)\)/);
    return {found:false,count:title?Number(title[1]):null,source:title?'title':'waiting'};
  }
  let asset=null,previous=null,candidate=null,candidateSince=0,lastStatus=0,lastStatusKey='',queued=false;
  function scan(){
    const now=Date.now();
    const scope=new URL(location.href).searchParams.get('asset_id')||'default';
    // Changing the selected conversation must NOT reset the baseline.
    if(scope!==asset){asset=scope;previous=null;candidate=null;cachedTabs=[];}
    const current=readCounter();
    const key=`${current.found}:${current.count}:${current.source}`;
    if(key!==lastStatusKey||now-lastStatus>10000){
      ipcRenderer.send('business-detector-status',{found:current.found,unread:current.count,source:current.source});
      lastStatus=now;lastStatusKey=key;
    }
    if(current.count===null)return; // React may temporarily detach the whole tab.
    if(candidate!==current.count){candidate=current.count;candidateSince=now;return;}
    if(now-candidateSince<700)return;
    // Also warn once about already-unread messages on first opening the inbox.
    if((previous===null&&candidate>0)||(previous!==null&&candidate>previous))ipcRenderer.send('business-alert','unread');
    previous=candidate;
  }
  function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;scan();},200);}
  function start(){
    counterObserver=new MutationObserver(schedule);
    new MutationObserver(()=>{
      // Other page activity cannot trigger repeated full detector scans.
      if(cachedTabs.length?cachedTabs.some(tab=>!tab.isConnected):Date.now()-lastDiscovery>=1000)schedule();
    }).observe(document.documentElement,{subtree:true,childList:true});
    scan();setInterval(scan,1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  // Native Meta notifications are supplementary; this hook cannot block the DOM detector.
  window.addEventListener('__business_native_notification',()=>ipcRenderer.send('business-alert','native'));
  try{webFrame.executeJavaScript(`(()=>{const N=window.Notification;if(!N)return;window.Notification=new Proxy(N,{construct(target,args){const n=Reflect.construct(target,[args[0],{...(args[1]||{}),silent:true}]);window.dispatchEvent(new Event('__business_native_notification'));return n;}});})()`).catch(()=>{});}catch{}
}
