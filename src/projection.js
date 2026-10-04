(() => {
  "use strict";
  const fullFrame = Object.freeze({ x: 0, y: 0, width: 1, height: 1, readable: true });
  function detectContent(image, settings = globalThis.BiliAmbientSettings.defaults) {
    if(!image)return { ...fullFrame, readable: false };
    const { width, height, data:pixels } = image;
    const barLine = (index, vertical, reference) => {
      const length = vertical ? height : width;
      let dark = 0;
      for (let i = 0; i < 16; i++) {
        const cross = Math.floor(length * (.15 + .7 * i / 15));
        const offset = (vertical ? cross * width + index : index * width + cross) * 4;
        const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        if (settings.detectColoredHorizontalBarSizeEnabled ? rgb.every((v,i)=>Math.abs(v-reference[i])<18) : Math.max(...rgb)<20) dark++;
      }
      return dark >= Math.ceil(16*(1-settings.barSizeDetectionAllowedElementsPercentage/100));
    };
    const pair = (length, vertical) => {
      const limit = Math.floor(length * .4);
      const middle = Math.floor((vertical ? height : width)/2);
      const offsetA = (vertical ? middle * width : middle) * 4;
      const offsetB = (vertical ? middle * width + width-1 : (height-1)*width + middle) * 4;
      const referenceA = Array.from(pixels.slice(offsetA,offsetA+3)), referenceB = Array.from(pixels.slice(offsetB,offsetB+3));
      let first = 0, last = 0;
      while (first < limit && barLine(first, vertical, referenceA)) first++;
      while (last < limit && barLine(length - last - 1, vertical, referenceB)) last++;
      // Symmetry and a bounded, non-black interior distinguish bars from a dark scene.
      if (first < 1 || last < 1 || first === limit || last === limit || Math.abs(first - last) > Math.max(2, length * settings.barSizeDetectionAllowedUnevenBarsPercentage/100)) return [0, 0];
      return [first, last];
    };
    const [left, right] = settings.detectVerticalBarSizeEnabled ? pair(width, true) : [0,0];
    const [top, bottom] = settings.detectHorizontalBarSizeEnabled ? pair(height, false) : [0,0];
    return { x: left / width, y: top / height, width: 1 - (left + right) / width, height: 1 - (top + bottom) / height, readable: true };
  }
  class CropDetector {
    constructor() { this.reset(); }
    reset() { this.history=[]; this.readable=true; }
    detect(image,settings) {
      const raw=this.readable ? detectContent(image,settings) : { ...fullFrame, readable:false };
      this.readable=raw.readable;
      if(raw.readable){this.history.push(raw);if(this.history.length>settings.barSizeDetectionAverageHistorySize)this.history.shift();}
      return this.current(settings);
    }
    current(settings) {
      const median=read=>{const values=this.history.map(read).sort((a,b)=>a-b);return values[Math.floor(values.length/2)] || 0;};
      const offset=settings.detectHorizontalBarSizeOffsetPercentage/100;
      let left=median(c=>c.x), top=median(c=>c.y), right=median(c=>1-c.x-c.width), bottom=median(c=>1-c.y-c.height);
      if(top>0)top=Math.max(0,Math.min(.4,top+offset));if(bottom>0)bottom=Math.max(0,Math.min(.4,bottom+offset));
      if(left>0)left=Math.max(0,Math.min(.4,left+offset));if(right>0)right=Math.max(0,Math.min(.4,right+offset));
      if(settings.horizontalBarsClipPercentage){top=bottom=settings.horizontalBarsClipPercentage/100;}
      if(settings.verticalBarsClipPercentage){left=right=settings.verticalBarsClipPercentage/100;}
      return {x:left,y:top,width:1-left-right,height:1-top-bottom,readable:this.readable};
    }
  }
  function extendFrame(context, source, anchor, viewport, crop = fullFrame, settings = globalThis.BiliAmbientSettings.defaults) {
    const { width, height } = context.canvas;
    if(settings.projectionStyle===1){
      const x=anchor.left+anchor.width*(crop.x+crop.width/2), y=anchor.top+anchor.height*(crop.y+crop.height/2);
      const w=anchor.width*crop.width,h=anchor.height*crop.height;
      const outer=Math.max(settings.spread,x-w/2-viewport.left,viewport.left+viewport.width-x-w/2,y-h/2-viewport.top,viewport.top+viewport.height-y-h/2);
      const step=Math.max(1,Math.max(w,h)*settings.edge/100);
      const levels=Math.max(2,Math.min(200,Math.ceil(outer/step)));
      for(let i=levels;i>=0;i--){
        const radius=outer*i/levels;
        context.drawImage(source,source.width*crop.x,source.height*crop.y,source.width*crop.width,source.height*crop.height,(x-w/2-radius-viewport.left)*width/viewport.width,(y-h/2-radius-viewport.top)*height/viewport.height,(w+radius*2)*width/viewport.width,(h+radius*2)*height/viewport.height);
      }
      return;
    }
    if (!crop.readable && crop.width===1 && crop.height===1) {
      // Unreadable media retains the continuous full-frame projection.
      const scale = Math.max(width / source.width, height / source.height);
      context.drawImage(source, (width - source.width * scale) / 2, (height - source.height * scale) / 2, source.width * scale, source.height * scale);
      return;
    }
    const sx = width / viewport.width;
    const sy = height / viewport.height;
    const left = Math.max(1, Math.min(width - 2, (anchor.left + anchor.width * crop.x - viewport.left) * sx));
    const top = Math.max(1, Math.min(height - 2, (anchor.top + anchor.height * crop.y - viewport.top) * sy));
    const right = Math.max(left + 1, Math.min(width - 1, (anchor.left + anchor.width * (crop.x + crop.width) - viewport.left) * sx));
    const bottom = Math.max(top + 1, Math.min(height - 1, (anchor.top + anchor.height * (crop.y + crop.height) - viewport.top) * sy));
    const sourceWidth = source.width * crop.width;
    const sourceHeight = source.height * crop.height;
    const originX = source.width * crop.x;
    const originY = source.height * crop.y;
    // A narrow edge band retains local colors without copying central objects into the margin.
    const edge = settings.edge / 100;
    const edgeX = Math.max(1, sourceWidth * edge);
    const edgeY = Math.max(1, sourceHeight * edge);
    const sourceX = [originX, originX, originX + sourceWidth - edgeX];
    const sourceY = [originY, originY, originY + sourceHeight - edgeY];
    const sourceW = [edgeX, sourceWidth, edgeX];
    const sourceH = [edgeY, sourceHeight, edgeY];
    const targetX = [0, left, right];
    const targetY = [0, top, bottom];
    const targetW = [left, right - left, width - right];
    const targetH = [top, bottom - top, height - bottom];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      context.drawImage(source, sourceX[x], sourceY[y], sourceW[x], sourceH[y], targetX[x], targetY[y], targetW[x], targetH[y]);
    }
  }
  function surroundingLuminance(image, anchor, viewport, crop, settings) {
    const {width,height,data}=image;
    const clamp=value=>Math.max(0,Math.min(1,value));
    const left=anchor.left+anchor.width*crop.x,top=anchor.top+anchor.height*crop.y;
    const w=anchor.width*crop.width,h=anchor.height*crop.height,right=left+w,bottom=top+h;
    const outer=Math.max(settings.spread,left-viewport.left,viewport.left+viewport.width-right,top-viewport.top,viewport.top+viewport.height-bottom);
    const levels=Math.max(2,Math.min(200,Math.ceil(outer/Math.max(1,Math.max(w,h)*settings.edge/100))));
    const bandX=Math.max(1/(width*crop.width),settings.edge/100),bandY=Math.max(1/(height*crop.height),settings.edge/100);
    const light=(x,y)=>{const index=(y*width+x)*4;return (data[index]*.2126+data[index+1]*.7152+data[index+2]*.0722)/255;};
    let luminance = 0, count = 0;
    for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
      const vx = viewport.left + x / width * viewport.width;
      const vy = viewport.top + y / height * viewport.height;
      if (vx < 0 || vy < 0 || vx > innerWidth || vy > innerHeight) continue;
      if (vx > anchor.left && vx < anchor.left + anchor.width && vy > anchor.top && vy < anchor.top + anchor.height) continue;
      let u=(vx-left)/w,v=(vy-top)/h;
      if(settings.projectionStyle===1){
        const radius=Math.ceil(Math.max(0,Math.abs(vx-left-w/2)-w/2,Math.abs(vy-top-h/2)-h/2)/Math.max(.01,outer/levels))*outer/levels;
        u=(vx-left-w/2)/(w+radius*2)+.5;v=(vy-top-h/2)/(h+radius*2)+.5;
      }else{
        if(vx<left)u=bandX*clamp((vx-viewport.left)/Math.max(1,left-viewport.left));
        if(vx>right)u=1-bandX+bandX*clamp((vx-right)/Math.max(1,viewport.left+viewport.width-right));
        if(vy<top)v=bandY*clamp((vy-viewport.top)/Math.max(1,top-viewport.top));
        if(vy>bottom)v=1-bandY+bandY*clamp((vy-bottom)/Math.max(1,viewport.top+viewport.height-bottom));
      }
      // Match the source texture's bilinear sampling without a synchronous canvas readback.
      const px=Math.max(0,Math.min(width-1,(crop.x+clamp(u)*crop.width)*width-.5));
      const py=Math.max(0,Math.min(height-1,(crop.y+clamp(v)*crop.height)*height-.5));
      const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),dx=px-x0,dy=py-y0;
      luminance += (light(x0,y0)*(1-dx)+light(x1,y0)*dx)*(1-dy)+(light(x0,y1)*(1-dx)+light(x1,y1)*dx)*dy;
      count++;
    }
    return count ? luminance / count : 0;
  }
  function fallbackFilters(context,anchor,viewport,settings,now) {
    if(settings.vibrance===100 && !settings.debandingStrength && [settings.directionTopEnabled,settings.directionRightEnabled,settings.directionBottomEnabled,settings.directionLeftEnabled].every(Boolean))return;
    const {width,height}=context.canvas;
    let image;try{image=context.getImageData(0,0,width,height);}catch{return;}
    const p=image.data, dirs=[settings.directionTopEnabled,settings.directionRightEnabled,settings.directionBottomEnabled,settings.directionLeftEnabled];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4,r=p[i]/255,g=p[i+1]/255,b=p[i+2]/255;
      const gray=r*.2126+g*.7152+b*.0722,high=Math.max(r,g,b),chroma=high-Math.min(r,g,b),saturation=chroma/Math.max(.001,high);
      let factor=1;
      if(settings.vibrance!==100 && saturation>.001){const v=settings.vibrance/100-1,x=v<0?1-saturation:saturation,a=1+5*(1-Math.abs(v));const y=a*a-x*((a*a-1)/(a*a))-(a-x/a)*(a-x/a), curved=Math.min(1,x+(y-x)*5);factor=(v>=0?curved:1-curved)/saturation;}
      const vx=viewport.left+x/width*viewport.width,vy=viewport.top+y/height*viewport.height;
      const distances=[anchor.top-vy,vx-anchor.left-anchor.width,vy-anchor.top-anchor.height,anchor.left-vx], distance=Math.max(...distances);
      const strength=distance>0 && !dirs[distances.indexOf(distance)] ? 1-Math.min(1,distance/20) : 1;
      const seed=Math.sin(x*12.9898+y*78.233+Math.floor(now/100))*43758.5453;
      const noise=(seed-Math.floor(seed)-.5)*settings.debandingStrength/100*.025*(settings.debandingBlendMode?4*gray*(1-gray):1);
      for(const [channel,color] of [r,g,b].entries())p[i+channel]=Math.max(0,Math.min(255,((high-(high-color)*factor)*strength+noise)*255));
    }
    context.putImageData(image,0,0);
  }
  class FrameBlender {
    constructor() { this.buffers=null;this.reset(); }
    reset() { this.token=null;this.changedAt=null;this.duration=0; }
    sample(source,width,height,now,strength,fresh=false) {
      if(!strength || typeof source.currentTime!=="number")return source;
      if(!this.buffers)this.buffers=Array.from({length:3},()=>{const canvas=document.createElement("canvas");return {canvas,ctx:canvas.getContext("2d",{alpha:false})};});
      if(this.buffers[0].canvas.width!==width || this.buffers[0].canvas.height!==height){
        for(const buffer of this.buffers){buffer.canvas.width=width;buffer.canvas.height=height;}fresh=true;
      }
      const [previous,current,output]=this.buffers;
      const token=source.getVideoPlaybackQuality?.().totalVideoFrames ?? source.currentTime;
      if(fresh || this.changedAt===null){
        previous.ctx.drawImage(source,0,0,width,height);current.ctx.drawImage(source,0,0,width,height);
        this.token=token;this.changedAt=now;this.duration=0;
      }else if(token!==this.token){
        previous.ctx.drawImage(current.canvas,0,0);current.ctx.drawImage(source,0,0,width,height);
        this.duration=Math.min(250,Math.max(8,now-this.changedAt))*strength/100;
        this.changedAt=now;this.token=token;
      }
      // Interpolate two captured frames; repeated display frames must not accumulate trails.
      const alpha=this.duration?Math.min(1,(now-this.changedAt)/this.duration):1;
      output.ctx.globalAlpha=1;output.ctx.drawImage(previous.canvas,0,0);
      output.ctx.globalAlpha=alpha;output.ctx.drawImage(current.canvas,0,0);output.ctx.globalAlpha=1;
      return output.canvas;
    }
  }
  globalThis.BiliAmbientProjection = Object.freeze({ extendFrame, detectContent, surroundingLuminance, fullFrame, CropDetector, fallbackFilters, FrameBlender });
})();
