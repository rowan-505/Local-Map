# Import-review address promotion

Promotes approved `import_review.address_candidates` (with `import_review.address_components`) into `core.core_addresses` and `core.core_address_components`. Full address on core is a **readonly cache** composed from components (Myanmar first, then English).

## Prerequisites

- Migrations **040–046** applied (especially **045** validation codes, **046** core component columns + `duplicate_review_needed`).
- `ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION=true` for live promote (dry-run works without it).
- Candidate **validated** and **approved**; use `confirm_warnings: true` when `validation_status = valid_with_warnings`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/import-review/addresses/promote-dry-run` | Plan promotion (no core writes) |
| POST | `/api/import-review/addresses/promote` | Transactional promote per request |

Body (exactly one scope):

```json
{
  "candidate_ids": ["12345"],
  "confirm_warnings": false
}
```

or `{ "review_batch_id": "99", "confirm_warnings": true }`.

## Dry-run response example

```json
{
  "dry_run": true,
  "review_batch_id": null,
  "candidate_count": 1,
  "promoted": 1,
  "skipped": 0,
  "duplicate_review_needed": 0,
  "failed": 0,
  "warnings": [],
  "items": [
    {
      "address_candidate_id": "12345",
      "external_id": "node/4829101",
      "outcome": "would_promote",
      "reasons": [],
      "core_address_id": null,
      "promotion_warnings": [],
      "promotion_blockers": []
    }
  ],
  "finished_at": "2026-05-22T12:00:00.000Z",
  "disabled_because_env_flag_false": true,
  "message": "Dry-run only: set ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION=true to execute promotion."
}
```

## Promotion response example

```json
{
  "dry_run": false,
  "review_batch_id": null,
  "candidate_count": 1,
  "promoted": 1,
  "skipped": 0,
  "duplicate_review_needed": 0,
  "failed": 0,
  "warnings": [],
  "items": [
    {
      "address_candidate_id": "12345",
      "external_id": "node/4829101",
      "outcome": "promoted",
      "reasons": [],
      "core_address_id": "901",
      "promotion_warnings": [],
      "promotion_blockers": []
    }
  ],
  "finished_at": "2026-05-22T12:01:00.000Z"
}
```

Duplicate candidate (live promote):

```json
{
  "outcome": "duplicate_review_needed",
  "reasons": ["duplicate_core_address"],
  "promotion_blockers": [
    {
      "code": "duplicate_core_address",
      "message": "Possible duplicate core address id=42 (~8m).",
      "severity": "error"
    }
  ]
}
```

Candidate row: `promotion_status = duplicate_review_needed`, blockers persisted; **source_tags are not modified**.

## Verification SQL

```sql
-- Latest core addresses
SELECT id, public_id, full_address, house_number, unit_number, street_id, admin_area_id,
       postal_code, postcode, is_verified, is_public, confidence_score, created_at
FROM core.core_addresses
WHERE deleted_at IS NULL
ORDER BY id DESC
LIMIT 10;

-- Components for latest core addresses
SELECT c.id, c.address_id, c.component_type_code, c.language_code, c.component_value,
       c.confidence_score, c.match_type, c.sort_order
FROM core.core_address_components AS c
WHERE c.address_id IN (
    SELECT id FROM core.core_addresses ORDER BY id DESC LIMIT 3
)
ORDER BY c.address_id DESC, c.sort_order, c.component_type_code, c.language_code;

-- Place links
SELECT pa.place_id, pa.address_id, pa.relation_type, pa.is_primary, pa.created_at
FROM core.core_place_addresses AS pa
ORDER BY pa.created_at DESC NULLS LAST
LIMIT 20;

-- Review candidates promoted
SELECT id, external_id, promotion_status, promoted_core_address_id, promoted_at, validation_status
FROM import_review.address_candidates
WHERE promotion_status IN ('promoted', 'duplicate_review_needed')
ORDER BY updated_at DESC
LIMIT 20;
```
