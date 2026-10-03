(() => {
  "use strict";
  class RenderStats {
    constructor(parent) {
      this.element=document.createElement("div");this.element.className="bili-ambient-stats";
      this.text=document.createElement("pre");this.graph=document.createElement("canvas");this.graph.width=240;this.graph.height=45;
      this.element.append(this.text,this.graph);parent.append(this.element);
      this.times=[];this.frames=[];this.displayFrames=[];this.videoFrames=[];this.displayId=null;this.lastUpdate=-Infinity;
    }
    draw(now,duration,frame,background,crop,settings,renderer,video) {
      this.element.hidden=![settings.showFPS,settings.showFrametimes,settings.showResolutions,settings.showBarDetectionStats].some(Boolean);
      if(this.element.hidden){this.suspend();return;}
      if(settings.showFPS && this.displayId===null)this.trackDisplay();
      if(!settings.showFPS)this.suspend();
      this.frames.push(now);this.frames=this.frames.filter(t=>now-t<1000);
      const quality=video.getVideoPlaybackQuality?.();
      if(quality){const count=quality.totalVideoFrames-quality.droppedVideoFrames;if(count<(this.videoFrames.at(-1)?.count ?? 0))this.videoFrames=[];this.videoFrames.push({time:now,count});while(this.videoFrames.length>2 && now-this.videoFrames[1].time<1000)this.videoFrames.shift();}
      this.times.push(duration);if(this.times.length>120)this.times.shift();
      if(now-this.lastUpdate<250)return;this.lastUpdate=now;
      const lines=[];
      if(settings.showFPS){
        const first=this.videoFrames[0],last=this.videoFrames.at(-1);
        const videoFPS=first && last && last.time>first.time?Math.round((last.count-first.count)*1000/(last.time-first.time)):0;
        lines.push(`氛围光 ${this.frames.length} FPS · ${renderer}\n视频 ${videoFPS} FPS · 显示 ${this.displayFrames.length} FPS`);
      }
      if(settings.showResolutions)lines.push(`视频 ${video.videoWidth}×${video.videoHeight}\n采样 ${frame.width}×${frame.height} · 背景 ${background.width}×${background.height}\n绘制 ${duration.toFixed(2)} ms`);
      if(settings.showBarDetectionStats)lines.push(`边框 上 ${(crop.y*100).toFixed(1)}% 下 ${((1-crop.y-crop.height)*100).toFixed(1)}%\n边框 左 ${(crop.x*100).toFixed(1)}% 右 ${((1-crop.x-crop.width)*100).toFixed(1)}%${crop.readable?"":" · 媒体不可读取"}`);
      this.text.textContent=lines.join("\n");this.graph.style.display=settings.showFrametimes?"block":"none";
      if(settings.showFrametimes){
        const ctx=this.graph.getContext("2d");ctx.clearRect(0,0,240,45);ctx.strokeStyle="#8ff0de";ctx.beginPath();
        const max=Math.max(16.7,...this.times);
        this.times.forEach((time,i)=>{const x=i*240/120,y=44-time/max*43;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
      }
    }
    trackDisplay() {
      this.displayId=requestAnimationFrame(now=>{this.displayId=null;this.displayFrames.push(now);this.displayFrames=this.displayFrames.filter(time=>now-time<1000);this.trackDisplay();});
    }
    suspend() {if(this.displayId!==null)cancelAnimationFrame(this.displayId);this.displayId=null;this.displayFrames=[];}
    dispose() {this.suspend();this.element.remove();}
  }
  globalThis.BiliAmbientStats=RenderStats;
})();
