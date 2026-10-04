import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

const source=await readFile(new URL('../src/inspection.js',import.meta.url),'utf8');
function setup(){
  const workers=[],bitmaps=[],revoked=[];
  class Worker {
    constructor(){workers.push(this);this.sent=[];}
    postMessage(data){this.sent.push(data);}
    terminate(){this.terminated=true;}
  }
  const context={Worker,OffscreenCanvas:class {},Blob,URL:{createObjectURL:()=>`blob:${workers.length}`,revokeObjectURL:url=>revoked.push(url)},setTimeout,clearTimeout,
    createImageBitmap:()=>new Promise(resolve=>bitmaps.push(resolve))};
  runInNewContext(source,context);
  return {inspection:new context.BiliAmbientInspection(),workers,bitmaps,revoked};
}
const bitmap=()=>({closed:false,close(){this.closed=true;}});

test('inspection discards old results after a media reset and accepts the next frame',async()=>{
  const {inspection,workers,bitmaps}=setup();
  let ready=0,retries=0;inspection.onReady=retry=>retry?retries++:ready++;
  assert.equal(inspection.request({}),true);bitmaps.shift()(bitmap());await Promise.resolve();
  const old=workers[0].sent[0];inspection.reset();
  workers[0].onmessage({data:{id:old.id,pixels:'old'}});
  assert.equal(inspection.take(),null);
  assert.equal(ready,0);
  assert.equal(retries,1);
  inspection.request({});bitmaps.shift()(bitmap());await Promise.resolve();
  workers[0].onmessage({data:{id:workers[0].sent[1].id,pixels:'new'}});
  assert.equal(inspection.take(),'new');assert.equal(inspection.take(),null);assert.equal(ready,1);inspection.dispose();
});
test('a late bitmap closes without disturbing a replacement inspection',async()=>{
  const {inspection,workers,bitmaps,revoked}=setup();
  inspection.request({});const oldResolve=bitmaps.shift();inspection.dispose();
  inspection.request({});const oldBitmap=bitmap();oldResolve(oldBitmap);await Promise.resolve();
  assert.equal(oldBitmap.closed,true);assert.equal(inspection.pending,true);
  bitmaps.shift()(bitmap());await Promise.resolve();
  assert.equal(workers[1].sent.length,1);assert.equal(workers[0].terminated,true);
  assert.equal(revoked.length,1);inspection.dispose();
});
test('worker failure releases resources and selects synchronous inspection',async()=>{
  const {inspection,workers,bitmaps}=setup();
  let retry=false;inspection.onReady=value=>{retry=value;};
  inspection.request({});bitmaps.shift()(bitmap());await Promise.resolve();
  let prevented=false;workers[0].onerror({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(workers[0].terminated,true);
  assert.equal(inspection.request({}),false);assert.equal(inspection.pending,false);
  assert.equal(retry,true);
});

test('reset during bitmap creation requests another inspection when the stale bitmap resolves',async()=>{
  const {inspection,bitmaps}=setup();
  let retry=false;inspection.onReady=value=>{retry=value;};
  inspection.request({});inspection.reset();
  const oldBitmap=bitmap();bitmaps.shift()(oldBitmap);await Promise.resolve();
  assert.equal(oldBitmap.closed,true);assert.equal(inspection.pending,false);assert.equal(retry,true);
  inspection.dispose();
});
