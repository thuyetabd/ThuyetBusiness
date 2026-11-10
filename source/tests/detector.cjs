const {parseHTML}=require('linkedom');
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const preload=fs.readFileSync(require('node:path').join(__dirname,'../preload.js'),'utf8');
// Same semantic structure as the supplied Meta tab: duplicate label spans,
// nested numeric badge, and an invisible live status containing "1 new ".
function markup(n=1,live=true){return `<a aria-label="Tất cả tin nhắn" class="random-new-class" href="/latest/inbox/all?asset_id=1119823107878582&selected_item_id=100069171323314&thread_type=FB_MESSAGE" role="link"><div><div aria-hidden="true"><span>Tất cả tin nhắn</span><span>Tất cả tin nhắn</span><span>Tất cả tin nhắn</span></div>${n?`<span class="arbitrary"><span><div class="other">${n}</div></span>${live?`<div aria-atomic="true" aria-live="polite" role="status">${n} new </div>`:''}</span>`:''}</div></a>`;}
function harness(html){
 const {window,document}=parseHTML('<html><head><title>Meta Business Suite</title></head><body>'+html+'</body></html>');
 let now=100000,scan,observer,queries=0;
 const query=document.querySelectorAll.bind(document);document.querySelectorAll=(...args)=>{queries++;return query(...args);};const ipc=[],timers=[];
 const location={hostname:'business.facebook.com',href:'https://business.facebook.com/latest/inbox/all?asset_id=1119823107878582'};
 const ctx={window,document,location,URL,Date:{now:()=>now},MutationObserver:class {constructor(cb){observer=cb;}observe(){}disconnect(){}},setTimeout:cb=>timers.push(cb),setInterval:cb=>{scan=cb;},require:()=>({ipcRenderer:{send:(...x)=>ipc.push(x)},webFrame:{executeJavaScript:()=>Promise.resolve()}})};
 vm.runInNewContext(preload,ctx);
 return {document,location,ipc,queryCount:()=>queries,step(ms=1000){now+=ms;scan();},change(html){document.body.innerHTML=html;observer();timers.splice(0).forEach(cb=>cb());},alerts(){return ipc.filter(x=>x[0]==='business-alert');},status(){return ipc.filter(x=>x[0]==='business-detector-status').at(-1)[1];}};
}
let h=harness(markup(1));assert.equal(h.status().unread,1);assert.equal(h.status().found,true);h.step();assert.equal(h.alerts().length,1,'existing unread fires once');h.step();assert.equal(h.alerts().length,1);
h.change(markup(2));h.step();assert.equal(h.alerts().length,2,'1 to 2 fires');h.step();assert.equal(h.alerts().length,2);
h.change(markup(1));h.step();assert.equal(h.alerts().length,2,'decreases do not alert');h.change(markup(2));h.step();assert.equal(h.alerts().length,3);
h.location.href+='&selected_item_id=another';h.step();assert.equal(h.alerts().length,3,'opening a conversation does not reset baseline');
h.change('');h.step();h.change(markup(2));h.step();assert.equal(h.alerts().length,3,'temporary tab removal does not re-alert');
h.change(markup(0));h.step();h.change(markup(1,false));h.step();assert.equal(h.alerts().length,4,'nested numeric badge fallback');
h=harness(markup(0));h.step();assert.equal(h.alerts().length,0);h.change(markup(1));h.step();assert.equal(h.alerts().length,1,'0 to 1 fires');
h=harness('<a aria-label="All messages" href="/latest/inbox/all"><span><div>3</div></span><div role="status">3 new </div></a><a aria-label="Messenger" href="/latest/inbox/messenger"><div>3</div></a>');h.step();assert.equal(h.status().unread,3,'do not sum All and Messenger');
h=harness('<a aria-label="Messenger" href="/latest/inbox/messenger"><div>2</div></a><a aria-label="Messenger" href="/latest/inbox/messenger"><div>2</div></a><a aria-label="Instagram" href="/latest/inbox/instagram"><div>1</div></a>');h.step();assert.equal(h.status().unread,3,'deduplicate channel tabs');
console.log('PASS: supplied Meta structure, initial unread, 0→1, 1→2, deduplication, decreases, selected conversation, transient DOM removal, numeric badge, English, channel fallback');

h=harness(markup(0));const initialQueries=h.queryCount();h.step();h.step();h.step();assert.equal(h.queryCount(),initialQueries,"polling uses cached tab DOM, not full-page selectors");
console.log("PASS: cached detector avoids repeated full-page scans");
