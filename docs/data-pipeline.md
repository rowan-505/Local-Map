# Data pipeline

OSM and related imports run under `tools/data-pipeline/`. Local work first; production writes are explicit and guarded.

## Flow

```text
PBF → raw → staging → classify
  → safe_new / safe_update → direct-Core (regional, one family) or Import Review
  → conflict / protected → Import Review → promote → core
  → pmtiles_only → tiles only (never core / IR)
```

## Target safety

Use only these env names for pipeline DB targets:

| Variable | Role |
|----------|------|
| `LOCAL_DATABASE_URL` | Local lab |
| `SUPABASE_READ_DATABASE_URL` | Prod read |
| `SUPABASE_WRITE_DATABASE_URL` | Prod write |

Shared guards: `tools/data-pipeline/lib/database_target_safety.*`  
Tests: `./tools/data-pipeline/tests/database_target_safety_tests.sh`

## Import classes (Stage 08b)

| Class | Meaning |
|-------|---------|
| `safe_new` | Valid, no identity match |
| `safe_update` | Identity match; allow-listed fields only |
| `unchanged` | Same content |
| `duplicate` / `conflict` | Needs human review |
| `manual_protected` / `verified_conflict` | Do not auto-overwrite |
| `pmtiles_only` | Basemap only |
| `invalid` | Failed validation |
| `possible_delete` | Missing from new OSM extract |

## Core vs PMTiles (buildings / water / landuse)

**Core:** named or important features (schools, hospitals, landmarks, named parks/water, etc.).  
**PMTiles only:** ordinary unnamed footprints, farmland, forest, residential fill.

Never send `pmtiles_only` to Import Review or direct-Core.

### Land-area classification

Authoritative path:

`core.core_land_areas.land_area_class_id` → `ref.ref_land_area_classes.id` → `ref.ref_land_area_classes.code`

OSM imports must normalize tags to a stable CoreMap class code, resolve the ref id, then write `land_area_class_id`.  
`core.core_land_areas.class_code` is a **deprecated** compatibility mirror of `ref.code` only — not the source of truth for tiles, search, API category, or new imports.

### Protected areas (overlay)

Protected areas are **not** land cover and **not** ordinary parks. They live in:

`core.core_protected_areas.protected_area_class_id` → `ref.ref_protected_area_classes`

OSM `protect_class` / `designation` / `protection_title` stay in `source_tags`. Do not fold them into `core_land_areas`.

## National apply rules

1. One entity family per apply. Never multi-family national apply.
2. Prove regionally first (checklist in tools / archive ops source).
3. **Do not** apply OSM `admin_areas` into prod admin polygons.
4. Roads reload matches primarily by `external_id`; blank IDs go to review.

## Where to run

| Task | Start here |
|------|------------|
| Local OSM | `tools/data-pipeline/local-osm/README.md` |
| Direct-Core | `tools/data-pipeline/direct-core/README.md` |
| Full old policies | `docs/archive/ops-source-2026-08/` |

Historical apply logs: `docs/archive/osm-buildings-2026-07/` and `docs/archive/pipeline-inspections-2026-07/`.
