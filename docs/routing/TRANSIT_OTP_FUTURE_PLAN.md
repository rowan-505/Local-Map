# Transit / OpenTripPlanner future plan

Planning document for **multimodal transit routing** (YBS, express bus, rail, ferry) using **OpenTripPlanner (OTP)** behind the existing Fastify routing gateway. Describes direction and schema intent only.

**Not implemented yet:**

- No OTP Docker / compose under `infrastructure/routing/otp/`
- No `transit.*` SQL migrations
- `OtpRoutingEngineAdapter` remains a placeholder (`apps/api/src/modules/routing/adapters/otp.adapter.ts`)

Related docs:

- [AGENTS.md](../../AGENTS.md) — YBS/express viewing vs journey planning; no fake live GPS
- [docs/routing/CORRECTED_ROAD_EXPORT_PLAN.md](./CORRECTED_ROAD_EXPORT_PLAN.md) — Valhalla road graph (separate engine)
- [infrastructure/routing/valhalla/README.md](../../infrastructure/routing/valhalla/README.md) — road routing only today
- Migration `060_routing_metadata_foundation.sql` — `routing.routing_physical_modes`, `routing_service_classes`, disabled `multimodal` profile

---

## 1. Why OTP is not implemented now

### No reliable bus / GTFS data yet

| Gap | Impact |
|-----|--------|
| Incomplete or unverified YBS route geometry and stop sequences | OTP needs consistent stops, patterns, and times |
| Missing or stale GTFS for Myanmar operators | Cannot build a trustworthy transit graph |
| Express / rail / ferry schedules often absent or informal | Frequency-based placeholders may work locally only, not in production |
| No published OTP graph in `routing.routing_builds` | API correctly returns not-implemented / disabled for OTP-backed profiles |

CoreMap’s **source of truth** for map data is PostGIS. OTP consumes **exported GTFS plus an OSM street graph** — not live dashboard edits. Until transit rows are verified and exportable, an OTP build would encode wrong or empty service.

### Route viewing comes before journey planning

V2 priority (per AGENTS.md):

```text
Now:     map search + route/stop/terminal viewing + corridor geometry on the map
Later:   door-to-door multimodal journey planning (walk + bus + transfers)
```

| Capability | V2 now | After OTP |
|------------|--------|-----------|
| Browse YBS / express route on map | Yes (API + tiles) | Same |
| Search stops, routes, terminals | Yes | Same |
| Directions: walk / drive / motorcycle | Valhalla via API | Same |
| Directions with bus legs + transfers | No | OTP + `profile=multimodal` |
| Live vehicle GPS | **Out of scope** | **Out of scope** |

Do not fake schedules, fares, or real-time positions. Unverified schedule data must be labeled unverified in UI and GTFS export metadata.

### What already exists (bridge to this plan)

| Area | Status |
|------|--------|
| `core.core_bus_*` | Legacy/core-review bus routes, variants, stops (viewing, tiles) |
| `routing.routing_physical_modes` | `bus`, `rail`, `ferry` seeded but **disabled** for routing |
| `routing.routing_profiles` | `multimodal` profile kind with OTP in `engine_costing_map` (disabled) |
| API types | `RouteLeg.transit`, `RouteLegTransitDetails` — engine-agnostic |
| `ROUTING_ROUTE_PROFILES_DISABLED` | includes `multimodal` until OTP is wired |
| OTP adapter stub | Throws `RoutingEngineNotImplementedError` |

Future **`transit.*`** tables are the normalized, GTFS-oriented model. Migration from `core.core_bus_*` is a separate implementation task — not started here.

---

## 2. Future architecture

End-to-end flow when OTP is introduced:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ A. PostGIS transit schema (source of truth)                               │
│    transit.operators, routes, patterns, stops, trips, frequencies, …      │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ B. GTFS exporter (repeatable job — tools/ or API batch)                   │
│    Scoped export; lineage in transit.gtfs_export_batches                    │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ C. GTFS validator                                                         │
│    Structural + referential checks → transit.gtfs_validation_reports      │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
┌─────────────────────────────┐           ┌─────────────────────────────┐
│ D1. Street graph for OTP     │           │ D2. OTP graph build          │
│     OSM PBF (Myanmar / clip)  │           │     GTFS + street network    │
│     Same discipline as        │           │     → Graph.obj / router       │
│     Valhalla baseline         │           │     routing_build_artifacts  │
└─────────────────────────────┘           └─────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ E. Fastify routing gateway (unchanged public contract)                    │
│    POST /api/routing/route                                                │
│    profile=multimodal → OtpRoutingEngineAdapter                           │
│    walk / car / motorcycle → ValhallaRoutingEngineAdapter                 │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ F. Frontend multimodal route UI (apps/web)                                │
│    Leg list: walk | bus | rail | ferry; map geometry from API only        │
│    Bus/express viewing UI stays separate from journey planner               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Engine separation (strict)

