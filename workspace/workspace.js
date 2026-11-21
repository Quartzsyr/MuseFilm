import { loadLibrary, saveLibrary, download, canvasBlob, loadImage, fitImage, photoQuality } from "./library.js?v=1";

const root = document.querySelector("#workspace");
const dock = document.querySelector("#dock");
const palette = document.querySelector("#palette");
const notice = document.querySelector("#notice");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const id = () => crypto.randomUUID();
const esc = (value = "") => String(value).replace(/[&<>"']/g, (letter) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letter]);
const labels = {
  home: ["首页", "M3 11l9-8 9 8v9H4v-9"],
  archive: ["档案", "M3 9l2-5h14l2 5v11H3V9h6l1 3h4l1-3h6"],
  preview: ["预览", "M3 5h18v14H3zM4 16l6-6 4 4 3-3 4 5"],
  film: ["胶卷库", "M3 4h18v16H3zM7 4v16m10-16v16M3 9h4m10 0h4M3 15h4m10 0h4"],
  gear: ["器材库", "M3 7h5l2-3h5l2 3h4v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0"],
  footprints: ["足迹", "M12 22s7-8 7-13a7 7 0 0 0-14 0c0 5 7 13 7 13zm2-13a2 2 0 1 1-4 0 2 2 0 0 1 4 0"],
  light: ["观片台", "M3 6h14v12H3zm4 12v3h14V9h-4"],
  book: ["光页画册", "M12 6c-4-3-8-2-10-1v14c4-1 7-1 10 1 3-2 6-2 10-1V5c-2-1-6-2-10 1v14"],
  watermark: ["水印工坊", "M4 15c2-5 6-10 8-10s-2 7-3 9c2-2 6-4 5-1s3 1 6-1M4 19h16"],
  instant: ["宝丽莱", "M4 3h16v18H4zm3 3h10v9H7z"],
  developing: ["冲扫", "M18 14a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM10 3h4m-2 5V3m0 11 2-2"],
  tags: ["寄扫标签", "M3 4h8l10 10-7 7L3 10zM7 7h.1"],
  wallpaper: ["动态桌面", "M3 4h18v13H3zm5 17h8m-4-4v4"],
  exchange: ["底片漂流", "M3 7h4l10 10h4m-4-4 4 4-4 4M3 17h4l3-3m4-4 3-3h4m-4-4 4 4-4 4"],
  search: ["搜索", "M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0zm-2 5 7 7"],
  import: ["导入卷宗", "M5 14v6h14v-6m-7 2V3m-4 9 4 4 4-4"],
  membership: ["会员中心", "M12 3l3 3 4 1 1 5-1 5-4 1-3 3-3-3-4-1-1-5 1-5 4-1z"],
  settings: ["设置", "M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-5 1v4"],
};

let library;
let destination = "home";
let rollId;
let photoId;
let editId;
let currentBook;
let bookPage = 0;
let bookUndo;
let coverDraft;
let searchText = "";
let savePending = false;
let messageTimer;
let workId = 0;
let analysisId = 0;
let qualityReport;
let importFiles = [];
let timer = { remaining: 480, ends: 0 };
const objectURLs = new Map();
const tilePositions = new Map();

const rolls = () => library.rolls;
const total = () => rolls().reduce((count, roll) => count + roll.photos.length, 0);
const selectedRoll = () => rolls().find((roll) => roll.id === rollId) || rolls()[0];
const selectedPhoto = () => selectedRoll()?.photos.find((photo) => photo.id === photoId) || selectedRoll()?.photos[0];
const allPhotos = () => rolls().flatMap((roll) => roll.photos);
const source = (photo) => {
  if (!objectURLs.has(photo.id)) objectURLs.set(photo.id, URL.createObjectURL(photo.blob));
  return objectURLs.get(photo.id);
};
const photoImage = (photo, eager = false) => `<img src="${source(photo)}" alt="${esc(photo.name)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
const routeButton = (key, name = labels[key][0]) => `<button type="button" data-route="${key}">${esc(name)}</button>`;
const icon = (key) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${labels[key][1]}"></path></svg>`;
const pagehead = (title, subtitle = "", actions = "") => `<header class="pagehead"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="actions">${actions}</div></header>`;
const empty = (message, key = "import") => `<section class="panel"><p>${esc(message)}</p>${routeButton(key)}</section>`;
const rollPicker = () => `<label class="inline">当前卷宗 <select data-roll-picker>${rolls().map(roll => `<option value="${roll.id}" ${roll.id === selectedRoll()?.id ? "selected" : ""}>${esc(roll.name)}</option>`).join("")}</select></label>`;
const photoChoices = (photos, multiple = false, selected = []) => `<div class="photo-grid">${photos.map((photo) => `<label class="photo-choice">${photoImage(photo)}<span><input type="${multiple ? "checkbox" : "radio"}" name="photo" value="${photo.id}" ${selected.includes(photo.id) ? "checked" : ""}> ${esc(photo.name)}</span></label>`).join("")}</div>`;
const choosePhotos = (form) => new FormData(form).getAll("photo").map((key) => allPhotos().find((photo) => photo.id === key)).filter(Boolean);

function notify(message) {
  clearTimeout(messageTimer);
  notice.textContent = message;
  notice.hidden = false;
  messageTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

async function change(updater, refresh = true) {
  if (savePending) {
    notify("正在保存上一项修改。");
    return false;
  }
  savePending = true;
  const next = structuredClone(library);
  try {
    updater(next);
    next.revision = library.revision + 1;
    await saveLibrary(next, library.revision);
    library = next;
    if (refresh) render();
    return true;
  } catch (error) {
    notify(`保存失败：${error.message || "浏览器存储不可用"}`);
    return false;
  } finally {
    savePending = false;
  }
}

function animate(element, frames, milliseconds) {
  if (!element || reduce.matches) return;
  element.animate(frames, { duration: milliseconds, easing: "cubic-bezier(.22,.72,.25,1)" });
}

function navigate(route, { hash = true, focus = true } = {}) {
  if (!(route in labels)) route = "home";
  if (destination !== route) {
    workId++;
    if (destination === "watermark" && queueRunning) queuePaused = true;
    if (destination === "import") importFiles = [];
  }
  destination = route;
  if (route !== "import") editId = null;
  if (hash && location.hash !== `#${route}`) history.pushState(null, "", `#${route}`);
  if (palette.open) palette.close();
  render();
  if (focus) {
    window.scrollTo(0, 0);
    root.focus({ preventScroll: true });
    dock.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
}

function render() {
  root.innerHTML = screens[destination]();
  document.querySelector("#route-title").textContent = labels[destination][0];
  document.title = `${labels[destination][0]} · MuseFilm 网页工作区`;
  dock.querySelectorAll("button").forEach((button) => {
    if (button.dataset.route === destination) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (library.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = library.theme;
  root.querySelectorAll("[data-drag-key]").forEach(makeDraggable);
  if (destination === "preview" && selectedPhoto()) {
    animate(root.querySelector(".viewer img"), [{ opacity: .35, transform: "scale(1.017)" }, { opacity: 1, transform: "scale(1)" }], 270);
  }
  if (destination === "book" && root.querySelector("#book-canvas")) paintBook();
  if (destination === "watermark" && root.querySelector("#watermark-canvas")) {
    paintWatermark();
    renderQueue();
  }
  if (destination === "instant" && root.querySelector("#instant-canvas")) paintInstant();
  if (destination === "developing") updateTimer();
}

function home() {
  const date = Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date());
  const count = library.films.reduce((sum, film) => sum + film.stock, 0);
  const metric = (key, title, value, unit) => `<button type="button" class="metric" data-route="${key}">${title}<strong>${value} <small>${unit}</small></strong></button>`;
  const recent = rolls().slice(0, 4).filter((roll) => roll.photos.length);
  return pagehead("首页", date, routeButton("import")) +
    `<section class="metrics">${metric("archive","影像档案",rolls().length,"卷宗")}${metric("preview","底片收藏",total(),"张")}${metric("film","胶卷库存",count,"卷")}</section>
    <div class="home-grid">
      <section class="panel home-note"><div><p class="muted">今日手记</p><h2>${recent.length ? "回看这一卷" : "从第一卷开始"}</h2>
      <p>${recent.length ? "选择底片卡片看原片，或去观片台整理整卷。" : "把一组扫描图和拍摄记录收进同一个卷宗。图库保存在当前浏览器。"} </p></div>
      <div class="actions">${routeButton("archive")}${!recent.length ? '<button type="button" id="sample-roll">导入示例卷</button>' : ""}</div></section>
      <section class="panel film-table" aria-label="底片影像桌">${recent.map((roll) => `<button type="button" class="film-card" data-open-roll="${roll.id}" data-drag-key="home-${roll.id}">${photoImage(roll.photos[0])}<span>${esc(roll.name)}</span></button>`).join("") || '<p class="muted">导入后，最近的底片会出现在这里。</p>'}</section>
      <section class="panel"><h2>胶卷库存</h2><p>${library.films.length} 种胶片，库存 ${count} 卷。</p>${routeButton("film")}</section>
      <section class="panel"><h2>拍摄准备</h2><p>${library.cameras.length} 件器材，${new Set(rolls().map((roll) => roll.place).filter(Boolean)).size} 个拍摄地点。</p>${routeButton("gear")} ${routeButton("footprints")}</section>
    </div>`;
}

function rollCards(records) {
  return `<div class="cards">${records.map((roll) => `<article class="card"><button class="card-cover" type="button" data-open-roll="${roll.id}" aria-label="打开 ${esc(roll.name)}">${roll.photos[0] ? photoImage(roll.photos[0]) : "打开卷宗"}</button>
    <h2>${esc(roll.name)}</h2><p class="muted">${[roll.date, roll.film, roll.camera, roll.place].filter(Boolean).map(esc).join(" · ") || "待补充拍摄信息"} · ${roll.photos.length} 张</p>
    <button type="button" data-edit-roll="${roll.id}">编辑卷宗</button></article>`).join("")}</div>`;
}

function archive() {
  return pagehead("胶卷档案", `${rolls().length} 卷 · ${total()} 张`, routeButton("import") + routeButton("search")) +
    (rolls().length ? rollCards(rolls()) : empty("还没有卷宗。导入扫描图，添加胶卷、器材和拍摄信息。"));
}

function importRoll() {
  const existing = rolls().find((roll) => roll.id === editId);
  const field = (key, label, extra = "") => `<label>${label}<input name="${key}" value="${esc(existing?.[key])}" ${extra}></label>`;
  return pagehead(existing ? "编辑卷宗" : "导入卷宗", "照片副本保存在当前浏览器的图库中。", routeButton("archive")) +
    `<form id="roll-form" class="panel stack"><div class="fields">${field("name","卷名",'required maxlength="120"')}${field("date","拍摄日期",'type="date"')}${field("film","胶卷",'list="films" maxlength="120"')}${field("camera","相机",'list="cameras" maxlength="120"')}${field("place","地点",'maxlength="120"')}${field("tags","标签",'maxlength="240"')}</div>
    <datalist id="films">${library.films.map((item) => `<option value="${esc(item.name)}">`).join("")}</datalist>
    <datalist id="cameras">${library.cameras.map((item) => `<option value="${esc(item.name)}">`).join("")}</datalist>
    <label class="field">拍摄笔记<textarea name="notes" rows="3" maxlength="4000">${esc(existing?.notes)}</textarea></label>
    <label class="drop" id="image-drop"><strong>拖入 JPEG、PNG、WebP 等浏览器支持的图片</strong><input type="file" name="files" accept="image/*" multiple><small id="file-summary">${importFiles.length ? `已选择 ${importFiles.length} 张` : (existing ? `现有 ${existing.photos.length} 张，可追加照片` : "可一次选择多张")}</small></label>
    <div class="actions"><button class="primary" type="submit">${existing ? "保存修改" : "保存卷宗"}</button></div></form>`;
}

function preview() {
  const roll = selectedRoll();
  const photo = selectedPhoto();
  if (!photo) return pagehead("照片预览") + empty("请先导入一卷照片。");
  const current = roll.photos.indexOf(photo);
  return pagehead(roll.name, [roll.film, roll.camera, roll.place, roll.date].filter(Boolean).join(" · "), rollPicker()) +
    `<div class="split"><figure class="viewer">${photoImage(photo, true)}</figure><section class="panel"><h2>${esc(photo.name)}</h2><p class="muted">${current + 1} / ${roll.photos.length} · ${Math.round(photo.blob.size / 1024)} KB</p>
    <div class="actions"><button type="button" data-frame-step="-1" ${current ? "" : "disabled"}>上一张</button><button type="button" data-frame-step="1" ${current + 1 === roll.photos.length ? "disabled" : ""}>下一张</button></div>
    <p>${esc(roll.notes)}</p><div class="actions">${routeButton("light")}${routeButton("watermark")}<button type="button" id="download-original">下载原图</button></div></section></div>
    <div class="contact" style="margin-top:1rem">${roll.photos.map((item) => `<button type="button" data-frame="${item.id}" aria-pressed="${photo.id === item.id}" aria-label="${esc(item.name)}">${photoImage(item)}</button>`).join("")}</div>`;
}

function lightTable() {
  const roll = selectedRoll();
  if (!roll?.photos.length) return pagehead("观片台") + empty("导入照片后即可摆片和放大。");
  return pagehead("观片台", "拖动底片自由摆放，点击照片可回到原片预览。", rollPicker()) +
    `<div class="actions" style="margin-bottom:1rem"><label class="inline">底片放大 <input id="light-zoom" type="range" min=".65" max="1.6" value="1" step=".05"></label><button type="button" id="reset-light">复位摆片</button><button type="button" id="contact-export">导出整卷索引图</button></div>
    <div class="light-board" id="light-board" aria-label="底片摆放区">${roll.photos.slice(0, 12).map((photo, index) => `<button type="button" class="film-card" data-light-frame="${photo.id}" data-drag-key="light-${photo.id}" style="left:${5 + index % 3 * 30}%;top:${5 + Math.floor(index / 3) * 21}%">${photoImage(photo)}</button>`).join("")}</div>
    ${roll.photos.length > 12 ? '<p class="muted">画布先摆放前 12 张。索引图包含整卷照片。</p>' : ""}`;
}

function catalog(kind) {
  const film = kind === "films";
  return pagehead(film ? "胶卷库" : "器材库", film ? "记录胶卷型号、感光度、剩余库存和到期日。" : "记录机身和镜头，导入卷宗时可直接选择。") +
    `<form class="panel" id="catalog-form" data-kind="${kind}"><div class="fields"><label>名称<input name="name" required maxlength="120"></label>
    ${film ? '<label>感光度<input name="iso" type="number" min="1" max="409600"></label><label>库存<input name="stock" type="number" min="0" max="9999" value="1" required></label><label>到期日<input name="expiry" type="date"></label>' : '<label>类型<select name="type"><option>相机</option><option>镜头</option><option>附件</option></select></label><label>规格或备注<input name="notes" maxlength="200"></label>'}
    </div><button class="primary">加入资料库</button></form>
    <div class="cards" style="margin-top:1rem">${library[kind].map((item) => `<article class="card"><h2>${esc(item.name)}</h2><p>${film ? `ISO ${esc(item.iso || "—")} · ${item.stock} 卷${item.expiry ? ` · 到期 ${esc(item.expiry)}` : ""}` : `${esc(item.type)} · ${esc(item.notes)}`}</p>${film ? `<div class="actions"><button type="button" data-stock="${item.id}" data-delta="-1" ${item.stock === 0 ? "disabled" : ""}>减少一卷</button><button type="button" data-stock="${item.id}" data-delta="1" ${item.stock >= 9999 ? "disabled" : ""}>增加一卷</button></div>` : ""}</article>`).join("")}</div>`;
}

function footprints() {
  const places = new Map();
  for (const roll of rolls().filter((item) => item.place)) {
    if (!places.has(roll.place)) places.set(roll.place, []);
    places.get(roll.place).push(roll);
  }
  return pagehead("胶片足迹", "按拍摄地点查找卷宗，并在地图中打开地点。") +
    ([...places].map(([place, records]) => `<section class="panel" style="margin-bottom:1rem"><h2>${esc(place)}</h2><p><a href="https://maps.apple.com/?q=${encodeURIComponent(place)}" target="_blank" rel="noopener noreferrer">在地图中打开</a></p>${rollCards(records)}</section>`).join("") || empty("给卷宗添加一个拍摄地点，就会出现于此。", "archive"));
}

function matches(roll, query) {
  const content = [roll.name, roll.place, roll.camera, roll.film, roll.date, roll.tags, roll.notes, ...roll.photos.map((photo) => photo.name)].join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((term) => content.includes(term));
}

function search() {
  return pagehead("搜索", "按卷名、地点、标签、器材、日期和文件名查找。") +
    `<form id="search-form" class="actions" style="margin-bottom:1rem"><input type="search" name="query" aria-label="搜索图库" value="${esc(searchText)}" autofocus><button class="primary">搜索</button></form>
    <div id="search-results">${searchResults()}</div>`;
}
function searchResults() {
  const results = rolls().filter((roll) => matches(roll, searchText));
  return `<p class="muted">${results.length} 个卷宗</p>` + rollCards(results);
}

function developing() {
  return pagehead("冲扫计时", "保存药液或配方名称，设置该步骤的倒计时。") +
    `<div class="split"><section class="panel"><div class="timer" id="timer-clock" role="timer"></div><div class="actions"><button class="primary" id="timer-start" type="button">${timer.ends ? "暂停" : "开始"}</button><button id="timer-reset" type="button">复位</button></div></section>
    <form id="recipe-form" class="panel stack"><label class="field">配方或药液<input name="title" maxlength="120" value="${esc(library.recipe.title)}"></label><label class="field">时间（秒）<input type="number" name="seconds" min="1" max="86400" value="${library.recipe.seconds}" required></label><button>保存计时设置</button></form></div>`;
}

function updateTimer() {
  const time = document.querySelector("#timer-clock");
  const remaining = timer.ends ? Math.max(0, Math.ceil((timer.ends - Date.now()) / 1000)) : timer.remaining;
  if (time) time.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  if (timer.ends && remaining === 0) {
    timer.ends = 0;
    timer.remaining = 0;
    const button = document.querySelector("#timer-start");
    if (button) button.textContent = "开始";
    notify("冲扫计时结束。");
  }
}

function labTags() {
  const roll = selectedRoll();
  if (!roll) return pagehead("寄扫标签") + empty("先创建卷宗，再打印寄扫标签。");
  return pagehead("寄扫标签", "填写冲扫要求，使用浏览器打印或保存 PDF。", rollPicker()) +
    `<div class="split"><article class="label-preview" id="lab-print"><h2>${esc(roll.name)}</h2><p>${esc(roll.film || "胶卷型号待填")} · ${esc(roll.camera || "相机待填")}</p><p id="lab-note">冲扫要求</p><small>MuseFilm</small></article>
    <form id="lab-form" class="panel stack"><label class="field">冲扫要求<textarea id="lab-input" rows="4" maxlength="600"></textarea></label><button>打印标签</button></form></div>`;
}

function watermark() {
  const roll = selectedRoll();
  if (!roll?.photos.length) return pagehead("水印工坊") + empty("请先导入照片。");
  return pagehead("水印工坊", "预览版式，按张生成带水印的 JPEG。", rollPicker()) +
    `<div class="split"><section class="panel"><canvas id="watermark-canvas" class="page-preview" aria-label="水印预览"></canvas><ul class="queue" id="watermark-results" aria-live="polite"></ul></section>
    <form class="panel stack" id="watermark-form"><label class="field">版式<select name="style"><option value="white">经典白框</option><option value="black">黑色片基</option><option value="plain">下方题签</option></select></label>
    <label class="field">题签<input name="caption" maxlength="100" value="${esc([roll.camera, roll.film].filter(Boolean).join(" · "))}" placeholder="例如：Leica M6 · Kodak Gold 200"></label>
    <div class="actions"><button class="primary" type="submit">生成所选 JPEG</button><button type="button" id="queue-pause" hidden>暂停</button><button type="button" id="queue-retry" hidden>重试失败项</button></div>
    ${photoChoices(roll.photos, true, [selectedPhoto().id])}</form></div>`;
}

function drawWatermark(canvas, image, style, caption, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const border = style === "plain" ? 0 : Math.max(12, Math.round(width * .04));
  const bottom = Math.max(48, Math.round(width * .09));
  canvas.width = width + border * 2;
  canvas.height = height + border + bottom;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = style === "black" ? "#141414" : "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, border, border, width, height);
  ctx.fillStyle = style === "black" ? "#f5f3ee" : "#252525";
  ctx.font = `${Math.max(14, Math.round(width * .026))}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(caption, canvas.width / 2, border + height + bottom / 2, Math.max(1, width - 16));
}

let watermarkRender = 0;
async function paintWatermark() {
  const form = root.querySelector("#watermark-form");
  const target = root.querySelector("#watermark-canvas");
  const request = ++watermarkRender;
  const photo = choosePhotos(form)[0] || selectedPhoto();
  try {
    const image = await loadImage(source(photo));
    if (request !== watermarkRender || !target.isConnected) return;
    const data = new FormData(form);
    drawWatermark(target, image, data.get("style"), data.get("caption"), 900);
  } catch {
    if (target.isConnected) notify("无法预览这张照片。");
  }
}

let queue = [];
let queuePaused = false;
let queueRunning = false;
let queueSettings;
function renderQueue() {
  const list = root.querySelector("#watermark-results");
  if (!list) return;
  list.innerHTML = queue.map((item, index) => `<li><span>${esc(item.photo.name)}</span>${item.result ? `<button type="button" data-queue-download="${index}">下载 JPEG</button>` : `<span>${({ waiting: "等待", running: "生成中", failed: "生成失败" })[item.phase]}</span>`}</li>`).join("");
  const pause = root.querySelector("#queue-pause");
  pause.hidden = !queue.some((item) => item.phase === "waiting" || item.phase === "running");
  pause.textContent = queuePaused ? "继续" : "暂停";
  root.querySelector("#queue-retry").hidden = queueRunning || !queue.some((item) => item.phase === "failed");
  root.querySelector('#watermark-form button[type="submit"]').disabled = queueRunning;
}

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  const thisWork = workId;
  while (!queuePaused && thisWork === workId) {
    const item = queue.find((entry) => entry.phase === "waiting");
    if (!item) break;
    item.phase = "running";
    renderQueue();
    try {
      const image = await loadImage(source(item.photo));
      const canvas = document.createElement("canvas");
      drawWatermark(canvas, image, queueSettings.style, queueSettings.caption, 4096);
      item.result = await canvasBlob(canvas, "image/jpeg");
      item.phase = "done";
    } catch {
      item.phase = "failed";
    }
  }
  queueRunning = false;
  renderQueue();
}

function bookWorkspace() {
  const book = library.books.find((item) => item.id === currentBook);
  const photos = selectedRoll()?.photos || [];
  if (!book) {
    return pagehead("光页画册", "选出一组照片，制作封面并编排跨页。", rolls().length ? rollPicker() : "") +
      `<div class="cards" style="margin-bottom:1rem">${library.books.map((item) => `<article class="card"><h2>${esc(item.title)}</h2><p>${item.pages.length} 张</p><button type="button" data-open-book="${item.id}">打开画册</button></article>`).join("")}</div>` +
      (photos.length ? `<form class="panel stack" id="book-create"><label class="field">画册标题<input name="title" required maxlength="100" placeholder="未命名画册"></label>${photoChoices(photos, true)}<div><button class="primary">用所选照片创建</button></div></form>` : empty("请先导入照片。"));
  }
  const max = Math.ceil(book.pages.length / 2);
  const frame = (key) => allPhotos().find((photo) => photo.id === key);
  return pagehead(book.title, bookPage === 0 ? "封面" : `跨页 ${bookPage} / ${max}`, '<button id="book-back" type="button">返回画册列表</button>') +
    `<div class="split"><section class="panel book-stage">
      <canvas class="page-preview" id="book-canvas" aria-label="画册预览"></canvas>
      <div class="actions"><button type="button" data-book-page="-1" ${bookPage === 0 ? "disabled" : ""}>上一页</button><button type="button" data-book-page="1" ${bookPage >= max ? "disabled" : ""}>下一页</button><button type="button" id="book-export">导出本页 PNG</button><button type="button" id="book-print">打印整本 / PDF</button></div>
    </section><section class="panel"><h2>封面与编排</h2>
      ${coverDraft ? `<p>预览中：${esc(frame(coverDraft)?.name)}</p><div class="actions"><button type="button" class="primary" id="book-apply">应用封面</button><button type="button" id="book-cancel">取消</button></div>` : `<form id="book-cover-form" class="stack"><label class="field">候选封面<select name="cover">${book.pages.map((key) => `<option value="${key}" ${key === book.cover ? "selected" : ""}>${esc(frame(key)?.name)}</option>`).join("")}</select></label><button>预览封面</button></form>`}
      ${bookUndo?.id === book.id ? '<p style="margin-top:1rem"><button type="button" id="book-undo">撤销上次封面更换</button></p>' : ""}
      <ol>${book.pages.map((key, index) => `<li>${esc(frame(key)?.name)} <button type="button" data-move-page="${index}" aria-label="照片上移" ${index === 0 ? "disabled" : ""}>↑</button></li>`).join("")}</ol>
    </section></div>`;
}

async function drawBook(canvas, book, page, cover) {
  const frame = (key) => allPhotos().find((photo) => photo.id === key);
  const keys = page === 0 ? [cover || book.cover] : book.pages.slice((page - 1) * 2, page * 2);
  const images = await Promise.all(keys.map(async (key) => {
    const photo = frame(key);
    return photo ? loadImage(source(photo)) : null;
  }));
  canvas.width = 1400;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6f1e8";
  ctx.fillRect(0, 0, 1400, 900);
  if (page === 0) {
    if (images[0]) fitImage(ctx, images[0], 125, 90, 1150, 640);
    ctx.fillStyle = "#26211b";
    ctx.font = "52px serif";
    ctx.textAlign = "center";
    ctx.fillText(book.title, 700, 817, 1150);
  } else {
    const gutter = ctx.createLinearGradient(655, 0, 745, 0);
    gutter.addColorStop(0, "#f6f1e8"); gutter.addColorStop(.5, "#d2c9ba"); gutter.addColorStop(1, "#f6f1e8");
    ctx.fillStyle = gutter;
    ctx.fillRect(655, 0, 90, 900);
    images.forEach((image, index) => {
      if (image) fitImage(ctx, image, 58 + index * 700, 65, 584, 760);
    });
    ctx.fillStyle = "#5c564d";
    ctx.font = "24px serif";
    ctx.fillText(String(page), 60, 850);
  }
}

async function paintBook() {
  const canvas = root.querySelector("#book-canvas");
  const book = library.books.find((item) => item.id === currentBook);
  try {
    await drawBook(canvas, book, bookPage, coverDraft);
    canvas.dataset.ready = "true";
    animate(canvas, [{ opacity: .4, transform: "rotateY(-9deg) translateX(8px)" }, { opacity: 1, transform: "rotateY(0)" }], 360);
  } catch { if (canvas.isConnected) notify("画册预览加载失败。"); }
}

function instant() {
  const roll = selectedRoll();
  if (!roll?.photos.length) return pagehead("宝丽莱") + empty("用图库照片制作相纸。");
  const stored = library.instant.filter((item) => roll.photos.some((photo) => photo.id === item.photo));
  return pagehead("宝丽莱相纸", "选择画面、相纸边框与手写题签，保存进当前卷宗的相纸盒。", rollPicker()) +
    `<div class="split"><section class="panel"><canvas id="instant-canvas" class="page-preview" aria-label="相纸预览"></canvas></section>
    <form id="instant-form" class="panel stack"><label class="field">照片<select name="photo">${roll.photos.map((photo) => `<option value="${photo.id}">${esc(photo.name)}</option>`).join("")}</select></label><label class="field">相纸<select name="style"><option value="white">白边</option><option value="black">黑边</option></select></label><label class="field">题签<input name="caption" maxlength="40"></label>
    <div class="actions"><button type="submit" class="primary">保存相纸</button><button id="instant-export" type="button">导出 PNG</button></div>
    </form></div>
    <section class="panel" style="margin-top:1rem"><h2>相纸盒 · ${stored.length} 张</h2><div class="actions">${stored.map((item) => `<button type="button" data-open-instant="${item.id}">${esc(item.caption || "未题名相纸")}</button>`).join("")}</div></section>`;
}

let instantRender = 0;
async function paintInstant() {
  const form = document.querySelector("#instant-form");
  const canvas = document.querySelector("#instant-canvas");
  const request = ++instantRender;
  delete canvas.dataset.ready;
  const data = new FormData(form);
  const photo = allPhotos().find((item) => item.id === data.get("photo"));
  try {
    const image = await loadImage(source(photo));
    if (request !== instantRender || !canvas.isConnected) return;
    canvas.width = 760;
    canvas.height = 910;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = data.get("style") === "black" ? "#1c1c1e" : "#fff8ed";
    ctx.fillRect(0, 0, 760, 910);
    ctx.fillStyle = "#171719";
    ctx.fillRect(45, 45, 670, 670);
    fitImage(ctx, image, 45, 45, 670, 670);
    ctx.fillStyle = data.get("style") === "black" ? "#fff8ed" : "#202025";
    ctx.textAlign = "center";
    ctx.font = "42px serif";
    ctx.fillText(data.get("caption"), 380, 820, 660);
    canvas.dataset.ready = "true";
  } catch { if (canvas.isConnected) notify("相纸图片加载失败。"); }
}

function wallpaper() {
  const photo = selectedPhoto();
  return pagehead("桌面壁纸", "从当前卷宗下载一张静态桌面图片。视频桌面与音乐可视化由 macOS 客户端提供。", photo ? rollPicker() : "") +
    (photo ? `<div class="split"><figure class="viewer">${photoImage(photo, true)}</figure><section class="panel stack"><h2>静态壁纸</h2><div class="actions">${routeButton("preview","选择另一张照片")}<button type="button" class="primary" id="wallpaper-export">生成 4K 壁纸</button></div></section></div>` : empty("请先导入照片。"));
}

function settings() {
  return pagehead("设置", "本机图库存放在浏览器站点数据中。清除站点数据会移除本机图库。") +
    `<div class="split"><section class="panel"><h2>外观</h2><label class="field">配色 <select id="appearance">${[["system","跟随系统"],["dark","深色"],["light","浅色"]].map(([value, title]) => `<option value="${value}" ${library.theme === value ? "selected" : ""}>${title}</option>`).join("")}</select></label></section>
    <section class="panel"><h2>图库备份</h2><p>备份包含卷宗、照片、胶卷、器材、画册和相纸。导入时合并到现有图库。</p>
    <div class="actions"><button type="button" id="backup-export">下载备份</button><label class="button">导入网页备份 <input id="backup-import" type="file" accept=".json,application/json"></label></div></section></div>`;
}

function nativeOnly(route, description, href, label) {
  return pagehead(labels[route][0], description) + `<section class="panel"><a href="${href}">${label}</a></section>`;
}

const screens = {
  home, archive, import: importRoll, preview, light: lightTable, film: () => catalog("films"),
  gear: () => catalog("cameras"), search, footprints, developing, tags: labTags, book: bookWorkspace,
  instant, wallpaper, watermark, settings,
  membership: () => nativeOnly("membership", "现有会员、支付与创作券在 macOS 客户端内管理。", "../#membership-pricing", "查看会员说明"),
  exchange: () => nativeOnly("exchange", "底片漂流使用客户端的会员身份与主动分享流程。", "../#whats-new", "查看底片漂流与客户端下载"),
};

function makeDraggable(element) {
  const key = element.dataset.dragKey;
  const saved = tilePositions.get(key) || [0, 0];
  const place = (x, y) => { element.style.translate = `${x}px ${y}px`; };
  place(...saved);
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const [x, y] = tilePositions.get(key) || [0, 0];
    const parent = element.parentElement.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    element.setPointerCapture(event.pointerId);
    const move = (next) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (Math.hypot(dx, dy) < 5 && !dragged) return;
      dragged = true;
      const currentX = x + Math.max(parent.left - box.left, Math.min(parent.right - box.right, dx));
      const currentY = y + Math.max(parent.top - box.top, Math.min(parent.bottom - box.bottom, dy));
      tilePositions.set(key, [currentX, currentY]);
      place(currentX, currentY);
    };
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      if (dragged) {
        const suppress = (click) => { click.stopImmediatePropagation(); click.preventDefault(); };
        element.addEventListener("click", suppress, { capture: true, once: true });
        setTimeout(() => element.removeEventListener("click", suppress, true), 0);
      }
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  });
}

async function imageFiles(files) {
  const photos = [];
  const invalid = [];
  for (const file of files) {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") { invalid.push(file.name); continue; }
    const url = URL.createObjectURL(file);
    try {
      await loadImage(url);
      photos.push({ id: id(), name: file.name, blob: file });
    } catch { invalid.push(file.name); }
    finally { URL.revokeObjectURL(url); }
  }
  return { photos, invalid };
}

async function importSample(button) {
  button.disabled = true;
  try {
    const samples = [
      ["5294-karola", new URL("../images/light-table-kodak-5294-karola.jpg", import.meta.url)],
      ["5222-potala", new URL("../images/light-table-kodak-5222-potala.jpg", import.meta.url)],
      ["5207-memory", new URL("../images/light-table-kodak-5207-memory.jpg", import.meta.url)],
    ];
    const photos = await Promise.all(samples.map(async ([name, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("示例照片读取失败");
      return { id: id(), name: `Kodak ${name}.jpg`, blob: await response.blob() };
    }));
    const roll = { id: id(), name: "胶卷试片", date: "", film: "Kodak", camera: "", place: "", tags: "示例", notes: "", photos };
    if (await change((next) => next.rolls.unshift(roll), false)) openRoll(roll.id);
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
}

function openRoll(key) {
  rollId = key;
  photoId = undefined;
  navigate("preview");
}

async function saveRoll(form) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  const existing = rolls().find((item) => item.id === editId);
  const data = new FormData(form);
  const record = Object.fromEntries(["name","date","film","camera","place","tags","notes"].map((key) => [key, data.get(key).trim()]));
  if (!record.name) { notify("请输入卷名。"); button.disabled = false; return; }
  try {
    const { photos, invalid } = await imageFiles(importFiles);
    if (!existing && !photos.length) {
      notify(invalid.length ? "所选文件无法解码，请使用 JPEG、PNG 或 WebP。" : "请选择至少一张照片。");
      return;
    }
    const roll = { ...record, id: existing?.id || id(), photos: [...(existing?.photos || []), ...photos] };
    if (await change((next) => {
      if (existing) next.rolls[next.rolls.findIndex((item) => item.id === existing.id)] = roll;
      else next.rolls.unshift(roll);
    }, false)) {
      importFiles = [];
      openRoll(roll.id);
      if (invalid.length) notify(`已保存卷宗，${invalid.length} 张照片无法读取。`);
    }
  } finally { button.disabled = false; }
}

async function exportContact(button) {
  const roll = selectedRoll();
  button.disabled = true;
  try {
    const columns = Math.min(6, roll.photos.length);
    const rows = Math.ceil(roll.photos.length / columns);
    const tile = Math.max(52, Math.min(320, Math.floor(8000 / rows / .77)));
    const height = Math.round(tile * .77);
    if (rows * height > 8192) throw new Error("此卷照片太多，无法生成单张索引图。");
    const canvas = document.createElement("canvas");
    canvas.width = columns * tile;
    canvas.height = rows * height + 40;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "16px system-ui";
    ctx.fillStyle = "#fff";
    ctx.fillText(roll.name, 10, 26, canvas.width - 20);
    for (const [index, photo] of roll.photos.entries()) {
      const image = await loadImage(source(photo));
      const x = index % columns * tile;
      const y = 40 + Math.floor(index / columns) * height;
      fitImage(ctx, image, x + 4, y + 3, tile - 8, height - 18);
      ctx.fillText(String(index + 1).padStart(2, "0"), x + 5, y + height - 3);
    }
    download(await canvasBlob(canvas), `${roll.name}-索引图.png`);
  } catch (error) { notify(error.message || "索引图生成失败。"); }
  finally { button.disabled = false; }
}

async function exportWallpaper(button) {
  button.disabled = true;
  try {
    const photo = selectedPhoto();
    const image = await loadImage(source(photo));
    const canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    fitImage(ctx, image, 0, 0, canvas.width, canvas.height);
    download(await canvasBlob(canvas, "image/jpeg"), "MuseFilm-壁纸.jpg");
  } catch { notify("壁纸生成失败。"); }
  finally { button.disabled = false; }
}

async function printBook(button) {
  const book = library.books.find((item) => item.id === currentBook);
  const pages = document.createElement("div");
  pages.id = "print-pages";
  button.disabled = true;
  try {
    for (let page = 0; page <= Math.ceil(book.pages.length / 2); page++) {
      const canvas = document.createElement("canvas");
      await drawBook(canvas, book, page);
      pages.append(canvas);
    }
    document.body.append(pages);
    document.body.classList.add("printing-book");
    window.print();
  } catch { notify("画册打印文件生成失败。"); }
  finally {
    pages.remove();
    document.body.classList.remove("printing-book");
    button.disabled = false;
  }
}

function asDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function backup(button) {
  button.disabled = true;
  try {
    const records = [];
    for (const roll of rolls()) {
      const photos = [];
      for (const photo of roll.photos) photos.push({ id: photo.id, name: photo.name, image: await asDataURL(photo.blob) });
      records.push({ ...roll, photos });
    }
    const { films, cameras, books, instant } = library;
    const data = JSON.stringify({ format: "MuseFilm Web Library", version: 1, rolls: records, films, cameras, books, instant });
    download(new Blob([data], { type: "application/json" }), "MuseFilm-网页图库备份.json");
  } catch { notify("备份生成失败。"); }
  finally { button.disabled = false; }
}

async function restore(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const fields = ["rolls", "films", "cameras", "books", "instant"];
    if (data.format !== "MuseFilm Web Library" || data.version !== 1 || fields.some((key) => !Array.isArray(data[key]))) {
      throw new Error("请选择 MuseFilm 网页工作区导出的备份文件。");
    }
    const text = (value, limit = 120) => typeof value === "string" ? value.slice(0, limit) : "";
    const remap = new Map();
    const records = [];
    for (const raw of data.rolls) {
      const roll = { id: id(), photos: [] };
      for (const key of ["name", "date", "film", "camera", "place", "tags", "notes"]) roll[key] = text(raw[key], key === "notes" ? 4000 : 240);
      if (!roll.name.trim() || !Array.isArray(raw.photos)) throw new Error("备份的卷宗数据不完整。");
      for (const item of raw.photos) {
        const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(item.image);
        if (!match || match[1].toLowerCase() === "image/svg+xml" || typeof item.id !== "string" || remap.has(item.id)) throw new Error("备份的照片格式或索引无效。");
        const bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(match[2]) : Uint8Array.from(atob(match[2]), (byte) => byte.charCodeAt(0));
        const photo = { id: id(), name: text(item.name, 255) || "未命名照片", blob: new Blob([bytes], { type: match[1] }) };
        remap.set(item.id, photo.id);
        roll.photos.push(photo);
      }
      records.push(roll);
    }
    const films = data.films.map((item) => ({ id: id(), name: text(item.name), iso: text(item.iso, 12), stock: Math.max(0, Math.min(9999, Math.trunc(Number(item.stock) || 0))), expiry: text(item.expiry, 10) })).filter((item) => item.name);
    const cameras = data.cameras.map((item) => ({ id: id(), name: text(item.name), type: text(item.type), notes: text(item.notes, 200) })).filter((item) => item.name);
    const books = data.books.map((book) => {
      const pages = book.pages.map((key) => remap.get(key)).filter(Boolean);
      return { id: id(), title: text(book.title), pages, cover: remap.get(book.cover) || pages[0] };
    }).filter((book) => book.pages.length && book.title);
    const instant = data.instant.filter((item) => remap.has(item.photo)).map((item) => ({ id: id(), photo: remap.get(item.photo), style: item.style === "black" ? "black" : "white", caption: text(item.caption, 40) }));
    const imported = await change((next) => {
      next.rolls.push(...records);
      next.films.push(...films);
      next.cameras.push(...cameras);
      next.books.push(...books);
      next.instant.push(...instant);
    });
    if (imported) notify(`已合并 ${records.length} 卷照片与其他备份记录。`);
  } catch (error) { notify(error.message || "备份导入失败。"); }
}

const assistant = document.querySelector("#assistant");
const assistantOpen = document.querySelector("#assistant-open");
const result = document.querySelector("#assistant-result");

function toggleAssistant(open) {
  assistant.hidden = !open;
  assistantOpen.setAttribute("aria-expanded", String(open));
  if (open) assistant.querySelector("input").focus();
  else assistantOpen.focus();
}

function showAssistantMessage(message) {
  result.textContent = message;
  animate(result, [{ opacity: .25, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], 420);
}

async function analyzeRoll(roll, request) {
  const scores = [];
  for (const photo of roll.photos) {
    if (request !== analysisId) return [];
    showAssistantMessage(`正在检查 ${scores.length + 1} / ${roll.photos.length}`);
    try { scores.push({ photo, ...photoQuality(await loadImage(source(photo))) }); }
    catch { /* Other photos remain available for review. */ }
  }
  if (request === analysisId) qualityReport = { roll: roll.id, photos: roll.photos.length, scores };
  return scores;
}

async function ask(raw) {
  const request = ++analysisId;
  const prompt = raw.trim();
  if (!prompt) return;
  if (/^(查询|查找|搜索)\s+/.test(prompt)) {
    searchText = prompt.replace(/^(查询|查找|搜索)\s+/, "");
    navigate("search");
    showAssistantMessage(`找到 ${rolls().filter((roll) => matches(roll, searchText)).length} 个卷宗，已在工作区打开搜索结果。`);
  } else if (prompt.includes("封面") && destination === "book" && currentBook && bookPage > 0) {
    const book = library.books.find((item) => item.id === currentBook);
    const key = book.pages[(bookPage - 1) * 2 + (prompt.includes("右") ? 1 : 0)];
    if (!key) { showAssistantMessage("这一侧没有照片。"); return; }
    coverDraft = key;
    bookPage = 0;
    render();
    toggleAssistant(false);
    notify("已预览候选封面。请在封面与编排中确认。");
  } else if (/检查|质检|清晰|曝光/.test(prompt)) {
    const roll = selectedRoll();
    if (!roll?.photos.length) { showAssistantMessage("请先导入照片并选择卷宗。"); return; }
    const scores = qualityReport?.roll === roll.id && qualityReport.photos === roll.photos.length
      ? qualityReport.scores : await analyzeRoll(roll, request);
    if (request !== analysisId) return;
    const sharpest = scores.reduce((best, score) => !best || score.sharpness > best.sharpness ? score : best, null);
    if (!sharpest) { showAssistantMessage("当前卷宗没有可读取的照片。"); return; }
    if (prompt.includes("清晰")) showAssistantMessage(`${sharpest.photo.name} 的局部边缘分数最高。放大原片可进一步核对。`);
    else {
      const bright = scores.filter((item) => item.highlights >= .15).length;
      const dark = scores.filter((item) => item.shadows >= .3).length;
      showAssistantMessage(`已检查 ${scores.length} 张。近白像素占比较高 ${bright} 张，近黑像素占比较高 ${dark} 张。\n边缘分数最高：${sharpest.photo.name}`);
    }
  } else if (/总结|汇总/.test(prompt)) {
    showAssistantMessage(`图库有 ${rolls().length} 卷、${total()} 张照片、${library.films.length} 种胶卷和 ${library.cameras.length} 件器材。`);
  } else {
    showAssistantMessage("试试「查找 苏州」「总结图库」「检查当前卷」，或在画册跨页说「把右边这张移到封面」。");
  }
}

function frameStep(step) {
  const roll = selectedRoll();
  if (!roll?.photos.length) return;
  const index = roll.photos.indexOf(selectedPhoto()) + step;
  if (!roll.photos[index]) return;
  photoId = roll.photos[index].id;
  render();
  root.focus({ preventScroll: true });
}

async function setBookCover(key, remember) {
  const book = library.books.find((item) => item.id === currentBook);
  if (!book?.pages.includes(key)) return;
  if (!await change((next) => { next.books.find((item) => item.id === book.id).cover = key; }, false)) return;
  bookUndo = remember && book.cover !== key ? { id: book.id, cover: book.cover } : undefined;
  coverDraft = null;
  bookPage = 0;
  if (destination === "book") render();
}

async function exportCanvas(selector, name) {
  try {
    const canvas = root.querySelector(selector);
    if (!canvas.dataset.ready) { notify("请等预览完成。"); return; }
    download(await canvasBlob(canvas), name);
  } catch { notify("图片生成失败。"); }
}

function openPalette() {
  const search = document.querySelector("#palette-search");
  search.value = "";
  fillPalette();
  palette.showModal();
  search.focus();
}

function fillPalette() {
  const filter = document.querySelector("#palette-search").value.trim();
  const groups = [
    ["收藏与回看", ["home", "archive", "preview", "footprints"]],
    ["拍摄与冲扫", ["import", "film", "gear", "developing", "tags"]],
    ["创作与输出", ["light", "watermark", "book", "instant", "wallpaper", "exchange"]],
    ["账号与工具", ["search", "membership", "settings"]],
  ];
  document.querySelector("#palette-list").innerHTML = groups.map(([name, keys]) => {
    const matches = keys.filter((key) => labels[key][0].includes(filter));
    return matches.length ? `<h3>${name}</h3><div class="inline">${matches.map((key) => routeButton(key)).join("")}</div>` : "";
  }).join("") || '<p class="muted">没有匹配的功能。</p>';
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || !library) return;
  const data = button.dataset;
  if (data.route) navigate(data.route);
  else if (data.openRoll) openRoll(data.openRoll);
  else if (data.editRoll) {
    editId = data.editRoll;
    importFiles = [];
    navigate("import");
  } else if (data.frameStep) frameStep(Number(data.frameStep));
  else if (data.frame || data.lightFrame) {
    rollId = selectedRoll().id;
    photoId = data.frame || data.lightFrame;
    if (data.lightFrame) navigate("preview");
    else render();
  } else if (data.stock) await change((next) => {
    const film = next.films.find((item) => item.id === data.stock);
    film.stock = Math.max(0, Math.min(9999, film.stock + Number(data.delta)));
  });
  else if (data.openBook) {
    currentBook = data.openBook;
    bookPage = 0;
    coverDraft = null;
    render();
  } else if (data.bookPage) {
    coverDraft = null;
    bookPage += Number(data.bookPage);
    render();
  } else if (data.movePage) {
    await change((next) => {
      const pages = next.books.find((book) => book.id === currentBook).pages;
      const index = Number(data.movePage);
      if (index > 0) [pages[index - 1], pages[index]] = [pages[index], pages[index - 1]];
    });
  } else if (data.openInstant) {
    const item = library.instant.find((record) => record.id === data.openInstant);
    const form = root.querySelector("#instant-form");
    form.elements.namedItem("photo").value = item.photo;
    form.elements.namedItem("style").value = item.style;
    form.elements.namedItem("caption").value = item.caption;
    paintInstant();
  } else if (data.queueDownload != null) {
    const item = queue[Number(data.queueDownload)];
    if (item?.result) download(item.result, item.photo.name.replace(/\.[^.]+$/, "") + "-水印.jpg");
  } else if (data.prompt) ask(data.prompt);
  else {
    switch (button.id) {
      case "sample-roll": await importSample(button); break;
      case "quick-add": editId = null; importFiles = []; navigate("import"); break;
      case "download-original": download(selectedPhoto().blob, selectedPhoto().name); break;
      case "contact-export": await exportContact(button); break;
      case "wallpaper-export": await exportWallpaper(button); break;
      case "reset-light":
        for (const key of tilePositions.keys()) if (key.startsWith("light-")) tilePositions.delete(key);
        render();
        break;
      case "timer-start":
        if (timer.ends) {
          timer.remaining = Math.max(0, Math.ceil((timer.ends - Date.now()) / 1000));
          timer.ends = 0;
        } else {
          if (!timer.remaining) timer.remaining = library.recipe.seconds;
          timer.ends = Date.now() + timer.remaining * 1000;
        }
        render();
        break;
      case "timer-reset": timer = { remaining: library.recipe.seconds, ends: 0 }; render(); break;
      case "book-back": currentBook = null; coverDraft = null; render(); break;
      case "book-apply": await setBookCover(coverDraft, true); break;
      case "book-cancel": coverDraft = null; render(); break;
      case "book-undo": await setBookCover(bookUndo.cover, false); break;
      case "book-export": await exportCanvas("#book-canvas", "MuseFilm-画册.png"); break;
      case "book-print": await printBook(button); break;
      case "instant-export": await exportCanvas("#instant-canvas", "MuseFilm-相纸.png"); break;
      case "queue-pause": queuePaused = !queuePaused; renderQueue(); if (!queuePaused) runQueue(); break;
      case "queue-retry": queue.forEach((item) => { if (item.phase === "failed") item.phase = "waiting"; }); queuePaused = false; runQueue(); break;
      case "backup-export": await backup(button); break;
      case "all-tools": openPalette(); break;
      case "assistant-open": toggleAssistant(assistant.hidden); break;
      case "assistant-close": toggleAssistant(false); break;
    }
  }
});

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  switch (form.id) {
    case "roll-form": await saveRoll(form); break;
    case "catalog-form": {
      const name = data.get("name").trim();
      if (!name) { notify("请输入名称。"); break; }
      const kind = form.dataset.kind;
      const item = { id: id(), ...Object.fromEntries(data), name };
      if (kind === "films") item.stock = Number(item.stock);
      await change((next) => next[kind].unshift(item));
      break;
    }
    case "search-form":
      searchText = data.get("query");
      root.querySelector("#search-results").innerHTML = searchResults();
      break;
    case "recipe-form":
      if (await change((next) => { next.recipe = { title: data.get("title"), seconds: Number(data.get("seconds")) }; }, false)) {
        timer = { remaining: library.recipe.seconds, ends: 0 };
        render();
      }
      break;
    case "lab-form":
      document.body.classList.add("printing-tag");
      try { window.print(); } finally { document.body.classList.remove("printing-tag"); }
      break;
    case "book-create": {
      const pages = choosePhotos(form).map((photo) => photo.id);
      const title = data.get("title").trim();
      if (!title || !pages.length) { notify("请填写标题并至少勾选一张照片。"); break; }
      const book = { id: id(), title, pages, cover: pages[0] };
      if (await change((next) => next.books.unshift(book), false)) {
        currentBook = book.id; coverDraft = null; bookPage = 0; render();
      }
      break;
    }
    case "book-cover-form": coverDraft = data.get("cover"); bookPage = 0; render(); break;
    case "instant-form": {
      const record = { id: id(), ...Object.fromEntries(data) };
      if (await change((next) => next.instant.unshift(record))) notify("相纸已存入盒中。");
      break;
    }
    case "watermark-form": {
      if (queueRunning) break;
      const photos = choosePhotos(form);
      if (!photos.length) { notify("请至少勾选一张照片。"); break; }
      queue = photos.map((photo) => ({ photo, phase: "waiting" }));
      queueSettings = { style: data.get("style"), caption: data.get("caption") };
      queuePaused = false;
      runQueue();
      break;
    }
  }
});

function chooseFiles(files) {
  importFiles = [...files];
  const summary = root.querySelector("#file-summary");
  if (summary) summary.textContent = importFiles.length ? `已选择 ${importFiles.length} 张` : "可一次选择多张";
}

root.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-roll-picker]")) {
    rollId = target.value;
    photoId = undefined;
    if (destination === "watermark" && queueRunning) queuePaused = true;
    render();
  } else if (target.matches('#roll-form input[type="file"]')) chooseFiles(target.files);
  else if (target.id === "appearance") change((next) => { next.theme = target.value; });
  else if (target.id === "backup-import") restore(target.files[0]);
});

root.addEventListener("input", (event) => {
  const target = event.target;
  if (target.closest("#watermark-form")) paintWatermark();
  else if (target.closest("#instant-form")) paintInstant();
  else if (target.id === "lab-input") document.querySelector("#lab-note").textContent = target.value || "冲扫要求";
  else if (target.id === "light-zoom") root.querySelector("#light-board").style.setProperty("--zoom", target.value);
});

for (const eventName of ["dragover", "dragleave", "drop"]) {
  root.addEventListener(eventName, (event) => {
    const zone = event.target.closest("#image-drop");
    if (!zone) return;
    event.preventDefault();
    zone.classList.toggle("is-over", eventName === "dragover");
    if (eventName === "drop") chooseFiles(event.dataTransfer.files);
  });
}

document.querySelector("#palette-search").addEventListener("input", fillPalette);
document.querySelector("#assistant-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!library) return;
  const data = new FormData(event.target);
  event.target.reset();
  ask(data.get("prompt"));
});
document.addEventListener("keydown", (event) => {
  if (!library) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!palette.open) openPalette();
  } else if (event.key === "Escape" && !assistant.hidden && !palette.open) toggleAssistant(false);
  else if (destination === "preview" && !event.target.closest("button,input,select,textarea,dialog") && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    frameStep(event.key === "ArrowRight" ? 1 : -1);
  }
});
const routeFromURL = () => location.hash.slice(1) || "home";
window.addEventListener("popstate", () => { if (library) navigate(routeFromURL(), { hash: false }); });
window.addEventListener("hashchange", () => { if (library && routeFromURL() !== destination) navigate(routeFromURL(), { hash: false }); });
setInterval(updateTimer, 220);
dock.innerHTML = Object.keys(labels).map((key) => `<button type="button" data-route="${key}">${icon(key)}${labels[key][0]}</button>`).join("");

try {
  library = await loadLibrary();
  timer.remaining = library.recipe.seconds;
  navigate(routeFromURL(), { hash: false, focus: false });
} catch {
  root.innerHTML = pagehead("无法打开本机图库") + '<p>浏览器未提供可用的站点存储。请检查当前浏览器设置后重新打开网页。</p>';
}
