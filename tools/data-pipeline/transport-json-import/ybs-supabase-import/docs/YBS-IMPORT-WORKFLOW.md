# YBS import workflow commands

Safe orchestration for importing YBS routes from merged JSON files into `transport.*`.

Default mode is **dry-run**. No database writes unless both `--execute` and `--confirm-import` are provided.

## Prerequisites

- Merged route JSON files in `tmp/transport-imports/ybs-all/merged/routes`
- Database URL in `apps/api/.env` (`SUPABASE_DIRECT_DATABASE_URL` or `DATABASE_URL`)
- YBS-1 and YBS-2 are the reference imports for naming, geometry, and source_link behavior

## Selected route batch (YBS-3, YBS-4, YBS-5)

### 1. Dry-run

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-3,YBS-4,YBS-5 \
  --run-root tmp/transport-imports/ybs-batch-YBS-3-YBS-4-YBS-5 \
  --dry-run \
  --allow-placeholder-geometry \
  --allow-high-risk
```

### 2. Execute (manual only)

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-3,YBS-4,YBS-5 \
  --run-root tmp/transport-imports/ybs-batch-YBS-3-YBS-4-YBS-5 \
  --execute \
  --allow-placeholder-geometry \
  --allow-high-risk \
  --confirm-import
```

### 3. Validation

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate/validate-imported-ybs.ts \
  --routes YBS-3,YBS-4,YBS-5 \
  --run-root tmp/transport-imports/ybs-batch-YBS-3-YBS-4-YBS-5
```

## All routes batch

### 4. Dry-run

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --all-routes \
  --run-root tmp/transport-imports/ybs-all-routes-import \
  --dry-run \
  --allow-placeholder-geometry \
  --allow-high-risk
```

### 5. Execute (manual only)

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --all-routes \
  --run-root tmp/transport-imports/ybs-all-routes-import \
  --execute \
  --allow-placeholder-geometry \
  --allow-high-risk \
  --confirm-import \
  --confirm-all-routes
```

### 6. Validation

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate/validate-all-imported-bus.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --run-root tmp/transport-imports/ybs-all-routes-import
```

## Safety rules

| Rule | Behavior |
| --- | --- |
| Default mode | Dry-run (no DB writes) |
| Execute | Requires `--execute` and `--confirm-import` |
| All routes execute | Also requires `--confirm-all-routes` |
| Batch blockers | If any route has blockers, no route in the batch is executed |
| Import order | Sequential, one route at a time |
| First failure | Stops the batch (no `--continue-on-route-error`) |
| Protected rows | Existing `reviewed` / `verified` / `manual_protected` rows are not overwritten |
| Public visibility | Imported routes stay hidden (`imported_unreviewed`, `is_active=false`) |
| Cleanup | This workflow does not delete existing bus data |

## Run-root layout

```text
<run-root>/
  input/
  normalized/routes/
  db-prep/
  geometry/
  plans/
  reports/
  logs/
  supabase-dry-run/plan.json
```

## Reports

Written under `<run-root>/reports/`:

- `normalization-report.{json,md}`
- `stop-resolution-report.{json,md}`
- `geometry-report.{json,md}`
- `dry-run-plan-report.{json,md}`
- `import-execute-report.{json,md}` (after execute attempt)
- `validation-report.{json,md}` (after successful execute)
- `final-summary.{json,md}`
- `route-code-map.json`

## Route code rules

- Numbered routes: `YBS-<number>` (suffix like `YBS-70-A` when needed)
- Named/no-number routes: stable uppercase ASCII slug (for example `APS`, `AIRPORT-SHUTTLE`)
- Phase C A/B/C routes: separate codes such as `YBS-7-A`, `YBS-7-B` (not collapsed to `YBS-7`)
- `route-code-map.json` records source file key → resolved `route_code`

## Phase B — cleanup and re-import (60 routes)

Phase B routes are blocked by a pre-existing `transport.routes` row without `route:ybs_go:<CODE>` source link.

### Generate command file

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/generators/generate-phase-b-commands.ts \
  --all-phase-b \
  --batch-size 10 \
  --out tmp/transport-imports/ybs-phase-b/phase-b-commands.md
```

Test trio only:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/generators/generate-phase-b-commands.ts \
  --routes YBS-10,YBS-11,YBS-12 \
  --out tmp/transport-imports/ybs-phase-b/phase-b-test-commands.md
```

