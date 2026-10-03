(() => {
  "use strict";
  class VideoEffects {
    constructor() {
      this.video=null;this.source=null;this.overlay=null;this.noise=null;this.jitter=null;
      this.samples=[];this.fresh=true;this.active=false;
      this.blender=new globalThis.BiliAmbientProjection.FrameBlender();
      const tile=document.createElement("canvas");tile.width=tile.height=64;
      const ctx=tile.getContext("2d"),image=ctx.createImageData(64,64);
      let seed=217;
      for(let i=0;i<image.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const value=seed>>>24;image.data.set([value,value,value,255],i);}
      ctx.putImageData(image,0,0);this.noiseURL=tile.toDataURL();
    }
    attach(video,source=video) {
      if(this.video===video && this.source===source)return;
      this.detach();this.video=video;this.source=source;this.samples=[];this.fresh=true;
    }
    droppedPercentage(now) {
      const quality=this.video.getVideoPlaybackQuality?.();
      if(!quality)return 0;
      const previous=this.samples.at(-1);
      // Decoders can restart their counters after a source or resolution change.
      if(previous && (quality.totalVideoFrames<previous.frames || quality.droppedVideoFrames<previous.dropped))this.samples=[];
      this.samples.push({time:now,frames:quality.totalVideoFrames,dropped:quality.droppedVideoFrames});
      while(this.samples.length>2 && now-this.samples[0].time>5000)this.samples.shift();
      const first=this.samples[0],frames=quality.totalVideoFrames-first.frames;
      return frames>=10?Math.max(0,quality.droppedVideoFrames-first.dropped)/frames*100:0;
    }
    draw(settings,alpha,now,parent) {
      if(!this.video?.isConnected || !this.source?.parentElement)return;
      const dropped=this.droppedPercentage(now);
      const sync=settings.videoOverlayEnabled && dropped<=settings.videoOverlaySyncThreshold;
      this.video.classList.toggle("bili-ambient-mpo",settings.chromiumDirectVideoOverlayWorkaround);
      if(sync){
        if(!this.overlay){this.overlay=document.createElement("canvas");this.overlay.className="bili-ambient-video-sync";this.ctx=this.overlay.getContext("2d",{alpha:false});this.source.after(this.overlay);this.fresh=true;}
        const width=this.source.videoWidth || this.source.width,height=this.source.videoHeight || this.source.height;
        const ratio=Math.min(1,1920/Math.max(width,height));
        const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
        if(this.overlay.width!==w || this.overlay.height!==h){this.overlay.width=w;this.overlay.height=h;this.fresh=true;}
        const sourceFrame=settings.frameBlending?this.blender.sample(this.source,w,h,now,settings.frameBlendingSmoothness,this.fresh):this.source;
        this.ctx.globalAlpha=this.fresh?1:alpha;this.ctx.drawImage(sourceFrame,0,0,w,h);this.ctx.globalAlpha=1;this.fresh=false;
        this.place(this.overlay);
        if(!this.video.classList.contains("bili-ambient-synchronized"))this.video.classList.add("bili-ambient-synchronized");this.active=true;
      }else{this.overlay?.remove();this.overlay=null;if(this.video.classList.contains("bili-ambient-synchronized"))this.video.classList.remove("bili-ambient-synchronized");this.active=false;}
      if(settings.videoDebandingStrength){
        if(!this.noise){this.noise=document.createElement("div");this.noise.className="bili-ambient-video-noise";this.noise.style.backgroundImage=`url(${this.noiseURL})`;this.source.parentElement.append(this.noise);}
        this.place(this.noise);this.noise.style.opacity=String(settings.videoDebandingStrength/100*.08);this.noise.style.mixBlendMode=settings.debandingBlendMode?"overlay":"normal";
      }else{this.noise?.remove();this.noise=null;}
      if(settings.chromiumBugVideoJitterWorkaround && !this.video.paused){
        if(!this.jitter){this.jitter=document.createElement("div");this.jitter.className="bili-ambient-jitter";parent.append(this.jitter);}
      }else{this.jitter?.remove();this.jitter=null;}
    }
    place(element) {
      const source=this.source;
      const properties={left:`${source.offsetLeft}px`,top:`${source.offsetTop}px`,width:`${source.offsetWidth}px`,height:`${source.offsetHeight}px`,objectFit:getComputedStyle(source).objectFit,transform:getComputedStyle(source).transform};
      for(const [key,value] of Object.entries(properties))if(element.style[key]!==value)element.style[key]=value;
      for(const key of ["--bili-ambient-video-clip","--bili-ambient-video-fill"]){const value=this.video.style.getPropertyValue(key);if(element.style.getPropertyValue(key)!==value)element.style.setProperty(key,value);}
    }
    suspend() {this.overlay?.remove();this.overlay=null;this.noise?.remove();this.noise=null;this.jitter?.remove();this.jitter=null;if(this.video && (this.video.classList.contains("bili-ambient-synchronized") || this.video.classList.contains("bili-ambient-mpo")))this.video.classList.remove("bili-ambient-synchronized","bili-ambient-mpo");this.active=false;this.fresh=true;}
    detach() {this.suspend();this.blender.reset();this.video=null;this.source=null;}
  }
  globalThis.BiliAmbientVideoEffects=VideoEffects;
})();
