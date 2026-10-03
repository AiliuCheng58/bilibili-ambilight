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
const extension = resolve(root, "dist");
const resultsDir = process.env.BILI_TEST_RESULTS ? resolve(process.env.BILI_TEST_RESULTS) : resolve(root, "test-results");
await mkdir(resultsDir, { recursive: true });
const fixture = await readFile(resolve(root, "tests/fixture.html"), "utf8");
const context = await playwright.chromium.launchPersistentContext(resolve(resultsDir, "profile"), {
  headless: true, channel: "chromium", executablePath: process.env.BILI_TEST_BROWSER || undefined, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--autoplay-policy=no-user-gesture-required"]
});
const checks = [];
const errors = [];
let worker;
try {
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.local.clear());
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await context.route("https://www.bilibili.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }));
  await page.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  const layer = page.locator("#bili-ambient-layer");
  const status = async () => layer.getAttribute("data-state");
  const set = values => worker.evaluate(values => chrome.storage.local.set(values), values);
  const sample = () => page.locator(".bili-ambient-background").evaluate(c => Array.from(c.getContext("2d").getImageData(15, 15, 1, 1).data));
  async function check(name, run) {
    await run(); checks.push(name); console.log(`PASS ${name}`);
  }
  await check("MV3 extension loads and attaches in its isolated content world", async () => {
    await layer.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#bili-ambient-layer")?.dataset.state === "active");
    assert.equal(await page.evaluate(() => typeof window.BiliAmbientSettings), "undefined");
    assert.equal(await page.locator(".bili-ambient-background").evaluate(c => c.width), 160);
  });
  await check("video projection changes color with decoded frames", async () => {
    const before = await sample();
    await page.evaluate(() => { window.sceneColor = "#2045ee"; });
    await page.waitForFunction(() => { const c = document.querySelector(".bili-ambient-background"); const p=c.getContext("2d").getImageData(15,15,1,1).data; return p[2] > p[0] + 50; });
    assert.notDeepEqual(await sample(), before);
  });
  await check("light layer does not intercept player interactions", async () => {
    assert.equal(await page.evaluate(() => { const v=document.querySelector("video"); const r=v.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === v; }), true);
    assert.equal(await layer.evaluate(el => getComputedStyle(el).pointerEvents), "none");
  });
  await check("paused video retains a still projection", async () => {
    await page.locator("video").evaluate(v => v.pause());
    await page.waitForFunction(() => document.querySelector("#bili-ambient-layer")?.dataset.state === "paused");
    assert.equal(await layer.getAttribute("data-visible"), "true");
  });
  await check("rendering behind the page keeps decoded video pixels unchanged", async () => {
    const rect = await page.locator("video").boundingBox();
    const clip = { x:rect.x+16,y:rect.y+70,width:rect.width-32,height:rect.height-140 };
    const videoImage = await page.screenshot({clip});
    await set({ enabled: false });
    await layer.waitFor({ state: "hidden" });
    assert.equal(videoImage.equals(await page.screenshot({clip})), true);
    await set({ enabled: true });
    await layer.waitFor({ state: "visible" });
  });
  await check("enable toggle hides and restores the light layer", async () => {
    await set({ enabled: false });
    await layer.waitFor({ state: "hidden" });
    assert.equal(await status(), "disabled");
    const frozen = await sample();
    await page.evaluate(() => { window.sceneColor = "#ffe022"; });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.deepEqual(await sample(), frozen);
    await set({ enabled: true });
    await layer.waitFor({ state: "visible" });
    await page.locator("video").evaluate(v => v.play());
  });
  const popup = await context.newPage();
  popup.on("pageerror", error => errors.push(error.message));
  await check("popup preset applies settings through real extension storage", async () => {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole("button", { name: "影院", exact: false }).click();
    await page.waitForFunction(() => document.querySelector(".bili-ambient-shade")?.style.opacity === "0.22");
    const stored = await worker.evaluate(() => chrome.storage.local.get(["brightness", "spread", "dim"]));
    assert.deepEqual(stored, { brightness: 105, spread: 150, dim: 22 });
    assert.equal(await popup.getByRole("button", { name: "影院", exact: false }).getAttribute("aria-pressed"), "true");
    await popup.screenshot({ path: resolve(resultsDir, "settings.png") });
  });
  await check("settings survive popup reopening and can be reset", async () => {
    await popup.reload();
    await popup.waitForFunction(() => document.getElementById("spread").value === "150");
    await popup.getByRole("button", { name: "恢复默认" }).click();
    await page.waitForFunction(() => document.querySelector(".bili-ambient-shade")?.style.opacity === "0.08");
  });
  await popup.close();
  await check("resize observer updates the projection geometry", async () => {
    const before = await page.locator(".bili-ambient-halo").evaluate(el => el.style.width);
    await page.locator(".bpx-player-container").evaluate(el => { el.style.width = "640px"; el.style.height = "360px"; });
    await page.waitForFunction(() => document.querySelector(".bili-ambient-halo")?.style.width === "840px");
    assert.notEqual(await page.locator(".bili-ambient-halo").evaluate(el => el.style.width), before);
  });
  await check("source replacement automatically binds the new player video", async () => {
    await page.evaluate(async () => { const v=document.querySelector("video"); v.srcObject.getTracks().forEach(track=>track.stop()); const next=document.createElement("video");next.muted=true;next.autoplay=true;next.playsInline=true;v.replaceWith(next);await window.attachSource(next); });
    await page.waitForFunction(() => document.querySelector("#bili-ambient-layer")?.dataset.state === "active");
    assert.equal(await page.locator("#bili-ambient-layer").count(), 1);
  });
  await check("glass styling keeps UI foreground clear and removes opaque page backgrounds", async () => {
    const style=await page.evaluate(()=>({header:getComputedStyle(document.querySelector("header"),"::before").backdropFilter,headerColor:getComputedStyle(document.querySelector("header")).color,body:getComputedStyle(document.body).backgroundColor,app:getComputedStyle(document.querySelector("#app")).backgroundColor,opacity:document.documentElement.style.getPropertyValue("--bili-ambient-glass")}));
    assert.match(style.header,/blur\(24px\)/);
    const tone=await page.locator("html").getAttribute("data-bili-ambient-tone");
    assert.equal(style.headerColor,tone === "light" ? "rgb(29, 35, 50)" : "rgb(244, 245, 248)");
    assert.equal(style.body,"rgba(0, 0, 0, 0)");
    assert.equal(style.app,"rgba(0, 0, 0, 0)");
    assert.equal(style.opacity,"0.08");
  });
  await check("background remains fixed and updates when scrolling below the player", async () => {
    const background = page.locator(".bili-ambient-background");
    const before=await background.boundingBox();
    const pixels=await sample();
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForFunction(() => document.querySelector(".bili-ambient-halo")?.style.display === "none");
    assert.equal(await layer.getAttribute("data-visible"),"true");
    assert.equal(await status(), "active");
    assert.deepEqual(await background.boundingBox(),before);
    await page.evaluate(()=>{window.sceneColor="#2045ee";});
    await page.waitForFunction(()=>{const c=document.querySelector(".bili-ambient-background");const p=c.getContext("2d").getImageData(15,15,1,1).data;return p[2]>p[0]+50;});
    assert.notDeepEqual(await sample(),pixels);
    await page.screenshot({path:resolve(resultsDir,"scroll-preview.png")});
    await page.evaluate(() => window.scrollTo(0, 0));
    await layer.waitFor({ state: "visible" });
  });
  await check("comment shadow DOM receives and restores the page theme", async () => {
    const color=()=>page.evaluate(()=>getComputedStyle(document.querySelector("bili-comments").shadowRoot.querySelector("bili-comment-renderer").shadowRoot.querySelector("#content")).color);
    assert.equal(await color(),await page.locator("body").evaluate(e=>getComputedStyle(e).color));
    await set({enabled:false});
    await layer.waitFor({state:"hidden"});
    assert.equal(await color(),"rgb(24, 25, 28)");
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute("data-bili-ambient")),false);
    assert.equal(await page.locator("header").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(245, 246, 249)");
    await set({enabled:true});
    await layer.waitFor({state:"visible"});
    assert.equal(await color(),await page.locator("body").evaluate(e=>getComputedStyle(e).color));
  });
  await check("SPA navigation keeps the site theme and reactivates playback", async () => {
    await set({siteVideoPreviews:false});
    await page.evaluate(() => history.pushState({}, "", "/"));
    await page.waitForFunction(() => document.querySelector("#bili-ambient-layer")?.dataset.state === "site");
    assert.equal(await layer.getAttribute("data-visible"), "false");
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-bili-ambient")),true);
    await page.evaluate(() => history.pushState({}, "", "/bangumi/play/ep123"));
    await layer.waitFor({ state: "visible" });
    await set({siteVideoPreviews:true});
  });
  await check("native container fullscreen keeps the glow inside the fullscreen tree", async () => {
    await page.getByRole("button", { name: "全屏", exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector("#bili-ambient-layer")));
    await page.waitForFunction(() => parseFloat(document.querySelector(".bili-ambient-halo").style.height) < innerHeight + 200);
    assert.equal(await layer.getAttribute("data-visible"), "true");
    await page.screenshot({ path: resolve(resultsDir, "fullscreen.png") });
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => document.querySelector("#bili-ambient-layer")?.parentElement === document.documentElement);
  });
  await check("portrait media keeps the sampling resolution bounded", async () => {
    await page.evaluate(async () => { scene.width=360; scene.height=640; await window.attachSource(document.querySelector("video")); });
    await page.waitForFunction(() => { const c=document.querySelector(".bili-ambient-frame"); return c.height === 160 && c.width <= 160; });
  });
  await check("embed player route receives the content script", async () => {
    await context.route("https://player.bilibili.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }));
    const embedded = await context.newPage();
    await embedded.goto("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD");
    await embedded.locator("#bili-ambient-layer").waitFor({ state: "visible" });
    await embedded.close();
  });
  await check("cross-origin video projects light even when pixel reads are forbidden", async () => {
    await page.bringToFront();
    const recording = await page.evaluate(async () => {
      const stream=scene.captureStream(20), chunks=[];
      const recorder=new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      recorder.onstart=()=>stream.getVideoTracks()[0].requestFrame();
      const blob=await new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>resolve(new Blob(chunks,{type:"video/webm"}));recorder.start();setTimeout(()=>recorder.stop(),400);});
      stream.getTracks().forEach(track=>track.stop());
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await context.route("https://media.example.test/test.webm", route=>route.fulfill({ contentType:"video/webm", body:Buffer.from(recording) }));
    await page.locator("video").evaluate(async v=>{v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null;v.removeAttribute("crossorigin");v.src="https://media.example.test/test.webm";v.loop=true;await v.play();});
    await page.waitForFunction(()=>{const c=document.querySelector(".bili-ambient-background");try{c.getContext("2d").getImageData(0,0,1,1);return false;}catch(e){return e.name==="SecurityError";}});
    assert.equal(await layer.getAttribute("data-visible"), "true");
    assert.notEqual(await status(), "error");
  });
  await page.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  await page.waitForFunction(() => { const c=document.querySelector(".bili-ambient-background");return c?.width === 160 && c.getContext("2d").getImageData(15,15,1,1).data[0]>150; });
  await page.locator("video").evaluate(v=>new Promise(resolve=>v.requestVideoFrameCallback(resolve)));
  await page.screenshot({ path: resolve(resultsDir, "ambient-preview.png") });
  assert.deepEqual(errors, [], "browser console exceptions");
  console.log(`\n${checks.length}/${checks.length} browser checks passed. No page exceptions.`);
  await writeFile(resolve(resultsDir, "results.json"), JSON.stringify({ checks, errors, browser: context.browser()?.version() }, null, 2));
} finally {
  await context.close();
}
