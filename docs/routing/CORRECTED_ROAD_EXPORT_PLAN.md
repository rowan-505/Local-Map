# Corrected-road export plan (CoreMap → Valhalla)

Planning document for how **`core.core_streets`** corrections will eventually feed **production Valhalla** routing builds. This describes intent and workflow only — **no export implementation exists yet**.

Related docs:

- [AGENTS.md](../../AGENTS.md) — routing architecture rules
- [infrastructure/routing/valhalla/README.md](../../infrastructure/routing/valhalla/README.md) — local Valhalla build/run
- [docs/routing-graph-build.md](../routing-graph-build.md) — Phase 9E PostGIS graph (validation/export helper, not Valhalla)
- [tools/routing/README.md](../../tools/routing/README.md) — API/Valhalla smoke tests
- Migration `060_routing_metadata_foundation.sql` — `routing.routing_builds`, `routing_build_sources`, `routing_validation_reports`

---

## 1. Current routing source (today)

### Primary graph input: Myanmar OSM PBF

Production-style road routing in V2 starts from a **static OpenStreetMap extract**, not from live `core.core_streets` rows.

| Item | Location / notes |
|------|------------------|
| Default extract | [Geofabrik Myanmar](https://download.geofabrik.de/asia/myanmar-latest.osm.pbf) |
| Local path | `infrastructure/routing/valhalla/data/osm/myanmar-latest.osm.pbf` (gitignored) |
| Build | `infrastructure/routing/valhalla/scripts/build-valhalla.sh` |
| Runtime | Docker Valhalla on `VALHALLA_PORT` (default `8002`) |
| API | `apps/api` Valhalla adapter → `POST /api/routing/route` |

For faster iteration, operators may use a **smaller regional PBF** and clip bbox env vars (`VALHALLA_MIN_X` / `MAX_X` / `MIN_Y` / `MAX_Y`) — same pipeline, smaller graph.

### What PostGIS holds today

| Layer | Role |
|-------|------|
| `core.core_streets` | **Source of truth** for reviewed/corrected road geometry and attributes in CoreMap |
| `routing.routing_builds` | Published **engine build** metadata (Valhalla tiles, OTP later) — migration 060 |
| `routing.routing_nodes` / `routing.routing_edges` | Optional **Phase 9E** endpoint graph for validation/export experiments — **not** the production router |
| `routing.routing_requests` | Public directions audit log (summaries only) |

**Rule (non-negotiable):** Valhalla consumes **built tile artifacts**. The API never rebuilds tiles per request.

---

## 2. Future corrected-road flow (target)

When export is implemented, the intended pipeline is:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Source baseline                                                       │
│    Geofabrik (or other) Myanmar OSM PBF  ──►  baseline road network      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. CoreMap corrections (ongoing)                                         │
│    Dashboard / import-review / core-review  ──►  core.core_streets         │
│    (geometry, class, oneway, bridge/tunnel, status, verification)          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Routing export job (future tool — not implemented)                      │
│    Select exportable streets (scope: region, publish batch, bbox)          │
│    Emit OSM-like ways + relations OR structured overlay manifest           │
│    Record lineage in routing.routing_build_sources (core_streets_export)   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Merge strategy (TBD — design choice at implementation time)            │
│    Option A: single merged .osm.pbf (baseline + corrections)             │
│    Option B: correction overlay consumed by custom pre-process           │
│    Option C: regional extracts per publish wave                           │
│    Must preserve OSM semantics Valhalla expects (highway, oneway, layer…)  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Valhalla build                                                        │
│    Same as today: docker-valhalla / CI  ──►  valhalla_tiles + sidecars     │
│    Store artifacts in routing.routing_build_artifacts (R2/CDN in prod)     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Validation                                                            │
│    Automated checks  ──►  routing.routing_validation_reports             │
│    Smoke routes (tools/routing, Myanmar fixtures)                        │
│    Optional compare against prior active build (regression diff)         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. Publish active build                                                  │
│    routing.routing_builds: status=published, is_active=true (per engine) │
│    API reads active build via env + metadata (build_code / artifact URLs)  │
│    Dashboard: System Admin → Routing (inspect only today; publish later) │
└─────────────────────────────────────────────────────────────────────────┘
```

### Optional inputs (same build record)

- **`routing.routing_barriers`** — turn restrictions, closures, access rules when available (export as restrictions or post-build config — TBD).
- **Publish/review batch IDs** — tie export scope to `source_refs` on streets (`publish_batch_id`, `review_batch_id`) for traceability.

### Export job ownership

| Component | Owner |
|-----------|--------|
| Selection + attribute mapping SQL | `apps/api` or `tools/routing/` script (repeatable, env-driven) |
| PBF merge / tile build | `infrastructure/routing/valhalla/` or CI worker |
| Build registry + publish | API + dashboard admin (metadata already in 060) |
| Public routing | `apps/api` adapter only |

---

## 3. Core street fields that matter for export

These columns on **`core.core_streets`** (see ERD `infrastructure/database/introspection/supabase/erd/current.mmd`) drive routing quality. Export logic should define explicit include/exclude rules per field.

### Identity and geometry

| Field | Export relevance |
|-------|------------------|
| `geom` | **Required.** LineString (or derived centerline). Invalid/non-simple geometry must fail validation. |
| `canonical_name` | Optional for edge names / debugging; not required for Valhalla graph topology. |
| `public_id` / `external_id` | Traceability in build `source_refs`; map to export feature IDs. |
| `deleted_at` | **Exclude** soft-deleted streets from export. |
| `is_active` | **Exclude** inactive rows unless product policy says otherwise. |

### Road classification and travel attributes

| Field | Export relevance |
|-------|------------------|
| `road_class_id` | **Primary** join to `ref.ref_road_classes` for normalized class code. |
| `road_class` | Denormalized code; use for export when FK present; validate consistency with `road_class_id`. |
| `surface` | Maps to OSM `surface` / costing hints where applicable (unpaved, etc.). |
| `is_oneway` | Maps to `oneway=yes` / `-1` / two-way absence; critical for drive/motorcycle. |
| `bridge` | OSM `bridge=yes` (or equivalent) — affects layering and connectivity. |
| `tunnel` | OSM `tunnel=yes` — pairing with `layer` matters. |
| `layer` | OSM `layer=*` — resolves vertical ordering (bridge/tunnel conflicts). |

### Provenance and OSM compatibility

| Field | Export relevance |
|-------|------------------|
| `source_tags` | **Important.** Preserve original OSM tags for merge/conflict resolution when correcting baseline PBF. |
| `source_refs` | Links to publish/review batches; scopes export jobs. |
| `source_type_id` | Audit only unless export needs source-type filtering. |
| `normalized_data` | Optional structured hints from import pipeline; do not blindly overwrite explicit columns. |

### Editorial / workflow gates

| Field | Export relevance |
|-------|------------------|
| `is_verified` | Strong signal for “safe to route”; export policy may require `true` for production merge. |
| `manual_override` | Indicates human edit — include in export manifest for review; may relax automated checks with extra QA. |
| `edit_status` | Filter draft vs accepted edits (exact enum values — align with core-review rules). |
| `routing_status` | CoreMap sync state with routing graph jobs (e.g. set to `synced` after successful export inclusion — see Phase 9E pattern). |
| `verification_status` / `verified_at` / `verified_by` | Optional stricter gate than `is_verified` alone. |
| `last_edited_at` | Incremental export windows (“streets changed since build X”). |

### Fields that do **not** replace OSM tags alone

Export must emit **Valhalla-compatible** highway tags. Internal IDs (`road_class_id`) should translate through `ref.ref_road_classes.code` to OSM highway values (`residential`, `primary`, `track`, etc.). Document the mapping table in the export tool when implemented.

### Non-routable classes (align with graph build)

Phase 9E already skips classes such as `steps`, `corridor`, `proposed`, `construction`, `abandoned` (see `ROUTING_GRAPH_NON_ROUTABLE_CLASS_CODES` in `apps/api/src/modules/routing/routing.config.ts`). The corrected-road export should use the **same or stricter** exclusion list unless a class is explicitly promoted.

---

## 4. Validation checks (pre-build and post-build)

Store findings in **`routing.routing_validation_reports`** (`report_scope`: `engine_build`, `smoke_test`, `publish`, etc.). Severity: `info` | `warning` | `error`.

### Pre-export (on `core.core_streets` selection)

| Check | Description | Typical severity |
|-------|-------------|------------------|
| **Invalid geometry** | NULL, empty, non-LineString, self-intersecting, SRID ≠ 4326 | error |
| **Missing road class** | `road_class_id` / `road_class` null or unknown code | error / warning |
| **Duplicated segments** | Same geometry hash or parallel duplicate ways within tolerance | warning |
| **Suspicious one-way** | One-way on tracks/paths; one-way against `source_tags`; isolated one-way islands | warning |
| **Bridges/tunnels/layer conflicts** | `bridge=true` with missing `layer`; tunnel/bridge mismatch vs `source_tags` | warning |
| **Disconnected roads** | Endpoint not near any other export segment (within snap tolerance) — especially before intersection splitting | warning |
| **Scope leakage** | Streets outside bbox/batch filter included | error |
| **Deleted/inactive included** | `deleted_at` set or `is_active=false` | error |

### Post-merge / post-Valhalla-build

| Check | Description |
|-------|-------------|
| **Smoke routes** | Fixed Myanmar corridors (`tools/routing/smoke-test-routing-api.sh`) — `ok` or explicit `no_route` |
| **Valhalla connectivity** | Long routes fail where graph should exist |
| **Regression vs prior build** | Distance/time deltas over threshold on golden routes |
| **Artifact integrity** | Checksum, file size, tile bounds vs `routing.routing_builds.summary` |

### Phase 9E graph (optional, not Valhalla)

The existing **endpoint-only** graph in `routing.routing_edges` can surface `DISCONNECTED_ENDPOINT` and `INTERSECTION_SPLITTING_NOT_IMPLEMENTED` warnings before investing in a full PBF export. That graph remains a **validation helper**, not the production engine (per AGENTS.md).

---

## 5. Why live road edits do not instantly update Valhalla

| Reason | Explanation |
|--------|-------------|
| **Static tiles** | Valhalla loads precomputed **routing tiles** (road graph on disk). It does not query PostGIS at request time. |
| **Build cost** | Country-wide tile builds are **slow** (CPU, disk, hours) — unsuitable per edit. |
| **Consistency** | All users must share the same graph version for predictable directions and debugging (`routing.routing_requests` links to `build_code`). |
| **Safety** | Corrections go through verification, export QA, smoke tests, and admin publish — not direct map → router mutation. |
| **Architecture** | `core.core_streets` is source of truth for **data**; `routing.routing_builds` is source of truth for **which graph the API uses**. |

Editing a street in the dashboard updates PostGIS immediately for **map display** (tiles/API overlays) but **not** the active Valhalla build until the next publish cycle.

---

## 6. Recommended rebuild cadence

| Mode | When | Who | Notes |
|------|------|-----|-------|
| **Manual (now / near term)** | After a meaningful batch of verified street fixes in a region | Operator runs `build-valhalla.sh` (or future CI job), smoke tests, admin marks build active | Suitable for Yangon/Kyauktan precision waves |
| **Scheduled (later)** | Weekly or monthly; or after each **publish batch** closes | CI pipeline triggered on calendar or on `system_publish_batches` state | Keeps national graph fresh without tying to every edit |
| **Emergency rebuild** | Critical safety fix (wrong one-way, missing bridge link, major corridor) | Expedited export scope (bbox or corridor), fast validation, swap `is_active` build | Document incident + `routing_build_sources` lineage |

### Suggested triggers for a full or regional rebuild

- Publish batch promoted with **> N** verified street geometry changes in region.
- Repeated routing feedback (`routing.routing_feedback`) clustered on same corridor.
- OSM Myanmar PBF refreshed (quarterly Geofabrik pull) + re-apply corrections overlay.
- Valhalla version bump or costing config change requiring retile.

### Incremental export (future optimization)

Track `last_edited_at` / publish batch on included streets to export **delta overlays** only. Full national merge may still be required periodically to avoid drift from baseline PBF. Design TBD at implementation time.

---

## 7. Out of scope

Do **not** plan or implement these as part of corrected-road export:

| Out of scope | Why |
|--------------|-----|
| **Real-time graph mutation** | No “update Valhalla on every street save.” Conflicts with static tile model and safety. |
| **Custom SQL routing engine in production** | V2 uses Valhalla (and later OTP for transit). `routing.routing_nodes/edges` are for validation/export experiments only. |
| **Storing all Valhalla edges in PostGIS** | Tiles hold the graph; DB stores **metadata, lineage, validation** — not full edge topology. |
| **Public clients calling Valhalla** | All routing via `apps/api` adapter. |
| **Automatic publish without smoke tests** | Every build must pass scripted checks before `is_active=true`. |
| **Nationwide manual precision in one export** | Use regional/bbox scopes until national coverage is intentional. |

---

## 8. Implementation checklist (when export work starts)

Use this as a gate before marking “corrected roads in Valhalla” done:

- [ ] Export tool: scoped SQL from `core.core_streets` with documented include/exclude rules
- [ ] OSM tag mapping table (`ref_road_classes` → highway/surface/oneway/bridge/tunnel/layer)
- [ ] Merge strategy chosen and documented (baseline PBF + corrections)
- [ ] `routing.routing_build_sources.source_type = 'core_streets_export'` populated per build
- [ ] Artifacts registered in `routing.routing_build_artifacts` with checksums
- [ ] Validation reports + `tools/routing` smoke pass
- [ ] Admin publish procedure for `routing.routing_builds.is_active`
- [ ] Runbook update in `infrastructure/routing/valhalla/README.md` linking to this plan

---

## 9. Open design questions (resolve at implementation)

1. **Merge model:** single merged PBF vs correction-only overlay tool vs Mapbox/OSmium pipeline.
2. **Intersection handling:** export raw centerlines vs pre-split at intersections (Phase 9E2).
3. **Verification gate:** require `is_verified` vs `verification_status` vs manual publish checklist only.
4. **Barriers:** how `routing.routing_barriers` joins the same Valhalla build.
5. **Multi-engine:** same export feed Valhalla only initially; OTP remains separate.

---

*Last updated: planning doc only — export code not implemented.*
