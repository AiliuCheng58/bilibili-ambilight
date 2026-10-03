import test from "node:test";
import assert from "node:assert/strict";
import "../src/projection.js";

test("captured-frame interpolation settles exactly and resets after a seek",()=>{
  globalThis.document={createElement:()=>{
    const canvas={width:0,height:0,color:[0,0,0]};
    const ctx={globalAlpha:1,drawImage:source=>{canvas.color=canvas.color.map((value,i)=>value*(1-ctx.globalAlpha)+source.color[i]*ctx.globalAlpha);}};
    canvas.getContext=()=>ctx;return canvas;
  }};
  const blender=new globalThis.BiliAmbientProjection.FrameBlender();
  let frames=1;
  const source={currentTime:0,color:[255,0,0],getVideoPlaybackQuality:()=>({totalVideoFrames:frames})};
  assert.deepEqual(blender.sample(source,1,1,0,100).color,[255,0,0]);
  source.color=[0,0,255];frames=2;
  assert.deepEqual(blender.sample(source,1,1,100,100).color,[255,0,0]);
  assert.deepEqual(blender.sample(source,1,1,150,100).color,[127.5,0,127.5]);
  assert.deepEqual(blender.sample(source,1,1,200,100).color,[0,0,255]);
  assert.deepEqual(blender.sample(source,1,1,400,100).color,[0,0,255]);
  source.color=[0,255,0];
  assert.deepEqual(blender.sample(source,1,1,410,100,true).color,[0,255,0]);
  assert.equal(blender.sample(source,1,1,420,0),source);
});
