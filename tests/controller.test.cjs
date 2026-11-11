'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../dist/engine.js');
const app = fs.readFileSync(require.resolve('../dist/app.js'), 'utf8');
function harness(overrides = {}) {
  const elements = new Map(), downloads = [], blobs = new Map();
  class Element {
    constructor(tag='div') { this.tag=tag; this.value=''; this.textContent=''; this.children=[]; this.className=''; this.hidden=false; this.disabled=false; this.checked=false; this.listeners={}; this.files=[]; }
    addEventListener(type,fn) { this.listeners[type]=fn; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; this.textContent=''; }
    remove() {}
    click() { if(this.tag==='a') downloads.push({name:this.download,blob:blobs.get(this.href)}); }
    async fire(type) { const fn=this.listeners[type]; assert(fn,'listener '+type); return await fn({target:this}); }
  }
  const get = id => { if(!elements.has(id)) { const element=new Element(); if(id==='skill-source') { let value=''; Object.defineProperty(element,'value',{get:()=>value,set:next=>{value=next.replace(/\r\n?/g,'\n');}}); } elements.set(id,element); } return elements.get(id); };
  const document={getElementById:get,createElement:tag=>new Element(tag),body:new Element('body')};
  const URL={createObjectURL:blob=>{const id='blob:'+blobs.size;blobs.set(id,blob);return id;},revokeObjectURL:()=>{}};
  const context={window:{SkillDoctor:{...E,...overrides}},document,TextDecoder,Blob,URL,setTimeout:()=>0};
  vm.runInNewContext(app,context);
  for(const id of ['snapshot-btn','report-btn','compare-btn','export-review']) get(id).disabled=true; // markup initial states
  return {get,downloads,document};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
const validBaseline = async () => JSON.stringify(await E.createSnapshot([{path:'SKILL.md',content:'---\nname: demo\ndescription: Demo\n---'}]));
test('sample inspection produces real findings and holds exports for review', async () => {
  const h=harness();await h.get('demo-btn').fire('click');await h.get('inspect-btn').fire('click');
  assert.equal(h.get('file-count').textContent,'3');assert.equal(h.get('error-count').textContent,'0');assert.equal(h.get('warning-count').textContent,'0');assert.equal(h.get('export-review').disabled,false);assert.equal(h.get('snapshot-btn').disabled,true);
  h.get('export-review').checked=true;await h.get('export-review').fire('change');assert.equal(h.get('snapshot-btn').disabled,false);
});
test('editing source invalidates current snapshots and export approval',async()=>{
  const h=harness();await h.get('demo-btn').fire('click');await h.get('inspect-btn').fire('click');h.get('export-review').checked=true;await h.get('export-review').fire('change');
  h.get('skill-source').value+=' changed';await h.get('skill-source').fire('input');assert.equal(h.get('export-review').checked,false);assert.equal(h.get('snapshot-btn').disabled,true);assert.equal(h.get('compare-btn').disabled,true);
  await h.get('snapshot-btn').fire('click');assert.equal(h.downloads.length,0);
});
test('exports contain hashes and paths but no source body',async()=>{
  const h=harness();await h.get('demo-btn').fire('click');await h.get('inspect-btn').fire('click');h.get('export-review').checked=true;await h.get('export-review').fire('change');await h.get('report-btn').fire('click');
  assert.equal(h.downloads.length,1);const text=await h.downloads[0].blob.text();assert(text.includes('sha256'));assert(!text.includes('Keep evidence separate'));assert(!text.includes('Summarize a synthetic incident'));assert.equal(JSON.parse(text).snapshot.files.length,3);
});
test('changing baseline clears comparison approval without discarding current snapshot',async()=>{
  const h=harness();await h.get('demo-btn').fire('click');await h.get('inspect-btn').fire('click');h.get('export-review').checked=true;await h.get('export-review').fire('change');h.get('baseline').value=await validBaseline();await h.get('baseline').fire('input');assert.equal(h.get('snapshot-btn').disabled,true);await h.get('compare-btn').fire('click');assert.equal(h.get('comparison').className,'table-wrap');
});
test('invalid snapshot input shows a fixed error and discards old comparison',async()=>{
  const h=harness();await h.get('demo-btn').fire('click');await h.get('inspect-btn').fire('click');h.get('baseline').value='{"PRIVATE_RAW":';await h.get('compare-btn').fire('click');assert.equal(h.get('error-box').hidden,false);assert(!h.get('error-box').textContent.includes('PRIVATE_RAW'));assert.equal(h.get('comparison').className,'empty');
});
test('late hash result cannot replace state after clearing',async()=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});const h=harness({createSnapshot:()=>delayed});await h.get('demo-btn').fire('click');const running=h.get('inspect-btn').fire('click');await h.get('clear-btn').fire('click');release(await E.createSnapshot([{path:'SKILL.md',content:'old'}]));await running;assert.equal(h.get('file-count').textContent,'0');assert.equal(h.get('export-review').disabled,true);
});
test('late package import cannot overwrite newer sample input',async()=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});const h=harness();h.get('package-files').files=[{name:'SKILL.md',size:10,arrayBuffer:()=>delayed}];const running=h.get('package-files').fire('change');await h.get('demo-btn').fire('click');release(new TextEncoder().encode('OLD SOURCE').buffer);await running;assert(h.get('skill-source').value.includes('incident-summary'));assert.equal(h.get('file-count').textContent,'3');
});
test('late baseline file cannot overwrite newly typed baseline',async()=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});const h=harness();const json=await validBaseline();h.get('baseline-file').files=[{size:json.length,arrayBuffer:()=>delayed}];const running=h.get('baseline-file').fire('change');h.get('baseline').value='new manually typed baseline';await h.get('baseline').fire('input');release(new TextEncoder().encode(json).buffer);await running;assert.equal(h.get('baseline').value,'new manually typed baseline');
});
test('invalid UTF-8 file import clears the rejected selection and sanitizes errors',async()=>{
  const h=harness();await h.get('demo-btn').fire('click');h.get('package-files').files=[{name:'secret.md',size:2,arrayBuffer:async()=>new Uint8Array([0xff,0xff]).buffer}];await h.get('package-files').fire('change');assert.equal(h.get('file-count').textContent,'0');assert.equal(h.get('skill-source').value,'');assert(!h.get('error-box').textContent.includes('secret.md'));
});
test('folder import strips only selected root and preserves relative paths',async()=>{
  const h=harness();h.get('package-folder').files=[{name:'SKILL.md',webkitRelativePath:'package/nested/SKILL.md',size:10,arrayBuffer:async()=>new TextEncoder().encode('---\nname: demo\ndescription: Demo\n---').buffer}];await h.get('package-folder').fire('change');await h.get('inspect-btn').fire('click');h.get('export-review').checked=true;await h.get('export-review').fire('change');await h.get('snapshot-btn').fire('click');assert.equal(JSON.parse(await h.downloads[0].blob.text()).files[0].path,'nested/SKILL.md');
});
test('oversized package does not read file contents',async()=>{
  let read=false;const h=harness();h.get('package-files').files=[{name:'large.txt',size:1048577,arrayBuffer:async()=>{read=true;return new ArrayBuffer(0);}}];await h.get('package-files').fire('change');assert.equal(read,false);assert.equal(h.get('error-box').hidden,false);
});
test('imported root snapshots preserve UTF-8 BOM and CRLF despite textarea normalization',async()=>{
  const text='\uFEFF---\r\nname: demo\r\ndescription: Demo\r\n---\r\n';const raw=new TextEncoder().encode(text);const h=harness();h.get('package-files').files=[{name:'SKILL.md',size:raw.length,arrayBuffer:async()=>raw.buffer}];await h.get('package-files').fire('change');
  assert(!h.get('skill-source').value.includes('\r')); // Browser textarea normalizes its display value.
  await h.get('inspect-btn').fire('click');h.get('export-review').checked=true;await h.get('export-review').fire('change');await h.get('snapshot-btn').fire('click');const snapshot=JSON.parse(await h.downloads[0].blob.text());assert.equal(snapshot.files[0].sha256,await E.sha256(text));assert.equal(snapshot.files[0].bytes,raw.length);assert.notEqual(snapshot.files[0].sha256,await E.sha256(text.slice(1)));
  h.get('skill-source').value+='edited';await h.get('skill-source').fire('input');await h.get('inspect-btn').fire('click');h.get('export-review').checked=true;await h.get('export-review').fire('change');await h.get('snapshot-btn').fire('click');const edited=JSON.parse(await h.downloads[1].blob.text());assert.equal(edited.files[0].sha256,await E.sha256(h.get('skill-source').value));
});
