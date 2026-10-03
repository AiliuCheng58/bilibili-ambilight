(() => {
  "use strict";
  const attribute = "data-bili-ambient";
  const variables = ["--bili-ambient-glass", "--bili-ambient-glass-blur", "--bili-ambient-header-glass", "--bili-ambient-header-images", "--bili-ambient-content-images", "--bili-ambient-header-shadow", "--bili-ambient-content-shadow", "--bili-ambient-video-shadow", "--bili-ambient-video-scale"];
  const shadowCss = `
    :host-context(html[${attribute}]) {
      --bg1: transparent !important;
      --bg2: rgba(255,255,255,.07) !important;
      --bg3: rgba(255,255,255,.1) !important;
      --text1: var(--bili-ambient-text1,#f4f5f8) !important;
      --text2: var(--bili-ambient-text2,#ced2dd) !important;
      --text3: var(--bili-ambient-text3,#aab2c3) !important;
      --text4: var(--bili-ambient-text1,#f4f5f8) !important;
      --line_regular: rgba(255,255,255,.16) !important;
      --line_light: rgba(255,255,255,.1) !important;
      --graph_bg_thin: rgba(255,255,255,.07) !important;
      --graph_bg_regular: rgba(255,255,255,.1) !important;
      --graph_bg_thick: rgba(255,255,255,.16) !important;
      color: var(--text1) !important;
      color-scheme: dark;
    }
    :host-context(html[${attribute}]) :is(#title,#content,#header,#footer,#body,#replies,#contents,#comment,#reply) {
      background-color: transparent !important;
      color: var(--text1) !important;
    }
    :host-context(html[${attribute}]) :is(textarea,[contenteditable="true"],#input) {
      background: rgba(14,17,24,var(--bili-ambient-glass,.08)) !important;
      color: var(--text1) !important;
      border-color: rgba(255,255,255,.16) !important;
    }
    :host-context(html[${attribute}]) img { opacity: var(--bili-ambient-content-images,1) !important; }
    :host-context(html[data-bili-ambient-tone="light"]) { color-scheme: light; }
  `;
  class PageTheme {
    constructor() {
      this.enabled = false;
      this.player = null;
      this.roots = new Map();
      this.pendingHosts = new Set();
      this.tone = "dark";
      this.luminance = 0;
      this.theme = 0;
    }
    apply(settings) {
      if (this.enabled && this.settings === settings) return;
      this.settings = settings;
      const wasEnabled = this.enabled;
      this.enabled = true;
      const root = document.documentElement;
      root.setAttribute(attribute, "");
      root.dataset.biliAmbientTone = this.tone;
      root.style.setProperty(variables[0], String(settings.glassOpacity / 100));
      root.style.setProperty(variables[1], `${settings.glassBlur}px`);
      root.style.setProperty(variables[2], String(settings.headerFillOpacity / 100));
      root.style.setProperty(variables[3], String(settings.headerImagesOpacity / 100));
      root.style.setProperty(variables[4], String(settings.surroundingContentImagesOpacity / 100));
      root.style.setProperty(variables[5], `0 0 ${settings.headerShadowSize}px rgba(0,0,0,${settings.headerShadowOpacity/100})`);
      root.style.setProperty(variables[6], `0 0 ${settings.surroundingContentShadowSize}px rgba(0,0,0,${settings.surroundingContentShadowOpacity/100})`);
      root.style.setProperty(variables[7], `0 0 ${settings.videoShadowSize}px rgba(0,0,0,${settings.videoShadowSize?settings.videoShadowOpacity/100:0})`);
      root.toggleAttribute("data-bili-ambient-related-scroll", settings.relatedScrollbar);
      root.toggleAttribute("data-bili-ambient-hide-scrollbar", settings.hideScrollbar);
      root.toggleAttribute("data-bili-ambient-immersive", settings.immersiveTheaterView);
      root.toggleAttribute("data-bili-ambient-layout", settings.layoutPerformanceImprovements);
      root.toggleAttribute("data-bili-ambient-panel-shadow", !settings.surroundingContentTextAndBtnOnly);
      this.theme=settings.theme;
      this.setLuminance(this.luminance);
      if (!wasEnabled) this.refreshComments(true);
    }
    setLuminance(value) {
      this.luminance=value;
      const next = this.theme===-1 ? "light" : this.theme===1 ? "dark" : value > (this.tone === "light" ? .58 : .7) ? "light" : "dark";
      if (next === this.tone) return;
      this.tone = next;
      if (this.enabled) document.documentElement.dataset.biliAmbientTone = next;
    }
    setPlayer(video) {
      const next = video?.closest(".bpx-player-container, .bilibili-player, #bilibili-player, #bilibiliPlayer, #bofqi, .live-player-mounter") || video?.parentElement || null;
      if (next === this.player) return;
      this.player?.classList.remove("bili-ambient-player");
      this.player = next;
      this.player?.classList.add("bili-ambient-player");
    }
    refreshComments(rescan = false) {
      if (!this.enabled) return;
      for (const [root, record] of this.roots) {
        if (!root.host.isConnected) {
          record.observer.disconnect();
          record.style.remove();
          this.roots.delete(root);
        } else if (rescan) this.scan(root);
      }
      for (const host of document.querySelectorAll("bili-comments")) this.visit(host);
      for (const host of this.pendingHosts) {
        if (!host.isConnected) this.pendingHosts.delete(host);
        else this.visit(host);
      }
    }
    scan(root) {
      for (const element of root.querySelectorAll("*")) {
        if (element.tagName.startsWith("BILI-")) this.visit(element);
      }
    }
    visit(host) {
      const root = host.shadowRoot;
      if (!root) { this.pendingHosts.add(host); return; }
      this.pendingHosts.delete(host);
      if (this.roots.has(root)) return;
      const style = document.createElement("style");
      style.dataset.biliAmbientTheme = "";
      style.textContent = shadowCss;
      root.append(style);
      const observer = new MutationObserver(records => {
        if (!this.enabled) return;
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName.startsWith("BILI-")) this.visit(node);
          this.scan(node);
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      this.roots.set(root, { style, observer });
      this.scan(root);
    }
    disable() {
      this.enabled = false;
      document.documentElement.removeAttribute(attribute);
      document.documentElement.removeAttribute("data-bili-ambient-tone");
      for(const suffix of ["view","related-scroll","hide-scrollbar","immersive","layout","panel-shadow"])document.documentElement.removeAttribute(`data-bili-ambient-${suffix}`);
      for (const variable of variables) document.documentElement.style.removeProperty(variable);
    }
    dispose() {
      this.disable();
      this.player?.classList.remove("bili-ambient-player");
      for (const { observer, style } of this.roots.values()) {
        observer.disconnect();
        style.remove();
      }
      this.roots.clear();
      this.pendingHosts.clear();
    }
  }
  globalThis.BiliAmbientTheme = PageTheme;
})();
