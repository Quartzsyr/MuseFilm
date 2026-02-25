# MuseFilm
归档胶卷，赛博观片
# MuseFilm 项目文档

本文档详细介绍 MuseFilm 的技术架构、目录结构、核心模块与使用方式，便于开发与维护。

---

## 一、项目概述

### 1.1 简介

**MuseFilm** 是一款面向胶卷/胶片爱好者的**桌面端数字档案管理应用**。用户可将本地图片文件夹按「卷」导入，关联胶卷种类、拍摄信息与单张备注，在观片台、图库与预览中浏览与管理，数据全部保存在本地，不依赖云端。

- **版本**：0.6.2（内测）
- **开发**：Quartz（Soochow U | UESTC）
- **联系方式**：SYRQuartz@gmail.com

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| 本地优先 | 图片不移动、不复制，仅记录路径；数据以 JSON 存于本地 `data/` |
| 混合架构 | Python 负责数据与 IO，内嵌 Web（HTML/CSS/JS）负责界面，通过 QWebChannel 桥接 |
| 多界面 | 首页、图库、档案、导入、胶卷库、观片台、搜索、预览、设置 |
| 主题与外观 | 浅/深/自动主题；漏光、灰尘、暗房、复古冲印、褪色等胶片风格；无边框窗口、拟物滚动条 |
| 扩展胶卷库 | 内置胶卷种类 + 可自定义；网络或本地封面；暗盒/包装图切换 |

### 1.3 技术栈

| 层级 | 技术 |
|------|------|
| 运行环境 | Python 3.10+ |
| GUI 容器 | PyQt6（QMainWindow + QWebEngineView） |
| 前端 | 原生 HTML/CSS/JavaScript（无框架），Hash 路由 |
| 桥接 | PyQt6 QWebChannel，将 Python 对象暴露为 `window.bridge` |
| 图片 | Pillow（缩略图/全图缓存）、EXIF 读取 |
| 网络 | requests（胶卷封面等） |
| 打包 | PyInstaller（onedir），Inno Setup 6（安装包） |

---

