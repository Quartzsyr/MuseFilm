# MuseFilm website

The MuseFilm product site is a static Vite project designed for direct GitHub Pages hosting at [musefilm.top](https://musefilm.top).

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Vite serves a single `index.html` product page for Windows and macOS. All links and assets use relative paths so the same build works on the custom domain and on a GitHub Pages repository URL.

## Build

```bash
npm run build
npm test
```

The production-ready static site is written to `dist/`. No application server, database, rewrite rule, or runtime image service is required.

The hero film reel is a procedural Three.js model loaded as a separate chunk. It pauses outside the viewport, renders a static pose when reduced motion is requested, and falls back to `public/images/hero-film-roll.png` if WebGL is unavailable.

The home-page 3D gallery includes all 21 product screenshots: 18 macOS screens and 3 Windows screens. The interface keeps only platform, previous/next, and counter controls. `site.js` also provides the Chinese/English language switch for the unified page.

## Deployment

The live GitHub repository currently publishes static files directly from the branch root. Keep the existing Pages source setting and the root `CNAME` file unchanged. To publish this version without changing that setup, place the built HTML, CSS, JavaScript, SEO files, `CNAME`, and `images/` assets in the repository root, then push normally.

Do not replace the direct GitHub Release asset URLs. `site.js` reads the public GitHub Releases API and sums the matching asset `download_count` values. GitHub therefore remains the source of truth for completed downloads; the page never treats a local click as a persisted download.

## Asset replacement

- Product screenshots: `public/images/` and `public/images/mac/`
- Social preview: `public/images/og-darkroom.jpg` (1200 × 630)
- Favicon and navigation mark: `public/images/app-icon.png` (the actual MuseFilm app icon, 256 × 256 PNG)
- Generated hero still life: `public/images/hero-film-roll.png`
- Generated three-frame gallery: `public/images/film-gallery.png`
- Product interface: `public/images/mac/01-dashboard-home.png`, `04-film-library.png`, and the remaining real app screenshots
- Current in-app product tour: `public/images/app-details/` (captured directly from the running macOS app)

Keep photography and product screenshots at practical web sizes, set explicit image dimensions in HTML, and prefer WebP or AVIF for future photographic assets when browser support and replacement workflow allow it.
