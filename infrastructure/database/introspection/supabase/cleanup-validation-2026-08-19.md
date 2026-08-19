# CoreMap production cleanup validation

Date: 2026-08-19  
Project: `locghyuranqaqsnbxflc` (`ACTIVE_HEALTHY`, PostgreSQL 17.6)  
Mode: read-only production validation; no migration or schema mutation was run.

## Result

The cleanup preserved production Core geometry and live domain relationships.
Application and dashboard production builds pass. The final status is **PASS
WITH KNOWN EXCEPTIONS** because two old fare FKs remain catalog-unvalidated,
three unused legacy tile functions reference retired views, and broad repository
test suites contain fixture drift described below.

## Before

The committed pre-cleanup ERD and cleanup archives provide the structural
baseline:

| Metric | Before |
|---|---:|
| Inspected schemas | 26 |
| Base/partitioned tables | 205 |
| Views/materialized views | 48 |
| Table + view columns | 3,617 |
| Indexes | 1,019 (reconstructed from removed and added objects) |
| `core.core_streets` total | approximately 4.28 GB |
| `core.core_streets` indexes | approximately 1.58 GB |
| Dated system artifacts | 80,715,776 bytes (77 MB) |

No authoritative whole-database byte snapshot was captured immediately before
the cleanup. An exact whole-database storage delta therefore cannot be claimed.
The street figures above are the recorded approximate pre-cleanup values.

## Removed

### Tables

Twenty-eight tables were removed.

Archived system history (25):

- `system.backup_core_map_buildings_before_building_type_simplification`
- `system.backup_ref_building_types_before_simplification`
- `system.migration_156_water_class_anomalies`
- `system.repair_admin_areas_before_202607`
- `system.repair_admin_assign_pbl_20260724`
- `system.repair_admin_assign_streets_20260724`
- `system.repair_admin_links_before_202607`
- `system.repair_dup_admin_areas_20260724`
- `system.repair_dup_fk_backup_20260724`
- `system.repair_final_fk_backup_20260724`
- `system.repair_major_overlap_admin_areas_20260724`
- `system.repair_major_overlap_apply_log_20260724`
- `system.repair_remaining_admin_backup_20260722`
- `system.repair_remaining_admin_queue_20260722`
- `system.repair_remaining_road_backup_20260722`
- `system.repair_review_backlog_before_202607`
- `system.repair_shan_cluster_admin_areas_20260724`
- `system.repair_shan_cluster_apply_log_20260724`
- `system.repair_small_core_before_202607`
- `system.repair_street_names_before_202607`
- `system.repair_streets_attrs_before_202607`
- `system.repair_streets_road_class_before_202607`
- `system.repair_township_catalogue_reclass_20260724`
- `system.repair_township_overlap_final_admin_areas_20260724`
- `system.repair_township_overlap_final_apply_log_20260724`

Unused structures (3):

- `search.search_names`
- `search.search_addresses`
- `transport.route_unification_plan`

The system archive contains 628,718 historical rows. The route-unification
archive contains all 98 applied plan rows.

### Columns

Seven columns were removed:

- `core.core_buildings.source_staging_id`
- `core.core_land_areas.source_staging_id`
- `core.core_water_lines.source_staging_id`
- `core.core_water_polygons.source_staging_id`
- `core.core_land_areas.class_code`
- `core.core_water_lines.class_code`
- `core.core_water_polygons.class_code`

### Indexes

Twelve standalone redundant indexes were removed:

- `core.core_streets_active_idx`
- `transport.transport_route_stops_stop_id_idx`
- `transport.route_stops_timing_idx`
- `transport.transport_route_stops_variant_sequence_idx`
- `core.core_streets_updated_at_idx`
- `core.core_streets_updated_at_desc_idx`
- `core.core_streets_deleted_at_updated_at_desc_idx`
- `core.core_streets_is_active_updated_at_desc_idx`
- `core.core_streets_external_id_idx`
- `core.core_streets_external_id_promote_idx`
- `core.core_streets_is_active_idx`
- `core.core_streets_edit_status_idx`

Removing the 28 tables also removed 39 table-owned indexes. Five selective FK
indexes were later added, giving a net reduction of 46 indexes.

Production confirms that no removed table, column, or standalone index remains.

## Deprecated but kept

| Object | Reason retained |
|---|---|
| `core.core_streets.road_class` | Large-table compatibility mirror; authoritative value is `road_class_id -> ref.ref_road_classes`. |
| `core.core_streets.is_oneway` | Compatibility mirror derived by trigger from `travel_direction`. |
| Core `is_verified` columns | Compatibility mirrors derived by nine triggers from `verification_status`. |
| `core.core_streets.edit_status` | Legacy per-row lifecycle field; not authoritative. |
| `core.core_streets.routing_status` | Legacy per-row routing state; build state belongs in routing build/job tables. |
| `core.core_buildings.name` | Compatibility cache; authoritative names are in `core_building_names`. |
| `core.core_land_areas.name` | Compatibility cache; authoritative names are in `core_land_area_names`. |
| `core.core_water_lines.name` | Compatibility cache; authoritative names are in `core_water_line_names`. |
| `core.core_water_polygons.name` | Compatibility cache; authoritative names are in `core_water_polygon_names`. |
| `search.address_index` | Valid address-search infrastructure; currently empty because `core.core_addresses` is empty. |

There are zero current `is_oneway`/direction mismatches and zero
`is_verified`/verification-status mismatches.

## After

### Structure and storage

