const vm=require('node:vm'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),fs=require('node:fs');
async function run({hidden=false,settings={sound:true,repeat:true,awake:true}}={}){
 const windows=[],notifications=[],ipc=new EventEmitter(),timers=new Map(),messages=[];let shortcut,storedStartup,serialized,now=100000,nextTimer=1;
 class Contents extends EventEmitter {constructor(){super();this.session={cookies:{},setPermissionRequestHandler(){},setPermissionCheckHandler(){}};this.rings=0;}setWindowOpenHandler(){}stop(){}getURL(){return 'https://business.facebook.com/latest/inbox/all';}async executeJavaScript(script,gesture){assert.equal(script,'ring()');assert.equal(gesture,true);this.rings++;}}
 class Window extends EventEmitter {constructor(options){super();this.options=options;this.webContents=new Contents();this.loads=[];windows.push(this);}async loadFile(){}async loadURL(url){this.url=url;this.loads.push(url);}hide(){this.hidden=true;}show(){this.hidden=false;}restore(){}focus(){}reload(){}flashFrame(v){this.flashing=v;}isDestroyed(){return false;}}
 let tray;
 class Tray extends EventEmitter {constructor(image){super();tray=this;this.image=image;}setImage(image){this.image=image;}setToolTip(s){this.tip=s;}setContextMenu(menu){this.menu=menu;}displayBalloon(){this.balloon=true;}}
 class Notice extends EventEmitter {constructor(options){super();this.options=options;notifications.push(this);}static isSupported(){return true;}show(){this.shown=true;}close(){this.emit('close');}}
 const app=new EventEmitter();Object.assign(app,{setAppUserModelId(){},commandLine:{appendSwitch(){}},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),getPath:()=>'/tmp/business-mock',getVersion:()=> '1.4.0',getLoginItemSettings:options=>({openAtLogin:!!(storedStartup?.openAtLogin&&JSON.stringify(options.args)===JSON.stringify(storedStartup.args)),executableWillLaunchAtLogin:storedStartup?.openAtLogin??false}),setLoginItemSettings:options=>{storedStartup=options;},toastActivatorCLSID:'example-clsid',isPackaged:true});
 const electron={app,BrowserWindow:Window,Tray,Menu:{buildFromTemplate:t=>t,setApplicationMenu(){}},Notification:Notice,ipcMain:ipc,shell:{writeShortcutLink:(p,op,options)=>{shortcut=options;return true;}},nativeImage:{createFromPath:file=>({file})},powerMonitor:new EventEmitter(),dialog:{showMessageBox:async(w,m)=>messages.push(m)}};
 const mockedFS={readFileSync:()=>JSON.stringify(settings),mkdirSync(){},writeFileSync:(p,s)=>{serialized=s;},renameSync(){}};
 class Clock extends Date {static now(){return now;}}
 const ctx={require:n=>n==='electron'?electron:n==='fs'?mockedFS:n.startsWith('./')?require(path.join(__dirname,'..',n)):require(n),__dirname:path.resolve(__dirname,'..'),process:{platform:'win32',execPath:'C:\\Apps\\ThuyetBusiness.exe',argv:hidden?['--hidden']:[]},setTimeout(cb,delay){const id=nextTimer++;timers.set(id,{cb,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval(){throw Error('Repeating reminders must not exist in main process');},URL,Date:Clock,Promise,Set,Number};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),ctx);
 await new Promise(setImmediate);
 const [audio,win]=windows;
 assert.equal(shortcut.appUserModelId,'Thuyet.BusinessDesk');assert.equal(shortcut.toastActivatorClsid,'example-clsid');
 assert.equal(audio.options.webPreferences.autoplayPolicy,'no-user-gesture-required');
 assert.equal(win.options.show,!hidden,'start hidden without flashing main window');
 assert(!tray.menu.some(i=>/20|Nhắc chuông|Giữ máy thức/.test(i.label||'')));
 assert(tray.image.file.endsWith('icon.png'),'normal tray at startup');
 const startup=()=>tray.menu.find(i=>i.label==='Mở cùng Windows');
 assert.equal(startup().checked,false);await startup().click({checked:true});assert.equal(startup().checked,true);await startup().click({checked:false});assert.equal(startup().checked,false);
 await tray.menu.find(i=>i.label==='Chuông tin nhắn').click({checked:false});assert.equal(JSON.parse(serialized).sound,false);assert(!('repeat' in JSON.parse(serialized)),'discard legacy repeating setting');assert(!('awake' in JSON.parse(serialized)),'discard legacy keep-awake setting');
 await tray.menu.find(i=>i.label==='Chuông tin nhắn').click({checked:true});
 const event={sender:win.webContents,senderFrame:{url:'https://business.facebook.com/latest/inbox/all'}};
 ipc.emit('business-detector-status',event,{found:true,unread:1,source:'all-messages'});assert.match(tray.tip,/1 tin chưa đọc/);
 ipc.emit('business-alert',event,'unread');await new Promise(setImmediate);assert.equal(notifications.length,1);assert.equal(audio.webContents.rings,1);assert.equal(timers.size,0,'no timer to repeat an alert');assert(tray.image.file.endsWith('icon-unread.png'),'red dot after incoming alert');
 tray.menu.find(i=>i.label==='Xóa cảnh báo').click();assert(tray.image.file.endsWith('icon.png'),'clear alert removes red dot');
 now+=21000;await new Promise(setImmediate);assert.equal(audio.webContents.rings,1,'no reminder after 20 seconds');
 ipc.emit('business-alert',event,'unread');await new Promise(setImmediate);assert.equal(notifications.length,2);assert.equal(audio.webContents.rings,2,'new event still rings once');assert(tray.image.file.endsWith('icon-unread.png'),'new message restores red dot');
 tray.emit('click');assert(tray.image.file.endsWith('icon.png'),'opening app acknowledges red dot');
 notifications.at(-1).emit('failed');assert(tray.balloon);
 let prevented=false;win.emit('close',{preventDefault(){prevented=true;}});assert(prevented);assert(win.hidden);
 const before=notifications.length;ipc.emit('business-alert',{sender:audio.webContents,senderFrame:{url:'https://business.facebook.com/'}},'unread');assert.equal(notifications.length,before);
 win.webContents.emit('did-navigate-in-page',{},'https://business.facebook.com/latest/inbox/all?asset_id=123&selected_item_id=456');
 win.webContents.emit('render-process-gone');win.webContents.emit('did-fail-load',{},-105,'offline','https://business.facebook.com/',true);assert.equal(timers.size,1,'only one recovery timer');win.webContents.emit('did-finish-load');assert.equal(timers.size,1,'error page does not cancel reconnect');
 const scheduled=timers.values().next().value;timers.clear();scheduled.cb();await new Promise(setImmediate);assert.equal(win.url,'https://business.facebook.com/latest/inbox/all?asset_id=123');
 app.emit('before-quit');assert.equal(timers.size,0);
}
(async()=>{await run();await run({hidden:true});console.log('PASS: startup checkbox enable/disable, hidden launch, red tray dot / acknowledgement, no keep-awake or repeating reminders, old settings migration, atomic settings save, DOM IPC → toast + sound, tray, recovery timer deduplication and selected Page preservation');})();
