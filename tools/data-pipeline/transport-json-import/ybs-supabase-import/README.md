# YBS Supabase import (Phases 8–10)

Import YBS bus routes from prepared JSON into `transport.*`.

**Start here for the full pipeline:** [`../README.md`](../README.md)

## Folder layout

```text
ybs-supabase-import/
├── lib/           shared types, executor, cleanup helpers
├── import/        Phase 8 dry-run plan + Phase 9 execute + orchestrator
├── validate/      Phase 10 + legacy cleanup validation
├── repair/        in-place DB fixes (names, geometry, stops)
├── cleanup/       test route removal + Phase D legacy cleanup
├── generators/    markdown command sheets
├── test/          YBS-1/YBS-2 reference flow
└── docs/          batch workflow recipes
```

## Main entry points

| Task | Script |
|------|--------|
| Full import (recommended) | `import/run-ybs-import-workflow.ts` |
| Single-route import | `import/import-ybs-plan.ts` |
| Dry-run plan only | `import/build-dry-run-plan.ts` |
| Validate one route | `validate/validate-imported-ybs.ts` |
| Validate all routes | `validate/validate-all-imported-bus.ts` |
| Legacy bus cleanup | `cleanup/cleanup-legacy-bus-routes.ts` |
| Orphan stop cleanup | `cleanup/cleanup-orphan-legacy-stops.ts` |

## Quick commands

```bash
# Orchestrator dry-run
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/run-ybs-import-workflow.ts \
  --source-dir tmp/transport-imports/ybs-all/merged/routes \
  --routes YBS-1 \
  --run-root tmp/transport-imports/ybs-one-at-a-time/YBS-1 \
  --dry-run --allow-placeholder-geometry --allow-high-risk

# Phase 8 plan only
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/build-dry-run-plan.ts \
  --run tmp/transport-imports/ybs-all

# Phase 9 single route
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/import-ybs-plan.ts \
  --run tmp/transport-imports/ybs-all --route-code YBS-1 --execute
```

See [`docs/YBS-IMPORT-WORKFLOW.md`](docs/YBS-IMPORT-WORKFLOW.md) for batch and all-routes recipes.

## External ID patterns

| Entity | Pattern |
|--------|---------|
| route | `route:ybs_go:<route_code>` |
| variant | `variant:ybs_go:<route_code>:<direction_key>` |
| stop | `stop:ybs_go:<route_code>:<direction_key>:seq:<sequence>` |
| route_stop | `route_stop:ybs_go:<route_code>:<direction_key>:<sequence>` |
| route_path | `route_path:ybs_go:<route_code>:<direction_key>` |

## Safety

- Default is dry-run; `--execute` required for writes.
- Orchestrator also needs `--confirm-import` (and `--confirm-all-routes` for full batch).
- Never overwrites `reviewed`, `verified`, or `manual_protected` rows.
- One database transaction per route on execute.
