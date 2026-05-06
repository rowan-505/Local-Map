# Generating `.pbf` glyphs for Local Map (`apps/web`)

Map labels use **glyph PBF ranges**, not raw `.ttf` files at runtime. You must produce `.pbf` files and copy them into:

- `apps/web/public/fonts/NotoSansMyanmar-Regular/*.pbf`

(Paths must match the style’s **`text-font`** and the glyphs URL **`/fonts/{fontstack}/{range}.pbf`**. The active style uses **`["NotoSansMyanmar-Regular"]`** — a **single** stack per symbol layer.)

## Fonts to start from (you obtain these — do not commit unless license allows)

- **Noto Sans Myanmar** — e.g. `NotoSansMyanmar-Regular.ttf` from [Google Fonts / Noto](https://fonts.google.com/noto/specimen/Noto+Sans+Myanmar) (typically **SIL OFL**).
- **Noto Sans** — e.g. `NotoSans-Regular.ttf`, if you need a separate **`NotoSans-Regular/`** glyph set for tooling or experimentation (**SIL OFL**).

Keep `.ttf` files outside the repo or under `glyph-source/` as your workflow allows.

## What to generate

For each **`fontstack`** directory, emit the standard Unicode **range** filenames MapLibre expects:

- `0-255.pbf`, `256-511.pbf`, … through the Unicode blocks you need (Latin + Myanmar at minimum).

### Smoke URLs (after `pnpm dev` in `apps/web`)

```txt
/fonts/NotoSansMyanmar-Regular/0-255.pbf
/fonts/NotoSansMyanmar-Regular/4096-4351.pbf
```

(Optional `NotoSans-Regular` folder for Latin-only glyphs is supported on disk — do not reference a comma-joined stack in styles.)

If those URLs **404** or return **HTML**, labels for that stack will fail.

## Practical generation options

### CI / local tooling

The repo wires **`.github/workflows/generate-glyphs.yml`** → **`linz/action-build-pbf-glyphs`** reading **`glyph-source/`** and emitting **`glyph-output/NotoSansMyanmar-Regular/`** (hyphen names, aligned with **`text-font`**).

### Manual references

Tooling evolves; alternatives include OpenMapTiles / **node-fontnik** forks. Outputs must land in **`apps/web/public/fonts/<exact text-font name>/`** with **hyphenated** stack names matching the JSON (**`NotoSansMyanmar-Regular`**, not **`Noto Sans Myanmar Regular`** with spaces unless you deliberately mirror that everywhere).

## Sanity checklist

1. Style root **`glyphs`** is **`/fonts/{fontstack}/{range}.pbf`** (`packages/map-style/base-map.json`).
2. **`text-font`** is a **single** string per symbol layer matching a subfolder (`NotoSansMyanmar-Regular`).
3. Ranges covering **Myanmar script** plus **ASCII/Latin** exist under **`NotoSansMyanmar-Regular/`** for mixed labels (Noto Myanmar includes Latin glyphs for typical road names).
4. Rebuild/serve `apps/web` and confirm DevTools shows **200** for glyph URLs, **`application/octet-stream`** or similar, **not** `text/html`.
