import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

test("builds the unified GitHub Pages entry point and required metadata", async () => {
  await Promise.all([
    access(new URL("index.html", dist)),
    access(new URL("CNAME", dist)),
    access(new URL("site.webmanifest", dist)),
    access(new URL("sitemap.xml", dist)),
    access(new URL("images/app-icon.png", dist)),
    access(new URL("images/og-darkroom.jpg", dist)),
    access(new URL("images/light-table-kodak-5222-potala.jpg", dist)),
    access(new URL("images/light-table-kodak-5294-karola.jpg", dist)),
    access(new URL("images/light-table-kodak-5207-memory.jpg", dist)),
  ]);

  const [home, cname, sitemap] = await Promise.all([
    readFile(new URL("index.html", dist), "utf8"),
    readFile(new URL("CNAME", dist), "utf8"),
    readFile(new URL("sitemap.xml", dist), "utf8"),
  ]);

  assert.match(home, /<title>MuseFilm｜Windows 与 macOS 胶片摄影档案工具<\/title>/);
  assert.match(home, /"operatingSystem": "Windows 10, Windows 11, macOS"/);
  assert.match(home, /https:\/\/musefilm\.top\/images\/og-darkroom\.jpg/);
  assert.match(home, /releases\/download\/Beta\/MuseFilmSetup\.exe/);
  assert.match(home, /releases\/download\/Mac\/musefilm-2\.0-build2-2026-06-06-154741\.dmg/);
  assert.match(home, /images\/app-icon\.png/);
  assert.doesNotMatch(home, /class="local-shot"/);
  assert.equal(cname.trim(), "musefilm.top");
  assert.doesNotMatch(home, /localhost|127\.0\.0\.1|\/Users\//);
  assert.doesNotMatch(sitemap, /mac\.html/);
});

test("uses GitHub Release assets as the download-count source of truth", async () => {
  const [script, home] = await Promise.all([
    readFile(new URL("site.js", root), "utf8"),
    readFile(new URL("index.html", root), "utf8"),
  ]);
  assert.match(script, /api\.github\.com\/repos\/Quartzsyr\/MuseFilm\/releases/);
  assert.match(script, /asset\.download_count/);
  assert.match(script, /function releaseTagContainsMac/);
  assert.match(script, /\.includes\("mac"\)/);
  assert.match(script, /function sortReleasesByDate/);
  assert.match(script, /function latestPlatformRelease/);
  assert.match(script, /function fetchAllReleases/);
  assert.match(script, /nextReleasePage/);
  assert.match(script, /asset\?\.digest/);
  assert.match(script, /info\.asset\.size/);
  assert.match(script, /published_at/);
  assert.match(script, /renderReleaseNotes/);
  assert.match(script, /renderReleaseHistory/);
  assert.match(home, /data-release-digest="windows"/);
  assert.match(home, /data-release-notes-body/);
  assert.match(home, /<details class="release-history"/);
  assert.match(home, /data-release-history-list/);
  assert.doesNotMatch(script, /countapi|localStorage|\+=\s*1/);
  assert.doesNotMatch(script, /const RELEASE_ASSETS/);
});

test("keeps interaction and accessibility fallbacks", async () => {
  const [home, css, script] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("site.css", root), "utf8"),
    readFile(new URL("site.js", root), "utf8"),
  ]);
  assert.match(home, /<noscript>/);
  assert.match(home, /aria-live="polite"/);
  assert.match(home, /data-i18n="local\.title"/);
  assert.match(home, /data-light-table/);
  assert.match(home, /data-light-table-board/);
  assert.match(home, /data-light-table-input/);
  assert.match(home, /accept="image\/\*" multiple/);
  assert.match(home, /data-light-table-loupe/);
  assert.match(home, /data-light-table-loupe-stage/);
  assert.match(home, /data-light-table-enter/);
  assert.match(home, /data-light-table-exit/);
  assert.match(home, /data-platform-download/);
  assert.match(home, /data-magnetic/);
  assert.match(home, /data-feedback-open/);
  assert.match(home, /data-feedback-dialog/);
  assert.match(home, /data-feedback-form/);
  assert.match(home, /data-visitor-total/);
  assert.match(home, /name="musefilm-api-base" content="https:\/\/musefilm-feedback-api\.syrquartz\.workers\.dev"/);
  assert.match(home, /为每一卷光，留一张观片台/);
  assert.match(script, /const LIGHT_TABLE_EXAMPLES = \[/);
  assert.match(script, /importLightTableFiles/);
  assert.match(script, /setLightTableInteractive/);
  assert.match(script, /updateLightTableScrollMotion/);
  assert.match(script, /renderLightTableLoupe/);
  assert.match(script, /Kodak 5222 · 布达拉宫/);
  assert.match(script, /Kodak 5294 · 卡若拉冰川/);
  assert.match(script, /Kodak 5207 · 东郊记忆/);
  assert.match(script, /detectDownloadPlatform/);
  assert.match(script, /navigator\.userAgentData/);
  assert.match(script, /cinematicHoverSurface/);
  assert.match(script, /--magnetic-x/);
  assert.match(script, /recordAnonymousVisit/);
  assert.match(script, /prepareFeedbackVerification/);
  assert.match(script, /\/api\/feedback/);
  assert.match(script, /\/api\/visit/);
  assert.match(script, /\/api\/visitors/);
  assert.match(script, /translate\("hero\.visitMoment"\)/);
  assert.match(script, /if \(!lightTableInteractive\) return;/);
  assert.match(script, /URL\.createObjectURL/);
  assert.match(script, /setPointerCapture/);
  assert.match(script, /dataTransfer\?\.files/);
  assert.doesNotMatch(script, /addEventListener\("wheel"/);
  assert.match(css, /\.light-table-board/);
  assert.match(css, /\.light-table-card\.is-selected/);
  assert.match(css, /\.light-table-loupe/);
  assert.match(css, /\.light-table-loupe-glass/);
  assert.match(css, /\.light-table-loupe-card/);
  assert.match(css, /\.darkroom-haze::after/);
  assert.match(css, /clip-path:\s*inset\(1px round 25%\)/);
  assert.match(css, /\.feedback-trigger/);
  assert.match(css, /\.feedback-dialog/);
  assert.match(css, /\.visitor-counter/);
  assert.match(css, /repeating-linear-gradient/);
  assert.match(home, /width="1536" height="1024"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media \(max-width: 440px\)/);
  assert.match(css, /:focus-visible/);
});

