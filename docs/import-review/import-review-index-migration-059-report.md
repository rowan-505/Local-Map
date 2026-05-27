# Import-review roads/buildings list — index migration 059 report

**Status:** Plan only — validate with `EXPLAIN (ANALYZE, BUFFERS)` on a production-like batch before applying.  
**Migration file:** `infrastructure/database/migrations/supabase/059_import_review_building_road_list_indexes.sql`  
**Prior art:** `051_import_review_road_candidates_list_indexes.sql` (roads composites); `024_create_import_review_schema.sql` (baseline single-column indexes).

---

## 1. Tables / views used by list endpoints

| Endpoint | API route | SQL source | Relation |
|----------|-----------|------------|----------|
| Roads list | `GET /api/import-review/roads` | `GenericImportReviewCandidateRepository.listCandidates` → `buildLightweightListFromClause` / `buildRoadLightweightListFromClause` | **`import_review.road_candidates`** (table `r`) |
| Roads count | same, `include_total=true` | `countCandidates` on base table, no joins | **`import_review.road_candidates`** |
| Buildings list | `GET /api/import-review/buildings` | `buildBuildingLightweightListFromClause` | **`import_review.building_candidates`** (table `b`) |
| Buildings count | same | base table | **`import_review.building_candidates`** |

**Not used for list:** views; `source_snapshot_version` is selected but **not** in list `WHERE` (scope resolves to `review_batch_id` only via `buildCandidateWhereClause`).

**List joins (do not change index target table):**

- Buildings: `LEFT JOIN ref.ref_building_types`, `LEFT JOIN core.core_admin_areas`
- Roads: `LEFT JOIN ref.ref_road_classes`, `LEFT JOIN core.core_admin_areas` (explicit admin only, no spatial inference on list)

---

## 2. WHERE clauses (from `buildCandidateWhereClause`)

Always (both families):

```sql
{alias}.review_batch_id = $review_batch_id
AND {alias}.entity_family = 'roads' | 'buildings'
```

Default when `include_promoted` is false and `promotion_status` filter unset:

```sql
AND {alias}.promotion_status IS DISTINCT FROM 'promoted'
AND {alias}.review_status IS DISTINCT FROM 'promoted'
```

Optional dashboard filters:

| Parameter | Column |
|-----------|--------|
| `match_status` | `match_status` |
| `auto_action` | `auto_action` |
| `review_status` | `review_status` (or NULL/empty for `__unreviewed__`) |
| `review_decision` | `review_decision` |
| `class_code` | `class_code` (roads + buildings) |
| `promotion_status` | `promotion_status` |
| `q` | `ILIKE` on searchable columns (buildings: `canonical_name`, `name`, `external_id`, `class_code`; roads: + `road_class`, JSON tag paths) |

**Not used on list:** `deleted_at`, `is_active` on candidate rows (no soft-delete column on these tables).

---

## 3. ORDER BY

Default sort `updated_at_desc` → `{alias}.updated_at DESC` (`buildCandidateOrderBy`).

Other sorts (less common): `created_at`, `id`, `confidence_score`, `canonical_name`, `external_id`.

---

## 4. Existing indexes (inventory)

### `import_review.building_candidates` (024)

| Index | Definition | List usefulness |
|-------|------------|-----------------|
| `irr_bld_rbid_idx` | `(review_batch_id)` | Batch filter only — **cannot** satisfy `ORDER BY updated_at` within batch |
| `irr_bld_upd_desc_idx` | `(updated_at DESC)` | Global sort — **poor** for `WHERE review_batch_id = ?` |
| `irr_bld_mst_idx` | `(match_status)` | Unscoped — planner must filter batch in heap |
| `irr_bld_aact_idx` | `(auto_action)` | Same |
| `irr_bld_rst_idx` | `(review_status)` | Same |
| `irr_bld_pstat_idx` | `(promotion_status)` | Same |
| `irr_bld_geom_gist_idx` | `GIST(geom)` | **Not** used by list (no geom in WHERE; `geom IS NOT NULL` only in SELECT) |
| `irr_bld_centroid_gist_idx` | `GIST(centroid)` | Same |

**Gap:** No `(review_batch_id, entity_family, updated_at DESC)` — primary cause of slow `limit=50` building lists.

### `import_review.road_candidates` (024 + 051)

| Index | Source | List usefulness |
|-------|--------|-----------------|
| `irr_road_rbid_idx` | 024 | Batch only |
| `irr_road_upd_desc_idx` | 024 | Global sort — poor alone |
| `irr_road_rbid_entity_family_updated_desc_idx` | **051** | **Ideal** for default list + sort |
| `irr_road_rbid_entity_family_not_promoted_idx` | 051 | Default “hide promoted” |
| `irr_road_rbid_match_status_idx` | 051 | `match_status` filter |
| `irr_road_rbid_road_class_id_idx` | 051 | `class_code` / road class joins |
| `irr_road_*_trgm_idx` | 051 | `q` search only |
| `irr_road_geom_gist_idx` | 024 | Detail / promotion spatial — **not** list |

**Gap (051):** No batch-scoped indexes on `auto_action`, `review_status`, `review_decision`, `class_code` alone.

---

## 5. Recommended new indexes (059)

### Buildings — **required** (mirror 051)

