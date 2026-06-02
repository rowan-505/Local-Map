# Import review — `review_overrides` migration scripts

Scripts in this folder are numbered **000–004** for the `review_overrides` → typed columns cutover.
They are **not** applied automatically by Supabase CLI; run them manually in order when migrating an environment.

## Apply migrations (schema + data)

Run once per database from [../supabase/](../supabase/):

| Order | File | Phase |
|------:|------|-------|
| 1 | `082_import_review_review_overrides_archive.sql` | Archive `review_overrides` → `review_overrides_archive` |
| 2 | `082a_import_review_review_column_alignment.sql` | Add typed columns (names, road extras, etc.) |
| 3 | `083_import_review_merge_review_overrides_into_columns.sql` | Merge overrides into columns |
| 4 | `084_drop_import_review_review_overrides.sql` | Guarded drop of live `review_overrides` columns |

Use **Supabase SQL Editor** (session pooler, port **5432**) or `psql` with `ON_ERROR_STOP=1`.

## Verify / inventory (this folder)

| File | When to run |
|------|----------------|
| `000_review-overrides-inventory.sql` | Planning / audit (read-only) |
| `001_review-overrides-archive-verify.sql` | After **082** |
| `002_review-overrides-column-alignment-verify.sql` | After **082a** |
| `003_review-overrides-merge-verify.sql` | After **083** (quick checks, no hard stop) |
| `004_review-overrides-phase3-verification-gate.sql` | After **083** — **required before Phase 4** |

Example:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/migrations/import-review/004_review-overrides-phase3-verification-gate.sql
```

**Pass (Phase 3):** all `fail_count` = 0 and notice `Phase 3 gate: PASSED`.

**Quick check:** `003_review-overrides-merge-verify.sql` — HS-2 / HS-3 `mismatch_count` = 0.

## Phase 4 API (apps/api)

- `PATCH /api/import-review/:family/:id` — writes typed columns + `review_candidate_edits` (`edit_type = column_update`).
- `PATCH …/overrides` — deprecated shim; same column write path (no `review_overrides` merge when `IMPORT_REVIEW_USE_COLUMN_PATCH` is true, default).
- Rollback: set `IMPORT_REVIEW_USE_COLUMN_PATCH=false` to restore JSON merge behavior.

## Other

| File | Purpose |
|------|---------|
| `010_road-promotion-blocker-breakdown.sql` | Road promotion blocker diagnostics (separate workflow) |

## Notes

- `083` does **not** drop `review_overrides`; `084` performs guarded drop after Gate D and empty-column checks.
- Invalid FK ids in overrides (e.g. stale `building_type_id`) are skipped during merge; fix manually before final cleanup.
