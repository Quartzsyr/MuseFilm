import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Input comes from authenticated `gh api --paginate --slurp`, never a browser token.
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
if (!Array.isArray(input)) throw new Error("Expected GitHub release pages");
const releases = input.flat().filter((release) => !release.draft).map((release) => ({
  name: release.name,
  tag_name: release.tag_name,
  html_url: release.html_url,
  published_at: release.published_at,
  created_at: release.created_at,
  prerelease: release.prerelease,
  body: release.body,
  assets: (release.assets || []).map((asset) => {
    if (!Number.isSafeInteger(asset.download_count) || asset.download_count < 0) {
      throw new Error("Invalid GitHub download count");
    }
    return {
      name: asset.name,
      browser_download_url: asset.browser_download_url,
      size: asset.size,
      digest: asset.digest,
      download_count: asset.download_count,
    };
  }),
}));

// Do not replace a valid snapshot with a failed/empty API response.
if (!releases.length) throw new Error("No public releases returned");
await writeFile(existsSync("public") ? "public/releases.json" : "releases.json", JSON.stringify({ updatedAt: new Date().toISOString(), releases }, null, 2) + "\n");

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
