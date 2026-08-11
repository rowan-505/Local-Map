---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Import snapshots and data lineage
---

# Snapshots and lineage

## Key system tables

- `system.system_import_batches` — one ingestion run
- `system.system_source_snapshots` — captured dataset version
- `system.system_diff_items` — F1/F2 diff results

## Identifiers

Use stable keys across environments:

- `source_snapshot_version` (string)
- `source_code`, `checksum`, `region_code`
- `public_id` in core

**Numeric IDs may differ** between local and Supabase.

## Workflow tracking

Archived detail: [`system_tracking_workflow.md`](../archive/old-docs/infrastructure/database/docs/system_tracking_workflow.md)

## Related docs

- [OSM import](osm-import.md)
- [Database overview](../02-database/database-overview.md)
