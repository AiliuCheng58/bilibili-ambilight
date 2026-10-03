import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let playwright;try{playwright=await import('playwright');}catch(error){if(!process.env.BILI_TEST_MODULES)throw error;playwright=createRequire(resolve(process.env.BILI_TEST_MODULES,'package.json'))('playwright');}
const results=resolve(process.env.BILI_TEST_RESULTS || resolve(root,'test-results/site'));
await mkdir(results,{recursive:true});
const fixture=await readFile(resolve(root,'tests/site-fixture.html'),'utf8');
const context=await playwright.chromium.launchPersistentContext(resolve(results,'profile'),{headless:true,channel:'chromium',executablePath:process.env.BILI_TEST_BROWSER||undefined,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${resolve(root,'dist')}`,`--load-extension=${resolve(root,'dist')}`,'--autoplay-policy=no-user-gesture-required']});
const checks=[],errors=[];
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);};
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.clear());
  await context.route(/^https?:\/\/[^/]+\//,route=>route.fulfill({contentType:'text/html',body:fixture}));
  const previousTabs=await worker.evaluate(async()=> (await chrome.tabs.query({})).map(t=>t.id));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const mainTabId=await worker.evaluate(async old=>(await chrome.tabs.query({})).find(t=>!old.includes(t.id)).id,previousTabs);
  const set=values=>worker.evaluate(values=>chrome.storage.local.set(values),values);
  const status=()=>worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'bili-ambient:status'}),mainTabId);
  const active=p=>p.waitForFunction(()=>document.documentElement.hasAttribute('data-bili-ambient')&&document.querySelector('#bili-ambient-site-backdrop')?.dataset.visible==='true');
  await check('MV3 injects the site theme on the apex and every Bilibili subdomain',async()=>{
    for(const url of ['https://bilibili.com/','https://www.bilibili.com/','https://search.bilibili.com/all?keyword=music','https://space.bilibili.com/123','https://t.bilibili.com/','https://live.bilibili.com/','https://www.bilibili.com/c/music/','https://www.bilibili.com/read/home/','https://www.bilibili.com/opus/123','https://account.bilibili.com/','https://message.bilibili.com/','https://member.bilibili.com/','https://show.bilibili.com/','https://manga.bilibili.com/','https://new.site.bilibili.com/','http://www.bilibili.com/']){
      await page.goto(url);await active(page);assert.equal((await status(page)).state,'site',url);
    }
  });
  await check('lookalike domains receive no script or page styling',async()=>{
    await page.goto('https://bilibili.com.evil.test/');assert.equal(await page.locator('#bili-ambient-site-backdrop').count(),0);
    await page.goto('https://www.bilibili.com/');await active(page);
  });
  await check('static pages use a fixed background without allocating the video renderer',async()=>{
    assert.equal(await page.locator('#bili-ambient-layer').count(),0);
    assert.equal(await page.locator('#bili-ambient-site-backdrop').evaluate(e=>getComputedStyle(e).position),'fixed');
    const before=await status(page);await page.waitForTimeout(400);assert.equal((await status(page)).framesRendered,before.framesRendered);
  });
  await check('neutral surfaces become glass while media, QR codes and brand colors remain clear',async()=>{
    await page.waitForFunction(()=>document.querySelector('.unknown-panel').hasAttribute('data-bili-ambient-surface'));
    assert.equal(await page.locator('.unknown-panel').first().evaluate(e=>getComputedStyle(e).backdropFilter),'blur(24px)');
    assert.equal(await page.locator('.badge').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
    assert.equal(await page.locator('.qr-code').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
    assert.equal(await page.locator('.cover').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
    assert.equal(await page.locator('.cover').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
    await page.evaluate(()=>{const panel=document.createElement('section');panel.className='geetest_panel_box';panel.style.cssText='width:300px;height:180px;background:white;color:black';panel.innerHTML='<input style="background:white;color:black" aria-label="验证输入">';document.querySelector('#result').append(panel);});
    await page.waitForTimeout(150);assert.equal(await page.locator('.geetest_panel_box [data-bili-ambient-surface]').count(),0);
    assert.equal(await page.getByLabel('验证输入').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
  });
  await check('forms and page controls stay interactive and newly inserted results receive glass',async()=>{
    await page.getByLabel('关键词').fill('音乐');await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#result .unknown-panel')?.hasAttribute('data-bili-ambient-surface'));
    await page.locator('#counter').click();assert.equal(await page.locator('#count').textContent(),'1');
    assert.equal(await page.locator('#result').textContent(),'音乐');
    await page.evaluate(()=>{const span=document.createElement('span');span.id='selected-label';span.textContent='选项';document.querySelector('#result .unknown-panel').append(span);});
    await page.waitForFunction(()=>document.querySelector('#selected-label').hasAttribute('data-bili-ambient-ink'));
    await page.locator('#result .unknown-panel').evaluate(e=>{e.style.backgroundColor='#00aeec';e.style.color='#fff';});
    await page.waitForFunction(()=>!document.querySelector('#selected-label').hasAttribute('data-bili-ambient-ink'));
    assert.equal(await page.locator('#selected-label').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
    await page.locator('#result .unknown-panel').evaluate(e=>e.removeAttribute('style'));
  });
  await check('scrolling keeps the background anchor and long page surfaces themed',async()=>{
    const before=await page.locator('.bili-ambient-site-field').getAttribute('style');
    await page.locator('.lower').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.lower').hasAttribute('data-bili-ambient-surface'));
    assert.equal(await page.locator('.bili-ambient-site-field').getAttribute('style'),before);
    await page.evaluate(()=>scrollTo(0,0));
  });
  await check('the global settings launcher works before any player exists and can toggle the effect',async()=>{
    await page.getByRole('button',{name:'氛围光设置',exact:true}).click();const menu=page.locator('#bili-ambient-menu');
    await menu.getByRole('dialog',{name:'氛围光设置',exact:true}).waitFor({state:'visible'});
    await menu.getByLabel('开启氛围光',{exact:true}).uncheck();await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-bili-ambient'));
    assert.equal(await page.locator('[data-bili-ambient-surface]').count(),0);
    assert.equal(await page.locator('.unknown-panel').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
    await menu.getByLabel('开启氛围光',{exact:true}).check();await active(page);await page.keyboard.press('Escape');
  });
  await check('the site theme switch restores static pages and preserves playback support',async()=>{
    await set({siteThemeEnabled:false});await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-bili-ambient'));
    assert.equal(await page.locator('#bili-ambient-site-backdrop').isVisible(),false);
    await set({siteThemeEnabled:true});await active(page);
  });
  await check('valid stored colors propagate across site tabs and survive navigation',async()=>{
    const palette=[[230,110,175],[90,180,210],[95,80,150]];await set({sitePalette:palette});
    await page.waitForFunction(()=>document.querySelector('.bili-ambient-site-field').style.background.includes('230, 110, 175'));
    const other=await context.newPage();await other.goto('https://search.bilibili.com/all');await active(other);
    assert.match(await other.locator('.bili-ambient-site-field').getAttribute('style'),/230, 110, 175/);
    await set({sitePalette:[[250,220,230],[220,240,245],[240,220,250]]});
    await page.waitForFunction(()=>document.documentElement.dataset.biliAmbientTone==='light');
    await other.waitForFunction(()=>document.documentElement.dataset.biliAmbientTone==='light');
    await page.screenshot({path:resolve(results,'site-light.png')});await other.close();
  });
  await check('malformed stored palette is safely replaced with the default colors',async()=>{
    await set({sitePalette:[[999,-4,'bad']]});await page.waitForFunction(()=>document.querySelector('.bili-ambient-site-field').style.background.includes('42, 94, 128'));
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.biliAmbientTone),'dark');
  });
  await check('visible playing previews switch to realtime projection and save only three colors',async()=>{
    await page.evaluate(()=>window.startPreview());await page.locator('#bili-ambient-layer').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#bili-ambient-layer').dataset.state==='active');
    const saved=await worker.evaluate(()=>chrome.storage.local.get('sitePalette'));
    assert.equal(saved.sitePalette.length,3);assert(saved.sitePalette.every(c=>c.length===3&&c.every(Number.isInteger)));
    assert((await status(page)).framesRendered>0);
  });
  await check('preview disabling, pausing and scrolling out of view return to the static site background',async()=>{
    await set({siteVideoPreviews:false});await active(page);
    await set({siteVideoPreviews:true});await page.locator('#bili-ambient-layer').waitFor({state:'visible'});
    await page.evaluate(()=>{window.previewColor='#2040e0';});
    await page.waitForFunction(()=>{const rgb=document.querySelector('.bili-ambient-site-field').style.background.match(/rgb\((\d+), (\d+), (\d+)\)/);return rgb&&Number(rgb[3])>Number(rgb[1])+100;});
    await page.locator('video').evaluate(v=>v.pause());await active(page);
    await page.waitForFunction(()=>document.querySelector('.bili-ambient-settings-button')?.dataset.site==='true');
    const saved=await worker.evaluate(()=>chrome.storage.local.get('sitePalette'));assert(saved.sitePalette[0][2]>saved.sitePalette[0][0]+100);
    await page.locator('video').evaluate(v=>v.play());await page.locator('#bili-ambient-layer').waitFor({state:'visible'});
    await page.locator('.lower').scrollIntoViewIfNeeded();await active(page);
    await page.waitForFunction(()=>document.querySelector('.bili-ambient-settings-button')?.dataset.site==='true');assert.equal((await status(page)).connected,false);
    await page.evaluate(()=>scrollTo(0,0));await page.locator('#bili-ambient-layer').waitFor({state:'visible'});
  });
  await check('same-document playback and static routes keep the page theme through player replacement',async()=>{
    await page.evaluate(()=>{document.querySelector('#preview-holder').classList.add('bpx-player-container');history.pushState({},'','/video/BV123/');});
    await page.waitForTimeout(1100);await page.locator('video').evaluate(v=>v.pause());await page.waitForFunction(()=>document.querySelector('#bili-ambient-layer').dataset.state==='paused');
    await page.locator('#preview-holder').evaluate(e=>e.classList.add('bpx-state-wide'));await set({immersiveTheaterView:true});
    await page.waitForFunction(()=>document.documentElement.dataset.biliAmbientView==='THEATER');
    await page.evaluate(()=>{document.querySelector('video').remove();clearInterval(window.previewTimer);history.pushState({},'','/');});await active(page);
    assert.equal(await page.locator('html').getAttribute('data-bili-ambient-view'),null);assert.equal(await page.locator('.bili-header__bar').isVisible(),true);await set({immersiveTheaterView:false});
    assert.equal(await page.locator('.bili-ambient-settings-button').getAttribute('data-site'),'true');
    await page.screenshot({path:resolve(results,'site-dark.png')});
  });
  await check('Bilibili child frames receive the global theme without duplicate floating launchers',async()=>{
    await page.evaluate(()=>{const f=document.createElement('iframe');f.src='https://search.bilibili.com/frame';document.querySelector('#result').append(f);});
    const frame=page.frameLocator('iframe');await frame.locator('#bili-ambient-site-backdrop').waitFor({state:'attached'});
    assert.equal(await frame.locator('.bili-ambient-settings-button').count(),0);
    assert.equal(await frame.locator('html').getAttribute('data-bili-ambient'),'');
  });
  assert.deepEqual(errors,[]);await writeFile(resolve(results,'results.json'),JSON.stringify({checks,errors},null,2));console.log(`${checks.length}/${checks.length} site checks passed.`);
}catch(error){await writeFile(resolve(results,'results.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));throw error;}finally{await context.close();}
