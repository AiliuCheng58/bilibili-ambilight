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
      this.batch = [];
      this.cleanup = false;
      this.pending = null;
      this.observer = new MutationObserver(records => {
        if (!this.enabled) return;
        for (const record of records) {
          if (record.target.closest?.(excluded)) continue;
          if (record.type === "attributes") this.enqueue(record.target, true);
          else {
            for (const node of record.addedNodes) if (node.nodeType === 1) this.enqueue(node);
            if (record.removedNodes.length) this.cleanup = true;
          }
        }
        if (this.cleanup && this.pending === null) this.pending = requestAnimationFrame(() => this.flush());
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
      const key = JSON.stringify(this.palette);
      if (key === this.paintedKey) return;
      const gradient = palette => {
        const c = palette.map(rgb => `rgb(${rgb.join(",")})`);
        return `radial-gradient(ellipse at 12% 20%,${c[0]},transparent 72%),radial-gradient(ellipse at 94% 38%,${c[1]},transparent 75%),radial-gradient(ellipse at 42% 110%,${c[2]},transparent 80%),${c[2]}`;
      };
      const animate = this.paintedPalette && this.host.dataset.visible === "true" && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      let previous = this.paintedPalette;
      if (animate && this.paletteAnimation) {
        const opacity = Number(getComputedStyle(this.previousField).opacity);
        previous = previous.map((rgb, i) => rgb.map((value, j) => Math.round(value * (1 - opacity) + this.transitionFrom[i][j] * opacity)));
      }
      this.paletteAnimation?.cancel();
      this.paletteAnimation = null;
      this.field.style.background = gradient(this.palette);
      if (animate) {
        this.previousField ||= document.createElement("div");
        this.previousField.className = "bili-ambient-site-previous";
        this.previousField.style.background = gradient(previous);
        this.previousField.style.filter = this.field.style.filter;
        this.field.after(this.previousField);
        this.transitionFrom = previous;
        const animation = this.previousField.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: "ease-out" });
        this.paletteAnimation = animation;
        animation.finished.then(() => {
          if (this.paletteAnimation !== animation) return;
          this.previousField.remove();
          this.paletteAnimation = null;
        }).catch(() => {});
      } else this.previousField?.remove();
      this.paintedKey = key;
      this.paintedPalette = this.palette.map(rgb => [...rgb]);
    }
    show(settings, theme) {
      this.mount();
      this.host.dataset.visible = "true";
      this.field.style.filter = `blur(${settings.blur}px) saturate(${settings.saturation}%) brightness(${settings.brightness}%) contrast(${settings.contrast}%)`;
      if (this.previousField) this.previousField.style.filter = this.field.style.filter;
      const grey = Math.round(settings.pageBackgroundGreyness * 2.55);
      this.shade.style.background = `rgb(${grey},${grey},${grey})`;
      this.shade.style.opacity = String(settings.dim / 100);
      const luminance = this.palette.reduce((sum, c) => sum + (c[0] * .2126 + c[1] * .7152 + c[2] * .0722) / 255, 0) / 3;
      const adjusted = Math.max(0, Math.min(1, (luminance * settings.brightness / 100 - .5) * settings.contrast / 100 + .5));
      theme?.setLuminance(adjusted * (1 - settings.dim / 100) + settings.pageBackgroundGreyness / 100 * settings.dim / 100);
    }
    hide() {
      if (this.host) this.host.dataset.visible = "false";
      this.paletteAnimation?.cancel();
      this.paletteAnimation = null;
      this.previousField?.remove();
    }
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
      if (!this.queue.some(item => item.root.contains(element) && (!reset || item.reset))) {
        this.queue = this.queue.filter(item => !element.contains(item.root) || (!reset && item.reset));
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, { acceptNode: node => node.matches(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        this.queue.push({ root: element, walker, first: true, reset });
      }
      if (this.pending === null) this.pending = requestAnimationFrame(() => this.flush());
    }
    styleFor(element) {
      if (!this.styles.has(element)) this.styles.set(element, getComputedStyle(element));
      return this.styles.get(element);
    }
    inspect(element) {
      if (element.closest(excluded) || ["HTML", "BODY", "SCRIPT", "STYLE", "IMG", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return;
      const s = this.styleFor(element);
      if (s.display === "none" || s.visibility === "hidden") return;
      const bg = colors(s.backgroundColor);
      const button = element.matches('button,[role="button"]');
      const plan = { element };
      if (!element.hasAttribute(attributes[0]) && s.backgroundImage === "none" && neutral(bg) && (bg[3] ?? 1) > .5) {
        const rect = element.getBoundingClientRect();
        if ((rect.width >= 160 && rect.height >= 48) || button) {
          plan.surface = rect.width >= innerWidth * .85 && rect.height >= innerHeight * .7 ? "base" : "glass";
          this.surfaces.add(element);
        }
      }
      const hasText = [...element.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      const mediaText = element.closest('[class*="mask"],[class*="cover"],[class*="banner"],[class*="image"],[class*="player"],[class*="avatar"]');
      let paintedText = false;
      if (hasText) for (let parent = element, depth = 0; parent && parent !== document.body && depth < 4; parent = parent.parentElement, depth++) {
        if (parent.hasAttribute(attributes[0]) || this.surfaces.has(parent)) break;
        const paint = this.styleFor(parent);
        const background = colors(paint.backgroundColor);
        if ((background[3] ?? 1) > .5 || paint.backgroundImage !== "none") { paintedText = true; break; }
      }
      if (hasText && !mediaText && !paintedText && neutral(colors(s.color)) && !element.hasAttribute(attributes[1])) {
        const color = colors(s.color);
        plan.ink = color[0] > 100 && color[0] < 200 ? "secondary" : "primary";
      }
      return plan;
    }
    flush() {
      this.pending = null;
      if (!this.enabled) return;
      const start = performance.now();
      const batch = this.batch;
      this.batch = [];
      while (batch.length < 96 && this.queue.length) {
        const item = this.queue[0];
        const next = item.first ? item.root : item.walker.nextNode();
        item.first = false;
        if (!next || !item.root.isConnected) { this.queue.shift(); continue; }
        batch.push({ element: next, reset: item.reset });
      }
      // Removing old marks, measuring, then committing avoids a layout flush for each card.
      for (const entry of batch) if (entry.reset) {
        entry.previous = attributes.map(attribute => entry.element.getAttribute(attribute));
        for (const attribute of attributes) entry.element.removeAttribute(attribute);
      }
      this.styles = new Map();
      this.surfaces = new Set();
      const plans = [];
      for (let i = 0; i < batch.length; i++) {
        const { element } = batch[i];
        if (element.isConnected) plans.push(this.inspect(element));
        if (performance.now() - start >= 4) { this.batch = batch.slice(i + 1); break; }
      }
      // Deferred nodes retain their visible theme until their next measurement batch.
      for (const entry of this.batch) if (entry.reset) for (let i = 0; i < attributes.length; i++) {
        if (entry.previous[i] !== null) entry.element.setAttribute(attributes[i], entry.previous[i]);
      }
      for (const plan of plans) if (plan?.surface || plan?.ink) {
        if (plan.surface) plan.element.setAttribute(attributes[0], plan.surface);
        if (plan.ink) plan.element.setAttribute(attributes[1], plan.ink);
        this.marked.add(plan.element);
      }
      this.styles.clear();
      this.surfaces.clear();
      if (this.cleanup) {
        this.cleanup = false;
        for (const element of this.marked) if (!element.isConnected) {
          for (const attribute of attributes) element.removeAttribute(attribute);
          this.marked.delete(element);
        }
      }
      if (this.queue.length || this.batch.length) this.pending = requestAnimationFrame(() => this.flush());
    }
    disableSurfaces() {
      this.enabled = false;
      this.observer.disconnect();
      cancelAnimationFrame(this.pending);
      this.pending = null;
      this.queue.length = 0;
      this.batch.length = 0;
      for (const element of this.marked) for (const attribute of attributes) element.removeAttribute(attribute);
      this.marked.clear();
    }
    dispose() { this.hide(); this.disableSurfaces(); this.host?.remove(); }
  }
  globalThis.BiliAmbientSite = SiteTheme;
})();
