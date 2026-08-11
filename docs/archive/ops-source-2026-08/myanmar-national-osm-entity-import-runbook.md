# Myanmar national OSM — entity-by-entity import runbook

**Date:** 2026-07-28  
**Audience:** operators running local classification → direct-Core or Import Review  
**Hard rule:** one entity family at a time for apply. Never national multi-family apply in one shot.

Related:
- [`tools/data-pipeline/local-osm/README.md`](../tools/data-pipeline/local-osm/README.md)
- [`docs/national-import-final-authorization.md`](national-import-final-authorization.md)
- [`docs/national-roads-osm-reload-policy.md`](national-roads-osm-reload-policy.md)
- [`docs/national-admin-osm-exclude.md`](national-admin-osm-exclude.md)
- [`docs/national-entity-proveout-checklist.md`](national-entity-proveout-checklist.md)
- [`tools/data-pipeline/direct-core/README.md`](../tools/data-pipeline/direct-core/README.md)
- [`docs/osm-core-vs-pmtiles-selection-policy.md`](osm-core-vs-pmtiles-selection-policy.md)

---

## 1. Ready / not-ready matrix (2026-07-28)

| Gate | Status | Notes |
|---|---|---|
| Township overlaps (ops 364) | **READY** | Live: 0 pairs >100 m² — `reports/township_overlap_reverify_2026-07-28.md` |
| Prod township lookup (145/146) | **READY** | Functions live on Supabase |
| Stage 08c prod admin assign (pipeline) | **CODE READY** | Uses `prod_mirror` IDs after match/import_class |
| National Stage 18 classify | **NOT READY** | Must finish dry-run reports — `reports/myanmar_national_stage18_status_2026-07-28.md` |
| Roads reload policy | **DOC LOCKED** | Identity via `external_id`; regional prove-out first |
| Admin OSM apply | **EXCLUDED** | Keep production admin polygons |
| Per-family prove-out ≥1k | **NOT READY** | Checklist pending |
| IR landuse `admin_area_id` | **MIGRATION FILED** | Apply `147_import_review_landuse_admin_area_id.sql` before landuse IR upload |
| `pmtiles_only` gate | **CODE OK** | Verify counts in Stage 18 |

**Overall national apply authorization:** **NOT READY** until Stage 18 + prove-outs pass **per family**.

Live core counts (inspection): places 11 213 · streets 823 006 · buildings 1 125 · landuse 57 · water 2+12 · barriers 15 · admin active 2 516.

---

## 2. Architecture (admin assign)

```text
PBF → 00–04 local raw
    → 05 staging (NO local admin IDs)
    → 06–08 match_status
    → 08b import_class
    → 08c prod_mirror township admin_area_id   ★ production IDs
    → 08d settlement reclass if admin still null
    → 18 classify report
    → safe_new / safe_update → validated CSV → one regional direct-Core transaction
    → review classes → Stage 11–12 import_review → Dashboard/API promotion → core
    → unchanged → no write
    → invalid → local rejection report
    → pmtiles_only → PMTiles policy only
```

**Policy 1C:** Stage 08c assigns admin to `safe_new`, `safe_update`, and IR conflict classes only.  
**IR upload:** conflict classes only (`REMOTE_REVIEW_CONFLICT_ONLY=true`).

---

## 3. Prerequisites

| Item | Requirement |
|---|---|
| PBF | Geofabrik Myanmar extract under `tools/data-pipeline/local-osm/data/osm/` |
| Env | Copy `imports/template.full.env` or use national dry-run env |
| Local DB | PostGIS `geo_core` (or project local) |
| prod_mirror | Fresh: `tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh` |
| Migration 147 | Applied on Supabase **before** landuse IR upload |
| ENTITY_FAMILIES | **One family** for apply runs |
| Guards | `REMOTE_REVIEW_UPLOAD_ENABLED=false` until IR intentionally enabled |

---

## 4. Stage reference (what each step does)

| Stage | Script | Writes | Notes |
|------:|---|---|---|
| 00 | preflight + optional boundary | system | Whole-country: leave boundary empty |
| 01 | create snapshot | system | |
| 02 | osm2pgsql → tmp | tmp_import | osmium pre-filter for admin/roads-only |
| 03 | validate tmp | — | |
| 04 | tmp → raw | raw | |
| 05 | raw → staging | staging | **No local admin assign** |
| 06 | F1 vs previous | system_diff | |
| 07 | F2 vs prod_mirror | system_diff | Needs fresh mirror |
| 08 | match_status | staging | |
| 08b | import_class | staging | |
| **08c** | **prod township admin** | staging `normalized_data.admin_area_id` | **prod_mirror IDs** |
| **08d** | settlement reclass | staging | Missing admin → conflict |
| 18 | bucket report | reports | |
| 09–10 | views + summary | views | |
| 11–13 | IR package/upload/verify | import_review | Conflicts only |
| After | direct-Core exporter + runner | core | One family and region per transaction |

