import {packager} from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'thuyet-business-release-'));
const runtime=['main.js','preload.js','cookie-import.js','startup.js','sound.html','notification.wav','icon.png','icon-unread.png'];
try{
 for(const name of runtime)await fs.copyFile(path.join(root,name),path.join(stage,name));
 const production=Object.fromEntries(['name','version','productName','description','main','author','license','type'].map(key=>[key,pkg[key]]));
 await fs.writeFile(path.join(stage,'package.json'),JSON.stringify(production,null,2));
 const outputs=await packager({
  dir:stage,name:'ThuyetBusiness',platform:'win32',arch:'x64',
  out:path.join(root,'dist'),overwrite:true,asar:true,prune:false,
  icon:path.join(root,'icon.ico'),appVersion:pkg.version,buildVersion:pkg.version,
  ...(process.env.ELECTRON_ZIP_DIR?{electronZipDir:process.env.ELECTRON_ZIP_DIR}:{}),
  electronVersion:pkg.devDependencies.electron,
  win32metadata:{CompanyName:'Thuyet',FileDescription:'Thuyet Business',ProductName:'Thuyet Business',OriginalFilename:'ThuyetBusiness.exe'},
 });
 for(const output of outputs){
  for(const name of ['HUONG-DAN.txt','RELEASE-NOTES.txt'])await fs.copyFile(path.join(root,name),path.join(output,name));
 }
 console.log(`Built Thuyet Business ${pkg.version}: ${outputs.join(', ')}`);
}finally{await fs.rm(stage,{recursive:true,force:true});}
