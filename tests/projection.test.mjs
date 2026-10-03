import test from "node:test";
import assert from "node:assert/strict";
import "../src/settings.js";
import "../src/projection.js";
test("even-sized crop history keeps both edges nonnegative during a bar transition",()=>{
  const context=bars=>({canvas:{width:100,height:100},getImageData(){const data=new Uint8ClampedArray(40000);for(let y=0;y<100;y++)for(let x=0;x<100;x++){const value=bars && (x<10 || x>=90)?0:150;data.set([value,value,value,255],(y*100+x)*4);}return {data};}});
  const detector=new globalThis.BiliAmbientProjection.CropDetector(),settings={...globalThis.BiliAmbientSettings.defaults,barSizeDetectionAverageHistorySize:4};
  detector.detect(context(false),settings);detector.detect(context(false),settings);detector.detect(context(true),settings);
  const crop=detector.detect(context(true),settings);assert.ok(crop.x>=0 && 1-crop.x-crop.width>=0);assert.equal(crop.width,.8);
});
