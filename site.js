const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-toggle]");
const menu = document.querySelector("[data-menu]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let currentLanguage = "zh";
let refreshScreenDeckLanguage = () => {};
let refreshSoundLanguage = () => {};
let refreshReleaseLanguage = () => {};
let refreshGalleryLanguage = () => {};
let refreshPlatformDownload = () => {};

const TRANSLATIONS = {
  zh: {
    "skip": "跳到主要内容",
    "menu": "菜单",
    "nav.home": "首页",
    "nav.product": "产品",
    "nav.gallery": "影像",
    "nav.screens": "界面",
    "nav.download": "下载",
    "aria.nav": "主导航",
    "aria.macNav": "Mac 页面导航",
    "aria.deck": "MuseFilm 胶卷联动界面叙事，可滚动浏览并用左右方向键切换",
    "aria.platforms": "平台截图",
    "aria.prev": "上一张截图",
    "aria.next": "下一张截图",
    "aria.filmProgress": "胶片截图进度",
    "aria.galleryFrames": "选择胶卷画面",
    "aria.galleryClose": "关闭画面预览",
    "aria.lightTable": "模拟观片台，可拖入图片并移动画面",
    "aria.lightTablePhotos": "观片台中的照片",
    "aria.zoomOut": "缩小所选画面",
    "aria.zoomIn": "放大所选画面",
    "aria.visitorCounter": "MuseFilm 匿名访问计数",
    "feedback.trigger": "反馈",
    "feedback.overline": "写给 MuseFilm",
    "feedback.title": "让下一卷更好。",
    "feedback.intro": "告诉我哪里不顺手，或你希望下一次打开时多出什么。反馈会被安全保存，并保留可选联系方式，便于后续跟进。",
    "feedback.close": "关闭反馈窗口",
    "feedback.type": "反馈类型",
    "feedback.typeBug": "遇到问题",
    "feedback.typeSuggestion": "功能建议",
    "feedback.typeOther": "其他想法",
    "feedback.message": "具体内容",
    "feedback.placeholder": "发生了什么？你希望它怎样工作？",
    "feedback.email": "联系邮箱 · 选填",
    "feedback.emailPlaceholder": "方便回复你的邮箱",
    "feedback.privacy": "只记录必要的页面与设备信息，不保存原始 IP。",
    "feedback.github": "改用 GitHub Issue ↗",
    "feedback.submit": "发送反馈",
    "feedback.sending": "正在送出…",
    "feedback.success": "已经收到，谢谢你留下这一格。",
    "feedback.stored": "已经收到，谢谢你留下这一格。",
    "feedback.error": "暂时无法发送，请稍后再试或使用 GitHub Issue。",
    "feedback.verify": "请先完成人机验证。",
    "hero.overline": "为每一卷光，留一张观片台。",
    "hero.line1": "让一整卷光，",
    "hero.line2": "重新回到眼前。",
    "hero.description": "MuseFilm 把胶卷、扫描与拍摄记忆安放在一处。像在观片台上展开底片，先看见一卷的呼吸，再靠近那张真正留下来的照片。",
    "hero.downloadWindows": "下载 Windows 版",
    "hero.downloadMac": "下载 macOS 版",
    "hero.downloadReleases": "查看所有版本",
    "hero.explore": "探索 MuseFilm",
    "hero.verified": "次 GitHub Releases 已验证下载",
    "hero.visitors": "次匿名到访",
    "hero.scroll": "滚动展开胶片",
    "sound.off": "声音关闭",
    "sound.on": "声音开启",
    "chapter.archive.overline": "从胶卷开始",
    "chapter.archive.title": "上下文，比文件夹更重要。",
    "chapter.archive.body": "围绕每一卷整理照片、日期、相机、地点、标签与冲扫记录，让一组扫描重新成为完整的拍摄记忆。",
    "chapter.library.overline": "胶卷库",
    "chapter.library.title": "每一种胶片，都留下自己的性格。",
    "chapter.library.body": "保存胶片品牌、感光度、格式与使用记录，在下一次装卷之前重新找到熟悉的色彩。",
    "chapter.table.overline": "数字观片台",
    "chapter.table.title": "让一卷照片重新回到光下。",
    "chapter.table.body": "像查看底片一样浏览整卷影像，在全局、细节和元数据之间自然切换。",
    "chapter.search.overline": "重新发现",
    "chapter.search.title": "记忆不再埋在硬盘深处。",
    "chapter.search.body": "按时间、器材、胶片、地点与标签快速回到某一卷、某一次旅行或某一束光。",
    "museum.overline": "完整界面展馆",
    "museum.title": "走进 MuseFilm。",
    "museum.body": "在 Mac 与 Windows 的真实界面之间移动。方向键、拖动或按钮均可切换画面。",
    "museum.fullscreen": "全屏观看",
    "museum.exitFullscreen": "退出全屏",
    "intro.overline": "从胶卷到档案",
    "intro.title": "每一卷，都有自己的上下文。",
    "intro.body": "MuseFilm 围绕“胶卷”组织照片、器材、地点、标签与备注，让散落在硬盘里的扫描文件重新成为一份档案。",
    "feature.archive.title": "按卷归档",
    "feature.archive.body": "维护照片、拍摄日期、相机、地点和标签。",
    "feature.view.title": "观片与搜索",
    "feature.view.body": "在底片、预览和搜索之间自然回看照片。",
    "feature.local.title": "本地优先",
    "feature.local.body": "原图保留在原来的硬盘位置，只记录档案信息。",
    "local.overline": "从设计开始，本地优先",
    "local.title": "照片始终属于你。",
    "local.titleLine1": "照片始终",
    "local.titleLine2": "属于你。",
    "local.lead": "没有云端，没有重复图库，没有强制迁移。",
    "local.body": "照片仍然保存在原来的硬盘位置。你可以自由备份、迁移，也可以在离开 MuseFilm 后继续拥有完整的照片库。",
    "gallery.overline": "为摄影而生",
    "gallery.title": "档案的终点，仍然是照片。",
    "gallery.body": "软件退到背后，让一卷胶片里的光、时间和记忆回到画面中心。",
    "gallery.roll": "所属胶卷",
    "gallery.status": "档案状态",
    "gallery.archived": "已归档",
    "gallery.tags": "检索标签",
    "gallery.hint": "选择任意画面，查看它在胶卷中的位置与可检索信息。",
    "gallery.prev": "上一帧",
    "gallery.next": "下一帧",
    "gallery.zoom": "放大查看",
    "lightTable.eyebrow": "模拟观片台",
    "lightTable.title": "把照片放回光下。",
    "lightTable.frames": "张画面",
    "lightTable.reset": "复位",
    "lightTable.upload": "导入照片",
    "lightTable.exit": "退出",
    "lightTable.enter": "进入模拟观片台",
    "lightTable.enterHint": "点击后可拖动、缩放与导入本地照片",
    "lightTable.dropTitle": "将照片拖到这里",
    "lightTable.dropBody": "支持 JPG、PNG、HEIC、WebP 等本地图片",
    "lightTable.source": "来源",
    "lightTable.dimensions": "尺寸",
    "lightTable.size": "文件大小",
    "lightTable.exampleSource": "示例胶卷",
    "lightTable.localSource": "本地照片",
    "lightTable.exampleSize": "内置示例",
    "lightTable.localDescription": "这张照片只在当前观片台中打开。拖动调整位置，滚轮或控制按钮改变大小。",
    "lightTable.remove": "移除画面",
    "lightTable.privacy": "照片只在当前浏览器中预览，不会上传。",
    "lightTable.empty": "观片台是空的，请导入照片或恢复例图。",
    "download.overline": "下载 MuseFilm",
    "download.title": "从一卷开始。",
    "download.body": "安装包由 GitHub Releases 托管，下载次数来自真实资产记录。",
    "download.total": "已验证下载总数",
    "download.winReq": "Windows 10 / 11 · 278 MB",
    "download.macReq": "原生 SwiftUI · build 2 · 5.3 MB",
    "download.count": "次下载",
    "download.windows": "下载 Windows 版",
    "download.mac": "下载 macOS 版",
    "download.releaseNotes": "版本说明 ↗",
    "download.published": "发布",
    "download.checksum": "SHA-256",
    "download.copy": "复制",
    "download.copied": "已复制",
    "download.notesOverline": "最新版本",
    "download.notesFallback": "正在从 GitHub 获取最新更新说明。",
    "download.fullNotes": "查看完整版本说明 ↗",
    "download.historyOverline": "版本历史",
    "download.historyTitle": "展开查看全部版本",
    "download.historyCount": "个版本",
    "download.historyLoading": "正在读取 GitHub Releases…",
    "download.historyEmpty": "暂时没有公开版本。",
    "download.historyUnavailable": "GitHub 暂时不可用，可前往 Releases 查看全部版本。",
    "download.prerelease": "测试版",
    "download.stable": "正式版",
    "download.releaseAssets": "安装包与文件",
    "download.releaseDownloads": "次下载",
    "download.viewRelease": "查看版本说明 ↗",
    "download.noReleaseNotes": "此版本没有填写更新说明。",
    "download.noInstaller": "暂无安装包",
    "download.viewMacRelease": "查看 macOS 版本",
    "footer.slogan": "献给仍在拍胶片的人。",
    "status.synced": "下载次数已与 GitHub Releases 同步",
    "status.fallback": "GitHub 暂时不可用 · 显示最近验证数据",
    "status.opened": "已打开 GitHub · 完成下载后会自动记录",
    "mac.overline": "原生 macOS 应用",
    "mac.title": "MuseFilm Mac 版",
    "mac.body": "原生 SwiftUI、安静的三栏结构，以及为照片留出的清晰空间。每一卷、每一张、每一次冲扫，都以更贴近 macOS 的方式保存。",
    "mac.back": "返回首页 ↙",
    "mac.workflowOverline": "原生工作流",
    "mac.workflowTitle": "重新组织摄影档案。",
    "mac.workflowBody": "首页、档案、胶卷库、观片台、搜索和预览，回到一个一致的桌面工作流。",
    "mac.ready": "再装一卷，随时出发。",
    "mac.countSuffix": "次真实下载，由 GitHub Releases 提供。",
    "mac.download": "下载 MuseFilm 2.0",
    "screen.archive": "档案",
    "screen.library": "胶卷库",
    "screen.lightTable": "观片台",
    "screen.preview": "预览",
  },
  en: {
    "skip": "Skip to main content",
    "menu": "Menu",
    "nav.home": "Home",
    "nav.product": "Product",
    "nav.gallery": "Gallery",
    "nav.screens": "Screens",
    "nav.download": "Download",
    "aria.nav": "Main navigation",
    "aria.macNav": "Mac page navigation",
    "aria.deck": "MuseFilm reel-linked interface story; scroll or use the arrow keys to navigate",
    "aria.platforms": "Platform screenshots",
    "aria.prev": "Previous screenshot",
    "aria.next": "Next screenshot",
    "aria.filmProgress": "Film screenshot progress",
    "aria.galleryFrames": "Choose a frame from the roll",
    "aria.galleryClose": "Close frame preview",
    "aria.lightTable": "Simulated light table; drop images here and drag frames to arrange them",
    "aria.lightTablePhotos": "Photos on the light table",
    "aria.zoomOut": "Zoom out selected frame",
    "aria.zoomIn": "Zoom in selected frame",
    "aria.visitorCounter": "MuseFilm anonymous visit counter",
    "feedback.trigger": "Feedback",
    "feedback.overline": "A note for MuseFilm",
    "feedback.title": "Make the next roll better.",
    "feedback.intro": "Tell us what felt awkward, or what you hope to find the next time you open MuseFilm. Your note is stored securely with optional contact details for follow-up.",
    "feedback.close": "Close feedback dialog",
    "feedback.type": "Feedback type",
    "feedback.typeBug": "Something went wrong",
    "feedback.typeSuggestion": "Feature suggestion",
    "feedback.typeOther": "Another thought",
    "feedback.message": "Your note",
    "feedback.placeholder": "What happened, and how should it work instead?",
    "feedback.email": "Contact email · optional",
    "feedback.emailPlaceholder": "An email for a possible reply",
    "feedback.privacy": "Only essential page and device context is recorded. Raw IP addresses are never stored.",
    "feedback.github": "Use GitHub Issue instead ↗",
    "feedback.submit": "Send feedback",
    "feedback.sending": "Sending…",
    "feedback.success": "Received. Thank you for leaving this frame with us.",
    "feedback.stored": "Received. Thank you for leaving this frame with us.",
    "feedback.error": "Could not send right now. Try again later or use GitHub Issues.",
    "feedback.verify": "Please complete the verification first.",
    "hero.overline": "A light table for every roll of light.",
    "hero.line1": "Bring an entire roll",
    "hero.line2": "back into the light.",
    "hero.description": "MuseFilm keeps rolls, scans, and memories in one quiet place. Read the rhythm of a strip on the light table, then move closer to the frame that stays with you.",
    "hero.downloadWindows": "Download for Windows",
    "hero.downloadMac": "Download for macOS",
    "hero.downloadReleases": "View all releases",
    "hero.explore": "Explore MuseFilm",
    "hero.verified": "verified downloads on GitHub Releases",
    "hero.visitors": "anonymous visits",
    "hero.scroll": "Scroll to unspool the film",
    "sound.off": "Sound off",
    "sound.on": "Sound on",
    "chapter.archive.overline": "Begin with the roll",
    "chapter.archive.title": "Context matters more than folders.",
    "chapter.archive.body": "Keep photographs, dates, cameras, places, tags, and developing notes around every roll, restoring a complete memory from a folder of scans.",
    "chapter.library.overline": "Film library",
    "chapter.library.title": "Every film stock keeps its character.",
    "chapter.library.body": "Save brands, speeds, formats, and usage history, then find a familiar palette before loading the next roll.",
    "chapter.table.overline": "Digital light table",
    "chapter.table.title": "Bring an entire roll back into the light.",
    "chapter.table.body": "Review a roll like a strip of negatives, moving naturally between the whole sequence, fine detail, and metadata.",
    "chapter.search.overline": "Rediscover",
    "chapter.search.title": "Memories no longer disappear into a drive.",
    "chapter.search.body": "Return to a roll, a journey, or a particular light through dates, equipment, film, places, and tags.",
    "museum.overline": "Complete interface museum",
    "museum.title": "Step inside MuseFilm.",
    "museum.body": "Move through the real Mac and Windows interfaces with arrow keys, a drag gesture, or the controls.",
    "museum.fullscreen": "View fullscreen",
    "museum.exitFullscreen": "Exit fullscreen",
    "intro.overline": "From roll to archive",
    "intro.title": "Every roll keeps its context.",
    "intro.body": "MuseFilm organizes photographs, equipment, places, tags, and notes around each roll, turning scattered scans back into a coherent archive.",
    "feature.archive.title": "Roll-based archive",
    "feature.archive.body": "Keep photographs, dates, cameras, places, and tags together.",
    "feature.view.title": "View and search",
    "feature.view.body": "Move naturally between negatives, previews, and search.",
    "feature.local.title": "Local first",
    "feature.local.body": "Originals stay where they are; MuseFilm stores the context.",
    "local.overline": "Local first, by design",
    "local.title": "Your photos stay yours.",
    "local.titleLine1": "Your photos.",
    "local.titleLine2": "Always yours.",
    "local.lead": "No cloud. No duplicate library. No forced migration.",
    "local.body": "Photographs remain in their original folders. Back up, move, or leave MuseFilm at any time while keeping the complete library.",
    "gallery.overline": "Made for photography",
    "gallery.title": "The archive ends with the photograph.",
    "gallery.body": "The software steps back so light, time, and memory can return to the center of every roll.",
    "gallery.roll": "Roll",
    "gallery.status": "Archive status",
    "gallery.archived": "Archived",
    "gallery.tags": "Search tags",
    "gallery.hint": "Choose a frame to see its place on the roll and its searchable context.",
    "gallery.prev": "Previous",
    "gallery.next": "Next",
    "gallery.zoom": "View larger",
    "lightTable.eyebrow": "Simulated light table",
    "lightTable.title": "Bring photographs back into the light.",
    "lightTable.frames": "frames",
    "lightTable.reset": "Reset",
    "lightTable.upload": "Import",
    "lightTable.exit": "Exit",
    "lightTable.enter": "Enter the light table",
    "lightTable.enterHint": "Click to drag, resize, and import local photographs",
    "lightTable.dropTitle": "Drop photographs here",
    "lightTable.dropBody": "Supports local JPG, PNG, HEIC, WebP, and more",
    "lightTable.source": "Source",
    "lightTable.dimensions": "Dimensions",
    "lightTable.size": "File size",
    "lightTable.exampleSource": "Example roll",
    "lightTable.localSource": "Local photograph",
    "lightTable.exampleSize": "Built-in example",
    "lightTable.localDescription": "This photograph is open only on the current light table. Drag to position it, then use the wheel or controls to resize it.",
    "lightTable.remove": "Remove frame",
    "lightTable.privacy": "Photographs stay in this browser and are never uploaded.",
    "lightTable.empty": "The light table is empty. Import photographs or restore the examples.",
    "download.overline": "Download MuseFilm",
    "download.title": "Start with one roll.",
    "download.body": "Installers are hosted on GitHub Releases, with counts taken from the real release assets.",
    "download.total": "Total verified downloads",
    "download.winReq": "Windows 10 / 11 · 278 MB",
    "download.macReq": "Native SwiftUI · build 2 · 5.3 MB",
    "download.count": "downloads",
    "download.windows": "Download for Windows",
    "download.mac": "Download for macOS",
    "download.releaseNotes": "Release notes ↗",
    "download.published": "Published",
    "download.checksum": "SHA-256",
    "download.copy": "Copy",
    "download.copied": "Copied",
    "download.notesOverline": "Latest release",
    "download.notesFallback": "Loading the latest release notes from GitHub.",
    "download.fullNotes": "View full release notes ↗",
    "download.historyOverline": "Version history",
    "download.historyTitle": "Expand all releases",
    "download.historyCount": "releases",
    "download.historyLoading": "Loading GitHub Releases…",
    "download.historyEmpty": "No public releases yet.",
    "download.historyUnavailable": "GitHub is temporarily unavailable. Open Releases to view the complete history.",
    "download.prerelease": "Pre-release",
    "download.stable": "Stable",
    "download.releaseAssets": "Installers and files",
    "download.releaseDownloads": "downloads",
    "download.viewRelease": "View release notes ↗",
    "download.noReleaseNotes": "No release notes were provided for this version.",
    "download.noInstaller": "No installer attached",
    "download.viewMacRelease": "View macOS release",
    "footer.slogan": "Made for people who still shoot film.",
    "status.synced": "Live counts synced from GitHub Releases",
    "status.fallback": "GitHub temporarily unavailable · showing last verified totals",
    "status.opened": "Opened on GitHub · completed downloads are recorded automatically",
    "mac.overline": "Native on macOS",
    "mac.title": "MuseFilm for Mac",
    "mac.body": "Native SwiftUI, a quiet three-column structure, and clear space for photographs. Every roll, frame, and developing session feels at home on macOS.",
    "mac.back": "Back to home ↙",
    "mac.workflowOverline": "Native workflow",
    "mac.workflowTitle": "The archive, recomposed.",
    "mac.workflowBody": "Home, archive, film library, light table, search, and preview return to one consistent desktop workflow.",
    "mac.ready": "Ready for one more roll.",
    "mac.countSuffix": "verified downloads, provided by GitHub Releases.",
    "mac.download": "Download MuseFilm 2.0",
    "screen.archive": "Archive",
    "screen.library": "Film library",
    "screen.lightTable": "Light table",
    "screen.preview": "Preview",
  },
};

const PAGE_META = {
  home: {
    zh: { title: "MuseFilm — 胶片摄影档案", description: "MuseFilm 是为胶片摄影用户打造的本地优先桌面档案工具。" },
    en: { title: "MuseFilm — Analog photography archive", description: "MuseFilm is a local-first desktop archive for film photographers." },
  },
  mac: {
    zh: { title: "MuseFilm Mac 版 — 原生胶片档案", description: "MuseFilm Mac 版是原生 SwiftUI 胶片摄影档案工具。" },
    en: { title: "MuseFilm for Mac — Native film archive", description: "MuseFilm for Mac is a native SwiftUI archive for film photography." },
  },
};

function translate(key) {
  return TRANSLATIONS[currentLanguage]?.[key] || TRANSLATIONS.zh[key] || key;
}

function applyLanguage(language) {
  currentLanguage = language === "en" ? "en" : "zh";
  document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", translate(element.dataset.i18nAria));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", translate(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-language-toggle]").forEach((button) => {
    button.textContent = currentLanguage === "zh" ? "EN" : "中文";
    button.setAttribute("aria-label", currentLanguage === "zh" ? "Switch to English" : "切换到中文");
  });
  const page = document.documentElement.dataset.page || "home";
  const meta = PAGE_META[page]?.[currentLanguage];
  if (meta) {
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
  }
  refreshScreenDeckLanguage();
  refreshSoundLanguage();
  refreshReleaseLanguage();
  refreshGalleryLanguage();
  refreshPlatformDownload();
}

