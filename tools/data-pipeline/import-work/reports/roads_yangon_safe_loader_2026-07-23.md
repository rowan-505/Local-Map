# Roads Yangon safe loader — 2026-07-23

## Verdict

**PASS**

Production-safe roads loader is implemented and piloted on a scoped Yangon subset.  
National roads were **not** authorized or loaded.

---

## Precondition (required)

| Check | Result |
|---|---|
| 50-road downtown sample (snap 10) | Prior F2: 49 unchanged / 1 safe_update (geom hash). After F2 repairs: meaningful unchanged path confirmed for synthetic names + class-code fingerprint |
| 5,000-road Yangon read-only classify (snap 12) | Before repair: 1295 unchanged / 3705 safe_update (**would FAIL gate**) |
| After F2 repairs | **5000 / 5000 unchanged (100%)** |
| Gate | **PASS** — not almost-all `safe_update` |

### F2 repairs applied (local pipeline helpers)

1. Treat CoreMap `osm:W:123` / `osm:N:` / `osm:R:` labels as synthetic (same as `osm:way:123`).
2. Prefer **road class code** fingerprint over raw `road_class_id` (avoids local vs production ref id drift for `unclassified` / `track`).

Files: `tools/data-pipeline/local-osm/pipeline_f2_stable_compare.sql`, unit tests updated.

5k sample method: copy 5000 Yangon-intersecting roads from national staging snap 8 → snap `osm_myanmar_2026_07_21_yangon_roads_5k_v1` (id **12**), stages 07–10. No core write.

---

## What was created

| Artifact | Path |
|---|---|
| Migration | `infrastructure/database/migrations/supabase/144_import_work_roads.sql` |
| Work table | `import_work.road_rows` (+ `entity_family='roads'`) |
| Loader | `tools/data-pipeline/import-work/roads_safe_loader*.sql` |
| Runner | `tools/data-pipeline/import-work/run_roads_safe_loader.sh` |
| Preload | `yangon_roads_preload.sh` / `.sql` |
| Tests | `roads_safe_loader_tests.sql` (PASS, rolled back) |
| Cleanup | `cleanup_import_work_batches.sql` includes `road_rows` |

Applied migration **144** on production project `locghyuranqaqsnbxflc`.

---

## Safe-update allowlist (initial)

- Mechanical `road_class_id` / FK alignment (same class **code**)
- `is_oneway`, `bridge`, `tunnel`, `layer`, `surface`
- `source_refs` / `normalized_data` metadata
- Fill missing non-manual `admin_area_id` when work has a clear id
- Real OSM name when core name is generated/synthetic (unless protected)

## Import Review (`conflict_ir`)

- Geometry change (not in allowlist)
- Real name replacement
- Road class **code** meaning change
- Manual override / verified meaningful change
- Ambiguous admin reassignment
- Conflicting / duplicate identity in batch

Version/audit: `core.core_streets` BEFORE UPDATE trigger → `core.core_street_names` for real names; `local_map.edit_reason=import_work.roads_safe_loader`.

---

## Pilot order results

| Step | Batch | Result |
|---|---|---|
| 50-road sample | snap 10 (existing) | F2 gate evidence retained; not used to authorize national load |
| 5,000 classify | snap 12 | **5000 unchanged** after F2 repair |
| 500 dry-run | `roads_yangon_5k_dryrun_500_2026_07_23` | plan update=500; **ROLLBACK**; duration_ms≈1392; core_delta=0 |
| Small apply | `roads_yangon_allowlist_probe_5_2026_07_23` (batch_id **92**) | **updated=5** surface allowlist probe; duration_ms≈10 |
| Identical rerun | same batch 92 | **skipped=5**; duration_ms≈2.7; no further core growth |

Controlled apply detail (5 roads): set `surface` via allowlist probe (`asphalt`). Confirmed on core; **5** new `core.core_street_versions` rows in the apply window.

### Query plan (identity lookup)

```text
Index Scan using core_streets_external_id_unique_idx
  Index Cond: (external_id = ANY (...5 ids...))
  Buffers: shared hit=16
  Execution Time: 0.096 ms
```

Loader core match uses external_id / target id lists (not full-table scans). Metrics use `pg_class.reltuples` estimate instead of counting all ~823k streets.

---

## Explicit non-actions

- No national Myanmar road import
- No reseed of existing national `core.core_streets`
- Downtown 50 alone does **not** authorize national roads
- Valhalla not rebuilt

---

## How to re-run (scoped)

```bash
# 5k read-only classify
./scripts/run_yangon_roads_5k_classify.sh 5000

# Fixture tests (rollback)
psql "$SUPABASE_DATABASE_URL" -f roads_safe_loader_tests.sql

# Dry-run
./yangon_roads_preload.sh --target production --batch-code <code> \
  --mode allowlist_probe --limit 500 --env-file ../local-osm/imports/yangon_roads_pilot_2026_07_23.env
./run_roads_safe_loader.sh --target production --batch-code <code> --dry-run \
  --env-file ../local-osm/imports/yangon_roads_pilot_2026_07_23.env

# Apply (confirmation required)
./run_roads_safe_loader.sh --target production --batch-code <code> --apply \
  --confirmation "APPLY roads <batch_id>" \
  --env-file ../local-osm/imports/yangon_roads_pilot_2026_07_23.env
```

---

## Remaining risks

- Local `ref.ref_road_classes` still missing some production codes (`unclassified`, `track`); F2 now compares by code text, but local staging FK ids can still look “wrong” until refs are aligned.
- First 5k classify without F2 repairs looked like mass `safe_update` (synthetic `osm:W:` names + id drift). Keep those repairs before any larger road apply.
- Allowlist probe intentionally wrote `surface` on 5 production streets; reverse via Import Review / admin if needed.
- Geometry changes always go to IR (no auto geom apply in this initial allowlist).

---

## Final line

**PASS**
