import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
let playwright;
try { playwright=await import("playwright"); }
catch(error) { if(!process.env.BILI_TEST_MODULES)throw error;playwright=createRequire(resolve(process.env.BILI_TEST_MODULES,"package.json"))("playwright"); }
const extension=resolve(root,"dist"), results=resolve(process.env.BILI_TEST_RESULTS || resolve(root,"test-results/advanced"));
await mkdir(results,{recursive:true});
const fixture=await readFile(resolve(root,"tests/fixture.html"),"utf8");
const messageFixture=await readFile(resolve(root,"tests/message-fixture.html"),"utf8");
const context=await playwright.chromium.launchPersistentContext(resolve(results,"profile"),{
  headless:true,channel:"chromium",executablePath:process.env.BILI_TEST_BROWSER || undefined,
  viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,"--autoplay-policy=no-user-gesture-required", ...(process.env.BILI_TEST_GPU === "low-power" ? ["--force_low_power_gpu"] : [])]
});
// Decode Chromium screenshot pixels to verify the composited output, including GPU rendering.
function averagePNG(buffer,area){
  let position=8,width,height,channels;const compressed=[];
  while(position<buffer.length){const length=buffer.readUInt32BE(position),type=buffer.toString("ascii",position+4,position+8),data=buffer.subarray(position+8,position+8+length);position+=length+12;
    if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===6?4:3;}
    if(type==="IDAT")compressed.push(data);
  }
  const data=inflateSync(Buffer.concat(compressed)),stride=width*channels,rows=new Uint8Array(height*stride);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0,offset=0;y<height;y++){const filter=data[offset++];for(let x=0;x<stride;x++){
    const index=y*stride+x,a=x>=channels?rows[index-channels]:0,b=y?rows[index-stride]:0,c=y&&x>=channels?rows[index-stride-channels]:0;
    rows[index]=(data[offset++]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
  }}
  const region=area || {x:0,y:0,width,height};
  const rgb=[0,0,0];for(let y=region.y;y<region.y+region.height;y++)for(let x=region.x;x<region.x+region.width;x++)for(let c=0;c<3;c++)rgb[c]+=rows[y*stride+x*channels+c];
  return rgb.map(v=>v/(region.width*region.height));
}
const checks=[],measurements={};
try {
  const worker=context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(()=>chrome.storage.local.clear());
  await context.route("https://www.bilibili.com/**",r=>r.fulfill({contentType:"text/html",body:fixture}));
  await context.route("https://player.bilibili.com/**",r=>r.fulfill({contentType:"text/html",body:fixture}));
  await context.route("https://message.bilibili.com/**",r=>r.fulfill({contentType:"text/html",body:messageFixture}));
  const liveFixture=fixture.replace('class="bili-header__bar"','class="link-navbar-ctnr"').replace('class="bpx-player-video-wrap"','class="live-player-mounter"').replace('<aside class="right-container">','<aside class="right-container"><section class="chat-history-panel" style="background:#f6f7f8"><div class="chat-items"><div class="chat-item"><span class="danmaku-item-right" style="color:#333">直播聊天验证</span></div></div></section>');
  await context.route("https://live.bilibili.com/**",r=>r.fulfill({contentType:"text/html",body:liveFixture}));
  const previousTabs=await worker.evaluate(async()=> (await chrome.tabs.query({})).map(t=>t.id));
  const page=await context.newPage(),errors=[];
  const mainTabId=await worker.evaluate(async old=>(await chrome.tabs.query({})).find(t=>!old.includes(t.id)).id,previousTabs);
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  await page.locator("#bili-ambient-layer").waitFor({state:"visible"});
  const set=values=>worker.evaluate(values=>chrome.storage.local.set(values),values);
  const status=()=>worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:"bili-ambient:status"}),mainTabId);
  const pixel=()=>page.screenshot({clip:{x:4,y:430,width:24,height:24}}).then(averagePNG);
  const raw=()=>page.locator(".bili-ambient-background").evaluate(c=>Array.from(c.getContext("2d").getImageData(2,Math.floor(c.height/2),1,1).data).slice(0,3));
  const scene=async(mode,color)=>{await page.evaluate(async({mode,color})=>{window.sceneMode=mode;if(color)window.sceneColor=color;await document.querySelector("video").play();},{mode,color});await page.waitForTimeout(350);};
  async function check(name,run){if(process.env.BILI_TEST_CHECK && !name.includes(process.env.BILI_TEST_CHECK))return;await run();checks.push(name);console.log("PASS "+name);}
  await set({smoothing:0,brightness:100,saturation:100,dim:0,blur:10});
  await check("WebGL compositing preserves the left and right edge orientation",async()=>{
    await scene("edges");await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.renderer==="WebGL");
    const left=await pixel(),right=averagePNG(await page.screenshot({clip:{x:1248,y:430,width:24,height:24}}));
    assert.ok(left[0]>left[1]*2 && right[1]>right[0]*2,JSON.stringify({left,right}));
  });
  await check("Canvas 2D fallback produces the same directional scene without WebGL",async()=>{
    const before=await pixel();await set({webGL:false});await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.renderer==="Canvas 2D");
    const after=await pixel();assert.ok(after.every((v,i)=>Math.abs(v-before[i])<12));
    await set({directionLeftEnabled:false});await page.waitForTimeout(150);assert.ok((await pixel()).every(v=>v<10));
    await set({webGL:true,directionLeftEnabled:true});
  });
  await check("GPU context loss falls back and restoration resumes WebGL",async()=>{
    await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.renderer==="WebGL");
    await page.locator(".bili-ambient-output").evaluate(c=>{window.testContextLoss=c.getContext("webgl").getExtension("WEBGL_lose_context");window.testContextLoss.loseContext();});
    await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.renderer==="Canvas 2D");assert.ok((await pixel())[0]>100);
    await page.evaluate(()=>window.testContextLoss.restoreContext());await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.renderer==="WebGL");
  });
  await check("player halo keeps its soft edge while GPU blur falls back and recovers",async()=>{
    await set({blur:42});await scene('edges');await page.locator('video').evaluate(v=>v.pause());await page.waitForTimeout(400);
    const halo=page.locator('.bili-ambient-halo-output'),legacy=page.locator('.bili-ambient-halo > canvas:not(.bili-ambient-halo-output)');
    assert.equal(await halo.count(),1);
    assert.ok(!(await halo.evaluate(c=>getComputedStyle(c).filter)).includes('blur('));
    assert.equal(await legacy.evaluate(c=>getComputedStyle(c).visibility),'hidden');
    const mask=await halo.evaluate(c=>getComputedStyle(c).maskImage);
    assert.notEqual(mask,'none');assert.equal(mask,await legacy.evaluate(c=>getComputedStyle(c).maskImage));
    assert.ok(await halo.evaluate(c=>Math.max(c.width,c.height)<=256));
    const box=await page.locator('video').boundingBox();
    const clips=[{x:Math.floor(box.x+box.width*.18),y:Math.floor(box.y-24),width:16,height:16},{x:Math.floor(box.x-24),y:Math.floor(box.y+box.height*.4),width:16,height:16}];
    const samples=async()=>Promise.all(clips.map(clip=>page.screenshot({clip}).then(averagePNG)));
    const before=await samples();
    await halo.evaluate(c=>{window.haloContextLoss=c.getContext('webgl').getExtension('WEBGL_lose_context');window.haloContextLoss.loseContext();});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.bili-ambient-halo > canvas:not(.bili-ambient-halo-output)')).visibility==='visible');
    assert.ok((await legacy.evaluate(c=>getComputedStyle(c).filter)).includes('blur('));
    const fallback=await samples();
    assert.ok(fallback.every((rgb,i)=>rgb.every((v,c)=>Math.abs(v-before[i][c])<6)),JSON.stringify({before,fallback}));
    await page.evaluate(()=>window.haloContextLoss.restoreContext());
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.bili-ambient-halo > canvas:not(.bili-ambient-halo-output)')).visibility==='hidden');
    const restored=await samples();
    assert.ok(restored.every((rgb,i)=>rgb.every((v,c)=>Math.abs(v-before[i][c])<3)),JSON.stringify({before,restored}));
    measurements.halo={before,fallback,restored};
    await set({blur:10});await page.locator('video').evaluate(v=>v.play());
  });
  await check("comment text follows its local background across bright and dark regions",async()=>{
    await set({theme:0,projectionStyle:0,blur:42,brightness:100,saturation:100,dim:8});await scene('readingContrast');
    await page.evaluate(()=>{const hosts=document.querySelector('bili-comments').shadowRoot.querySelectorAll('bili-comment-renderer');hosts.forEach((host,i)=>{host.dataset.readingContrast='';host.style.cssText=i<2?`position:fixed;left:1050px;top:${i?720:120}px;width:210px;z-index:10`:'display:none';});});
    await page.waitForTimeout(800);
    const read=()=>page.evaluate(()=>Array.from(document.querySelector('bili-comments').shadowRoot.querySelectorAll('bili-comment-renderer')).slice(0,2).map(host=>{const target=host.shadowRoot.querySelector('#content'),r=target.getBoundingClientRect(),s=getComputedStyle(target);return {color:s.color,filter:s.filter,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};}));
    const samples=await read();
    const linear=rgb=>rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
    for(const sample of samples){const clip={x:Math.floor(sample.rect.x+4),y:Math.floor(sample.rect.y+4),width:12,height:12};sample.background=averagePNG(await page.screenshot({clip}));const a=linear(sample.background),b=linear(sample.color.match(/[\d.]+/g).slice(0,3).map(Number));sample.contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.equal(sample.filter,'none');}
    measurements.readingContrast=samples;assert.ok(samples.every(s=>s.contrast>=4.5),JSON.stringify(samples));assert.notEqual(samples[0].color,samples[1].color);
    await page.locator('video').evaluate(v=>v.pause());
    await page.evaluate(()=>{const hosts=document.querySelector('bili-comments').shadowRoot.querySelectorAll('bili-comment-renderer');hosts[0].style.top='720px';hosts[1].style.top='120px';window.dispatchEvent(new Event('scroll'));});
    await page.waitForTimeout(300);const moved=await read();assert.equal(moved[0].color,samples[1].color);assert.equal(moved[1].color,samples[0].color);
    measurements.readingMoved=moved;
    const previousText=await page.evaluate(()=>{
      const host=document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-renderer');
      const span=host.shadowRoot.querySelector('bili-rich-text').shadowRoot.querySelector('span'),text=span.textContent;
      host.style.top='-220px';span.textContent=Array(22).fill('可见评论正文').join('\n');span.style.whiteSpace='pre-line';
      window.dispatchEvent(new Event('scroll'));return text;
    });
    await page.waitForTimeout(300);
    const clipped=await page.evaluate(()=>{
      const target=document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-renderer').shadowRoot.querySelector('#content');
      const text=target.querySelector('bili-rich-text').shadowRoot.querySelector('span').firstChild,range=document.createRange();range.selectNodeContents(text);
      const lines=Array.from(range.getClientRects());return {color:getComputedStyle(target).color,firstLineY:lines[0].top,visibleLineY:lines.find(r=>r.bottom>0&&r.top<innerHeight)?.top};
    });
    measurements.readingClipped=clipped;assert.ok(clipped.firstLineY<0&&clipped.visibleLineY>=-24);assert.equal(clipped.color,samples[0].color);
    await page.evaluate(text=>{
      const host=document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-renderer'),span=host.shadowRoot.querySelector('bili-rich-text').shadowRoot.querySelector('span');
      span.textContent=text;span.style.removeProperty('white-space');host.style.top='720px';
    },previousText);
    await set({theme:1});await page.waitForTimeout(300);assert.ok((await read()).every(s=>s.color==='rgb(244, 245, 248)'));
    await page.evaluate(()=>document.querySelector('bili-comments').shadowRoot.querySelectorAll('[data-reading-contrast]').forEach(e=>{e.removeAttribute('style');e.removeAttribute('data-reading-contrast');}));
    await set({theme:0,projectionStyle:1,blur:10,brightness:100,saturation:100,dim:0});await scene('solid','#ff0000');
  });
  await check("reply rich text follows local reading brightness",async()=>{
    await set({theme:0,projectionStyle:0,blur:42,brightness:100,saturation:100,dim:8});await scene('readingContrast');
    await page.evaluate(()=>{const reply=document.createElement('bili-comment-reply-renderer');reply.style.cssText='position:fixed;left:1050px;top:120px;width:210px;z-index:10';document.querySelector('bili-comments').shadowRoot.append(reply);});
    const samples=[];
    for(const [top,color] of [[720,'rgb(255, 255, 255)'],[120,'rgb(0, 0, 0)']]){
      await page.evaluate(top=>{document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-reply-renderer').style.top=top+'px';window.dispatchEvent(new Event('scroll'));},top);
      await page.waitForTimeout(500);
      const actual=await page.evaluate(()=>{const reply=document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-reply-renderer'),span=reply.shadowRoot.querySelector('bili-rich-text').shadowRoot.querySelector('span'),s=getComputedStyle(span);return {color:s.color,filter:s.filter};});
      samples.push({top,...actual});assert.equal(actual.color,color);assert.equal(actual.filter,'none');
    }
    measurements.replyReading=samples;
    await page.evaluate(()=>document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-reply-renderer').remove());
    await set({theme:0,projectionStyle:1,blur:10,brightness:100,saturation:100,dim:0});await scene('solid','#ff0000');
  });
  await check("vibrance changes projected colors while decoded video colors stay intact",async()=>{
    await scene("solid","#b86b84");await set({vibrance:0});await page.waitForTimeout(150);
    const gray=await pixel();assert.ok(Math.max(...gray)-Math.min(...gray)<5,JSON.stringify(gray));
    const decoded=await page.locator("video").evaluate(v=>{const c=document.createElement("canvas");c.width=c.height=1;const ctx=c.getContext("2d");ctx.drawImage(v,0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);});
    assert.ok(decoded[0]-decoded[1]>50);await set({vibrance:100});
  });
  await check("recommendation titles and metadata follow local reading brightness and restore",async()=>{
    await set({theme:0,projectionStyle:0,blur:42,brightness:100,saturation:100,dim:8});await scene('readingContrast');
    await page.evaluate(()=>{
      const card=document.createElement('section');card.className='video-page-card-small';card.dataset.readingCard='';
      card.style.cssText='position:fixed;left:1050px;top:720px;width:210px;z-index:10;background:transparent';
      card.innerHTML='<h3 class="title" data-bili-ambient-reading-tone="keep">推荐内容</h3><p class="upname">视频作者</p><a class="reading-brand" style="color:#00aeec">品牌入口</a>';document.querySelector('aside').append(card);
    });
    await page.waitForFunction(()=>document.querySelector('[data-reading-card] .title').hasAttribute('data-bili-ambient-ink'));
    const read=()=>page.evaluate(()=>{
      const card=document.querySelector('[data-reading-card]');return {title:getComputedStyle(card.querySelector('.title')).color,metadata:getComputedStyle(card.querySelector('.upname')).color,brand:getComputedStyle(card.querySelector('.reading-brand')).color,filter:getComputedStyle(card).filter};
    });
    const contrast=async sample=>{
      const rects=await page.evaluate(()=>['.title','.upname'].map(selector=>{const r=document.querySelector('[data-reading-card] '+selector).getBoundingClientRect();return {x:Math.floor(r.x+4),y:Math.floor(r.y+4),width:12,height:12};}));
      await page.evaluate(()=>{const style=document.createElement('style');style.dataset.readingGlyphMask='';style.textContent='[data-reading-card] :is(h3,p,a){visibility:hidden !important}';document.head.append(style);});
      const luminance=rgb=>rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
      try{sample.contrast=[];for(const [i,rect] of rects.entries()){const background=averagePNG(await page.screenshot({clip:rect})),a=luminance(background),b=luminance(sample[i?'metadata':'title'].match(/[\d.]+/g).slice(0,3).map(Number)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);sample.contrast.push({background,ratio});assert.ok(ratio>=4.5,JSON.stringify(sample));}}
      finally{await page.evaluate(()=>document.querySelector('style[data-reading-glyph-mask]').remove());}
    };
    await page.waitForTimeout(350);const dark=await read();
    assert.equal(dark.title,'rgb(255, 255, 255)');assert.equal(dark.metadata,dark.title);assert.equal(dark.brand,'rgb(0, 174, 236)');assert.equal(dark.filter,'none');
    await contrast(dark);
    await page.locator('video').evaluate(v=>v.pause());
    await page.evaluate(()=>{document.querySelector('[data-reading-card]').style.top='120px';window.dispatchEvent(new Event('scroll'));});
    await page.waitForTimeout(350);const light=await read();assert.equal(light.title,'rgb(0, 0, 0)');assert.equal(light.metadata,light.title);
    await contrast(light);
    measurements.plainReading={dark,light};
    await set({directionRightEnabled:false,blur:10});await scene('solid','#eeeeee');
    await page.evaluate(()=>{document.querySelector('[data-reading-card]').style.top='350px';window.dispatchEvent(new Event('scroll'));});
    await page.waitForTimeout(350);const disabledDirection=await read();assert.equal(disabledDirection.title,'rgb(255, 255, 255)');
    await contrast(disabledDirection);measurements.plainReading.disabledDirection=disabledDirection;
    await set({directionRightEnabled:true});
    await set({theme:1});await page.waitForTimeout(200);assert.equal(await page.locator('[data-reading-card] .title').getAttribute('data-bili-ambient-reading-tone'),'keep');
    await set({theme:0,enabled:false});await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-reading-card] .title').getAttribute('data-bili-ambient-reading-tone'),'keep');
    assert.equal(await page.locator('[data-reading-card] .upname').getAttribute('data-bili-ambient-reading-tone'),null);
    await page.locator('[data-reading-card]').evaluate(e=>e.remove());
    await set({enabled:true,theme:0,projectionStyle:1,blur:10,brightness:100,saturation:100,dim:0});await scene('solid','#ff0000');
  });
  await check("OLED debanding preserves pure black",async()=>{
    await scene("solid","#000000");await set({debandingStrength:100,debandingBlendMode:1});await page.waitForTimeout(150);
    assert.ok((await pixel()).every(v=>v<.1));await set({debandingStrength:0,debandingBlendMode:0});
  });
  await check("fade duration blends a color step over time",async()=>{
    await scene("solid","#ff0000");await set({frameFading:2000});await scene("solid","#0000ff");
    const mixed=await raw();assert.ok(mixed[0]>50 && mixed[2]>20,JSON.stringify(mixed));
    await page.waitForTimeout(2200);const settled=await raw();assert.ok(settled[2]>settled[0]*4,JSON.stringify({mixed,settled}));await set({frameFading:0});
  });
  await check("flicker reduction slows sudden brightness changes",async()=>{
    await scene("solid","#ffffff");await set({flickerReduction:100});await scene("solid","#000000");
    assert.ok((await raw())[0]>100);await set({flickerReduction:0});await page.waitForTimeout(150);assert.ok((await raw())[0]<10);
  });
  await check("colored bar detection responds to its switch and manual clipping",async()=>{
    await scene("coloredBars");await page.waitForTimeout(900);assert.equal((await status()).crop.x,0);
    await set({detectColoredHorizontalBarSizeEnabled:true});await page.waitForTimeout(900);assert.ok((await status()).crop.x>.08);
    await set({detectColoredHorizontalBarSizeEnabled:false,verticalBarsClipPercentage:12,horizontalBarsClipPercentageReset:false,detectVideoFillScaleEnabled:true});
    await page.waitForFunction(()=>parseFloat(document.querySelector("video").style.getPropertyValue("--bili-ambient-video-fill"))>1.2);
    assert.ok(Math.abs((await status()).crop.x-.12)<.001);assert.match(await page.locator("video").evaluate(v=>getComputedStyle(v).clipPath),/inset/);
    await set({verticalBarsClipPercentage:0,detectVideoFillScaleEnabled:false,horizontalBarsClipPercentageReset:true});
  });
  await check("view selection follows Bilibili wide-screen state",async()=>{
    await set({enableInViews:3});await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.state==="view");
    await page.locator(".bpx-player-container").evaluate(e=>e.classList.add("bpx-state-wide"));await page.locator("#bili-ambient-layer").waitFor({state:"visible"});
    assert.equal((await status()).mode,"THEATER");await page.locator(".bpx-player-container").evaluate(e=>e.classList.remove("bpx-state-wide"));
    await set({enableInViews:0});
  });
  await check("forced theme, header fill and independent recommendation scroll apply immediately",async()=>{
    await set({theme:-1,headerFillOpacity:30,relatedScrollbar:true,hideScrollbar:true});
    await page.waitForFunction(()=>document.documentElement.dataset.biliAmbientTone==="light" && document.documentElement.style.getPropertyValue("--bili-ambient-header-glass")==="0.3");
    assert.equal(await page.locator("header").evaluate(e=>getComputedStyle(e,"::before").backgroundColor),"rgba(17, 20, 28, 0.3)");
    assert.equal(await page.locator(".recommend-list-v1").evaluate(e=>getComputedStyle(e).overflowY),"auto");
    await set({theme:0,headerFillOpacity:8,relatedScrollbar:false,hideScrollbar:false});
  });
  await check("statistics expose real render resolution and bar readings",async()=>{
    await set({showFPS:true,showFrametimes:true,showResolutions:true,showBarDetectionStats:true});
    await page.locator(".bili-ambient-stats").waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector(".bili-ambient-stats").textContent.includes("采样 160×90"));
    assert.match(await page.locator(".bili-ambient-stats").textContent(),/边框/);await page.screenshot({path:resolve(results,"statistics.png")});
  });
  await check("navigation popovers blur page pixels beyond the navigation bar bounds",async()=>{
    await page.evaluate(()=>{
      const pattern=document.createElement('div');pattern.id='glass-pattern';pattern.style.cssText='position:fixed;left:1120px;top:200px;width:128px;height:128px;z-index:5;background:repeating-linear-gradient(to right,#000 0 4px,#fff 4px 8px)';document.body.append(pattern);
      const popup=document.createElement('div');popup.id='glass-popover';popup.className='v-popover-content';popup.style.cssText='position:absolute;left:1120px;top:200px;width:128px;height:128px;background:rgba(20,23,31,.12)';document.querySelector('header').append(popup);
    });
    const contrast=async()=>{
      const screen=await page.screenshot();
      const a=averagePNG(screen,{x:1178,y:252,width:1,height:1});
      const b=averagePNG(screen,{x:1182,y:252,width:1,height:1});
      return Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
    };
    for(const name of ['bili-header__bar','link-navbar-ctnr']) {
      await page.locator('header').evaluate((e,name)=>e.className=name,name);
      await set({glassBlur:0});await page.waitForFunction(()=>getComputedStyle(document.querySelector('#glass-popover')).backdropFilter==='blur(0px)');assert.ok(await contrast()>150);
      await set({glassBlur:24});await page.waitForFunction(()=>getComputedStyle(document.querySelector('#glass-popover')).backdropFilter==='blur(24px)');
      const difference=await contrast();assert.ok(difference<12,`${name}: adjacent stripe contrast is ${difference}`);
    }
    await page.locator('header').evaluate(e=>e.className='bili-header__bar');
    await page.locator('#glass-pattern').evaluate(e=>e.remove());await page.locator('#glass-popover').evaluate(e=>e.remove());
  });
  await check("message text retains reading contrast across bright and dark site palettes",async()=>{
    const messages=await context.newPage();
    try {
      await messages.goto('https://message.bilibili.com/');
      await messages.waitForFunction(()=>document.documentElement.hasAttribute('data-bili-ambient'));
      const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const measurements=[];
      for(const [name,theme,tone,palette] of [['auto-dark',0,'dark',[[42,94,128],[104,69,133],[37,64,91]]],['auto-light',0,'light',[[250,240,250],[240,250,240],[250,250,240]]],['forced-dark',1,'dark',[[250,240,250],[240,250,240],[250,250,240]]],['forced-light',-1,'light',[[0,0,0],[0,0,0],[0,0,0]]]]) {
        await set({theme,sitePalette:palette,glassBlur:40});
        await messages.waitForFunction(tone=>document.documentElement.dataset.biliAmbientTone===tone,tone);
        await messages.waitForTimeout(500);
        const screen=await messages.screenshot({path:resolve(results,`message-${name}.png`)});
        for(const [role,suffix] of [['primary',':not(.secondary):not(.tertiary)'],['secondary','.secondary'],['tertiary','.tertiary']]) {
          const area=selector=>messages.locator(selector+suffix).boundingBox();
          const ink=averagePNG(screen,await area('.contrast-probe'));
          const background=averagePNG(screen,await area('.blank-probe'));
          const ratio=contrast(ink,background);
          measurements.push({name,role,ink,background,contrast:ratio});
          assert.ok(ratio>=4.5,`${tone}${suffix}: reading contrast ${ratio.toFixed(2)} (${ink} / ${background})`);
        }
        const clear=await messages.locator('.reading-probe').evaluate(e=>{
          const chain=[];for(let node=e;node&&node!==document.body;node=node.parentElement){const s=getComputedStyle(node);chain.push({filter:s.filter,backdrop:s.backdropFilter,shadow:s.textShadow});}return chain;
        });
        assert.ok(clear.every(s=>s.filter==='none'&&s.shadow==='none'),JSON.stringify(clear));
        assert.equal(await messages.locator('.msg-text-is-me').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(0, 174, 236)');
        await messages.getByLabel('消息输入').fill('测试输入');
        assert.equal(await messages.getByLabel('消息输入').inputValue(),'测试输入');
      }
      await writeFile(resolve(results,'message-contrast.json'),JSON.stringify(measurements,null,2));
      await set({enabled:false});await messages.waitForFunction(()=>!document.documentElement.hasAttribute('data-bili-ambient'));
      assert.equal(await messages.locator('.reading-probe').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
    } finally {await messages.close();await set({enabled:true,theme:0,glassBlur:24,sitePalette:[[42,94,128],[104,69,133],[37,64,91]]});}
  });
  await check("static-scene energy saving reduces actual draw calls",async()=>{
    await scene("solid","#885599");await set({energySaver:true});await page.waitForTimeout(3000);
    const before=await status();assert.ok(before.framerateLimit<=1,JSON.stringify(before));
    await page.waitForTimeout(5500);const after=await status();assert.ok(after.framesRendered-before.framesRendered<=3,`${after.framesRendered-before.framesRendered} draws`);
    await set({energySaver:false,showFPS:false,showFrametimes:false,showResolutions:false,showBarDetectionStats:false});
  });
  await check("embed preference controls an embedded playback page",async()=>{
    await set({enableInEmbed:false});const embed=await context.newPage();await embed.goto("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD");
    await embed.waitForFunction(()=>!document.documentElement.hasAttribute("data-bili-ambient"));
    await set({enableInEmbed:true});await embed.locator("#bili-ambient-layer").waitFor({state:"visible"});await embed.close();
  });
  await check("paused playback stops drawing after layout settles",async()=>{
    await page.locator("video").evaluate(v=>v.pause());await page.waitForTimeout(150);const before=await status();await page.waitForTimeout(500);
    assert.equal((await status()).framesRendered,before.framesRendered);await page.locator("video").evaluate(v=>v.play());
  });
  await check("pausing captures fresh reading pixels before returning to idle",async()=>{
    await scene('solid','#dddddd');
    const session=await context.newCDPSession(page),worlds=[];
    session.on('Runtime.executionContextCreated',({context})=>worlds.push(context.id));await session.send('Runtime.enable');
    let world;const run=async expression=>{const r=await session.send('Runtime.evaluate',{contextId:world,expression,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    for(const id of worlds){world=id;if(await run("typeof BiliAmbientInspection==='function'"))break;}
    await run("globalThis.pauseInspection=0;globalThis.pauseRequest=BiliAmbientInspection.prototype.request;BiliAmbientInspection.prototype.request=function(...args){if(document.querySelector('video').paused)pauseInspection++;return pauseRequest.apply(this,args);}");
    try{
      await page.locator('video').evaluate(v=>v.pause());await page.waitForTimeout(350);
      const requests=await run('pauseInspection');assert.ok(requests>0,String(requests));
      const before=(await status()).framesRendered;await page.waitForTimeout(350);assert.equal((await status()).framesRendered,before);
      measurements.pauseInspection={requests,frames:before};
    }finally{await run('BiliAmbientInspection.prototype.request=pauseRequest');await page.locator('video').evaluate(v=>v.play());await session.detach();}
  });
  await check("resolution scaling changes the real render buffers",async()=>{
    const original=(await status()).settings;
    await set({resolution:200});await page.waitForFunction(()=>document.querySelector(".bili-ambient-frame").width===320);
    assert.equal(await page.locator(".bili-ambient-output").evaluate(c=>c.width),256);
    await set({blur:0,readingBlur:0});await page.waitForFunction(()=>document.querySelector(".bili-ambient-output").width===320);
    await set({resolution:100,blur:original.blur,readingBlur:original.readingBlur});
  });
  await check("video synchronization, noise and graphics workarounds restore the native player",async()=>{
    await set({videoOverlayEnabled:true,videoDebandingStrength:50,chromiumBugVideoJitterWorkaround:true,chromiumDirectVideoOverlayWorkaround:true});
    await page.locator(".bili-ambient-video-sync").waitFor({state:"visible"});await page.locator(".bili-ambient-video-noise").waitFor({state:"visible"});
    assert.equal(await page.locator("video").evaluate(v=>getComputedStyle(v).opacity),"0.001");assert.equal((await status()).videoOverlay,true);
    assert.equal(await page.locator(".bili-ambient-video-sync").evaluate(c=>getComputedStyle(c).pointerEvents),"none");
    await page.getByRole("button",{name:"全屏",exact:true}).click();await page.waitForFunction(()=>document.fullscreenElement?.contains(document.querySelector(".bili-ambient-video-sync")));
    await page.evaluate(()=>document.exitFullscreen());
    await set({videoOverlayEnabled:false,videoDebandingStrength:0,chromiumBugVideoJitterWorkaround:false,chromiumDirectVideoOverlayWorkaround:false});
    await page.locator(".bili-ambient-video-sync").waitFor({state:"detached"});assert.equal(await page.locator("video").evaluate(v=>getComputedStyle(v).opacity),"1");
  });
  await check("video overlay drop protection returns to native video",async()=>{
    const session=await context.newCDPSession(page),worlds=[];
    session.on('Runtime.executionContextCreated',({context})=>worlds.push(context.id));await session.send('Runtime.enable');
    let world;const run=async expression=>{const r=await session.send('Runtime.evaluate',{contextId:world,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    for(const id of worlds){world=id;if(await run("typeof BiliAmbientVideoEffects==='function'"))break;}
    assert.equal(await run("typeof BiliAmbientVideoEffects"),'function');
    await run("(()=>{const video=document.querySelector('video');globalThis.overlayQuality=video.getVideoPlaybackQuality;globalThis.overlayProbeFrames=0;video.getVideoPlaybackQuality=()=>({totalVideoFrames:overlayProbeFrames+=10,droppedVideoFrames:Math.floor(overlayProbeFrames*.5)});})()");
    try {
      await set({videoOverlayEnabled:true,videoOverlaySyncThreshold:5});
      const protectedFrame=await run("new Promise(resolve=>{const finish=value=>{clearInterval(timer);clearTimeout(timeout);resolve(value);};const timer=setInterval(()=>{if(overlayProbeFrames>=20 && !document.querySelector('video').classList.contains('bili-ambient-synchronized'))finish(true);},16);const timeout=setTimeout(()=>finish(false),3000);})");
      assert.ok(protectedFrame);assert.equal((await status()).videoOverlay,false);
      measurements.dropProtection=await run('({observedFrames:overlayProbeFrames,threshold:5})');
    } finally {
      await set({videoOverlayEnabled:false});await run("document.querySelector('video').getVideoPlaybackQuality=overlayQuality");await session.detach();
    }
  });
  await check("HDR filters apply by selection and player metadata",async()=>{
    await set({hdrMode:1,hdrBrightness:80,hdrContrast:90,hdrSaturation:120});
    await page.waitForFunction(()=>document.querySelector(".bili-ambient-output").style.filter.includes("brightness(80%)"));assert.equal((await status()).hdr,true);
    await scene("solid","#ffffff");await set({hdrBrightness:100,hdrContrast:100});await page.waitForFunction(()=>document.documentElement.dataset.biliAmbientTone==="light");
    await set({hdrBrightness:0});await page.waitForFunction(()=>document.documentElement.dataset.biliAmbientTone==="dark");await set({hdrBrightness:100});
    await page.evaluate(()=>document.documentElement.setAttribute("data-video-hdr",""));await set({hdrMode:0});await page.waitForTimeout(150);assert.equal((await status()).hdr,true);
    await page.evaluate(()=>document.documentElement.removeAttribute("data-video-hdr"));await set({hdrMode:2});await page.waitForTimeout(150);assert.equal((await status()).hdr,false);
    await set({hdrMode:0,hdrBrightness:100,hdrContrast:100,hdrSaturation:100});
  });
  await check("VR surface follows camera changes while the media is paused",async()=>{
    await page.evaluate(()=>{const v=document.querySelector("video");v.pause();v.style.display="none";const c=document.createElement("canvas");c.width=640;c.height=360;c.style.cssText="position:absolute;inset:0;width:100%;height:100%";c.className="test-vr-surface";v.parentElement.append(c);const ctx=c.getContext("2d");ctx.fillStyle="#ff0000";ctx.fillRect(0,0,640,360);});
    await page.waitForTimeout(500);assert.equal((await status()).vr,true);const vrPixel=await raw();assert.ok(vrPixel[0]>200,JSON.stringify({pixel:vrPixel,status:await status(),frame:await page.locator(".bili-ambient-frame").evaluate(c=>Array.from(c.getContext("2d").getImageData(0,0,1,1).data))}));
    await page.locator(".test-vr-surface").evaluate(c=>{const ctx=c.getContext("2d");ctx.fillStyle="#0000ff";ctx.fillRect(0,0,640,360);});await page.waitForTimeout(350);assert.ok((await raw())[2]>200);
    await set({enableInVRVideos:false});await page.waitForFunction(()=>document.querySelector("#bili-ambient-layer").dataset.state==="view");
    await set({enableInVRVideos:true});await page.locator("#bili-ambient-layer").waitFor({state:"visible"});
    await page.evaluate(()=>{document.querySelector(".test-vr-surface").remove();const v=document.querySelector("video");v.style.display="";v.play();});await page.waitForTimeout(350);assert.equal((await status()).vr,false);
  });
  await check("shortcuts toggle their option and ignore editable fields",async()=>{
    const before=(await status()).settings.detectHorizontalBarSizeEnabled;await page.keyboard.press("b");await page.waitForTimeout(150);assert.equal((await status()).settings.detectHorizontalBarSizeEnabled,!before);
    await page.evaluate(()=>{const input=document.createElement("input");input.id="test-key-input";document.body.append(input);input.focus();});await page.keyboard.press("b");await page.waitForTimeout(150);assert.equal((await status()).settings.detectHorizontalBarSizeEnabled,!before);
    await page.locator("#test-key-input").evaluate(e=>e.remove());await set({detectHorizontalBarSizeEnabled:before});
  });
  await check("a replacement media source resets manual clipping",async()=>{
    await set({horizontalBarsClipPercentage:10,horizontalBarsClipPercentageReset:true});await page.waitForTimeout(150);
    await page.locator("video").evaluate(async v=>{v.srcObject.getTracks().forEach(t=>t.stop());await window.attachSource(v);});await page.waitForTimeout(300);
    assert.equal((await status()).settings.horizontalBarsClipPercentage,0);
  });
  await check("JSON backup restores settings and opt-in browser synchronization propagates",async()=>{
    const popup=await context.newPage();await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const downloadPromise=popup.waitForEvent("download");await popup.getByRole("button",{name:"导出设置",exact:true}).click();const download=await downloadPromise;
    const backup=JSON.parse(await readFile(await download.path(),"utf8"));assert.equal(backup.settings.resolution,100);
    await popup.getByLabel("导入设置",{exact:true}).setInputFiles({name:"settings.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({settings:{contrast:133,enabled:true}}))});
    await page.waitForTimeout(150);assert.equal((await status()).settings.contrast,133);
    await popup.getByLabel("搜索高级设置").fill("同步设置");await popup.getByLabel("通过浏览器账号同步设置",{exact:true}).check();
    await worker.evaluate(()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{clearInterval(timer);reject(new Error("settings did not reach sync storage"));},5000);const timer=setInterval(async()=>{const {profile}=await chrome.storage.sync.get("profile");if(profile?.contrast===133){clearInterval(timer);clearTimeout(timeout);resolve();}},50);}));
    await worker.evaluate(()=>chrome.storage.sync.set({profile:{contrast:144,enabled:true}}));await page.waitForTimeout(250);assert.equal((await status()).settings.contrast,144);
    await popup.getByLabel("通过浏览器账号同步设置",{exact:true}).uncheck();await set({contrast:100});await popup.close();
  });
  await check("advanced settings search edits and persists the selected control",async()=>{
    const popup=await context.newPage();popup.on("pageerror",e=>errors.push(e.message));await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.getByLabel("搜索高级设置").fill("渐隐曲线");await popup.getByLabel("边缘渐隐曲线",{exact:true}).fill("60");
    await popup.getByLabel("边缘渐隐曲线",{exact:true}).dispatchEvent("change");
    await page.waitForFunction(()=>document.querySelector(".bili-ambient-halo canvas").style.maskImage.includes("gradient"));
    await popup.reload();await popup.getByLabel("搜索高级设置").fill("渐隐曲线");assert.equal(await popup.getByLabel("边缘渐隐曲线",{exact:true}).inputValue(),"60");await popup.screenshot({path:resolve(results,"advanced-settings.png")});await popup.close();
  });
  await check("the player menu edits real settings and remains usable when the effect is disabled",async()=>{
    await page.getByRole("button",{name:"氛围光设置",exact:true}).click();
    const menu=page.locator("#bili-ambient-menu");await menu.getByRole("dialog",{name:"氛围光设置",exact:true}).waitFor({state:"visible"});
    await menu.getByLabel("光效亮度",{exact:true}).fill("117");await menu.getByLabel("光效亮度",{exact:true}).dispatchEvent("change");
    await page.waitForFunction(()=>document.querySelector(".bili-ambient-output").style.filter.includes("brightness(117%)"));
    assert.equal((await status()).settings.brightness,117);
    await set({enabled:false});await page.waitForFunction(()=>!document.documentElement.hasAttribute("data-bili-ambient"));
    assert.equal(await menu.getByLabel("开启氛围光",{exact:true}).isChecked(),false);
    await menu.getByLabel("开启氛围光",{exact:true}).check();await page.locator("#bili-ambient-layer").waitFor({state:"visible"});
    await page.keyboard.press("Escape");assert.equal(await menu.getAttribute("data-open"),null);await set({brightness:100});
  });
  await check("the fullscreen player menu closes with Escape while fullscreen stays active",async()=>{
    await page.getByRole("button",{name:"全屏",exact:true}).click();await page.getByRole("button",{name:"氛围光设置",exact:true}).click();
    await page.waitForFunction(()=>document.fullscreenElement?.contains(document.querySelector("#bili-ambient-menu")));
    await page.keyboard.press("Escape");assert.equal(await page.evaluate(()=>Boolean(document.fullscreenElement)),true);
    assert.equal(await page.locator("#bili-ambient-menu").getAttribute("data-open"),null);await page.evaluate(()=>document.exitFullscreen());
  });
  await check("leaving playback moves settings to the site launcher and returning restores it",async()=>{
    await set({siteVideoPreviews:false});
    await page.evaluate(()=>history.pushState({},"","/"));await page.waitForFunction(()=>document.querySelector('.bili-ambient-settings-button')?.dataset.site==='true');
    await page.evaluate(()=>history.pushState({},"","/video/BV1xx411c7mD/"));await page.getByRole("button",{name:"氛围光设置",exact:true}).waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector('.bili-ambient-settings-button')?.dataset.site==='false');await set({siteVideoPreviews:true});
  });
  await check("live rooms receive projection and translucent chat without changing video pixels",async()=>{
    const live=await context.newPage();live.on("pageerror",e=>errors.push(e.message));await live.goto("https://live.bilibili.com/26966466");await live.locator("#bili-ambient-layer").waitFor({state:"visible"});
    const style=await live.locator(".chat-history-panel").evaluate(e=>({color:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));
    assert.equal(style.color,"rgba(255, 255, 255, 0.08)");assert.equal(style.blur,"blur(24px)");
    assert.equal(await live.locator("video").evaluate(v=>getComputedStyle(v).opacity),"1");
    await live.getByRole("button",{name:"氛围光设置",exact:true}).click();await live.locator("#bili-ambient-menu").getByRole("dialog").waitFor({state:"visible"});await live.close();
  });
  await check("frame blending interpolates low-frame-rate media and settles without accumulated trails",async()=>{
    await set({frameBlending:true,frameBlendingSmoothness:100,frameSync:0,smoothing:0,fps:60});
    await page.evaluate(async()=>{const c=document.createElement("canvas");c.width=64;c.height=36;const ctx=c.getContext("2d");ctx.fillStyle="#ff0000";ctx.fillRect(0,0,64,36);window.blendTestCanvas=c;const v=document.querySelector("video");v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=c.captureStream(6);await v.play();});
    await page.waitForFunction(()=>{const c=document.querySelector(".bili-ambient-frame");return c.getContext("2d").getImageData(0,0,1,1).data[0]>240;});
    // Establish a six-FPS source interval before measuring the color transition.
    await page.waitForTimeout(200);
    const samples=await page.evaluate(()=>new Promise(resolve=>{const c=window.blendTestCanvas,ctx=c.getContext("2d");ctx.fillStyle="#0000ff";ctx.fillRect(0,0,64,36);document.querySelector("video").srcObject.getVideoTracks()[0].requestFrame();const start=performance.now(),samples=[];function read(){const frame=document.querySelector(".bili-ambient-frame");samples.push(Array.from(frame.getContext("2d").getImageData(0,0,1,1).data));if(performance.now()-start>700)resolve(samples);else requestAnimationFrame(read);}requestAnimationFrame(read);}));
    const source=await page.locator("video").evaluate(v=>{const c=document.createElement("canvas");c.width=c.height=1;const ctx=c.getContext("2d");ctx.drawImage(v,0,0,1,1);return {pixels:Array.from(ctx.getImageData(0,0,1,1).data),quality:v.getVideoPlaybackQuality(),paused:v.paused,currentTime:v.currentTime};});
    assert.ok(samples.some(rgb=>rgb[0]>20 && rgb[2]>20),JSON.stringify({samples,source,status:await status()}));assert.ok(samples.at(-1)[2]>240 && samples.at(-1)[0]<5);
    await page.locator("video").evaluate(async v=>{v.srcObject.getTracks().forEach(t=>t.stop());await window.attachSource(v);});
    await set({frameBlending:false,frameBlendingSmoothness:80,frameSync:2,fps:24});
  });
  assert.deepEqual(errors,[]);await writeFile(resolve(results,"results.json"),JSON.stringify({checks,errors,measurements},null,2));
  console.log(`${checks.length}/${checks.length} advanced checks passed.`);
} finally { await context.close(); }
