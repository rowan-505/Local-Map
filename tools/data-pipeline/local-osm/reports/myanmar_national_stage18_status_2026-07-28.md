# National Stage 18 classify — status 2026-07-28

## Status: **NOT COMPLETE** (operator action required)

National dry-run Stage 18 country-wide bucket totals are still unfinished. Pipeline code now includes Stages **08c/08d** (prod township assign + settlement reclass). Classification reports must be regenerated **after** those stages.

## Why incomplete

| Item | Evidence |
|---|---|
| Earlier national dry-run | `docs/myanmar-national-osm-dry-run.md` — Batch A Stage 05 was long-running; B–D + Stage 18 totals not finished |
| Local psql in this session | Host `psql` failed to load (`libpq` code-signature deny); could not re-query snap 13 staging here |
| Existing classify report | Only regional: `reports/classification_kyauktan_2026-07-22.md` |

## Finish commands (local only — no IR upload, no apply)

```bash
cd tools/data-pipeline/prod-mirror
./refresh_prod_mirror.sh   # required for Stage 07 F2 + Stage 08c

cd ../local-osm
# Prefer batched dry-run (includes CLASSIFICATION_REPORT_ENABLED=true)
./run_myanmar_national_dry_run_batched.sh

# Or resume from Stage 08 for one family after staging exists:
ENTITY_FAMILIES=places \
PIPELINE_FROM_STAGE=08 PIPELINE_TO_STAGE=10 \
REMOTE_REVIEW_UPLOAD_ENABLED=false \
CLASSIFICATION_REPORT_ENABLED=true \
./run_local_osm_pipeline.sh imports/myanmar_national_dry_run_2026_07_23.env
```

Repeat `ENTITY_FAMILIES` one family at a time for: `places`, `roads`, `buildings`, `landuse`, `water_lines`, `water_polygons`, `routing_barriers`, and classify-only `admin_areas`.

## Stage 18 gate checklist

For each family, Stage 18 / summary must show:

- [ ] `safe_new` / `safe_update` / `unchanged` / IR conflict / `invalid` / `pmtiles_only` counts
- [ ] `pmtiles_only` never packaged for IR or import_work
- [ ] Suspicion: mass `safe_update`, null `external_id`, huge IR volume
- [ ] After 08c: importable rows with `normalized_data.admin_area_id` (prod ids) vs null

## Gate rule

Do **not** authorize national apply for a family until its Stage 18 report exists and suspicion flags are reviewed.