---

## 5. Commands — classify one family (local)

```bash
# 1) Refresh production mirror (IDs + geoms for F2 and Stage 08c)
cd tools/data-pipeline/prod-mirror
./refresh_prod_mirror.sh

# 2) Run pipeline for ONE family through classify
cd ../local-osm
export ENTITY_FAMILIES=places   # change per run: roads, buildings, landuse, ...
export REMOTE_REVIEW_UPLOAD_ENABLED=false
export CLASSIFICATION_REPORT_ENABLED=true
export ADMIN_ASSIGN_BATCH=5000

./run_local_osm_pipeline.sh imports/myanmar_national_dry_run_2026_07_23.env
# Or your regional env under imports/
```

National batched classify (all families, still no upload/apply):

```bash
cd tools/data-pipeline/local-osm
./run_myanmar_national_dry_run_batched.sh
```

Buildings: use core-eligible-only mode (never Stage 05 full footprints). See `docs/myanmar-national-osm-dry-run.md`.

---

## 6. Commands — Import Review (conflicts only)

```bash
cd tools/data-pipeline/local-osm
export ENTITY_FAMILIES=places
export REMOTE_REVIEW_UPLOAD_ENABLED=true
export REMOTE_REVIEW_CONFLICT_ONLY=true
export PIPELINE_FROM_STAGE=11
export PIPELINE_TO_STAGE=13

./run_local_osm_pipeline.sh imports/<your>.env
```

Then decide/apply in the dashboard. Confirm `admin_area_id` on candidates are **production** township ids (FK to `core.core_admin_areas`).

---

## 7. Commands — safe_* direct to Core

```bash
# Export on the local staging database.
PAGER=cat psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v staging_schema=staging \
  -v output_path="/absolute/path/places.safe.csv" \
  -v rejection_path="/absolute/path/places.invalid.csv" \
  -f tools/data-pipeline/direct-core/export/export_places.sql

# Dry-run the complete target transaction first.
bash tools/data-pipeline/direct-core/run_direct_core_import.sh \
  --family places \
  --target production \
  --csv /absolute/path/places.safe.csv \
  --region-code yangon \
  --snapshot-version "$SNAPSHOT_VERSION" \
  --dry-run

# Apply requires the exact printed confirmation.
bash tools/data-pipeline/direct-core/run_direct_core_import.sh \
  --family places \
  --target production \
  --csv /absolute/path/places.safe.csv \
  --region-code yangon \
  --snapshot-version "$SNAPSHOT_VERSION" \
  --apply \
  --confirmation "IMPORT places yangon ${SNAPSHOT_VERSION}"
```

Repeat with the family-specific exporter and runner family slug. The runner
refuses nationwide region aliases and transaction-mode pooler connections.

---

## 8. Recommended import order

1. places  
2. roads (policy doc)  
3. buildings (core-eligible only)  
4. landuse (after migration 147)  
5. water_lines / water_polygons  
6. routing_barriers  

**Never:** `admin_areas` national OSM apply.

---

## 9. Guards (fail the run if violated)

- No `pmtiles_only` into Import Review or Core  
- No local `core.core_admin_areas` ids in review/direct candidates  
- No multi-family national apply  
- No admin OSM apply  
- No roads national apply before regional ≥1k prove-out  
- No Stage 11 upload until Stage 18 reviewed for that family  

---

## 10. Rollback / cleanup

- Direct-Core failure → complete regional transaction rollback
- Direct-Core success → existing `system.system_import_*` and
  `system.system_publish_*` metadata in the same commit
- Import Review Apply History → existing durable publish fields
- Do not delete point-ledger style rows; use reversal patterns where project already does  

---

## 11. Stop conditions

Stop and escalate if:

- Stage 08c fails missing `prod_mirror.core_admin_areas`  
- IR upload FK errors on `admin_area_id` (wrong/local ids)  
- Stage 18 shows unexpected mass `safe_update` or null `external_id` spikes  
- Township overlap re-verify regresses (pairs >100 m² returns)

---

## 12. Quick “is this family ready?”

```text
[ ] prod_mirror refreshed (< MIRROR_MAX_AGE_HOURS)
[ ] Stage 18 report for this family reviewed
[ ] Stage 08c admin assign metrics OK (nulls explained)
[ ] Prove-out checklist complete for this family
[ ] Authorization matrix row = PASS for this family
[ ] Then apply national for THIS family only
```