const filmModel = document.querySelector("[data-film-model]");
const filmFinale = document.querySelector("[data-film-finale]");
if (filmModel || filmFinale) {
  import("./film-model.js?v=20260812-3d1")
    .then(({ mountFilmModel }) => {
      if (filmModel) mountFilmModel(filmModel, { reducedMotion });
      if (filmFinale) mountFilmModel(filmFinale, { reducedMotion, finale: true });
    })
    .catch((error) => {
      console.error("MuseFilm 3D model failed to load", error);
      filmModel?.classList.add("model-fallback");
      filmFinale?.classList.add("model-fallback");
    });
}

const soundButton = document.querySelector("[data-sound-toggle]");
let ambientAudio = null;
let soundEnabled = false;

function playFilmDetent() {
  if (!soundEnabled || !ambientAudio || reducedMotion) return;
  const { context, master } = ambientAudio;
  if (context.state === "closed") return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(148, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(54, context.currentTime + .052);
  gain.gain.setValueAtTime(.028, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .072);
  oscillator.connect(gain).connect(master);
  oscillator.start();
  oscillator.stop(context.currentTime + .08);
}

function updateSoundButton() {
  if (!soundButton) return;
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  const label = soundButton.querySelector("span");
  if (label) label.textContent = translate(soundEnabled ? "sound.on" : "sound.off");
}

async function startDarkroomSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  const context = new AudioContextClass();
  const master = context.createGain();
  master.gain.value = 0.0001;
  master.connect(context.destination);

  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let brown = 0;
  for (let index = 0; index < samples.length; index++) {
    brown = (brown + (Math.random() * 2 - 1) * 0.018) / 1.018;
    samples[index] = brown * 2.4;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  noise.connect(filter).connect(master);
  noise.start();

  const click = () => {
    if (context.state === "closed") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(118, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(48, context.currentTime + .045);
    gain.gain.setValueAtTime(.018, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .055);
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + .06);
  };
  const clickTimer = window.setInterval(click, 420);
  await context.resume();
  master.gain.exponentialRampToValueAtTime(.032, context.currentTime + .45);
  ambientAudio = { context, master, noise, clickTimer };
  return true;
}

function stopDarkroomSound() {
  if (!ambientAudio) return;
  const { context, master, noise, clickTimer } = ambientAudio;
  window.clearInterval(clickTimer);
  master.gain.cancelScheduledValues(context.currentTime);
  master.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .22);
  window.setTimeout(() => {
    try { noise.stop(); } catch {}
    context.close();
  }, 260);
  ambientAudio = null;
}

soundButton?.addEventListener("click", async () => {
  if (soundEnabled) {
    soundEnabled = false;
    stopDarkroomSound();
  } else {
    soundEnabled = await startDarkroomSound();
  }
  updateSoundButton();
});
refreshSoundLanguage = updateSoundButton;
window.addEventListener("pagehide", stopDarkroomSound, { once: true });

