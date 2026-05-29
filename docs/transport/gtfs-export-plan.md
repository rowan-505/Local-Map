# GTFS export plan (`core_transport` → GTFS zip → OTP)

Planning document for **export tooling only** (no implementation in this phase). Describes how verified data in `core_transport` is exported to a GTFS static bundle for OpenTripPlanner graph builds and local smoke tests.

Related:

- Import path: [ybs-import-plan.md](./ybs-import-plan.md)
- OTP gateway: [../routing/TRANSIT_OTP_FUTURE_PLAN.md](../routing/TRANSIT_OTP_FUTURE_PLAN.md)
- Schemas: migrations `067` (core_transport), `068` (gtfs_export), `072` (default `ybs_daily_default` calendar seed)
- Readiness SQL: `core_transport.v_gtfs_readiness_summary` (migration `069`)
- Verification: `infrastructure/database/checks/supabase/check_transport_schema_migration.sql`

---

## Architecture (strict boundaries)

```text
core_transport.*  (PostGIS source of truth)
        │
        ▼
tools/transit/gtfs-export/export-gtfs.ts
        │  ├── read scope filter (e.g. yangon_local_bus)
        │  ├── write CSV/txt under build dir
        │  ├── zip → gtfs.zip
        │  └── gtfs_export.export_builds / export_files
        ▼
tools/transit/gtfs-export/validate-gtfs.ts
        │  └── gtfs_export.validation_issues
        ▼
OTP graph build (Docker / CLI — infrastructure/routing/otp/ TBD)
        │  inputs: gtfs.zip + OSM PBF (Myanmar clip)
        ▼
Fastify routing gateway (future)
        profile=multimodal → OtpRoutingEngineAdapter → normalized RouteLeg[]
```

| Consumer | Reads | Must not read |
|----------|--------|----------------|
| Map / Martin tiles | `core_transport` via views | GTFS files |
| GTFS exporter | `core_transport` | `import_transport`, `core.core_bus_*` |
| OTP | **GTFS zip + OSM PBF** | Postgres, `import_transport` |
| Public web / API | Normalized routing response | Raw OTP JSON |

---

## 1. Core transport → GTFS mapping

Export only rows that pass scope filters: `is_active = true`, `deleted_at is null`, and scope rules (e.g. `routes.route_type = 'local_bus'`, operator `ybs`).

### 1.1 `agency.txt` ← `core_transport.operators`

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `agency_id` | `coalesce(gtfs_agency_id, operator_code)` | Stable string; unique |
| `agency_name` | `name` | Required |
| `agency_url` | `website_url` | Optional |
| `agency_timezone` | `timezone` | Default `Asia/Yangon` |
| `agency_lang` | constant `my` or `en` | Optional |
| `agency_phone` | `phone` | Optional |

One agency row per operator in scope (MVP: single YBS operator).

### 1.2 `stops.txt` ← `core_transport.stops` (+ `stop_names`)

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `stop_id` | `stop_code` or `public_id::text` or `id::text` | Prefer `stop_code` when unique in export scope |
| `stop_name` | `coalesce(primary en name, primary mm name, name)` | From `stop_names` laterals |
| `stop_lat` / `stop_lon` | `ST_Y(geom)`, `ST_X(geom)` | WGS84 |
| `location_type` | `location_type` | Already GTFS-shaped (0–4) |
| `parent_station` | parent stop’s `stop_id` if `parent_stop_id` set | Optional |
| `zone_id` | `zone_id` | Optional |

### 1.3 `routes.txt` ← `core_transport.routes`

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `route_id` | `route_code` or `id::text` | Stable within feed |
| `agency_id` | operator’s `agency_id` | FK to agency |
| `route_short_name` | `route_code` | YBS line number |
| `route_long_name` | `public_name` or primary `route_names.name` | |
| `route_type` | `coalesce(gtfs_route_type, mapped route_type)` | Map `local_bus` → `3` unless `gtfs_route_type` set |
| `route_color` / `route_text_color` | `normalized_data` | Optional |

### 1.4 `trips.txt` ← `core_transport.route_variants`

