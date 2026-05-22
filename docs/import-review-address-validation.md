# Import review — address promotion validation

Validates `import_review.address_candidates` and child `address_components` before promotion to `core.core_addresses`. Does **not** promote.

Apply migration `045_address_validation_status_codes.sql` so `validation_status` accepts `valid` and `valid_with_warnings`.

## Endpoint

```http
POST /api/import-review/addresses/validate
Authorization: Bearer <admin token>
Content-Type: application/json
```

Provide **exactly one** of:

- `review_batch_id` — validate all candidates in the batch
- `candidate_ids` — validate specific ids

## Example response

```json
{
  "review_batch_id": "12",
  "candidate_count": 2,
  "summary": {
    "blocked": 1,
    "valid_with_warnings": 1,
    "valid": 0
  },
  "results": [
    {
      "address_candidate_id": "42",
      "validation_status": "blocked",
      "promotion_blockers": [
        {
          "code": "matched_admin_area_id_missing",
          "message": "matched_admin_area_id is required before promotion.",
          "severity": "error",
          "field": "matched_admin_area_id"
        }
      ],
      "promotion_warnings": [
        {
          "code": "matched_street_id_missing",
          "message": "matched_street_id is not set; street-level match is recommended.",
          "severity": "warning",
          "field": "matched_street_id"
        }
      ],
      "validated_at": "2026-05-22T10:15:00.000Z"
    },
    {
      "address_candidate_id": "43",
      "validation_status": "valid_with_warnings",
      "promotion_blockers": [],
      "promotion_warnings": [
        {
          "code": "entrance_geom_missing",
          "message": "entrance_geom is not set.",
          "severity": "warning",
          "field": "entrance_geom"
        }
      ],
      "validated_at": "2026-05-22T10:15:00.000Z"
    }
  ]
}
```

## Persisted fields

Per candidate:

| Field | Values |
|-------|--------|
| `validation_status` | `blocked` \| `valid_with_warnings` \| `valid` |
| `promotion_blockers` | JSON array of `{ code, message, severity: "error", ... }` |
| `promotion_warnings` | JSON array of `{ code, message, severity: "warning", ... }` |
| `validated_at` | `now()` |

Also mirrors blockers/warnings into legacy `validation_errors` / `validation_warnings`.

## Blockers

- `point_geom_missing`
- `matched_admin_area_id_missing`
- `no_address_components`
- `only_global_components` (only country/postcode/plus_code)
- `invalid_component_type_code`
- `invalid_language_code`
- `component_value_empty`
- `review_status_rejected`
- `promotion_status_promoted`
- `duplicate_core_address`

## Warnings

- `matched_street_id_missing`
- `house_number_missing`
- `postcode_missing`
- `english_components_incomplete` / `myanmar_components_incomplete`
- `admin_locality_hint`
- `village_settlement_extent` / `village_approximate_boundary`
- `confidence_below_threshold` (below 50)
- `entrance_geom_missing`

## Duplicate detection

Against active `core.core_addresses` when `point_geom` is set:

- **Close (≤10 m):** same `house_number`, `street_id`, and `admin_area_id` when all are present on both sides.
- **Within 30 m:** same `street_id`, `admin_area_id`, and `postcode`/`postal_code`, with compatible `house_number`.

Excludes the row already linked via `promoted_core_address_id`.

## Manual curl

```bash
# Whole batch
curl -sS -X POST "http://localhost:3001/api/import-review/addresses/validate" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"review_batch_id":"12"}' | jq .

# Specific candidates
curl -sS -X POST "http://localhost:3001/api/import-review/addresses/validate" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"candidate_ids":["42","43"]}' | jq .
```

## Verification SQL

```sql
SELECT
    id,
    validation_status,
    jsonb_array_length(promotion_blockers) AS blocker_count,
    jsonb_array_length(promotion_warnings) AS warning_count,
    validated_at
FROM import_review.address_candidates
WHERE review_batch_id = 12
ORDER BY id;
```
