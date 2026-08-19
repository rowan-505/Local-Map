# Archived `admin_qa` township-gap artifacts

This directory preserves the complete contents of the seven dated production QA tables removed on 2026-08-19. They contained 23 rows and were historical QGIS/township-boundary repair working data, not current application state.

`data.json` contains every non-geometry column plus exact EWKB hex for each geometry (`geom_ewkb_hex` and, where present, `geom_fixed_ewkb_hex`). Restore geometry with `public.ST_GeomFromEWKB(decode(value, 'hex'))` after recreating the archived table definition from migration history/catalog documentation.

Archived row counts:

- `collect_data_gap_1`: 3
- `collect_data_gap_3`: 7
- `corrected_township_gap5_invalid_points`: 1
- `corrected_township_geometries_gap5`: 4
- `inserted_admin_area_ids_gap1`: 1
- `inserted_admin_area_ids_gap5`: 2
- `township_gap_polygons_qgis`: 5

The four removed views were derived objects and contain no independent data. Their definitions are recorded in `targeted-cleanup-audit-2026-08-19.md` and remain recoverable from production migration/catalog history.

Dependency checks found no application views, functions, triggers, policies, foreign keys, or tile functions depending on these objects. Repository references were limited to historical verification/introspection files. No secrets or authentication data are included in this archive.
