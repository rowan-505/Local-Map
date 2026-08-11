# Entity-by-entity national prove-out checklist

Prove each family **regionally** before whole-country apply. Order is mandatory.

## Shared bar (every family)

1. Fresh `prod_mirror` refresh
2. Local pipeline through Stage 08c/08d + Stage 18 for that family only
3. Confirm `pmtiles_only` excluded from Import Review + direct-Core CSV (buildings/landuse/water)
4. IR conflict upload only if conflicts exist (`REMOTE_REVIEW_CONFLICT_ONLY=true`)
5. Export validated `safe_new` / `safe_update` CSV with production `admin_area_id`
6. Direct-Core regional transaction **dry-run** on production target
7. Direct-Core **apply** ≥1 000 rows **or** full single-township set
8. Identical rerun → zero inserts, updates, and duplicate names
9. Existing system import/publish metadata checked
10. Update `docs/national-import-final-authorization.md` per-family gate to PASS

## Order

| # | Family | Notes | Status |
|--:|---|---|---|
| 1 | places | Settlements + essential; Stage 08d settlement admin gate | PENDING prove-out |
| 2 | roads | Follow `docs/national-roads-osm-reload-policy.md` | PENDING prove-out |
| 3 | buildings | Core-eligible only; never full footprints | PENDING prove-out |
| 4 | landuse | Requires migration 147 applied on Supabase for IR admin column | PENDING prove-out |
| 5 | water_lines / water_polygons | After map families | PENDING prove-out |
| 6 | routing_barriers | After water; Valhalla rebuild if wider than pilot | PENDING prove-out |
| — | admin_areas | **Excluded** — see `docs/national-admin-osm-exclude.md` | EXCLUDED |

## Production apply note

Each apply is a production write. Confirm explicitly before `--apply`. Do not multi-family apply in one run.
