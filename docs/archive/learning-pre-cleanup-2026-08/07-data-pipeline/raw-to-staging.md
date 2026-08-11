---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: raw and staging layer processing
---

# Raw to staging

## Flow

```text
00 preflight → 01 snapshot/batch → 02 osm2pgsql → 03 validate
→ 04 tmp→raw → 05 raw→staging → 06–07 diffs → …
```

Stages documented in [`tools/data-pipeline/local-osm/README.md`](../../tools/data-pipeline/local-osm/README.md).

## Rules

- **raw** — untouched; filter/select only
- **staging** — first normalization layer; always `source_snapshot_id`
- Workflow fields: `match_status`, `auto_action`, `confidence_score` (0–100)

## Whole-region vs clipped

- With `BOUNDARY_GEOJSON_PATH` — spatial clip to boundary
- Without — full PBF import (`WHOLE_REGION`)

## Archived context

[`database_pipeline_context.md`](../archive/old-docs/infrastructure/database/docs/database_pipeline_context.md) — schema table reference

## Related docs

- [OSM import](osm-import.md)
- [Snapshots and lineage](snapshots-and-lineage.md)
