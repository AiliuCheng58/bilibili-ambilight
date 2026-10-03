(() => {
  "use strict";
  globalThis.BiliAmbientControls = [
    ["渲染与色彩", [
      ["webGL","WebGL 色彩渲染"], ["contrast","对比度","%"], ["vibrance","自然鲜艳度","%"],
      ["debandingStrength","背景去色带","%"], ["debandingBlendMode","去色带模式",[[0,"LCD"],[1,"OLED"]]],
      ["frameSync","帧同步",[[2,"视频帧"],[1,"显示帧"],[0,"已解码帧"]]], ["energySaver","静态画面省电"],
      ["resolution","渲染精度比例",[[6.25,"6.25%"],[12.5,"12.5%"],[25,"25%"],[50,"50%"],[100,"100%"],[200,"200%"],[400,"400%"]]],
      ["prioritizePageLoadSpeed","页面加载完成后启用"], ["layoutPerformanceImprovements","优化长列表渲染"]
    ]],
    ["边缘与方向", [
      ["projectionStyle","画面投影方式",[[1,"多层投影"],[0,"边缘延展"]]],
      ["edge","边缘采样宽度","%"], ["spreadFadeStart","边缘渐隐起点","%"], ["spreadFadeCurve","边缘渐隐曲线","%"],
      ["directionTopEnabled","上方光效"], ["directionRightEnabled","右方光效"],
      ["directionBottomEnabled","下方光效"], ["directionLeftEnabled","左方光效"], ["fixedPosition","滚动时固定背景"]
    ]],
    ["画面过渡", [
      ["frameFading","画面淡入时间","ms"], ["flickerReduction","闪烁抑制","%"],
      ["frameBlending","帧混合平滑运动"], ["frameBlendingSmoothness","帧混合强度","%"]
    ]],
    ["黑边与画面裁切", [
      ["detectHorizontalBarSizeEnabled","自动检测上下黑边"], ["detectVerticalBarSizeEnabled","自动检测左右黑边"],
      ["detectColoredHorizontalBarSizeEnabled","检测纯色边框"], ["detectHorizontalBarSizeOffsetPercentage","检测偏移","%"],
      ["barSizeDetectionAverageHistorySize","检测历史帧数","帧"], ["barSizeDetectionAllowedElementsPercentage","允许边框内元素","%"],
      ["barSizeDetectionAllowedUnevenBarsPercentage","允许边框不对称","%"],
      ["horizontalBarsClipPercentage","手动上下裁切","%"], ["verticalBarsClipPercentage","手动左右裁切","%"],
      ["horizontalBarsClipPercentageReset","新视频重置手动裁切"], ["detectVideoFillScaleEnabled","裁切后填满播放器"]
    ]],
    ["页面与玻璃", [
      ["siteThemeEnabled","全站玻璃主题"], ["siteVideoPreviews","视频预览实时取色"],
      ["headerFillOpacity","导航栏玻璃浓度","%"], ["headerImagesOpacity","导航栏图像透明度","%"],
      ["headerShadowSize","导航文字阴影","px"], ["headerShadowOpacity","导航阴影浓度","%"],
      ["surroundingContentImagesOpacity","内容图像透明度","%"], ["surroundingContentShadowSize","内容文字阴影","px"],
      ["surroundingContentShadowOpacity","内容阴影浓度","%"], ["surroundingContentTextAndBtnOnly","阴影仅应用于文字和按钮"], ["pageBackgroundGreyness","背景灰度底色","%"],
      ["relatedScrollbar","推荐列表独立滚动"], ["hideScrollbar","隐藏页面滚动条"], ["immersiveTheaterView","宽屏沉浸模式"],
      ["theme","文字配色",[[0,"随画面明暗"],[-1,"浅色配色"],[1,"深色配色"]]]
    ]],
    ["播放器与视图", [
      ["videoScale.SMALL","普通模式画面大小","%"], ["videoScale.THEATER","宽屏模式画面大小","%"],
      ["videoScale.FULLSCREEN","全屏模式画面大小","%"], ["videoShadowSize","播放器阴影范围","px"], ["videoShadowOpacity","播放器阴影浓度","%"],
      ["enableInViews","光效启用视图",[[0,"所有模式"],[1,"普通"],[2,"普通和宽屏"],[3,"宽屏"],[4,"宽屏和全屏"],[5,"全屏"]]],
      ["enableInPictureInPicture","画中画时继续背景"], ["enableInEmbed","嵌入播放器光效"], ["enableInVRVideos","VR / 360 画面光效"],
      ["videoOverlayEnabled","同步视频与背景画面"], ["videoOverlaySyncThreshold","掉帧时关闭同步的阈值","%"], ["videoDebandingStrength","视频去色带","%"],
      ["chromiumBugVideoJitterWorkaround","高刷新率抖动修正"], ["chromiumDirectVideoOverlayWorkaround","硬件叠加层伪影修正"]
    ]],
    ["HDR 画面", [
      ["hdrMode","HDR 滤镜启用方式",[[0,"跟随播放器"],[1,"启用"],[2,"关闭"]]],
      ["hdrBrightness","HDR 背景亮度","%"], ["hdrContrast","HDR 背景对比度","%"], ["hdrSaturation","HDR 背景饱和度","%"]
    ]],
    ["性能统计", [
      ["showFPS","显示渲染帧率"], ["showFrametimes","显示帧耗时曲线"],
      ["showResolutions","显示渲染分辨率"], ["showBarDetectionStats","显示边框检测结果"]
    ]],
    ["快捷键与备份", [
      ["enabledKey","开关快捷键","key"], ["detectHorizontalBarSizeEnabledKey","上下黑边快捷键","key"],
      ["detectVerticalBarSizeEnabledKey","左右黑边快捷键","key"], ["detectVideoFillScaleEnabledKey","画面填充快捷键","key"],
      ["syncSettings","通过浏览器账号同步设置"]
    ]]
  ];
})();
