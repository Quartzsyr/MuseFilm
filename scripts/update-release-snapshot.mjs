import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { releaseSnapshot } from "./release-snapshot.mjs";

// Input comes from authenticated `gh api --paginate --slurp`, never a browser token.
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
if (!Array.isArray(input)) throw new Error("Expected GitHub release pages");
const snapshot=releaseSnapshot(input),{releases}=snapshot;

// Do not replace a valid snapshot with a failed/empty API response.
if (!releases.length) throw new Error("No public releases returned");
await writeFile(existsSync("public") ? "public/releases.json" : "releases.json", JSON.stringify(snapshot, null, 2) + "\n");

const counts = { windows: 0, mac: 0 };
for (const release of releases) {
  for (const asset of release.assets) {
    const name = String(asset.name).toLowerCase();
    if (/\.(exe|msi|msix)$/.test(name) || /windows|win64|win-x64/.test(name)) counts.windows += asset.download_count;
    else if (/\.(dmg|pkg)$/.test(name) || /macos|darwin|osx/.test(name) || (release.tag_name.toLowerCase().includes("mac") && /\.zip$/.test(name))) counts.mac += asset.download_count;
  }
}
const total = counts.windows + counts.mac;
const home = await readFile("index.html", "utf8");
await writeFile("index.html", home
  .replace(/(data-total-downloads>)[^<]*/g, `$1${total}`)
  .replace(/(data-download-count="windows">)[^<]*/g, `$1${counts.windows}`)
  .replace(/(data-download-count="mac">)[^<]*/g, `$1${counts.mac}`));
const script = await readFile("site.js", "utf8");
await writeFile("site.js", script.replace(/const FALLBACK_COUNTS = \{ windows: \d+, mac: \d+ \};/, `const FALLBACK_COUNTS = { windows: ${counts.windows}, mac: ${counts.mac} };`));
