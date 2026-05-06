# MapLibre glyphs (this folder)

Browser **UI text** uses normal CSS `@font-face` / `font-family` (see `src/app/styles/global.css`). That is unrelated to map labels.

## Why glyph PBFs?

**MapLibre GL does not rasterize `.ttf` files for labels on the map.**  
It downloads **precomputed glyph tiles**: small **Protocol Buffer** blobs (`.pbf`), one **range** of Unicode code points per file.

If the style points at glyphs that do not exist on your origin, the console shows **404** for URLs like `/fonts/<fontstack>/<start>-<end>.pbf` and labels disappear or show “tofu”.

## Glyph URL (web app origin)

Our shared style sets:

`/fonts/{fontstack}/{range}.pbf`

Vite serves `apps/web/public/` at the site root, so those files must live under:

`apps/web/public/fonts/`

## Folder names MUST match `text-font`

Each entry in `text-font` resolves to `{fontstack}` in the glyphs URL template. The subdirectory name **must exactly match** the font stack string in the JSON, including spaces. Example:

| `text-font` in style.json | Glyph directory |
| --- | --- |
| `Noto Sans Myanmar Regular` | `public/fonts/Noto Sans Myanmar Regular/` |
| `Noto Sans Regular` | `public/fonts/Noto Sans Regular/` |

If the folder name differs (extra space, wrong casing), MapLibre will request the wrong path and you get **404** and broken labels.

## What to put here

Generated files only, typically named like **`0-255.pbf`**, **`256-511.pbf`**, … (covering Myanmar + ASCII/Latin digits as needed). See **`apps/web/scripts/README-generate-glyphs.md`** for how to generate them from `.ttf` sources.

Do **not** commit proprietary fonts unless licensing allows it. Prefer generating locally from **SIL Open Font License** Noto downloads.
