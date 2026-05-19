# System Tracking Workflow

This document describes how **local PostgreSQL** and **Supabase** work together for long-term data lineage, imports, diffs, review, and production publishing.

PostgreSQL + PostGIS is the source of truth. The API is the only runtime layer that talks to Supabase. Tiles are for rendering only.

---

## 1. Local DB vs Supabase DB

| | **Local** (`LOCAL_RAW_DATABASE_URL`) | **Supabase** (`DATABASE_URL`) |
|---|--------------------------------------|-------------------------------|
| **Role** | Import lab and workflow engine | Hosted production database |
| **Typical schemas** | `raw`, `staging`, `system`, `ref`, `core`, `tiles`, … | `core`, `ref`, `system`, `tiles`, `app_auth` |
| **Data volume** | Full OSM extracts, staging candidates, diff payloads | Reviewed, production-ready data only |
| **Who connects** | Import scripts, DBeaver, local tooling | API, dashboard (via API), Supabase SQL Editor for DDL |
| **Migrations** | `migrations/local/` | `migrations/supabase/` |
| **Seeds** | `seeds/local/` | `seeds/supabase/` |
| **Checks** | `checks/local/` | `checks/supabase/` |

**Rule of thumb:** heavy ingestion and experimentation stay local. Supabase receives data that has passed review and is ready for the public map and API.

---

## 2. Local DB responsibilities

The local database is where messy, high-volume work happens.

### Raw OSM import

- Load PBF or other extracts into `raw.*` tables.
- Preserve source tags and geometry with minimal transformation.
- Tie raw rows to a **source snapshot** via `source_snapshot_id` in `system.system_source_snapshots`.

### Staging normalization

- Transform raw features into candidates in `staging.*`.
- Classify roads, places, admin areas, landuse, etc.
- Prepare geometry and normalized JSON for review and promotion.
- Staging is **not** final truth; it is the working layer before core.

### Diff computation

- Compare two source snapshots (or snapshot vs core) using `system.system_diff_runs` and `system.system_diff_items`.
- Record per-entity changes: new, changed, deleted_candidate, conflict, unchanged.
- Store before/after JSON in diff items for inspection.

### Test review workflow

- Use `system.system_review_tasks`, `system.system_conflict_queue`, and `system.system_review_logs` locally.
- Exercise publish batches (`system.system_publish_batches`, `system.system_publish_items`) before anything reaches Supabase.
- Demo and legacy rows (e.g. `osm_myanmar_core_demo`, `geofabrik_myanmar_osm_pbf`) can remain for history; review manually, do not auto-delete.

---

## 3. Supabase responsibilities

Supabase holds **production-safe** data only.

### Production schemas

- **`core`** — trusted map entities (places, streets, admin, buildings, transit, …).
- **`ref`** — reference lookups (source types, categories, road classes, …).
- **`system`** — source registry, import metadata, snapshots, diffs, review audit, publish tracking (metadata, not raw OSM).
- **`tiles`** — lightweight views for MapLibre / Martin.
- **`app_auth`** — application users and roles.

### Reviewed data only

- Do not bulk-load unreviewed staging or raw tables into Supabase.
- Promote into `core` only after review and explicit publish decisions.
- Link promotions to lineage where possible (`source_snapshot_id`, publish batch, review log).

### Production audit logs

- `system.system_review_logs` records human or automated actions on production.
- `system.system_publish_batches` / `system.system_publish_items` track approved releases into core.
- Supabase `system` schema is for **tracking and audit**, not for storing full OSM dumps.

---

## 4. Pipeline history vs entity version history

These are two different concepts. Do not merge them.

### `system.*` — pipeline / lineage history

Answers: *where did this data come from, and how did it move through the pipeline?*

| Table | Purpose |
|-------|---------|
| `system_source_registry` | Catalog of sources (OSM, dashboard, GTFS, …) |
| `system_import_batches` | One import job run |
| `system_source_snapshots` | One captured dataset version |
| `system_diff_runs` | Comparison between snapshots |
| `system_diff_items` | Per-entity diff outcomes |
| `system_review_logs` | Audit trail of review actions |
| `system_publish_batches` / `system_publish_items` | Approved release groups |

Stable keys: `source_code`, `snapshot_version`, `checksum`, `region_code`.

### `core.*_versions` — entity edit history

Answers: *how did this specific core row change over time?*

Examples: `core_place_versions`, `core_street_versions`.

- Store snapshots of entity state at publish or edit time.
- Tie to `entity_id` and version numbers inside **core**.
- Used for rollback, dashboard history, and “what did this place look like on date X?”

**Relationship:** pipeline history explains **provenance**; version tables explain **entity lifecycle** after data is in core.

---

## 5. Why numeric IDs must not be forced to match

Local and Supabase are separate databases. Each uses its own `bigint` identity sequences.

| Problem if you force ID sync | Better approach |
|------------------------------|-----------------|
| Inserts fail or overwrite wrong rows | Use stable business keys |
| Re-import resets break FKs | Reference `source_code`, not `registry.id` |
| Demo/local rows collide with prod | Map by `snapshot_version`, `checksum`, `region_code` |
| Migrations become fragile | Let Supabase assign its own IDs on insert |

**Never assume** `system.system_source_registry.id = 1` locally is the same source as `id = 1` on Supabase.

---

## 6. Stable identity fields

