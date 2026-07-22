# Validation + previous-snapshot status — Kyauktan

Snapshot: `osm_myanmar_2026_05_15_kyauktan_v2` (id=4)  
Date: 2026-07-22  
Scope: local DB only (no Supabase writes)

## Per-family report

| family | raw | normalized | valid | warning | invalid | source_new | source_changed | source_unchanged | source_missing |
|--------|----:|-----------:|------:|--------:|--------:|-----------:|---------------:|-----------------:|---------------:|
| admin_areas | 14 | 14 | 14 | 0 | 0 | 14 | 0 | 0 | 0 |
| roads | 1400 | 1400 | 1400 | 0 | 0 | 1400 | 0 | 0 | 0 |
| places | 116 | 117 | 117 | 0 | 0 | 117 | 0 | 0 | 0 |
| buildings | 1402 | 1402 | 21 | 1381 | 0 | 1402 | 0 | 0 | 0 |
| landuse | 59 | 59 | 4 | 55 | 0 | 59 | 0 | 0 | 0 |
| water_lines | 26 | 26 | 3 | 23 | 0 | 26 | 0 | 0 | 0 |
| water_polygons | 14 | 14 | 4 | 10 | 0 | 14 | 0 | 0 | 0 |
| routing_barriers | 15 | 15 | 0 | 15 | 0 | 15 | 0 | 0 | 0 |

Notes:

- This snapshot has **no previous OSM snapshot** in the same registry/region, so F1 marks every current row `source_new` (expected).
- Warnings are mostly optional-name / optional-class (family rules allow continue).
- Invalid = 0 on this extract; Stage J still excludes `validation_status = 'invalid'`.

## Completion checks

| check | result |
|-------|--------|
| Every normalized candidate has `validation_status` | PASS (0 missing) |
| Every valid candidate has `source_status` | PASS (0 missing) |
| Same-set hash self-compare (roads) → 0 changed | PASS (1400 unchanged) |
| Unit tests `candidate-validation.test.ts` | PASS (10) |
| SQL scenarios `scripts/test_validation_source_status.sql` | PASS (7) |

## How to re-run

```bash
cd tools/data-pipeline/local-osm
source imports/kyauktan_2026_05_15_v2.env

# After Stage 05 (or validation-only apply):
psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f scripts/apply_validation_only.sql

psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f 06_diff_current_vs_previous.sql

psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f 17_validation_source_report.sql
```
