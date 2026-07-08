---
status: archived
reason: replaced by docs/archive/old-docs/transport/ybs-import-plan.md
archived_at: 2026-07-01
---

# YBS dataset import plan (`import_transport` → `core_transport`)

Planning document for **scripts only** (no implementation in this phase). Describes how external Yangon Bus Service (YBS) route/stop/sequence/geometry files land in `import_transport`, pass validation, promote to `core_transport`, and become eligible for GTFS export and OTP testing.

Related:

- Migrations: `066`–`072`, `069` validation views, `070` tile views, `071` legacy bus deprecation
- Verification: `infrastructure/database/checks/supabase/check_transport_schema_migration.sql`
- OTP direction: `docs/routing/TRANSIT_OTP_FUTURE_PLAN.md`
- Architecture: `AGENTS.md` — database is source of truth; GTFS from `core_transport` only; OTP never reads `import_transport`

---

## Architecture (strict boundaries)

```text
External YBS files (JSON/CSV/GeoJSON)
        │
        ▼
tools/transit/import/import-ybs-dataset.ts
        │
        ▼
import_transport.*  (raw, messy, batch-scoped)
        │
        ▼
tools/transit/import/validate-ybs-import.ts
        │  └── import_transport.validation_issues
        ▼
tools/transit/import/promote-ybs-to-core.ts
        │  └── import_transport.promotion_batches / promotion_items
        ▼
core_transport.*  (clean production SoT)
        │
        ├──► tiles.tiles_bus_*_v (map/Martin)
        ├──► API / dashboard (future modules)
        └──► GTFS exporter → gtfs_export.* → OTP graph build
```

| Layer | Role | OTP / map reads? |
|--------|------|-------------------|
| `import_transport` | Staging for external feeds; preserves `raw_payload` | **No** |
| `core_transport` | Verified network + schedules metadata | **Yes** (via tiles/API/GTFS) |
| `gtfs_export` | Build artifacts + validator output | OTP consumes **GTFS zip**, not Postgres directly |
| `core.core_bus_*` | Legacy; deprecated | **No** (do not write) |

---

## 1. Input dataset assumptions

Assume a **file-based YBS drop** under a configurable directory (e.g. `tools/transit/import/data/ybs/` or env `YBS_DATA_DIR`). Exact filenames can be overridden via env; below are **logical** inputs.

### 1.1 Routes (`routes/*.json` or single `routes.json`)

| Assumed field | Maps to raw | Notes |
|---------------|-------------|--------|
| `route_id` / `id` | `source_route_id` | Stable external key within dataset |
| `route_code` / `line_number` | `route_code` | Required for promotion |
| `name` / `name_en` / `name_mm` | `public_name`, `normalized_data.names` | At least one display name |
| `operator` | `source_operator_id` or link via `raw_operators` | Default operator `ybs` |
| `direction` / `variant` | drives `raw_route_variants` | One JSON route may = one variant or many |
| `geometry` / `coordinates` | `raw_route_variants.geom` or `raw_route_paths` | GeoJSON LineString preferred; WGS84 |

**Assumption:** JSON is **GeoJSON FeatureCollection** or an array of route objects. CRS **EPSG:4326** (lng/lat order per GeoJSON).

### 1.2 Stops (`stops.tsv` / `stops.csv`)

| Assumed column | Maps to raw | Notes |
|----------------|-------------|--------|
| `stop_id` | `source_stop_id` | Unique in dataset |
| `stop_code` | `stop_code` | Optional but strongly recommended |
| `name` / `name_en` / `name_mm` | `stop_name`, `normalized_data` | Validation: need label or code |
| `lat`, `lng` (or `latitude`, `longitude`) | `geom` Point 4326 | Required |
| `admin_area` | `admin_area_code` in `normalized_data` | Optional |

Delimiter: tab or comma; UTF-8; header row.

### 1.3 Route stop sequence (`route_stops.csv` or embedded in route JSON)