Each **active variant** with ≥ 2 stops becomes at least one trip.

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `route_id` | parent route’s `route_id` | |
| `service_id` | linked `service_calendars.service_code` | From frequency or default `ybs_daily_default` |
| `trip_id` | `{route_code}_{variant_code}` or `variant id` | Unique in feed |
| `trip_headsign` | `headsign` or `destination_name` or route name | |
| `direction_id` | `gtfs_direction_id` | 0 or 1 when known |
| `shape_id` | `{trip_id}_shape` if shapes exported | See shapes |
| `wheelchair_accessible` | omit or `normalized_data` | Optional |

**Trip ↔ service:** Join `frequencies.service_calendar_id` → `service_calendars.service_code` as GTFS `service_id`.

### 1.5 `stop_times.txt` ← `core_transport.route_stops`

Two strategies (see §3). Columns:

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `trip_id` | variant trip | |
| `stop_sequence` | `stop_sequence` | Must be contiguous 1..N |
| `stop_id` | stop’s GTFS `stop_id` | |
| `arrival_time` | see §3 | `HH:MM:SS`, can exceed 24:00 for trips spanning midnight |
| `departure_time` | see §3 | |
| `pickup_type` | `pickup_type` | 0–3 |
| `drop_off_type` | `drop_off_type` | 0–3 |
| `shape_dist_traveled` | `distance_from_start_m` | Optional; helps shape matching |
| `timepoint` | `is_timing_point` → 1/0 | Optional |

### 1.6 `calendar.txt` ← `core_transport.service_calendars`

| GTFS column | Source |
|-------------|--------|
| `service_id` | `service_code` |
| `monday` … `sunday` | boolean columns → `1`/`0` |
| `start_date` | `YYYYMMDD` from `start_date` |
| `end_date` | `YYYYMMDD` from `end_date` |

MVP seed: `ybs_daily_default` (migration `072`).

Optional later: `calendar_dates.txt` for exceptions (not required for first OTP local test).

### 1.7 `frequencies.txt` ← `core_transport.frequencies`

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `trip_id` | variant trip | |
| `start_time` | `seconds_to_hhmmss(start_time_seconds)` | GTFS time |
| `end_time` | `seconds_to_hhmmss(end_time_seconds)` | |
| `headway_secs` | `headway_seconds` | |
| `exact_times` | `0` if estimated MVP; `1` if using synthetic stop_times only | See §3 |

Use **either** frequency-based trips (`exact_times=0`) **or** fully timed `stop_times` — document choice per build; MVP YBS uses frequencies + synthetic times (§3).

### 1.8 `shapes.txt` + `shapes.txt` points ← `core_transport.route_paths` / `route_variants.geom`

| GTFS column | Source | Notes |
|-------------|--------|--------|
| `shape_id` | `{trip_id}_shape` | One shape per trip (MVP) |
| `shape_pt_lat/lon` | vertices from LineString | Densify if needed for OTP |
| `shape_pt_sequence` | 1..N along line | |
| `shape_dist_traveled` | cumulative geodesic or `ST_LineLocatePoint` | Optional |

Priority: active `route_paths` where `path_kind = 'shape'`; fallback to `route_variants.geom`.

### 1.9 Files intentionally omitted in MVP

| File | Reason |
|------|--------|
| `fare_attributes.txt` / `fare_rules.txt` | Unverified fares; not required for OTP routing test |
| `transfers.txt` | Optional; add when interchange rules exist |
| `feed_info.txt` | Recommended but not strictly required for all OTP versions — add with `feed_publisher_name`, version = `build_code` |
| `levels.txt` / `pathways.txt` | Not needed for street-level bus MVP |

---

## 2. Minimum required GTFS files for OTP local test

For a **frequency-based bus** MVP in OTP 2.x, plan to ship at minimum:

| File | Required | Purpose |
|------|----------|---------|
| `agency.txt` | Yes | Agency context |
| `stops.txt` | Yes | Stop graph nodes |
| `routes.txt` | Yes | Route metadata |
| `trips.txt` | Yes | Trip instances |
| `stop_times.txt` | Yes | Pattern order (times can pair with frequencies) |
| `calendar.txt` | Yes | Service days |
| `frequencies.txt` | Yes* | *When using headways (`exact_times=0`) |
| `shapes.txt` | Strongly recommended | Map matching / sensible leg geometry |