## 二、技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        MuseFilm 主窗口                           │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐ │
│  │  自定义标题栏     │  │  QWebEngineView                      │ │
│  │  (无边框时)      │  │  ┌────────────────────────────────┐  │ │
│  └─────────────────┘  │  │  resources/web/index.html       │  │ │
│                       │  │  - Hash 路由 (#/dashboard 等)   │  │ │
│                       │  │  - JS Views 渲染到 #main-scroll  │  │ │
│                       │  │  - musefilm:// Scheme 供图片    │  │ │
│                       │  └────────────────────────────────┘  │ │
│                       └──────────────────────────────────────┘ │
│                                    │                            │
│                                    │ QWebChannel                 │
│                                    ▼                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Bridge (Python)                                          │  │
│  │  - getRolls / getFilmTypes / addRoll / ensureThumbnail…   │  │
│  │  - 对接 models、thumbnail_loader、image_loader、cover…    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

- **主进程**：`main.py` 创建 `QApplication`，注册 `musefilm://` URL 方案，创建 `WebWindow`，加载 `resources/web/index.html`。
- **前端**：`index.html` 引入 `qwebchannel.js`、`bridge.js`、`router.js` 及各 view 的 JS；Hash 变化时路由到对应 view，view 内通过 `window.bridge` 调用 Python。
- **图片**：前端不直接读盘。先调用 `bridge.ensureThumbnail(path, size)` 或 `bridge.ensureFullImage(path)`，Python 在后台生成缓存并发出信号，前端收到后把 `<img src="musefilm://thumb?path=...&size=...">` 或 `musefilm://image?path=...` 赋给 `img.src`，由 `MusefilmSchemeHandler` 从缓存读字节并返回。

### 2.2 数据流概要

- **卷与胶卷种类**：`data/rolls.json`、`data/film_types.json`，由 `src/models.py` 读写，Bridge 内使用内存缓存（写操作后失效）。
- **缩略图/全图**：生成后写入 `data/cache/`（缩略图）与 `data/cache/full/`（全图），Scheme 仅从缓存读，不在此处生成。
- **设置**：`data/settings.json`，键由 `SettingsKeys` 定义；数据目录可被 `app_config` 中的 `data_dir_override` 覆盖。

---

## 三、目录结构

```
musefilm/
├── main.py                 # 入口：注册 Scheme、创建 QApplication、启动 WebWindow
├── requirements.txt        # Python 依赖
├── MuseFilm.spec          # PyInstaller 打包配置（onedir）
├── build_installer.bat     # 一键：PyInstaller + Inno Setup 生成安装包
├── setup.ico               # 应用/安装程序图标
│
├── src/                    # Python 源码
│   ├── app.py              # 数据目录、缓存目录、get_data_path 等
│   ├── app_config.py      # 应用配置（如 data_dir_override）读写
│   ├── bridge.py           # QWebChannel 暴露的 Bridge，供前端调用
│   ├── url_scheme.py       # musefilm:// thumb/image/cover 的 Scheme 处理
│   ├── web_window.py       # 主窗口：无边框/标题栏、QWebEngineView、QWebChannel
│   ├── models.py           # FilmType / Roll 数据类，JSON 读写，业务逻辑
│   ├── thumbnail_loader.py # 缩略图生成与磁盘/内存缓存，异步加载
│   ├── image_loader.py     # 全图缓存生成与读取，异步加载
│   ├── cover_loader.py     # 胶卷封面（网络/本地、暗盒/包装）
│   ├── backup.py           # 自动备份、导出/恢复
│   ├── theme.py            # 拟物/主题相关常量（供 Qt 端）
│   ├── views/              # Qt 原生视图（备用；当前主界面为 Web）
│   │   ├── dashboard_view.py
│   │   ├── archive_view.py
│   │   ├── home_gallery.py
│   │   ├── light_table_view.py
│   │   ├── import_view.py
│   │   ├── preview.py
│   │   ├── search_view.py
│   │   ├── film_library.py
│   │   ├── settings_view.py
│   │   └── ...
│   └── widgets/             # 自定义控件（如 roll_card、light_table_frame）
│   └── utils/              # exif、format_detector 等
│
├── resources/              # 静态资源（打包时进入 bundle）
│   ├── web/                # 内嵌前端 SPA
│   │   ├── index.html      # 单页入口，侧栏导航，#main-scroll 挂载点
│   │   ├── css/app.css     # 全局样式、主题变量、拟物风格
│   │   ├── js/
│   │   │   ├── qwebchannel.js
│   │   │   ├── bridge.js    # QWebChannel 连接，设置 window.bridge
│   │   │   ├── router.js   # Hash 路由，register/render/go
│   │   │   ├── app.js      # 主题、waitBridge 后首次渲染、随机一张刷新
│   │   │   ├── empty-states.js
│   │   │   └── views/      # 各页面视图
│   │   │       ├── dashboard.js
│   │   │       ├── archive.js
│   │   │       ├── gallery.js
│   │   │       ├── import.js
│   │   │       ├── film-library.js
│   │   │       ├── light-table.js
│   │   │       ├── search.js
│   │   │       ├── preview.js
│   │   │       └── settings.js
│   │   └── ...
│   ├── scrollbar.qss       # Qt 拟物滚动条
│   ├── film_cover_db.json  # 内置胶卷封面索引
│   └── ...
│
├── data/                   # 运行时生成（开发时在项目下，打包后在用户目录或 override）
│   ├── film_types.json
│   ├── rolls.json
│   ├── settings.json
│   ├── tags.json
│   ├── recent_views.json
│   ├── covers/             # 封面缓存
│   └── cache/              # 缩略图 + full/ 全图缓存
│
├── installer/               # Inno Setup 安装脚本
│   ├── MuseFilmSetup.iss   # 扁平简约向导样式
│   ├── InfoBefore.txt
│   ├── InfoAfter.txt
│   └── License.txt
│
└── docs/
    └── PROJECT.md          # 本文档
```

---

## 四、核心模块说明

### 4.1 入口与窗口（main.py / web_window.py）

- **main.py**：在创建 `QApplication` 之前调用 `register_musefilm_scheme()` 注册 `musefilm` 方案；设置高 DPI、字体、全局滚动条 QSS；创建并显示 `WebWindow`。
- **web_window.py**：`WebWindow` 为无边框（可选）主窗口，包含自定义标题栏、`QWebEngineView`；在 View 的 profile 上安装 `MusefilmSchemeHandler`；创建 `QWebChannel`，注册 `Bridge`，加载 `resources/web/index.html`。观片台全屏时隐藏标题栏并进入系统全屏。

### 4.2 桥接与 URL 方案（bridge.py / url_scheme.py）

- **bridge.py**：`Bridge` 继承 `QObject`，方法使用 `@pyqtSlot`，供前端异步调用。主要能力：
  - **档案/卷**：`getRolls`、`getRollsSorted`、`getRoll`、`getRandomPhoto`、`addRoll`、`updateRoll`、`deleteRoll`。
  - **胶卷种类**：`getFilmTypes`、`addFilmType`、`updateFilmType`、`deleteFilmType`、`getFilmCoverSuggestions`。
  - **标签**：`getTags`、`mergeTagsIntoSaved`。
  - **图片**：`ensureThumbnail(path, size)`、`ensureFullImage(path)`、`prefetchFullImage(path)`；信号 `thumbnailReady(path, size, url)`、`fullImageReady(path, url)`。
  - **设置/主题/最近浏览/导入/搜索/单张元数据/导出/文件选择/打开文件夹/封面/EXIF/观片台全屏/备份** 等。
- **url_scheme.py**：`MusefilmSchemeHandler` 处理 `musefilm://thumb?path=...&size=...`、`musefilm://image?path=...`、`musefilm://cover?id=...`，仅从缓存或封面目录读字节并回复，不在 Scheme 内生成缩略图/全图。

### 4.3 数据与业务（models.py）

- **数据类**：`FilmType`（id、name、cover_url、builtin、sort_order、stock、canister_image、box_image）、`Roll`（id、film_type_id、folder_path、imported_at、image_rel_paths、name、notes、tags、拍摄信息、photo_meta）。
- **JSON 持久化**：`load_rolls` / `save_rolls`、`load_film_types` / `save_film_types`、`load_settings` / `save_settings`、`load_tags`、`load_recent_views`、`add_recent_view` 等。
- **业务**：`get_rolls_sorted`、`search_rolls`、`set_photo_meta`、`reorder_roll_images`、`export_roll_to_json`、`delete_roll`（仅删记录与缓存，不删原图）、`is_folder_already_imported`、`scan_folder_for_images` 等。缩略图/全图缓存路径与清理逻辑也在此或由 app 的 `get_cache_dir()` 决定。

### 4.4 图片加载与缓存（thumbnail_loader.py / image_loader.py）

- **thumbnail_loader.py**：`AsyncThumbnailLoader` 使用线程池异步生成缩略图并写入 `data/cache/`，LRU 内存缓存；Bridge 在 `ensureThumbnail` 时若磁盘缓存已存在则直接发射 `thumbnailReady`，否则交给 loader。
- **image_loader.py**：`FullImageCacheLoader` 使用线程池异步将原图转为 JPEG 写入 `data/cache/full/`；Bridge 在 `ensureFullImage` / `prefetchFullImage` 时若缓存已存在则直接发射或跳过；Scheme 仅从缓存读。

### 4.5 前端路由与视图（router.js / views/*.js）

- **router.js**：根据 `location.hash` 得到 route（如 `dashboard`、`archive`、`preview`），维护 `routes[name]`，`render(routeName)` 将对应 view 的 `render(mountEl)` 挂到 `#main-scroll`。
- **各 view**：从 `window.bridge` 拉取数据（如 `getRolls()`、`getFilmTypes()`），生成 HTML 并绑定事件；预览/图库/观片台等会调用 `ensureThumbnail` / `ensureFullImage`，监听 `thumbnailReady` / `fullImageReady` 后设置 `img.src` 为 `musefilm://...`。预览页区分「从导航随机一张」与「从档案/图库进入」的标题（预览 / 随机一张）。

### 4.6 配置与备份（app_config.py / backup.py）

- **app_config.py**：读写应用级配置（如 `data_dir_override`），通常存于用户目录的配置文件，与 `data/` 内 JSON 分离。
- **backup.py**：自动备份（可选）、导出 ZIP、从 ZIP 恢复；可由设置页与 Bridge 调用。

---

## 五、数据与持久化

### 5.1 数据目录

- **开发环境**：项目根下 `data/`；可通过设置页修改为自定义目录（写入 `app_config` 的 `data_dir_override`），下次启动生效。
- **打包后**：默认 `%LOCALAPPDATA%\MuseFilm\data\`，同样支持通过设置更改。

### 5.2 主要文件

| 文件 | 说明 |
|------|------|
| `film_types.json` | 胶卷种类（内置 + 用户自定义） |
| `rolls.json` | 所有卷：文件夹路径、图片相对路径、元数据、单张 photo_meta |
| `settings.json` | 主题、无边框、默认导入目录、缩略图大小、备份选项、幻灯片间隔等 |
| `tags.json` | 标签列表（用于筛选与合并） |
| `recent_views.json` | 最近浏览的图片路径 |
| `covers/` | 下载或本地的胶卷封面图 |
| `cache/` | 缩略图缓存；`cache/full/` 为全图 JPEG 缓存 |

图片文件本身**不移动、不复制**，仅记录 `folder_path` + `image_rel_paths`。

---

## 六、功能模块简述

| 模块 | 说明 |
|------|------|
| **首页** | 仪表盘：统计、胶卷类型分布、最近添加卷、最近浏览、快捷入口 |
| **图库** | 按胶卷/标签筛选，网格缩略图，点击进入预览（从档案某卷进入时带卷上下文） |
| **档案** | 卷列表，按时间/拍摄日期/卷名排序，拟物卡片，编辑/删除/导出/进图库 |
| **导入** | 选择文件夹（可多选）、胶卷种类、EXIF 预填、去重检测、写入 rolls |
| **胶卷库** | 预设与自定义种类、封面（暗盒/包装）、增删改 |
| **观片台** | 选卷后横向 strip 展示，点击进预览，支持全屏 |
| **搜索** | 按卷名、标签、备注、相机、地点等搜索，结果进预览或档案 |
| **预览** | 大图、上一张/下一张、胶片条、EXIF、星级与备注、快捷键、缩放、幻灯片、在文件管理器中打开；标题区分「预览」与「随机一张」 |
| **设置** | 主题、数据目录、缩略图大小、备份与恢复、关于与打赏 |

---

## 七、开发与运行

### 7.1 环境

- Python 3.10+
- 依赖见 `requirements.txt`：PyQt6、PyQt6-WebEngine、Pillow、requests

### 7.2 安装依赖并运行

```bash
pip install -r requirements.txt
python main.py
```

首次运行会在项目下创建 `data/` 及上述 JSON 与子目录。

### 7.3 修改前端

- 编辑 `resources/web/` 下 HTML/CSS/JS 后，重启应用或刷新内嵌页即可生效（若支持刷新）。
- 桥接接口见 `src/bridge.py`；前端通过 `window.bridge` 调用，信号通过 `bridge.thumbnailReady.connect(...)` 等监听。

---

## 八、打包与安装

### 8.1 PyInstaller 打包

- 使用项目中的 `MuseFilm.spec`（onedir，便于 Inno Setup 复制整目录）：
  ```bash
  pyinstaller MuseFilm.spec
  ```
- 输出在 `dist/MuseFilm/`，包含可执行文件与 `resources` 等；不包含 `data/`。

### 8.2 Inno Setup 安装包

- 需安装 Inno Setup 6+，且 `iscc` 在 PATH 中。
- 执行：
  ```bash
  build_installer.bat
  ```
  或先执行 PyInstaller，再在 Inno Setup 中打开 `installer/MuseFilmSetup.iss` 编译。
- 安装脚本已配置扁平简约向导样式（中性暖色、无侧边图、隐藏分隔线），与应用风格一致。

---

## 九、扩展与维护建议

- **新增 Bridge 方法**：在 `bridge.py` 中添加 `@pyqtSlot` 方法，参数与返回值需可被 QVariant 序列化；前端通过 `window.bridge.xxx()` 调用。
- **新增页面**：在 `resources/web/js/views/` 下新增 JS，在 `router.js` 中注册路由，在 `index.html` 中引入脚本；侧栏增加对应 `<a href="#/xxx">`。
- **胶卷种类与封面**：内置种类与封面索引在 `resources/film_cover_db.json` 等；用户种类与封面缓存在 `data/film_types.json` 与 `data/covers/`。
- **主题**：CSS 变量在 `resources/web/css/app.css` 的 `:root` 与 `body.theme-dark`；胶片风格类如 `theme-film-light-leak` 等；设置页与 Bridge 的 `getTheme` / `saveSettings` 联动。

---

## 十、版本与更新

- 当前以 **0.5.2** 为版本号（以 `installer/MuseFilmSetup.iss` 等为准）。
- 近期更新包括：胶卷库有效期日历选择与自定义介绍、暗盒/包装封面手动设置、天气缓存与介绍弹窗等。具体见 `CHANGELOG.md` 与 README。

---

*文档随项目更新，如有出入以代码为准。*
