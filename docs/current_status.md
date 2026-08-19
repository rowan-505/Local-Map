# CoreMap current status

Read-only repo inspection, 2026-08-20. Code and migrations beat old docs.

Status: **WORKING** = usable end-to-end · **IMPLEMENTED** = built, not production-proven · **PARTIAL** = real but incomplete · **FOUNDATION** = schema/scaffold only · **MISSING** / **LEGACY** / **UNKNOWN**

Live hosting is **UNKNOWN** unless noted. Config and claimed URLs are not proof.

---

## Snapshot

Late V1 / early V2. Architecture is real. Public map + admin data tools are the strongest parts. Production routing, CI, and community-to-map are not.

| | |
|---|---|
| Biggest strength | PostGIS + Fastify + MapLibre, import/core review, national PMTiles web client |
| Biggest weakness | UI/docs look finished where engines, indexes, or apply-steps are missing or unproven |
| Next milestone | One truthful environment: CI, locked CORS, verified tile manifest, routing on **or** hidden |

```text
Basemap:      IMPLEMENTED (overview + 15 regions in repo; CDN live UNKNOWN)
Data:         WORKING core entities; OSM pipeline mature
Search:       IMPLEMENTED unified API; address chip hidden
Address:      PARTIAL (reverse useful; forward search not public)
Routing:      PARTIAL code / NO proven production path
Transit:      viewing + admin; no journey planning; no realtime
Web:          IMPLEMENTED
Dashboard:    IMPLEMENTED core/IR/transport/search/users; refs/tiles/health stub or missing
Android:      FOUNDATION (fake UI, no MapLibre, no API)
Auth:         WORKING (JWT + password + email OTP; no reset)
Community:    reports + manual points; no map apply; no live location
Infra:        configs exist; live UNKNOWN; CI = glyphs only; no Sentry
```

---

## Architecture

```text
PostGIS = truth → Fastify API = logic/auth → Web/Dashboard = clients
PMTiles + MapLibre = rendering    Martin = optional transport overlay
Android = experimental, not V2 production
```

| Layer | Tech | Status | Gap |
|---|---|---|---|
| DB | PostgreSQL/PostGIS, migrations through 191 | IMPLEMENTED | No tile-package or live-location tables |
| API | Fastify, Zod, JWT, Prisma (thin) + raw SQL | WORKING | No live-location/tile-registry modules |
| Web | Vite + MapLibre + PMTiles | IMPLEMENTED | Address chip hidden; routing needs flag |
| Dashboard | Next.js, API only (no Prisma/DB) | IMPLEMENTED | Refs/stats stubs; no tile/health UI |
| Tiles | 1 overview + 15 region PMTiles | IMPLEMENTED | File `manifest.json`, not a DB registry |
| Routing | Valhalla adapter + local Docker | PARTIAL | `ROUTING_ENABLED=false`; no prod service file |
| Android | Compose + fake data | FOUNDATION | No map SDK, no API |

**Followed:** web/dashboard do not touch Postgres. API does not generate tiles. Geospatial/search use raw SQL.

**Deviations**

- `tools/data-pipeline/direct-core/` writes production via `psql` (ops path, not API)
- Martin reads PostGIS for tiles
- Unused `@supabase/supabase-js` in API
- JWT in dashboard `localStorage`; no Next middleware
- Experimental routing graph flags; `routing_nodes`/`routing_edges` absent from prod ERD

---

## Direct answers

```text
Nationwide reliable production routing?
NO — adapter + UI exist; flag default false; no Valhalla in render.yaml

Google-like unified search (places + addresses + streets + admin + transit)?
PARTIAL — one GET /public/search; address chip hidden; not commercial quality

Useful reverse address for an arbitrary Myanmar coordinate?
PARTIAL — nearby + admin + plus code + composed line; not house-level

YBS viewing / YBS routing / train / express / multimodal / realtime
PARTIAL view+admin / MISSING / PARTIAL data / PARTIAL / MISSING / MISSING

Auth / saved places / reports / points / live location / business profiles
WORKING / WORKING / tickets only / manual ledger / MISSING / MISSING
```

Contribution chain today:

```text
User report → stored → admin status/note → optional points → STOP
(no write back to core.*)
```

---

## Feature matrix

| Area | Status | Gap |
|---|---|---|
| Overview + 15 regional PMTiles | IMPLEMENTED | CDN live UNKNOWN; no registry UI |
| Dynamic region load (z≥7, max 4) | WORKING | — |
| Martin transport overlay | IMPLEMENTED | Needs `VITE_MARTIN_TILE_URL`; live UNKNOWN |
| Roads, names, direction | WORKING | Deprecated `road_class` / `is_oneway` still on table |
| Road access | FOUNDATION | `access_rules` column; no public UI |
| Routing barriers | PARTIAL | Import-review only; not proven in Valhalla |
| Turn restrictions | FOUNDATION | DB + pipeline; no API/dashboard |
| Places | WORKING | Public detail has no phone/website (`core_place_contacts` unused publicly) |
| Buildings + place links | WORKING | Admin + tiles; not a public building product |
| Landuse / water | WORKING | Admin + tiles + search |
| Protected areas / coastline | PARTIAL / IMPLEMENTED | DB + tiles; no API/dashboard |
| Admin areas | WORKING | — |
| MY/EN names | WORKING | Some scalar `name` columns deprecated |
| POI / street / admin / transit search | WORKING | — |
| Address search | PARTIAL | API type exists; web chip off |
| Unified search | IMPLEMENTED | Not Google-quality |
| Reverse / plus codes / coordinates | WORKING | Approximate |
| Share links | WORKING | Place/point; no expiry; not live share |
| Walk / car / motorcycle UI | IMPLEMENTED | Engine unproven |
| Valhalla | IMPLEMENTED local | Production UNKNOWN |
| Routing admin | PARTIAL | Inspect only; no publish/rollback |
| YBS stops/routes/variants | WORKING | Viewing, not routing |
| Train / express / ferry | PARTIAL / FOUNDATION | Modes + some data |
| GTFS / OTP | FOUNDATION | Metadata / stub adapter |
| Auth + viewer role | WORKING | Roles only; no permission codes; no password reset |
| Saved places / reports / points | WORKING | Points manual by design |
| Live location | MISSING | GPS on device only |
| Core review / import review / promote | WORKING | No protected/coastline/turn-restriction CRUD |
| Search admin | WORKING | — |
| References / extra stats tabs | FOUNDATION | Placeholders |
| Tile / system health / global audit | MISSING | — |
| Android | FOUNDATION | Prototype |

