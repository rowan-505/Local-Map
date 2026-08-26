# YBS Phase 6 Stop Resolution

**Full pipeline guide:** [`../README.md`](../README.md)

Resolve extracted YBS stops into shared stop candidates before Supabase import.

This tool does **not** insert, update, or delete Supabase data. It only:

- reads normalized or merged route JSON
- runs read-only `SELECT` queries against `transport.stops`, `transport.stop_names`, and `transport.source_links`
- writes db-prep JSON and reports under `tmp/transport-imports/ybs-all/`

## Goal

One physical bus stop should become one `transport.stops` row.
Many routes should share that stop through `transport.route_stops`.

## Input

Preferred:

```text
tmp/transport-imports/ybs-all/normalized/routes/*.json
```

Fallback when normalized routes are missing:

```text
tmp/transport-imports/ybs-all/merged/routes/*.json
```

## Output

```text
tmp/transport-imports/ybs-all/db-prep/stop-usages.json
tmp/transport-imports/ybs-all/db-prep/stop-candidates.json
tmp/transport-imports/ybs-all/db-prep/stop-resolution-plan.json
tmp/transport-imports/ybs-all/reports/phase6-stop-resolution-report.json
tmp/transport-imports/ybs-all/reports/phase6-stop-resolution-report.md
```

## Pipeline steps

1. Build stop usages from every route variant stop.
2. Normalize matching keys (`normalized_name_my`, `normalized_name_en`, `normalized_area_my`, `normalized_area_en`).
3. Group usages into stop candidates by the 4-part matching key.
4. Match candidates against existing Supabase stops.

## Variant code format

```text
<route_code>-D0
<route_code>-D1
```

Example: `YBS-1-D0`. D0/D1 are derived from `direction_id` and do not imply
geographic direction. Source `inbound`/`outbound` wording remains in existing
provenance keys and source-link IDs.

## Supabase source link external id

```text
stop:ybs_go:<candidate_key>
```

`candidate_key` is:

```text
normalized_name_my|normalized_name_en|normalized_area_my|normalized_area_en
```

## Match priority

1. `transport.source_links` exact match for `external_ybs_app` / `stop:ybs_go:<candidate_key>`
2. exact Myanmar + English name with compatible area metadata
3. exact Myanmar name + compatible area metadata
4. exact English name + compatible area metadata
5. name-only match → `needs_manual_review`

## Decision values

| Decision | Meaning |
|---|---|
| `reuse_existing_stop` | Safe reuse of an existing stop |
| `create_new_stop` | No safe existing match; create on import |
| `merge_additional_data_to_existing` | Reuse stop and fill only missing names/metadata |
| `needs_manual_review` | Ambiguous or risky match |
| `blocked_conflict` | Existing protected stop conflicts with extracted data |
| `blocked_missing_clean_name` | Missing clean Myanmar stop name |

## Protected existing stops

For `reviewed`, `verified`, or `manual_protected` stops:

- do not overwrite `name`, `name_mm`, `name_en`, or `geom`
- only safe `source_link` append is allowed
- conflicting extracted data becomes `blocked_conflict`

For `imported_unreviewed` or `needs_review` stops:

- may fill missing `name_mm` / `name_en`
- may add missing `stop_names` rows
- may add `source_link`
- may append `normalized_data.ybs_go`

## Geometry anchor fields (Phase 6 → Phase 7)

Each plan row with a safe existing match also includes:

| Field | Meaning |
|---|---|
| `existing_stop_id` | Matched `transport.stops.id` |
| `existing_stop_public_id` | Matched stop `public_id` |
| `existing_lng` / `existing_lat` | Existing stop coordinates when present |
| `existing_geom_geojson` | Point GeoJSON from existing stop |
| `existing_review_status` | Existing stop review status |
| `existing_match_reason` | Match method used in Phase 6 |
| `can_use_as_geometry_anchor` | `true` when reuse/merge match has readable geometry |

`can_use_as_geometry_anchor = true` only when:

- `existing_stop_id` is not null
- existing stop has `geom`
- decision is `reuse_existing_stop` or `merge_additional_data_to_existing`
- decision is not `blocked_conflict` or `needs_manual_review`

Phase 7 uses these anchors for interpolation. It does not treat risky name-only matches as anchors.

## Commands

Run with Supabase read-only matching (loads `apps/api/.env` automatically when present):

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-db-prepare/build-stop-resolution.ts \
  --run tmp/transport-imports/ybs-all
```

Use an explicit database URL:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-db-prepare/build-stop-resolution.ts \
  --run tmp/transport-imports/ybs-all \
  --database-url "$SUPABASE_DIRECT_DATABASE_URL"
```

Offline candidate grouping only:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-db-prepare/build-stop-resolution.ts \
  --run tmp/transport-imports/ybs-all \
  --skip-supabase
```

## Rules not done here

- No coordinate guessing
- No automatic merge for risky same-name stops
- No DB writes
- No dashboard/API changes

## Phase 7 geometry preparation

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-db-prepare/prepare-geometry.ts \
  --run tmp/transport-imports/ybs-all
```

Reads normalized routes and `db-prep/stop-resolution-plan.json`, then writes:

```text
db-prep/routes-with-geometry.json
reports/phase7-geometry-report.json
reports/phase7-geometry-report.md
```

Geometry rules (`placeholder_geometry_mode = straight_line_review`):

1. Build one deterministic straight LineString per variant (3–6 km) in a Yangon review staging bbox.
2. Place **new** stops evenly along that line by `stop_sequence` with tiny deterministic jitter (max 10 m).
3. Keep **reused existing** stop `geom` unchanged; store ideal review position in `normalized_data.review_geometry`.
4. Route path is always the 2-point straight line — never connect mixed existing/interpolated stop coordinates.
5. Never block import only because geometry is synthetic.
6. Mark placeholder geometry as `needs_review`, confidence `5`, `public_safe: false`, `do_not_publish: true`.

Phase 7 report summary includes per-variant:

- `stop_count`
- `placeholder_line_created`
- `route_path_length_km`
- `expected_visual_line_length_km`
- `generated_stop_points_count`
- `reused_existing_stop_count`
- `existing_reused_stops_not_moved_count`
- `reused_existing_stops_off_line_warning`

Allowed warnings:

- `PLACEHOLDER_GEOMETRY_USED`
- `VALIDATOR_REQUIRED`
- `LOW_GEOMETRY_CONFIDENCE`
- `REUSED_STOPS_OFF_PLACEHOLDER_LINE`

Offline mode:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-db-prepare/prepare-geometry.ts \
  --run tmp/transport-imports/ybs-all \
  --skip-supabase
```
