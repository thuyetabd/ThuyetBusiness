const assert=require('node:assert/strict');
const {createStartupController}=require('../startup');
const executable='C:\\Users\\Test User\\Apps\\ThuyetBusiness.exe';
let stored=null,lastRead,lastWrite;
const app={
 getLoginItemSettings(options){
  lastRead=options;
  // Reproduce the original bug: missing --hidden means openAtLogin is false.
  const matches=stored&&options.path===stored.path&&JSON.stringify(options.args)===JSON.stringify(stored.args);
  return {openAtLogin:!!(matches&&stored.openAtLogin),executableWillLaunchAtLogin:!!(matches&&stored.openAtLogin&&stored.enabled)};
 },
 setLoginItemSettings(options){stored={...options};lastWrite=options;}
};
const startup=createStartupController(app,executable);
assert.equal(startup.read(),false);assert.equal(startup.set(true),true);
assert.equal(lastRead.path,lastWrite.path);assert.deepEqual(lastRead.args,lastWrite.args);
assert.equal(lastWrite.name,'Thuyet.BusinessDesk');assert.equal(lastWrite.enabled,true);
assert.equal(createStartupController(app,executable).read(),true,'read survives controller recreation');
stored.enabled=false;assert.equal(startup.read(),false,'respect Windows Startup Apps disabled state');
assert.equal(startup.set(true),true,'re-enabling requests enabled state');
assert.equal(startup.set(false),false);assert.equal(stored.openAtLogin,false);
const denied=createStartupController({setLoginItemSettings(){},getLoginItemSettings:()=>({openAtLogin:false})},executable);
assert.throws(()=>denied.set(true),/Windows/);
console.log('PASS: identical read/write args and path, persistent enabled check, disable/re-enable, paths with spaces, failure detection');