| Engine | Input | Serves |
|--------|--------|--------|
| **Valhalla** | Road tiles from OSM PBF (+ future core street overlay) | `walk`, `car`, `motorcycle` |
| **OTP** | GTFS + OSM street network | `multimodal` and transit legs |

Do **not** mix Valhalla tiles and OTP graph artifacts in the same directory. Use `routing.routing_builds` and `routing.routing_build_artifacts` with distinct artifact types (`valhalla_tiles` vs future `otp_graph`).

Planned infrastructure path when implemented: `infrastructure/routing/otp/` (Docker, build scripts, local GTFS folder) — **not created in this planning phase**.

---

## 3. Future transit tables (`transit` schema)

Planned normalized schema. **No migrations yet.** Names and columns may change when designed against `core.core_bus_*` migration.

### Reference / operators

| Table | Purpose |
|-------|---------|
| `transit.operators` | Agency (YBS, express, rail, ferry); GTFS `agency_id`, names, timezone |
| `transit.modes` | Canonical mode codes aligned with product |
| `transit.service_classes` | Local / express / intercity — aligns with `routing.routing_service_classes` |

### Stops and terminals

| Table | Purpose |
|-------|---------|
| `transit.stops` | Stop points (`geom`), platform, zone, parent station |
| `transit.stop_names` | Localized names (Myanmar / English), aliases |
| `transit.terminals` | Express / intercity terminals; may link to core places |

### Routes and geometry

| Table | Purpose |
|-------|---------|
| `transit.routes` | Logical route; operator, mode, service class, verification status |
| `transit.route_names` | Short / long names, default headsign |
| `transit.route_patterns` | Direction / variant (inbound, outbound, loop) |
| `transit.pattern_stops` | Ordered stop sequence per pattern |
| `transit.route_paths` | Centerline for map display (may differ from GTFS `shapes.txt`) |

### Schedules (GTFS-shaped)

| Table | Purpose |
|-------|---------|
| `transit.services` | Service calendar / calendar dates |
| `transit.trips` | Trip instance: pattern + service + headsign + direction |
| `transit.stop_times` | Arrival / departure per trip per stop |
| `transit.frequencies` | Headway-based schedules when exact times are unknown |
| `transit.transfers` | Minimum transfer time / preferred interchanges |

### Export and QA

| Table | Purpose |
|-------|---------|
| `transit.gtfs_export_batches` | Export run: scope, file URL, checksum, counts, lineage |
| `transit.gtfs_validation_reports` | Validator errors/warnings per batch |

Apply the same production patterns as `core.*`: `public_id`, soft `deleted_at`, verification fields, `source_refs`, confidence scores (0–100).

---

## 4. Future modes

| Mode | Notes | OTP / GTFS |
|------|--------|------------|
| **Bus** | YBS and urban local lines | `route_type` 3; `stop_times` or `frequencies` |
| **Express bus** | Limited-stop, highway corridors, terminals | Often separate `agency_id`; `service_class=express` |
| **Rail** | Main line when verified | `route_type` 2 |
| **Ferry** | River crossings | `route_type` 4 |

`routing.routing_physical_modes` already seeds `bus`, `rail`, `ferry` (disabled). Express may map to physical `bus` with `routing_service_classes.code = 'express'`.

---

## 5. API compatibility

### Same gateway

```http
POST /api/routing/route
```

| Field | Road (now) | Multimodal (future) |
|-------|------------|---------------------|
| `profile` | `walk`, `car`, `motorcycle` | `multimodal` |
| `origin`, `destination` | lat / lng | Same |
| Response | `PostRouteResponseBody` | Same normalized shape |

`GET /api/routing/profiles` lists only enabled profiles. When OTP ships, enable `multimodal` in DB and `ROUTING_ROUTE_PROFILES_ENABLED`.

### Profile routing inside API

```text
profile ∈ { walk, car, motorcycle }  →  ValhallaRoutingEngineAdapter
profile = multimodal                 →  OtpRoutingEngineAdapter
                                       (optional Valhalla for access/egress legs)
```

`RoutingDirectionsService` depends on `RoutingEngineAdapter` only — no OTP types in route handlers.