---

## Data / pipeline

Schemas in prod ERD: `core`, `ref`, `search`, `routing`, `tiles`, `import_review`, `system`, `app_auth`, `app`, `feedback`, `contrib`, `share`, `transport`, `transit_export`. `community` exists and is unused (conflicts with “no social feed”).

**Active writes**

```text
OSM PBF → raw → staging → classify
  safe_new/safe_update → direct-core (regional psql) or Import Review
  conflict/protected → Import Review → promote → core
  pmtiles_only → tiles only
```

- Local OSM pipeline never writes core (`tools/data-pipeline/local-osm/`)
- Transport JSON (YBS) and train-app import are separate from OSM IR
- IR bus families are disabled (use Transport module)
- Prisma maps only `app` / `app_auth` / `contrib` / `core` / `ref` / `system`

---

## Web (usable now)

**Working:** national map, region tiles, MY/EN labels, POI markers, search (places/areas/roads/transport), place detail, map-click reverse, plus codes, geolocation, language switch.

**Partial:** directions (API; may 503), Martin overlay, auth/saved/reports/share.

**UI-only:** More panel, Bus sidebar placeholder, disabled bus/train routing.

**Missing:** live location, transit planner, public contacts, address chip.

Kyauktan bbox still in `apps/web/src/config/regionScope.ts`. Overpass/local POI pipeline is gone from the tree.

---

## Dashboard modules

| Live | Stub / missing | Legacy redirect |
|---|---|---|
| Core review (8 entities + geom) | References | `/data-review` → import-review |
| Import review + promote + history | Stats sub-tabs | `/core-verification` → core-review |
| Transport routes/stops/imports | Tile packages | landuse → land-areas |
| Search ops | System health, global audit | terminals list → stops |
| Reports, users, points | Turn restrictions, protected, coastline | signup → login |
| Routing inspect, stats overview | Core row history | |

Viewer = read-only on API (`requireDashboardWrite`). Reports/users/points hide from viewers but rely on API 403, not per-button `canWrite`.

---

## Infra / tests

```text
Web/Dashboard:  vercel.json only — live UNKNOWN
API:            docs say Render — not in render.yaml
Tiles:          R2 scripts + tiles.coremapmm.com in manifests — live UNKNOWN
Martin:         Fly + Render configs — live UNKNOWN
Valhalla:       local Docker only
CI:             .github/workflows/generate-glyphs.yml only
Monitoring:     no Sentry
```

API `npm test` = Prisma limit + transport. Search/import-review tests exist as extra scripts. Auth/reports/points have **no** module tests. Dashboard has tests but no npm test script.

---

## Debt (ranked)

**Critical:** unproven routing; no app CI; accepted reports do not change the map.

**High:** no tile registry; direct-core `psql`; in-memory rate limits; local vs prod schema drift; address search docs vs hidden chip.

**Medium:** unused `community` schema; Kyauktan leftovers; dual reverse endpoints; no Next middleware.

---

## What is MVP vs later

**Ready / almost:** core data model, OSM import/review, dashboard editing, national PMTiles web map, unified search (minus addresses), reverse + plus codes, auth/saved/share/reports/manual points, MY/EN labels.

**Harden:** CI, CORS/rate-limit, address index, Martin env, routing flag + host, tile checksums, report copy (“accepted” ≠ map updated).

**Unfinished:** production Valhalla, address chip, report→core handoff, tile registry, transit planner, live location, password reset, contacts on public places.

**Future only:** OTP multimodal, realtime transit, production Android, offline, business claiming, auto points, LLM search.

---

## Next 10 (from repo reality)

1. CI typecheck/test for API, web, dashboard  
2. Prove routing or hide the UI  
3. Auth CORS / rate-limit pass  
4. Address search: fill index or document reverse-only  
5. Tile manifest checksum/version vs R2  
6. Report → open in core-review (no auto-edit)  
7. Public place contacts  
8. Confirm Martin overlay on or off in prod  
9. Password reset  
10. Small tile-package table (after 5)

Do not start live location, Android production, or OTP next.

---

## Docs vs code

| Claim | Reality |
|---|---|
| `docs/search-routing.md` address search | Web hides Addresses (`PUBLIC_SEARCH_ADDRESSES_FILTER_ENABLED = false`) |
| Live location in `AGENTS.md` | No module, tables, or routes |
| V2 tile-package registry | Static `apps/web/public/basemaps/manifest.json` |
| `V2_PRODUCTION_IMPLEMENTATION_PLAN.md` | Not in repo; use `AGENTS.md` / `docs/roadmap.md` |
| All writes through API | direct-core and Martin use Postgres |
| Production Valhalla | Adapter yes; flag off; no prod service |

Plan: [`roadmap.md`](roadmap.md). Rules: [`AGENTS.md`](../AGENTS.md).
