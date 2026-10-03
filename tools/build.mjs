import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
const dist = resolve(root, "dist");
const manifest = JSON.parse(await readFile(resolve(src, "manifest.json"), "utf8"));
const files = new Set(["manifest.json", "popup.html", "popup.css", "popup.js", "controls.js", "settings.js", manifest.background.service_worker]);
for (const entry of manifest.content_scripts) for (const path of [...entry.js, ...entry.css]) files.add(path);
for (const path of Object.values(manifest.icons)) files.add(path);
await mkdir(dist, { recursive: true });
for (const path of files) {
  await mkdir(dirname(resolve(dist, path)), { recursive: true });
  await cp(resolve(src, path), resolve(dist, path));
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await cp(resolve(src, path), resolve(root, path));
}
console.log(`Bili Ambient ${manifest.version}: 已生成 ${files.size} 个扩展文件 → ${dist}`);
console.log(`顶层文件: ${(await readdir(dist)).join(", ")}`);