const SCREENSHOTS = [
  { platform: "mac", src: "./images/app-details/01-home.avif", width: 1046, height: 768, kickerZh: "所有故事，从全局开始", kickerEn: "Every story begins with the whole", zh: "从这一刻，看见整个档案。", en: "See the whole archive at once.", descZh: "最近导入的照片、仍在生长的胶卷，以及被时间慢慢填满的收藏，都在这里安静相遇。无需翻找文件夹，目光落下的地方，就是你下一次整理的起点。", descEn: "Recent imports, growing rolls, and a collection slowly shaped by time meet in one quiet view. No folders to hunt through—the place your eye lands is where the next chapter begins.", altZh: "MuseFilm Mac 首页与最近导入", altEn: "MuseFilm Mac home and recent imports" },
  { platform: "mac", src: "./images/app-details/02-archive.avif", width: 1046, height: 768, kickerZh: "不只归档，更保存上下文", kickerEn: "More than files. The context around them", zh: "一卷胶片，就是一段完整的时间。", en: "A roll is a complete passage of time.", descZh: "日期、相机、地点、标签与扫描影像围绕同一卷自然归位。MuseFilm 保存的不只是文件，而是按下快门前后的空气，让多年后的回看依然有迹可循。", descEn: "Dates, cameras, places, tags, and scans settle naturally around a single roll. MuseFilm keeps more than files—it preserves the atmosphere around each shutter press, ready to be found years later.", altZh: "MuseFilm Mac 档案页面", altEn: "MuseFilm Mac archive" },
  { platform: "mac", src: "./images/app-details/03-film-library.avif", width: 1046, height: 768, kickerZh: "每一种乳剂，都有自己的性格", kickerEn: "Every emulsion has a character", zh: "记住色彩，也记住选择。", en: "Remember the color. And the choice.", descZh: "品牌、型号、感光度与使用历史，被整理成一座属于你的胶片谱系。下一次装卷之前，那些熟悉的颗粒、反差与色温，已经替你唤醒过往的经验。", descEn: "Brands, stocks, speeds, and shooting history become a film vocabulary that is entirely yours. Before the next roll is loaded, familiar grain, contrast, and color have already brought experience back to mind.", altZh: "MuseFilm Mac 胶卷库", altEn: "MuseFilm Mac film library" },
  { platform: "mac", src: "./images/app-details/04-equipment.avif", width: 1046, height: 768, kickerZh: "工具有名字，作品有来处", kickerEn: "Every tool has a name. Every image, an origin", zh: "器材退到身后，作品留在眼前。", en: "Let the tools recede. Let the work remain.", descZh: "相机与镜头被妥善记录，却不打断观看本身。需要时，每一张照片都能回到真实的机身、焦段与组合；不需要时，界面只留下影像应有的安静。", descEn: "Cameras and lenses are carefully recorded without interrupting the act of looking. When needed, every frame returns to its body, focal length, and pairing; otherwise, only the image remains.", altZh: "MuseFilm Mac 器材库", altEn: "MuseFilm Mac equipment library" },
  { platform: "mac", src: "./images/app-details/05-developing.avif", width: 1046, height: 768, kickerZh: "暗房里，时间也是一种材料", kickerEn: "In the darkroom, time is a material", zh: "每一秒，都值得被记住。", en: "Every second deserves to be remembered.", descZh: "显影液、温度、步骤和倒计时在同一条节奏中展开，让双手专注于胶片，而不是反复确认数字。完成之后，配方与经验被留下，下一次可以从更从容的地方开始。", descEn: "Chemistry, temperature, steps, and time unfold in one measured rhythm, leaving your hands free to attend to the film. When the process ends, its recipe and experience remain for a calmer next session.", altZh: "MuseFilm Mac 冲扫计时器", altEn: "MuseFilm Mac developing timer" },
  { platform: "mac", src: "./images/app-details/06-light-table.avif", width: 1046, height: 768, kickerZh: "让底片，重新回到光下", kickerEn: "Bring the negatives back into the light", zh: "把一整卷光，铺在眼前。", en: "Lay an entire roll of light before you.", descZh: "整卷影像像真正的底片一样依次展开，相邻画面之间的停顿、重复与变化重新变得清晰。你可以先感受一卷的呼吸，再靠近那张真正留下来的照片。", descEn: "An entire roll unfolds like negatives on a real light table, revealing the pauses, repetitions, and changes between frames. Read the rhythm first, then move closer to the image that stays with you.", altZh: "MuseFilm Mac 观片台", altEn: "MuseFilm Mac light table" },
  { platform: "mac", src: "./images/app-details/07-preview.avif", width: 1046, height: 768, kickerZh: "一张照片，也有完整的来路", kickerEn: "Every photograph carries where it came from", zh: "靠近画面，也靠近当时。", en: "Move closer to the frame—and the moment.", descZh: "放大一张照片时，胶卷、器材、地点和标签仍在触手可及之处。细节没有吞没故事，信息也没有遮住影像；它们只在需要时出现，帮助记忆重新获得轮廓。", descEn: "As a photograph expands, its roll, equipment, place, and tags remain close at hand. Detail never overwhelms the story, and information never covers the image—it appears only when memory needs an outline.", altZh: "MuseFilm Mac 照片预览与元数据", altEn: "MuseFilm Mac photo preview and metadata" },
  { platform: "mac", src: "./images/app-details/08-search.avif", width: 1046, height: 768, kickerZh: "你记得光，MuseFilm 记得它在哪里", kickerEn: "You remember the light. MuseFilm remembers where", zh: "不必记住文件名，只需记得当时。", en: "Forget the filename. Remember the moment.", descZh: "也许你只记得那天下过雨，使用了一卷黑白胶片，或带着某一支镜头。时间、器材、地点与标签交织成线索，把埋在硬盘深处的那束光重新带回眼前。", descEn: "Perhaps you remember only the rain, a black-and-white roll, or the lens you carried. Dates, equipment, places, and tags become clues that bring a long-buried piece of light back into view.", altZh: "MuseFilm Mac 搜索页面", altEn: "MuseFilm Mac search" },
  { platform: "windows", src: "./images/mac/01-dashboard-home.avif", width: 1440, height: 960, kickerZh: "一眼看见，档案正在如何生长", kickerEn: "See how an archive grows", zh: "所有线索，在此汇成一卷。", en: "Every thread gathers into one view.", descZh: "胶卷、照片、胶片类型与最近记录在开阔的首页相遇，复杂的收藏因此拥有清晰的轮廓。每一次打开 MuseFilm，都能迅速回到尚未完成的那段影像叙事。", descEn: "Rolls, photographs, film stocks, and recent activity meet across one spacious dashboard, giving a complex collection a clear shape. Each return takes you straight back to the story still in progress.", altZh: "MuseFilm Windows 仪表盘", altEn: "MuseFilm Windows dashboard" },
  { platform: "windows", src: "./images/mac/02-archive.avif", width: 1440, height: 960, kickerZh: "收藏再多，也始终从容", kickerEn: "A growing collection, still effortless", zh: "让数千张照片，依然井然有序。", en: "Thousands of photographs. Still beautifully ordered.", descZh: "清晰的网格让每一卷保持自己的位置，也让浏览、编辑与导出顺势发生。数量不断增加，界面却不因此喧闹；你看到的始终是胶卷，而不是管理胶卷的负担。", descEn: "A clear grid gives every roll its place and lets browsing, editing, and export follow naturally. The collection may grow, but the interface stays quiet—you see the rolls, never the burden of managing them.", altZh: "MuseFilm Windows 档案网格", altEn: "MuseFilm Windows archive grid" },
  { platform: "windows", src: "./images/mac/03-import.avif", width: 1440, height: 960, kickerZh: "从散落的扫描，到完整的一卷", kickerEn: "From scattered scans to a complete roll", zh: "把照片带进来。其余交给秩序。", en: "Bring in the photographs. Let order follow.", descZh: "选择扫描文件，补全胶卷信息，再确认它们应当归去的地方。导入被收束成几步清楚的动作，让整理不再像一项任务，而像为一段记忆轻轻写下注脚。", descEn: "Choose the scans, complete the roll, and confirm where everything belongs. Import becomes a few clear gestures—not a chore, but the quiet act of adding context to a memory.", altZh: "MuseFilm Windows 导入页面", altEn: "MuseFilm Windows import workflow" },
  { platform: "windows", src: "./images/mac/04-settings.avif", width: 1440, height: 960, kickerZh: "偏好归于一处，创作留在前景", kickerEn: "Preferences in one place. The work in front", zh: "让工具适应你，而不是相反。", en: "Let the tool adapt to you.", descZh: "资料库位置、显示方式与应用行为被安静地归在一起，不必在层层菜单之间寻找。设置完成后，它便退到幕后，让每一次打开都更接近你熟悉的工作方式。", descEn: "Library locations, display choices, and application behavior live together without layers of menus to cross. Once set, they recede into the background so every return feels unmistakably yours.", altZh: "MuseFilm Windows 设置页面", altEn: "MuseFilm Windows settings" },
  { platform: "windows", src: "./images/mac/05-film-library.avif", width: 1440, height: 960, kickerZh: "熟悉的乳剂，熟悉的色彩", kickerEn: "Familiar emulsions. Familiar color", zh: "为下一卷，保留上一卷的经验。", en: "Carry experience into the next roll.", descZh: "常用胶片、感光度、库存与拍摄记录组成一份不断生长的个人参考。过去如何回应光线，下一次便如何作出选择；经验不再散落，而是成为直觉可靠的底色。", descEn: "Favorite stocks, speeds, inventory, and shooting history form a personal reference that keeps growing. What the film did with light before becomes a more confident choice the next time.", altZh: "MuseFilm Windows 胶卷收藏", altEn: "MuseFilm Windows film collection" },
  { platform: "windows", src: "./images/mac/06-film-developing.avif", width: 1440, height: 960, kickerZh: "让暗房经验，可以被再次抵达", kickerEn: "Make darkroom experience repeatable", zh: "配方会褪色，记录不会。", en: "Recipes fade. Records remain.", descZh: "药液、温度、时间与每一个步骤沿着清楚的流程展开，让容易流失的暗房经验拥有准确的形状。下一次显影不是重新猜测，而是在上一次的基础上继续前进。", descEn: "Chemistry, temperature, time, and each step unfold in a deliberate sequence, giving fragile darkroom knowledge a precise form. The next development begins with experience, not guesswork.", altZh: "MuseFilm Windows 冲扫流程", altEn: "MuseFilm Windows developing workflow" },
  { platform: "windows", src: "./images/mac/07-lab-tags.avif", width: 1440, height: 960, kickerZh: "离开暗袋，也不会失去身份", kickerEn: "Identity that travels with every roll", zh: "从寄出，到归来，始终是同一卷。", en: "The same roll, from departure to return.", descZh: "清楚的标签把卷号、实验室与返还扫描连接在一起，让胶卷离开手边时依然拥有可靠的身份。等它再次回来，每一张影像都能准确回到原本的故事。", descEn: "Clear labels connect roll numbers, labs, and returned scans, giving each roll a dependable identity while it is away. When it comes home, every image finds its way back to the right story.", altZh: "MuseFilm Windows 寄扫标签", altEn: "MuseFilm Windows lab labels" },
  { platform: "windows", src: "./images/mac/08-light-table.avif", width: 1440, height: 960, kickerZh: "顺序，让照片彼此说话", kickerEn: "Sequence lets photographs speak to one another", zh: "在大画面里，读懂一整卷。", en: "Read an entire roll on a wider canvas.", descZh: "宽阔的数字观片台保留拍摄顺序，也保留照片之间微妙的呼应。先看见节奏，再判断取舍；一卷胶片不再是一组孤立文件，而是一段有开端与余韵的叙事。", descEn: "A generous digital light table preserves both shooting order and the quiet echoes between frames. See the rhythm before making a selection, and a roll becomes a narrative rather than a folder of isolated files.", altZh: "MuseFilm Windows 底片工作台", altEn: "MuseFilm Windows negative light table" },
  { platform: "windows", src: "./images/mac/09-search.avif", width: 1440, height: 960, kickerZh: "线索越细，抵达越准确", kickerEn: "The finer the clue, the closer the return", zh: "记忆模糊，寻找依然精确。", en: "Memory can be vague. Search stays precise.", descZh: "时间、胶片、器材、地点与标签可以自由组合，把庞大的档案逐渐收束成眼前的几张照片。你不需要知道它被存在哪里，只需要记得一点关于当时的事。", descEn: "Dates, film, equipment, places, and tags combine to narrow a vast archive to the few images before you. You never need to know where a file lives—only something about the moment.", altZh: "MuseFilm Windows 高级搜索", altEn: "MuseFilm Windows advanced search" },
  { platform: "windows", src: "./images/mac/10-preview-random.avif", width: 1440, height: 960, kickerZh: "偶然，也是重逢的一种方式", kickerEn: "Chance is another way to return", zh: "让遗忘，也成为一种发现。", en: "Let forgetting become a form of discovery.", descZh: "随机出现的一张旧照片，会越过时间与分类，把你带回一个未曾计划重访的瞬间。档案不再只是被保存的过去，也成为不断发生的新相遇。", descEn: "An unexpected older frame crosses time and categories to return you to a moment you never planned to revisit. The archive becomes more than preserved history—it becomes a source of new encounters.", altZh: "MuseFilm Windows 随机预览", altEn: "MuseFilm Windows random preview" },
  { platform: "windows", src: "./images/image.avif", width: 1500, height: 900, kickerZh: "所有收藏，都从第一卷开始", kickerEn: "Every collection begins with one roll", zh: "第一卷，是一切的开始。", en: "The first roll begins everything.", descZh: "空白首页没有催促，只留下一个清晰的邀请：从手边的胶卷开始。随着照片进入，日期、器材与地点会逐渐形成属于你的摄影档案，而这一步始终简单。", descEn: "The empty home screen never rushes you; it offers one clear invitation—begin with the roll in your hand. As photographs arrive, dates, equipment, and places gradually become an archive of your own.", altZh: "MuseFilm Windows 首页", altEn: "MuseFilm Windows home" },
  { platform: "windows", src: "./images/image(2).avif", width: 1500, height: 900, kickerZh: "几步之间，散落的照片拥有归处", kickerEn: "A few steps give every scan a place", zh: "让导入，像翻开新的一卷。", en: "Make import feel like opening a new roll.", descZh: "文件选择、胶卷信息与存储确认沿着自然的顺序依次出现，第一次整理也不必学习复杂规则。等最后一步完成，散落的扫描已经成为一段可以继续书写的故事。", descEn: "File selection, roll details, and storage confirmation appear in a natural order, without rules to learn on the first import. By the final step, scattered scans have become a story ready to continue.", altZh: "MuseFilm Windows 导入页面", altEn: "MuseFilm Windows import" },
  { platform: "windows", src: "./images/image(3).avif", width: 1500, height: 900, kickerZh: "复杂偏好，收进安静的一页", kickerEn: "Complex preferences, held in one quiet page", zh: "设定一次，此后只管观看。", en: "Set it once. Then simply look.", descZh: "外观、文件位置与默认行为被整理得清楚而克制，重要选项一眼可见，其余细节保持安静。完成选择之后，设置不再占据注意力，影像重新成为界面的中心。", descEn: "Appearance, file locations, and defaults are arranged with restraint: important choices stay visible while detail remains quiet. Once chosen, settings release your attention and the photographs return to center stage.", altZh: "MuseFilm Windows 设置页面", altEn: "MuseFilm Windows settings" },
];