Also recommended:

- `feed_info.txt` — version label tied to `export_builds.build_code`
- `attributions.txt` — optional “unverified / estimated schedule” notice

**Street network:** OTP also needs **OSM PBF** (Myanmar or Yangon extract) separate from GTFS — same discipline as Valhalla baseline ([CORRECTED_ROAD_EXPORT_PLAN.md](../routing/CORRECTED_ROAD_EXPORT_PLAN.md)).

---

## 3. Frequency-based strategy for YBS (MVP)

YBS exact schedules are often unknown. MVP export uses **estimated** service:

### 3.1 Data prerequisites in `core_transport`

1. `service_calendars` row: `service_code = ybs_daily_default` (seed `072`)
2. Per variant: `frequencies` row(s), e.g.:
   - `start_time_seconds = 6 * 3600` (06:00)
   - `end_time_seconds = 22 * 3600` (22:00)
   - `headway_seconds = 600` (10 min) — **document as unverified**
   - `exact_times = false`
3. `route_stops` with valid `stop_sequence` (≥ 2)
4. Optional: `arrival_offset_seconds` / `departure_offset_seconds` per stop (seconds from trip start)

### 3.2 Export modes (choose one per build)

**Mode A — Frequencies only (simplest OTP)**

- Emit `frequencies.txt` with `exact_times = 0`
- Emit `stop_times.txt` with **sequence only** — use same dummy time window (e.g. first stop `06:00:00`) OR minimal times derived from offsets
- OTP expands headways at query time

**Mode B — Synthetic exact stop_times (recommended for debugging)**

1. For each trip, pick `trip_start` = frequency `start_time` (or first run of day)
2. For each `route_stop` in sequence:
   - If `arrival_offset_seconds` / `departure_offset_seconds` present → `trip_start + offset` → `HH:MM:SS`
   - Else allocate time by `distance_from_start_m` or equal spacing between stops along shape length
3. Set `frequencies.exact_times = 1` **only if** all stops have reliable offsets; otherwise keep `0` and still emit frequencies

**Mode C — Hybrid (plan default)**

- Write `frequencies.txt` (`exact_times=0`)
- Write `stop_times.txt` with monotonic times from offsets or equal spacing (helps validators and some OTP configs)
- Mark build `notes` / `feed_info.feed_version` with `schedule_mode=estimated`

### 3.3 Labeling unverified data

- `export_builds.notes` — human-readable disclaimer
- `feed_info.txt` — `feed_version` includes `unverified-estimated`
- Do not present synthetic times as authoritative in dashboard copy

---

## 4. Export script folder

```text
tools/transit/gtfs-export/
├── README.md
├── export-gtfs.ts          # CLI: scope → zip + DB tracking
├── validate-gtfs.ts        # CLI: GTFS validator + gtfs_export.validation_issues
├── gtfs-db.ts              # DATABASE_URL, export_builds CRUD helpers
├── gtfs-types.ts           # row DTOs, GTFS column types, build options
├── gtfs-writers.ts         # CSV writers per GTFS file
├── lib/                    # (later) scope queries, time/format helpers
│   ├── scope-query.ts
│   ├── map-route-type.ts
│   └── time-format.ts
└── output/                 # gitignored local artifacts
    └── {build_code}/
        ├── *.txt
        └── gtfs.zip
```

Align with `tools/transit/import/` (TypeScript, `pg`, `dotenv`, `tsx`, repo root `.env`).

---

## 5. Proposed files (responsibilities)

### 5.1 `export-gtfs.ts`

- CLI: `--scope`, `--build-code`, `--output-dir`, `--schedule-mode` (`frequencies|synthetic|hybrid`)
- `status`: `draft` → `building` → `built`
- Query `core_transport` for scope
- Call writers → write `export_files` rows
- Zip directory → set `output_path`, `checksum`, `file_size_bytes`, counts
- Invoke `validate-gtfs.ts` or call shared validator module

### 5.2 `validate-gtfs.ts`

