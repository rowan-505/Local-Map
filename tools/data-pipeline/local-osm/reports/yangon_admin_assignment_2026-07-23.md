# Yangon admin-assignment report — 2026-07-23

## Verdict

**PASS for mechanical township inference on current Yangon pilot samples.**

Inference now assigns township for nearly all downtown/city candidates **without editing admin polygons**.  
Ambiguous / weak matches stay unresolved (NULL) — rows are not forced loadable.

Local data caveat remains: **33 urban Yangon townships are labeled `ward_village_tract` in local `core.core_admin_areas`**, while `prod_mirror` has the same names as `township`. Inference treats non-fine `ward_village_tract` (name without `ရပ်ကွက်` / `အမှတ်`) as township-like when the target is township. **Do not treat that as a boundary edit.**

---

## Scope inspected

| Item | Result |
|------|--------|
| Yangon district clip | `core.core_admin_areas.id = 2043` (`ရန်ကုန်မြို့`, district, ~998 km²) |
| Official `township` intersecting clip | **6** (mostly peri-urban; e.g. Dala) |
| Township-like units intersecting clip | **47** (official township + urban units mislabeled `ward_village_tract`) |
| `core.find_admin_area_for_*` on local before fix | **missing** (only `promote_admin_area_candidate`) |
| `system.pipeline_assign_admin_area_for_point` | finest ward/town/township cover (unchanged; settlements) |
| Admin polygons / `admin_level_id` rows | **not modified** |

Downtown smoke point `POINT(96.16914 16.77478)`:

- Before: no official township cover (nearest township Dala ~1.3 km)
- After: township-like id **2056** `ဗိုလ်တထောင်` (`ward_village_tract` locally; `township` in prod_mirror as id 5446)

---

## Mechanical rules shipped

Source files:

- `tools/data-pipeline/local-osm/pipeline_township_assignment.sql` (local staging via `05_raw_to_staging.sql`)
- `tools/data-pipeline/admin-hierarchy-repair/03_create_admin_assignment_functions.sql` (overlays same file)
- `infrastructure/database/migrations/supabase/145_township_admin_assignment_inference.sql`

| Geometry | Rule |
|----------|------|
| Point → township | `ST_Covers` only; prefer official `township`/`town` over township-like `ward_village_tract`; **multiple at that priority → NULL**; none → NULL; **never district fallback** |
| Polygon → township | unique cover at point-on-surface; else for large polys (≥5 ha) dominant area share ≥60% with ≥15 pp margin vs 2nd; else NULL |
| Line → township | largest length overlap; share ≥55% and best/second ≥1.25; else NULL; midpoint township fallback only |

Report helper: `core.classify_township_assignment_for_point(geometry)`.

---

## Per-family results (local staging)

Run log: `tools/data-pipeline/local-osm/reports/_yangon_admin_assignment_run.txt`  
SQL: `tools/data-pipeline/local-osm/reports/yangon_admin_assignment_report.sql`

| Family | Snapshot | Total | Valid township | District only | Ambiguous township | Outside township | Failure | % valid |
|--------|----------|------:|---------------:|--------------:|-------------------:|-----------------:|--------:|--------:|
| places | 9 (city) | 16590 | 16550 | 1 | 39 | 0 | 0 | 99.8 |
| buildings | 10 (downtown) | 50 | 50 | 0 | 0 | 0 | 0 | 100 |
| landuse | 10 | 26 | 26 | 0 | 0 | 0 | 0 | 100 |
| water_lines | 10 | 1 | 1 | 0 | 0 | 0 | 0 | 100 |
| roads | 12 (5k) | 5000 | 4990 | 10 | 0* | 0 | 0 | 99.8 |

\*Road close-overlap conflicts are returned as NULL by `find_admin_area_for_line`; this run bucketed NULL+district-intersect as **district only** (10). A slower overlap audit can split weak vs district-only later.

---

## What was not done (by design)

- No automatic admin polygon edits
- No bulk `admin_level_id` reclassification of local ward_village_tract → township (data repair / hierarchy task; evidence from prod_mirror supports it later)
- No forced assignment to make conflict/outside rows loadable
- Migration **145** written for Supabase; **not applied** in this session

---

## How to re-run

```bash
source tools/data-pipeline/local-osm/imports/yangon_city_production_pilot_2026_07_23.env
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/local-osm/pipeline_township_assignment.sql \
  -f tools/data-pipeline/local-osm/reports/yangon_admin_assignment_report.sql
```

Production apply (when ready): review and apply migration `145_township_admin_assignment_inference.sql` through the normal migration path.

---

## Remaining risks

1. **Local vs production admin level drift** — loaders that write `admin_area_id` must map local ids to production ids (or assign on production geometry only).
2. **39 ambiguous places** — leave as conflict / unresolved; do not auto-pick.
3. **10 roads without clear township overlap** — leave null until reviewed.
4. Applying migration 145 changes production `find_admin_area_for_*` to refuse weak/ambiguous matches (safer, more NULLs).