const SCREEN_INTERFACE_LABELS = {
  "./images/app-details/01-home.avif": { zh: "首页概览", en: "Home overview" },
  "./images/app-details/02-archive.avif": { zh: "胶卷档案", en: "Roll archive" },
  "./images/app-details/03-film-library.avif": { zh: "胶片资料库", en: "Film library" },
  "./images/app-details/04-equipment.avif": { zh: "器材资料库", en: "Equipment library" },
  "./images/app-details/05-developing.avif": { zh: "冲扫计时器", en: "Developing timer" },
  "./images/app-details/06-light-table.avif": { zh: "数字观片台", en: "Light table" },
  "./images/app-details/07-preview.avif": { zh: "照片详情", en: "Photo details" },
  "./images/app-details/08-search.avif": { zh: "搜索界面", en: "Search" },
  "./images/mac/01-dashboard-home.avif": { zh: "Windows 仪表盘", en: "Windows dashboard" },
  "./images/mac/02-archive.avif": { zh: "Windows 胶卷档案", en: "Windows roll archive" },
  "./images/mac/03-import.avif": { zh: "Windows 导入流程", en: "Windows import" },
  "./images/mac/04-settings.avif": { zh: "Windows 设置", en: "Windows settings" },
  "./images/mac/05-film-library.avif": { zh: "Windows 胶片资料库", en: "Windows film library" },
  "./images/mac/06-film-developing.avif": { zh: "Windows 冲扫流程", en: "Windows developing" },
  "./images/mac/07-lab-tags.avif": { zh: "Windows 寄扫标签", en: "Windows lab labels" },
  "./images/mac/08-light-table.avif": { zh: "Windows 底片工作台", en: "Windows light table" },
  "./images/mac/09-search.avif": { zh: "Windows 高级搜索", en: "Windows advanced search" },
  "./images/mac/10-preview-random.avif": { zh: "Windows 随机照片", en: "Windows random photo" },
  "./images/image.avif": { zh: "Windows 新建档案首页", en: "Windows new archive" },
  "./images/image(2).avif": { zh: "Windows 首次导入", en: "Windows first import" },
  "./images/image(3).avif": { zh: "Windows 设置", en: "Windows settings" },
};

const cinematic = document.querySelector("[data-cinematic]");
if (cinematic) {
  const scenes = [...cinematic.querySelectorAll("[data-cinematic-scene]")];
  const deck = cinematic.querySelector("[data-narrative-deck]");
  const frame = cinematic.querySelector("[data-narrative-frame]");
  const image = cinematic.querySelector("[data-narrative-image]");
  const label = cinematic.querySelector("[data-narrative-label]");
  const copyTitles = [...cinematic.querySelectorAll("[data-narrative-copy-title]")];
  const copyDescriptions = [...cinematic.querySelectorAll("[data-narrative-copy-description]")];
  const copyOverlines = [...cinematic.querySelectorAll("[data-narrative-copy-overline]")];
  const copyIndexes = [...cinematic.querySelectorAll("[data-narrative-copy-index]")];
  const meta = cinematic.querySelector("[data-narrative-meta]");
  const sequence = cinematic.querySelector("[data-narrative-sequence]");
  const progressStrip = cinematic.querySelector("[data-narrative-progress]");
  const platformTabs = [...cinematic.querySelectorAll("[data-narrative-platform]")];
  const count = cinematic.querySelector("[data-cinematic-count]");
  let activePlatform = "mac";
  let activeScene = -1;
  let activeShotIndex = -1;
  let cinematicFrame = 0;
  let lastProgress = 0;
  let shotTransitionId = 0;

  const platformShots = () => SCREENSHOTS.filter((shot) => shot.platform === activePlatform);

  function sceneFromProgress(progress) {
    if (progress < 0.16) return 0;
    if (progress < 0.37) return 1;
    if (progress < 0.58) return 2;
    if (progress < 0.79) return 3;
    return 4;
  }

  function shotFromProgress(progress, length) {
    const narrativeProgress = Math.min(1, Math.max(0, (progress - .13) / .87));
    return Math.min(length - 1, Math.floor(narrativeProgress * length));
  }

  function updateProgressStrip(length) {
    if (!progressStrip) return;
    const shots = platformShots();
    if (progressStrip.childElementCount === length) {
      [...progressStrip.children].forEach((marker, index) => {
        const interfaceLabel = SCREEN_INTERFACE_LABELS[shots[index]?.src];
        const name = currentLanguage === "en" ? (interfaceLabel?.en || shots[index]?.en) : (interfaceLabel?.zh || shots[index]?.zh);
        marker.setAttribute("aria-label", `${name} · ${index + 1} / ${length}`);
        marker.title = name;
      });
      return;
    }
    progressStrip.replaceChildren(...Array.from({ length }, (_, index) => {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.dataset.shotIndex = String(index);
      marker.tabIndex = -1;
      const interfaceLabel = SCREEN_INTERFACE_LABELS[shots[index]?.src];
      marker.setAttribute("aria-label", `${currentLanguage === "en" ? (interfaceLabel?.en || shots[index]?.en) : (interfaceLabel?.zh || shots[index]?.zh)} · ${index + 1} / ${length}`);
      marker.title = currentLanguage === "en" ? (interfaceLabel?.en || shots[index]?.en) : (interfaceLabel?.zh || shots[index]?.zh);
      marker.append(document.createElement("i"));
      return marker;
    }));
    progressStrip.setAttribute("aria-valuemax", String(length));
  }

  function showNarrativeShot(index, animate = true, force = false) {
    const shots = platformShots();
    if (!shots.length) return;
    const nextIndex = Math.min(shots.length - 1, Math.max(0, index));
    const shot = shots[nextIndex];
    const changed = nextIndex !== activeShotIndex || image?.dataset.platform !== activePlatform;
    const previousIndex = activeShotIndex;
    activeShotIndex = nextIndex;

    if (image && changed) {
      const direction = previousIndex < 0 || nextIndex >= previousIndex ? 1 : -1;
      const transitionId = ++shotTransitionId;
      frame?.querySelectorAll(".cinematic-transition-image").forEach((item) => item.remove());
      image.getAnimations().forEach((animation) => animation.cancel());
      const outgoingImage = animate && !reducedMotion ? image.cloneNode(false) : null;
      if (outgoingImage && frame) {
        outgoingImage.removeAttribute("data-narrative-image");
        outgoingImage.classList.add("cinematic-transition-image");
        frame.insertBefore(outgoingImage, image.nextSibling);
      }
      image.src = shot.src;
      image.width = shot.width;
      image.height = shot.height;
      image.dataset.platform = activePlatform;
      if (deck) deck.style.aspectRatio = `${shot.width} / ${shot.height}`;
      if (animate && !reducedMotion) {
        cinematic.classList.remove("is-exposing", "is-detenting");
        void cinematic.offsetWidth;
        cinematic.classList.add("is-exposing", "is-detenting");
        outgoingImage?.animate([
          { opacity: 1, transform: "translate3d(0,0,0) scale(1.006)", filter: "brightness(1)" },
          { opacity: .58, transform: `translate3d(${direction * -.18}%,0,0) scale(1.012)`, filter: "brightness(.82)", offset: .58 },
          { opacity: 0, transform: `translate3d(${direction * -.36}%,0,0) scale(1.018)`, filter: "brightness(.68) blur(.08rem)" },
        ], { duration: 980, easing: "cubic-bezier(.22,.72,.25,1)", fill: "forwards" })
          .finished.catch(() => {}).finally(() => outgoingImage.remove());
        image.animate([
          { opacity: .16, transform: `translate3d(${direction * .38}%,0,0) scale(1.02)`, filter: "blur(.16rem) brightness(.72) saturate(.82)" },
          { opacity: .74, transform: `translate3d(${direction * .1}%,0,0) scale(1.006)`, filter: "blur(.025rem) brightness(.96) saturate(.96)", offset: .68 },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", filter: "none" },
        ], { duration: 980, easing: "cubic-bezier(.22,.72,.25,1)" });
        window.setTimeout(() => {
          if (transitionId === shotTransitionId) cinematic.classList.remove("is-exposing", "is-detenting");
        }, 1040);
        playFilmDetent();
      }
      const preload = shots[Math.min(shots.length - 1, nextIndex + 1)];
      if (preload && preload !== shot) {
        const nextImage = new Image();
        nextImage.src = preload.src;
      }
    }

    if (changed || force) {
      const interfaceLabel = SCREEN_INTERFACE_LABELS[shot.src];
      if (image) image.alt = currentLanguage === "en" ? shot.altEn : shot.altZh;
      if (label) label.textContent = currentLanguage === "en" ? (interfaceLabel?.en || shot.en) : (interfaceLabel?.zh || shot.zh);
      copyTitles.forEach((title) => { title.textContent = currentLanguage === "en" ? shot.en : shot.zh; });
      copyDescriptions.forEach((body) => { body.textContent = currentLanguage === "en" ? shot.descEn : shot.descZh; });
      copyOverlines.forEach((overline) => { overline.textContent = currentLanguage === "en" ? shot.kickerEn : shot.kickerZh; });
    }
    const current = String(nextIndex + 1).padStart(2, "0");
    const total = String(shots.length).padStart(2, "0");
    const platformLabel = activePlatform === "mac" ? "MAC" : "WIN";
    if (changed || force) {
      if (meta) meta.textContent = `${platformLabel} / ${current} / ${total}`;
      if (sequence) sequence.textContent = `${current} / ${total}`;
      if (count) count.textContent = `FRAME ${current}`;
      copyIndexes.forEach((item) => { item.textContent = `${activePlatform === "mac" ? "MACOS" : "WINDOWS"} · ${current} / ${total}`; });
      updateProgressStrip(shots.length);
      [...(progressStrip?.children || [])].forEach((marker, markerIndex) => {
        marker.classList.toggle("is-active", markerIndex === nextIndex);
        marker.classList.toggle("is-past", markerIndex < nextIndex);
        marker.setAttribute("aria-current", markerIndex === nextIndex ? "true" : "false");
      });
      const interfaceLabel = SCREEN_INTERFACE_LABELS[shot.src];
      const ariaName = currentLanguage === "en" ? (interfaceLabel?.en || shot.en) : (interfaceLabel?.zh || shot.zh);
      if (progressStrip) {
        progressStrip.setAttribute("aria-label", translate("aria.filmProgress"));
        progressStrip.setAttribute("aria-valuenow", String(nextIndex + 1));
        progressStrip.setAttribute("aria-valuetext", `${ariaName}, ${nextIndex + 1} / ${shots.length}`);
      }
    }
  }

  function setCinematicScene(scene) {
    if (scene === activeScene) return;
    activeScene = scene;
    cinematic.dataset.scene = String(scene);
    scenes.forEach((item, index) => {
      const active = index === scene;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-hidden", String(!active));
    });
  }

  function updateCinematic() {
    cinematicFrame = 0;
    const bounds = cinematic.getBoundingClientRect();
    const travel = Math.max(1, bounds.height - window.innerHeight);
    const progress = Math.min(1, Math.max(0, -bounds.top / travel));
    const scene = sceneFromProgress(progress);
    const narrativeVisible = progress >= .18;
    lastProgress = progress;
    cinematic.style.setProperty("--cinematic-progress", progress.toFixed(4));
    cinematic.style.setProperty("--cinematic-scale", (.85 + progress * .25).toFixed(4));
    cinematic.style.setProperty("--cinematic-haze", (.28 + progress * .18).toFixed(4));
    cinematic.dataset.progress = progress.toFixed(4);
    cinematic.classList.toggle("is-narrative-visible", narrativeVisible);
    if (deck) {
      deck.inert = !narrativeVisible;
      deck.setAttribute("aria-hidden", String(!narrativeVisible));
    }
    if (filmModel) {
      filmModel.dataset.cinematicProgress = progress.toFixed(4);
      filmModel.dispatchEvent(new CustomEvent("cinematic-progress", { detail: { progress, scene } }));
    }
    setCinematicScene(scene);
    showNarrativeShot(shotFromProgress(progress, platformShots().length));
  }

  function queueCinematicUpdate() {
    if (!cinematicFrame) cinematicFrame = requestAnimationFrame(updateCinematic);
  }

  function scrollToShot(index, instant = false) {
    const shots = platformShots();
    const safeIndex = Math.min(shots.length - 1, Math.max(0, index));
    const shotProgress = .13 + ((safeIndex + .5) / shots.length) * .87;
    const sectionTop = window.scrollY + cinematic.getBoundingClientRect().top;
    const travel = Math.max(1, cinematic.offsetHeight - window.innerHeight);
    window.scrollTo({ top: sectionTop + travel * shotProgress, behavior: reducedMotion || instant ? "auto" : "smooth" });
  }

  function shotAtPointer(event) {
    if (!progressStrip) return activeShotIndex;
    const bounds = progressStrip.getBoundingClientRect();
    const ratio = Math.min(.9999, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    return Math.floor(ratio * platformShots().length);
  }

  function seekFromPointer(event, instant = false) {
    scrollToShot(shotAtPointer(event), instant);
  }

  function selectPlatform(platform) {
    activePlatform = platform === "windows" ? "windows" : "mac";
    cinematic.dataset.platform = activePlatform;
    activeShotIndex = -1;
    platformTabs.forEach((tab) => {
      const selected = tab.dataset.narrativePlatform === activePlatform;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    showNarrativeShot(shotFromProgress(lastProgress, platformShots().length), false);
  }

  platformTabs.forEach((tab) => tab.addEventListener("click", () => selectPlatform(tab.dataset.narrativePlatform)));
  let draggingFilmStrip = false;
  progressStrip?.addEventListener("click", (event) => seekFromPointer(event));
  progressStrip?.addEventListener("pointerdown", (event) => {
    draggingFilmStrip = true;
    progressStrip.setPointerCapture?.(event.pointerId);
    seekFromPointer(event, true);
  });
  progressStrip?.addEventListener("pointermove", (event) => {
    if (!draggingFilmStrip) return;
    seekFromPointer(event, true);
  });
  const stopFilmDrag = () => { draggingFilmStrip = false; };
  progressStrip?.addEventListener("pointerup", stopFilmDrag);
  progressStrip?.addEventListener("pointercancel", stopFilmDrag);
  progressStrip?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") scrollToShot(0);
    else if (event.key === "End") scrollToShot(platformShots().length - 1);
    else scrollToShot(activeShotIndex + (event.key === "ArrowLeft" ? -1 : 1));
  });
  deck?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    scrollToShot(activeShotIndex + (event.key === "ArrowLeft" ? -1 : 1));
  });

  refreshScreenDeckLanguage = () => showNarrativeShot(activeShotIndex, false, true);
  window.addEventListener("scroll", queueCinematicUpdate, { passive: true });
  window.addEventListener("resize", queueCinematicUpdate, { passive: true });
  selectPlatform("mac");
  updateCinematic();
}

