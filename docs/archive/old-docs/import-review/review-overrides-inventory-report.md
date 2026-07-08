---
status: archived
reason: replaced by docs/archive/old-docs/import-review/review-overrides-inventory-report.md
archived_at: 2026-07-01
---

# Import-review `review_overrides` inventory report (Phase 0)

**Status:** Phase 1 archive **applied** (migration 082); Phase 2 blocked on road geom triage  
**Generated:** 2026-06-02  
**Phase 1 applied:** 2026-06-02 via `082_import_review_review_overrides_archive.sql` (HS-1 passed all 14 tables)  
**Phase 1b applied:** 2026-06-02 via `082a_import_review_review_column_alignment.sql` (column verify passed)  
**Script:** [infrastructure/database/migrations/import-review/000_review-overrides-inventory.sql](../../infrastructure/database/migrations/import-review/000_review-overrides-inventory.sql)  
**Scope:** `review_batch_id = 0` (all batches)  
**Database:** Supabase import_review (via `apps/api/.env` `DATABASE_URL`, session port 5432)

---

## How to re-run

```bash
cd apps/api
node -e "
const {readFileSync,execSync}=require('fs');
const env=Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
let url=env.IMPORT_REVIEW_DATABASE_URL?.trim()||env.DATABASE_URL?.trim();
const p=new URL(url);['pgbouncer','connection_limit'].forEach(k=>p.searchParams.delete(k));
if(p.port==='6543')p.port='5432';
execSync('psql \"'+p.toString().replace(/\"/g,'\\\"')+'\" -v ON_ERROR_STOP=1 -v review_batch_id=0 -f infrastructure/database/migrations/import-review/000_review-overrides-inventory.sql',{stdio:'inherit',cwd:'..'});
"
```

Optional batch scope: `-v review_batch_id=2`

---

## Executive summary

| Metric | Value |
|--------|------:|
| Candidate tables with data | 10 / 14 |
| Empty candidate tables | 4 (`bus_route_*`, `routing_turn_restriction`) |
| Rows with non-empty `review_overrides` | **1,878** (sum across families with overrides) |
| Unknown override key occurrences (HS-9) | **6** → **0 after policy reclassification** |
| Road override `geom` rows | 540 |
| Road geom column mismatch (pre-merge risk) | **20** |
| Buildings with override-only `building_type_id` | **967** mismatches vs column |

**Phase 1 (archive):** Proceed — read-only snapshot is safe.  
**Phase 1b (082a):** Approve `roads.speed_kph` and `roads.access` columns (539 rows each). Other inventory-gated columns remain **declined** (zero usage).  
**Phase 2 (merge):** Do **not** bulk-merge road `geom` until the 20 `geom_override_object_column_mismatch` rows are triaged.

---

## Section 1 — Per-table counts

| Table | Family | Total rows | Non-empty overrides | Promoted | Promoted + overrides | Promotion in import_review |
|-------|--------|----------:|--------------------:|---------:|---------------------:|:--------------------------:|
| `building_candidates` | buildings | 1,402 | **968** | 3 | 0 | yes |
| `road_candidates` | roads | 1,400 | **813** | 0 | 0 | yes |
| `place_candidates` | places | 242 | **48** | 0 | 0 | yes |
| `bus_stop_candidates` | bus_stops | 52 | **42** | 0 | 0 | no |
| `admin_area_candidates` | admin_areas | 9 | **7** | 0 | 0 | yes |
| `address_candidates` | addresses | 45 | 0 | 0 | 0 | yes |
| `landuse_candidates` | landuse | 59 | 0 | 0 | 0 | yes |
| `water_line_candidates` | water_lines | 26 | 0 | 0 | 0 | yes |
| `water_polygon_candidates` | water_polygons | 14 | 0 | 0 | 0 | yes |
| `routing_barrier_candidates` | routing_barriers | 15 | 0 | 0 | 0 | yes |

**Empty tables (0 rows, omitted from Section 1 UNION):** `bus_route_candidates`, `bus_route_variant_candidates`, `bus_route_stop_candidates`, `routing_turn_restriction_candidates`.

---

## Section 2 — Top override keys (by family)

### admin_areas (7 rows with overrides)
- `admin_level_id` × 7

### buildings (968 rows)
- `building_type_id` × 967, `admin_area_id` × 961, `name_en` × 20, `name_mm` × 6, `canonical_name` × 1, `name` × 1

### bus_stops (42 rows)
- `admin_area_id` × 42, `name_en` × 5, `name_mm` × 4, `name` × 1

### places (48 rows)
- `admin_area_id` × 38, `category_id` × 36, `name_mm` × 16, `name_en` × 15, `poi_category_id` × 9, `name` × 3, `canonical_name` × 2

