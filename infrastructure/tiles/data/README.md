# Local tile source data (gitignored)

This directory is **intentionally ignored by Git**. It holds large, reproducible GIS downloads and build intermediates for offline PMTiles pipelines.

**Do not commit** anything here except this file and `.gitkeep`.

---

## Why this folder exists

Tile builds need local copies of:

- Natural Earth 1:10m shapefiles (overview basemap)
- MIMU Myanmar admin boundaries and P-code spreadsheets
- Clipped / converted GeoJSONSeq used by tippecanoe
- Temporary extraction and cache files

These files are too large for the repo and can be re-downloaded or regenerated from documented scripts.

---

## Expected local layout

Create these folders on your machine as needed:

```text
infrastructure/tiles/data/
  .gitkeep
  README.md                 ← only committed files in this tree

  natural-earth/            ← Natural Earth downloads
    *.zip                   ← source archives (gitignored)
    unzipped/               ← extracted shapefiles

  mimu/                     ← MIMU Myanmar admin data
    *.zip                   ← source archives (gitignored)
    *.xlsm                  ← P-code spreadsheets (gitignored)
    unzipped/               ← extracted shapefiles

  processed/                ← tippecanoe-ready GeoJSONSeq
    natural-earth/clipped/  ← output of clip-natural-earth-overview.sh
    mimu/                   ← mmr_admin0 / mmr_admin1 GeoJSONSeq

  tmp/                      ← optional scratch (safe to delete)
```

PMTiles outputs live under **`infrastructure/tiles/pmtiles/`** (also gitignored when `*.pmtiles`).

---

## What Git tracks

| Path | Committed? |
|------|------------|
| `infrastructure/tiles/data/.gitkeep` | Yes |
| `infrastructure/tiles/data/README.md` | Yes |
| Everything else under `data/` | **No** |
| `infrastructure/tiles/pmtiles/overview/regions/current.json` | Yes (pointer only) |
| `*.pmtiles`, shapefiles, ZIPs, GeoJSONSeq | **No** |

Root `.gitignore` rules: `/infrastructure/tiles/data/**` with exceptions for `.gitkeep` and this README.

---

## Related docs

- Overview build workflow: [`../pmtiles/overview/README.md`](../pmtiles/overview/README.md)
- Regional PostGIS PMTiles: [`../pmtiles/README.md`](../pmtiles/README.md)
- Tiles index: [`../README.md`](../README.md)