- CLI: `--build-code` or `--zip-path`
- Run GTFS structural checks (see §7)
- Insert `gtfs_export.validation_issues`
- Update build `status`: `validating` → `valid` | `invalid`; set `warning_count`, `error_count`

### 5.3 `gtfs-db.ts`

- `loadRepoEnv()`, `createPool()`
- `createExportBuild()`, `finishExportBuild()`, `insertExportFile()`
- `insertValidationIssue()`
- Read-only: `assertGtfsReadinessSummary()` (optional call to `v_gtfs_readiness_summary`)

### 5.4 `gtfs-types.ts`

- `ExportScope`, `ExportBuildOptions`, `GtfsAgencyRow`, `GtfsStopRow`, …
- `ValidationIssueCode`, `ValidationSeverity`

### 5.5 `gtfs-writers.ts`

- Pure functions: `writeAgencyCsv(rows, path)`, …
- Shared CSV escaping (RFC 4180)
- `buildTripId(variant)`, `buildStopId(stop)`, `secondsToGtfsTime(sec)`

---

## 6. Export build tracking (`gtfs_export` schema)

### 6.1 `export_builds` lifecycle

```text
draft → building → built → validating → valid | invalid → published (manual)
                                              ↘ failed
```

| Field | Set when |
|-------|----------|
| `build_code` | CLI arg (unique) |
| `scope` | e.g. `yangon_local_bus` |
| `output_path` | Path to `gtfs.zip` |
| `checksum` | SHA-256 of zip |
| `file_size_bytes` | File size |
| `route_count` / `variant_count` / `stop_count` / `service_count` | After export |
| `started_at` / `finished_at` | Build timestamps |
| `notes` | Schedule disclaimer, git sha, scope filter JSON |

### 6.2 `export_files`

One row per GTFS file written:

- `file_name` — e.g. `stops.txt`
- `file_path` — absolute or repo-relative path
- `row_count` — data rows (excl. header)
- `checksum` — per-file hash (optional)

### 6.3 `validation_issues`

- `gtfs_file` — `stops.txt` or `bundle`
- `row_ref` — `trip_id`, line number, etc.
- `issue_code` — stable slug (§7)
- `severity` — `info` | `warning` | `error`
- `issue_data` — jsonb context
- `is_resolved` — manual triage

Link OTP graph builds later via `routing.routing_build_sources` (future) referencing `export_builds.build_code`.

---

## 7. Validation rules

Run **before** marking build `valid` and **before** OTP graph build.

| Code | Severity | Rule | Blocks publish? |
|------|----------|------|-----------------|
| `no_agency` | error | zero agencies in scope | Yes |
| `no_stops` | error | zero stops | Yes |
| `route_without_variant` | error | active route has no active variant | Yes |
| `variant_without_stops` | error | variant has &lt; 2 `route_stops` | Yes |
| `missing_frequency` | error | trip has no `frequencies` and no exact stop_times | Yes |
| `invalid_stop_sequence` | error | gaps or duplicates in `stop_sequence` per trip | Yes |
| `orphan_stop_time_stop` | error | `stop_id` not in `stops.txt` | Yes |
| `orphan_trip_route` | error | `route_id` not in `routes.txt` | Yes |
| `invalid_time_value` | error | times not `H:MM:SS` or bad ordering | Yes |
| `missing_geometry` | warning | trip has no shape and no path/variant geom | Warn |
| `stop_far_from_shape` | warning | stop &gt; N m from shape (optional) | Warn |
| `unverified_schedule` | info | synthetic / frequency-only mode | Info |
| `duplicate_stop_id` | error | duplicate GTFS `stop_id` | Yes |
| `calendar_service_orphan` | error | `service_id` on trip not in calendar | Yes |

Reuse `core_transport.v_*` views **before export** to fail fast in `export-gtfs.ts` (log summary, non-zero exit).

