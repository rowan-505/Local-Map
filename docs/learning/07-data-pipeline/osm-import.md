---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Local OSM import pipeline entry point
---

# OSM import

Primary runbook: [`tools/data-pipeline/local-osm/README.md`](../../tools/data-pipeline/local-osm/README.md)

## Purpose

Import OpenStreetMap extracts into **local** PostgreSQL:

```text
OSM PBF → raw → staging → diff/review → (optional) remote import_review upload
```

**Does not** write `core` directly from this pipeline.

## Orchestration

```bash
tools/data-pipeline/local-osm/run_local_osm_pipeline.sh <env-file>
```

One env file per import run — see `tools/data-pipeline/local-osm/NAMINGENV.md`.

## Layer model

| Layer | Schema | Role |
|-------|--------|------|
| tmp_import | scratch | osm2pgsql disposable |
| raw | `raw` | Archived OSM by snapshot |
| staging | `staging` | Normalized candidates |
| system | `system` | Batches, snapshots, diffs |

## Related pipelines

| Folder | Purpose |
|--------|---------|
| `tools/data-pipeline/road-fast-core/` | Fast road core operations |
| `tools/data-pipeline/admin-fast-core/` | Admin area fast path |
| `tools/data-pipeline/transport-fast-publish/` | Transport publish |
| `tools/data-pipeline/prod-mirror/` | Staging vs prod mirror diffs |
| `tools/import-review/` | Import-review utilities |

## Related docs

- [Raw to staging](raw-to-staging.md)
- [Review and promotion](review-and-promotion.md)
- [Database overview](../02-database/database-overview.md)
