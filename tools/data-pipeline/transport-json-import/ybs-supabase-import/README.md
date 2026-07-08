# YBS Phase 8 Supabase Dry-Run Import Plan

Build a complete Supabase import plan without writing to the database.

## Input

```text
tmp/transport-imports/ybs-all/db-prep/routes-with-geometry.json
tmp/transport-imports/ybs-all/db-prep/stop-resolution-plan.json
```

## Output

```text
tmp/transport-imports/ybs-all/supabase-dry-run/plan.json
tmp/transport-imports/ybs-all/reports/phase8-supabase-dry-run.json
tmp/transport-imports/ybs-all/reports/phase8-supabase-dry-run.md
```

## Command

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/build-dry-run-plan.ts \
  --run tmp/transport-imports/ybs-all
```

Loads `apps/api/.env` automatically for read-only Supabase catalog lookups.

## What the plan includes

- `create_import_batch`
- operator upsert + `source_links`
- route insert/update/skip decisions
- route names, variants, stops, stop names
- route_stops and route_paths (only for geometry-ready variants)
- fares
- `source_links` for every inserted or reused entity
- blockers and conflicts

## Protection rules

Never overwrite `reviewed`, `verified`, or `manual_protected` rows.

For mergeable rows (`imported_unreviewed`, `needs_review`):

- routes may be updated safely
- stops may receive missing names/metadata only

## External IDs

| Entity | Pattern |
|---|---|
| operator | `operator:ybs_go:<operator_code>` |
| route | `route:ybs_go:<route_code>` |
| variant | `variant:ybs_go:<route_code>:<direction_key>` |
| stop | `stop:ybs_go:<route_code>:<direction_key>:seq:<sequence>` (direction-aware; legacy `stop:ybs_go:<candidate_key>` still read for matching) |
| route_stop | `route_stop:ybs_go:<route_code>:<direction_key>:<sequence>` |
| route_path | `route_path:ybs_go:<route_code>:<direction_key>` |
| fare | `fare:ybs_go:<route_code>` |

## Review status defaults

| Entity | Default |
|---|---|
| operators | `imported_unreviewed` |
| routes | `imported_unreviewed` |
| route_variants | `imported_unreviewed` |
| stops | `needs_review` |
| route_paths | `needs_review` |
| fares | `imported_unreviewed` |

## Rules not done here

- No Supabase inserts, updates, or deletes
- No dashboard/API changes
- No silent `source_link` skips

Phase 9 execution should read `supabase-dry-run/plan.json` and apply only safe actions.

---

# YBS Phase 9 Safe Importer (one route)

Import **one** route from the Phase 8 plan into `transport.*`. Default is dry-run.
Real writes happen only with `--execute`.

## Files

```text
import-ybs-plan.ts    CLI: parse args, load plan, dry-run or execute, write outputs
import-executor.ts    one transaction per route; ordered table inserts; rollback on failure
source-link-utils.ts  check-before-insert source_links (no duplicates)
```

## Input

```text
tmp/transport-imports/ybs-all/supabase-dry-run/plan.json
```

## Output

```text
tmp/transport-imports/ybs-all/supabase-import/import-result-<route_code>.json
tmp/transport-imports/ybs-all/reports/phase9-import-<route_code>.md
```

## Commands

Dry-run (no writes):

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import-ybs-plan.ts \
  --run tmp/transport-imports/ybs-all --route-code YBS-1
```

Execute (writes to database):

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import-ybs-plan.ts \
  --run tmp/transport-imports/ybs-all --route-code YBS-1 --execute
```

## Import order (one transaction per route)

1. `import_batches`
2. `operators`
3. `routes`
4. `route_names`
5. `route_variants`
6. `stops`
7. `stop_names`
8. `route_stops`
9. `route_paths`
10. `fares`
11. `source_links`
12. `import_errors` (non-fatal skipped items)

## Safety rules

- Default is dry-run; only `--execute` writes.
- Only the route from `--route-code` is imported.
- One transaction per route. A critical insert failure rolls back the whole route.
- Reviewed, verified, and manual_protected rows are never overwritten. Route and
  stop merges are skipped and recorded as conflicts instead.
- `source_links` are checked before insert (unique key
  `entity_type + source_name + source_kind + external_id`) so no duplicates are made.

## Defaults applied on insert

```text
mode = bus            route_kind = urban       stop_type = stop
currency_code = MMK   pickup_type = 0          drop_off_type = 0
is_timing_point = false   is_active = true
source_refs = { ybs_go: { source_name, source_kind, phase, ... } }
normalized_data = { ..., import_phase: "phase9_safe_import" }
```

## Notes

- Because Phase 7 blocked variants/paths for some routes, a plan may contain no
  `route_variant`/`route_stop`/`route_path` actions. The importer still imports
  operators, routes, names, stops, stop_names, fares, and source_links safely.
- The result JSON lists all inserted/reused IDs, per-table counts, and skipped or
  conflicting rows.

---

# YBS Phase 10 DB Validation (read-only)

Validate imported YBS data in `transport.*` after Phase 9.

## File

```text
validate-imported-ybs.ts
```

## Commands

Single route:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-imported-ybs.ts \
  --run tmp/transport-imports/ybs-all --route-code YBS-1
```

