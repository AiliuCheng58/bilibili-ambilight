(() => {
  "use strict";
  const config = globalThis.BiliAmbientSettings;
  let settings = { ...config.defaults };
  let pending = {};
  let saveTimer = null;
  let writeQueue = Promise.resolve();
  let syncState = "";
  let syncLabel = null;
  const errorLabel = document.querySelector("#save-error");
  const statusLabel = document.querySelector("#status");
  const percentageKeys = new Set(["brightness", "saturation", "smoothing", "dim", "glassOpacity"]);
  const units = new Map();
  for (const [title, controls] of globalThis.BiliAmbientControls) {
    const group = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = title;
    group.append(summary);
    const section = document.createElement("section");
    section.className = "advanced";
    for (const [key, label, unit] of controls) {
      const row = document.createElement("div");
      row.dataset.search = label;
      const caption = document.createElement("label");
      caption.htmlFor = key;
      const text = document.createElement("span");
      text.textContent = label;
      text.id = `${key}-label`;
      caption.append(text);
      let input;
      if (Array.isArray(unit)) {
        input = document.createElement("select");
        for (const [value, name] of unit) input.add(new Option(name, String(value)));
        caption.append(input);
      } else if (typeof config.defaults[key] === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        caption.append(input);
      } else if (typeof config.defaults[key] === "string") {
        input=document.createElement("input");input.type="text";input.maxLength=1;input.size=2;caption.append(input);
      } else {
        input = document.createElement("input");
        input.type = "range";
        [input.min, input.max, input.step] = config.ranges[key];
        input.step = config.ranges[key][2] || 1;
        const output = document.createElement("output");
        output.id = `${key}-value`;
        output.htmlFor = key;
        caption.append(output);
        units.set(key, unit);
      }
      input.id = key;
      input.setAttribute("aria-labelledby", text.id);
      row.append(caption);
      if (input.type === "range") row.append(input);
      if(key==="syncSettings"){syncLabel=document.createElement("p");syncLabel.setAttribute("role","status");row.append(syncLabel);}
      section.append(row);
    }
    group.append(section);
    document.querySelector("#advanced-groups").append(group);
  }
  document.querySelector("#settings-search").addEventListener("input", event => {
    const query = event.target.value.trim();
    for (const group of document.querySelectorAll("#advanced-groups > details")) {
      for (const row of group.querySelectorAll("[data-search]")) row.hidden = !row.dataset.search.includes(query);
      group.hidden = ![...group.querySelectorAll("[data-search]")].some(row => !row.hidden);
      if (query) group.open = true;
    }
  });
  function render() {
    if(syncLabel){syncLabel.hidden=!settings.syncSettings;syncLabel.textContent=syncState==="error"?"浏览器同步未完成，设置已保存在本机。":syncState==="saved"?"设置已写入浏览器同步存储。":"等待浏览器同步…";}
    for (const [key, value] of Object.entries(settings)) {
      const input = document.getElementById(key);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = value;
      else {
        if (input.tagName === "SELECT" && ![...input.options].some(option => Number(option.value) === value)) {
          input.add(new Option(String(value), String(value)));
        }
        input.value = value;
        if (input.type === "range") input.style.setProperty("--fill", `${100 * (value - Number(input.min)) / (Number(input.max) - Number(input.min))}%`);
      }
      const output = document.getElementById(`${key}-value`);
      if (output) output.value = `${value}${units.get(key) || (percentageKeys.has(key) ? "%" : " px")}`;
    }
    for (const button of document.querySelectorAll("[data-preset]")) {
      const preset = config.presets[button.dataset.preset];
      const selected = Object.keys(config.defaults).filter(key => key !== "enabled" && key !== "syncSettings" && !key.endsWith("Key")).every(key => settings[key] === preset[key]);
      button.setAttribute("aria-pressed", String(selected));
    }
  }
  function flush() {
    clearTimeout(saveTimer);
    const patch = pending;
    pending = {};
    if (!Object.keys(patch).length) return;
    writeQueue = writeQueue.then(async () => {
      await chrome.storage.local.set(patch);
      errorLabel.hidden = true;
      await refreshStatus();
      return true;
    }).catch(() => {
      errorLabel.textContent = "设置未能保存，请重新打开扩展后再试。";
      errorLabel.hidden = false;
      return false;
    });
  }
  function change(patch, immediate = false) {
    settings = config.normalize({ ...settings, ...patch });
    Object.assign(pending, patch);
    render();
    clearTimeout(saveTimer);
    if (immediate) flush();
    else saveTimer = setTimeout(flush, 100);
  }
  async function refreshStatus() {
    if (!settings.enabled) {
      statusLabel.textContent = "氛围光已关闭";
      statusLabel.dataset.connected = "false";
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab");
      const status = await chrome.tabs.sendMessage(tab.id, { type: "bili-ambient:status" }, { frameId: 0 });
      statusLabel.textContent = status.detail;
      statusLabel.dataset.connected = String((status.connected || status.state === "site") && status.state !== "error");
    } catch {
      statusLabel.textContent = "打开 B站页面；安装后请刷新页面";
      statusLabel.dataset.connected = "false";
    }
  }
  for (const key of Object.keys(config.defaults)) {
    const input = document.getElementById(key);
    if (!input) continue;
    if(input.type==="range"){
      const [min,max,step=1]=config.ranges[key];input.min=min;input.max=max;input.step=step;
    }
    input.addEventListener(input.type === "range" ? "input" : "change", () => {
      change({ [key]: input.type === "checkbox" ? input.checked : input.type === "text" ? input.value : Number(input.value) }, input.type !== "range");
    });
    if (input.type === "range") input.addEventListener("change", flush);
  }
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => change({ ...config.presets[button.dataset.preset], ...Object.fromEntries(Object.keys(settings).filter(key=>key.endsWith("Key") || key==="syncSettings" || key==="enabled").map(key=>[key,settings[key]])) }, true));
  }
  document.querySelector("#reset").addEventListener("click", () => change({ ...config.defaults }, true));
  const backupStatus=document.querySelector("#backup-status");
  document.querySelector("#export-settings").addEventListener("click",()=>{
    flush();
    const profile={...settings};delete profile.syncSettings;
    const blob=new Blob([JSON.stringify({format:"bilibili-ambilight",schema:3,settings:profile},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="bilibili-ambilight-settings.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    backupStatus.textContent="设置文件已导出。";
  });
  document.querySelector("#import-settings").addEventListener("change",async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>65536)throw new Error("设置文件超过 64 KB");
      change(config.readBackup(JSON.parse(await file.text())),true);
      if(!await writeQueue)throw new Error("设置未能保存，请重新打开扩展后再试。");backupStatus.textContent="设置已导入并保存。";
    }catch(error){backupStatus.textContent=error instanceof SyntaxError?"设置文件不是有效的 JSON。":error.message;}
    event.target.value="";
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
  window.addEventListener("pagehide", flush);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if("syncStatus" in changes)syncState=changes.syncStatus.newValue || "";
    const patch = {};
    for (const key of Object.keys(config.defaults)) if (key in changes && !(key in pending)) patch[key] = changes[key].newValue ?? config.defaults[key];
    settings = config.normalize({ ...settings, ...patch, ...pending });
    render();
    refreshStatus();
  });
  Promise.all([config.load(chrome.storage.local),chrome.storage.local.get("syncStatus")]).then(([values,metadata]) => {
    syncState=metadata.syncStatus || "";
    settings = config.normalize({ ...values, ...pending });
    render();
    refreshStatus();
  }).catch(() => {
    errorLabel.textContent = "无法读取设置，请重新打开扩展。";
    errorLabel.hidden = false;
  });
  render();
})();
