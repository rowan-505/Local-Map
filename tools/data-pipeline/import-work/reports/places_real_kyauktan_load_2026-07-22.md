# Places real Kyauktan load — 2026-07-22 / 2026-07-23

**Batch:** `places_kyauktan_safe_2026_07_22`  
**Snapshot:** `osm_myanmar_2026_05_15_kyauktan_v2` (local staging id=4)  
**Project:** Supabase `locghyuranqaqsnbxflc`  
**Scope:** places family only. Import Review candidates **not** modified.

## Status

**WAITING FOR APPLY APPROVAL** — dry-run rolled back; core not changed.

Do not treat this document as a PASS until committed results + identical rerun sections are filled.

---

## 1. Live inspection notes

- `import_work.place_rows` was empty before this run; batch header created as id **8**.
- `core.core_places` active count before load: **265**.
- `import_review.place_candidates`: 34 conflict-only rows (`duplicate_candidate` 11 + `manual_protected` 23).
- Migrations 137–139 present (`pipeline_osm_identity_key` available).
- `core.core_places`: FK to `ref.ref_poi_categories`, optional `admin_area_id`, unique `public_id`, non-unique `external_id` index (partial active).
- Trigger on places: `trg_sync_is_verified_from_verification_status` only (no auto place-name sync in safe loader).
- Staging `poi_category_id` was NULL for all Kyauktan places; categories resolved via explicit OSM `class_code` → `ref.ref_poi_categories.code` map at preload.

Supabase MCP was unavailable in this session; inspection used `psql` against `SUPABASE_DATABASE_URL` (postgres pooler).

---

## 2. Expected counts (classified staging)

| metric | count |
|--------|------:|
| Classified `safe_new` | 62 |
| Classified `safe_update` | 21 |
| Classified conflict classes (IR path; not loaded) | 34 (`duplicate` 11 + `manual_protected` 23) |
| Expected skipped manual (among safe_update targets) | 0 |
| Expected skipped verified (among safe_update targets) | 0 |
| Unsupported categories after map | **0** |
| Invalid foreign keys (category / target core) | **0** |
| Duplicate external IDs / identity keys in safe set | **0** |
| Safe rows overlapping Import Review | **0** |

### Preload readiness

| check | result |
|-------|--------|
| Category mapped | 83 / 83 |
| IR overlap | 0 |
| `safe_update` identity in core | 21 / 21 |
| `safe_new` already in core | 0 |
| Admin area inferred (ward/town/township) | 83 / 83 |
| Bad geometry | 0 |

---

## 3. COPY / import_work load

| metric | value |
|--------|------:|
| Batch id | 8 |
| Batch code | `places_kyauktan_safe_2026_07_22` |
| Status | `loaded` |
| `safe_new` rows | 62 |
| `safe_update` rows | 21 |
| Loaded total | **83** |
| Duplicate `(batch, external_id)` | 0 |
| Invalid geometry | 0 |
| Null category | 0 |
| Bad `target_core_id` on safe_update | 0 |

Loader script: `tools/data-pipeline/import-work/kyauktan_places_preload_and_copy.sql`  
Export CSV (local staging): `tools/data-pipeline/import-work/reports/_kyauktan_safe_places.csv`

---

## 4. Dry-run results (`dry_run=true`, rolled back)

| action | count |
|--------|------:|
| inserted | **62** |
| updated | **21** |
| skipped manual | 0 |
| skipped verified | 0 |
| skipped unchanged | 0 |
| failed | **0** |
| core_places before | 265 |
| core_places after (in tx) | 327 |
| core_places delta (in tx) | +62 |
| Durable core after ROLLBACK | **265** (unchanged) |

Plan breakdown: `insert=62`, `update=21`. No skip/fail rows.

Publish batch summary was rolled back with the dry-run (no durable `system_publish_batches` row).

---

## 5. Committed results

_Not run — waiting for explicit approval._

| action | count |
|--------|------:|
| inserted | — |
| updated | — |
| skipped | — |
| failed | — |
| core_places before | 265 |
| core_places after | — |
| publish_batch_id | — |

---

## 6. Identical rerun results

_Not run — waiting for apply approval._

Required:

| metric | required |
|--------|----------|
| inserted | 0 |
| updated | 0 (unless genuine allowlist change) |
| duplicate core rows | 0 |
| failed | 0 |

---

## 7. Verification queries (to run after apply)

```sql
-- Core delta
SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS active
FROM core.core_places;

-- Inserted external IDs exist once
SELECT r.external_id, count(*) AS n
FROM import_work.place_rows r
JOIN import_work.import_batches b ON b.id = r.import_batch_id
JOIN core.core_places c
  ON system.pipeline_osm_identity_key(c.external_id)
   = system.pipeline_osm_identity_key(r.external_id)
 AND c.deleted_at IS NULL
WHERE b.batch_code = 'places_kyauktan_safe_2026_07_22'
  AND r.classification = 'safe_new'
GROUP BY 1
HAVING count(*) <> 1;

-- Updated targets stable
SELECT r.target_core_id, c.id, c.external_id
FROM import_work.place_rows r
JOIN import_work.import_batches b ON b.id = r.import_batch_id
JOIN core.core_places c ON c.id = r.target_core_id
WHERE b.batch_code = 'places_kyauktan_safe_2026_07_22'
  AND r.classification = 'safe_update'
  AND c.deleted_at IS NULL;

-- Manual / verified still protected (should remain 0 auto-overwrites)
-- Import Review untouched
SELECT match_status, count(*) FROM import_review.place_candidates GROUP BY 1;
```

---

## 8. Apply command (only after approval)

```bash
set -a && source tools/data-pipeline/local-osm/imports/kyauktan_2026_05_15_v2.env && set +a
export SUPABASE_WRITE_DATABASE_URL="${SUPABASE_WRITE_DATABASE_URL:-$SUPABASE_DATABASE_URL}"

psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v batch_code='places_kyauktan_safe_2026_07_22' \
  -v dry_run=false \
  -f tools/data-pipeline/import-work/places_safe_loader.sql
```

Then identical rerun with the same command, then:

```bash
psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v batch_code='places_kyauktan_safe_2026_07_22' \
  -f tools/data-pipeline/import-work/cleanup_import_work_batches.sql
```

---

## 9. Final verdict

**IN PROGRESS — AWAITING APPLY APPROVAL**

Not yet **PASS** or **FAIL**.
