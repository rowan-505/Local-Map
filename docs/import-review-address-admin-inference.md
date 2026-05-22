# Import review — admin address inference

Infers structured `import_review.address_components` from `core.core_admin_areas` for address candidates that have `point_geom`. See [admin-area-boundary-and-address-usage.md](./admin-area-boundary-and-address-usage.md) for boundary/usage rules.

## Apply migration

```bash
# Supabase / local Postgres
psql "$DATABASE_URL" -f infrastructure/database/migrations/supabase/044_infer_address_admin_components.sql
```

## API (dashboard / scripts)

```http
POST /api/import-review/addresses/infer-admin-components
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "review_batch_id": "123",
  "nearest_village_meters": 3000
}
```

Response includes run counters and verification summaries (matched candidates, components by type/language, sample rows).

## SQL only

```sql
SELECT * FROM import_review.infer_address_admin_components(123::bigint, 3000::double precision);
```

## Verification queries

Replace `:review_batch_id` with your batch id.

```sql
-- Candidates with matched_admin_area_id
SELECT
    count(*) FILTER (WHERE matched_admin_area_id IS NOT NULL) AS matched_count,
    count(*) AS total_with_point
FROM import_review.address_candidates
WHERE review_batch_id = :review_batch_id
  AND point_geom IS NOT NULL;

-- Inferred admin components by type and language
SELECT
    ac.component_type_code,
    ac.language_code,
    count(*) AS row_count
FROM import_review.address_components ac
INNER JOIN import_review.address_candidates c ON c.id = ac.address_candidate_id
WHERE c.review_batch_id = :review_batch_id
  AND ac.is_deleted = false
  AND ac.source_admin_area_id IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- Sample rows with boundary metadata
SELECT
    ac.address_candidate_id,
    ac.component_type_code,
    ac.language_code,
    ac.component_value,
    ac.match_type,
    ac.confidence_score,
    ac.boundary_status,
    ac.address_usage,
    ac.source_admin_area_id
FROM import_review.address_components ac
INNER JOIN import_review.address_candidates c ON c.id = ac.address_candidate_id
WHERE c.review_batch_id = :review_batch_id
  AND ac.source_admin_area_id IS NOT NULL
  AND ac.is_deleted = false
ORDER BY ac.address_candidate_id, ac.component_type_code, ac.language_code
LIMIT 30;
```

## Idempotency

- Inserts skip when an active row already exists for `(address_candidate_id, component_type_code, language_code, component_value)`.
- Inserts skip when `is_reviewed = true` for the same `(candidate, type, language)` slot.
- Re-running updates `matched_admin_area_id` / `admin_match_*` from the latest spatial match.
