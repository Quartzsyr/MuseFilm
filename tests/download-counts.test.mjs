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
