# Remote review & lineage (Stages 11–14)

This document describes how **local staging**, the **local outbound package** (`system.system_remote_review_*`), **Supabase `import_review.*`**, and **future `core.*` promotion** stay aligned on lineage. It supplements `README.md` in this folder.

**Hard rules**

- **Do not** promote to `core` from these scripts.
- **Do not** modify `core.*` from the local OSM pipeline or from `import_review` migrations in this repo unless a separate approved workflow says otherwise.
- Verification SQL is meant to be **run deliberately** (operators or CI), not hidden side effects.

---

## Files

| Step | File | Database |
|------|------|----------|
| **J** | `11_prepare_remote_review_package.sql` | Local only — `system.system_remote_review_packages` + `_items` |
| **K** | `12_upload_remote_review_package.ts` | Supabase only — `import_review.review_batches` + `*_candidates` |
| **L** | `13_verify_remote_review_upload.sql` | Local — package + item upload stats |
| **14** (optional) | `14_verify_lineage_alignment.sql` | Local — staging ↔ package + payload mirrors; optional after L via `REMOTE_LINEAGE_ALIGNMENT_VERIFY` |

Orchestration: `run_local_osm_pipeline.sh`.

---

## Lineage field contract (candidates / package items)

Canonical names below match **Supabase `import_review` candidate columns** and the **local upload path** in `12_upload_remote_review_package.ts`.

| Field | Local `system_remote_review_package_items` | `import_review.*_candidates` | Notes |
|-------|--------------------------------------------|-------------------------------|-------|
| `source_snapshot_version` | On **package** (`snapshot_version`); duplicated on each Supabase row | `source_snapshot_version NOT NULL` | Stage K copies from package `snapshot_version`. |
| `source_snapshot_id_local` | On **package** (`source_snapshot_id` → `system.system_source_snapshots.id`) | `source_snapshot_id_local` (nullable DDL; **set by K**) | Local package row is the source of truth for the bigint id used in staging FKs. |
| `local_staging_id` | `local_staging_id` | `local_staging_id NOT NULL` | Join key to `staging_*_candidates.id`. |
| `entity_family` | `entity_family`, `source_table` | `entity_family NOT NULL` | Pipeline uses `buildings` \| `places` \| `roads`. |
| `external_id` | `external_id` | `external_id` | OSM / natural id; may be null for edge cases (**WARN** in Stage 14, not FAIL). |
| `source_refs` | `source_refs` (jsonb, default `{}`) | `source_refs NOT NULL` default `{}` | |
| `normalized_data` | `normalized_data` (jsonb, default `{}`) | `normalized_data NOT NULL` default `{}` | |
| `review_batch_id` | Same as `remote_review_batch_id` on **package** after K | `review_batch_id NOT NULL` FK | Not a column on package **items**; join via package or remote row. |
| `matched_core_id` | `matched_core_id` | `matched_core_id` | Optional until a core match exists. |
| `matched_core_table` | `matched_core_table` | `matched_core_table` | Expected slugs from Stage J: **`core_map_buildings`**, **`core_places`**, **`core_streets`**. |
| `matched_core_data` | `matched_core_data` | `matched_core_data` | F2 / mirror payload; may be null. |
| `f2_comparison` | `f2_comparison` | `f2_comparison` | Often null when no diff row; counted as **WARN** in Stage 14. |

Stage J also writes **redundant mirrors** into each item **`payload`** JSON for cheap audits:

- `source_snapshot_version`
- `snapshot_version` (same string; historical key)
- `source_snapshot_id_local`
- `family` (entity family slug)

---

## Compatibility matrix (staging → package → import_review → core targets)

| Concept | Staging (local) | Local package | Supabase `import_review` | Intended `core.*` target(s) |
|---------|-----------------|---------------|--------------------------|-------------------------------|
| Buildings | `staging.staging_building_candidates` | `_items` where `entity_family = 'buildings'` | `import_review.building_candidates` | **`core.core_map_buildings`** (and linking tables such as `core.core_place_buildings` when promoting) |
| Places | `staging.staging_place_candidates` | `_items` (`places`) | `import_review.place_candidates` | **`core.core_places`** (+ names/sources: **`core.core_place_names`**, **`core.core_place_sources`**) |
| Roads | `staging.staging_road_candidates` | `_items` (`roads`) | `import_review.road_candidates` | **`core.core_streets`** (+ naming/versions: **`core.core_street_names`**, **`core.core_street_versions`**) |

Promotion is **future work**; preserve at minimum:

- `source_staging_id` **or** `review_candidate_id` (workflow key)
- `external_id`, `source_refs`, `normalized_data`
- `source_snapshot_version` as a column **or** embedded in `source_refs` / `normalized_data`
- **`confidence_score`** on **0–100** (matching `import_review` check constraints)

---

## Commands (operators)