const cinematicHoverSurface = cinematic?.querySelector(".cinematic-sticky");
let cinematicHoverFrame = 0;
let cinematicPointerX = 72;
let cinematicPointerY = 44;
function renderCinematicPointer() {
  cinematicHoverFrame = 0;
  cinematic?.style.setProperty("--pointer-x", `${cinematicPointerX.toFixed(2)}%`);
  cinematic?.style.setProperty("--pointer-y", `${cinematicPointerY.toFixed(2)}%`);
}
if (cinematicHoverSurface && !reducedMotion) {
  cinematicHoverSurface.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const bounds = cinematicHoverSurface.getBoundingClientRect();
    cinematicPointerX = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100));
    cinematicPointerY = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100));
    cinematic.classList.add("is-pointer-active");
    if (!cinematicHoverFrame) cinematicHoverFrame = requestAnimationFrame(renderCinematicPointer);
  }, { passive: true });
  cinematicHoverSurface.addEventListener("pointerleave", () => cinematic.classList.remove("is-pointer-active"), { passive: true });
}

document.querySelectorAll("[data-magnetic]").forEach((element) => {
  if (reducedMotion) return;
  element.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const bounds = element.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * 8;
    const y = ((event.clientY - bounds.top) / Math.max(1, bounds.height) - .5) * 6;
    element.style.setProperty("--magnetic-x", `${x.toFixed(2)}px`);
    element.style.setProperty("--magnetic-y", `${y.toFixed(2)}px`);
  }, { passive: true });
  element.addEventListener("pointerleave", () => {
    element.style.setProperty("--magnetic-x", "0px");
    element.style.setProperty("--magnetic-y", "0px");
  }, { passive: true });
});

function closeMenu() {
  menuButton?.setAttribute("aria-expanded", "false");
  menu?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
}

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  menu?.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
});

menu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

window.addEventListener("scroll", () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 20);
}, { passive: true });

const revealItems = [...document.querySelectorAll("[data-reveal]")];
if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6%" });
  revealItems.forEach((item) => revealObserver.observe(item));
}

const filmGallery = document.querySelector("[data-film-gallery]");
const GALLERY_FRAMES = [
  {
    titleZh: "建筑与冬日侧光",
    titleEn: "Architecture in winter light",
    descriptionZh: "侧光掠过建筑立面，柱廊与树影把画面分成安静的层次。",
    descriptionEn: "Side light crosses the facade, while columns and tree shadows divide the frame into quiet layers.",
    tagsZh: "建筑 · 冬日 · 侧光",
    tagsEn: "Architecture · Winter · Side light",
  },
  {
    titleZh: "红门与树影",
    titleEn: "A red door and tree shadows",
    descriptionZh: "红色入口成为画面的重心，冬日枝影在砖墙上留下时间的纹理。",
    descriptionEn: "The red entrance holds the composition as winter branches leave a trace of time across the brick wall.",
    tagsZh: "红门 · 建筑 · 树影",
    tagsEn: "Red door · Architecture · Shadows",
  },
  {
    titleZh: "湖岸独树",
    titleEn: "A solitary tree by the lake",
    descriptionZh: "树、湖岸与低空并置，让这一卷的最后一格以更开阔的呼吸结束。",
    descriptionEn: "Tree, shoreline, and low sky share the frame, letting the final image on the roll end with a wider breath.",
    tagsZh: "湖岸 · 独树 · 冬日",
    tagsEn: "Lakeside · Solitary tree · Winter",
  },
];
const galleryFrameButtons = [...document.querySelectorAll("[data-gallery-frame]")];
const galleryInspector = document.querySelector("[data-gallery-inspector]");
const galleryIndex = galleryInspector?.querySelector("[data-gallery-index]");
const galleryTitle = galleryInspector?.querySelector("[data-gallery-title]");
const galleryDescription = galleryInspector?.querySelector("[data-gallery-description]");
const galleryTags = galleryInspector?.querySelector("[data-gallery-tags]");
const galleryLightbox = document.querySelector("[data-gallery-lightbox]");
const galleryLightboxFrame = galleryLightbox?.querySelector("[data-gallery-lightbox-frame]");
const galleryLightboxIndex = galleryLightbox?.querySelector("[data-gallery-lightbox-index]");
const galleryLightboxTitle = galleryLightbox?.querySelector("[data-gallery-lightbox-title]");
const galleryLightboxDescription = galleryLightbox?.querySelector("[data-gallery-lightbox-description]");
let activeGalleryFrame = 0;

function renderGalleryFrame(index, animate = true) {
  activeGalleryFrame = (index + GALLERY_FRAMES.length) % GALLERY_FRAMES.length;
  const frame = GALLERY_FRAMES[activeGalleryFrame];
  const isEnglish = currentLanguage === "en";
  const count = String(activeGalleryFrame + 1).padStart(2, "0");
  const title = isEnglish ? frame.titleEn : frame.titleZh;
  const description = isEnglish ? frame.descriptionEn : frame.descriptionZh;
  const tags = isEnglish ? frame.tagsEn : frame.tagsZh;
  const indexLabel = `FRAME ${count} / 03`;

  galleryFrameButtons.forEach((button, buttonIndex) => {
    const selected = buttonIndex === activeGalleryFrame;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `${indexLabel} · ${title}`);
  });
  if (galleryIndex) galleryIndex.textContent = indexLabel;
  if (galleryTitle) galleryTitle.textContent = title;
  if (galleryDescription) galleryDescription.textContent = description;
  if (galleryTags) galleryTags.textContent = tags;
  if (galleryInspector && animate && !reducedMotion) {
    galleryInspector.classList.remove("is-changing");
    requestAnimationFrame(() => galleryInspector.classList.add("is-changing"));
  }
  if (galleryLightboxFrame) {
    galleryLightboxFrame.style.setProperty("--gallery-frame-offset", `${activeGalleryFrame * -33.3333}%`);
    galleryLightboxFrame.setAttribute("aria-label", title);
  }
  if (galleryLightboxIndex) galleryLightboxIndex.textContent = `${indexLabel} · ROLL 01`;
  if (galleryLightboxTitle) galleryLightboxTitle.textContent = title;
  if (galleryLightboxDescription) galleryLightboxDescription.textContent = description;
}

galleryFrameButtons.forEach((button) => {
  button.addEventListener("click", () => renderGalleryFrame(Number(button.dataset.galleryFrame)));
});
galleryInspector?.querySelector("[data-gallery-prev]")?.addEventListener("click", () => renderGalleryFrame(activeGalleryFrame - 1));
galleryInspector?.querySelector("[data-gallery-next]")?.addEventListener("click", () => renderGalleryFrame(activeGalleryFrame + 1));
galleryInspector?.querySelector("[data-gallery-zoom]")?.addEventListener("click", () => {
  renderGalleryFrame(activeGalleryFrame, false);
  if (typeof galleryLightbox?.showModal === "function") galleryLightbox.showModal();
  else galleryLightbox?.setAttribute("open", "");
});
galleryLightbox?.querySelector("[data-gallery-close]")?.addEventListener("click", () => galleryLightbox.close?.());
galleryLightbox?.addEventListener("click", (event) => {
  if (event.target === galleryLightbox) galleryLightbox.close?.();
});
refreshGalleryLanguage = () => renderGalleryFrame(activeGalleryFrame, false);
renderGalleryFrame(0, false);

let galleryMotionFrame = 0;
function updateGalleryMotion() {
  galleryMotionFrame = 0;
  if (!filmGallery) return;
  if (reducedMotion) {
    filmGallery.classList.add("is-in-view");
    filmGallery.style.setProperty("--gallery-pan", "0%");
    filmGallery.style.setProperty("--gallery-lift", "0rem");
    filmGallery.style.setProperty("--gallery-scale", "1");
    filmGallery.style.setProperty("--gallery-clip", "0%");
    filmGallery.style.setProperty("--gallery-light", "120%");
    return;
  }
  const bounds = filmGallery.getBoundingClientRect();
  const raw = Math.min(1, Math.max(0, (window.innerHeight - bounds.top) / Math.max(1, window.innerHeight + bounds.height)));
  const progress = raw * raw * (3 - 2 * raw);
  filmGallery.classList.toggle("is-in-view", raw > .04 && raw < .99);
  filmGallery.style.setProperty("--gallery-pan", `${(-1 + progress * 2).toFixed(3)}%`);
  filmGallery.style.setProperty("--gallery-lift", `${((1 - progress) * 1.5).toFixed(3)}rem`);
  filmGallery.style.setProperty("--gallery-scale", (1.065 - progress * .065).toFixed(4));
  filmGallery.style.setProperty("--gallery-clip", `${Math.max(0, 16 - progress * 28).toFixed(3)}%`);
  filmGallery.style.setProperty("--gallery-light", `${(-42 + progress * 168).toFixed(2)}%`);
}
function queueGalleryMotion() {
  if (!galleryMotionFrame) galleryMotionFrame = requestAnimationFrame(updateGalleryMotion);
}
if (filmGallery) {
  filmGallery.addEventListener("pointermove", (event) => {
    if (reducedMotion || event.pointerType === "touch") return;
    const bounds = filmGallery.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / Math.max(1, bounds.width) - .5;
    const y = (event.clientY - bounds.top) / Math.max(1, bounds.height) - .5;
    filmGallery.style.setProperty("--gallery-tilt-x", `${(x * .9).toFixed(3)}deg`);
    filmGallery.style.setProperty("--gallery-tilt-y", `${(-y * .55).toFixed(3)}deg`);
  }, { passive: true });
  filmGallery.addEventListener("pointerleave", () => {
    filmGallery.style.setProperty("--gallery-tilt-x", "0deg");
    filmGallery.style.setProperty("--gallery-tilt-y", "0deg");
  }, { passive: true });
  window.addEventListener("scroll", queueGalleryMotion, { passive: true });
  window.addEventListener("resize", queueGalleryMotion, { passive: true });
  updateGalleryMotion();
}

const lightTable = document.querySelector("[data-light-table]");
const lightTableBoard = lightTable?.querySelector("[data-light-table-board]");
const lightTableStage = lightTable?.querySelector("[data-light-table-stage]");
const lightTableLoupe = lightTable?.querySelector("[data-light-table-loupe]");
const lightTableLoupeStage = lightTable?.querySelector("[data-light-table-loupe-stage]");
const lightTableInput = lightTable?.querySelector("[data-light-table-input]");
const lightTableInspector = lightTable?.querySelector("[data-light-table-inspector]");
const LIGHT_TABLE_EXAMPLES = [
  {
    id: "example-kodak-5222-potala",
    nameZh: "Kodak 5222 · 布达拉宫",
    nameEn: "Kodak 5222 · Potala Palace",
    descriptionZh: "高反差的黑白颗粒勾勒云层、树枝与拉萨山脊，让布达拉宫一带的光线留下更坚实的年代感。",
    descriptionEn: "High-contrast black-and-white grain traces clouds, branches, and the Lhasa ridgeline, giving the light around Potala Palace a firmer sense of time.",
    src: "./images/light-table-kodak-5222-potala.jpg",
    crop: "50% 50%",
    x: 24,
    y: 48,
    rotation: -3.2,
  },
  {
    id: "example-kodak-5294-karola",
    nameZh: "Kodak 5294 · 卡若拉冰川",
    nameEn: "Kodak 5294 · Karola Glacier",
    descriptionZh: "湛蓝高空、雪线与幽暗山谷被压进同一格底片，卡若拉冰川在冷色层次中显出辽阔而克制的力量。",
    descriptionEn: "Deep blue sky, snow line, and shadowed valley settle into one frame, revealing the Karola Glacier through restrained, cool-toned layers.",
    src: "./images/light-table-kodak-5294-karola.jpg",
    crop: "50% 50%",
    x: 50,
    y: 44,
    rotation: 1.8,
  },
  {
    id: "example-kodak-5207-memory",
    nameZh: "Kodak 5207 · 东郊记忆",
    nameEn: "Kodak 5207 · Eastern Suburb Memory",
    descriptionZh: "烟囱与钢梁从暗部向天空生长，工业遗迹的冷灰结构里，保留着东郊记忆尚未散去的温度。",
    descriptionEn: "Chimneys and steel beams rise from the shadows, keeping a trace of warmth inside the cool geometry of Eastern Suburb Memory's industrial remains.",
    src: "./images/light-table-kodak-5207-memory.jpg",
    crop: "50% 50%",
    x: 76,
    y: 51,
    rotation: -1.4,
  },
];
let lightTableItems = [];
let activeLightTableId = null;
let lightTableSequence = 0;
let lightTableDragDepth = 0;
let lightTableInteractive = false;
let lightTableScrollFrame = 0;

