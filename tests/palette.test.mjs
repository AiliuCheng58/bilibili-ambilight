import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/site.js';

test('saved palette averages the left, right and bottom of the supplied pixels',()=>{
  globalThis.MutationObserver=class{};
  const writes=[];
  const site=new globalThis.BiliAmbientSite({storage:{local:{set:async value=>{writes.push(value);}}}});
  const data=new Uint8ClampedArray(8*8*4);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const rgb=y>=6?[255,0,0]:x<2?[0,0,255]:x>=6?[0,255,0]:[0,0,0];
    data.set([...rgb,255],(y*8+x)*4);
  }
  site.remember({width:8,height:8,data},0);
  assert.deepEqual(writes,[{sitePalette:[[64,0,191],[64,191,0],[255,0,0]]}]);
  delete globalThis.MutationObserver;
});
