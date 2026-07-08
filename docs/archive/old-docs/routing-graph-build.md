---
status: archived
reason: replaced by docs/08-search-address-routing/routing.md
archived_at: 2026-07-01
---

# Routing graph build (Phase 9E)

Generate a **tiny**, rebuildable routing graph from selected `core.core_streets` rows into:

- `routing.routing_nodes`
- `routing.routing_edges`
- `routing.routing_edge_names`
- `routing.routing_build_jobs`
- `routing.routing_build_metadata` (legacy table — extended counters stored in `summary` jsonb)
- `routing.routing_validation_reports`

**Does not** ingest `routing.routing_turn_restrictions` yet (warning only).

## Architecture

| Layer | Role |
|-------|------|
| `core.core_streets` | Source of truth for road geometry + attributes |
| `routing.routing_*` | Generated graph output scoped by `build_job_id` |
| Rebuild | Create a new build job; prior job rows cascade-delete with the job |

### Phase 9E v1: endpoint-only graph

Each selected street becomes **one edge** between **start/end endpoint nodes**.

- MultiLineString core geometry → longest LineString part (same as road promotion)
- Nodes deduplicated with `ST_SnapToGrid(..., 1e-7)`
- **No intersection splitting yet** → validation warning `INTERSECTION_SPLITTING_NOT_IMPLEMENTED`
- Crossing streets without shared nodes → `DISCONNECTED_ENDPOINT`

Phase **9E2** (future): split lines at intersections and emit `intersection` / `split_point` nodes.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ENABLE_ROUTING_GRAPH_BUILD=true` | Yes | Master gate for build API + script |
| `ENABLE_ROUTING_GRAPH_BULK_BUILD=true` | Only if `max_roads` > 100 | Raises controlled road cap |

Default `max_roads`: **25**. Hard cap without bulk flag: **100**.

## Scope filters (required)

At least **one** of:

- `source_publish_batch_id` — matches `core.core_streets.source_refs->>'publish_batch_id'`
- `source_review_batch_id` — matches `source_refs->>'review_batch_id'`
- `bbox` — `{ min_lon, min_lat, max_lon, max_lat }`

Never scans all core roads without a scope filter.

## CLI build

```bash
cd apps/api

export ENABLE_ROUTING_GRAPH_BUILD=true

# Dry run
npm run build:routing-graph -- \
  --profile walk \
  --publish-batch-id 123 \
  --max-roads 3 \
  --dry-run

# Live build
npm run build:routing-graph -- \
  --profile drive \
  --publish-batch-id 123 \
  --max-roads 3
```

Optional flags: `--review-batch-id`, `--region-code`, `--bbox min_lon,min_lat,max_lon,max_lat`.

## API build

```bash
curl -sS -X POST "http://localhost:3001/api/routing/admin/build-graph" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_code": "walk",
    "source_publish_batch_id": "123",
    "max_roads": 3,
    "dry_run": false
  }'
```

Admin JWT role required.

## SQL verification

```sql
-- Latest build job
SELECT id, public_id, status, profile_code, source_publish_batch_id,
       total_core_roads, total_nodes, total_edges, warning_count, error_count,
       started_at, finished_at, summary
FROM routing.routing_build_jobs
ORDER BY id DESC
LIMIT 5;

-- Build metadata (counters in summary jsonb)
SELECT id, build_name, status, summary, started_at, finished_at
FROM routing.routing_build_metadata
ORDER BY id DESC
LIMIT 5;

-- Graph for a job
SELECT count(*) AS nodes FROM routing.routing_nodes WHERE build_job_id = {JOB_ID};
SELECT count(*) AS edges FROM routing.routing_edges WHERE build_job_id = {JOB_ID};

SELECT e.id, e.core_street_id, e.length_m, e.is_oneway, e.walk_allowed, e.drive_allowed,
       fn.id AS from_node, tn.id AS to_node
FROM routing.routing_edges AS e
JOIN routing.routing_nodes AS fn ON fn.id = e.from_node_id
JOIN routing.routing_nodes AS tn ON tn.id = e.to_node_id
WHERE e.build_job_id = {JOB_ID}
ORDER BY e.id;

-- Edge names
SELECT en.*
FROM routing.routing_edge_names AS en
JOIN routing.routing_edges AS e ON e.id = en.routing_edge_id
WHERE e.build_job_id = {JOB_ID};

-- Validation reports
SELECT severity, code, message, core_street_id, routing_edge_id
FROM routing.routing_validation_reports
WHERE build_job_id = {JOB_ID}
ORDER BY severity DESC, code;

-- Core streets marked synced
SELECT id, external_id, canonical_name, routing_status,
       source_refs->>'publish_batch_id' AS publish_batch_id
FROM core.core_streets
WHERE source_refs->>'publish_batch_id' = '{PUBLISH_BATCH_ID}';
```

## Cost rules

- `cost_walk = length_m / walk_speed_mps`
- `cost_drive = length_m / drive_speed_mps` (edge `speed_kph` or profile default)
- `cost_bus = length_m / bus_speed_mps` when `bus_allowed`

Speeds from `routing.routing_profiles.default_speed_kph` with deterministic fallbacks stored in build metadata (`walk=5`, `drive=50`, `bus=30` kph).

## Validation codes

| Code | Severity | Meaning |
|------|----------|---------|
| `INVALID_GEOMETRY` | error | Missing/invalid LineString |
| `ZERO_LENGTH_EDGE` | error | Non-positive length |
| `MISSING_ROAD_CLASS` | warning | No `road_class_id` |
| `ONEWAY_UNKNOWN` | warning | `is_oneway` null → bidirectional |
| `DISCONNECTED_ENDPOINT` | warning | Streets cross but no shared node (endpoint-only) |
| `INTERSECTION_SPLITTING_NOT_IMPLEMENTED` | warning | Phase 9E2 TODO |
| `TURN_RESTRICTIONS_NOT_APPLIED` | warning | Turn restrictions not ingested |
| `DUPLICATE_EDGE` | warning | Duplicate `(core_street_id, from, to)` |
