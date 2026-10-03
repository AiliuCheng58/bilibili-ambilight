(() => {
  "use strict";
  const paletteKey = "sitePalette";
  const defaultPalette = [[42, 94, 128], [104, 69, 133], [37, 64, 91]];
  const attributes = ["data-bili-ambient-surface", "data-bili-ambient-ink"];
  const excluded = '#bili-ambient-layer,#bili-ambient-site-backdrop,#bili-ambient-menu,.bili-ambient-settings-button,.bili-ambient-player,.bpx-player-container,.bilibili-player,.live-player-mounter,video,canvas,svg,iframe,.bili-banner,.bili-video-card__image,.cover,.pic,.picture,.avatar,.qr-code,[class*="qrcode"],[class*="captcha"],[class*="geetest"]';
  const colors = value => value?.match(/[\d.]+/g)?.map(Number) || [];
  const neutral = rgba => rgba.length >= 3 && Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3)) < 36;
  const validPalette = value => Array.isArray(value) && value.length === 3 && value.every(c => Array.isArray(c) && c.length === 3 && c.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
  class SiteTheme {
    constructor(api) {
      this.api = api;
      this.palette = defaultPalette.map(c => [...c]);
      this.lastSample = -Infinity;
      this.lastSave = -Infinity;
      this.enabled = false;
      this.marked = new Set();
      this.queue = [];
      this.pending = null;
      this.observer = new MutationObserver(records => {
        if (!this.enabled) return;
        for (const record of records) {
          if (record.target.closest?.(excluded)) continue;
          if (record.type === "attributes") this.enqueue(record.target, true);
          else for (const node of record.addedNodes) if (node.nodeType === 1) this.enqueue(node);
        }
      });
    }
    async load() {
      const saved = await this.api.storage.local.get(paletteKey);
      this.accept(saved[paletteKey]);
    }
    accept(value) {
      this.palette = validPalette(value) ? value.map(c => [...c]) : defaultPalette.map(c => [...c]);
      this.paint();
    }
    mount() {
      if (this.host) return;
      this.host = document.createElement("div");
      this.host.id = "bili-ambient-site-backdrop";
      this.host.setAttribute("aria-hidden", "true");
      this.field = document.createElement("div");
      this.field.className = "bili-ambient-site-field";
      this.shade = document.createElement("div");
      this.shade.className = "bili-ambient-site-shade";
      this.host.append(this.field, this.shade);
      document.documentElement.append(this.host);
      this.paint();
    }
    paint() {
      if (!this.field) return;
      const c = this.palette.map(rgb => `rgb(${rgb.join(",")})`);
      this.field.style.background = `radial-gradient(ellipse at 12% 20%,${c[0]},transparent 72%),radial-gradient(ellipse at 94% 38%,${c[1]},transparent 75%),radial-gradient(ellipse at 42% 110%,${c[2]},transparent 80%),${c[2]}`;
    }
    show(settings, theme) {
      this.mount();
      this.host.dataset.visible = "true";
      this.field.style.filter = `blur(${settings.blur}px) saturate(${settings.saturation}%) brightness(${settings.brightness}%) contrast(${settings.contrast}%)`;
      const grey = Math.round(settings.pageBackgroundGreyness * 2.55);
      this.shade.style.background = `rgb(${grey},${grey},${grey})`;
      this.shade.style.opacity = String(settings.dim / 100);
      const luminance = this.palette.reduce((sum, c) => sum + (c[0] * .2126 + c[1] * .7152 + c[2] * .0722) / 255, 0) / 3;
      const adjusted = Math.max(0, Math.min(1, (luminance * settings.brightness / 100 - .5) * settings.contrast / 100 + .5));
      theme.setLuminance(adjusted * (1 - settings.dim / 100) + settings.pageBackgroundGreyness / 100 * settings.dim / 100);
    }
    hide() { if (this.host) this.host.dataset.visible = "false"; }
    remember(source, now, crop) {
      if (now - this.lastSample < 2000) return;
      this.lastSample = now;
      try {
        if (!this.sampler) {
          const canvas = document.createElement("canvas");
          canvas.width = 12; canvas.height = 12;
          this.sampler = canvas.getContext("2d", { willReadFrequently: true });
        }
        const ctx = this.sampler;
        const c = crop || { x: 0, y: 0, width: 1, height: 1 };
        ctx.drawImage(source.canvas, c.x * source.canvas.width, c.y * source.canvas.height, c.width * source.canvas.width, c.height * source.canvas.height, 0, 0, 12, 12);
        const w = ctx.canvas.width, h = ctx.canvas.height;
        const patches = [[0, 0, Math.ceil(w / 4), h], [Math.floor(w * .75), 0, Math.ceil(w / 4), h], [0, Math.floor(h * .75), w, Math.ceil(h / 4)]];
        const next = patches.map(rect => {
          const pixels = ctx.getImageData(...rect).data;
          const rgb = [0, 0, 0];
          for (let i = 0; i < pixels.length; i += 4) for (let j = 0; j < 3; j++) rgb[j] += pixels[i + j];
          return rgb.map(n => Math.round(n / (pixels.length / 4)));
        });
        if (JSON.stringify(next) === JSON.stringify(this.palette)) return;
        this.palette = next;
        this.dirty = true;
        this.paint();
        if (now - this.lastSave >= 5000) {
          this.lastSave = now;
          this.save();
        }
      } catch { /* Cross-origin media keeps the last readable palette. */ }
    }
    save() {
      if (!this.dirty) return;
      this.dirty = false;
      this.api.storage.local.set({ [paletteKey]: this.palette.map(c => [...c]) }).catch(() => { this.dirty = true; });
    }
    enableSurfaces() {
      if (this.enabled) return;
      this.enabled = true;
      this.enqueue(document.body);
      this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    }
    enqueue(element, reset = false) {
      if (!element || element.closest(excluded)) return;
      if (reset) for (const attribute of attributes) element.removeAttribute(attribute);
      // Coalesce nested changes and inspect bounded batches outside the video frame loop.
      if (!this.queue.some(item => item.root.contains(element) && (!reset || item.reset))) this.queue.push({ root: element, walker: document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT), first: true, reset });
      if (this.pending === null) this.pending = setTimeout(() => this.flush(), 60);
    }
    inspect(element) {
      if (element.closest(excluded) || ["HTML", "BODY", "SCRIPT", "STYLE", "IMG", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return;
      const s = getComputedStyle(element);
      if (s.display === "none" || s.visibility === "hidden") return;
      const rect = element.getBoundingClientRect();
      const bg = colors(s.backgroundColor);
      const button = element.matches('button,[role="button"]');
      if (!element.hasAttribute(attributes[0]) && s.backgroundImage === "none" && neutral(bg) && (bg[3] ?? 1) > .5 && ((rect.width >= 160 && rect.height >= 48) || button)) {
        element.setAttribute(attributes[0], rect.width >= innerWidth * .85 && rect.height >= innerHeight * .7 ? "base" : "glass");
        this.marked.add(element);
      }
      const hasText = [...element.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      const mediaText = element.closest('[class*="mask"],[class*="cover"],[class*="banner"],[class*="image"],[class*="player"],[class*="avatar"]');
      let paintedText = false;
      if (hasText) for (let parent = element, depth = 0; parent && parent !== document.body && depth < 4; parent = parent.parentElement, depth++) {
        const paint = getComputedStyle(parent);
        const background = colors(paint.backgroundColor);
        if (parent.hasAttribute(attributes[0])) break;
        if ((background[3] ?? 1) > .5 || paint.backgroundImage !== "none") { paintedText = true; break; }
      }
      if (hasText && !mediaText && !paintedText && neutral(colors(s.color)) && !element.hasAttribute(attributes[1])) {
        const color = colors(s.color);
        element.setAttribute(attributes[1], color[0] > 100 && color[0] < 200 ? "secondary" : "primary");
        this.marked.add(element);
      }
    }
    flush() {
      this.pending = null;
      if (!this.enabled) return;
      let budget = 600;
      while (budget-- > 0 && this.queue.length) {
        const item = this.queue[0];
        const next = item.first ? item.root : item.walker.nextNode();
        item.first = false;
        if (!next || !item.root.isConnected) { this.queue.shift(); continue; }
        if (item.reset) for (const attribute of attributes) next.removeAttribute(attribute);
        this.inspect(next);
      }
      for (const element of this.marked) if (!element.isConnected) {
        for (const attribute of attributes) element.removeAttribute(attribute);
        this.marked.delete(element);
      }
      if (this.queue.length) this.pending = setTimeout(() => this.flush(), 60);
    }
    disableSurfaces() {
      this.enabled = false;
      this.observer.disconnect();
      clearTimeout(this.pending);
      this.pending = null;
      this.queue.length = 0;
      for (const element of this.marked) for (const attribute of attributes) element.removeAttribute(attribute);
      this.marked.clear();
    }
    dispose() { this.disableSurfaces(); this.host?.remove(); }
  }
  globalThis.BiliAmbientSite = SiteTheme;
})();
