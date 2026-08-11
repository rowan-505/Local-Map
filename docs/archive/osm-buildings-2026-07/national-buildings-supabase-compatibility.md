# National buildings — Supabase direct-Core schema compatibility

**Date:** 2026-07-31  
**Goal:** Confirm live Supabase is compatible with  
`tools/data-pipeline/direct-core/sql/buildings.sql` without overengineering.  
**This task does not import the 22,785 approved buildings.**

## Verdict

**GO**

Migration **149** is already applied on production. The direct-Core buildings importer references only existing columns. A one-row dry-run completed and **ROLLBACK**’d with no missing-column errors. Counts were unchanged after the smoke test.

No new migration is required.

---

## Context (important)

| Fact | Value |
|------|-------|
| Approved local CSV | `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/buildings.safe.csv` |
| CSV sha256 | `d308f9785e9e9570185a0b025517f4049997f0e0dd263180052cc5dcc881e6b6` |
| Manifest sha256 | `83f4b09ebc14a8dca39365f1aadba88202ff5a01af8ebf214190f168352927be` |
| Approved scope | safe_new 22,703 + safe_update 82 = **22,785** |
| Local staging snap 13 | cleaned (0 rows) |
| Local archive | `basemap_source.buildings` = 5,578,282 |

A prior one-time apply already committed publish batch **255** (insert 22,703 / update 29). Current Core building count is **23,836** (= 1,133 pre-import + 22,703 inserts). This compatibility task does **not** re-import.

---

## 1. Live schema inspection summary

### `core.core_map_buildings`

Importer-required columns present:

- `source_registry_id`, `source_snapshot_id`
- `source_feature_type`, `source_feature_id`
- `region_code`
- `is_geometry_manually_edited`, `is_attributes_manually_edited`

Partial unique index present:

- `core_map_buildings_source_identity_uidx`  
  on `(source_registry_id, source_feature_type, source_feature_id)`  
  **WHERE** all three are NOT NULL

### Related objects

| Object | Status |
|--------|--------|
| `core.core_map_building_names` | Present; unique `(building_id, language_code, name_type, lower(btrim(name)))` |
| `core.core_place_buildings` | Present (51 links) |
| `ref.ref_building_types` | 16 rows |
| `core.core_admin_areas` | 2,518 rows |
| `system.system_publish_batches` / `_items` | Present |
| `system.pipeline_osm_identity_key` | Present (normalized matching) |
| Snapshot `osm_myanmar_2026_07_21_national_dry_run_v1` | id **10** |

### Current counts (post–migration 149 and post prior import)

| Table | Count |
|-------|------:|
| `core.core_map_buildings` | 23,836 |
| `core.core_map_building_names` | 18,093 |
| `core.core_place_buildings` | 51 |

Historical pre-import baseline (from apply backups / report): buildings **1,133**, names **259**, links **51**.

---

## 2. Importer requirements vs live DB

| Requirement | Live status |
|-------------|-------------|
| Preserve Core building design | Yes |
| Names in `core_map_building_names` | Yes (importer writes here; ON CONFLICT DO NOTHING) |
| Place-building links untouched by importer | Yes |
| Verification / soft-delete preserved | Yes (protection skips verified / manual-edit / dashboard) |
| Typed OSM way/relation identity | Yes |
| Normalize `osm:W:` / `osm:R:` / `osm:way:` / `osm:relation:` | Yes via `pipeline_osm_identity_key` |
| No raw `external_id` equality for matching | Yes (typed columns + identity key) |
| Never invent type for bare numeric IDs | Yes (16 bare numeric remain typed-incomplete) |
| Partial unique index for complete identities only | Yes |
| Manual geometry/attribute flags | Yes (required by update protection) |

**Minimum schema change:** migration 149 only. **Already applied.** No corrected follow-up migration needed.

Later migrations 150–153 (Kyauktan views / name language / import_work cleanup) are not required for importer column compatibility.

---

## 3. Identity audit (live)

| Format | Count | Typed complete |
|--------|------:|---------------:|
| verbose_way (`osm:way:`) | 22,648 | 22,648 |
| compact_W (`osm:W:`) | 952 | 952 |
| null/blank external_id | 114 | 0 |
| verbose_relation | 105 | 105 |
| bare_numeric | 16 | 0 |
| compact_R | 1 | 1 |

| Check | Result |
|-------|--------|
| Complete identity collisions | **0** |
| Bare numeric with invented typed identity | **0** |
| Dashboard-sourced rows | 114 |
| Verified-ish | 6 |
| Manual-edit flags true | 0 |
| Soft-deleted | 8 |
| Typed complete / incomplete | 23,706 / 130 |

---

## 4. Tiny dry-run smoke test

Command:

```bash
source tools/data-pipeline/prod-mirror/00_env.sh
export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL=true

# One synthetic safe_new row (fictitious osm:way:999999999001), then ROLLBACK
bash tools/data-pipeline/direct-core/run_direct_core_import.sh \
  --family buildings \
  --target production \
  --csv /tmp/buildings_compat_tiny/buildings.tiny.csv \
  --region-code mm-core-buildings-v1 \
  --snapshot-version osm_myanmar_2026_07_21_national_dry_run_v1 \
  --dry-run \
  --env-file tools/data-pipeline/prod-mirror/00_env.sh
```

Result:

- Importer preflight found migration 149 columns.
- Inserted 1 / updated 0 inside the transaction.
- `ROLLBACK` executed (`dry_run=t`).
- Post counts: buildings **23,836**, names **18,093** (unchanged).
- No missing-column exceptions.

---

## 5. Migration apply command (already done historically)

```bash
source tools/data-pipeline/prod-mirror/00_env.sh
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
psql "postgresql://$SUPABASE_DB_USER@$SUPABASE_DB_HOST:$SUPABASE_DB_PORT/$SUPABASE_DB_NAME?sslmode=$SUPABASE_DB_SSLMODE" \
  -v ON_ERROR_STOP=1 \
  -f infrastructure/database/migrations/supabase/149_core_map_buildings_source_identity.sql
```

**Do not re-apply** on production; columns/index already exist (`ADD COLUMN` would fail).

---

## 6. Verification / rollback SQL

| File | Purpose |
|------|---------|
| `infrastructure/database/verification/verify_buildings_direct_core_compatibility.sql` | Before/after compatibility checks |
| `infrastructure/database/verification/verify_core_map_buildings_source_identity.sql` | Original migration 149 verifier |
| `infrastructure/database/verification/rollback_149_core_map_buildings_source_identity.sql` | Destructive column drop (prefer backup restore) |

Run verification:

```bash
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/verification/verify_buildings_direct_core_compatibility.sql
```

---

## 7. Integration smoke

| Surface | Result |
|---------|--------|
| `tiles.tiles_buildings_v` | queryable (23,828 rows) |
| `search.v_search_buildings_source` | queryable (10,176 rows) |
| Direct-Core buildings SQL | dry-run OK (no missing columns) |

API/dashboard compile was not re-run in this task; schema changes are additive and already live from 149 + prior import.

---

## 8. What this task did **not** do

- Did not import the 22,785 approved CSV rows again.
- Did not modify `basemap_source`.
- Did not restore local staging.
- Did not create queues, APIs, or new import subsystems.
- Did not invent types for bare numeric legacy IDs.

---

## Final result

**GO** — live Supabase building schema is compatible with the existing direct-Core buildings importer. No additional migration needed for a future guarded apply (or for tooling that assumes migration 149).