function exampleLightTableItems() {
  return LIGHT_TABLE_EXAMPLES.map((item) => ({ ...item, scale: 1, example: true, width: 0, height: 0, size: 0 }));
}

function selectedLightTableItem() {
  return lightTableItems.find((item) => item.id === activeLightTableId) || lightTableItems[0] || null;
}

function lightTableItemName(item) {
  if (!item) return translate("lightTable.empty");
  if (!item.example) return item.name;
  return currentLanguage === "en" ? item.nameEn : item.nameZh;
}

function lightTableItemDescription(item) {
  if (!item) return "";
  if (!item.example) return translate("lightTable.localDescription");
  return currentLanguage === "en" ? item.descriptionEn : item.descriptionZh;
}

function applyLightTableImage(element, item) {
  element.style.backgroundImage = `url("${item.src}")`;
  element.style.backgroundPosition = item.crop || "50% 50%";
  element.style.backgroundSize = item.sprite ? "300% auto" : "cover";
}

function positionLightTableCard(card, item) {
  card.style.left = `${item.x}%`;
  card.style.top = `${item.y}%`;
  card.style.setProperty("--frame-scale", String(item.scale));
  card.style.setProperty("--frame-rotation", `${item.rotation}deg`);
}

function updateLightTableScrollMotion() {
  lightTableScrollFrame = 0;
  if (!lightTable || !lightTableBoard) return;
  const cards = [...lightTableStage.querySelectorAll("[data-light-table-card]")];
  const loupeCards = [...(lightTableLoupeStage?.querySelectorAll("[data-light-table-loupe-card]") || [])];
  const resetCardMotion = () => {
    [...cards, ...loupeCards].forEach((card) => {
      card.style.setProperty("--scroll-x", "0px");
      card.style.setProperty("--scroll-y", "0px");
      card.style.setProperty("--scroll-rotation", "0deg");
      card.style.setProperty("--scroll-scale", "0");
    });
  };
  if (lightTableInteractive) {
    resetCardMotion();
    return;
  }
  const bounds = lightTable.getBoundingClientRect();
  const boardBounds = lightTableBoard.getBoundingClientRect();
  const raw = Math.min(1, Math.max(0, (window.innerHeight - bounds.top) / Math.max(1, window.innerHeight + bounds.height * .65)));
  const progress = reducedMotion ? .52 : raw * raw * (3 - 2 * raw);
  const loupeX = 14 + progress * 72;
  const loupeY = 32 + Math.sin(progress * Math.PI) * 23;
  lightTable.style.setProperty("--loupe-x", `${loupeX.toFixed(2)}%`);
  lightTable.style.setProperty("--loupe-y", `${loupeY.toFixed(2)}%`);
  lightTable.style.setProperty("--loupe-turn", `${(-9 + progress * 18).toFixed(2)}deg`);
  cards.forEach((card, index) => {
    const item = lightTableItems[index];
    if (!item) return;
    const collapse = 1 - progress;
    const shiftX = ((50 - item.x) / 100) * boardBounds.width * collapse * .72;
    const shiftY = ((index % 2 ? 1 : -1) * 2.1 + Math.sin(progress * Math.PI + index) * 1.2) * collapse * 16;
    const rotation = (index - ((cards.length - 1) / 2)) * collapse * 8;
    [card, loupeCards[index]].filter(Boolean).forEach((target) => {
      target.style.setProperty("--scroll-x", `${shiftX.toFixed(2)}px`);
      target.style.setProperty("--scroll-y", `${shiftY.toFixed(2)}px`);
      target.style.setProperty("--scroll-rotation", `${rotation.toFixed(2)}deg`);
      target.style.setProperty("--scroll-scale", `${((1 - collapse) * .025).toFixed(3)}`);
    });
  });
  const loupeGlass = lightTableLoupe?.querySelector(".light-table-loupe-glass");
  if (lightTableLoupeStage && loupeGlass) {
    const magnification = 2;
    const sourceX = boardBounds.width * loupeX / 100;
    const sourceY = boardBounds.height * loupeY / 100;
    lightTableLoupeStage.style.width = `${boardBounds.width}px`;
    lightTableLoupeStage.style.height = `${boardBounds.height}px`;
    lightTableLoupeStage.style.transform = `translate3d(${(loupeGlass.clientWidth / 2 - sourceX * magnification).toFixed(2)}px, ${(loupeGlass.clientHeight / 2 - sourceY * magnification).toFixed(2)}px, 0) scale(${magnification})`;
  }
}

function queueLightTableScrollMotion() {
  if (!lightTableScrollFrame) lightTableScrollFrame = requestAnimationFrame(updateLightTableScrollMotion);
}

function setLightTableInteractive(interactive) {
  lightTableInteractive = Boolean(interactive);
  lightTable?.classList.toggle("is-interactive", lightTableInteractive);
  renderLightTable();
  updateLightTableScrollMotion();
  if (lightTableInteractive) lightTableBoard?.focus({ preventScroll: true });
}

function renderLightTableInspector() {
  const item = selectedLightTableItem();
  const preview = lightTableInspector?.querySelector("[data-light-table-preview]");
  const index = lightTableInspector?.querySelector("[data-light-table-index]");
  const name = lightTableInspector?.querySelector("[data-light-table-name]");
  const description = lightTableInspector?.querySelector("[data-light-table-description]");
  const source = lightTableInspector?.querySelector("[data-light-table-source]");
  const dimensions = lightTableInspector?.querySelector("[data-light-table-dimensions]");
  const size = lightTableInspector?.querySelector("[data-light-table-size]");
  const zoom = lightTableInspector?.querySelector("[data-light-table-zoom]");
  const remove = lightTableInspector?.querySelector("[data-light-table-remove]");
  const itemIndex = item ? lightTableItems.indexOf(item) : -1;
  const frameLabel = item ? `FRAME ${String(itemIndex + 1).padStart(2, "0")} / ${String(lightTableItems.length).padStart(2, "0")}` : "FRAME —";

  if (preview) {
    preview.style.backgroundImage = item ? `url("${item.src}")` : "none";
    preview.style.backgroundPosition = item?.crop || "50% 50%";
    preview.style.backgroundSize = item?.sprite ? "300% auto" : "cover";
    preview.classList.toggle("is-empty", !item);
  }
  if (index) index.textContent = frameLabel;
  if (name) name.textContent = lightTableItemName(item);
  if (description) description.textContent = lightTableItemDescription(item);
  if (source) source.textContent = item ? translate(item.example ? "lightTable.exampleSource" : "lightTable.localSource") : "—";
  if (dimensions) dimensions.textContent = item?.width && item?.height ? `${item.width} × ${item.height}` : item?.example ? "35 MM" : "—";
  if (size) size.textContent = item ? (item.example ? translate("lightTable.exampleSize") : formatBytes(item.size)) : "—";
  if (zoom) zoom.textContent = String(Math.round((item?.scale || 1) * 100));
  if (remove) remove.disabled = !item;
  lightTable?.querySelector("[data-light-table-frame-status]")?.replaceChildren(document.createTextNode(frameLabel));
}

function updateLightTableSelection() {
  lightTableStage?.querySelectorAll("[data-light-table-card]").forEach((card) => {
    const selected = card.dataset.lightTableCard === activeLightTableId;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", String(selected));
    card.style.zIndex = selected ? "20" : String(Number(card.dataset.order || 0) + 1);
  });
  renderLightTableInspector();
}

function selectLightTableItem(id) {
  activeLightTableId = id;
  updateLightTableSelection();
}

function scaleLightTableItem(amount) {
  const item = selectedLightTableItem();
  if (!item) return;
  item.scale = Math.min(2.2, Math.max(.55, item.scale + amount));
  const card = lightTableStage?.querySelector(`[data-light-table-card="${CSS.escape(item.id)}"]`);
  if (card) positionLightTableCard(card, item);
  renderLightTableInspector();
}

function removeLightTableItem(id = activeLightTableId) {
  const index = lightTableItems.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = lightTableItems.splice(index, 1);
  if (!removed.example) URL.revokeObjectURL(removed.src);
  activeLightTableId = lightTableItems[Math.min(index, lightTableItems.length - 1)]?.id || null;
  renderLightTable();
}

function bindLightTableCard(card, item) {
  card.addEventListener("pointerdown", (event) => {
    if (!lightTableInteractive) return;
    if (event.button !== 0) return;
    event.preventDefault();
    selectLightTableItem(item.id);
    card.setPointerCapture?.(event.pointerId);
    card.classList.add("is-dragging");
    const bounds = lightTableBoard.getBoundingClientRect();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startX = item.x;
    const startY = item.y;
    const move = (moveEvent) => {
      item.x = Math.min(94, Math.max(6, startX + ((moveEvent.clientX - startClientX) / Math.max(1, bounds.width)) * 100));
      item.y = Math.min(88, Math.max(12, startY + ((moveEvent.clientY - startClientY) / Math.max(1, bounds.height)) * 100));
      positionLightTableCard(card, item);
    };
    const stop = () => {
      card.classList.remove("is-dragging");
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", stop);
      card.removeEventListener("pointercancel", stop);
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", stop);
    card.addEventListener("pointercancel", stop);
  });
  card.addEventListener("dblclick", () => {
    if (!lightTableInteractive) return;
    item.scale = 1;
    item.rotation = 0;
    positionLightTableCard(card, item);
    renderLightTableInspector();
  });
  card.addEventListener("keydown", (event) => {
    if (!lightTableInteractive) return;
    const step = event.shiftKey ? 3 : .8;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace", "+", "=", "-"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") item.x = Math.max(5, item.x - step);
    else if (event.key === "ArrowRight") item.x = Math.min(95, item.x + step);
    else if (event.key === "ArrowUp") item.y = Math.max(10, item.y - step);
    else if (event.key === "ArrowDown") item.y = Math.min(90, item.y + step);
    else if (event.key === "Delete" || event.key === "Backspace") return removeLightTableItem(item.id);
    else if (event.key === "+" || event.key === "=") return scaleLightTableItem(.08);
    else if (event.key === "-") return scaleLightTableItem(-.08);
    positionLightTableCard(card, item);
  });
}

function renderLightTableLoupe() {
  if (!lightTableLoupeStage) return;
  lightTableLoupeStage.replaceChildren();
  lightTableItems.forEach((item, itemIndex) => {
    const card = document.createElement("div");
    card.className = "light-table-loupe-card";
    card.dataset.lightTableLoupeCard = item.id;
    card.dataset.order = String(itemIndex);
    card.style.zIndex = String(itemIndex + 1);
    const image = document.createElement("div");
    image.className = "light-table-card-image";
    applyLightTableImage(image, item);
    card.append(image);
    positionLightTableCard(card, item);
    lightTableLoupeStage.append(card);
  });
}

function renderLightTable() {
  if (!lightTableStage) return;
  lightTableStage.replaceChildren();
  lightTableItems.forEach((item, itemIndex) => {
    const card = document.createElement("article");
    card.className = "light-table-card";
    card.dataset.lightTableCard = item.id;
    card.dataset.order = String(itemIndex);
    card.setAttribute("role", "option");
    card.setAttribute("tabindex", lightTableInteractive ? "0" : "-1");
    card.setAttribute("aria-label", lightTableItemName(item));
    const image = document.createElement("div");
    image.className = "light-table-card-image";
    applyLightTableImage(image, item);
    const label = document.createElement("span");
    label.textContent = String(itemIndex + 1).padStart(2, "0");
    card.append(image, label);
    positionLightTableCard(card, item);
    bindLightTableCard(card, item);
    lightTableStage.append(card);
  });
  renderLightTableLoupe();
  lightTable?.querySelector("[data-light-table-count]")?.replaceChildren(document.createTextNode(String(lightTableItems.length)));
  lightTable?.classList.toggle("is-empty", lightTableItems.length === 0);
  if (!selectedLightTableItem()) activeLightTableId = lightTableItems[0]?.id || null;
  updateLightTableSelection();
  updateLightTableScrollMotion();
}

function readLocalImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = src;
  });
}

