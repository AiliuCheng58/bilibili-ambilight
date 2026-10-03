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
const results = resolve(process.env.BILI_TEST_RESULTS || resolve(root, "test-results/transitions"));
await mkdir(results, { recursive: true });
const fixture = await readFile(resolve(root, "tests/site-fixture.html"), "utf8");
const context = await playwright.chromium.launchPersistentContext(resolve(results, "profile"), {
  headless: true, channel: "chromium", executablePath: process.env.BILI_TEST_BROWSER || undefined,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${resolve(root, "dist")}`, `--load-extension=${resolve(root, "dist")}`, "--autoplay-policy=no-user-gesture-required"]
});
const checks = [], errors = [], samples = {};
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.local.clear());
  await context.route("https://www.bilibili.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }));
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://www.bilibili.com/");
  await page.locator("#bili-ambient-site-backdrop").waitFor({ state: "visible" });
  const set = values => worker.evaluate(values => chrome.storage.local.set(values), values);
  const palette = rgb => set({ sitePalette: [rgb, rgb, rgb] });
  const sample = async () => {
    const buffer = await page.screenshot();
    return page.evaluate(async data => {
      const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 12;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 4, 800, 12, 12, 0, 0, 12, 12);
      const pixels = ctx.getImageData(0, 0, 12, 12).data, sum = [0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += pixels[i + j];
      return sum.map(value => value / 144);
    }, buffer.toString("base64"));
  };
  const animationAt = async (selector, fraction) => {
    await page.waitForFunction(selector => document.querySelector(selector)?.getAnimations().length, selector);
    await page.locator(selector).evaluate((element, fraction) => {
      const animation = element.getAnimations()[0]; animation.pause();
      animation.currentTime = Number(animation.effect.getTiming().duration) * fraction;
    }, fraction);
  };
  const finish = selector => page.locator(selector).evaluate(element => element.getAnimations()[0]?.finish());
  const check = async (name, action) => { await action(); checks.push(name); console.log("PASS " + name); };
  await set({ brightness: 100, saturation: 100, contrast: 100, dim: 0 });
  await palette([210, 70, 100]); await page.waitForTimeout(500);
  await check("palette changes preserve the outgoing colors and interpolate the composited pixels", async () => {
    samples.before = await sample();
    await palette([50, 110, 210]);
    await animationAt(".bili-ambient-site-previous", 0);
    samples.start = await sample();
    assert.ok(samples.start.every((value, i) => Math.abs(value - samples.before[i]) <= 3), JSON.stringify(samples));
    await animationAt(".bili-ambient-site-previous", .5);
    samples.middle = await sample();
    assert.ok(samples.middle[0] < samples.start[0] - 15 && samples.middle[2] > samples.start[2] + 15, JSON.stringify(samples));
    assert.ok(samples.middle.every((value, i) => value >= Math.min(samples.start[i], [50, 110, 210][i]) - 3), "crossfade must not expose the dark page base");
  });
  await check("an interrupted palette transition starts from the currently displayed mixture", async () => {
    await palette([80, 190, 125]);
    await animationAt(".bili-ambient-site-previous", 0);
    samples.interrupted = await sample();
    assert.ok(samples.interrupted.every((value, i) => Math.abs(value - samples.middle[i]) <= 4), JSON.stringify(samples));
    await finish(".bili-ambient-site-previous");
    await page.locator(".bili-ambient-site-previous").waitFor({ state: "detached" });
    samples.final = await sample();
    assert.ok(samples.final.every((value, i) => Math.abs(value - [80, 190, 125][i]) <= 3), JSON.stringify(samples));
    await page.screenshot({ path: resolve(results, "site.png") });
  });
  await check("reduced motion changes palettes immediately without leaving an animation layer", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await palette([90, 100, 150]);
    await page.waitForFunction(() => document.querySelector(".bili-ambient-site-field").style.background.includes("90, 100, 150"));
    assert.equal(await page.locator(".bili-ambient-site-previous").count(), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });
  await check("video entry fades over an opaque static background and releases it after settling", async () => {
    await page.evaluate(() => window.startPreview());
    await animationAt("#bili-ambient-layer", .5);
    const state = await page.evaluate(() => ({ opacity: Number(getComputedStyle(document.querySelector("#bili-ambient-layer")).opacity), base: getComputedStyle(document.querySelector("#bili-ambient-site-backdrop")).display }));
    assert.ok(state.opacity > 0 && state.opacity < 1); assert.equal(state.base, "block");
    await finish("#bili-ambient-layer");
    await page.waitForFunction(() => !document.querySelector("#bili-ambient-layer").hasAttribute("data-transition"));
    assert.equal(await page.locator("#bili-ambient-site-backdrop").isVisible(), false);
    await page.screenshot({ path: resolve(results, "preview.png") });
  });
  await check("leaving a video preview keeps the outgoing picture until the static background takes over", async () => {
    await page.locator("video").evaluate(video => video.pause());
    await animationAt("#bili-ambient-layer", .5);
    const state = await page.evaluate(() => ({ opacity: Number(getComputedStyle(document.querySelector("#bili-ambient-layer")).opacity), base: getComputedStyle(document.querySelector("#bili-ambient-site-backdrop")).display }));
    assert.ok(state.opacity > 0 && state.opacity < 1); assert.equal(state.base, "block");
    await finish("#bili-ambient-layer");
    await page.locator("#bili-ambient-layer").waitFor({ state: "hidden" });
  });
  await check("disabling during a transition cancels animation work and restores the page", async () => {
    await page.locator("video").evaluate(video => video.play());
    await animationAt("#bili-ambient-layer", .5);
    await set({ enabled: false });
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-bili-ambient"));
    assert.equal(await page.locator("#bili-ambient-layer").isVisible(), false);
    assert.equal(await page.locator("#bili-ambient-layer").evaluate(element => element.getAnimations().length), 0);
    assert.equal(await page.locator(".bili-ambient-site-previous").count(), 0);
  });
  assert.deepEqual(errors, []);
  await writeFile(resolve(results, "transitions.json"), JSON.stringify({ checks, errors, samples }, null, 2));
} catch (error) {
  await writeFile(resolve(results, "transitions.json"), JSON.stringify({ checks, errors, samples, failure: error.stack }, null, 2));
  throw error;
} finally { await context.close(); }
