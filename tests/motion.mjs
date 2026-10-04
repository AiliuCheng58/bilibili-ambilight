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
const results = resolve(process.env.BILI_TEST_RESULTS || resolve(root, "test-results/motion"));
await mkdir(results, { recursive: true });
const fixture = (await readFile(resolve(root, "tests/fixture.html"), "utf8")).replace("scene.captureStream(30)", "scene.captureStream(60)");
const context = await playwright.chromium.launchPersistentContext(resolve(results, "profile"), {
  headless: true, channel: "chromium", executablePath: process.env.BILI_TEST_BROWSER || undefined,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${resolve(root, "dist")}`, `--load-extension=${resolve(root, "dist")}`, "--autoplay-policy=no-user-gesture-required", ...({ "low-power": ["--force_low_power_gpu"], "high-performance": ["--force_high_performance_gpu"] }[process.env.BILI_TEST_GPU] || [])]
});
const checks = [], errors = [], measurements = {};
measurements.environment = { browser: context.browser()?.version(), gpuPreference: process.env.BILI_TEST_GPU || "default", viewport: { width:1280,height:900 }, source: { width:640,height:360,targetFPS:60 } };
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.local.clear());
  await context.route("https://www.bilibili.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }));
  if (process.env.BILI_TEST_MEDIA) {
    const encodedVideo = await readFile(process.env.BILI_TEST_MEDIA);
    await context.route("https://www.bilibili.com/ambient-decoded.webm", route => route.fulfill({ contentType:"video/webm", body:encodedVideo }));
  }
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const session = await context.newCDPSession(page), worlds = new Map();
  session.on("Runtime.executionContextCreated", ({ context }) => worlds.set(context.id, context));
  session.on("Runtime.executionContextDestroyed", ({ executionContextId }) => worlds.delete(executionContextId));
  session.on("Runtime.executionContextsCleared", () => worlds.clear());
  await session.send("Runtime.enable");
  await page.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  await page.locator("#bili-ambient-layer").waitFor({ state: "visible" });
  let world;
  const evaluate = async expression => {
    const result = await session.send("Runtime.evaluate", { contextId: world, expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  for (const id of worlds.keys()) { world = id; if (await evaluate("typeof BiliAmbientRenderer === 'function'")) break; }
  assert.equal(await evaluate("typeof BiliAmbientRenderer"), "function");
  const set = values => worker.evaluate(values => chrome.storage.local.set(values), values);
  const check = async (name, action) => { await action(); checks.push(name); console.log("PASS " + name); };
  const blur = () => page.locator(".bili-ambient-background").evaluate(c => Number(c.style.filter.match(/blur\(([\d.]+)px\)/)[1]));
  measurements.gpu = await page.locator('.bili-ambient-output').evaluate(c => {
    const gl=c.getContext('webgl'), extension=gl.getExtension('WEBGL_debug_renderer_info');
    return extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  });
  await evaluate(`(() => {
    globalThis.motion = { phase: '', frames: [], blurs: [], colors: [] };
    const draw = BiliAmbientRenderer.prototype.draw, reblur = BiliAmbientRenderer.prototype.reblur;
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    BiliAmbientRenderer.prototype.draw = function(...args) {
      const started = performance.now(), result = draw.apply(this, args);
      if (motion.phase === 'fps') motion.frames.push({ time: args[6], cost: performance.now() - started });
      if (motion.phase === 'color') {
        ctx.drawImage(document.querySelector('video'), 0, 0, 1, 1);
        const output=new Uint8Array(4);
        this.gl.readPixels(Math.floor(this.canvas.width/2),Math.floor(this.canvas.height/2),1,1,this.gl.RGBA,this.gl.UNSIGNED_BYTE,output);
        motion.colors.push({ time: args[6], video: Array.from(ctx.getImageData(0,0,1,1).data), light: Array.from(output) });
      }
      return result;
    };
    BiliAmbientRenderer.prototype.reblur = function(...args) {
      const result = reblur.apply(this, args);
      if (motion.phase === 'blur' && this.projected && !this.lost) {
        const width = this.canvas.width, height = this.canvas.height, pixels = new Uint8Array(width*height*4);
        this.gl.readPixels(0,0,width,height,this.gl.RGBA,this.gl.UNSIGNED_BYTE,pixels);
        let edge = 0;
        for (let y=1;y<height;y++) for(let x=1;x<width;x++) for(let c=0;c<3;c++) {
          const i=(y*width+x)*4+c; edge += Math.abs(pixels[i]-pixels[i-4]) + Math.abs(pixels[i]-pixels[i-width*4]);
        }
        motion.blurs.push({ radius: args[0], edge: edge/((width-1)*(height-1)*6) });
      }
      return result;
    };
  })()`);
  const displayCadence = (duration = 2200) => page.evaluate(duration => new Promise(resolve => {
      const video = document.querySelector('video'), start = performance.now(), before = video.getVideoPlaybackQuality().totalVideoFrames;
      const times = [];
      const tick = now => {
        times.push(now);
        if(now-start<duration) requestAnimationFrame(tick);
        else resolve({ times, videoFrames: video.getVideoPlaybackQuality().totalVideoFrames-before, elapsed: now-start });
      };
      requestAnimationFrame(tick);
  }), duration);
  await set({enabled:false});
  await page.waitForTimeout(800);
  measurements.baseline = await displayCadence();
  await set({enabled:true});
  await page.locator('#bili-ambient-layer').waitFor({state:'visible'});
  await page.waitForTimeout(800);
  await check("default ambient rendering follows the display cadence without a 24 FPS cap", async () => {
    await evaluate("motion.phase='fps';motion.frames=[]");
    measurements.display = await displayCadence();
    const frames = await evaluate("motion.phase='';motion.frames");
    const fps = frames.length * 1000 / measurements.display.elapsed;
    const displayFPS = measurements.display.times.length * 1000 / measurements.display.elapsed;
    const costs = frames.map(frame => frame.cost).sort((a,b)=>a-b);
    const intervals = frames.slice(1).map((frame,i) => frame.time-frames[i].time).sort((a,b)=>a-b);
    measurements.cadence = { fps, displayFPS, baselineFPS: measurements.baseline.times.length*1000/measurements.baseline.elapsed, sourceFPS: measurements.display.videoFrames*1000/measurements.display.elapsed, p95DrawMs: costs[Math.floor(costs.length*.95)], p95FrameIntervalMs: intervals[Math.floor(intervals.length*.95)], maxFrameIntervalMs:intervals.at(-1) };
    assert.ok(displayFPS >= 55, JSON.stringify(measurements.cadence));
    assert.ok(fps >= 55 && fps >= displayFPS*.93, JSON.stringify(measurements.cadence));
    assert.ok(measurements.cadence.p95FrameIntervalMs <= 34, JSON.stringify(measurements.cadence));
    assert.equal(await page.locator('#bili-ambient-layer').getAttribute('data-renderer'), 'WebGL');
  });
  await check("a decoded color cut reaches the ambient frame without a temporal trail", async () => {
    await page.evaluate(() => { window.sceneMode='solid';window.sceneColor='#ff0000'; });
    await page.waitForTimeout(350);
    await evaluate("motion.phase='color';motion.colors=[]");
    await page.evaluate(() => { window.sceneColor='#0000ff'; });
    await page.waitForTimeout(200);
    const colors = await evaluate("motion.phase='';motion.colors");
    const blue = pixel => pixel[2]>220 && pixel[0]<20;
    const decoded = colors.find(frame => blue(frame.video)), projected = colors.find(frame => blue(frame.light));
    assert.ok(decoded && projected, JSON.stringify(colors));
    measurements.decodedToAmbientMs = Math.max(0, projected.time-decoded.time);
    assert.ok(measurements.decodedToAmbientMs <= 34, JSON.stringify(colors));
  });
  await page.evaluate(() => { window.sceneMode='pink'; });
  await page.waitForFunction(() => document.documentElement.dataset.biliAmbientTone==='light');
  await page.waitForTimeout(400);
  await page.screenshot({path:resolve(results,'watch.png')});
  await page.locator('video').evaluate(video => video.pause());
  await page.waitForFunction(() => document.querySelector('#bili-ambient-layer').dataset.state==='paused');
  await check("comment reading smoothly reduces background detail while retaining the paused source", async () => {
    const source = () => page.locator('.bili-ambient-frame').evaluate(c => c.toDataURL());
    const before = await source();
    await evaluate("motion.phase='blur';motion.blurs=[]");
    await page.evaluate(() => scrollTo(0,1000));
    await page.waitForTimeout(260);
    measurements.reading = await evaluate("motion.phase='';motion.blurs");
    assert.ok(measurements.reading.some(sample => sample.radius>42 && sample.radius<161));
    assert.ok(await blur() >= 161);
    const first = measurements.reading[0], last = measurements.reading.at(-1);
    assert.ok(last.edge < first.edge*.8, JSON.stringify(measurements.reading));
    assert.equal(await source(), before);
    const foreground = await page.locator('bili-comments').evaluate(el => {
      const content=el.shadowRoot.querySelector('bili-comment-renderer').shadowRoot.querySelector('#content');
      return { color:getComputedStyle(content).color, filter:getComputedStyle(content).filter, opacity:getComputedStyle(content).opacity, video:getComputedStyle(document.querySelector('video')).filter };
    });
    assert.deepEqual(foreground, { color:'rgb(29, 35, 50)', filter:'none', opacity:'1', video:'none' });
    await page.screenshot({path:resolve(results,'reading.png')});
    await page.evaluate(() => scrollTo(0,0));
    await page.waitForTimeout(240);
    assert.equal(await blur(),42);
  });
  await check("floating playback retains reading blur and reduced motion applies it immediately", async () => {
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('.bpx-player-container').evaluate(el => { Object.assign(el.style,{position:'fixed',width:'320px',height:'180px',right:'20px',bottom:'20px'}); });
    await page.waitForFunction(() => document.querySelector('.bili-ambient-background').style.filter.startsWith('blur(162px)'));
    await page.locator('.bpx-player-container').evaluate(el => el.removeAttribute('style'));
    await page.waitForFunction(() => document.querySelector('.bili-ambient-background').style.filter.startsWith('blur(42px)'));
    await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check("live reading at a 2560 by 1440 viewport keeps the display cadence", async () => {
    await page.setViewportSize({width:2560,height:1440});
    await page.locator('video').evaluate(video => video.play());
    await page.evaluate(() => scrollTo(0,1000));
    await page.waitForTimeout(400);
    await evaluate("motion.phase='fps';motion.frames=[]");
    const display=await displayCadence(), frames=await evaluate("motion.phase='';motion.frames");
    measurements.readingCadence={fps:frames.length*1000/display.elapsed,displayFPS:display.times.length*1000/display.elapsed};
    assert.ok(measurements.readingCadence.fps>=55 && measurements.readingCadence.fps>=measurements.readingCadence.displayFPS*.93,JSON.stringify(measurements.readingCadence));
    assert.equal(await blur(),162);
    await page.locator('video').evaluate(video => video.pause());
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(() => scrollTo(0,0));
    await page.waitForTimeout(240);
  });
  if (process.env.BILI_TEST_MEDIA) {
    await page.locator('video').evaluate(async video => {
      video.srcObject?.getTracks().forEach(track=>track.stop());video.srcObject=null;
      video.src='/ambient-decoded.webm';video.loop=true;await video.play();
    });
    await page.waitForFunction(() => document.querySelector('video').videoWidth>=1920 && document.querySelector('video').videoHeight>=1080);
    measurements.encoded = { source: await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight})) };
    for (const [name,width,height,scroll] of [['watch',1920,1080,0],['reading',2560,1440,1300]]) {
      await check(`decoded 1080p60 media sustains ambient rendering in the ${name} view`, async () => {
        await page.setViewportSize({width,height});await page.evaluate(y=>scrollTo(0,y),scroll);
        await page.waitForTimeout(500);await evaluate("motion.phase='fps';motion.frames=[]");
        const display=await displayCadence(12000),frames=await evaluate("motion.phase='';motion.frames");
        const intervals=frames.slice(1).map((frame,i)=>frame.time-frames[i].time).sort((a,b)=>a-b);
        const measured={elapsed:display.elapsed,fps:frames.length*1000/display.elapsed,displayFPS:display.times.length*1000/display.elapsed,sourceFPS:display.videoFrames*1000/display.elapsed,p95FrameIntervalMs:intervals[Math.floor(intervals.length*.95)],maxFrameIntervalMs:intervals.at(-1)};
        measurements.encoded[name]=measured;
        assert.ok(measured.fps>=55 && measured.sourceFPS>=55 && measured.p95FrameIntervalMs<=34,JSON.stringify(measured));
      });
    }
    await page.locator('video').evaluate(video=>video.pause());
    await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>scrollTo(0,0));
  }
  await check("Canvas fallback and the reading control preserve the same scroll behavior", async () => {
    await set({webGL:false});
    await page.waitForFunction(() => document.querySelector('#bili-ambient-layer').dataset.renderer==='Canvas 2D');
    await page.evaluate(() => scrollTo(0,1000));
    await page.waitForTimeout(240);
    assert.equal(await blur(),162);
    assert.equal(await page.locator('.bili-ambient-background').evaluate(c => getComputedStyle(c).visibility),'visible');
    await set({readingBlur:0});
    await page.waitForTimeout(240);
    assert.equal(await blur(),42);
  });
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(measurements.cadence));
  await writeFile(resolve(results,'motion.json'),JSON.stringify({checks,errors,measurements},null,2));
} catch(error) {
  await writeFile(resolve(results,'motion.json'),JSON.stringify({checks,errors,measurements,failure:error.stack},null,2));
  throw error;
} finally { await context.close(); }