test("mounts the hero film reel as a progressive 3D enhancement", async () => {
  const [home, script, model, css] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("site.js", root), "utf8"),
    readFile(new URL("film-model.js", root), "utf8"),
    readFile(new URL("site.css", root), "utf8"),
  ]);

  assert.match(home, /data-film-model/);
  assert.match(home, /model-poster/);
  assert.match(script, /import\("\.\/film-model\.js\?v=\d{8}-3d\d+"\)/);
  assert.match(model, /WebGLRenderer/);
  assert.match(model, /\.\/vendor\/three\.module\.min\.js/);
  await Promise.all([
    access(new URL("vendor/three.module.min.js", root)),
    access(new URL("vendor/three.core.min.js", root)),
  ]);
  assert.match(model, /reducedMotion/);
  assert.match(model, /IntersectionObserver/);
  assert.match(home, /data-cinematic/);
  assert.equal((home.match(/data-cinematic-scene=/g) || []).length, 5);
  assert.equal((home.match(/data-narrative-frame/g) || []).length, 1);
  assert.match(home, /data-narrative-deck/);
  assert.match(script, /cinematic-progress/);
  assert.match(model, /targetScrollProgress/);
  assert.match(home, /data-film-finale/);
  assert.match(script, /is-film-finished/);
  assert.match(model, /finale = false/);
  assert.match(model, /Math\.round\(rollingAngle/);
  assert.match(css, /finalFilmTail/);
});