| Assumed column | Maps to raw | Notes |
|----------------|-------------|--------|
| `route_id` | `source_route_id` / `source_variant_id` | Must resolve to variant |
| `stop_id` | `source_stop_id` | FK to raw stop |
| `sequence` / `stop_sequence` | `stop_sequence` | Integer ≥ 1, unique per variant |
| `distance_m` | `distance_from_start_m` | Optional |

**Assumption:** Sequence is **authoritative** for pattern order; geometry does not replace sequence.

### 1.4 Route geometry (optional separate files)

| Form | Destination | Notes |
|------|-------------|--------|
| Per-route `.geojson` / WKT in JSON | `raw_route_paths` (`path_kind = shape`) | Preferred for OTP shapes |
| Only variant `geom` in routes JSON | `raw_route_variants.geom` | Accept if valid LineString |
| Missing | — | Validation warning; may still promote if sequence + stops OK |

### 1.5 Dataset metadata (recommended sidecar)

`manifest.json` (optional but planned):

```json
{
  "dataset_version": "2026-05-29",
  "provider": "YBS",
  "region_code": "yangon",
  "timezone": "Asia/Yangon",
  "files": {
    "routes": "routes.json",
    "stops": "stops.tsv",
    "route_stops": "route_stops.csv",
    "geometries_dir": "geometries/"
  }
}
```

Used for `source_snapshot_version`, checksums, and `import_batches.summary`.

### 1.6 Explicit non-goals for v1 import

- No live GPS / vehicle positions
- No fare tables unless a separate verified file is provided
- No exact `stop_times` unless provided (MVP uses frequencies + default calendar seed)
- No writes to `core.core_bus_*` or `import_review.bus_*`

---

## 2. Import destination (Postgres)

All writes go to **`DATABASE_URL`** (Supabase) via script using parameterized SQL or a thin repo layer — **not** via dashboard.

### 2.1 Registry and batch

| Table | Purpose |
|-------|---------|
| `import_transport.source_datasets` | One row: `code = ybs_yangon_local`, `transport_mode = local_bus`, `source_format = csv` or `other` |
| `import_transport.import_batches` | One row per import run; `batch_name`, checksums, `record_counts`, `import_status` lifecycle |

Suggested `source_datasets.code`: **`ybs_yangon_local`**

Suggested batch naming: **`ybs_yangon_{dataset_version}`** (e.g. `ybs_yangon_2026-05-29`)

### 2.2 Raw entity tables (scoped by `import_batch_id`)

| Table | Source files | Key columns |
|-------|--------------|-------------|
| `raw_operators` | manifest default `ybs` | `source_operator_id`, `operator_code`, `transport_mode = local_bus` |
| `raw_routes` | routes JSON | `source_route_id`, `route_code`, `public_name` |
| `raw_route_variants` | routes JSON (per direction/pattern) | `source_variant_id`, `route_code`, `geom?` |
| `raw_stops` | stops TSV | `source_stop_id`, `geom`, `stop_code`, names |
| `raw_route_stops` | route_stops CSV | `source_variant_id`, `source_stop_id`, `stop_sequence` |
| `raw_route_paths` | geometry files | `source_path_id`, `geom`, `path_kind = shape` |

Optional later: `raw_service_notes` for importer warnings stored per row.

### 2.3 Field mapping conventions

- **`source_*_id`**: string from file (never reuse across batches without new batch)
- **`raw_payload`**: full original JSON/row as jsonb
- **`normalized_data`**: importer canonical view (parsed names, file line number, geometry source)
- **`source_refs`**: `{ "dataset": "ybs_yangon_local", "file": "routes.json", "batch": "..." }`
- **`confidence_score`**: importer-assigned 0–100 (default 50 unverified; never 0–1)
- **`match_status`**: start as `unmatched`; promotion updates to `matched`
- **`validation_status`**: set by validate script

### 2.4 Import batch status flow

```text
draft → importing → imported → validating → ready_for_promotion | validation_failed
  → promoting → promoted | failed
```

---

## 3. Script folder