External validator (optional v1): [GTFS Validator](https://github.com/MobilityData/gtfs-validator) CLI in `validate-gtfs.ts` — map reports into `validation_issues`.

---

## 8. OTP local test flow

```text
1. core_transport populated (import + promote — ybs-import-plan)
2. SELECT * FROM core_transport.v_gtfs_readiness_summary;  -- acceptable counts
3. npx tsx tools/transit/gtfs-export/export-gtfs.ts \
     --scope=yangon_local_bus --build-code=ybs_gtfs_2026-05-29
4. npx tsx tools/transit/gtfs-export/validate-gtfs.ts \
     --build-code=ybs_gtfs_2026-05-29
5. OTP build (planned: infrastructure/routing/otp/)
     - Input: gtfs.zip + myanmar-yangon.osm.pbf (or national clip)
     - Output: graph.obj (or OTP 2 disk cache)
6. OTP smoke route request (localhost)
     - from/to coordinates in Yangon near exported lines
     - mode TRANSIT (+ WALK)
7. (Later) API OtpRoutingEngineAdapter → normalized POST /api/routing/route
     profile=multimodal
```

**Smoke criteria (local):**

- Graph build completes without fatal errors
- At least one itinerary with a transit leg on an exported route
- Leg geometry renders on map (via API normalized GeoJSON, not raw OTP)

Document OTP version target (OTP 2.x recommended) when `infrastructure/routing/otp/` is added.

---

## 9. What not to do

| Do not | Do instead |
|--------|------------|
| Point OTP at Postgres / `core_transport` | Export static GTFS zip; OTP reads files only |
| Point OTP at `import_transport` | Promote to `core_transport` first |
| Return raw OTP Plan JSON to the web client | Map in `OtpRoutingEngineAdapter` to `PostRouteResponseBody` |
| Use OTP for walk/drive/motorcycle | Valhalla via existing adapter (`routing.config.ts`) |
| Mix Valhalla tile graph and OTP transit graph directories | Separate artifacts under `routing.routing_build_artifacts` |
| Encode unverified schedules as “official” in UI | Label estimated; use `feed_info` / export notes |
| Fake real-time vehicle positions | Out of scope (AGENTS.md) |
| Export from `core.core_bus_*` | Use `core_transport` only |
| Skip `gtfs_export` tracking | Every export run gets `export_builds` + validation rows for audit |

---

## 10. Commands (planned)

```bash
# Export GTFS zip from core_transport
npx tsx tools/transit/gtfs-export/export-gtfs.ts \
  --scope=yangon_local_bus \
  --build-code=ybs_gtfs_2026-05-29 \
  --output-dir=./tools/transit/gtfs-export/output \
  --schedule-mode=hybrid

# Validate feed + record issues
npx tsx tools/transit/gtfs-export/validate-gtfs.ts \
  --build-code=ybs_gtfs_2026-05-29

# Pre-export readiness (SQL)
psql "$DATABASE_URL" -c "SELECT * FROM core_transport.v_gtfs_readiness_summary;"
```

Environment (planned `.env` / flags):

```bash
DATABASE_URL=...
GTFS_OUTPUT_ROOT=./tools/transit/gtfs-export/output
GTFS_DEFAULT_SERVICE_CODE=ybs_daily_default
GTFS_DEFAULT_HEADWAY_SECONDS=600
```

---

## 11. Implementation phases

| Phase | Deliverable |
|-------|-------------|
| **G0** | Skeleton `tools/transit/gtfs-export/*` + README (mirror import skeleton) |
| **G1** | `gtfs-writers` + `agency/stops/routes` export |
| **G2** | `trips`, `calendar`, `stop_times` (sequence + synthetic times) |
| **G3** | `frequencies` + hybrid mode |
| **G4** | `shapes.txt` from `route_paths` |
| **G5** | `validate-gtfs.ts` + `gtfs_export` issue mapping |
| **G6** | `infrastructure/routing/otp/` Docker + graph build script |
| **G7** | Wire `OtpRoutingEngineAdapter` + enable `multimodal` profile in DB |

---

## 12. Success criteria (MVP)

1. `export-gtfs` produces a zip passing internal validation with **zero errors** for one YBS subset.
2. `export_builds` row documents checksum, counts, and `scope`.
3. OTP local graph build succeeds using that zip + OSM extract.
4. OTP returns at least one transit itinerary in Yangon test bbox.
5. API adapter (when built) returns normalized legs without exposing OTP internals.

---

*Document version: 2026-05-29 — planning only; exporter not implemented yet.*