All routes with YBS `source_links`:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-imported-ybs.ts \
  --run tmp/transport-imports/ybs-all --all-imported-ybs
```

## Output

```text
tmp/transport-imports/ybs-all/reports/phase10-db-validation-<route_code>.json
tmp/transport-imports/ybs-all/reports/phase10-db-validation-<route_code>.md
```

## Checks (21)

1. Route exists
2. Route has `source_link`
3. Route has `my` and `en` `route_names`
4. Route has outbound and inbound variants
5. Each variant has `source_link`
6. Each variant has `route_stops`
7. `route_stops` sequence starts at 1
8. `route_stops` sequence is contiguous from 1 to the variant stop count
9. `route_stops` has no duplicate sequence
10. Each `route_stop` has `source_link`
11. Each `route_stop` has valid `stop_id`
12. Each stop has `geom`
13. Each stop has `name_mm` or `name_en`
14. Each stop has `source_link`
15. No stop name contains `မှတ်တိုင် အမှတ်`
16. No stop name equals `Bus Details` or `Bus Stops`
17. Each variant has `route_path`
18. Each `route_path` has `geom`
19. Each `route_path` has `source_link`
20. Estimated paths use `path_kind = corridor_estimate`
21. Public visibility is hidden unless `review_status` is `reviewed` or `verified`
    (checked against `tiles.transport_route_paths_v`)

## Report fields

- `status`: passed or failed
- `table_counts`
- `source_links_missing_count`
- `sequence_error_count`
- `geometry_missing_count`
- `duplicate_warning_count`
- `blockers`, `warnings`, `checks`

## Test route cleanup

Remove a test YBS import so you can re-import cleanly. Dry-run by default.

```bash
# Route tree cleanup
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-test-ybs-route.ts \
  --route-code YBS-2 \
  --require-status imported_unreviewed \
  --execute

# Orphan stop cleanup after route is gone
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-test-ybs-route.ts \
  --route-code YBS-2 \
  --cleanup-orphan-stops \
  --run tmp/transport-imports/ybs-flow-test-ybs1-ybs2 \
  --execute
```

Rules:

- Only routes with `review_status` `imported_unreviewed` or `needs_review` (or a single `--require-status` value).
- Refuses `reviewed`, `verified`, or `manual_protected`.
- Requires a YBS `source_link` on the route (`route:ybs_go:…`) for route-tree cleanup.
- `--cleanup-orphan-stops` works when the route is already deleted.
- Deletes in safe order: `source_links` → `route_stops` → `route_paths` → `route_variants` → `fares` → `route_names` → `route`.
- Before deleting YBS-imported stops, clears blocking FK refs: `terminals.linked_stop_id`, other `route_variants` origin/destination, child `stops.parent_stop_id`.
- Orphan stop cleanup matches `stop:ybs_go:*` source links, `normalized_data.ybs_go.variant_code` for the route, and optional `--run` geometry hints.
- Orphan stops are hard-deleted only when they have zero `route_stops` usage. Use `--soft-delete-stops` to reject/deactivate instead.
- Shared pre-existing stops are never deleted.
- Writes JSON + Markdown report under `<run>/reports/cleanup-<route-code>.{json,md}`.

## Repair route_stop review geometry (in place)

Fix scattered dashboard stop markers on placeholder routes without re-importing or
changing `transport.stops.geom`.

Requires migration `123_transport_route_stops_review_geom.sql`.

```bash
# Dry-run
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair-route-stop-review-geometry.ts \
  --route-code YBS-2 \
  --mode straight_line_review \
  --run tmp/transport-imports/ybs-flow-test-ybs1-ybs2

# Execute
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair-route-stop-review-geometry.ts \
  --route-code YBS-2 \
  --mode straight_line_review \
  --run tmp/transport-imports/ybs-flow-test-ybs1-ybs2 \
  --execute
```

Rules:

- Dry-run by default; only `--execute` writes.
- Updates only `transport.route_stops.review_geom` and `review_geometry_data`.
- Never changes `transport.stops.geom`.
- Uses existing `straight_line_review` `corridor_estimate` route paths.
- Refuses protected route `review_status` values.

## Split opposite-direction stops (in place)

Repair routes where inbound and outbound `route_stops` point to the same `stop_id`.
Creates direction-specific stop rows for outbound (keeps inbound on the original stop).

```bash
# Dry-run
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/split-opposite-direction-stops.ts \
  --route-code YBS-2

# Execute
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/split-opposite-direction-stops.ts \
  --route-code YBS-2 \
  --execute
```

Rules:

- Dry-run by default; only `--execute` writes.
- Keeps inbound on the original stop; clones outbound to a new `transport.stops` row.
- Sets `review_status = needs_review`, `confidence_score = 5`, `normalized_data.direction_split = true`.
- Creates source_link `stop:ybs_go:<route_code>:outbound:seq:<sequence>` on the new stop.
- Skips `reviewed`, `verified`, and `manual_protected` stops.
- Allows reuse only when `normalized_data.shared_terminal = true`.

## Rules

- Read-only Supabase (`BEGIN READ ONLY`)
- No inserts, updates, or deletes
- No dashboard/API changes