```text
tools/transit/import/
├── README.md                 # env vars, examples, troubleshooting
├── import-ybs-dataset.ts     # load files → import_transport
├── validate-ybs-import.ts    # rules → validation_issues + batch status
├── promote-ybs-to-core.ts    # promotion_batches → core_transport
├── lib/                      # (later) shared parsers, db client, geometry helpers
│   ├── ybs-types.ts
│   ├── parse-routes.ts
│   ├── parse-stops.ts
│   └── db.ts
├── data/
│   └── ybs/                  # gitignored sample/production drops
│       ├── manifest.json
│       ├── routes.json
│       ├── stops.tsv
│       ├── route_stops.csv
│       └── geometries/
└── .env.example              # YBS_DATA_DIR, DATABASE_URL
```

Align with existing tooling style: `tools/data-pipeline/local-osm/12_upload_remote_review_package.ts` (TypeScript + `DATABASE_URL`, env templates, idempotent batches).

---

## 4. Proposed scripts (behavior)

### 4.1 `import-ybs-dataset.ts`

**Responsibilities:**

1. Read env: `DATABASE_URL`, `YBS_DATA_DIR`, optional `IMPORT_BATCH_NAME`, `DATASET_VERSION`
2. Upsert `source_datasets` row `ybs_yangon_local` if missing
3. Create `import_batches` row (`import_status = importing`)
4. Parse files; bulk insert into raw tables (transaction per entity family or single transaction with savepoints)
5. Populate `record_counts` jsonb on batch
6. Set `import_status = imported`, `imported_at = now()`
7. Print summary counts to stdout (JSON line for CI)

**Idempotency:** New batch per run by default; optional `--replace-batch <id>` for dev-only re-import into same batch (delete raw children first in dev script only — not production default).

**Does not:** touch `core_transport`, `core.core_bus_*`, or tiles.

### 4.2 `validate-ybs-import.ts`

**Responsibilities:**

1. Load batch by id or latest `ybs_yangon_*` batch
2. Set `import_status = validating`
3. Run validation rules (section 5); insert `import_transport.validation_issues`
4. Aggregate `error` / `warning` counts; update row-level `validation_status` where useful
5. Set batch `validation_status` and `import_status`:
   - errors → `validation_failed`
   - warnings only → `ready_for_promotion` (with summary flag `has_warnings`)
   - clean → `ready_for_promotion`
6. Optionally run / compare `core_transport.v_gtfs_readiness_summary` **after** promotion dry-run (document only in v1)

**CLI flags (planned):** `--batch-id`, `--fail-on-warning`, `--max-stops-distance-m 75`

### 4.3 `promote-ybs-to-core.ts`

**Responsibilities:**

1. Require batch `import_status = ready_for_promotion` (or explicit `--force` with audit log for admins)
2. Create `import_transport.promotion_batches` + `promotion_items`
3. Map raw → `core_transport` in dependency order:

```text
operators (link ybs operator, seed 072 if missing)
  → routes (+ route_names)
  → stops (+ stop_names)
  → route_variants (+ route_paths)
  → route_stops
  → frequencies (optional MVP headways per variant)
  → route_sources (lineage: import_transport batch id)
```

4. Set `promoted_target_*` on promotion_items; `source_refs` on core rows
5. Set batch `import_status = promoted`; promotion_batch `promotion_status = promoted`
6. Emit promotion report (counts, skipped rows, warnings)

**Does not:** write GTFS files (separate exporter); does not call OTP.

**CLI flags (planned):** `--batch-id`, `--dry-run`, `--confirm-warnings`, `--scope yangon_local_bus`

---

## 5. Validation rules

Issues written to `import_transport.validation_issues` with `severity`, `issue_code`, `entity_kind`, `entity_id` / `entity_source_id`, `issue_data`.