test("ships all Mac and Windows screenshots in the reel-linked narrative", async () => {
  const screenshots = [
    ...["01-home.avif", "02-archive.avif", "03-film-library.avif", "04-equipment.avif", "05-developing.avif", "06-light-table.avif", "07-preview.avif", "08-search.avif"].map((name) => `images/app-details/${name}`),
    ...["01-dashboard-home.avif", "02-archive.avif", "03-import.avif", "04-settings.avif", "05-film-library.avif", "06-film-developing.avif", "07-lab-tags.avif", "08-light-table.avif", "09-search.avif", "10-preview-random.avif"].map((name) => `images/mac/${name}`),
    "images/image.avif",
    "images/image(2).avif",
    "images/image(3).avif",
  ];
  await Promise.all(screenshots.map((name) => access(new URL(name, dist))));

  const [home, script, css] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("site.js", root), "utf8"),
    readFile(new URL("site.css", root), "utf8"),
  ]);
  assert.match(home, /data-narrative-deck/);
  assert.match(home, /data-narrative-platform="mac"/);
  assert.match(home, /data-narrative-platform="windows"/);
  assert.doesNotMatch(home, /museum-section|data-screen-deck/);
  assert.equal((script.match(/platform: "mac"/g) || []).length, 8);
  assert.equal((script.match(/platform: "windows"/g) || []).length, 13);
  assert.equal((script.match(/descZh:/g) || []).length, 21);
  assert.equal((script.match(/descEn:/g) || []).length, 21);
  assert.equal((script.match(/kickerZh:/g) || []).length, 21);
  assert.equal((script.match(/kickerEn:/g) || []).length, 21);
  assert.match(script, /const SCREEN_INTERFACE_LABELS = \{/);
  assert.equal((script.match(/\.avif": \{ zh: /g) || []).length, 21);
  const zhDescriptions = [...script.matchAll(/descZh: "([^"]+)"/g)].map((match) => match[1]);
  const enDescriptions = [...script.matchAll(/descEn: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(zhDescriptions.length, 21);
  assert.equal(enDescriptions.length, 21);
  assert.ok(zhDescriptions.every((description) => description.length >= 60));
  assert.ok(enDescriptions.every((description) => description.length >= 150));
  assert.equal((home.match(/data-narrative-copy-title/g) || []).length, 4);
  assert.equal((home.match(/data-narrative-copy-description/g) || []).length, 4);
  assert.equal((home.match(/data-narrative-copy-overline/g) || []).length, 4);
  assert.equal((home.match(/data-narrative-copy-index/g) || []).length, 4);
  assert.doesNotMatch(home, /0[1-4] \/ 04/);
  assert.match(script, /copyTitles\.forEach/);
  assert.match(script, /copyDescriptions\.forEach/);
  assert.match(script, /copyOverlines\.forEach/);
  assert.match(script, /copyIndexes\.forEach/);
  assert.match(script, /interfaceLabel\?\.zh/);
  assert.match(script, /activePlatform === "mac" \? "MACOS" : "WINDOWS"/);
  assert.doesNotMatch(script, /platform: "mac", src: "\.\/images\/mac\//);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /aria-selected/);
  assert.match(script, /scrollToShot/);
  assert.match(script, /shotFromProgress/);
  assert.match(css, /narrative-film-strip/);
  assert.match(home, /role="slider"/);
  assert.match(script, /setPointerCapture/);
  assert.match(script, /shotAtPointer/);
  assert.match(css, /exposureSweep/);
  assert.match(css, /reelDetent/);
  assert.match(css, /transform-style:\s*preserve-3d/);
  assert.match(css, /\.cinematic-frame img\s*\{[^}]*inset:\s*-1px;[^}]*object-fit:\s*cover;/s);
  assert.match(css, /\.cinematic-frame\s*\{[^}]*contain:\s*paint;[^}]*clip-path:\s*inset\(0 round 1rem\);/s);
  assert.doesNotMatch(script, /scale\(\.99[48]\)/);
});

test("keeps optional darkroom sound user-controlled", async () => {
  const [home, script] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("site.js", root), "utf8"),
  ]);
  assert.match(home, /data-sound-toggle/);
  assert.match(home, /aria-pressed="false"/);
  assert.match(script, /AudioContext/);
  assert.match(script, /soundButton\?\.addEventListener\("click"/);
});

test("supports Chinese and English on the unified page", async () => {
  const [home, script] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("site.js", root), "utf8"),
  ]);
  assert.match(home, /data-language-toggle/);
  assert.match(script, /const TRANSLATIONS/);
  assert.match(script, /document\.documentElement\.lang/);
  assert.match(script, /currentLanguage === "zh" \? "en" : "zh"/);
  assert.match(script, /"hero\.description"/);
  const translationKeys = [...home.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]);
  translationKeys.forEach((key) => assert.match(script, new RegExp(`"${key.replaceAll(".", "\\.")}"\\s*:`)));
});
