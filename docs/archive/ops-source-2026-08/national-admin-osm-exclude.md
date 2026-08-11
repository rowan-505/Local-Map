# Exclude admin_areas from national OSM apply — 2026-07-28

## Decision

**Do not** load OSM `admin_areas` into production `core.core_admin_areas` via national OSM import.

- The approved direct-Core family list intentionally excludes `admin_areas`.
- Production operational township set (**364**) + migrations **145/146** are the assign truth for entity `admin_area_id`.
- Polygon refresh / hierarchy repair stays in `tools/data-repair/` and `admin-hierarchy-repair`, not OSM national apply.

## Pipeline behavior

| Stage | Allowed? |
|---|---|
| Local classify Stage 05–18 for `admin_areas` | Yes (awareness / reports only) |
| Stage 08c prod admin assign | N/A (admin polygons are the source, not targets) |
| Stage 11–12 IR upload of national admin candidates | **No** unless separately authorized |
| Direct-Core apply | **No** — family intentionally unsupported |

## Enforcement

- National entity import runbook sets `ENTITY_FAMILIES` **without** `admin_areas` for apply paths.
- Dry-run may include `admin_areas` in classify batches for volume awareness only.
- Stage J default `REMOTE_REVIEW_CONFLICT_ONLY=true` must not be used to back-door national admin apply.