| Rule ID | Severity | Condition | Blocks promotion? |
|---------|----------|-----------|-----------------|
| `missing_route_code` | error | `raw_routes.route_code` null/blank | Yes |
| `missing_stop_name` | warning | no `stop_name`, no `stop_code`, no names in `normalized_data` | Confirm |
| `missing_lat_lng` | error | `raw_stops.geom` null | Yes |
| `invalid_geometry` | error | non-Point stop geom; non-LineString path/variant geom; empty; invalid SRID | Yes |
| `duplicate_stop_ids` | error | duplicate `source_stop_id` in batch | Yes |
| `duplicate_stop_sequence` | error | duplicate `stop_sequence` per `raw_route_variant` | Yes |
| `variant_fewer_than_two_stops` | error | &lt; 2 `raw_route_stops` per variant | Yes |
| `stops_far_from_path` | warning | stop &gt; N meters from variant/path LineString (default 75 m, tunable) | Confirm |
| `route_path_missing` | warning | no `raw_route_paths` and no `raw_route_variants.geom` | Confirm |
| `unknown_stop_in_sequence` | error | `route_stops` references missing `source_stop_id` | Yes |
| `unknown_route_in_sequence` | error | `route_stops` references missing variant/route | Yes |
| `no_service_calendar` | warning | no `core_transport.service_calendars` for operator (pre-promotion check against target) | Confirm — seed `072` mitigates |
| `no_frequency_for_variant` | warning | promoted variant would have no `frequencies` row (OTP headway gap) | Confirm |

**Post-promotion SQL checks** (read-only, reuse `069` views):

- `core_transport.v_route_variants_with_too_few_stops`
- `core_transport.v_duplicate_route_stop_sequences`
- `core_transport.v_stops_without_names`
- `core_transport.v_route_paths_missing`
- `core_transport.v_gtfs_readiness_summary`

Importer validation should **align** with these views so promotion does not silently pass known bad patterns.

---

## 6. Promotion rules

| Rule | Detail |
|------|--------|
| **No direct core import** | Nothing inserts into `core_transport` except `promote-ybs-to-core.ts` after validation |
| **Errors block** | Any open `validation_issues.severity = error` → promotion exits non-zero |
| **Warnings** | Require `--confirm-warnings` or interactive confirm; logged in `promotion_batches.summary` |
| **Lineage** | Every promoted core row gets `source_refs`: `{ "import_transport_batch_id", "source_*_id", "dataset": "ybs_yangon_local" }` |
| **`route_sources`** | Insert `source_kind = import_transport`, `import_transport_batch_id`, `is_primary = true` per route |
| **`confidence_score`** | Default **40–60** for unverified YBS file import; **70+** only if manual review flag in manifest |
| **`is_verified` / `verification_status`** | Always `false` / `unverified` on first promotion |
| **Operator** | Reuse `core_transport.operators.operator_code = ybs` (seed `072`) |
| **Service calendar** | Link variants/frequencies to `service_code = ybs_daily_default` when frequencies are created |
| **IDs** | New `core_transport` ids; no assumption of parity with `core.core_bus_*` |
| **Soft delete** | Never hard-delete core rows in v1; deactivate via `is_active` if superseded by later batch |
| **Idempotent promotion** | Second promote of same batch should no-op or upsert by `source_refs` key (design in implementation phase) |

### Promotion item tracking

Use `import_transport.promotion_batches` + `promotion_items` (`entity_kind`, `raw_entity_id`, `promotion_status`, `promoted_target_id`).

---

## 7. GTFS readiness checklist

Before running GTFS export or OTP graph build:

- [ ] Migrations **066–072** applied
- [ ] Verification script passes: `check_transport_schema_migration.sql`
- [ ] `core_transport` populated for scope `yangon_local_bus`
- [ ] `core_transport.v_gtfs_readiness_summary` — issue counts acceptable
- [ ] `operators` row with `gtfs_agency_id` or `operator_code = ybs`
- [ ] `service_calendars.service_code = ybs_daily_default` exists (**072**)
- [ ] Each active variant has ≥ 2 `route_stops`
- [ ] Each active variant has `route_variants.geom` or active `route_paths` shape
- [ ] Stops have `stop_code` or `stop_names` (en/mm) for labeling
- [ ] `frequencies` rows exist OR exact `stop_times` offsets on all pattern stops (MVP: frequencies)
- [ ] `gtfs_export.export_builds` row created with `scope = yangon_local_bus`
- [ ] GTFS validator: `gtfs_export.validation_issues` has zero `severity = error`
- [ ] Tile smoke: `tiles.tiles_bus_routes_v` / `tiles_bus_stops_v` return features in Yangon bbox
- [ ] OTP build uses **exported zip** + Myanmar OSM PBF — not `import_transport`