async function importLightTableFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, 24 - lightTableItems.length));
  if (!files.length) return;
  const imported = await Promise.all(files.map(async (file, fileIndex) => {
    const src = URL.createObjectURL(file);
    const dimensions = await readLocalImage(src);
    lightTableSequence = lightTableSequence + 1;
    const angle = ((lightTableSequence % 5) - 2) * 1.4;
    return {
      id: `local-${Date.now()}-${lightTableSequence}`,
      name: file.name,
      src,
      crop: "50% 50%",
      x: 42 + ((fileIndex % 4) * 6),
      y: 40 + ((fileIndex % 3) * 7),
      rotation: angle,
      scale: .92,
      example: false,
      size: file.size,
      ...dimensions,
    };
  }));
  lightTableItems.push(...imported);
  activeLightTableId = imported.at(-1)?.id || activeLightTableId;
  renderLightTable();
}

function resetLightTableExamples() {
  lightTableItems.filter((item) => !item.example).forEach((item) => URL.revokeObjectURL(item.src));
  lightTableItems = exampleLightTableItems();
  activeLightTableId = lightTableItems[0].id;
  renderLightTable();
}

if (lightTable) {
  lightTable.querySelector("[data-light-table-enter]")?.addEventListener("click", () => setLightTableInteractive(true));
  lightTable.querySelector("[data-light-table-exit]")?.addEventListener("click", () => setLightTableInteractive(false));
  lightTable.querySelector("[data-light-table-upload]")?.addEventListener("click", () => lightTableInput?.click());
  lightTable.querySelector("[data-light-table-reset]")?.addEventListener("click", resetLightTableExamples);
  lightTable.querySelector("[data-light-table-remove]")?.addEventListener("click", () => removeLightTableItem());
  lightTable.querySelector("[data-light-table-zoom-in]")?.addEventListener("click", () => scaleLightTableItem(.1));
  lightTable.querySelector("[data-light-table-zoom-out]")?.addEventListener("click", () => scaleLightTableItem(-.1));
  lightTableInput?.addEventListener("change", async () => {
    await importLightTableFiles(lightTableInput.files || []);
    lightTableInput.value = "";
  });
  lightTableBoard?.addEventListener("dragenter", (event) => {
    if (!lightTableInteractive) return;
    event.preventDefault();
    lightTableDragDepth = lightTableDragDepth + 1;
    lightTable.classList.add("is-drag-over");
  });
  lightTableBoard?.addEventListener("dragover", (event) => {
    if (!lightTableInteractive) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  lightTableBoard?.addEventListener("dragleave", () => {
    if (!lightTableInteractive) return;
    lightTableDragDepth = Math.max(0, lightTableDragDepth - 1);
    if (!lightTableDragDepth) lightTable.classList.remove("is-drag-over");
  });
  lightTableBoard?.addEventListener("drop", async (event) => {
    if (!lightTableInteractive) return;
    event.preventDefault();
    lightTableDragDepth = 0;
    lightTable.classList.remove("is-drag-over");
    await importLightTableFiles(event.dataTransfer?.files || []);
  });
  window.addEventListener("beforeunload", () => {
    lightTableItems.filter((item) => !item.example).forEach((item) => URL.revokeObjectURL(item.src));
  });
  refreshGalleryLanguage = renderLightTable;
  resetLightTableExamples();
  window.addEventListener("scroll", queueLightTableScrollMotion, { passive: true });
  window.addEventListener("resize", queueLightTableScrollMotion, { passive: true });
}

const downloadSection = document.querySelector("[data-film-finale]")?.closest(".download-section");
let finaleFrame = 0;
function updateFilmFinale() {
  finaleFrame = 0;
  if (!downloadSection || !filmFinale) return;
  const bounds = downloadSection.getBoundingClientRect();
  const amount = Math.min(1, Math.max(0, (window.innerHeight - bounds.top) / Math.max(1, window.innerHeight * .85)));
  const progress = .72 + amount * .28;
  filmFinale.dataset.cinematicProgress = progress.toFixed(4);
  filmFinale.dispatchEvent(new CustomEvent("cinematic-progress", { detail: { progress, finale: true } }));
  downloadSection.classList.toggle("is-film-finishing", amount > .02);
  downloadSection.classList.toggle("is-film-finished", amount > .94);
}
function queueFilmFinale() {
  if (!finaleFrame) finaleFrame = requestAnimationFrame(updateFilmFinale);
}
if (downloadSection) {
  window.addEventListener("scroll", queueFilmFinale, { passive: true });
  window.addEventListener("resize", queueFilmFinale, { passive: true });
  updateFilmFinale();
}

const RELEASE_API = "https://api.github.com/repos/Quartzsyr/MuseFilm/releases?per_page=100";
const RELEASES_URL = "https://github.com/Quartzsyr/MuseFilm/releases";
const FALLBACK_COUNTS = { windows: 67, mac: 12 };
let lastCounts = FALLBACK_COUNTS;
let lastCountsSynced = false;
let downloadOpened = false;
let lastReleaseData = null;

function detectDownloadPlatform() {
  const userAgent = String(navigator.userAgent || "").toLowerCase();
  const platform = String(navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const isTouchMac = platform.includes("mac") && Number(navigator.maxTouchPoints || 0) > 1;
  if (/iphone|ipad|ipod|android/.test(userAgent) || isTouchMac) return "releases";
  if (platform.includes("mac") || userAgent.includes("mac os")) return "mac";
  if (platform.includes("win") || userAgent.includes("windows")) return "windows";
  return "releases";
}

const detectedDownloadPlatform = detectDownloadPlatform();

refreshPlatformDownload = () => {
  const link = document.querySelector("[data-platform-download]");
  if (!link) return;
  const label = link.querySelector("[data-platform-download-label]");
  const icon = link.querySelector("[data-platform-download-icon]");
  if (detectedDownloadPlatform === "releases") {
    link.dataset.platform = "releases";
    link.href = RELEASES_URL;
    link.classList.add("is-release-only");
    if (label) label.textContent = translate("hero.downloadReleases");
    if (icon) icon.textContent = "↗";
    return;
  }

  const platform = detectedDownloadPlatform;
  const info = lastReleaseData?.platforms?.[platform];
  const fallback = document.querySelector(`.download-trigger[data-platform="${platform}"]:not([data-platform-download])`);
  const assetUrl = info?.asset?.browser_download_url;
  const releaseUrl = info?.release?.html_url;
  link.dataset.platform = platform;
  link.href = assetUrl || releaseUrl || fallback?.href || RELEASES_URL;
  link.classList.toggle("is-release-only", Boolean(info && !assetUrl));
  if (label) label.textContent = translate(platform === "mac" ? "hero.downloadMac" : "hero.downloadWindows");
  if (icon) icon.textContent = assetUrl || (!info && fallback?.href?.includes("/download/")) ? "↓" : "↗";
};

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / (1024 ** exponent);
  return `${amount >= 100 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function formatReleaseDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(currentLanguage === "en" ? "en-US" : "zh-CN", {
    year: "numeric", month: currentLanguage === "en" ? "short" : "numeric", day: "numeric",
  }).format(new Date(value));
}

function cleanReleaseTitle(release) {
  return release?.name?.trim() || release?.tag_name?.trim() || "MuseFilm";
}

function releaseTimestamp(release) {
  const value = release?.published_at || release?.created_at || release?.updated_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortReleasesByDate(releases) {
  return [...releases].sort((left, right) => releaseTimestamp(right) - releaseTimestamp(left));
}

function releaseTagContainsMac(release) {
  return String(release?.tag_name || "").toLowerCase().includes("mac");
}

function assetPlatform(asset, release) {
  const name = String(asset?.name || "").toLowerCase();
  if (/\.(exe|msi|msix)(?:$|\?)/i.test(name) || /(?:windows|win64|win-x64)/i.test(name)) return "windows";
  if (/\.(dmg|pkg)(?:$|\?)/i.test(name) || /(?:macos|darwin|osx)/i.test(name)) return "mac";
  if (releaseTagContainsMac(release) && /\.zip(?:$|\?)/i.test(name)) return "mac";
  return null;
}

function preferredPlatformAsset(release, platform) {
  const priorities = platform === "mac" ? [".dmg", ".pkg", ".zip"] : [".exe", ".msi", ".msix", ".zip"];
  return (release?.assets || [])
    .filter((asset) => assetPlatform(asset, release) === platform)
    .sort((left, right) => {
      const leftName = String(left.name || "").toLowerCase();
      const rightName = String(right.name || "").toLowerCase();
      const leftRank = priorities.findIndex((extension) => leftName.endsWith(extension));
      const rightRank = priorities.findIndex((extension) => rightName.endsWith(extension));
      return (leftRank < 0 ? priorities.length : leftRank) - (rightRank < 0 ? priorities.length : rightRank);
    })[0] || null;
}

function latestPlatformRelease(releases, platform) {
  const sorted = sortReleasesByDate(releases).filter((release) => !release.draft);
  let candidates;
  if (platform === "mac") {
    candidates = sorted.filter(releaseTagContainsMac);
    if (!candidates.length) candidates = sorted.filter((release) => preferredPlatformAsset(release, "mac"));
  } else {
    candidates = sorted.filter((release) => !releaseTagContainsMac(release) && preferredPlatformAsset(release, "windows"));
  }
  const release = candidates[0] || null;
  return release ? { release, asset: preferredPlatformAsset(release, platform) } : null;
}

function nextReleasePage(linkHeader) {
  const next = String(linkHeader || "").split(",").find((entry) => /rel="next"/.test(entry));
  return next?.match(/<([^>]+)>/)?.[1] || null;
}

async function fetchAllReleases(signal) {
  const releases = [];
  let pageUrl = RELEASE_API;
  let pageCount = 0;
  while (pageUrl && pageCount < 20) {
    const response = await fetch(pageUrl, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal,
    });
    if (!response.ok) throw new Error(String(response.status));
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("Invalid releases response");
    releases.push(...page);
    pageUrl = nextReleasePage(response.headers.get("link"));
    pageCount = pageCount + 1;
  }
  return sortReleasesByDate(releases.filter((release) => !release.draft));
}

function releaseNotesLines(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*+]\s+/, "").replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1").replace(/[`*_>]/g, "").trim())
    .filter((line) => line && !/^[-|: ]{3,}$/.test(line) && !line.startsWith("|") && !line.startsWith("```") && !/^\d+\.\s/.test(line))
    .slice(0, 6);
}

function renderReleaseNotes(release) {
  const title = document.querySelector("[data-release-notes-title]");
  const date = document.querySelector("[data-release-notes-date]");
  const body = document.querySelector("[data-release-notes-body]");
  const link = document.querySelector("[data-release-notes-link]");
  if (!release) return;
  if (title) title.textContent = cleanReleaseTitle(release);
  if (date) date.textContent = formatReleaseDate(release.published_at || release.created_at);
  if (link && release.html_url) link.href = release.html_url;
  if (!body) return;
  const lines = releaseNotesLines(release.body);
  body.replaceChildren();
  if (!lines.length) {
    const fallback = document.createElement("p");
    fallback.textContent = currentLanguage === "en" ? "This release is ready to download. Full details are available on GitHub." : "此版本已经可以下载，完整说明可前往 GitHub 查看。";
    body.append(fallback);
    return;
  }
  const list = document.createElement("ul");
  lines.forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  });
  body.append(list);
}

function renderReleaseHistory(releases) {
  const list = document.querySelector("[data-release-history-list]");
  const count = document.querySelector("[data-release-history-count]");
  const sorted = sortReleasesByDate(releases || []).filter((release) => !release.draft);
  if (count) count.textContent = Number(sorted.length).toLocaleString(currentLanguage === "en" ? "en-US" : "zh-CN");
  if (!list) return;
  list.replaceChildren();
  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "release-history-state";
    empty.textContent = translate("download.historyEmpty");
    list.append(empty);
    return;
  }

  sorted.forEach((release) => {
    const item = document.createElement("details");
    item.className = "release-history-item";
    const summary = document.createElement("summary");
    const identity = document.createElement("div");
    identity.className = "release-history-identity";
    const tag = document.createElement("span");
    tag.textContent = release.tag_name || "RELEASE";
    const title = document.createElement("h4");
    title.textContent = cleanReleaseTitle(release);
    identity.append(tag, title);

    const meta = document.createElement("div");
    meta.className = "release-history-meta";
    const platformSet = new Set((release.assets || []).map((asset) => assetPlatform(asset, release)).filter(Boolean));
    if (releaseTagContainsMac(release)) platformSet.add("mac");
    const platforms = document.createElement("span");
    platforms.className = "release-history-platforms";
    platforms.textContent = [...platformSet].map((platform) => platform === "mac" ? "macOS" : "Windows").join(" · ") || "GitHub";
    const type = document.createElement("span");
    type.className = release.prerelease ? "is-prerelease" : "is-stable";
    type.textContent = translate(release.prerelease ? "download.prerelease" : "download.stable");
    const date = document.createElement("time");
    date.dateTime = release.published_at || release.created_at || "";
    date.textContent = formatReleaseDate(date.dateTime);
    const downloads = (release.assets || []).reduce((total, asset) => total + Number(asset.download_count || 0), 0);
    const downloadCount = document.createElement("span");
    downloadCount.textContent = `${downloads.toLocaleString(currentLanguage === "en" ? "en-US" : "zh-CN")} ${translate("download.releaseDownloads")}`;
    const marker = document.createElement("i");
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "＋";
    meta.append(platforms, type, date, downloadCount, marker);
    summary.append(identity, meta);

    const content = document.createElement("div");
    content.className = "release-history-content";
    const notes = document.createElement("div");
    notes.className = "release-history-notes";
    const noteLines = releaseNotesLines(release.body);
    if (noteLines.length) {
      const noteList = document.createElement("ul");
      noteLines.forEach((line) => {
        const note = document.createElement("li");
        note.textContent = line;
        noteList.append(note);
      });
      notes.append(noteList);
    } else {
      const emptyNotes = document.createElement("p");
      emptyNotes.textContent = translate("download.noReleaseNotes");
      notes.append(emptyNotes);
    }

    const assets = document.createElement("div");
    assets.className = "release-history-assets";
    const assetTitle = document.createElement("h5");
    assetTitle.textContent = translate("download.releaseAssets");
    assets.append(assetTitle);
    (release.assets || []).forEach((asset) => {
      const link = document.createElement("a");
      link.href = asset.browser_download_url;
      link.target = "_blank";
      link.rel = "noopener";
      const assetName = document.createElement("span");
      assetName.textContent = asset.name;
      const assetMeta = document.createElement("small");
      assetMeta.textContent = `${formatBytes(asset.size)} · ${Number(asset.download_count || 0).toLocaleString(currentLanguage === "en" ? "en-US" : "zh-CN")} ${translate("download.releaseDownloads")}`;
      link.append(assetName, assetMeta);
      assets.append(link);
    });
    const releaseLink = document.createElement("a");
    releaseLink.className = "release-history-github";
    releaseLink.href = release.html_url || "https://github.com/Quartzsyr/MuseFilm/releases";
    releaseLink.target = "_blank";
    releaseLink.rel = "noopener";
    releaseLink.textContent = translate("download.viewRelease");
    assets.append(releaseLink);
    content.append(notes, assets);
    item.append(summary, content);
    list.append(item);
  });
}

