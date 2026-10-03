importScripts("settings.js");
let syncQueue=Promise.resolve();
const config=globalThis.BiliAmbientSettings;
const syncProfile=values=>{const profile=config.normalize(values);delete profile.syncSettings;return profile;};
function syncSettings(){
  syncQueue=syncQueue.then(async()=>{
    const local=await chrome.storage.local.get(null);
    if(!local.syncSettings)return;
    const profile=syncProfile(local),cloud=await chrome.storage.sync.get("profile");
    if(JSON.stringify(cloud.profile)!==JSON.stringify(profile))await chrome.storage.sync.set({profile});
    await chrome.storage.local.set({syncStatus:"saved"});
  }).catch(async()=>{await chrome.storage.local.set({syncStatus:"error"});});
}
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if(area==="local"){
    if(Object.keys(changes).some(key=>Object.hasOwn(config.defaults,key)))syncSettings();
  }else if(area==="sync" && changes.profile?.newValue){
    const {syncSettings:enabled}=await chrome.storage.local.get("syncSettings");
    if(enabled)await chrome.storage.local.set({...syncProfile(changes.profile.newValue),appearanceVersion:3});
  }
});
chrome.storage.local.get("syncSettings").then(async values=>{
  if(!values.syncSettings)return;
  const {profile}=await chrome.storage.sync.get("profile");
  if(profile)await chrome.storage.local.set({...syncProfile(profile),appearanceVersion:3});else syncSettings();
}).catch(()=>{});
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-ambient") return;
  const { enabled = true } = await chrome.storage.local.get("enabled");
  await chrome.storage.local.set({ enabled: !enabled });
});
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.type!=="bili-ambient:open-options")return;
  chrome.runtime.openOptionsPage().then(()=>sendResponse({opened:true})).catch(()=>sendResponse({opened:false}));return true;
});