### roads (813 rows)
- `admin_area_id`, `is_oneway`, `road_class_id` × 811 each
- `confidence_score`, `geom`, `name_en`, `name_mm`, `surface` × 540 each
- `access`, `bridge`, `layer`, `speed_kph`, `tunnel` × 539 each
- `validation_summary` × 3

---

## Section 3 — Unknown keys (HS-9)

Initial run (before policy update):

| Family | Key | Occurrences | Candidates |
|--------|-----|------------:|-----------:|
| roads | `validation_summary` | 3 | 3 |
| places | `canonical_name` | 2 | 2 |
| buildings | `canonical_name` | 1 | 1 |

**Policy decision (signed):**

| Key | Classification | Action |
|-----|----------------|--------|
| `validation_summary` | `archive_only` | Keep in `review_overrides_archive`; do not merge to columns; strip from active JSON after archive |
| `canonical_name` | `archive_only` | Merge bilingual names into `name_mm`/`name_en` (082a) + existing `canonical_name` column where applicable; do not treat as PATCH allowlist key |
| `poi_category_id` | `archive_only` (already in policy) | Merge to `category_id` when present (9 place rows) |

After adding `validation_summary` and `canonical_name` to the SQL policy table, **HS-9 unknown count = 0**.

---

## Section 4 — Road geometry

| Check | Count |
|-------|------:|
| Rows with `review_overrides ? 'geom'` | 540 |
| Invalid JSON type (`jsonb_typeof` ≠ `object`) | **0** |
| Valid GeoJSON object but column `geom` null or not `ST_Equals` | **20** |

**Stop condition for Phase 2 geom merge:** Resolve 20 mismatch rows (likely dual-write drift: overrides updated without matching column, or vice versa). Re-run Section 4 until mismatch count is 0 or each row is documented as acceptably intentional.

---

## Section 5 — Scalar column vs override disagreements

| Check | Mismatch count | Interpretation |
|-------|---------------:|----------------|
| `buildings.building_type_id` | **967** | Overrides hold reviewer corrections; columns often null — merge critical |
| `roads.road_class_id` | **280** | Partial dual-write; merge must prefer override when key present |
| `places.category_id` | **36** | Override-only corrections |
| `landuse.landuse_class_id` | 0 | No override usage on landuse today |

Samples (batch 2): building ids 3–15 show `building_type_id` only in JSON; road ids show `road_class_id` 6 in JSON only; place ids show `category_id` in JSON only.

---

## Section 6 — Inventory-gated columns (082a decision)

| Metric | Row count | 082a decision |
|--------|----------:|---------------|
| `roads.speed_kph` | **539** | **ADD** `road_candidates.speed_kph numeric null` |
| `roads.access` | **539** | **ADD** `road_candidates.access text null` |
| `water_lines.waterway_class` | 0 | **DECLINE** — merge via `class_code` only |
| `water_lines.intermittent` | 0 | **DECLINE** — archive-only if ever appears |
| `water_polygons.water_class` | 0 | **DECLINE** |
| `water_polygons.intermittent` | 0 | **DECLINE** |
| `landuse.admin_area_id` | 0 | **DECLINE** |

---

## Phase 1b column table (confirmed by this inventory)

Add in `082a` (proven non-zero usage or code-proven missing column):

| Family | Column | Evidence from inventory |
|--------|--------|-------------------------|
| buildings | `name_mm`, `name_en` | 6 + 20 override rows; 967+ type overrides |
| places | `name_mm`, `name_en` | 16 + 15 override rows |
| roads | `name_mm`, `name_en` | 540 each |
| roads | `admin_area_id` | 811 override rows; no column in 024 |
| roads | `speed_kph`, `access` | 539 each |
| admin_areas | `name_mm`, `name_en` | admin review active (7 rows) |
| water_lines / water_polygons | `name_mm`, `name_en` | 0 overrides today but allowlist + 024 gap — **add for direct-edit parity** (low risk) |
| bus_stops | `name_mm`, `name_en` | 4 + 5 rows (review-only) |

---

## Sign-off checklist

- [x] Inventory SQL committed and re-runnable
- [x] All promotion families have counts
- [x] Unknown keys classified (`validation_summary`, `canonical_name`)
- [x] Inventory-gated 082a decisions documented
- [ ] **Owner:** Triage 20 road geom mismatches before Phase 2 geom merge
- [x] Empty bus / turn-restriction tables noted (archive migration still includes them)

**Signed:** Phase 0 complete — ready for **Phase 1 archive** migration. Phase 2 merge requires geom triage above.

---

## Raw output

Full `psql` output is stored locally when generated via automation; re-run the script to refresh numbers after new review activity.