### Per-route sequence

For each route, run in order:

1. Cleanup dry-run (`cleanup-test-ybs-route.ts`, default mode; `--dry-run` is an explicit alias)
2. Review `<run>/reports/cleanup-<ROUTE>.md` — stop if `status=refused` or counts look wrong
3. Cleanup execute (`--execute --allow-non-ybs-route`)
4. Import dry-run (`run-ybs-import-workflow.ts`)
5. Review `reports/final-summary.md` — stop if blockers > 0
6. Import execute (`--execute --confirm-import`)
7. Validate (`validate-imported-ybs.ts` with matching `--run-root`)

Example for YBS-10:

```bash
# Cleanup dry-run
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup/cleanup-test-ybs-route.ts \
  --route-code YBS-10 \
  --allow-non-ybs-route \
  --run tmp/transport-imports/ybs-phase-b/YBS-10

# Cleanup execute
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup/cleanup-test-ybs-route.ts \
  --route-code YBS-10 \
  --allow-non-ybs-route \
  --execute \
  --run tmp/transport-imports/ybs-phase-b/YBS-10

# Import dry-run
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-10 \
  --run-root tmp/transport-imports/ybs-phase-b/YBS-10 \
  --dry-run \
  --allow-placeholder-geometry \
  --allow-high-risk

# Import execute
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-10 \
  --run-root tmp/transport-imports/ybs-phase-b/YBS-10 \
  --execute \
  --allow-placeholder-geometry \
  --allow-high-risk \
  --confirm-import

# Validate
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate/validate-imported-ybs.ts \
  --routes YBS-10 \
  --run-root tmp/transport-imports/ybs-phase-b/YBS-10
```

Phase B cleanup uses `--run` (or `--run-root` alias). Import and validate use `--run-root`.

Recommended order: test trio (YBS-10, YBS-11, YBS-12), then groups 1–6 from the generated markdown.

## Phase C — separate A/B/C route codes

Phase C imports hyphenated suffix routes as distinct codes (for example `YBS-7-A`, `YBS-89-C`).

### Generate command file

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/generators/generate-phase-c-commands.ts \
  --all-phase-c \
  --out tmp/transport-imports/ybs-phase-c/phase-c-commands.md
```

### Per-route sequence

Usually no cleanup is needed unless dry-run shows a blocker for that exact `route_code`.

1. Import dry-run
2. Confirm `reports/route-code-map.json` shows the hyphenated code (not parent without suffix)
3. Import execute
4. Validate

Example for YBS-7-A:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-7-A \
  --run-root tmp/transport-imports/ybs-phase-c/YBS-7-A \
  --dry-run \
  --allow-placeholder-geometry \
  --allow-high-risk

npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-7-A \
  --run-root tmp/transport-imports/ybs-phase-c/YBS-7-A \
  --execute \
  --allow-placeholder-geometry \
  --allow-high-risk \
  --confirm-import

npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate/validate-imported-ybs.ts \
  --routes YBS-7-A \
  --run-root tmp/transport-imports/ybs-phase-c/YBS-7-A
```

Expected after normalization:

- `route_code`: `YBS-7-A`
- `display_code`: `YBS 7-A`
- `variant_code`: `YBS-7-A-D0`, `YBS-7-A-D1`
- `direction_name`: `D0`, `D1` (neutral labels; no geographic meaning)
- `source_links`: `route:ybs_go:YBS-7-A`, `variant:ybs_go:YBS-7-A:inbound`, etc.

Old parent rows like `YBS-7` may remain until optional manual cleanup.

## Phase scripts reused

The orchestrator calls existing phase modules directly:

1. Phase 5: `normalize-merged-routes.ts`
2. Phase 6: `build-stop-resolution.ts`
3. Phase 7: `prepare-geometry.ts`
4. Phase 8: `build-dry-run-plan.ts`
5. Phase 9: `import-ybs-plan.ts` (`runImport`)
6. Phase 10: `validate-imported-ybs.ts`

## After import

Review routes in the transport dashboard before making any route public.

If stop `source_link` entity_id mismatches appear (same root cause as YBS-2), run:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair/repair-stop-source-link-targets.ts \
  --route-code YBS-<number> \
  --run-root <run-root> \
  --execute
```
