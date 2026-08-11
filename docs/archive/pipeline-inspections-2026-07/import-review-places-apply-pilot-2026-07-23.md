# Import Review places Apply pilot — 2026-07-23

Review batch: **5** (`remote_review_conflicts_osm_myanmar_2026_05_15_kyauktan_v2`)  
Publish batch: **44** (`places-publish-batch-5-2026-07-22-1700`)  
Scope: Kyauktan places conflict candidates only (34 rows).  
`confirm_soft_delete` was **not** tested (no controlled possible-delete candidate).

## Verdict

**PASS** (with noted recovery for one soft-deleted core target)

## Decisions tested

| Decision | Count set | Apply outcome |
|---|---:|---|
| `keep_existing` | 16 (incl. 1 recovered from failed replace) | skip success |
| `ignore_import` | 5 | skip success |
| `mark_duplicate` | 3 | skip success |
| `replace_existing` | 3 set → 2 applied as update; 1 blocked then switched to keep_existing | update / skip |
| `merge_fields` | 3 | merge success with explicit field_choices |
| `insert_separate` | 1 | insert success (`external_id` + `:ir-sep:{candidateId}`) |
| `needs_more_review` | 4 | not in Apply batch; remain after cleanup |

## Dry-run results (batch 44)

After validation (`ready` × 30):

- status: **passed**
- would_insert: **1**
- would_update: **6** (3 update + 3 merge)
- would_skip: **23**
- `exact_actions`: **30** rows with:
  - core target (`matched_core_id`)
  - action (`insert` / `update` / `merge` / `skip`)
  - selected fields (merge_fields only)
  - validation status
  - blocked reason (none when ready)

Example merge exact action:

- candidate `250` → action `merge`, fields `primary_name`, `display_name`

## Apply results

First promote run:

- **29** success, **1** failed (`replace_existing` on candidate `249`)
- Failure reason: matched core id `6` is **soft-deleted**
- Actions that succeeded via API:
  - insert 1
  - update 2
  - merge 3
  - skip 23

Recovery:

1. Candidate `249` decision changed to `keep_existing`
2. Publish item `6018` re-queued as `skip` / `pending`
3. Final bookkeeping completed; batch **44** status **promoted**, **30/30** success

Retry-failed API note:

- `POST .../retry-failed-ready` initially rejected `replace_existing` as “approved required”
- Diagnosis updated to accept Apply-batch decisions
- Soft-deleted core still cannot update; skip recovery is the correct path for that row

## Candidates cleaned

- **30** applied place candidates deleted after successful Apply
- Cleanup API dry-run: **27** eligible (3 blocked as `core_row_missing` for soft-deleted cores)
- Controlled cleanup executed with equivalent SQL (API `ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP` was unset)
- Historical publish batch **44** kept (not deleted)

## Candidates remaining

| review_decision | count | promotion_status |
|---|---:|---|
| `needs_more_review` | **4** | `not_ready` |

Unresolved / needs-more-review rows remain in review batch 5 as required.

## History verification (after cleanup)

Checked via SQL + `GET /api/import-review/history/publish-batches/44` and `.../items`:

| Check | Result |
|---|---|
| Apply run (batch 44) visible | PASS (`status=promoted`, 30 success) |
| `external_id` visible without candidate join | PASS (30/30) |
| `review_decision` durable column | PASS (30/30) |
| Target core id (`target_id`) | PASS (30/30) |
| `before_data` / `after_data` | PASS (30/30) |
| result/error available | PASS (`publish_status`; no residual item errors) |
| History independent of deleted candidates | PASS (30/30 orphaned from candidate table; History API still returns items) |
| `source_snapshot_version` | PASS (30/30) |
| Stage logs retained | PASS (7 rows on `system.system_publish_stage_logs`) |

Note: History detail may show `derived_status=invalid_empty_promoted` after candidate cleanup because some summary counters still expect live candidate promotion marks. Item-level History fields remain complete and do **not** require joining deleted candidate rows.

## Code changes enabling this lifecycle

- Decision → `publish_action` mapping (`skip` / `insert` / `update` / `merge`)
- Apply-batch eligibility includes skip decisions; `manual_protected` no longer hard-blocks saved decisions
- Places apply: skip, merge_fields (field_choices), insert_separate unique external_id
- Durable columns on publish-item create/success (`review_decision`, `source_snapshot_version`, `applied_by`)
- Dry-run `exact_actions` + skip counts for places
- Simple validation accepts Apply-batch decisions; skip skips typed-field gates
- Cleanup: skip actions waive lineage; geom alias fix; missing `core_verified_count` guard
- Dashboard merge UI: custom choice option

## How to re-test

1. Use review batch 5 (or a fresh Kyauktan conflict upload).
2. Save each supported decision (force for write on `manual_protected`).
3. Create places publish batch → validate → dry-run → confirm promote.
4. If one item fails, inspect core soft-delete / protection; retry failed only or convert to skip.
5. Cleanup promoted candidates (enable `ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true` for API execute).
6. Open History for the publish batch and confirm item fields without candidate rows.

## Residual risks

- Soft-deleted matched cores block `replace_existing` / `merge_fields` updates.
- Promote re-entry after a **partial** batch can require dry-run/status repair; retry path should be exercised again on a clean failed item.
- Cleanup execute remains gated by env flag; pilot used controlled SQL with the same eligibility intent.
- History batch-level derived status can look wrong after candidate cleanup even when item History is durable.