| Metric | After | Change |
|---|---:|---:|
| Schemas | 26 | 0 |
| Tables | 177 | -28 |
| Views/materialized views | 48 | 0 |
| Table + view columns | 3,350 | -267 |
| Indexes | 973 | -46 net |
| Database size | 5,663,067,283 bytes (5.663 GB / 5.274 GiB) | Exact pre-cleanup DB bytes unavailable |
| User-table total size | 5,641,822,208 bytes | — |
| User index size | 1,915,699,200 bytes (1.916 GB) | Exact global pre-cleanup bytes unavailable |
| `core.core_streets` total | 4,230,725,632 bytes (4.231 GB) | about 49 MB below recorded approximate baseline |
| `core.core_streets` indexes | 1,393,606,656 bytes (1.394 GB) | about 186 MB / 11.8% below recorded approximate baseline |
| `core.core_streets` indexes | 21 | consolidated |

### Core row and geometry counts

The principal pre/post cleanup candidates match the last verified cleanup
baseline exactly:

| Table | Rows | Stored primary geometry | Invalid | Empty | Wrong SRID |
|---|---:|---:|---:|---:|---:|
| `core.core_streets` | 823,013 | 823,013 | 0 | 0 | 0 |
| `core.core_buildings` | 23,828 | 23,828 | 0 | 0 | 0 |
| `core.core_land_areas` | 23,615 | 23,615 | 0 | 0 | 0 |
| `core.core_water_lines` | 51,232 | 51,232 | 0 | 0 | 0 |
| `core.core_water_polygons` | 19,371 | 19,371 | 0 | 0 | 0 |
| `core.core_admin_areas` | 2,518 | 2,518 | 0 | 0 | 0 |
| `core.core_places` | 65,750 | 65,750 points | 0 | 0 | 0 |
| `core.core_protected_areas` | 136 | 136 | 0 | 0 | 0 |
| `core.core_coastlines` | 1 | 1 | 0 | 0 | 0 |
| `core.core_street_versions` | 15,663 | 15,663 | 0 | 0 | 0 |

Across all 59 physical geometry columns, 1,176,852 non-null geometries were
checked: invalid 0, empty 0. All Core geometries use SRID 4326.

Phase 174 intentionally changed only four audited street
`travel_direction` values. Phase 175 intentionally inserted missing
normalized name rows. Neither operation changed geometry.

### Integrity and functional checks

| Check | Result |
|---|---|
| Index validity | PASS — 0 invalid or not-ready indexes |
| Foreign keys | PARTIAL — 300/302 catalog-validated |
| FK data integrity | PASS — the two unvalidated fare FKs have 0 orphan values across 142 fares |
| Views | PASS — all 48 compile with `LIMIT 0` |
| Modern tile views | PASS — all 19 execute and return successfully |
| Application function paths | PASS — 85 functions have fixed paths |
| Legacy tile functions | FAIL — three unused functions reference missing legacy views |
| Search | PASS — 28,982 public active documents, 41,067 names; live Yangon query returned expected results |
| Routing | PASS — 2,258 barriers and 1,658 turn restrictions, valid geometry and no missing street relationships |
| Transport | PASS — 215 routes, 361 variants, 18,117 route stops, 11,461 stops, 3,832 terminals, 300 paths |
| Transport sequence integrity | PASS — 0 duplicate variant/sequence pairs; 0 missing stop/variant relations |
| Import review DB flow | PASS — 5 batches, 1,737 candidates, helper functions execute, 0 actor orphans |
| Auth DB integrity | PASS — 11 users, 67 sessions, 29 live sessions, 0 user/session/role orphans |
| Client-role isolation | PASS — anon/authenticated have 0 schema, table, or function access to private schemas |
| Production health | PASS — active/healthy, 0 waiting locks, 0 other active queries after validation |

### Repository checks

- Prisma schema validation: PASS.
- Fastify API production TypeScript build: PASS.
- Dashboard production build: PASS, including 84 generated pages.
- Main API/transport suite: PASS (349 passed, 1 environment-dependent skip).
- Focused auth/import-review compatibility tests: PASS (39/39).
- Full search suite: PASS after freezing the time-dependent health fixture to
  its intended contract date.
- Broad import-review test glob: PASS (687 passed, 1 explicitly opted-in
  live-write smoke skipped). Mocks now expose the current Prisma contract;
  water and name fixtures use normalized IDs and typed localized names.
- A real login was not executed because login creates/updates session and
  last-login state and would violate this read-only validation.

## Remaining technical debt

1. The two `transport.fares` stop foreign keys are now validated and remain
   data-clean (migration 187).
2. The three broken legacy `tiles.get_*_tile(integer, integer, integer)`
   functions are removed with `RESTRICT`; all current tile views compile
   (migration 188).
3. Three exact duplicate advisor indexes were removed after dependency and
   plan inspection (migration 189), reclaiming 240 KiB directly.
4. Remaining advisor findings are classified individually in
   `advisor-review-2026-08-19.md`. Do not drop the 461 currently reported
   unused indexes merely from `idx_scan=0`, and do not add all 112 reported FK
   indexes blindly.
5. The security advisor still reports private tables with RLS enabled but no
   policies. This is intentional for the Fastify-only access architecture; no
   permissive client policies should be added.

## Documentation artifacts

- Production ERD: `infrastructure/database/introspection/supabase/erd/current.mmd`
- This validation report:
  `infrastructure/database/introspection/supabase/cleanup-validation-2026-08-19.md`
- Historical system archive:
  `infrastructure/database/archives/phase7_system_repair_20260819/`
- Route-unification archive:
  `infrastructure/database/archives/unused_structures_20260819/`