| Index | Supports |
|-------|----------|
| `irr_bld_rbid_entity_family_idx` | List + count base filter |
| `irr_bld_rbid_entity_family_updated_desc_idx` | **`GET …/buildings?sort=updated_at_desc&limit=50`** (primary fix) |
| `irr_bld_rbid_entity_family_not_promoted_idx` | Default list excluding promoted |
| `irr_bld_rbid_match_status_idx` | Filter `match_status` |
| `irr_bld_rbid_auto_action_idx` | Filter `auto_action` |
| `irr_bld_rbid_review_status_idx` | Filter `review_status` |
| `irr_bld_rbid_class_code_idx` | Filter `class_code` |
| `irr_bld_rbid_building_type_id_idx` | Optional join/filter on `building_type_id` (partial) |
| `irr_bld_*_trgm_idx` | Filter `q` (if `pg_trgm` present) |

### Roads — **supplemental** (051 already covers main list path)

| Index | Supports |
|-------|----------|
| `irr_road_rbid_auto_action_idx` | Filter `auto_action` |
| `irr_road_rbid_review_status_idx` | Filter `review_status` |
| `irr_road_rbid_review_decision_idx` | Filter `review_decision` |
| `irr_road_rbid_class_code_idx` | Filter `class_code` |

051 indexes are re-declared in 059 with `IF NOT EXISTS` so a fresh DB gets roads + buildings in one migration; already-deployed 051 DBs skip duplicates.

### GiST — **do not add**

List SQL does not use `ST_Intersects` / bbox. Existing `irr_*_geom_gist_idx` (024) suffice for detail `include_geometry=true` and promotion/routing code paths.

---

## 6. Production `CREATE INDEX CONCURRENTLY` (manual)

Use outside a transaction when applying to large production tables:

```sql
-- Buildings (primary)
CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_bld_rbid_entity_family_updated_desc_idx
  ON import_review.building_candidates (review_batch_id, entity_family, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_bld_rbid_entity_family_not_promoted_idx
  ON import_review.building_candidates (review_batch_id, entity_family)
  WHERE promotion_status <> 'promoted';

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_bld_rbid_match_status_idx
  ON import_review.building_candidates (review_batch_id, match_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_bld_rbid_auto_action_idx
  ON import_review.building_candidates (review_batch_id, auto_action);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_bld_rbid_review_status_idx
  ON import_review.building_candidates (review_batch_id, review_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_bld_rbid_class_code_idx
  ON import_review.building_candidates (review_batch_id, class_code)
  WHERE class_code IS NOT NULL;

-- Roads (if 051 not yet applied, also run 051 statements; else supplemental only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_road_rbid_entity_family_updated_desc_idx
  ON import_review.road_candidates (review_batch_id, entity_family, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_road_rbid_auto_action_idx
  ON import_review.road_candidates (review_batch_id, auto_action);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_road_rbid_review_status_idx
  ON import_review.road_candidates (review_batch_id, review_status);
```

---

## 7. Rollback (`DROP INDEX`)

```sql
-- Buildings (059)
DROP INDEX IF EXISTS import_review.irr_bld_rbid_entity_family_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_entity_family_updated_desc_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_entity_family_not_promoted_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_match_status_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_auto_action_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_review_status_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_class_code_idx;
DROP INDEX IF EXISTS import_review.irr_bld_rbid_building_type_id_idx;
DROP INDEX IF EXISTS import_review.irr_bld_canonical_name_trgm_idx;
DROP INDEX IF EXISTS import_review.irr_bld_external_id_trgm_idx;
DROP INDEX IF EXISTS import_review.irr_bld_class_code_trgm_idx;

-- Roads supplemental (059) — do not drop 051 indexes unless intentionally reverting 051 too
DROP INDEX IF EXISTS import_review.irr_road_rbid_auto_action_idx;
DROP INDEX IF EXISTS import_review.irr_road_rbid_review_status_idx;
DROP INDEX IF EXISTS import_review.irr_road_rbid_review_decision_idx;
DROP INDEX IF EXISTS import_review.irr_road_rbid_class_code_idx;
```

---

## 8. Validation queries

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.id, b.updated_at
FROM import_review.building_candidates AS b
WHERE b.review_batch_id = :batch_id
  AND b.entity_family = 'buildings'
  AND b.promotion_status IS DISTINCT FROM 'promoted'
  AND b.review_status IS DISTINCT FROM 'promoted'
ORDER BY b.updated_at DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.updated_at
FROM import_review.road_candidates AS r
WHERE r.review_batch_id = :batch_id
  AND r.entity_family = 'roads'
  AND r.promotion_status IS DISTINCT FROM 'promoted'
  AND r.review_status IS DISTINCT FROM 'promoted'
ORDER BY r.updated_at DESC
LIMIT 50;
```

Expect: `Index Scan` or `Index Only Scan` using `*_rbid_entity_family_updated_desc_idx` (or partial not_promoted + sort) with low buffer reads vs previous `Seq Scan` / bitmap on `irr_bld_rbid_idx` + sort.

---

## 9. Duplicate / redundancy notes

- **Do not drop** `irr_bld_rbid_idx` / `irr_road_rbid_idx` in this migration (other queries may use them; composites are additive).
- `irr_*_upd_desc_idx` (global) is redundant with batch composites but harmless; dropping is out of scope.
- 059 **does not** recreate GiST indexes from 024.
