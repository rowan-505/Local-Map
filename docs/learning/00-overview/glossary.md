---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Domain terms used across CoreMap docs
---

# Glossary

| Term | Meaning |
|------|---------|
| **core** | Production-ready schema (`core.*` tables) — published map data |
| **staging** | Normalized import candidates before promotion |
| **raw** | Untouched OSM/source geometries keyed by snapshot |
| **import_review** | Supabase schema for remote review of staging uploads |
| **promotion** | Moving approved import_review rows into `core` |
| **core-review** | Dashboard/API CRUD on published `core` entities |
| **PMTiles** | Single-file static vector tile archive |
| **overview tile** | Low-zoom national context PMTile (z0–z8) |
| **regional tile** | OSM-derived basemap per state/region |
| **Martin** | PostGIS → MVT dynamic tile server |
| **public_id** | Stable external identifier for API responses |
| **confidence_score** | 0–100 quality/confidence scale (never 0–1) |
| **source_snapshot_version** | String identifying an import snapshot lineage |
| **Valhalla** | External routing engine for walk/drive/motorcycle |
| **YBS** | Yangon bus service — route viewing in V2, not live GPS |
| **Plus Code** | Open Location Code — supported in search |
| **AUTH_BYPASS** | Dev-only API flag; **ignored** on import-review routes |
| **ENTITY_FAMILIES** | Pipeline filter for which OSM families to import |

## Schema name quick reference

| Schema | Role |
|--------|------|
| `raw` | Source OSM archive |
| `staging` | Candidate normalization |
| `core` | Published entities |
| `ref` | Reference/lookup tables |
| `system` | Import batches, snapshots, diff workflow |
| `tiles` | PostGIS views for PMTiles export |
| `search` | Search index tables and rebuild functions |
| `app_auth` | Users, sessions, roles |
| `import_review` | Remote review workspace (often separate Supabase connection) |

## Related docs

- [Architecture](architecture.md)
- [Schemas and tables](../02-database/schemas-and-tables.md)