### OTP adapter → normalized response

Map OTP Plan / itinerary into existing types (`apps/api/src/modules/routing/routing.types.ts`):

- `status`: `ok` | `no_route` | `error`
- `routingEngine`: `otp`
- `summary`: `distanceMeters`, `durationSeconds`, `transferCount`
- `geometry`: overview LineString (optional)
- `legs[]` with optional `transit`: `agencyName`, `routeShortName`, `routeLongName`, `headsign`, `serviceClass`, `physicalMode`

Do not expose raw OTP leg objects, internal stop IDs, or fare products unless mapped to stable public identifiers.

### Builds and logging

- `routing.routing_requests` — `engine_code = 'otp'`, link to active OTP `routing_build_id`
- `routing.routing_build_sources` — lineage: GTFS export batch, OSM PBF scope
- Reuse `tools/routing/` smoke pattern with fixed multimodal fixtures when OTP is local

---

## 6. Strict rule: frontend never calls OTP directly

| Layer | Allowed |
|-------|---------|
| `apps/web` | `POST /api/routing/route`, `GET /api/routing/profiles`, `GET /api/routing/health`, `POST /api/routing/feedback` |
| `apps/dashboard` | Admin routing APIs only |
| Browser → Valhalla | **Forbidden** |
| Browser → OTP | **Forbidden** |

OTP base URL (e.g. `OTP_BASE_URL`) is API server env only, same as `VALHALLA_BASE_URL`.

Benefits: auth, rate limits, audit (`routing.routing_requests`), normalized errors, build versioning, no CORS exposure of internal engines.

---

## 7. First OTP experiment (local only)

Minimal vertical slice before production publish:

| Item | Choice |
|------|--------|
| Data | **One verified YBS route** (known geometry + stop order) |
| Patterns | **Outbound + inbound** |
| Schedule | **Frequency-based** (`transit.frequencies`) — no fake minute-level precision |
| Street graph | Small OSM extract or Yangon clip |
| OTP | Local Docker under `infrastructure/routing/otp/` — **not added yet** |
| API | Feature-flagged `OtpRoutingEngineAdapter`; `profile=multimodal` for one test O→D pair |
| UI | Optional dev-only multimodal result display |

### Success criteria

- GTFS export validates with zero errors (warnings documented)
- OTP returns a plan with ≥1 transit leg and walk access/egress
- API response passes Zod/OpenAPI and web types
- `tools/routing` script: one fixed pair returns `ok` or explicit `no_route`

### Non-goals for experiment

- Nationwide GTFS
- All YBS lines
- Real-time arrivals
- Express / rail / ferry (after bus slice works)
- Production `routing.routing_builds.is_active` flip

---

## 8. Out of scope (this plan phase)

| Item | Notes |
|------|--------|
| OTP Docker / compose files | Create with `infrastructure/routing/otp/` implementation |
| `transit.*` SQL migrations | Separate PR when schema is approved |
| One-step replacement of `core.core_bus_*` | Plan ETL / dual-write separately |
| Production OTP CDN deploy | After local experiment + validation |
| Valhalla transit costing | Valhalla is road-only in V2 |
| Custom SQL transit router | OTP is the engine |
| LLM or chat-based directions | Deterministic OTP only |

---

## 9. Implementation checklist (when work starts)

- [ ] Approve `transit.*` ERD and migrations (or bridge from `core.core_bus_*`)
- [ ] GTFS exporter + `transit.gtfs_export_batches`
- [ ] GTFS validator + `transit.gtfs_validation_reports`
- [ ] `infrastructure/routing/otp/` build/run scripts + README
- [ ] OTP artifacts in `routing.routing_build_artifacts`
- [ ] Implement `OtpRoutingEngineAdapter.route()` + mapper tests
- [ ] Enable `multimodal` in DB + API config
- [ ] Multimodal smoke tests in `tools/routing/`
- [ ] Web journey UI (legs, transfers, unverified schedule badge)
- [ ] Dashboard: export batches, validation reports, publish build

---

## 10. Open design questions

1. Single merged GTFS feed vs per-operator feeds for OTP build.
2. Access/egress: OTP walk only vs Valhalla walk legs stitched in API.
3. `transit.route_paths` for map vs generated GTFS `shapes.txt`.
4. Express terminals: `transit.terminals` only vs links to `core` POIs.
5. When to require `stop_times` vs `frequencies` for production publish.
6. Long-term relationship between `transit.*` and `core.core_bus_*`.

---

*Planning doc only — no OTP infrastructure, no transit migrations, no adapter implementation.*
