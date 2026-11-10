const {app,BrowserWindow,Tray,Menu,Notification,ipcMain,shell,nativeImage,powerMonitor,dialog}=require('electron');
const path=require('path'),fs=require('fs');
const {parseCookies,replaceFacebookCookies,CookieImportError}=require('./cookie-import');
const {createStartupController}=require('./startup');
app.setAppUserModelId('Thuyet.BusinessDesk');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
let win,tray,audio,quit=false,pending=false,last=0,normalTrayIcon,unreadTrayIcon,recoveryTimer=null,recoveryAttempts=0,settings={sound:true};
let detector={found:false,unread:null,source:'waiting',at:0},lastAlert=0,lastSoundError='',lastToastError='',shortcutOK=false;
const liveNotifications=new Set();
const trusted=u=>{try{const a=new URL(u);return a.protocol==='https:'&&(a.hostname==='facebook.com'||a.hostname.endsWith('.facebook.com'));}catch{return false;}};
if(!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance',()=>show());
app.whenReady().then(()=>{
 const file=path.join(app.getPath('userData'),'settings.json');
 try{
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(typeof saved.sound==='boolean')settings.sound=saved.sound;
 }catch{}
 const save=()=>{
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(settings));
  fs.renameSync(temp,file);
 };
 const startup=createStartupController(app,process.execPath);
 const startupEnabled=()=>{try{return process.platform==='win32'&&startup.read();}catch{return false;}};
 async function toggleStartup(item){
  try{startup.set(item.checked);}
  catch{await dialog.showMessageBox(win,{type:'error',title:'Chưa đổi được thiết lập',message:'Windows chưa lưu được lựa chọn mở cùng Windows.',detail:'Kiểm tra mục Startup apps trong Windows Settings, rồi thử lại.'});}
  finally{menu();}
 }
 async function toggleSetting(key,checked){
  const previous=settings[key];
  settings[key]=checked;
  try{save();}
  catch{settings[key]=previous;await dialog.showMessageBox(win,{type:'error',title:'Chưa lưu được cài đặt',message:'Không thể lưu cài đặt ứng dụng. Hãy kiểm tra quyền ghi của thư mục hồ sơ.'});}
  menu();
 }
 let lastInboxURL='https://business.facebook.com/latest/inbox/all',navigationFailed=false;
 function loadInbox(){
  navigationFailed=false;
  return win.loadURL(lastInboxURL).catch(()=>{navigationFailed=true;recover();});
 }
 function stopRecovery(){clearTimeout(recoveryTimer);recoveryTimer=null;}
 function recover(delay){
  if(quit||recoveryTimer)return;
  recoveryTimer=setTimeout(()=>{
   recoveryTimer=null;
   if(quit||win.isDestroyed())return;
   if(importing)return recover(5000);
   recoveryAttempts++;
   loadInbox();
  },delay??Math.min(60000,5000*2**Math.min(recoveryAttempts,4)));
 }

 const icon=nativeImage.createFromPath(path.join(__dirname,'icon.png'));
 normalTrayIcon=icon;
 unreadTrayIcon=nativeImage.createFromPath(path.join(__dirname,'icon-unread.png'));
 // Portable builds still need a matching Start Menu shortcut for Windows toasts.
 if(process.platform==='win32')try{
  const folder=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs');
  fs.mkdirSync(folder,{recursive:true});
  const details={target:process.execPath,cwd:path.dirname(process.execPath),description:'Thuyết Business',appUserModelId:'Thuyet.BusinessDesk'};
  if(app.toastActivatorCLSID)details.toastActivatorClsid=app.toastActivatorCLSID;
  shortcutOK=shell.writeShortcutLink(path.join(folder,'Thuyet Business.lnk'),'create',details);
 }catch{}
 audio=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
 audioReady=audio.loadFile('sound.html');
 win=new BrowserWindow({show:!process.argv.includes('--hidden'),width:1280,height:850,minWidth:800,minHeight:600,title:'Thuyết Business',icon,webPreferences:{preload:path.join(__dirname,'preload.js'),partition:'persist:business',nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const ses=win.webContents.session;
 async function showStatus(){
  const fresh=Date.now()-detector.at<20000;
  await dialog.showMessageBox(win,{type:'info',title:'Trạng thái nhận tin',message:detector.found&&fresh?'Đã nhận diện bộ đếm tin nhắn':'Đang chờ bộ đếm trong Hộp thư',detail:[
   `Tin chưa đọc: ${detector.unread===null?'chưa đọc được':detector.unread}`,
   `Phiên bản: ${app.getVersion()}`,
   `Chuông: ${settings.sound?'bật':'tắt'}`,
   `Mở cùng Windows: ${startupEnabled()?'bật (chạy ẩn ở khay hệ thống)':'tắt'}`,
   `Thông báo Windows: ${Notification.isSupported()?'hệ thống hỗ trợ':'không hỗ trợ'}`,
   `Đăng ký ứng dụng: ${shortcutOK?'đã tạo shortcut Start Menu':'chưa tạo được shortcut'}`,
   `Cảnh báo gần nhất: ${lastAlert?new Date(lastAlert).toLocaleString('vi-VN'):'chưa có'}`,
   lastSoundError?'Phát chuông thất bại: kiểm tra âm lượng ứng dụng trong Windows.':'',
   lastToastError?'Windows từ chối thông báo: kiểm tra Settings > System > Notifications.':'',
   'Nếu đang chờ, hãy mở Hộp thư của Trang và giữ tab Tất cả tin nhắn.'
  ].filter(Boolean).join('\n')});
 }
 function toast(){
  if(!Notification.isSupported())return balloon();
  try{
   const n=new Notification({title:'Thuyết Business',body:'Có tin nhắn chưa đọc mới. Bấm để mở hộp thư.',silent:true,icon});
   // Keep only the current toast reference instead of accumulating notifications.
   for(const old of liveNotifications){try{old.close();}catch{}}
   liveNotifications.clear();
   liveNotifications.add(n);
   n.on('click',show);
   n.on('show',()=>{lastToastError='';});
   n.on('close',()=>liveNotifications.delete(n));
   n.on('failed',()=>{lastToastError='failed';liveNotifications.delete(n);balloon();});
   n.show();
  }catch{lastToastError='failed';balloon();}
 }
 function balloon(){if(process.platform==='win32')try{tray.displayBalloon({title:'Thuyết Business',content:'Có tin nhắn chưa đọc mới. Bấm biểu tượng để mở hộp thư.',noSound:true});}catch{}}
 let importing=false;
 async function importCookies(){
  if(importing)return;
  importing=true;
  try{
   show();
   const selected=await dialog.showOpenDialog(win,{title:'Đăng nhập bằng cookie JSON Facebook',properties:['openFile'],filters:[{name:'Cookie JSON',extensions:['json']}]});
   if(selected.canceled||!selected.filePaths.length)return;
   const selectedPath=selected.filePaths[0];
   if((await fs.promises.stat(selectedPath)).size>2*1024*1024)throw new Error('File quá lớn. Chọn file cookie JSON dưới 2 MB.');
   const {cookies,skipped}=parseCookies(await fs.promises.readFile(selectedPath,'utf8'));
   win.webContents.stop();
   await win.loadURL('about:blank');
   try{await replaceFacebookCookies(ses.cookies,cookies);}
   finally{win.loadURL('https://business.facebook.com/latest/inbox/all').catch(()=>{});}
   await dialog.showMessageBox(win,{type:'info',title:'Đã nhập cookie',message:`Đã nhập ${cookies.length} cookie Facebook.`,detail:`Hộp thư đang được tải lại. Meta có thể yêu cầu xác minh thêm nếu phiên hết hiệu lực.${skipped?' Bỏ qua '+skipped+' cookie ngoài Facebook hoặc đã hết hạn.':''}`});
  }catch(error){
   await dialog.showMessageBox(win,{type:'error',title:'Không nhập được cookie',message:'Không thể nhập cookie JSON.',detail:error instanceof CookieImportError?error.message:'Không thể đọc file hoặc hoàn tất nhập. Hãy thử lại bằng file JSON đầy đủ, hoặc đăng nhập trực tiếp.'});
  }finally{importing=false;}
 }
 ses.setPermissionRequestHandler((wc,permission,cb,details)=>cb(permission==='notifications'&&trusted(details.requestingUrl||wc.getURL())));
 ses.setPermissionCheckHandler((wc,permission,origin)=>permission==='notifications'&&trusted(origin));
 win.webContents.setWindowOpenHandler(({url})=>{if(trusted(url)){win.loadURL(url);return {action:'deny'};}if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'};});
 win.webContents.on('will-navigate',(e,url)=>{if(!trusted(url)){e.preventDefault();if(/^https?:/.test(url))shell.openExternal(url);}});
 win.on('close',e=>{if(!quit){e.preventDefault();win.hide();}});
 win.on('minimize',e=>{e.preventDefault();win.hide();});
 win.on('focus',clear);
 win.webContents.on('render-process-gone',()=>recover(3000));
 win.webContents.on('did-fail-load',(e,code,desc,url,main)=>{
  if(main&&code!==-3&&!importing){navigationFailed=true;recover();}
 });
 win.webContents.on('did-start-navigation',(e,url,inPlace,main)=>{
  if(main&&!inPlace&&trusted(url))navigationFailed=false;
 });
 win.webContents.on('did-finish-load',()=>{
  // Chromium can finish rendering its error page after did-fail-load.
  // That must not cancel the reconnect timer.
  if(!navigationFailed){stopRecovery();recoveryAttempts=0;}
 });
 const rememberInbox=(event,url)=>{
  if(!trusted(url))return;
  const parsed=new URL(url);
  if(parsed.hostname==='business.facebook.com'&&parsed.pathname.includes('/inbox/')){
   const asset=parsed.searchParams.get('asset_id');
   lastInboxURL='https://business.facebook.com/latest/inbox/all'+(asset?'?asset_id='+encodeURIComponent(asset):'');
  }
 };
 win.webContents.on('did-navigate',rememberInbox);
 win.webContents.on('did-navigate-in-page',rememberInbox);
 tray=new Tray(icon);tray.setToolTip('Thuyết Business — đang chạy');tray.on('double-click',show);tray.on('click',show);
 function menu(){tray.setContextMenu(Menu.buildFromTemplate([
 {label:'Mở hộp thư',click:()=>{show();loadInbox();}},
 {label:'Đăng nhập bằng cookie JSON…',click:importCookies},
 {label:'Tải lại trang',click:()=>win.reload()},
 {label:'Trạng thái nhận tin',click:()=>{show();showStatus();}},
 {label:'Xóa cảnh báo',click:clear},{type:'separator'},
 {label:'Chuông tin nhắn',type:'checkbox',checked:settings.sound,click:i=>toggleSetting('sound',i.checked)},
 {label:'Mở cùng Windows',type:'checkbox',enabled:process.platform==='win32',checked:startupEnabled(),click:toggleStartup},
 {type:'separator'},{label:'Hướng dẫn',click:()=>shell.openPath(path.join(app.isPackaged?path.dirname(app.getPath('exe')):__dirname,'HUONG-DAN.txt'))},
 {label:'Thoát hoàn toàn',click:()=>{quit=true;app.quit();}}
 ]));}
 menu();
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Ứng dụng',submenu:[{label:'Đăng nhập bằng cookie JSON…',click:importCookies},{label:'Trạng thái nhận tin',click:showStatus},{label:'Hộp thư',click:()=>win.loadURL('https://business.facebook.com/latest/inbox/all')},{role:'reload'},{role:'togglefullscreen'},{label:'Ẩn xuống khay',click:()=>win.hide()}]},{label:'Chỉnh sửa',submenu:[{role:'undo'},{role:'redo'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}]));
 loadInbox();
 powerMonitor.on('resume',()=>{stopRecovery();recover(2000);});
 app.on('before-quit',stopRecovery);
 ipcMain.on('business-detector-status',(e,data)=>{
  if(e.sender!==win.webContents||!trusted(e.senderFrame?.url||'')||!data||typeof data.found!=='boolean')return;
  if(data.unread!==null&&(!Number.isSafeInteger(data.unread)||data.unread<0))return;
  detector={found:data.found,unread:data.unread,source:['all-messages','channel-tabs','title','waiting'].includes(data.source)?data.source:'waiting',at:Date.now()};
  if(!pending)tray.setToolTip(detector.found?`Thuyết Business — ${detector.unread} tin chưa đọc`:'Thuyết Business — đang chờ Hộp thư');
 });
 ipcMain.on('business-alert',(e,kind)=>{
 if(e.sender!==win.webContents||!trusted(e.senderFrame?.url||'')||!['native','unread'].includes(kind)||Date.now()-last<1500)return;
 last=Date.now();lastAlert=last;pending=true;tray.setImage(unreadTrayIcon);tray.setToolTip('Thuyết Business — có tin mới');win.flashFrame(true);chime();
 if(kind!=='native')toast();
 });
});
app.on('before-quit',()=>{quit=true;});
app.on('window-all-closed',()=>{});
}
function show(){if(!win)return;win.show();win.restore();win.focus();clear();}
function clear(){pending=false;if(tray&&normalTrayIcon)tray.setImage(normalTrayIcon);if(win)win.flashFrame(false);if(tray)tray.setToolTip(detector.found?`Thuyết Business — ${detector.unread} tin chưa đọc`:'Thuyết Business — đang chạy');}
let audioReady=Promise.resolve();
async function chime(){
 if(!settings.sound||!audio||audio.isDestroyed())return;
 try{await audioReady;await audio.webContents.executeJavaScript('ring()',true);lastSoundError='';}
 catch{lastSoundError='failed';}
}
