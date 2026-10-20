import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../site.js", import.meta.url), "utf8");
const section = source.slice(source.indexOf("const RELEASE_API ="), source.indexOf('document.querySelectorAll("[data-copy-digest]")'));
const release = (count) => ({ tag_name: "MAC3.2.2", assets: [{ name: "MuseFilm.dmg", download_count: count }] });
function harness(fetch) {
  const context = vm.createContext({
    fetch, AbortController, URL, console,
    navigator: { platform: "MacIntel" },
    window: { setTimeout: () => 1, clearTimeout() {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    currentLanguage: "zh", translate: (key) => key,
    refreshPlatformDownload: () => {}, refreshReleaseLanguage: () => {},
  });
  vm.runInContext(section + '\nglobalThis.runSync = syncDownloadCounts; globalThis.state = () => JSON.stringify({counts: lastCounts, releases: lastReleaseData?.releases, synced: lastCountsSynced});', context);
  return { runSync: context.runSync, state: () => JSON.parse(context.state()) };
}
const snapshotResponse = (releases, age = 0) => ({ ok: true, json: async () => ({ updatedAt: new Date(Date.now() - age).toISOString(), releases }) });

test("fresh same-origin snapshot restores counts without anonymous GitHub requests", async () => {
  const calls = [];
  const app = harness(async (url) => { calls.push(url); return snapshotResponse([release(94)]); });
  await app.runSync();
  assert.deepEqual(calls, ["./releases.json"]);
  assert.deepEqual(app.state().counts, { windows: 0, mac: 94 });
  assert.equal(app.state().releases.length, 1);
});

test("GitHub rate limiting retains stale snapshot counts and release history", async () => {
  const app = harness(async (url) => url === "./releases.json"
    ? snapshotResponse([release(94)], 3 * 3600000)
    : { ok: false, status: 403 });
  await app.runSync();
  assert.deepEqual(app.state().counts, { windows: 0, mac: 94 });
  assert.equal(app.state().releases.length, 1);
  assert.equal(app.state().synced, false);
});

test("missing snapshot falls back to paginated GitHub and preserves genuine zero counts", async () => {
  let pages = 0;
  const app = harness(async (url) => {
    if (url === "./releases.json") return { ok: false, status: 404 };
    pages += 1;
    return { ok: true, json: async () => pages === 1 ? [release(0)] : [{ tag_name: "Windows", assets: [{ name: "MuseFilm.exe", download_count: 117 }] }], headers: { get: () => pages === 1 ? '<https://api.github.com/repos/Quartzsyr/MuseFilm/releases?page=2>; rel="next"' : null } };
  });
  await app.runSync();
  assert.equal(pages, 2);
  assert.deepEqual(app.state().counts, { windows: 117, mac: 0 });
  assert.equal(app.state().synced, true);
});

test("network failures retain verified initial counts", async () => {
  const app = harness(async () => { throw new Error("offline"); });
  const initialCounts = app.state().counts;
  await app.runSync();
  assert.deepEqual(app.state().counts, initialCounts);
  assert.equal(app.state().synced, false);
});

function platformEntry(navigator) {
  const label={},icon={},classes=new Set();
  const link={dataset:{},href:"",target:"_blank",querySelector:selector=>selector.includes("label")?label:icon,classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,force){if(force)classes.add(name);else classes.delete(name)}}};
  const fallback={href:"https://github.com/Quartzsyr/MuseFilm/releases/download/MAC3.2.2/MuseFilm.dmg"};
  const context=vm.createContext({navigator,RELEASES_URL:"https://github.com/Quartzsyr/MuseFilm/releases",lastReleaseData:null,refreshPlatformDownload:()=>{},translate:key=>key,document:{querySelector:selector=>selector==="[data-platform-download]"?link:fallback}});
  vm.runInContext(source.slice(source.indexOf("function detectDownloadPlatform()"),source.indexOf("function formatBytes("))+"\nrefreshPlatformDownload();",context);
  return {link,label,icon};
}
test("phone and iPad entry points stay on the installer chooser instead of bypassing notifications",()=>{
  for(const navigator of [
    {userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari",platform:"iPhone",maxTouchPoints:5},
    {userAgent:"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit Safari",platform:"iPad",maxTouchPoints:5},
    {userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Safari",platform:"MacIntel",maxTouchPoints:5},
    {userAgent:"Mozilla/5.0 (Linux; Android 15) Chrome",platform:"Linux armv8l",maxTouchPoints:5},
  ]){const {link,label,icon}=platformEntry(navigator);assert.equal(link.href,"#download");assert.equal(link.target,"_self");assert.equal(label.textContent,"hero.downloadReleases");assert.equal(icon.textContent,"↓")}
});
test("desktop entry points retain their direct installer links",()=>{
  for(const navigator of [{userAgent:"Macintosh",platform:"MacIntel",maxTouchPoints:0},{userAgent:"Windows NT 10.0",platform:"Win32",maxTouchPoints:0}]){const {link}=platformEntry(navigator);assert.match(link.href,/releases\/download\//);assert.equal(link.target,"_blank")}
});
