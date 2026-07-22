# Conflict-only remote review — places pilot (2026-07-22)

Snapshot: `osm_myanmar_2026_05_15_kyauktan_v2`  
Package: `remote_review_conflicts_osm_myanmar_2026_05_15_kyauktan_v2`  
Remote batch: `import_review.review_batches.id = 5`

## Result

| Check | Result |
|-------|--------|
| Stage J conflict-only package | **34** rows (11 `duplicate` + 23 `manual_protected`) |
| Pre-upload reconciliation | `valid(117) = direct_core(83) + unchanged(0) + ir_conflicts(34)` |
| Skipped classes | `safe_new`, `safe_update`, `unchanged`, `invalid` not packaged |
| Initial IR state | `review_status=pending`, `review_decision=NULL`, `promotion_status=not_ready` |
| Stage K upload | 34 inserted; count assertion PASS |
| Same-snapshot Stage J refresh | auto-replace package |
| Stage K re-upload | 34 pending refreshed |
| Preserve reviewed | 1 `approved` preserved; 33 pending refreshed |

## Payload fields (sample)

Each package item includes: `import_class`, `matched_core_id`, `imported_values`, `core_snapshot`, `difference_summary`, `apply_status=not_ready`, `promotion_status=not_ready`.

## How to re-run

```bash
source imports/kyauktan_2026_05_15_v2.env
export ENTITY_FAMILIES=places
export REMOTE_REVIEW_ENTITY_FAMILY=places
# REMOTE_REVIEW_CONFLICT_ONLY=true (default)
# REMOTE_REVIEW_PACKAGE_NAME=remote_review_conflicts_<SNAPSHOT_VERSION>

psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families=places \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -v conflict_only=true \
  -f 11_prepare_remote_review_package.sql

npx tsx ./12_upload_remote_review_package.ts
```

## Not done

- Dashboard / status UI simplification
- Upload of other families
- Stage L Part B still needs `import_review` on the connection (local L is LOCAL_ONLY; Stage K asserts remote counts)
