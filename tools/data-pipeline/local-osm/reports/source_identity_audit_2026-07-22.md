# Source identity audit — 2026-07-22

**Project:** Supabase `locghyuranqaqsnbxflc`  
**Script:** `tools/data-pipeline/local-osm/16_source_identity_audit.sql`  
**Mode:** read-only (`BEGIN` … `ROLLBACK`; pg_temp helpers only)  
**Core writes:** none

## Summary

Production OSM-linked rows almost all use **legacy short** ids (`osm:N|W|R:<id>`).  
Canonical long form (`osm:node|way|relation:<id>`) count is **0** today.

Decision for pipeline repair:

- New local-osm staging / packages emit **canonical long** ids.
- Production rows keep legacy short ids (no national rewrite).
- Stage 07 F2 matching uses `pipeline_osm_identity_key()` so both forms match.

## Counts (active rows)

| family | total | canonical | legacy | null | other | duplicate identity keys |
|--------|------:|----------:|-------:|-----:|------:|------------------------:|
| roads | 823006 | 0 | 822520 | 486 | 0 | 0 |
| admin_areas | 2518 | 0 | 2503 | 14 | 1 | 0 |
| places | 265 | 0 | 35 | 230 | 0 | 0 |
| buildings | 1075 | 0 | 953 | 106 | 16 | 0 |
| landuse | 38 | 0 | 30 | 2 | 6 | 0 |
| water_lines | 1 | 0 | 0 | 0 | 1 | 0 |
| water_polygons | 9 | 0 | 0 | 0 | 9 | 0 |
| routing_barriers | 0 | 0 | 0 | 0 | 0 | 0 |

## Per-family notes

| family | Source columns | Type retained? | Unique constraint | Duplicate risk | Compatibility |
|--------|----------------|----------------|-------------------|----------------|---------------|
| roads | `external_id`, `source_refs` | yes via `osm:W:` | unique on `external_id` | low | adapter matches `osm:way:` ↔ `osm:W:` |
| admin_areas | `external_id`, `source_refs` | yes via `osm:R:` / rare `osm:W:` | unique on `external_id` | low | adapter; 14 null kept |
| places | `external_id`, `source_refs` | yes when set | index only | medium if bulk insert without unique | many null manual rows |
| buildings | `external_id`, `source_refs` | mostly `osm:W:` | index only | medium | 16 bare numeric / non-osm “other” |
| landuse | `external_id`, `source_refs` | when set | index only | medium | 6 other (bare ids / dashboard) |
| water_lines | `external_id`, `source_refs` | no usable OSM id today | index only | n/a thin | other / non-canonical |
| water_polygons | `external_id`, `source_refs` | no usable OSM id today | index only | n/a thin | other / non-canonical |
| routing_barriers | `source_refs` only | n/a (empty table) | n/a | n/a | staging still emits canonical `external_id` |

## Adapter smoke (from audit)

| check | result |
|-------|--------|
| `osm:node:123` | ok |
| `osm:way:123` | ok |
| `osm:relation:123` | ok |
| `osm:way:123` ↔ `osm:W:123` | match |
| `osm:node:123` ↔ `osm:W:123` | no match (no type collision) |

## Migration vs adapter

| Option | Chosen? | Reason |
|--------|---------|--------|
| Rewrite 823k street `external_id` values | **No** | unnecessary risk; breaks no-op only if compare is exact-string |
| Shared formatter + compare adapter | **Yes** | smallest safe path; production remains matchable |

Re-run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/local-osm/16_source_identity_audit.sql
```
