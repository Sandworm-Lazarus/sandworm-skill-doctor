#!/usr/bin/env node
'use strict';
// Filesystem adapter only. Inspection and snapshot semantics stay in the shared browser engine.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const engine=require('../dist/engine.js');
const LIMITS=Object.freeze({entries:256,depth:16,...engine.LIMITS});
const MESSAGES=Object.freeze({
 USAGE:'Use check <folder> [--json], snapshot <folder> --output <new-file>, or compare <before.json> <after.json> [--json].',
 UNSAFE_PATH:'A path is noncanonical, outside the selected root, a link, or not a regular file/directory.',
 LIMIT:'The package or snapshot exceeds a documented count, depth, path or byte limit.',
 UTF8:'Every selected file must contain valid UTF-8.',
 INPUT:'The input does not match the documented engine schema.',
 OUTPUT_EXISTS:'The output must be a new file; existing files are never replaced.',
 OUTPUT_IN_ROOT:'Snapshot output must be outside the inspected package.',
 IO:'A filesystem or output operation failed.'
});
class CliError extends Error{constructor(code){super(MESSAGES[code]);this.code=code;}}
const fail=code=>{throw new CliError(code);};
const contains=(root,target)=>{const r=path.relative(root,target);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function portable(relative){return engine.validPath(relative)&&!/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/u.test(relative);}
function parseArgs(argv){
 if(!Array.isArray(argv)||argv.some(x=>typeof x!=='string'||!x||x.includes('\0')))fail('USAGE');
 if(argv.length===1&&argv[0]==='--help')return {operation:'help'};
 const operation=argv[0];
 if(operation==='check'&&[2,3].includes(argv.length)&&!argv[1].startsWith('--')&&(argv.length===2||argv[2]==='--json'))return {operation,folder:argv[1],json:argv[2]==='--json'};
 if(operation==='snapshot'&&argv.length===4&&!argv[1].startsWith('--')&&argv[2]==='--output'&&!argv[3].startsWith('--'))return {operation,folder:argv[1],output:argv[3],json:true};
 if(operation==='compare'&&[3,4].includes(argv.length)&&!argv[1].startsWith('--')&&!argv[2].startsWith('--')&&(argv.length===3||argv[3]==='--json'))return {operation,before:argv[1],after:argv[2],json:argv[3]==='--json'};
 fail('USAGE');
}
async function noLinks(absolute){
 const parsed=path.parse(absolute);let current=parsed.root;
 const segments=absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
 let info=await fsp.lstat(current);if(info.isSymbolicLink())fail('UNSAFE_PATH');
 for(const segment of segments){current=path.join(current,segment);info=await fsp.lstat(current);if(info.isSymbolicLink())fail('UNSAFE_PATH');}
 return info;
}
async function canonicalRoot(folder){
 const resolved=path.resolve(folder),info=await noLinks(resolved);
 if(!info.isDirectory())fail('UNSAFE_PATH');
 const real=await fsp.realpath(resolved);
 if(path.relative(real,resolved)!=='')fail('UNSAFE_PATH');
 return real;
}
async function checkedLocation(absolute,root){
 await noLinks(absolute);
 const real=await fsp.realpath(absolute);
 if(path.relative(real,absolute)!==''||(root&&!contains(root,real)))fail('UNSAFE_PATH');
 return real;
}
async function readBounded(absolute,budget,root){
 const before=await noLinks(absolute);
 if(!before.isFile()||before.nlink!==1)fail('UNSAFE_PATH');
 if(before.size>budget)fail('LIMIT');
 await checkedLocation(absolute,root);
 const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
 const handle=await fsp.open(absolute,flags);
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||opened.nlink!==1||!same(before,opened))fail('UNSAFE_PATH');
  if(opened.size>budget)fail('LIMIT');
  await checkedLocation(absolute,root);
  const current=await fsp.lstat(absolute);
  if(!same(opened,current)||!current.isFile())fail('UNSAFE_PATH');
  const buffer=Buffer.alloc(budget+1);let length=0;
  while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
  if(length>budget)fail('LIMIT');
  const after=await handle.stat();
  if(!same(opened,after)||opened.size!==after.size||opened.mtimeMs!==after.mtimeMs||opened.ctimeMs!==after.ctimeMs)fail('UNSAFE_PATH');
  await checkedLocation(absolute,root);
  const final=await fsp.lstat(absolute);if(!same(opened,final)||!final.isFile())fail('UNSAFE_PATH');
  try{return {content:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,length)),bytes:length};}catch(_){fail('UTF8');}
 }finally{await handle.close();}
}
async function readPackage(folder){
 const root=await canonicalRoot(folder),files=[];let entries=0,total=0;
 async function walk(directory,relative,depth){
  if(depth>LIMITS.depth)fail('LIMIT');
  const before=await noLinks(directory);if(!before.isDirectory())fail('UNSAFE_PATH');
  await checkedLocation(directory,root);
  const dir=await fsp.opendir(directory);
  for await(const entry of dir){
   entries++;if(entries>LIMITS.entries)fail('LIMIT');
   const rel=relative?relative+'/'+entry.name:entry.name;if(!portable(rel))fail('UNSAFE_PATH');
   const absolute=path.join(directory,entry.name),info=await fsp.lstat(absolute);
   if(info.isSymbolicLink())fail('UNSAFE_PATH');
   if(info.isDirectory()){await walk(absolute,rel,depth+1);continue;}
   if(!info.isFile()||info.nlink!==1)fail('UNSAFE_PATH');
   if(files.length>=LIMITS.files)fail('LIMIT');
   const data=await readBounded(absolute,LIMITS.fileBytes,root);
   total+=data.bytes;if(total>LIMITS.totalBytes)fail('LIMIT');
   files.push({path:rel,content:data.content});
  }
  await checkedLocation(directory,root);
  const after=await fsp.lstat(directory);if(!same(before,after)||!after.isDirectory())fail('UNSAFE_PATH');
 }
 await walk(root,'',0);
 try{engine.validateFiles(files);}catch(_){fail('INPUT');}
 return {root,files};
}
async function readSnapshot(filename){
 const absolute=path.resolve(filename),data=await readBounded(absolute,LIMITS.snapshotBytes);
 try{return engine.parseSnapshot(data.content);}catch(_){fail('INPUT');}
}
async function writeSnapshot(filename,snapshot,root){
 const target=path.resolve(filename);
 if(contains(root,target))fail('OUTPUT_IN_ROOT');
 const parent=path.dirname(target),parentInfo=await noLinks(parent);
 if(!parentInfo.isDirectory())fail('UNSAFE_PATH');
 await checkedLocation(parent);
 const text=JSON.stringify(snapshot,null,2)+'\n';
 if(Buffer.byteLength(text,'utf8')>LIMITS.snapshotBytes)fail('LIMIT');
 let handle;
 try{handle=await fsp.open(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);}
 catch(e){if(e&&e.code==='EEXIST')fail('OUTPUT_EXISTS');throw e;}
 try{
  const created=await handle.stat();
  await checkedLocation(parent);
  const current=await fsp.lstat(target);if(!current.isFile()||!same(created,current)||created.nlink!==1)fail('UNSAFE_PATH');
  await handle.writeFile(text,{encoding:'utf8'});await handle.sync();
  await checkedLocation(parent);
  const parentAfter=await fsp.lstat(parent),currentAfter=await fsp.lstat(target);
  if(!same(parentInfo,parentAfter)||!currentAfter.isFile()||!same(created,currentAfter))fail('UNSAFE_PATH');
 }finally{await handle.close();}
}
function checkExit(report){return report.counts.error||report.counts.warning?1:0;}
function compareExit(report){return report.added.length||report.removed.length||report.changed.length?1:0;}
function formatCheck(report){
 const lines=['Skill Doctor: '+report.fileCount+' files / '+report.skillCount+' skills; '+report.counts.error+' errors, '+report.counts.warning+' warnings, '+report.counts.info+' notes.'];
 for(const f of report.findings)lines.push(f.level.toUpperCase()+' '+f.code+' '+JSON.stringify(f.path));
 return lines.join('\n')+'\n';
}
function formatCompare(report){
 return ['Skill Doctor snapshot comparison:','added '+report.added.length+', removed '+report.removed.length+', changed '+report.changed.length+', unchanged '+report.unchanged.length,
 ...['added','removed','changed'].flatMap(k=>report[k].map(name=>k.toUpperCase()+' '+JSON.stringify(name)))].join('\n')+'\n';
}
async function run(options){
 if(options.operation==='check'){
  const {files}=await readPackage(options.folder);const report=engine.inspectPackage(files);return {report,exitCode:checkExit(report),text:formatCheck(report)};
 }
 if(options.operation==='snapshot'){
  const {root,files}=await readPackage(options.folder),snapshot=await engine.createSnapshot(files);
  await writeSnapshot(options.output,snapshot,root);
  const report={schema:'sandworm.skill-cli-result.v1',operation:'snapshot',status:'written',fileCount:snapshot.files.length};
  return {report,exitCode:0,text:'Snapshot written: '+snapshot.files.length+' files.\n'};
 }
 if(options.operation==='compare'){
  const before=await readSnapshot(options.before),after=await readSnapshot(options.after);
  // Validate imported path text for safe terminal output too.
  if([...before.files,...after.files].some(f=>!portable(f.path)))fail('UNSAFE_PATH');
  const report={schema:'sandworm.skill-diff.v1',...engine.compareSnapshots(before,after)};
  return {report,exitCode:compareExit(report),text:formatCompare(report)};
 }
 fail('USAGE');
}
async function main(argv,io={stdout:process.stdout,stderr:process.stderr}){
 let json=Array.isArray(argv)&&argv.includes('--json');
 try{
  const options=parseArgs(argv);
  if(options.operation==='help'){io.stdout.write(MESSAGES.USAGE+'\nExit codes: 0 clean/unchanged/written, 1 findings or drift, 2 invalid/unsafe input, 3 I/O failure.\n');return 0;}
  json=options.json;const result=await run(options);io.stdout.write(json?JSON.stringify(result.report,null,2)+'\n':result.text);return result.exitCode;
 }catch(error){
  const code=error instanceof CliError?error.code:(error&&error.code==='INVALID_INPUT'?'INPUT':'IO'),message=MESSAGES[code];
  const report={schema:'sandworm.skill-cli-error.v1',code,message};
  try{io.stderr.write(json?JSON.stringify(report)+'\n':'skill-doctor: '+code+' '+message+'\n');}catch(_){}
  return code==='IO'?3:2;
 }
}
module.exports={LIMITS,CliError,parseArgs,contains,portable,canonicalRoot,readPackage,readSnapshot,writeSnapshot,checkExit,compareExit,formatCheck,formatCompare,run,main};
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;},()=>{process.exitCode=3;});
