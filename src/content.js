(() => {
  "use strict";
  const config = globalThis.BiliAmbientSettings;
  const api = globalThis.chrome;
  if (!config || !globalThis.BiliAmbientSite || !globalThis.BiliAmbientTheme || !globalThis.BiliAmbientProjection || !globalThis.BiliAmbientRenderer || !globalThis.BiliAmbientStats || !globalThis.BiliAmbientVideoEffects || !api?.storage?.local || globalThis.__biliAmbientController) return;
  const theme = new globalThis.BiliAmbientTheme();
  const site = new globalThis.BiliAmbientSite(api);
  const menu = new globalThis.BiliAmbientMenu(api);

  const videoSelector = ".bpx-player-video-wrap video, .bilibili-player-video-wrap video, #bilibili-player video, #bilibiliPlayer video, #bofqi video, .live-player-mounter video";
  let settings = { ...config.defaults };
  let video = null;
  let mediaSource = null;
  let isHDR = false;
  let effectBrightness = settings.brightness;
  let effectContrast = settings.contrast;
  const videoEffects = new globalThis.BiliAmbientVideoEffects();
  let host = null;
  let shade = null;
  let halo = null;
  let canvas = null;
  let ctx = null;
  let edgeCanvas = null;
  let edgeCtx = null;
  let frame = null;
  let frameCtx = null;
  let probeCtx = null;
  let anchor = null;
  let anchorKey = "";
  let viewport = null;
  let crop = { ...globalThis.BiliAmbientProjection.fullFrame };
  const detector = new globalThis.BiliAmbientProjection.CropDetector();
  const blender = new globalThis.BiliAmbientProjection.FrameBlender();
  let renderer = null;
  let stats = null;
  let rendererName = "Canvas 2D";
  let mode = "SMALL";
  let previousPixels = null;
  let staticSince = 0;
  let energyFps = Infinity;
  let sampleLuminance = null;
  let decodedFrame = -1;
  let framesRendered = 0;
  let lastInspection = -Infinity;
  let mediaAbort = null;
  let frameId = null;
  let frameKind = null;
  let layoutId = null;
  let layerAnimation = null;
  let discoveryId = null;
  let lastFrame = -Infinity;
  let nextFrameAt = -Infinity;
  let fresh = true;
  let projectionDirty = true;
  let hasMediaCandidates = false;
  let failures = 0;
  let visible = false;
  let stopped = false;
  let state = "waiting";
  let detail = "等待 Bilibili 播放器";
  let lastGeometry = "";
  let lastMask = "";
  let readingId = null;
  let readingProgress = 0;
  let readingTarget = 0;
  let readingFrom = 0;
  let readingStarted = 0;
  let colorFilter = "";
  const resizeObserver = new ResizeObserver(queueLayout);
  const ancestorObserver = new MutationObserver(queueLayout);

  function setState(next, message) {
    state = next;
    detail = message;
    if (host) host.dataset.state = next;
  }
  function createLayer() {
    if (host) return;
    host = document.createElement("div");
    host.id = "bili-ambient-layer";
    host.setAttribute("aria-hidden", "true");
    shade = document.createElement("div");
    shade.className = "bili-ambient-shade";
    halo = document.createElement("div");
    halo.className = "bili-ambient-halo";
    canvas = document.createElement("canvas");
    canvas.className = "bili-ambient-background";
    canvas.width = settings.quality;
    canvas.height = Math.round(settings.quality * 9 / 16);
    ctx = canvas.getContext("2d", { alpha: false });
    frame = document.createElement("canvas");
    frame.className = "bili-ambient-frame";
    frame.width = canvas.width;
    frame.height = canvas.height;
    frameCtx = frame.getContext("2d", { alpha: false });
    const probe=document.createElement("canvas");probe.width=8;probe.height=8;
    probeCtx=probe.getContext("2d",{willReadFrequently:true});
    edgeCanvas = document.createElement("canvas");
    edgeCanvas.width = canvas.width;
    edgeCanvas.height = canvas.height;
    edgeCtx = edgeCanvas.getContext("2d", { alpha: false });
    canvas.addEventListener("contextlost", (event) => {
      event.preventDefault();
      fail("图形上下文丢失，正在等待浏览器恢复");
    });
    canvas.addEventListener("contextrestored", recover);
    halo.append(edgeCanvas);
    host.append(frame, canvas);
    renderer = new globalThis.BiliAmbientRenderer(host, recover);
    host.append(halo, shade);
    stats = new globalThis.BiliAmbientStats(host);
  }
  function mountLayer() {
    const fullscreen = document.fullscreenElement;
    if (fullscreen === video || (fullscreen && !fullscreen.contains(video))) return false;
    const parent = fullscreen || document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    return true;
  }
  function cancelFrame() {
    if (frameId === null) return;
    if (frameKind === "video") video?.cancelVideoFrameCallback?.(frameId);
    else cancelAnimationFrame(frameId);
    frameId = null;
    frameKind = null;
  }
  function setLayerVisible(show, immediate = false) {
    if (!host) return;
    if (!immediate && host.dataset.visible === String(show)) return;
    const displayed = host.dataset.visible === "true" || host.hasAttribute("data-transition");
    const opacity = displayed ? Number(getComputedStyle(host).opacity) : 0;
    layerAnimation?.cancel();
    layerAnimation = null;
    host.dataset.visible = String(show);
    host.removeAttribute("data-transition");
    if (immediate || matchMedia("(prefers-reduced-motion: reduce)").matches || (!show && !displayed)) {
      if (show) site.hide();
      return;
    }
    host.setAttribute("data-transition", "");
    const animation = host.animate([{ opacity }, { opacity: show ? 1 : 0 }], { duration: 220, easing: "ease-out" });
    layerAnimation = animation;
    animation.finished.then(() => {
      if (layerAnimation !== animation) return;
      layerAnimation = null;
      host.removeAttribute("data-transition");
      if (show && visible) site.hide();
    }).catch(() => {});
  }
  function hide(next, message) {
    visible = false;
    cancelReading();
    setLayerVisible(false, true);
    theme.disable();
    site.hide();
    site.disableSurfaces();
    videoEffects.suspend();
    stats?.suspend();
    cancelFrame();
    setState(next, message);
  }
  function showSite() {
    if (!settings.siteThemeEnabled) return hide("waiting", "等待 Bilibili 播放器");
    if (!video && state === "site" && theme.enabled && theme.settings === settings && site.host?.isConnected) return;
    visible = false;
    cancelReading();
    setLayerVisible(false);
    cancelFrame();
    videoEffects.suspend();
    stats?.suspend();
    theme.apply(settings);
    theme.setPlayer(null);
    mode = "SMALL";
    document.documentElement.removeAttribute("data-bili-ambient-view");
    site.enableSurfaces();
    site.show(settings, theme);
    menu.attach(video, window === window.top);
    menu.setSettings(settings);
    setState("site", "全站主题已启用");
  }
  function fail(message) {
    failures = 3;
    hide("error", message);
  }
  function cancelReading() {
    if (readingId !== null) cancelAnimationFrame(readingId);
    readingId = null;
  }
  function backgroundBlur() { return settings.blur + settings.readingBlur * readingProgress; }
  function paintReading() {
    if (!canvas || !viewport) return;
    canvas.style.filter = `blur(${backgroundBlur()}px) ${colorFilter}`;
    if (renderer.available(settings)) renderer.reblur(backgroundBlur(), viewport);
  }
  function animateReading(now) {
    readingId = null;
    if (!visible || stopped || document.hidden) return;
    const t = Math.max(0, Math.min(1, (now - readingStarted) / 180));
    readingProgress = readingFrom + (readingTarget - readingFrom) * (1 - Math.pow(1 - t, 3));
    paintReading();
    if (t < 1) readingId = requestAnimationFrame(animateReading);
  }
  function updateReading(projection, floating) {
    const occlusion = (Math.min(96, innerHeight * .08) - projection.top) / Math.max(1, projection.height);
    const t = Math.max(0, Math.min(1, (occlusion - .15) / .8));
    const target = !settings.readingBlur || mode === "FULLSCREEN" || !config.isPlaybackPage(location.href) ? 0 : floating ? 1 : t * t * (3 - 2 * t);
    if (!visible || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelReading();readingProgress = readingTarget = target;paintReading();return;
    }
    if (target === readingTarget && (readingId !== null || readingProgress === target)) return;
    readingFrom = readingProgress;readingTarget = target;readingStarted = performance.now();
    if (readingId === null) readingId = requestAnimationFrame(animateReading);
  }
  function updateLayout() {
    layoutId = null;
    if (stopped) return;
    if (!settings.enabled) return hide("disabled", "氛围光已关闭");
    if (!config.isSitePage(location.href)) return hide("waiting", "等待 Bilibili 页面");
    if (!config.isPlaybackPage(location.href) && !settings.siteThemeEnabled) return hide("waiting", "等待 Bilibili 播放器");
    if (location.hostname === "player.bilibili.com" && !settings.enableInEmbed) return hide("view", "嵌入播放器光效已关闭");
    if (!video?.isConnected || (settings.prioritizePageLoadSpeed && document.readyState!=="complete")) return showSite();
    menu.attach(video);menu.setSettings(settings);
    if (document.hidden) return hide("hidden", "页面在后台，已暂停渲染");
    if (document.pictureInPictureElement === video && !settings.enableInPictureInPicture) return hide("pip", "画中画期间已暂停氛围光");
    const nextSource=findSource(video);
    if(mediaSource!==nextSource){
      cancelFrame();mediaSource=nextSource;fresh=true;detector.reset();lastInspection=-Infinity;crop={...globalThis.BiliAmbientProjection.fullFrame};sampleLuminance=null;
    }
    if(mediaSource!==video && !settings.enableInVRVideos)return hide("view","VR 画面光效已关闭");
    mode = document.fullscreenElement || video.closest(".bpx-state-web,.video-state-webfullscreen") ? "FULLSCREEN" : video.closest(".bpx-state-wide,.video-state-theater") ? "THEATER" : "SMALL";
    if (!config.viewAllowed(mode, settings.enableInViews)) return hide("view", "当前视图光效已关闭");
    const rect = mediaSource.getBoundingClientRect();
    const style = getComputedStyle(mediaSource);
    isHDR=settings.hdrMode===1 || (settings.hdrMode===0 && (document.documentElement.hasAttribute("data-video-hdr") || /HDR|杜比视界|DOLBY\s*VISION/i.test(video.closest(".bpx-player-container,.bilibili-player")?.querySelector(".bpx-player-ctrl-quality-result,.bilibili-player-video-btn-quality")?.textContent || "")));
    const playerVisible = rect.width >= 100 && rect.height >= 60 && rect.top < innerHeight && rect.left < innerWidth && rect.top + rect.height > 0 && rect.left + rect.width > 0 && style.visibility !== "hidden" && style.display !== "none";
    const playerContainer = video.closest(".bpx-player-container,.bilibili-player");
    const floating = !document.fullscreenElement && rect.width <= 480 && rect.height <= 300 && playerContainer && getComputedStyle(playerContainer).position === "fixed";
    if (!config.isPlaybackPage(location.href) && (!settings.siteVideoPreviews || !playerVisible || video.paused || video.ended)) return showSite();
    createLayer();
    if (!mountLayer()) return hide("fullscreen", "原生视频全屏，等待退出全屏");
    if (failures >= 3 || !ctx || !edgeCtx || !frameCtx) return hide("error", "无法绘制视频画面，可关闭再开启氛围光重试");
    if (video.readyState < 2 || !video.videoWidth) return showSite();
    theme.apply(settings);
    site.enableSurfaces();
    theme.setPlayer(video);
    videoEffects.attach(video,mediaSource);
    if (document.documentElement.dataset.biliAmbientView !== mode) document.documentElement.dataset.biliAmbientView = mode;
    document.documentElement.style.setProperty("--bili-ambient-video-scale", String(settings[`videoScale.${mode}`] / 100));

    // Object-fit bounds align the projection with the decoded picture, including letterboxing.
    const sourceWidth=mediaSource.videoWidth || mediaSource.width, sourceHeight=mediaSource.videoHeight || mediaSource.height;
    const projection = config.fitRect(rect, sourceWidth, sourceHeight, style.objectFit);
    // Scrolling changes the local halo, while the page projection keeps its viewport anchor.
    const nextAnchorKey = [rect.width, rect.height, sourceWidth, sourceHeight, innerWidth, innerHeight, Boolean(document.fullscreenElement)].join(",");
    if (!anchor || (!floating && (anchorKey !== nextAnchorKey || !settings.fixedPosition))) {
      anchor = { left: projection.left, top: projection.top, width: projection.width, height: projection.height };
      if (!playerVisible) {
        anchor.left = (innerWidth - projection.width) / 2;
        anchor.top = (innerHeight - projection.height) / 2;
      }
      anchorKey = nextAnchorKey;
      lastInspection = -Infinity;
      projectionDirty = true;
    }
    const width = projection.width;
    const height = projection.height;
    const spread = settings.spread;
    const outerWidth = width + spread * 2;
    const outerHeight = height + spread * 2;
    const geometry = [projection.left, projection.top, width, height, spread, innerWidth, innerHeight, rect.left, rect.top, rect.width, rect.height].map(n => Math.round(n * 10) / 10).join(",");
    if (geometry !== lastGeometry) {
      Object.assign(halo.style, {
        left: "0px", top: "0px", transform: `translate3d(${projection.left - spread}px,${projection.top - spread}px,0)`,
        width: `${outerWidth}px`, height: `${outerHeight}px`
      });
      edgeCanvas.style.setProperty("--fade-x", `${spread / outerWidth * 100}%`);
      edgeCanvas.style.setProperty("--fade-y", `${spread / outerHeight * 100}%`);
      lastGeometry = geometry;
    }
    // Overscan keeps blur from exposing an unpainted band at the viewport boundary.
    const bleed = (settings.blur + settings.readingBlur) * 3;
    viewport = { left: -bleed, top: -bleed, width: innerWidth + bleed * 2, height: innerHeight + bleed * 2 };
    const brightness=Math.max(0,settings.brightness+(isHDR?settings.hdrBrightness-100:0)),contrast=Math.max(0,settings.contrast+(isHDR?settings.hdrContrast-100:0)),saturation=Math.max(0,settings.saturation+(isHDR?settings.hdrSaturation-100:0));
    effectBrightness=brightness;effectContrast=contrast;
    colorFilter = `saturate(${saturation}%) brightness(${brightness}%) contrast(${contrast}%)`;
    const backgroundStyle = {
      left: `${-bleed}px`, top: `${-bleed}px`,
      width: `${innerWidth + bleed * 2}px`, height: `${innerHeight + bleed * 2}px`,
      filter: colorFilter
    };
    Object.assign(canvas.style, backgroundStyle);
    Object.assign(renderer.canvas.style, backgroundStyle);
    updateReading(projection, floating);
    canvas.style.filter = `blur(${backgroundBlur()}px) ${colorFilter}`;
    host.style.setProperty("--bili-ambient-base", `rgb(${Array(3).fill(Math.round(settings.pageBackgroundGreyness*2.55)).join(",")})`);
    edgeCanvas.style.filter = `blur(${Math.max(0, settings.blur * .6)}px) saturate(${saturation}%) contrast(${contrast}%)`;
    const maskKey=[width,height,spread,settings.spreadFadeStart,settings.spreadFadeCurve,settings.directionTopEnabled,settings.directionRightEnabled,settings.directionBottomEnabled,settings.directionLeftEnabled].join(",");
    if(lastMask!==maskKey){
      const gradient=(size,first,last,direction)=>{
        const stops=[], fraction=spread/size*100, start=settings.spreadFadeStart/100, power=16/(settings.spreadFadeCurve*.64);
        for(let i=0;i<=16;i++){const t=i/16, alpha=1-Math.pow(Math.max(0,Math.min(1,(1-t-start)/Math.max(.0001,1-start))),power);stops.push(`rgba(0,0,0,${first?alpha:0}) ${t*fraction}%`);}
        for(let i=16;i>=0;i--){const t=i/16, alpha=1-Math.pow(Math.max(0,Math.min(1,(1-t-start)/Math.max(.0001,1-start))),power);stops.push(`rgba(0,0,0,${last?alpha:0}) ${100-t*fraction}%`);}
        return `linear-gradient(to ${direction},${stops.join(",")})`;
      };
      const mask=`${gradient(outerWidth,settings.directionLeftEnabled,settings.directionRightEnabled,"right")},${gradient(outerHeight,settings.directionTopEnabled,settings.directionBottomEnabled,"bottom")}`;
      edgeCanvas.style.maskImage=mask;lastMask=maskKey;
    }
    halo.style.opacity = String(.14 * brightness / 100);
    halo.style.display = playerVisible && !floating ? "block" : "none";
    shade.style.opacity = String(settings.dim / 100);
    shade.style.backgroundColor=`rgb(${Array(3).fill(Math.round(settings.pageBackgroundGreyness*2.55)).join(",")})`;
    const aspect = sourceWidth / sourceHeight;
    const quality=settings.quality*settings.resolution/100;
    const rasterWidth = Math.max(32, Math.round(quality * Math.min(1, aspect)));
    const rasterHeight = Math.max(32, Math.round(quality * Math.min(1, 1 / aspect)));
    if (frame.width !== rasterWidth || frame.height !== rasterHeight) {
      frame.width = rasterWidth;
      frame.height = rasterHeight;
      edgeCanvas.width = rasterWidth;
      edgeCanvas.height = rasterHeight;
      fresh = true;
      crop = { ...globalThis.BiliAmbientProjection.fullFrame };
      detector.reset();
      lastInspection = -Infinity;
    }
    const backgroundWidth = Math.max(32,Math.round(quality * Math.min(1, viewport.width / viewport.height)));
    const backgroundHeight = Math.max(32,Math.round(quality * Math.min(1, viewport.height / viewport.width)));
    if (canvas.width !== backgroundWidth || canvas.height !== backgroundHeight) {
      canvas.width = backgroundWidth;
      canvas.height = backgroundHeight;
      projectionDirty = true;
    }
    const wasVisible = visible;
    visible = true;
    if (!wasVisible) site.show(settings);
    setState(video.paused || video.ended ? "paused" : "active", video.paused || video.ended ? "已连接 · 保留暂停画面的背景" : "已连接 · 页面背景随画面变化");
    if (!wasVisible || fresh || projectionDirty) draw(performance.now(), true);
    if (visible) setLayerVisible(true);
    if ((video.paused || video.ended) && mediaSource===video) cancelFrame();
    scheduleFrame();
  }
  function queueLayout() {
    if (!stopped && layoutId === null) layoutId = requestAnimationFrame(updateLayout);
  }
  function draw(now, force = false) {
    if (!visible || !ctx || video.readyState < 2) return;
    if (!force && now < nextFrameAt - 1) return;
    try {
      const drawStart = performance.now();
      // The frame buffer remains drawable even when cross-origin media prevents inspection.
      const elapsed = Math.min(250, Math.max(1, now - lastFrame));
      const retention = settings.smoothing / 100;
      const fading = settings.frameFading ? 1 - Math.exp(-elapsed / (settings.frameFading / 3)) : 1;
      frameCtx.globalAlpha = fresh ? 1 : Math.min(retention === 0 ? 1 : 1 - Math.pow(retention, elapsed / (1000 / 24)), fading);
      if (!fresh && settings.flickerReduction && crop.readable) {
        probeCtx.drawImage(mediaSource,0,0,8,8);
        try {
          const pixels=probeCtx.getImageData(0,0,8,8).data;
          const luminance=pixels.reduce((sum,value,index)=>sum+(index%4===3?0:value),0)/(64*3*255);
          if(sampleLuminance===null){
            const previous=frameCtx.getImageData(0,0,frame.width,frame.height).data;
            sampleLuminance=previous.reduce((sum,value,index)=>sum+(index%4===3?0:value),0)/(frame.width*frame.height*3*255);
          }
          if(sampleLuminance!==null){const maxChange=.01+(1-settings.flickerReduction/100)*.3;frameCtx.globalAlpha=Math.min(frameCtx.globalAlpha,maxChange/Math.max(.001,Math.abs(luminance-sampleLuminance)));}
          sampleLuminance=sampleLuminance===null?luminance:sampleLuminance+(luminance-sampleLuminance)*frameCtx.globalAlpha;
        } catch { sampleLuminance=null; }
      }
      const frameAlpha=frameCtx.globalAlpha;
      const sourceFrame=settings.frameBlending?blender.sample(mediaSource,frame.width,frame.height,now,settings.frameBlendingSmoothness,fresh):mediaSource;
      frameCtx.drawImage(sourceFrame, 0, 0, frame.width, frame.height);
      frameCtx.globalAlpha = 1;
      const inspect = fresh || now - lastInspection >= 250;
      if (inspect) {
        crop = detector.detect(frameCtx,settings);
        lastInspection = now;
        if(settings.energySaver && crop.readable){
          const pixels=frameCtx.getImageData(0,0,frame.width,frame.height).data;
          let difference=0,count=0;
          if(previousPixels?.length===pixels.length)for(let i=0;i<pixels.length;i+=Math.max(4,Math.floor(pixels.length/256/4)*4)){difference+=Math.abs(pixels[i]-previousPixels[i])+Math.abs(pixels[i+1]-previousPixels[i+1])+Math.abs(pixels[i+2]-previousPixels[i+2]);count+=3;}
          const change=count?difference/count/255:1;
          if(change>.0175)staticSince=now;
          energyFps=now-staticSince>2000?(change<.002?.2:1):Infinity;
          previousPixels=new Uint8ClampedArray(pixels);
        } else energyFps=Infinity;
      }
      const projected=inspect || force || !renderer.available(settings);
      if(projected)globalThis.BiliAmbientProjection.extendFrame(ctx, frame, anchor, viewport, crop, settings);
      if (inspect && crop.readable) {
        site.remember(frameCtx, now, crop);
        const luminance=globalThis.BiliAmbientProjection.surroundingLuminance(ctx,anchor,viewport);
        const adjusted=Math.max(0,Math.min(1,(luminance*effectBrightness/100-.5)*effectContrast/100+.5));
        theme.setLuminance(adjusted*(1-settings.dim/100)+settings.pageBackgroundGreyness/100*settings.dim/100);
      }
      rendererName = renderer.draw(frame,canvas,crop,anchor,viewport,settings,now,backgroundBlur(),frameAlpha===1 && !settings.frameBlending?mediaSource:null) ? "WebGL" : "Canvas 2D";
      canvas.style.visibility = rendererName === "WebGL" ? "hidden" : "visible";
      if(rendererName === "Canvas 2D"){
        if(!projected)globalThis.BiliAmbientProjection.extendFrame(ctx, frame, anchor, viewport, crop, settings);
        globalThis.BiliAmbientProjection.fallbackFilters(ctx,anchor,viewport,settings,now);
      }
      host.dataset.renderer = rendererName;
      if(settings.detectVideoFillScaleEnabled || settings.horizontalBarsClipPercentage || settings.verticalBarsClipPercentage){
        const clip=`inset(${crop.y*100}% ${(1-crop.x-crop.width)*100}% ${(1-crop.y-crop.height)*100}% ${crop.x*100}%)`;
        const fill=String(settings.detectVideoFillScaleEnabled?Math.min(5,Math.max(1/crop.width,1/crop.height)):1);
        if(video.style.getPropertyValue("--bili-ambient-video-clip")!==clip)video.style.setProperty("--bili-ambient-video-clip",clip);
        if(video.style.getPropertyValue("--bili-ambient-video-fill")!==fill)video.style.setProperty("--bili-ambient-video-fill",fill);
      }else{video.style.removeProperty("--bili-ambient-video-clip");video.style.removeProperty("--bili-ambient-video-fill");}
      edgeCtx.drawImage(frame, frame.width * crop.x, frame.height * crop.y, frame.width * crop.width, frame.height * crop.height, 0, 0, edgeCanvas.width, edgeCanvas.height);
      globalThis.BiliAmbientProjection.fallbackFilters(edgeCtx,{left:0,top:0,width:edgeCanvas.width,height:edgeCanvas.height},{left:0,top:0,width:edgeCanvas.width,height:edgeCanvas.height},settings,now);
      videoEffects.draw(settings,frameAlpha,now,host);
      fresh = false;
      projectionDirty = false;
      failures = 0;
      lastFrame = now;
      framesRendered++;
      stats.draw(now,performance.now()-drawStart,frame,rendererName === "WebGL" ? renderer.canvas : canvas,crop,settings,rendererName,video);
      // Preserve the sampling deadline when source FPS is not a multiple of the cap.
      const interval = 1000 / Math.min(settings.fps || Infinity, energyFps);
      nextFrameAt = force || !Number.isFinite(nextFrameAt) ? now + interval : Math.max(now, nextFrameAt + interval);
    } catch (error) {
      failures += 1;
      if (error.name === "SecurityError" || failures >= 3) {
        fail("浏览器无法绘制此视频，可切换视频或关闭再开启氛围光");
      }
    }
  }
  function onFrame(now) {
    frameId = null;
    frameKind = null;
    if (!video?.isConnected) { discover(); return; }
    if (!visible || !settings.enabled || document.hidden || ((video.paused || video.ended) && mediaSource===video)) return;
    if(settings.frameSync===0 && !settings.frameBlending && mediaSource===video){const decoded=video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime;if(decoded===decodedFrame){scheduleFrame();return;}decodedFrame=decoded;}
    draw(now);
    scheduleFrame();
  }
  function scheduleFrame() {
    if (frameId !== null || !visible || !settings.enabled || document.hidden || ((video.paused || video.ended) && mediaSource===video)) return;
    if (settings.frameSync===2 && !settings.frameBlending && mediaSource===video && typeof video.requestVideoFrameCallback === "function") {
      frameKind = "video";
      frameId = video.requestVideoFrameCallback(onFrame);
    } else {
      frameKind = "animation";
      frameId = requestAnimationFrame(onFrame);
    }
  }
  function recover() {
    renderer?.retry();
    failures = 0;
    fresh = true;
    lastFrame = -Infinity;
    nextFrameAt = -Infinity;
    detector.reset();
    previousPixels=null;staticSince=performance.now();energyFps=Infinity;sampleLuminance=null;decodedFrame=-1;
    queueLayout();
  }
  function detachVideo() {
    site.save();
    cancelFrame();
    cancelReading();readingProgress = readingTarget = 0;
    mediaAbort?.abort();
    mediaAbort = null;
    resizeObserver.disconnect();
    ancestorObserver.disconnect();
    videoEffects.detach();
    video?.style.removeProperty("--bili-ambient-video-clip");
    video?.style.removeProperty("--bili-ambient-video-fill");
    video = null;
    mediaSource = null;
    theme.setPlayer(null);
    menu.attach(null);
    fresh = true;
    lastGeometry = "";
    anchorKey = "";
    anchor = null;
    crop = { ...globalThis.BiliAmbientProjection.fullFrame };
    lastInspection = -Infinity;
    detector.reset();
    if (frame) frame.width = frame.width;
  }
  function attachVideo(next) {
    detachVideo();
    resetClips();
    video = next;
    renderer?.retry();
    failures = 0;
    lastFrame = -Infinity;
    nextFrameAt = -Infinity;
    mediaAbort = new AbortController();
    const options = { signal: mediaAbort.signal };
    for (const event of ["play", "playing", "pause", "ended", "seeked", "loadeddata", "resize", "enterpictureinpicture", "leavepictureinpicture"]) {
      video.addEventListener(event, queueLayout, options);
    }
    for (const event of ["pause", "ended"]) video.addEventListener(event, () => { projectionDirty = true; }, options);
    for (const event of ["emptied", "loadstart"]) video.addEventListener(event, () => { resetClips(); recover(); }, options);
    for(const event of ["seeking","seeked"])video.addEventListener(event,recover,options);
    video.addEventListener("loadeddata",()=>renderer?.retry(),options);
    video.addEventListener("error", () => hide("waiting", "等待播放器恢复视频"), options);
    video.addEventListener("timeupdate", () => { if (video.paused) queueLayout(); }, options);
    resizeObserver.observe(video);
    for (let ancestor = video.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      ancestorObserver.observe(ancestor, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
    }
    ancestorObserver.observe(video, { attributes: true, attributeFilter: ["class", "style", "hidden", "src"] });
    queueLayout();
  }
  function resetClips() {
    if(settings.horizontalBarsClipPercentageReset && (settings.horizontalBarsClipPercentage || settings.verticalBarsClipPercentage)){
      settings.horizontalBarsClipPercentage=0;settings.verticalBarsClipPercentage=0;
      api.storage.local.set({horizontalBarsClipPercentage:0,verticalBarsClipPercentage:0}).catch(()=>setState("error","画面裁切设置未能保存"));
    }
  }
  function discover() {
    discoveryId = null;
    if (stopped) return;
    const playback = config.isPlaybackPage(location.href);
    if (!config.isSitePage(location.href) || (!playback && !settings.siteThemeEnabled)) {
      detachVideo();
      hide("waiting", "打开 Bilibili 视频或番剧播放页");
      menu.attach(null, config.isSitePage(location.href) && window === window.top);
      menu.setSettings(settings);
      return;
    }
    const preferred = new Set(document.querySelectorAll(videoSelector));
    const candidates = [...document.querySelectorAll("video")];
    hasMediaCandidates = candidates.length > 0;
    const next = candidates.filter(v => {
      const source=findSource(v), r = source.getBoundingClientRect();
      const s = getComputedStyle(source);
      const inView = r.top < innerHeight && r.left < innerWidth && r.bottom > 0 && r.right > 0;
      return r.width >= 100 && r.height >= 60 && s.display !== "none" && s.visibility !== "hidden" && (playback || (settings.siteVideoPreviews && inView && !v.paused && !v.ended && v.readyState >= 2));
    }).sort((a, b) => {
      const score = v => { const r = v.getBoundingClientRect(); return r.width * r.height + (!v.paused ? 1000000 : 0) + (preferred.has(v) ? 2000000 : 0); };
      return score(b) - score(a);
    })[0] || (playback && video?.isConnected ? video : null);
    if (next !== video) {
      if (next) attachVideo(next);
      else { detachVideo(); queueLayout(); }
    } else queueLayout();
    menu.attach(video, window === window.top);menu.setSettings(settings);
  }
  function findSource(v) {
    const canvases=v.closest(".bpx-player-container,.bilibili-player,#bilibili-player,#bofqi")?.querySelectorAll(".bpx-player-video-wrap canvas:not(.bili-ambient-video-sync),.bilibili-player-video-wrap canvas:not(.bili-ambient-video-sync)") || [];
    return [...canvases].find(c=>c.width>0 && c.height>0 && c.getBoundingClientRect().width>=100 && getComputedStyle(c).visibility!=="hidden") || v;
  }
  function queueDiscovery() {
    if (!stopped && discoveryId === null) discoveryId = setTimeout(discover, 120);
  }
  const domObserver = new MutationObserver(records => {
    if (video && !video.isConnected) { queueDiscovery(); return; }
    if (host && !host.isConnected && video) { queueLayout(); return; }
    for (const record of records) {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.some(node => node.nodeType === 1 && (node.matches("video,canvas:not(.bili-ambient-video-sync):not(.bili-ambient-output):not(.bili-ambient-background):not(.bili-ambient-frame)") || node.querySelector("video")))) {
        queueDiscovery();
        return;
      }
    }
  });
  function onSettingsChanged(changes, area) {
    if (area !== "local") return;
    if ("sitePalette" in changes) {
      site.accept(changes.sitePalette.newValue);
      if (state === "site") site.show(settings, theme);
    }
    const patch = {};
    for (const key of Object.keys(config.defaults)) if (key in changes) patch[key] = changes[key].newValue ?? config.defaults[key];
    if (!Object.keys(patch).length) return;
    const previouslyEnabled = settings.enabled;
    settings = config.normalize({ ...settings, ...patch });
    nextFrameAt = -Infinity;
    projectionDirty = true;
    blender.reset();
    menu.setSettings(settings);
    cancelFrame();
    detector.reset();
    energyFps=Infinity;staticSince=performance.now();previousPixels=null;
    lastInspection = -Infinity;
    if (!previouslyEnabled && settings.enabled) recover();
    if (!settings.enabled) hide("disabled", "氛围光已关闭");
    if ("siteThemeEnabled" in patch || "siteVideoPreviews" in patch) queueDiscovery();
    queueLayout();
  }
  const onMessage = (message, _sender, sendResponse) => {
    if (message?.type === "bili-ambient:status") {
      sendResponse({ state, detail, connected: Boolean(video?.isConnected), settings, renderer:rendererName, crop, mode, framesRendered, framerateLimit:Math.min(settings.fps||Infinity,energyFps), hdr:isHDR, vr:mediaSource!==video, videoOverlay:videoEffects.active });
    }
  };
  api.runtime.onMessage.addListener(onMessage);
  api.storage.onChanged.addListener(onSettingsChanged);
  const lifecycle = new AbortController();
  const eventOptions = { signal: lifecycle.signal };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hide("hidden", "页面在后台，已暂停渲染");
    else { queueDiscovery(); queueLayout(); }
  }, eventOptions);
  document.addEventListener("fullscreenchange", queueLayout, eventOptions);
  window.addEventListener("resize", queueLayout, { ...eventOptions, passive: true });
  window.addEventListener("scroll", () => {
    if (!settings.enabled) return;
    if (video?.isConnected) queueLayout();
    if (hasMediaCandidates && !config.isPlaybackPage(location.href)) queueDiscovery();
  }, { ...eventOptions, passive: true, capture: true });
  for (const event of ["playing", "loadeddata", "pause", "ended"]) document.addEventListener(event, queueDiscovery, { ...eventOptions, capture: true });
  window.addEventListener("popstate", queueDiscovery, eventOptions);
  window.addEventListener("hashchange", queueDiscovery, eventOptions);
  window.navigation?.addEventListener("navigate", queueDiscovery, eventOptions);
  window.addEventListener("pageshow", queueDiscovery, eventOptions);
  window.addEventListener("load", queueDiscovery, eventOptions);
  window.addEventListener("pagehide", () => site.save(), eventOptions);
  document.addEventListener("keydown", event => {
    if(event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.composedPath().some(node=>node instanceof Element && (node.matches("input,textarea,select") || node.isContentEditable)))return;
    const key=event.key.toUpperCase();
    for(const name of ["enabled","detectHorizontalBarSizeEnabled","detectVerticalBarSizeEnabled","detectVideoFillScaleEnabled"]){
      if(settings[`${name}Key`] && key===settings[`${name}Key`]){api.storage.local.set({[name]:!settings[name]});event.preventDefault();event.stopImmediatePropagation();break;}
    }
  },{...eventOptions,capture:true});
  // Bilibili uses pushState for in-page navigation, which does not emit popstate.
  let lastUrl = location.href;
  const routeTimer = setInterval(() => {
    if (!document.hidden) theme.refreshComments();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      failures = 0;
      fresh = true;
      queueDiscovery();
    } else if (!video && config.isPlaybackPage(location.href)) queueDiscovery();
  }, 1000);
  globalThis.__biliAmbientController = {
    status: () => ({ state, detail, connected: Boolean(video?.isConnected), renderer:rendererName, crop, mode }),
    dispose() {
      stopped = true;
      detachVideo();
      domObserver.disconnect();
      lifecycle.abort();
      theme.dispose();
      site.dispose();
      menu.dispose();
      renderer?.dispose();
      stats?.dispose();
      layerAnimation?.cancel();
      clearInterval(routeTimer);
      clearTimeout(discoveryId);
      if (layoutId !== null) cancelAnimationFrame(layoutId);
      host?.remove();
      api.storage.onChanged.removeListener(onSettingsChanged);
      api.runtime.onMessage.removeListener(onMessage);
      delete globalThis.__biliAmbientController;
    }
  };
  Promise.all([config.load(api.storage.local), site.load()]).then(([values]) => {
    if (stopped) return;
    settings = config.normalize(values);
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
    discover();
  }).catch(() => fail("扩展设置读取失败，请刷新页面"));
})();
