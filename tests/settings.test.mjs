import test from "node:test";
import assert from "node:assert/strict";
import "../src/settings.js";

const { normalize, defaults, isPlaybackPage, fitRect } = globalThis.BiliAmbientSettings;
test("appearance schema initialization keeps the enabled state and performance choices", async () => {
  let saved;
  const old = { enabled: false, fps: 12, quality: 96, brightness: 80, dim: 55 };
  const storage = { get: async () => old, set: async values => { saved = values; } };
  const settings = await globalThis.BiliAmbientSettings.load(storage);
  assert.deepEqual(settings, { ...defaults, enabled: false, fps: 12, quality: 96 });
  assert.equal(saved.appearanceVersion, 4);
  const current = { ...saved, brightness: 133, dim: 15 };
  assert.equal((await globalThis.BiliAmbientSettings.load({ get: async () => current })).brightness, 133);
});
test("motion defaults migrate as a group and preserve customized performance settings", async () => {
  const load = async values => {
    let saved;
    const settings = await globalThis.BiliAmbientSettings.load({ get: async () => values, set: async next => { saved = next; } });
    return { settings, saved };
  };
  const legacy = { ...defaults, appearanceVersion: 3, fps: 24, smoothing: 70, frameSync: 2, brightness: 133 };
  const migrated = await load(legacy);
  assert.equal(migrated.settings.fps, 0);
  assert.equal(migrated.settings.smoothing, 0);
  assert.equal(migrated.settings.frameSync, 1);
  assert.equal(migrated.settings.brightness, 133);
  assert.equal(migrated.saved.appearanceVersion, 4);
  const custom = await load({ ...legacy, fps: 12 });
  assert.equal(custom.settings.fps, 12);
  assert.equal(custom.settings.smoothing, 70);
  const current = await load({ ...legacy, appearanceVersion: 4 });
  assert.equal(current.settings.fps, 24);
  assert.equal(current.saved, undefined);
});
test("corrupt or out-of-range storage cannot create unbounded render settings", () => {
  assert.deepEqual(normalize(null), defaults);
  assert.equal(normalize({ fps: Infinity }).fps, defaults.fps);
  assert.equal(normalize({ blur: "500" }).blur, defaults.blur);
  assert.equal(normalize({ enabled: "false" }).enabled, true);
  assert.equal(normalize({ brightness: -10, fps: 100 }).brightness, 0);
  assert.equal(normalize({ brightness: -10, fps: 100 }).fps, 60);
  assert.equal(normalize({ spread: 40.7 }).spread, 41);
  assert.equal("unknown" in normalize({ unknown: 1 }), false);
});
test("only supported Bilibili playback routes activate the renderer", () => {
  for (const url of ["https://www.bilibili.com/video/BV1xx411c7mD/?p=2", "https://www.bilibili.com/bangumi/play/ep123", "https://www.bilibili.com/cheese/play/ep123", "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD", "https://live.bilibili.com/123", "https://live.bilibili.com/blanc/123"]) assert.equal(isPlaybackPage(url), true, url);
  for (const url of ["https://www.bilibili.com/", "https://www.bilibili.com/video", "https://live.bilibili.com/", "https://live.bilibili.com/p/eden/area-tags", "https://www.bilibili.com.evil.test/video/1", "http://www.bilibili.com/video/1", "invalid"]) assert.equal(isPlaybackPage(url), false, url);
});
test("fullscreen projection preserves pillarbox and letterbox geometry", () => {
  const rect = { left: 10, top: 20, width: 1920, height: 1080 };
  assert.deepEqual(fitRect(rect, 1440, 1080), { left: 250, top: 20, width: 1440, height: 1080 });
  assert.deepEqual(fitRect(rect, 1920, 800), { left: 10, top: 160, width: 1920, height: 800 });
  assert.equal(fitRect(rect, 0, 0), rect);
  assert.equal(fitRect(rect, 100, 100, "cover"), rect);
  assert.deepEqual(fitRect(rect, 100, 100, "scale-down"), { left: 920, top: 510, width: 100, height: 100 });
});
test("site coverage accepts Bilibili subdomains and rejects lookalike or non-web URLs", () => {
  const {isSitePage} = globalThis.BiliAmbientSettings;
  for (const url of ["https://bilibili.com/", "https://search.bilibili.com/all", "https://space.bilibili.com/123", "https://t.bilibili.com/", "https://member.bilibili.com/", "https://new.site.bilibili.com/", "http://live.bilibili.com/"]) assert.equal(isSitePage(url), true, url);
  for (const url of ["https://bilibili.com.evil.test/", "https://fakebilibili.com/", "https://bilibili.com@evil.test/", "file://bilibili.com/x", "data:text/html,x", "invalid"]) assert.equal(isSitePage(url), false, url);
});
test("backup import accepts known settings while bounding values and rejecting invalid files",()=>{
  const {readBackup}=globalThis.BiliAmbientSettings;
  assert.deepEqual(readBackup({settings:{fps:999,enabled:false,syncSettings:true}}),{fps:60,enabled:false});
  assert.deepEqual(readBackup({framerateLimit:25,blur2:40,"setting-enabled":false}),{fps:25,blur:40,enabled:false});
  assert.throws(()=>readBackup([]));assert.throws(()=>readBackup({unknown:3}));assert.throws(()=>readBackup(null));
});