function renderReleaseData(data) {
  if (!data) return;
  lastReleaseData = data;
  Object.entries(data.platforms).forEach(([platform, info]) => {
    if (!info) return;
    document.querySelectorAll(`[data-release-name="${platform}"]`).forEach((element) => {
      element.textContent = platform === "mac" && info.release?.tag_name ? info.release.tag_name : cleanReleaseTitle(info.release);
    });
    document.querySelectorAll(`[data-release-details="${platform}"]`).forEach((element) => {
      const system = platform === "windows" ? "Windows 10 / 11" : (currentLanguage === "en" ? "Native macOS" : "原生 macOS");
      element.textContent = `${system} · ${info.asset ? formatBytes(info.asset.size) : translate("download.noInstaller")}`;
      element.removeAttribute("data-i18n");
    });
    document.querySelectorAll(`[data-release-date="${platform}"]`).forEach((element) => { element.textContent = formatReleaseDate(info.release?.published_at || info.release?.created_at); });
    document.querySelectorAll(`[data-release-digest="${platform}"]`).forEach((element) => {
      const digest = info.asset?.digest || "—";
      element.textContent = digest.startsWith("sha256:") ? digest.slice(7) : digest;
      element.title = digest;
    });
    document.querySelectorAll(`.download-trigger[data-platform="${platform}"]:not([data-platform-download])`).forEach((link) => {
      const label = link.querySelector("span:first-child");
      const icon = link.querySelector("span:last-child");
      if (info.asset?.browser_download_url) link.href = info.asset.browser_download_url;
      else if (info.release?.html_url) link.href = info.release.html_url;
      if (label) {
        label.textContent = translate(!info.asset && platform === "mac" ? "download.viewMacRelease" : `download.${platform}`);
        label.removeAttribute("data-i18n");
      }
      if (icon) icon.textContent = info.asset ? "↓" : "↗";
      link.classList.toggle("is-release-only", !info.asset);
    });
  });
  renderReleaseNotes(data.latestRelease);
  renderReleaseHistory(data.releases);
  refreshPlatformDownload();
}

refreshReleaseLanguage = () => renderReleaseData(lastReleaseData);

function renderCounts(counts, synced) {
  lastCounts = counts;
  lastCountsSynced = synced;
  const locale = currentLanguage === "en" ? "en-US" : "zh-CN";
  Object.entries(counts).forEach(([platform, value]) => {
    document.querySelectorAll(`[data-download-count="${platform}"]`).forEach((element) => {
      element.textContent = Number(value).toLocaleString(locale);
    });
  });
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  document.querySelectorAll("[data-total-downloads]").forEach((element) => {
    element.textContent = total.toLocaleString(locale);
  });
  document.querySelectorAll("[data-download-status]").forEach((element) => {
    element.textContent = downloadOpened
      ? translate("status.opened")
      : translate(synced ? "status.synced" : "status.fallback");
  });
}

async function syncDownloadCounts() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const releases = await fetchAllReleases(controller.signal);
    const counts = { windows: 0, mac: 0 };
    releases.forEach((release) => {
      (release.assets || []).forEach((asset) => {
        const platform = assetPlatform(asset, release);
        if (platform) counts[platform] += Number(asset.download_count || 0);
      });
    });
    Object.keys(counts).forEach((platform) => {
      if (!counts[platform]) counts[platform] = FALLBACK_COUNTS[platform];
    });
    renderCounts(counts, true);
    renderReleaseData({
      platforms: {
        windows: latestPlatformRelease(releases, "windows"),
        mac: latestPlatformRelease(releases, "mac"),
      },
      latestRelease: releases[0],
      releases,
    });
  } catch {
    renderCounts(FALLBACK_COUNTS, false);
    const notesBody = document.querySelector("[data-release-notes-body]");
    if (notesBody) notesBody.textContent = currentLanguage === "en" ? "GitHub is temporarily unavailable. Open Releases for the latest details." : "GitHub 暂时不可用，可前往 Releases 查看最新说明。";
    const history = document.querySelector("[data-release-history-list]");
    if (history) history.textContent = translate("download.historyUnavailable");
  } finally {
    window.clearTimeout(timeout);
  }
}

document.querySelectorAll("[data-copy-digest]").forEach((button) => {
  button.addEventListener("click", async () => {
    const platform = button.dataset.copyDigest;
    const value = document.querySelector(`[data-release-digest="${platform}"]`)?.textContent?.trim();
    if (!value || value === "—") return;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = translate("download.copied");
      window.setTimeout(() => { button.textContent = translate("download.copy"); }, 1300);
    } catch {}
  });
});

document.querySelectorAll(".download-trigger").forEach((link) => {
  link.addEventListener("click", () => {
    downloadOpened = true;
    document.querySelectorAll("[data-download-status]").forEach((status) => {
      status.textContent = translate("status.opened");
    });
  });
});

const apiBase = (document.querySelector('meta[name="musefilm-api-base"]')?.content || "https://api.musefilm.top").replace(/\/$/, "");
const feedbackDialog = document.querySelector("[data-feedback-dialog]");
const feedbackForm = document.querySelector("[data-feedback-form]");
const feedbackStatus = document.querySelector("[data-feedback-status]");
const feedbackMessage = feedbackForm?.elements?.namedItem("message");
const feedbackCount = document.querySelector("[data-feedback-count]");
const feedbackSubmit = feedbackForm?.querySelector(".feedback-submit");
const feedbackTurnstile = document.querySelector("[data-feedback-turnstile]");
let feedbackConfig = { turnstileEnabled: false, turnstileSiteKey: "" };
let feedbackTurnstileToken = "";
let feedbackTurnstileWidget = null;
let feedbackConfigPromise = null;

function anonymousEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
}

function referrerHost() {
  if (!document.referrer) return "";
  try { return new URL(document.referrer).hostname.slice(0,160); } catch { return ""; }
}

async function musefilmApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function loadTurnstileScript() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  const existing = document.querySelector('script[data-musefilm-turnstile]');
  if (existing) return new Promise((resolve, reject) => {
    existing.addEventListener("load", () => resolve(globalThis.turnstile), { once: true });
    existing.addEventListener("error", reject, { once: true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.musefilmTurnstile = "";
    script.addEventListener("load", () => resolve(globalThis.turnstile), { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
}

async function prepareFeedbackVerification() {
  if (!feedbackTurnstile) return feedbackConfig;
  if (!feedbackConfigPromise) {
    feedbackConfigPromise = musefilmApi("/api/config", { method: "GET", headers: {} })
      .then((config) => {
        feedbackConfig = config;
        return config;
      })
      .catch(() => feedbackConfig);
  }
  const config = await feedbackConfigPromise;
  if (!config.turnstileEnabled || !config.turnstileSiteKey || feedbackTurnstileWidget !== null) return config;
  try {
    const turnstile = await loadTurnstileScript();
    feedbackTurnstile.hidden = false;
    feedbackTurnstileWidget = turnstile.render(feedbackTurnstile, {
      sitekey: config.turnstileSiteKey,
      theme: "dark",
      size: "flexible",
      appearance: "interaction-only",
      callback: (token) => { feedbackTurnstileToken = token; },
      "expired-callback": () => { feedbackTurnstileToken = ""; },
      "error-callback": () => { feedbackTurnstileToken = ""; },
    });
  } catch {}
  return config;
}

function setFeedbackStatus(message, state = "") {
  if (!feedbackStatus) return;
  feedbackStatus.textContent = message;
  feedbackStatus.classList.toggle("is-error", state === "error");
  feedbackStatus.classList.toggle("is-success", state === "success");
}

document.querySelectorAll("[data-feedback-open]").forEach((button) => {
  button.addEventListener("click", () => {
    setFeedbackStatus("");
    if (feedbackDialog?.showModal) feedbackDialog.showModal();
    else feedbackDialog?.setAttribute("open", "");
    void prepareFeedbackVerification();
    window.setTimeout(() => feedbackMessage?.focus(), 180);
  });
});

document.querySelectorAll("[data-feedback-close]").forEach((button) => {
  button.addEventListener("click", () => feedbackDialog?.close());
});

feedbackDialog?.addEventListener("click", (event) => {
  if (event.target !== feedbackDialog) return;
  const bounds = feedbackDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) feedbackDialog.close();
});

feedbackMessage?.addEventListener("input", () => {
  if (feedbackCount) feedbackCount.textContent = String(feedbackMessage.value.length);
});

feedbackForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!feedbackForm.reportValidity()) return;
  const config = await prepareFeedbackVerification();
  if (config.turnstileEnabled && !feedbackTurnstileToken) {
    setFeedbackStatus(translate("feedback.verify"), "error");
    return;
  }
  const data = new FormData(feedbackForm);
  feedbackSubmit?.setAttribute("disabled", "");
  setFeedbackStatus(translate("feedback.sending"));
  try {
    const result = await musefilmApi("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        type: String(data.get("type") || "other"),
        message: String(data.get("message") || ""),
        email: String(data.get("email") || ""),
        website: String(data.get("website") || ""),
        page: `${location.origin}${location.pathname}${location.hash}`.slice(0,500),
        locale: currentLanguage,
        platform: detectDownloadPlatform(),
        turnstileToken: feedbackTurnstileToken,
      }),
    });
    setFeedbackStatus(translate(result.emailQueued ? "feedback.success" : "feedback.stored"), "success");
    feedbackForm.reset();
    if (feedbackCount) feedbackCount.textContent = "0";
    feedbackTurnstileToken = "";
    if (feedbackTurnstileWidget !== null && globalThis.turnstile) globalThis.turnstile.reset(feedbackTurnstileWidget);
    window.setTimeout(() => feedbackDialog?.close(), 1800);
  } catch {
    setFeedbackStatus(translate("feedback.error"), "error");
  } finally {
    feedbackSubmit?.removeAttribute("disabled");
  }
});

async function recordAnonymousVisit() {
  const path = `${location.pathname}${location.hash}`.slice(0,300);
  const storageKey = `musefilm:visit:${path}`;
  try {
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");
  } catch {}
  try {
    await musefilmApi("/api/visit", {
      method: "POST",
      keepalive: true,
      body: JSON.stringify({
        eventId: anonymousEventId(),
        path,
        locale: currentLanguage,
        platform: detectDownloadPlatform(),
        referrerHost: referrerHost(),
      }),
    });
  } catch {}
}

let lastVisitorCount = 8;

function renderVisitorCount(value) {
  const safeValue = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : lastVisitorCount;
  lastVisitorCount = safeValue;
  const locale = currentLanguage === "en" ? "en-US" : "zh-CN";
  document.querySelectorAll("[data-visitor-total]").forEach((element) => {
    element.textContent = new Intl.NumberFormat(locale).format(safeValue);
  });
}

async function syncVisitorCount() {
  try {
    const result = await musefilmApi("/api/visitors", { method: "GET", headers: {} });
    renderVisitorCount(Number(result.visitors));
    document.querySelectorAll(".visitor-counter").forEach((element) => element.classList.add("is-synced"));
  } catch {
    renderVisitorCount(lastVisitorCount);
  }
}

document.querySelectorAll("[data-language-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    applyLanguage(currentLanguage === "zh" ? "en" : "zh");
    renderCounts(lastCounts, lastCountsSynced);
    renderVisitorCount(lastVisitorCount);
  });
});

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

applyLanguage("zh");
renderCounts(FALLBACK_COUNTS, false);
syncDownloadCounts();
void recordAnonymousVisit().then(syncVisitorCount);
