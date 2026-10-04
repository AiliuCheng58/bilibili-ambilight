(() => {
  "use strict";
  function readPixels() {
    let canvas, context;
    onmessage = ({data:{bitmap,id}}) => {
      try {
        if (!canvas) { canvas=new OffscreenCanvas(bitmap.width,bitmap.height);context=canvas.getContext("2d",{willReadFrequently:true}); }
        if(canvas.width!==bitmap.width || canvas.height!==bitmap.height){canvas.width=bitmap.width;canvas.height=bitmap.height;}
        context.drawImage(bitmap,0,0);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height);
        postMessage({id,pixels},[pixels.data.buffer]);
      } catch { postMessage({id,failed:true}); }
      finally { bitmap.close(); }
    };
  }
  class Inspection {
    constructor(onReady=()=>{}) { this.onReady=onReady;this.generation=0;this.pending=false;this.result=null;this.failed=false; }
    reset() { this.generation++;this.result=null; }
    take() { const result=this.result;this.result=null;return result; }
    request(source) {
      if(this.failed)return false;
      if(this.pending)return true;
      try {
        if(!this.worker){
          if(typeof OffscreenCanvas!=="function" || typeof createImageBitmap!=="function")throw new Error();
          this.url=URL.createObjectURL(new Blob([`(${readPixels.toString()})()`],{type:"text/javascript"}));
          this.worker=new Worker(this.url);
          this.worker.onmessage=({data})=>{
            clearTimeout(this.timeout);this.pending=false;
            if(data.failed){this.disable(true);return;}
            const retry=data.id!==this.generation;
            if(!retry)this.result=data.pixels;
            this.onReady(retry);
          };
          this.worker.onerror=event=>{event.preventDefault();this.disable(true);};
        }
        const id=this.generation,job={};this.job=job;
        this.pending=true;
        this.timeout=setTimeout(()=>this.disable(true),3000);
        createImageBitmap(source).then(bitmap=>{
          if(this.job!==job){bitmap.close();return;}
          if(!this.worker || id!==this.generation){bitmap.close();clearTimeout(this.timeout);this.pending=false;this.onReady(true);return;}
          try{this.worker.postMessage({bitmap,id},[bitmap]);}
          catch{bitmap.close();this.disable(true);}
        },()=>{if(this.job===job)this.disable(true);});
        return true;
      }catch{this.disable();return false;}
    }
    disable(notify=false) { this.dispose();this.failed=true;if(notify)this.onReady(true); }
    dispose() {
      this.reset();clearTimeout(this.timeout);this.pending=false;this.job=null;
      this.worker?.terminate();this.worker=null;
      if(this.url)URL.revokeObjectURL(this.url);this.url=null;
    }
  }
  globalThis.BiliAmbientInspection=Inspection;
})();
