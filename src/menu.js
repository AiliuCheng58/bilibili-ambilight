(() => {
  "use strict";
  class PlayerMenu {
    constructor(api) {
      this.api=api;this.inputs=new Map();this.pending={};this.settings={...globalThis.BiliAmbientSettings.defaults};
      this.button=document.createElement("button");this.button.className="bili-ambient-settings-button";this.button.type="button";
      this.button.title="氛围光设置";this.button.setAttribute("aria-label","氛围光设置");this.button.textContent="◉";
      this.button.addEventListener("click",event=>{event.stopPropagation();this.toggle();});
      this.root=document.createElement("div");this.root.id="bili-ambient-menu";this.root.attachShadow({mode:"open"});
      this.lifecycle=new AbortController();
      window.addEventListener("keydown",event=>{if(event.key==="Escape" && this.open){this.toggle(false);event.stopImmediatePropagation();event.preventDefault();}},{capture:true,signal:this.lifecycle.signal});
      window.addEventListener("pagehide",()=>this.flush(),{signal:this.lifecycle.signal});
    }
    attach(video, site = false) {
      const player=video?.closest(".bpx-player-container,.bilibili-player,#bilibili-player,#bofqi,.live-player-mounter") || video?.parentElement;
      if(!player && !site){this.button.remove();this.toggle(false);return;}
      const toolbar=player?.querySelector(".bpx-player-control-bottom-right,.bilibili-player-video-control-bottom-right,.xgplayer-controls-right");
      const parent=toolbar || player || document.body;
      this.button.dataset.site=String(!player);
      this.button.dataset.floating=String(!toolbar);
      if(this.button.parentElement!==parent)parent.append(this.button);
      const menuParent=document.fullscreenElement || document.documentElement;
      if(menuParent.tagName!=="VIDEO" && this.root.parentElement!==menuParent)menuParent.append(this.root);
    }
    build() {
      if(this.panel)return;
      const style=document.createElement("style");style.textContent=`
        :host{position:fixed;right:16px;top:80px;bottom:16px;z-index:2147483647;display:none;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:#eef1f8;text-shadow:none;width:min(380px,calc(100vw - 32px));}
        :host([data-open]){display:block}*{box-sizing:border-box}.panel{max-height:100%;overflow:auto;padding:18px;border:1px solid #ffffff24;border-radius:14px;background:#141721ed;backdrop-filter:blur(24px);box-shadow:0 8px 30px #0006;}
        header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:16px}button{font:inherit;cursor:pointer;border:1px solid #ffffff30;border-radius:6px;background:#ffffff0c;color:inherit;padding:5px 10px;}summary{cursor:pointer;padding:12px 0;border-top:1px solid #ffffff18;}label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;}input[type=range]{display:block;width:100%;accent-color:#ed8dae;}input[type=checkbox]{accent-color:#ed8dae;}input[type=number],input[type=text],select{max-width:130px;background:#242937;color:inherit;border:1px solid #ffffff30;border-radius:4px;padding:5px;font:inherit;}output{color:#f2abc9;}section{padding-bottom:10px;}p{color:#b7c1d4;font-size:11px;} .presets{display:flex;gap:6px;margin:12px 0;}[hidden]{display:none !important;}`;
      this.panel=document.createElement("div");this.panel.className="panel";this.panel.setAttribute("role","dialog");this.panel.setAttribute("aria-label","氛围光设置");
      const header=document.createElement("header"), title=document.createElement("strong"),close=document.createElement("button");
      title.textContent="Bili Ambient";close.textContent="×";close.setAttribute("aria-label","关闭设置");close.addEventListener("click",()=>this.toggle(false));header.append(title,close);this.panel.append(header);
      this.addControl(this.panel,["enabled","开启氛围光"]);
      const presets=document.createElement("div");presets.className="presets";
      for(const [key,label] of [["soft","通透"],["cinema","影院"],["eco","省电"]]){
        const button=document.createElement("button");button.textContent=label;
        button.addEventListener("click",()=>{const preset=globalThis.BiliAmbientSettings.presets[key];this.change(Object.fromEntries(Object.entries(preset).filter(([name])=>!name.endsWith("Key") && name!=="enabled" && name!=="syncSettings")));});presets.append(button);
      }
      this.panel.append(presets);
      const groups=[["光效调整",[["brightness","光效亮度","%"],["spread","边缘过渡范围","px"],["blur","背景柔化","px"],["dim","背景深浅","%"],["glassOpacity","毛玻璃浓度","%"],["glassBlur","毛玻璃模糊","px"],["saturation","色彩饱和度","%"],["smoothing","过渡平滑","%"],["fps","光效帧率 · 0 为不限","FPS"],["quality","基础采样精度","px"]]],...globalThis.BiliAmbientControls];
      for(const [name,controls] of groups){
        const details=document.createElement("details"),summary=document.createElement("summary"),section=document.createElement("section");summary.textContent=name;details.append(summary,section);details.open=name==="光效调整";
        for(const item of controls)this.addControl(section,item);this.panel.append(details);
      }
      const options=document.createElement("button");options.textContent="打开完整设置与备份";options.addEventListener("click",()=>this.api.runtime.sendMessage({type:"bili-ambient:open-options"}).catch(()=>this.status.textContent="可从浏览器工具栏打开设置。"));
      this.status=document.createElement("p");this.status.setAttribute("role","status");this.panel.append(options,this.status);this.root.shadowRoot.append(style,this.panel);
    }
    addControl(parent,[key,label,unit]) {
      const config=globalThis.BiliAmbientSettings,row=document.createElement("div"),caption=document.createElement("label"),span=document.createElement("span");
      span.textContent=label;span.id=`${key}-label`;caption.append(span);
      let input;
      if(Array.isArray(unit)){input=document.createElement("select");for(const [value,text] of unit)input.add(new Option(text,String(value)));}
      else{input=document.createElement("input");const value=config.defaults[key];input.type=typeof value==="boolean"?"checkbox":typeof value==="string"?"text":key==="fps"||key==="quality"?"number":"range";
        if(typeof value==="number"){const [min,max,step=1]=config.ranges[key];input.min=min;input.max=max;input.step=step;}
        if(input.type==="text")input.maxLength=1;
      }
      input.id=key;input.setAttribute("aria-labelledby",span.id);caption.htmlFor=key;
      let output;
      if(input.type==="range"){output=document.createElement("output");caption.append(output);row.append(caption,input);}else{caption.append(input);row.append(caption);}
      input.addEventListener(input.type==="range"?"input":"change",()=>this.change({[key]:input.type==="checkbox"?input.checked:input.type==="text"?input.value:Number(input.value)}));
      this.inputs.set(key,{input,output,unit});parent.append(row);
    }
    change(patch) {
      Object.assign(this.pending,patch);this.setSettings({...this.settings,...patch});clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),100);
    }
    flush() {
      clearTimeout(this.timer);const patch=this.pending;this.pending={};
      if(Object.keys(patch).length)this.api.storage.local.set(patch).catch(()=>{if(this.status)this.status.textContent="设置未能保存，请刷新页面后重试。";});
    }
    setSettings(settings) {
      this.settings=globalThis.BiliAmbientSettings.normalize(settings);
      if(!this.open)return;
      for(const [key,{input,output,unit}] of this.inputs){
        const value=this.settings[key];if(input.type==="checkbox")input.checked=value;
        else{if(input.tagName==="SELECT" && ![...input.options].some(o=>o.value===String(value)))input.add(new Option(String(value),String(value)));input.value=value;}
        if(output)output.value=`${value} ${unit || ""}`;
      }
    }
    toggle(force=!this.open) {
      this.open=force;this.button.setAttribute("aria-expanded",String(force));this.root.toggleAttribute("data-open",force);
      if(force){this.build();this.setSettings(this.settings);this.root.shadowRoot.querySelector('[aria-label="关闭设置"]').focus();}else this.flush();
    }
    dispose() {this.flush();this.lifecycle.abort();this.root.remove();this.button.remove();}
  }
  globalThis.BiliAmbientMenu=PlayerMenu;
})();
