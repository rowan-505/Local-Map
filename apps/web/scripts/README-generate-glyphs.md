# Generating `.pbf` glyphs for Local Map (`apps/web`)

Map labels use **glyph PBF ranges**, not raw `.ttf` files at runtime. You must produce `.pbf` files and copy them into:

- `apps/web/public/fonts/Noto Sans Myanmar Regular/*.pbf`
- `apps/web/public/fonts/Noto Sans Regular/*.pbf`

(Paths and names must match the style’s `text-font` and the [`glyphs` URL](/fonts/{fontstack}/{range}.pbf) template.)

## Fonts to start from (you obtain these — do not commit unless license allows)

- **Noto Sans Myanmar Regular** — e.g. `NotoSansMyanmar-Regular.ttf` from [Noto Sans Myanmar](https://fonts.google.com/noto/specimen/Noto+Sans+Myanmar) (typically **SIL OFL**).
- **Noto Sans Regular** — e.g. `NotoSans-Regular.ttf` from [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) (**SIL OFL**).

Keep `.ttf` files outside the repo or in a local scratch directory unless your project explicitly allows committing them.

## What to generate

For each logical font stack, emit the standard **Unicode range** PBF filenames MapLibre expects, e.g.:

- `0-255.pbf`, `256-511.pbf`, … up through the code-point ranges you care about (Latin + Myanmar blocks at minimum).

A quick smoke test after the dev server is running:

```txt
http://localhost:5173/fonts/Noto%20Sans%20Myanmar%20Regular/4096-4351.pbf
```

(Spaces may appear URL-encoded as `%20`.)

If that URL 404s, labels for that stack will fail.

## Practical generation options

Tooling evolves; choose one workflow your team can maintain.

### Option A — OpenMapTiles font tooling (starting point)

The [openmaptiles/fonts](https://github.com/openmaptiles/fonts) repository documents how stacks of `.pbf` ranges are produced from font files. Adapt their pipeline so outputs land in the **`apps/web/public/fonts/<exact text-font name>/`** folders above.

### Option B — `node-fontnik` / glyph build utilities

[mapbox/node-fontnik](https://github.com/mapbox/fontnik) (or maintained forks / wrappers) can generate range PBFs from a `.ttf`. You typically script one directory per `{fontstack}` name.

**Note:** Native compilation may be required; use Node version and platform instructions from the chosen tool.

### Option C — Prebuilt stacks (only if licenses match)

Some projects publish packs of glyphs for named fonts; only use packs that legally match **Noto** and verify the **`fontstack` folder name** matches our style (`Noto Sans Myanmar Regular`, etc.).

## Sanity checklist

1. Style root `glyphs` is **`/fonts/{fontstack}/{range}.pbf`** (`packages/map-style/base-map.json`).
2. **`text-font`** uses **exact names** matching subfolders under `apps/web/public/fonts/`.
3. Ranges covering **Myanmar script** plus **digits / Latin** for mixed labels exist for **Noto Sans Myanmar Regular**.
4. Rebuild/serve `apps/web` and confirm the network panel shows **200** for glyph URLs, not 404.
