import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let playwright;
try { playwright = await import("playwright"); }
catch (error) {
  if (!process.env.BILI_TEST_MODULES) throw error;
  playwright = createRequire(resolve(process.env.BILI_TEST_MODULES, "package.json"))("playwright");
}
const results = resolve(process.env.BILI_TEST_RESULTS || resolve(root, "test-results/performance"));
await mkdir(results, { recursive: true });
const fixture = await readFile(resolve(root, "tests/fixture.html"), "utf8");
const siteFixture = await readFile(resolve(root, "tests/site-fixture.html"), "utf8");
const context = await playwright.chromium.launchPersistentContext(resolve(results, "profile"), {
  headless: true, channel: "chromium", executablePath: process.env.BILI_TEST_BROWSER || undefined,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${resolve(root, "dist")}`, `--load-extension=${resolve(root, "dist")}`, "--autoplay-policy=no-user-gesture-required", ...(process.env.BILI_TEST_GPU === "low-power" ? ["--force_low_power_gpu"] : [])]
});
const report = {};
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.local.clear());
  await context.route("https://www.bilibili.com/**", route => route.fulfill({ contentType: "text/html", body: route.request().url().includes("/video/") ? fixture : siteFixture }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const session = await context.newCDPSession(page);
  const worlds = new Map();
  session.on("Runtime.executionContextCreated", ({ context }) => worlds.set(context.id, context));
  session.on("Runtime.executionContextDestroyed", ({ executionContextId }) => worlds.delete(executionContextId));
  session.on("Runtime.executionContextsCleared", () => worlds.clear());
  await session.send("Runtime.enable");
  await session.send("Performance.enable");
  let world;
  const evaluate = async expression => {
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", { contextId: world, expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text + ": " + exceptionDetails.exception?.description);
    return result.value;
  };
  async function instrument() {
    for (const candidate of worlds.values()) {
      world = candidate.id;
      if (await evaluate("typeof BiliAmbientSite !== 'undefined'")) break;
    }
    assert.equal(await evaluate("typeof BiliAmbientSite"), "function");
    await evaluate(`(() => {
      globalThis.__ambientPerf = {};
      const wrap = (owner, key, name) => {
        const original = owner[key];
        owner[key] = function(...args) {
          const start = performance.now();
          try { return original.apply(this, args); }
          finally {
            const entry = __ambientPerf[name] ||= { count: 0, ms: 0, max: 0 };
            const elapsed = performance.now() - start;
            entry.count++; entry.ms += elapsed; entry.max = Math.max(entry.max, elapsed);
            if (name === 'surfaceBatch') { __ambientPerf.surfaceMarks = this.marked.size; __ambientPerf.surfacePending = this.queue.length + this.batch.length; }
          }
        };
      };
      wrap(BiliAmbientSite.prototype, 'flush', 'surfaceBatch');
      wrap(BiliAmbientSite.prototype, 'inspect', 'surfaceRead');
      wrap(BiliAmbientTheme.prototype, 'apply', 'themeApply');
      wrap(BiliAmbientTheme.prototype, 'scan', 'commentScan');
      wrap(BiliAmbientRenderer.prototype, 'draw', 'projection');
      wrap(WebGLRenderingContext.prototype, 'getError', 'gpuErrorRead');
      wrap(globalThis, 'getComputedStyle', 'styleRead');
      wrap(Element.prototype, 'getBoundingClientRect', 'geometryRead');
      const observer = new MutationObserver(records => {
        __ambientPerf.rootMutations = (__ambientPerf.rootMutations || 0) + records.length;
      });
      observer.observe(document.documentElement, { attributes: true });
    })()`);
  }
  const snapshot = async () => ({ ...(await evaluate("__ambientPerf")), metrics: Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value])) });
  async function measure(name, action) {
    await evaluate("globalThis.__ambientPerf = {}");
    const before = await snapshot();
    const started = performance.now();
    await action();
    const after = await snapshot();
    report[name] = { elapsed: performance.now() - started, ...after, metrics: Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount"].map(key => [key, after.metrics[key] - before.metrics[key]])) };
    console.log(name, JSON.stringify(report[name]));
  }
  const scroll = () => page.evaluate(() => new Promise(resolve => {
    let count = 0;
    const step = () => { scrollTo(0, 250 + Math.sin(count / 12) * 240); if (++count < 90) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  }));
  await page.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  await page.locator("#bili-ambient-layer").waitFor({ state: "visible" });
  await instrument();
  report.counterFPS = await evaluate(`(() => {
    const stats = new BiliAmbientStats(document.createElement('div'));
    const settings = { ...BiliAmbientSettings.defaults, showFPS: true };
    let time = 0;
    const video = { getVideoPlaybackQuality: () => ({ totalVideoFrames: Math.floor(time / 100) * 3, droppedVideoFrames: 0 }) };
    for (time = 0; time <= 1250; time += 50) stats.draw(time, 1, { width: 160, height: 90 }, { width: 160, height: 90 }, BiliAmbientProjection.fullFrame, settings, 'WebGL', video);
    const fps = Number(stats.text.textContent.match(/视频 (\\d+) FPS/)[1]);
    stats.dispose();
    return fps;
  })()`);
  assert.ok(report.counterFPS >= 29 && report.counterFPS <= 31, "bursting video counters must report the one-second frame rate");
  await page.waitForTimeout(500);
  await measure("playing", () => page.waitForTimeout(3000));
  await page.locator("video").evaluate(video => video.pause());
  await page.waitForTimeout(300);
  await measure("pausedScroll", scroll);
  await measure("pausedIdle", () => page.waitForTimeout(2100));
  await measure("pausedResize", async () => {
    await page.setViewportSize({ width: 1320, height: 920 });
    await page.waitForTimeout(100);
    assert.ok((await evaluate("__ambientPerf.projection?.count || 0")) > 0, "paused resize must update the projection geometry");
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  await page.evaluate(() => {
    const host = document.createElement("bili-late-comment");
    document.querySelector("bili-comments").shadowRoot.append(host);
    setTimeout(() => host.attachShadow({ mode: "open" }).innerHTML = '<div id="content" style="background:#fff;color:#222">异步评论</div>', 80);
  });
  await page.waitForFunction(() => document.querySelector("bili-comments").shadowRoot.querySelector("bili-late-comment")?.shadowRoot?.querySelector("[data-bili-ambient-theme]"));
  report.lateComment = true;
  await page.goto("https://www.bilibili.com/");
  await page.locator("#bili-ambient-site-backdrop").waitFor({ state: "visible" });
  await instrument();
  await page.waitForTimeout(400);
  await measure("staticScroll", scroll);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(250);
  await measure("feedInsertion", async () => {
    await page.evaluate(() => {
      const list = document.createElement("div"); list.className = "grid"; list.id = "performance-feed";
      list.innerHTML = Array.from({ length: 450 }, (_, i) => `<article class="card" data-index="${i}"><div class="cover">封面 ${i}</div><h2>推荐视频 ${i}</h2><span class="muted">发布信息</span><span class="badge">关注</span></article>`).join("");
      document.querySelector("#result").append(list);
    });
    await page.waitForFunction(() => document.querySelector('[data-index="449"]')?.hasAttribute("data-bili-ambient-surface"), null, { timeout: 20000 });
    await page.getByRole("button", { name: "操作", exact: true }).click();
    assert.equal(await page.locator("#count").textContent(), "1");
  });
  await measure("feedRestyle", async () => {
    report.unthemedCards = await page.evaluate(() => new Promise(resolve => {
      const style = document.createElement("style"); style.textContent = '#performance-feed.refresh .card{background:#f8f8f8;color:#222}'; document.head.append(style);
      document.querySelector("#performance-feed").classList.add("refresh");
      let frames = 0, missing = 0;
      const observe = () => {
        missing = Math.max(missing, document.querySelectorAll('#performance-feed .card:not([data-bili-ambient-surface])').length);
        if (++frames < 60) requestAnimationFrame(observe); else resolve(missing);
      };
      requestAnimationFrame(observe);
    }));
    const deadline = performance.now() + 5000;
    while ((await evaluate("__ambientPerf.surfacePending || 0")) && performance.now() < deadline) await page.waitForTimeout(20);
    assert.equal(await evaluate("__ambientPerf.surfacePending || 0"), 0, "restyling must finish");
    assert.equal(report.unthemedCards, 0, "deferred cards must keep their glass throughout reinspection");
  });
  await measure("feedRemoval", async () => {
    await page.locator("#performance-feed").evaluate(element => element.remove());
    await page.waitForTimeout(100);
    assert.ok((await evaluate("__ambientPerf.surfaceMarks ?? Infinity")) < 50, "removed cards must release their theme references");
  });
  report.environment = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return { userAgent: navigator.userAgent, renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unavailable" };
  });
  assert.deepEqual(errors, []);
  await writeFile(resolve(results, "performance.json"), JSON.stringify({ report, errors }, null, 2));
  assert.equal(report.pausedScroll.projection?.count || 0, 0, "fixed paused projection must survive scrolling without resampling");
  assert.equal(report.staticScroll.rootMutations || 0, 0, "static scrolling must not rewrite theme attributes");
  assert.equal(report.pausedIdle.commentScan?.count || 0, 0, "settled comments must not be rescanned while idle");
  assert.equal(report.playing.gpuErrorRead?.count || 0, 0, "stable textures must not synchronize GPU errors on each frame");
  assert.ok((report.feedInsertion.surfaceBatch?.max || 0) < 40, "surface batches must yield before blocking a frame for 40 ms");
} catch (error) {
  await writeFile(resolve(results, "performance.json"), JSON.stringify({ report, failure: error.stack }, null, 2));
  throw error;
} finally { await context.close(); }