---

## 8. Commands that should exist later

Add to root `package.json` or `tools/transit/import/package.json` when implemented:

```bash
# Import raw YBS files → import_transport
npm run transit:import:ybs -- --data-dir ./tools/transit/import/data/ybs --version 2026-05-29

# Validate batch (default: latest ybs batch)
npm run transit:validate:ybs -- --batch-id 1

# Promote to core_transport (dry-run first)
npm run transit:promote:ybs -- --batch-id 1 --dry-run
npm run transit:promote:ybs -- --batch-id 1 --confirm-warnings

# DB verification (existing)
psql "$DATABASE_URL" -f infrastructure/database/checks/supabase/check_transport_schema_migration.sql

# GTFS readiness (SQL)
psql "$DATABASE_URL" -c "SELECT * FROM core_transport.v_gtfs_readiness_summary;"

# Future (not in this plan’s implementation)
npm run transit:export:gtfs -- --scope yangon_local_bus --build-code ybs_2026-05-29
npm run transit:validate:gtfs -- --build-id 1
```

Environment template (`tools/transit/import/.env.example`):

```bash
DATABASE_URL=postgresql://...
YBS_DATA_DIR=./tools/transit/import/data/ybs
YBS_OPERATOR_CODE=ybs
YBS_DEFAULT_SERVICE_CODE=ybs_daily_default
YBS_MAX_STOP_PATH_DISTANCE_M=75
```

---

## 9. Implementation phases (recommended order)

| Phase | Deliverable | Depends on |
|-------|-------------|------------|
| **P0** | `source_datasets` + manifest schema docs; sample fixture in `data/ybs/.gitkeep` | 066 |
| **P1** | `import-ybs-dataset.ts` (stops + routes + sequence) | P0 |
| **P2** | `validate-ybs-import.ts` + issue codes | P1 |
| **P3** | `promote-ybs-to-core.ts` + `route_sources` lineage | P2, 067, 072 |
| **P4** | Geometry file support + `stops_far_from_path` | P1 |
| **P5** | MVP `frequencies` generator + GTFS exporter hook | P3, 068 |
| **P6** | Dashboard/API read paths (separate task) | P3, 070 |

---

## 10. Risks and open decisions

| Topic | Decision needed |
|-------|----------------|
| One JSON file = route vs variant | Document per-file convention in `manifest.json`; importer must not duplicate patterns |
| Duplicate YBS stop codes across files | Prefer `source_stop_id` as GTFS `stop_id` source; map `stop_code` separately |
| Re-import superseding old core rows | v1: manual deactivation of previous batch’s routes; v2: `route_versions` snapshots |
| `tiles_bus_route_variants_v` | Still on `core.core_bus_*` in dashboard — map preview may differ until follow-up migration |
| Schedule truth | MVP uses estimated frequencies + `ybs_daily_default` calendar; label unverified in UI/GTFS metadata |

---

## 11. Success criteria (MVP)

1. One YBS route (or small subset) imports into `import_transport` with full audit trail.
2. Validation passes with zero **errors** (warnings documented).
3. Promotion creates linked `core_transport` rows with `source_refs`.
4. `v_gtfs_readiness_summary` shows non-zero active routes/stops/variants for the subset.
5. Map tiles show the route/stops in Yangon after Martin refresh (data-dependent).
6. GTFS export build can be created in `gtfs_export` without reading `import_transport`.

---

*Document version: 2026-05-29 — planning only; no import scripts implemented yet.*
