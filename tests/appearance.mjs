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
const extension = resolve(process.env.BILI_TEST_EXTENSION || resolve(root, "dist"));
const resultsDir = resolve(process.env.BILI_TEST_RESULTS || resolve(root, "test-results/appearance"));
await mkdir(resultsDir, { recursive: true });
const fixture = await readFile(resolve(root, "tests/fixture.html"), "utf8");
const context = await playwright.chromium.launchPersistentContext(resolve(resultsDir, "profile"), {
  headless: true, channel: "chromium", executablePath: process.env.BILI_TEST_BROWSER || undefined,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--autoplay-policy=no-user-gesture-required", ...(process.env.BILI_TEST_GPU === "low-power" ? ["--force_low_power_gpu"] : [])]
});
const checks = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.local.clear());
  await context.route("https://www.bilibili.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }));
  const page = await context.newPage();
  const exceptions = [];
  page.on("pageerror", error => exceptions.push(error.message));
  await page.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  await page.locator("#bili-ambient-layer").waitFor({ state: "visible" });
  const set = values => worker.evaluate(values => chrome.storage.local.set(values), values);
  async function scene(mode) {
    await page.evaluate(async mode => { window.sceneMode = mode; await document.querySelector("video").play(); }, mode);
    // Allow the temporal buffer and the one-second content inspection to settle.
    await page.waitForTimeout(1500);
  }
  const pixel = (x,y) => page.locator(".bili-ambient-background").evaluate((c,{x,y})=>{
    const r=c.getBoundingClientRect();
    return Array.from(c.getContext("2d").getImageData(Math.floor((x-r.left)/r.width*c.width),Math.floor((y-r.top)/r.height*c.height),1,1).data);
  },{x,y});
  if (!process.env.BILI_TEST_CAPTURE_ONLY) {
    await set({ smoothing:0 });
    await scene("edges");
    const rect=await page.locator("video").boundingBox();
    const left=await pixel(20,rect.y+rect.height/2),right=await pixel(1180,rect.y+rect.height/2);
    const top=await pixel(rect.x+rect.width/2,20),bottom=await pixel(rect.x+rect.width/2,840);
    assert.ok(left[0]>left[1]*2 && left[0]>left[2]*2,"left margin follows the red video edge");
    assert.ok(right[1]>right[0]*2 && right[1]>right[2]*1.5,"right margin follows the green video edge");
    assert.ok(top[1]>top[0]*2 && top[2]>top[0]*2,"top margin follows the cyan video edge");
    assert.ok(bottom[0]>bottom[2]*2 && bottom[1]>bottom[2]*2,"bottom margin follows the yellow video edge");
    checks.push("all four page margins follow their corresponding video edge");
    await page.locator("video").evaluate(v=>v.pause());
    await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.state==="paused");
    const backgroundPixels=()=>page.locator(".bili-ambient-background").evaluate(c=>Array.from(c.getContext("2d").getImageData(0,0,c.width,c.height).data));
    const beforeFloating=await backgroundPixels();
    await page.locator(".bpx-player-container").evaluate(e=>{e.style.position="fixed";e.style.width="320px";e.style.height="180px";e.style.right="20px";e.style.bottom="20px";});
    await page.waitForFunction(()=>document.querySelector(".bili-ambient-halo").style.display==="none");
    assert.deepEqual(await backgroundPixels(),beforeFloating,"scroll mini-player preserves the full-size projection anchor");
    await page.locator(".bpx-player-container").evaluate(e=>e.removeAttribute("style"));
    checks.push("automatic scroll mini-player preserves the full-size background projection");
    await scene("bars");
    const outside=await pixel(1180,rect.y+rect.height/2);
    assert.ok(outside[0]>130 && outside[2]>170,"embedded black bars do not extinguish the background");
    const decoded=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=64;c.height=36;const ctx=c.getContext("2d");ctx.drawImage(document.querySelector("video"),0,0,64,36);return Array.from(ctx.getImageData(1,18,1,1).data);});
    assert.deepEqual(decoded.slice(0,3),[0,0,0],"decoded picture retains its original black bars");
    checks.push("symmetric encoded black bars are excluded from the background while video pixels remain intact");
    const panels=await page.evaluate(()=>[".video-info-container",".video-toolbar-container",".video-sections-head",".video-sections-content-list",".video-episode-card"].map(s=>({selector:s,color:getComputedStyle(document.querySelector(s)).backgroundColor})));
    for(const panel of panels)assert.equal(panel.color,"rgba(0, 0, 0, 0)",panel.selector);
    assert.equal(await page.locator(".simple-base-item.active .title").evaluate(e=>getComputedStyle(e).color),"rgb(0, 174, 236)");
    checks.push("title, toolbar and nested collection surfaces remain transparent");
    await scene("white");
    assert.equal(await page.locator("html").getAttribute("data-bili-ambient-tone"),"light");
    assert.equal(await page.locator("h1.video-title").evaluate(e=>getComputedStyle(e).color),"rgb(29, 35, 50)");
    await scene("dark");
    assert.equal(await page.locator("html").getAttribute("data-bili-ambient-tone"),"dark");
    assert.equal(await page.locator("h1.video-title").evaluate(e=>getComputedStyle(e).color),"rgb(244, 245, 248)");
    checks.push("foreground contrast adapts to bright and dark video backgrounds");
    await set({ smoothing:70 });
  }
  for (const mode of ["pink","dark"]) {
    await scene(mode);
    await page.locator("video").evaluate(v=>v.pause());
    await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.state==="paused");
    await page.screenshot({path:resolve(resultsDir,mode+".png")});
    await page.evaluate(()=>window.scrollTo({top:1000,behavior:"instant"}));
    await page.screenshot({path:resolve(resultsDir,mode+"-scroll.png")});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  }
  assert.deepEqual(exceptions,[]);
  for(const check of checks)console.log("PASS "+check);
  await writeFile(resolve(resultsDir,"appearance-results.json"),JSON.stringify({checks,exceptions},null,2));
} finally { await context.close(); }
