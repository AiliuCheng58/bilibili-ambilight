import test from "node:test";
import assert from "node:assert/strict";
import "../src/settings.js";
import "../src/projection.js";
test("even-sized crop history keeps both edges nonnegative during a bar transition",()=>{
  const context=bars=>{const data=new Uint8ClampedArray(40000);for(let y=0;y<100;y++)for(let x=0;x<100;x++){const value=bars && (x<10 || x>=90)?0:150;data.set([value,value,value,255],(y*100+x)*4);}return {width:100,height:100,data};};
  const detector=new globalThis.BiliAmbientProjection.CropDetector(),settings={...globalThis.BiliAmbientSettings.defaults,barSizeDetectionAverageHistorySize:4};
  detector.detect(context(false),settings);detector.detect(context(false),settings);detector.detect(context(true),settings);
  const crop=detector.detect(context(true),settings);assert.ok(crop.x>=0 && 1-crop.x-crop.width>=0);assert.equal(crop.width,.8);
});

test('surrounding brightness follows cropped edge pixels rather than the bright video center',()=>{
  globalThis.innerWidth=100;globalThis.innerHeight=100;
  const data=new Uint8ClampedArray(100*100*4);
  for(let y=0;y<100;y++)for(let x=0;x<100;x++){const value=x>=20&&x<80&&y>=20&&y<80?255:0;data.set([value,value,value,255],(y*100+x)*4);}
  const image={width:100,height:100,data},anchor={left:25,top:25,width:50,height:50},viewport={left:0,top:0,width:100,height:100};
  const {surroundingLuminance,fullFrame}=globalThis.BiliAmbientProjection,settings={...globalThis.BiliAmbientSettings.defaults,projectionStyle:0};
  assert.ok(surroundingLuminance(image,anchor,viewport,fullFrame,settings)<.01);
  assert.ok(surroundingLuminance(image,anchor,viewport,{x:.21,y:.21,width:.58,height:.58},settings)>.99);
  settings.projectionStyle=1;
  assert.ok(surroundingLuminance(image,anchor,viewport,{x:.21,y:.21,width:.58,height:.58},settings)>.99);
});

test('manual clipping is available before the first asynchronous pixel result',()=>{
  const detector=new globalThis.BiliAmbientProjection.CropDetector();
  const crop=detector.current({...globalThis.BiliAmbientSettings.defaults,verticalBarsClipPercentage:12});
  assert.equal(crop.x,.12);assert.equal(crop.width,.76);assert.equal(crop.readable,true);
  assert.equal(detector.detect(null,globalThis.BiliAmbientSettings.defaults).readable,false);
});
