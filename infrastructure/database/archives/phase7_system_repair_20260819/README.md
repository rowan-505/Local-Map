# Phase 7 historical system-table archive

Production project: `locghyuranqaqsnbxflc`  
Created: 2026-08-19  
Format: PostgreSQL custom archive (`pg_dump -Fc --compress=9`)  
Archive: `system_repair_backup_tables.dump`  
SHA-256: `c7af4542944fcfe42cf8e3f80d8085bfc34a2020bde2fa9a110715e301152a35`  
Compressed size: approximately 3.1 MB  
Archive contents check: 25 table definitions and 25 `TABLE DATA` entries.

Restore into an isolated database only:

```sh
pg_restore --list system_repair_backup_tables.dump
pg_restore --dbname "$ISOLATED_DATABASE_URL" --no-owner --no-privileges system_repair_backup_tables.dump
```

Do not restore this archive directly over production. The historical repair helper function is retained in source at
`tools/data-repair/current-production/32b_township_major_overlap_high_apply_commit_20260724.sql`.

## Inventory at archive time

| Table | Rows | Total size |
|---|---:|---:|
| `backup_core_map_buildings_before_building_type_simplification` | 116 | 48 kB |
| `backup_ref_building_types_before_simplification` | 85 | 48 kB |
| `migration_156_water_class_anomalies` | 44 | 32 kB |
| `repair_admin_areas_before_202607` | 13 | 32 kB |
| `repair_admin_assign_pbl_20260724` | 2,853 | 416 kB |
| `repair_admin_assign_streets_20260724` | 14,827 | 2,224 kB |
| `repair_admin_links_before_202607` | 210,710 | 22 MB |
| `repair_dup_admin_areas_20260724` | 8 | 32 kB |
| `repair_dup_fk_backup_20260724` | 0 | 16 kB |
| `repair_final_fk_backup_20260724` | 56 | 64 kB |
| `repair_major_overlap_admin_areas_20260724` | 4 | 120 kB |
| `repair_major_overlap_apply_log_20260724` | 2 | 32 kB |
| `repair_remaining_admin_backup_20260722` | 0 | 16 kB |
| `repair_remaining_admin_queue_20260722` | 25,686 | 6,080 kB |
| `repair_remaining_road_backup_20260722` | 14 | 24 kB |
| `repair_review_backlog_before_202607` | 2,298 | 456 kB |
| `repair_shan_cluster_admin_areas_20260724` | 5 | 136 kB |
| `repair_shan_cluster_apply_log_20260724` | 2 | 24 kB |
| `repair_small_core_before_202607` | 26 | 32 kB |
| `repair_street_names_before_202607` | 0 | 16 kB |
| `repair_streets_attrs_before_202607` | 31,106 | 3,312 kB |
| `repair_streets_road_class_before_202607` | 340,801 | 41 MB |
| `repair_township_catalogue_reclass_20260724` | 9 | 32 kB |
| `repair_township_overlap_final_admin_areas_20260724` | 29 | 600 kB |
| `repair_township_overlap_final_apply_log_20260724` | 24 | 32 kB |
| **Total** | **628,718** | **80,715,776 bytes (77 MB)** |

## Validation summary

- Runtime repository references: none.
- Historical references: one-off repair scripts, old rollback/verification SQL, archived reports, and generated ERD only.
- Inbound/outbound foreign keys: zero.
- Dependent views/materialized views: zero.
- Triggers, policies, publications: zero.
- Catalog-bound functions: zero.
- Dynamic SQL references: one obsolete dated helper,
  `system.apply_overlap_full_to_keeper_20260724`, removed with its apply-log table.
- Remaining-admin queue pending rows: zero; all rows are terminal `unresolved` or `protected` outcomes.
- Final township-overlap log: all 24 rows `COMMITTED`.
- Current admin self-parent, missing-parent, and invalid-geometry checks: zero.
- Current building/water classification orphan checks: zero.
- The validated street road-class foreign key remains in place.

Normal lifecycle tables were explicitly excluded from both the archive/drop selection and the migration.
