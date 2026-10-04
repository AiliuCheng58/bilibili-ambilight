(() => {
  "use strict";
  const defaults = Object.freeze({
    enabled: true,
    siteThemeEnabled: true,
    siteVideoPreviews: true,
    brightness: 125,
    spread: 100,
    blur: 42,
    saturation: 110,
    smoothing: 0,
    dim: 8,
    glassOpacity: 8,
    glassBlur: 24,
    fps: 0,
    quality: 160,
    webGL: true, contrast: 100, vibrance: 100, debandingStrength: 0, debandingBlendMode: 0,
    edge: 2.5, spreadFadeStart: 15, spreadFadeCurve: 35,
    directionTopEnabled: true, directionRightEnabled: true, directionBottomEnabled: true, directionLeftEnabled: true,
    frameFading: 0, flickerReduction: 0, frameBlending: false, frameBlendingSmoothness: 80,
    frameSync: 1, energySaver: false, fixedPosition: true, readingBlur: 120,
    detectHorizontalBarSizeEnabled: true, detectVerticalBarSizeEnabled: true, detectColoredHorizontalBarSizeEnabled: false,
    detectHorizontalBarSizeOffsetPercentage: 0, barSizeDetectionAverageHistorySize: 4,
    barSizeDetectionAllowedElementsPercentage: 20, barSizeDetectionAllowedUnevenBarsPercentage: 10,
    horizontalBarsClipPercentage: 0, verticalBarsClipPercentage: 0, horizontalBarsClipPercentageReset: true,
    detectVideoFillScaleEnabled: false,
    headerFillOpacity: 8, headerImagesOpacity: 100, headerShadowSize: 2, headerShadowOpacity: 30,
    surroundingContentImagesOpacity: 100, surroundingContentShadowSize: 6, surroundingContentShadowOpacity: 30,
    pageBackgroundGreyness: 0, relatedScrollbar: false, hideScrollbar: false, immersiveTheaterView: false,
    "videoScale.SMALL": 100, "videoScale.THEATER": 100, "videoScale.FULLSCREEN": 100,
    videoShadowSize: 0, videoShadowOpacity: 50,
    enableInViews: 0, enableInPictureInPicture: false, enableInEmbed: true, theme: 0,
    showFPS: false, showFrametimes: false, showResolutions: false, showBarDetectionStats: false,
    resolution: 100, prioritizePageLoadSpeed: true, layoutPerformanceImprovements: true,
    surroundingContentTextAndBtnOnly: true, videoOverlayEnabled: false, videoOverlaySyncThreshold: 5,
    videoDebandingStrength: 0, chromiumBugVideoJitterWorkaround: false, chromiumDirectVideoOverlayWorkaround: false,
    hdrBrightness: 100, hdrContrast: 100, hdrSaturation: 100, hdrMode: 0, enableInVRVideos: true,
    enabledKey: "G", detectHorizontalBarSizeEnabledKey: "B", detectVerticalBarSizeEnabledKey: "V", detectVideoFillScaleEnabledKey: "H",
    syncSettings: false, projectionStyle: 1
  });
  const ranges = Object.freeze({
    brightness: [0, 200], spread: [0, 800], blur: [0, 100],
    saturation: [0, 200], smoothing: [0, 95], dim: [0, 85],
    glassOpacity: [0, 100], glassBlur: [0, 40],
    fps: [0, 60], quality: [64, 640], contrast: [0,200], vibrance: [0,200], debandingStrength: [0,100], debandingBlendMode: [0,1],
    edge: [1,25,.1], spreadFadeStart: [-50,100,.1], spreadFadeCurve: [1,100],
    frameFading: [0,15000], flickerReduction: [0,100], frameBlendingSmoothness: [0,100], frameSync: [0,2], readingBlur: [0,240],
    detectHorizontalBarSizeOffsetPercentage: [-5,5,.1], barSizeDetectionAverageHistorySize: [1,30],
    barSizeDetectionAllowedElementsPercentage: [10,90], barSizeDetectionAllowedUnevenBarsPercentage: [1,50],
    horizontalBarsClipPercentage: [0,40,.1], verticalBarsClipPercentage: [0,40,.1],
    headerFillOpacity: [0,100], headerImagesOpacity: [0,100], headerShadowSize: [0,100], headerShadowOpacity: [0,100],
    surroundingContentImagesOpacity: [0,100], surroundingContentShadowSize: [0,100], surroundingContentShadowOpacity: [0,100],
    pageBackgroundGreyness: [0,100], "videoScale.SMALL": [25,200], "videoScale.THEATER": [25,200], "videoScale.FULLSCREEN": [25,200],
    videoShadowSize: [0,100], videoShadowOpacity: [0,100], enableInViews: [0,5], theme: [-1,1],
    resolution: [6.25,400,.01], videoOverlaySyncThreshold: [1,100], videoDebandingStrength: [0,100],
    hdrBrightness: [0,200], hdrContrast: [0,200], hdrSaturation: [0,200], hdrMode: [0,2], projectionStyle: [0,1]
  });
  const presets = Object.freeze({
    soft: { ...defaults },
    cinema: { ...defaults, brightness: 105, spread: 150, blur: 55, dim: 22, glassOpacity: 16 },
    eco: { ...defaults, spread: 80, fps: 12, quality: 96, glassBlur: 12 }
  });
  function normalize(input = {}) {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) if (typeof defaults[key] === "boolean" && typeof input?.[key] === "boolean") result[key] = input[key];
    for (const key of Object.keys(defaults)) if(typeof defaults[key]==="string" && typeof input?.[key]==="string" && /^[a-z0-9]?$/i.test(input[key]))result[key]=input[key].toUpperCase();
    for (const [key, [min, max, step = 1]] of Object.entries(ranges)) {
      if (typeof input?.[key] === "number" && Number.isFinite(input[key])) {
        result[key] = Number((Math.round(Math.min(max, Math.max(min, input[key])) / step) * step).toFixed(2));
      }
    }
    return result;
  }
  function isPlaybackPage(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && (
        parsed.hostname === "player.bilibili.com" ||
        (parsed.hostname === "live.bilibili.com" && /^\/(?:blanc\/)?\d+\/?$/.test(parsed.pathname)) ||
        (parsed.hostname === "www.bilibili.com" && /^\/(video|bangumi\/play|cheese\/play)\//.test(parsed.pathname))
      );
    } catch { return false; }
  }
  function isSitePage(url) {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol) && (parsed.hostname === "bilibili.com" || parsed.hostname.endsWith(".bilibili.com"));
    } catch { return false; }
  }
  function fitRect(rect, sourceWidth, sourceHeight, fit = "contain") {
    if (sourceWidth <= 0 || sourceHeight <= 0 || !["contain", "scale-down"].includes(fit)) return rect;
    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight, fit === "scale-down" ? 1 : Infinity);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  }
  async function load(storage) {
    const values = await storage.get(null);
    if (values.appearanceVersion === 4) return normalize(values);
    if (values.appearanceVersion === 3) {
      const migrated = normalize(values);
      if (values.fps === 24 && values.smoothing === 70 && values.frameSync === 2 && !values.frameBlending && !values.frameFading) {
        Object.assign(migrated, { fps: defaults.fps, smoothing: defaults.smoothing, frameSync: defaults.frameSync });
      }
      await storage.set({ ...migrated, appearanceVersion: 4 });
      return migrated;
    }
    const migrated = normalize({ enabled: values.enabled, fps: values.fps, quality: values.quality });
    await storage.set({ ...migrated, appearanceVersion: 4 });
    return migrated;
  }
  function viewAllowed(mode, selection) {
    return selection === 0 || (mode === "SMALL" && [1,2].includes(selection)) || (mode === "THEATER" && [2,3,4].includes(selection)) || (mode === "FULLSCREEN" && [4,5].includes(selection));
  }
  function readBackup(data) {
    const input=data?.settings || data;
    if(!input || typeof input!=="object" || Array.isArray(input))throw new Error("设置文件应为 JSON 对象");
    const aliases={framerateLimit:"fps",blur2:"blur",surroundingContentFillOpacity:"glassOpacity"};
    const imported={};
    for(const [name,value] of Object.entries(input)){
      const original=name.replace(/^setting-/,""),key=aliases[original] || original;
      if(key!=="syncSettings" && Object.hasOwn(defaults,key) && typeof value===typeof defaults[key])imported[key]=value;
    }
    if(!Object.keys(imported).length)throw new Error("文件中没有可用的氛围光设置");
    const normalized=normalize(imported);
    return Object.fromEntries(Object.keys(imported).map(key=>[key,normalized[key]]));
  }
  globalThis.BiliAmbientSettings = Object.freeze({ defaults, ranges, presets, normalize, isPlaybackPage, isSitePage, fitRect, load, viewAllowed, readBackup });
})();
