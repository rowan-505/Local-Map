# Import Review Entity Coverage Matrix

Maintainable coverage report for multi-entity import review: **local staging → Supabase `import_review` → core promotion**.

**Scope:** inspection and planning only. This document does not modify data, promote rows, or change pipeline logic.

**Related artifacts**

| Artifact | Purpose |
|----------|---------|
| [`tools/data-pipeline/local-osm/15_entity_coverage_report.sql`](../../tools/data-pipeline/local-osm/15_entity_coverage_report.sql) | Live row counts and data-quality metrics (run against local DB; optional `import_review` on same connection) |
| [`tools/data-pipeline/local-osm/README_REMOTE_REVIEW.md`](../../tools/data-pipeline/local-osm/README_REMOTE_REVIEW.md) | Stages J–L lineage contract (buildings / places / roads today) |
| [`infrastructure/database/migrations/supabase/024_create_import_review_schema.sql`](../../infrastructure/database/migrations/supabase/024_create_import_review_schema.sql) | Supabase `import_review.*` DDL |
| [`infrastructure/database/docs/staging_to_core_mapping.md`](../../infrastructure/database/docs/staging_to_core_mapping.md) | Promotion rules (partial; buildings/landuse/water not yet documented) |
| [`apps/api/docs/import-review-auth.md`](../../apps/api/docs/import-review-auth.md) | API auth for import review |

**Last reviewed:** 2026-05-20 (static layer). Refresh row counts by running Stage 15 SQL.

---

## How to read this matrix

Each row is one **staging candidate table** (21 total). Columns describe the full path from pipeline staging through remote review to core.

