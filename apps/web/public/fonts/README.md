# MapLibre glyphs (this folder)

Browser **UI text** uses normal CSS `@font-face` / `font-family` (see `src/app/styles/global.css`). That is unrelated to map labels.

## Why glyph PBFs?

**MapLibre GL does not rasterize `.ttf` files for labels on the map.**  
It downloads **precomputed glyph tiles**: small **Protocol Buffer** blobs (`.pbf`), one **range** of Unicode code points per file.

If the style points at glyphs that do not exist on your origin, the console shows **404** for URLs like `/fonts/<fontstack>/<start>-<end>.pbf` and labels disappear or show “tofu”.

## Glyph URL (web app origin)

The shared style (`packages/map-style/base-map.json`) sets:

`/fonts/{fontstack}/{range}.pbf`

Vite serves `apps/web/public/` at the site root, so files live under:

`apps/web/public/fonts/`

### Quick manual checks

With the dev server running (default `http://localhost:5173`):

- [http://localhost:5173/fonts/NotoSansMyanmar-Regular/0-255.pbf](http://localhost:5173/fonts/NotoSansMyanmar-Regular/0-255.pbf)
- [http://localhost:5173/fonts/NotoSansMyanmar-Regular/4096-4351.pbf](http://localhost:5173/fonts/NotoSansMyanmar-Regular/4096-4351.pbf)

Expect **HTTP 200**, **binary** body (typically starts with protobuf length-delimited field `0a…`), not HTML. If you see **`<!DOCTYPE`**, routing is returning a SPA shell instead of the static file — MapLibre may then report errors like **`Unimplemented type: 4`** while parsing non-PBF bytes.

In **development**, the console also logs a short **`[glyph dev]`** line for those two URLs when the map is created (`glyphDevCheck.ts`).

## Myanmar: complex shaping + multiscript glyphs

Standard MapLibre label layout is not enough for **Myanmar script**: glyphs must be shaped (HarfBuzz) and paired with **PGF-encoded** glyph ranges for the shaped pseudo-codepoints. The web app loads **[maplibre-gl-complex-text](https://github.com/wipfli/maplibre-gl-complex-text)** before creating the map (`maplibreComplexText.ts`). The shared style still uses **`/fonts/{fontstack}/{range}.pbf`**; only requests whose range start appears in upstream’s multiscript allowlist are **rewritten** to **`NotoSansMultiscript-Regular-v1`** (default mirror: Oliver Wipfli’s **`pgf-glyph-ranges`** site, CORS-safe). Self-host those ranges and set **`VITE_MULTISCRIPT_GLYPH_BASE_URL`** if you cannot depend on that mirror.

## Folder names MUST match `text-font` (single stack only)

`{fontstack}` is built from **`text-font`** in the MapLibre style. Use **exactly one** font name per layer (no multi-font stacks like `NotoSansMyanmar-Regular,NotoSans-Regular`), so the glyph path is **`/fonts/NotoSansMyanmar-Regular/…`** and maps to **`public/fonts/NotoSansMyanmar-Regular/`**.

| `text-font` in style / layout | Glyph directory |
| --- | --- |
| `["NotoSansMyanmar-Regular"]` | `public/fonts/NotoSansMyanmar-Regular/` |

(Optional Latin-only ranges are still generated alongside Myanmar in CI under `NotoSans-Regular/` — but the runtime style should not reference a comma-joined combined stack.)

## What to put here

Generated files only, typically **`0-255.pbf`**, **`256-511.pbf`**, … See **`apps/web/scripts/README-generate-glyphs.md`** and **`.github/workflows/generate-glyphs.yml`**.

Do **not** commit proprietary fonts unless licensing allows it. Prefer generating from **SIL Open Font License** Noto downloads.