### Local — Stage 14 (lineage QA)

Requires a package row from Stage J and the same `REMOTE_REVIEW_PACKAGE_NAME` / `package_name`.

```bash
cd tools/data-pipeline/local-osm
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v staging_schema="${STAGING_SCHEMA:-staging}" \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -f ./14_verify_lineage_alignment.sql
```

`-v snapshot_version=` ties the package row to your import env (**must match** `system.system_remote_review_packages.snapshot_version`).  
If you created the package **before** Stage J started writing `payload.source_snapshot_*` mirrors, **re-run Stage J** (or delete/recreate the package) before expecting **`14`** to pass the payload checks.

**Pipeline:** add to the same import `.env`:

```bash
export REMOTE_LINEAGE_ALIGNMENT_VERIFY='true'
```

Runs **automatically after Stage L** whenever Stages **11–13** run (`REMOTE_REVIEW_UPLOAD_ENABLED` **or** `REMOTE_REVIEW_PREPARE_VERIFY_ONLY`).

### Local — Stages 13 / 11-only

Stage **L**:

```bash
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -f ./13_verify_remote_review_upload.sql
```

Stage **J** is normally invoked via the runner; see header comments inside `11_prepare_remote_review_package.sql`.

### Supabase — manual **`import_review`** checks

Use **`SUPABASE_DATABASE_URL`** from your secrets store (never log the password). Tie batches with:

`review_batches.batch_name = <REMOTE_REVIEW_PACKAGE_NAME>`

Example — batch header:

```sql
SELECT id,
       batch_name,
       source_snapshot_version,
       source_snapshot_id_local,
       entity_families,
       total_candidate_count,
       uploaded_candidate_count,
       status,
       uploaded_at
  FROM import_review.review_batches
 WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>'
 ORDER BY uploaded_at DESC
 LIMIT 5;
```

Example — rollup lineage gaps on **all three** candidate tables:

```sql
WITH b AS (
    SELECT id
      FROM import_review.review_batches
     WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>'
     ORDER BY id DESC
     LIMIT 1
),
u AS (
    SELECT 'buildings'::text AS fam,
           c.source_snapshot_version,
           c.source_snapshot_id_local,
           c.entity_family,
           c.local_staging_id,
           c.normalized_data,
           c.source_refs,
           c.review_batch_id,
           c.external_id,
           c.confidence_score,
           c.f2_comparison
      FROM import_review.building_candidates c
     INNER JOIN b ON b.id = c.review_batch_id
    UNION ALL
    SELECT 'places'::text AS fam,
           p.source_snapshot_version,
           p.source_snapshot_id_local,
           p.entity_family,
           p.local_staging_id,
           p.normalized_data,
           p.source_refs,
           p.review_batch_id,
           p.external_id,
           p.confidence_score,
           p.f2_comparison
      FROM import_review.place_candidates p
     INNER JOIN b ON b.id = p.review_batch_id
    UNION ALL
    SELECT 'roads'::text AS fam,
           r.source_snapshot_version,
           r.source_snapshot_id_local,
           r.entity_family,
           r.local_staging_id,
           r.normalized_data,
           r.source_refs,
           r.review_batch_id,
           r.external_id,
           r.confidence_score,
           r.f2_comparison
      FROM import_review.road_candidates r
     INNER JOIN b ON b.id = r.review_batch_id
)
SELECT
    sum((trim(source_snapshot_version) = '') OR source_snapshot_version IS NULL)::int       AS missing_source_snapshot_version,
    sum(source_snapshot_id_local IS NULL)::int                                               AS missing_source_snapshot_id_local,
    sum((trim(entity_family) = '') OR entity_family IS NULL)::int                            AS missing_entity_family,
    sum(local_staging_id IS NULL)::int                                                       AS missing_local_staging_id,
    sum(normalized_data IS NULL)::int                                                        AS nd_null,
    sum(source_refs IS NULL)::int                                                             AS sr_null,
    sum(review_batch_id IS NULL)::int                                                        AS missing_review_batch_id,
    sum((confidence_score IS NOT NULL AND (confidence_score < 0 OR confidence_score > 100))::int)
                                                                                           AS bad_confidence
FROM u;
```

**WARN-style** aggregates (often sparse):

```sql
-- extend the SELECT list above:
-- sum((external_id IS NULL OR trim(external_id) = '')::int) AS blank_external_id,
-- sum((f2_comparison IS NULL)::int)                           AS blank_f2,
```

`core.*` parity checks intentionally live in promotion / publish-batch tooling—not here—to avoid stray writes.

---

## Defaults & env naming

See **`NAMINGENV.md`** checklist for **`REMOTE_LINEAGE_ALIGNMENT_VERIFY`** next to **`REMOTE_REVIEW_PACKAGE_NAME`** and **`imports/template.full.env`** for copy-paste examples.