| Column | Meaning |
|--------|---------|
| **Local staging table** | `staging.staging_*_candidates` on the pipeline host |
| **Local row count** | Rows for the active `snapshot_version` — from Stage 15 SQL, not this doc |
| **import_review table** | Supabase mirror table, or `—` if no DDL / no exporter yet |
| **Core target(s)** | Primary `core.*` or `routing.*` tables after promotion |
| **Child / name tables** | Staging and core tables that travel with the parent entity |
| **Geometry** | Expected PostGIS type(s) on staging (SRID 4326) |
| **Required ref** | `ref.*` or parent staging FK needed for valid promotion |
| **API support** | Implemented `/api/import-review/*` capabilities |
| **Dashboard support** | Implemented admin UI under `/import-review` and `/data-review` |
| **Pipeline J/K** | Stage 11 package exporter + Stage 12 Supabase upload |
| **Risk** | Promotion / routing blast radius if done wrong |
| **Priority** | Recommended implementation order (see [Priority roadmap](#priority-roadmap)) |

**API / dashboard legend**

- **none** — not implemented
- **list** — paginated candidate list
- **detail** — single-candidate GET (API) or drawer panel (dashboard)
- **decision** — approve / reject / bulk-decision
- **override** — `review_overrides` PATCH
- **validate** — pre-promotion or routing validation
- **promote** — batch validate + promote to `core.*`
- **edit** — overrides or notes in UI
- **map** — geometry preview in drawer or map-first layout
- **promotion** — promotion workflow UI (batches, validate, promote)

---

## Priority roadmap

Recommended order for extending review-ready upload and promotion. Comments match Stage 15 SQL header.

| Phase | Entity families | Rationale |
|-------|-----------------|-----------|
| **Done** | Buildings | End-to-end: Stage J/K upload, dashboard review, API promotion → `core.core_map_buildings` |
| **Next** | Places | Review UI exists; needs Stage J/K exporter + promotion path; child name rows |
| **Then** | Landuse, water lines, water polygons | Map-layer geometry; low relational complexity; `import_review` DDL exists |
| **Then** | Bus stops | Point POIs; moderate complexity; names + admin linkage |
| **Later** | Roads | Review UI + routing validation exist; **defer promotion** until graph impact is understood |
| **Later** | Admin areas, addresses | Hierarchy / addressing rules; child tables |
| **Last** | Bus routes (variants, stops), routing (barriers, turn restrictions, routing roads) | Highest graph and consistency risk |

---

## Master coverage table

Static snapshot (2026-05-20). **Local row count** comes from Stage 15 SQL at runtime.

| Entity family | Staging table | import_review | Core target(s) | Geometry | Ref | API | Dashboard | J/K | Risk | Priority |
|---------------|---------------|---------------|----------------|----------|-----|-----|-----------|-----|------|----------|
| Places | `staging_place_candidates` | `place_candidates` | `core.core_places` | Point | place_classes, poi_categories | list, decision | list, detail, edit, map | yes | medium | **P1** |
| Place names | `staging_place_name_candidates` | — | `core.core_place_names` | — | place FK | none | none | no | medium | P1 |
| Buildings | `staging_building_candidates` | `building_candidates` | `core.core_map_buildings` | MultiPolygon | class_code | list, detail, decision, override, validate, **promote** | list, detail, edit, map, **promotion** | yes | low | **P0 done** |
| Landuse | `staging_landuse_candidates` | `landuse_candidates` | `core.core_map_landuse` | MultiPolygon | — | none | none | placeholder | low | **P2** |
| Water lines | `staging_water_line_candidates` | `water_line_candidates` | `core.core_map_water_lines` | MultiLineString | — | none | none | placeholder | low | **P2** |
| Water polygons | `staging_water_polygon_candidates` | `water_polygon_candidates` | `core.core_map_water_polygons` | MultiPolygon | — | none | none | placeholder | low | **P2** |
| Roads | `staging_road_candidates` | `road_candidates` | `core.core_streets` | MultiLineString | road_classes | list, decision, override, validate | list, detail, edit, map | yes (no promote) | high | **P4** |
| Road names | `staging_road_name_candidates` | — | `core.core_street_names` | — | road FK | none | none | no | medium | P4 |
| Admin areas | `staging_admin_area_candidates` | `admin_area_candidates` | `core.core_admin_areas` | MultiPolygon + centroid | admin_levels | none | none | placeholder | medium | P5 |
| Admin names | `staging_admin_area_name_candidates` | — | `core.core_admin_area_names` | — | admin FK | none | none | no | medium | P5 |
| Bus stops | `staging_bus_stop_candidates` | `bus_stop_candidates` | `core.core_bus_stops` | Point | admin (opt) | none | none | placeholder | medium | **P3** |
| Bus stop names | `staging_bus_stop_name_candidates` | — | `core.core_bus_stop_names` | — | stop FK | none | none | no | medium | P3 |
| Bus routes | `staging_bus_route_candidates` | `bus_route_candidates` | `core.core_bus_routes` | LineString | — | none | none | no | high | P6 |
| Bus route names | `staging_bus_route_name_candidates` | — | `core.core_bus_route_names` | — | route FK | none | none | no | medium | P6 |
| Bus route variants | `staging_bus_route_variant_candidates` | `bus_route_variant_candidates` | `core.core_bus_route_variants` | MultiLineString | route FK | none | none | no | high | P6 |
| Bus route stops | `staging_bus_route_stop_candidates` | `bus_route_stop_candidates` | `core.core_bus_route_stops` | Point (opt) | variant + stop FK | none | none | no | high | P6 |
| Addresses | `staging_address_candidates` | `address_candidates` | `core.core_addresses` | Point | component types | none | none | placeholder | medium | P5 |
| Address components | `staging_address_component_candidates` | — | `core.core_address_components` | — | address FK | none | none | no | medium | P5 |
| Routing roads | `staging_routing_road_candidates` | — | `core.core_streets`, `routing.road_edges` | LineString + MultiLineString | road FK | none | none | no | high | P7 |
| Routing turn restrictions | `staging_routing_turn_restriction_candidates` | `routing_turn_restriction_candidates` | `routing.turn_restrictions` | — | — | none | none | no | high | P7 |
| Routing barriers | `staging_routing_barrier_candidates` | `routing_barrier_candidates` | (no core DDL) | Point + Geometry | — | none | none | placeholder | high | P7 |

---

### Places

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_place_candidates` |
| Local row count | *run Stage 15* |
| import_review table | `import_review.place_candidates` |
| Core target(s) | `core.core_places` |
| Child / name tables | Staging: `staging_place_name_candidates` → Core: `core.core_place_names`, `core.core_place_sources`, `core.core_place_versions` |
| Geometry | `point_geom` Point; optional `footprint_geom` |
| Required ref | `ref.ref_place_classes`, `ref.ref_poi_categories`; optional `staging_admin_area_candidates` |
| API | list, decision |
| Dashboard | list, detail (drawer), edit (decision/note), map |
| Pipeline J/K | **implemented** |
| Risk | **medium** (names, admin linkage, versioning) |
| Priority | **P1 — next** |

### Place names (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_place_name_candidates` |
| import_review table | `—` (embedded in parent `normalized_data` / future child upload) |
| Core target(s) | `core.core_place_names` |
| Geometry | none |
| Required ref | FK `place_candidate_id` |
| API / Dashboard / Pipeline J/K | **none** |
| Risk | medium |
| Priority | P1 (with places) |

---

### Buildings

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_building_candidates` |
| import_review table | `import_review.building_candidates` |
| Core target(s) | `core.core_map_buildings` (+ `core.core_place_buildings` when linked) |
| Child / name tables | — |
| Geometry | `geom` MultiPolygon |
| Required ref | `class_code` (no ref FK in baseline) |
| API | list, detail, decision, override, validate (batch), **promote** |
| Dashboard | list, detail, edit, map, **promotion** |
| Pipeline J/K | **implemented** |
| Risk | **low** (reference implementation) |
| Priority | **P0 — done** |

---

### Landuse

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_landuse_candidates` |
| import_review table | `import_review.landuse_candidates` |
| Core target(s) | `core.core_map_landuse` |
| Child / name tables | — |
| Geometry | `geom` MultiPolygon |
| Required ref | snapshot only |
| API / Dashboard | **none** |
| Pipeline J/K | placeholder (Stage 11 manifest) |
| Risk | **low** |
| Priority | **P2** |

---

### Water lines

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_water_line_candidates` |
| import_review table | `import_review.water_line_candidates` |
| Core target(s) | `core.core_map_water_lines` |
| Geometry | `geom` MultiLineString |
| API / Dashboard / Pipeline J/K | **none** / placeholder |
| Risk | **low** |
| Priority | **P2** |

### Water polygons

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_water_polygon_candidates` |
| import_review table | `import_review.water_polygon_candidates` |
| Core target(s) | `core.core_map_water_polygons` |
| Geometry | `geom` MultiPolygon |
| API / Dashboard / Pipeline J/K | **none** / placeholder |
| Risk | **low** |
| Priority | **P2** |

---

### Roads

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_road_candidates` |
| import_review table | `import_review.road_candidates` |
| Core target(s) | `core.core_streets` |
| Child / name tables | Staging: `staging_road_name_candidates` → Core: `core.core_street_names`, `core.core_street_versions` |
| Geometry | `geom` MultiLineString |
| Required ref | `ref.ref_road_classes` |
| API | list, decision, override, validate (routing) |
| Dashboard | list, detail, edit, map |
| Pipeline J/K | **implemented** (upload only; no core promotion) |
| Risk | **high** (routing graph, oneway, turn restrictions) |
| Priority | **P4 — later** |

### Road names (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_road_name_candidates` |
| import_review table | `—` |
| Core target(s) | `core.core_street_names` |
| API / Dashboard / Pipeline J/K | **none** |
| Risk | medium |
| Priority | P4 (with roads) |

---

### Admin areas

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_admin_area_candidates` |
| import_review table | `import_review.admin_area_candidates` |
| Core target(s) | `core.core_admin_areas` |
| Child / name tables | Staging: `staging_admin_area_name_candidates` → Core: `core.core_admin_area_names` |
| Geometry | `geom` MultiPolygon; `centroid` Point |
| Required ref | `ref.ref_admin_levels`; self-FK `parent_candidate_id` |
| API / Dashboard / Pipeline J/K | **none** / placeholder |
| Risk | **medium** (hierarchy, parent ordering) |
| Priority | **P5** |

### Admin area names (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_admin_area_name_candidates` |
| import_review table | `—` |
| Core target(s) | `core.core_admin_area_names` |
| API / Dashboard / Pipeline J/K | **none** |
| Priority | P5 |

---

### Bus stops

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_bus_stop_candidates` |
| import_review table | `import_review.bus_stop_candidates` |
| Core target(s) | `core.core_bus_stops` |
| Child / name tables | Staging: `staging_bus_stop_name_candidates` → Core: `core.core_bus_stop_names` |
| Geometry | `point_geom` Point |
| Required ref | optional `staging_admin_area_candidates` |
| API / Dashboard / Pipeline J/K | **none** / placeholder |
| Risk | **medium** |
| Priority | **P3** |

### Bus stop names (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_bus_stop_name_candidates` |
| import_review table | `—` |
| Core target(s) | `core.core_bus_stop_names` |
| API / Dashboard / Pipeline J/K | **none** |
| Priority | P3 |

---

### Bus routes

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_bus_route_candidates` |
| import_review table | `import_review.bus_route_candidates` |
| Core target(s) | `core.core_bus_routes` |
| Child / name tables | Staging: `staging_bus_route_name_candidates`, `staging_bus_route_variant_candidates`, `staging_bus_route_stop_candidates` → Core: `core.core_bus_route_names`, `core.core_bus_route_variants`, `core.core_bus_route_stops` |
| Geometry | `geom` LineString (route row) |
| API / Dashboard / Pipeline J/K | **none** (Stage 11 manifest has no bus_routes exporter) |
| Risk | **high** (variants, stop sequences) |
| Priority | **P6** |

### Bus route names (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_bus_route_name_candidates` |
| import_review table | `—` |
| Core target(s) | `core.core_bus_route_names` |
| Priority | P6 |

### Bus route variants (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_bus_route_variant_candidates` |
| import_review table | `import_review.bus_route_variant_candidates` |
| Core target(s) | `core.core_bus_route_variants` |
| Geometry | `geom` MultiLineString |
| Pipeline J/K | **none** |
| Priority | P6 |

### Bus route stops (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_bus_route_stop_candidates` |
| import_review table | `import_review.bus_route_stop_candidates` |
| Core target(s) | `core.core_bus_route_stops` |
| Geometry | optional `point_geom` Point |
| Priority | P6 |

---

### Addresses

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_address_candidates` |
| import_review table | `import_review.address_candidates` |
| Core target(s) | `core.core_addresses`, `core.core_place_addresses` |
| Child / name tables | Staging: `staging_address_component_candidates` → Core: `core.core_address_components` |
| Geometry | `point_geom` Point; optional `geom` |
| Required ref | `ref.ref_address_component_types` (at core for components) |
| API / Dashboard / Pipeline J/K | **none** / placeholder |
| Risk | **medium** |
| Priority | **P5** |

### Address components (child)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_address_component_candidates` |
| import_review table | `—` |
| Core target(s) | `core.core_address_components` |
| Geometry | none |
| Priority | P5 |

---

### Routing — roads (derived)

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_routing_road_candidates` |
| import_review table | `—` (promotes indirectly via streets / `routing.road_edges`) |
| Core target(s) | `core.core_streets`; graph: `routing.road_edges`, `routing.road_nodes` |
| Geometry | `geom` LineString; `geom_multi` MultiLineString |
| Required ref | FK `road_candidate_id` → `staging_road_candidates` |
| API / Dashboard / Pipeline J/K | **none** |
| Risk | **high** |
| Priority | **P7** (after road promotion design) |

### Routing — turn restrictions

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_routing_turn_restriction_candidates` |
| import_review table | `import_review.routing_turn_restriction_candidates` |
| Core target(s) | `routing.turn_restrictions` |
| Geometry | none on staging (relation IDs); optional `geom` on `import_review` |
| API / Dashboard / Pipeline J/K | **none** |
| Risk | **high** |
| Priority | **P7** |

### Routing — barriers

| Field | Value |
|-------|-------|
| Local staging table | `staging.staging_routing_barrier_candidates` |
| import_review table | `import_review.routing_barrier_candidates` |
| Core target(s) | `core_routing_barriers` referenced in Stage 07 prod mirror only — **no baseline core DDL in repo** |
| Geometry | `point_geom` Point; optional `geom` |
| API / Dashboard / Pipeline J/K | **none** / placeholder |
| Risk | **high** |
| Priority | **P7** |

---

## Pipeline stage coverage (summary)

| Stage | Families covered |
|-------|------------------|
| **05** raw → staging | All 21 candidate tables (+ 2 search index tables) |
| **08** assign statuses | 11 primary (excludes bus route variant/stop, routing_road/turn, name children) |
| **09 / 10** review views & summary | 10 primary (excludes bus_routes, routing_road/turn) |
| **11 J** remote review package | **Implemented:** buildings, places, roads — **Placeholders:** bus_stops, landuse, water_*, addresses, admin_areas, routing_barriers |
| **12 K** Supabase upload | buildings, places, roads only |
| **API promotion** | buildings only |

---

## Running the coverage SQL report

See [Stage 15 command](#stage-15-command) at the end of this doc.

**Sections emitted by `15_entity_coverage_report.sql`**

| Section | Description |
|---------|-------------|
| `stage15_entity_manifest` | Static mapping row per staging table (geometry, import_review, core, priority) |
| `stage15_staging_row_counts` | Row counts filtered by `snapshot_version` |
| `stage15_data_quality_gaps` | Missing `source_refs`, `normalized_data`, `external_id`, geometry |
| `stage15_review_status_counts` | Grouped `review_status` (when column exists) |
| `stage15_match_status_counts` | Grouped `match_status` |
| `stage15_auto_action_counts` | Grouped `auto_action` |
| `stage15_import_review_row_counts` | Counts from `import_review.*` if schema exists on connection |
| `stage15_warnings` | Missing tables, skipped metrics |

**Supabase-only counts:** Stage 15 targets the **local** pipeline database by default. For `import_review` row counts on Supabase, either run the same file with `SUPABASE_DATABASE_URL` (staging sections will warn as missing) or query `import_review.*` directly in the SQL Editor.

---

## Stage 15 command

From the repo root (requires `LOCAL_DATABASE_URL` and a valid `snapshot_version`):

```bash
cd tools/data-pipeline/local-osm
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v staging_schema="${STAGING_SCHEMA:-staging}" \
  -v import_review_schema="${IMPORT_REVIEW_SCHEMA:-import_review}" \
  -f ./15_entity_coverage_report.sql
```

Optional: point at Supabase for `import_review` sections only (staging warnings expected):

```bash
PAGER=cat psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -f ./15_entity_coverage_report.sql
```

---

## Maintaining this document

1. After each pipeline or import-review release, run Stage 15 and paste key row counts into your release notes (not into this file — keep counts in SQL output).
2. When adding an entity to Stage 11/12, update **Pipeline J/K** and **Priority** columns here.
3. When adding API routes or dashboard pages, update **API** and **Dashboard** columns.
4. When adding `import_review` tables or core promotion, update **import_review table** and **Core target(s)**.
5. Keep promotion rules in `staging_to_core_mapping.md` in sync with new families.