Use these when comparing, exporting, or documenting lineage across environments.

| Field | Where | Use |
|-------|-------|-----|
| **`source_code`** | `system.system_source_registry` | Stable source identifier (`osm_myanmar`, `manual_dashboard`, …) |
| **`snapshot_version`** | `system.system_source_snapshots` | Globally unique dataset version (`kyauktan_raw_v1`, date stamp, file label) |
| **`checksum`** | `system.system_source_snapshots` | Hash of captured file or payload |
| **`region_code`** | `system.system_source_snapshots` | Scope (`MM-KYAUKTAN`, `MM-YGN`, …) |
| **`snapshot_ref`** | `system.system_source_snapshots` | Human/pipeline label within a source (file name, batch label) |
| **`external_id`** | staging / diff items / core sources | OSM id or upstream key |

Seed script: `seeds/local/001_seed_system_source_registry.sql` and `seeds/supabase/001_seed_system_source_registry.sql`.

---

## 7. Recommended workflow

```text
OSM PBF (or other extract)
    │
    ▼
Local: register source + import batch + source_snapshot
    │     (system.system_source_registry, import_batches, source_snapshots)
    ▼
Local: raw import
    │     (raw.raw_osm_*)
    ▼
Local: staging normalization
    │     (staging.staging_*_candidates)
    ▼
Local: diff run
    │     (system.system_diff_runs, system.system_diff_items)
    ▼
Local: review + conflict resolution
    │     (review_tasks, conflict_queue, review_logs)
    ▼
Local: publish batch (approved items only)
    │     (system.system_publish_batches, system.system_publish_items)
    ▼
Approved export → Supabase core (+ system audit rows as needed)
    │     (core.*, system.* metadata, ref.*)
    ▼
Tiles views refreshed for map rendering
    │     (tiles.* views → Martin / MapLibre)
```

### Step-by-step

1. **Register source** — upsert `source_code` in registry (seed or pipeline).
2. **Start import batch** — `status = running`, link to `source_registry_id`.
3. **Create source snapshot** — set `snapshot_version`, `checksum`, `region_code`, `snapshot_ref`.
4. **Import to raw** — osm2pgsql or pipeline; set `source_snapshot_id` on raw rows.
5. **Stage** — build candidates in `staging`.
6. **Diff** — compare snapshots or staging vs core; populate diff items.
7. **Review** — resolve conflicts; log actions in `review_logs`.
8. **Publish locally** — record publish batch/items for approved entities.
9. **Export to Supabase** — insert/update `core` using stable keys; copy lineage metadata to Supabase `system` as needed.
10. **Validate** — run `checks/local/` or `checks/supabase/` scripts.

---

## 8. What not to do

| Do not | Why |
|--------|-----|
| **Dump huge raw OSM into Supabase** | Cost, size, and noise; raw belongs in local `raw` schema only. |
| **Drop `system` tables** | You lose lineage, audit trail, and publish history. Use additive migrations only. |
| **Import to `core` without `source_snapshot` tracking** | You cannot reproduce or explain where data came from. |
| **Use tiles as source of truth** | Tiles are derived views for rendering; truth is `core` + `system` metadata. |
| **Blindly re-run the local baseline migration** | `000_baseline_current_local_schema.sql` is documentation/bootstrap, not for existing DBs. |
| **Paste full local baseline into Supabase** | Schemas already exist; use incremental `migrations/supabase/` only. |
| **Delete demo/legacy source rows automatically** | e.g. `osm_myanmar_core_demo`, `geofabrik_myanmar_osm_pbf` — review manually. |
| **Sync numeric IDs across local and Supabase** | Use `source_code`, `snapshot_version`, `checksum`, `region_code` instead. |

---

## Related files

| Area | Path |
|------|------|
| Database overview | [`../README.md`](../README.md) |
| Pipeline context | [`database_pipeline_context.md`](database_pipeline_context.md) |
| Local migration upgrade | [`../migrations/local/001_upgrade_local_system_tracking.sql`](../migrations/local/001_upgrade_local_system_tracking.sql) |
| Supabase migration (base) | [`../migrations/supabase/021_system_import_lineage_tracking.sql`](../migrations/supabase/021_system_import_lineage_tracking.sql) |
| Supabase migration (upgrade) | [`../migrations/supabase/022_upgrade_supabase_system_tracking.sql`](../migrations/supabase/022_upgrade_supabase_system_tracking.sql) |
| Source registry seed | [`../seeds/local/001_seed_system_source_registry.sql`](../seeds/local/001_seed_system_source_registry.sql) |
| Local validation | [`../checks/local/check_local_system_tracking.sql`](../checks/local/check_local_system_tracking.sql) |
| Supabase validation | [`../checks/supabase/check_supabase_system_tracking.sql`](../checks/supabase/check_supabase_system_tracking.sql) |

---

## SQL apply order (reference)

**Local (existing DB):**

1. `migrations/local/001_upgrade_local_system_tracking.sql`
2. `seeds/local/001_seed_system_source_registry.sql`
3. `checks/local/check_local_system_tracking.sql`

**Supabase:**

1. `migrations/supabase/021_system_import_lineage_tracking.sql`
2. `migrations/supabase/022_upgrade_supabase_system_tracking.sql`
3. `seeds/supabase/001_seed_system_source_registry.sql`
4. `checks/supabase/check_supabase_system_tracking.sql`
