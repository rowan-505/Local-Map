# CoreMap Project – AGENTS.md

## Purpose

This file is the tool-neutral operating guide for AI assistants working on this repository.

The project is now moving from V1 to **V2 production readiness**. V1 already has a deployed public web map, MapLibre rendering, POI markers, Myanmar labels, dashboard core-review pages, import-review flows, and core database entities. Do **not** restart the architecture. V2 must harden, extend, and productionize the existing system.

---

## Product Direction

CoreMap is a web-first Myanmar map platform.

### Current V2 goal

Build a production-ready web map that supports:

- whole-country Myanmar basemap coverage from OSM-level data
- stronger precision for Yangon Region
- highest precision for Kyauktan
- regional PMTiles delivery
- whole-country road routing
- YBS/local bus route viewing
- express bus route viewing and terminal/corridor search
- unified search across places, addresses, roads, admin areas, bus routes, bus stops, express routes, and terminals
- systematic address and reverse-address support
- user authentication and authorization
- saved places
- user reports and contribution submissions
- admin-controlled manual point rewards
- safe live location sharing
- full dashboard control for data, tiles, routing, search, users, reports, points, and system health

### What V2 is not

Do not turn V2 into a full Google Maps clone.

Do **not** implement unless explicitly requested:

- automatic point calculation
- live bus GPS tracking without a real data source
- flight routing or booking
- social feed, public reviews, or ratings
- AI chatbot as the core search system
- nationwide manual precision
- native mobile production app
- offline downloads
- business claiming workflow

---

## Non-Negotiable Architecture Rules

```text
Database/PostGIS = source of truth
Fastify API      = business logic and authorization
Tiles            = rendering only
Web/Dashboard    = API consumers only
Dashboard        = no direct database access
MapLibre         = rendering engine
PMTiles          = static basemap delivery
Martin           = optional dynamic tile delivery
```

Rules:

1. Never store important source data only in tiles.
2. Never put business logic in MapLibre style files.
3. Never let dashboard connect directly to PostgreSQL.
4. Never duplicate API business logic in frontend code.
5. Never let public clients write directly to the database.
6. All user, admin, contribution, point, search, live-location, routing, and publish actions must go through the API.
7. All production-sensitive actions must be audited.
8. Database changes must be migration SQL or clearly proposed SQL, not hidden manual changes.
9. Keep API modules domain-based and modular.
10. Prefer simple, tested, production-safe changes over clever rewrites.

---

## Tech Stack

### Database

- PostgreSQL
- PostGIS

Used for:

- places/POIs
- addresses
- streets/roads
- admin areas
- buildings
- landuse/water
- bus routes/stops
- express routes/terminals
- search index
- auth/session metadata
- contribution/reports/points
- tile/routing build metadata
- audit logs

### API

- Fastify
- TypeScript
- Zod validation
- PostgreSQL/PostGIS access
- Prisma only where it is already appropriate
- raw SQL for geospatial/search-heavy queries

API pattern:

```text
route → schema → service → repo
```

### Public web

- React + Vite
- MapLibre GL JS
- Tailwind CSS
- PMTiles protocol support

### Dashboard

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod

### Tiles

- PMTiles for stable static basemap
- Cloudflare R2/CDN for delivery
- Martin + PostGIS only for selected shared dynamic overlays
- MapLibre style JSON for rendering configuration only

### Routing

- Use external routing engine for production road routing.
- Preferred road engine: Valhalla for walk, drive, motorcycle/custom costing.
- OpenTripPlanner may be added later for full transit journey planning.
- Do not build a custom production routing engine from database graph tables in V2.

---

## Repository Structure

### apps/api

Fastify backend.

Responsibilities:

- business logic
- validation
- authentication/authorization
- CRUD operations
- search API
- routing adapter API
- contribution/report/point APIs
- live-location session APIs
- tile/routing/search/admin metadata APIs
- database access

Rules:

- API is the only application layer allowed to access database.
- Use modular domain folders.
- Use Zod schemas for request/response validation where possible.
- Use OpenAPI docs where the existing pattern supports it.
- Use raw SQL for geospatial queries, search ranking, and complex PostGIS operations.
- Keep route handlers thin.
- Never generate map tiles inside the API.

Expected module style:

```text
apps/api/src/modules/<domain>/
├── <domain>.routes.ts
├── <domain>.schema.ts
├── <domain>.service.ts
├── <domain>.repo.ts
├── <domain>.openapi.ts
└── <domain>.types.ts
```

### apps/dashboard

Internal admin dashboard.

Responsibilities:

- core-review pages
- import-review/promotion pages
- data verification
- map preview/edit forms
- reference management
- tile package management
- routing build management
- search management
- user/role/permission management
- report/contribution review
- manual point management
- audit/system health views

Rules:

- Must call API only.
- Must not use Prisma.
- Must not connect directly to database.
- Keep dashboard functional, safe, and fast before making it visually fancy.
- Use reusable review/config/page-shell patterns where they already exist.
- Paginate large tables.
- Do not load MapLibre on pages that do not need a map.
- Avoid duplicating entity-specific logic if a generic core-review pattern already exists.

### apps/web

Public map frontend.

Responsibilities:

- MapLibre rendering
- PMTiles basemap loading
- search UI
- place/address/detail cards
- directions UI
- bus/express route viewing
- saved places UI
- report issue UI
- live location sharing/viewer UI

Rules:

- Use tiles for rendering.
- Use API for search, details, routing, reports, saved places, auth, and live-location.
- No database access.
- No business logic that belongs in API.
- Keep initial load fast.
- Do not load all regional PMTiles at once.
- On mobile, prefer top search + bottom sheet, not permanent wide sidebars.

### packages

Shared reusable code.

Expected uses:

- shared types
- API client helpers
- localized name helpers
- map style helpers
- PMTiles protocol registration

Rules:

- Put truly shared logic here only if used by more than one app.
- Do not put app-specific business logic in packages.

### tools

Scripts and utilities.

Expected uses:

- OSM import pipelines
- tile generation
- ERD generation
- regression scripts
- deployment/helper scripts

Rules:

- Scripts must be repeatable.
- Prefer environment files/templates for local pipeline config.
- Do not hardcode secrets.
- Keep logs out of source if they are not intentionally tracked.

### infrastructure / database files

Expected uses:

- migrations
- schema SQL
- indexes
- views
- functions
- seed/reference data
- tile configuration
- deployment infrastructure

Rules:

- Always use migration files for database changes.
- Add indexes for search/geospatial/public query paths.
- Use 0–100 score scale for confidence, importance, popularity, quality, and related scores.

---

## V2 Feature Guidance

## 1. National PMTiles

Use 16 packages:

```text
1 overview PMTile
15 region/state/Naypyitaw PMTiles
```

Runtime loading:

```text
low zoom: overview only
regional zoom: overview + visible region
near border: overview + current region + optional adjacent region
```

Do not load all regional PMTiles at once.

Add/maintain a tile package registry with:

- package code
- region code
- package type
- version
- PMTiles URL
- style URL if needed
- zoom bounds
- geographic bounds
- checksum
- file size
- active/public flags
- publish metadata

Dashboard should support publish/rollback/preview for tile packages.

## 2. Routing

Use Valhalla for road routing.

V2 road modes:

- walk
- drive
- motorcycle

Routing workflow:

```text
OSM Myanmar PBF
+ core street corrections
+ restrictions/barriers if available
→ validated routing extract
→ Valhalla build
→ smoke tests
→ publish routing build
→ API adapter
→ web directions UI
```

Core street tables are correction/validation/export sources, not the production routing engine.

Do not overbuild `routing_edges` / `routing_nodes` unless explicitly needed for validation or export.

## 3. YBS and Express Bus

V2 supports route viewing/search, not fake live transit.

Include:

- YBS/local bus routes
- route variants
- stops
- stop sequence where available
- express bus operators
- express terminals
- express corridors/routes
- route confidence/status

Do not fake schedules, fares, or live GPS. If schedule data is unverified, show it as unverified.

## 4. Search

Start with deterministic structured search:

- PostgreSQL full-text search
- pg_trgm fuzzy matching
- PostGIS distance ranking
- aliases/synonyms
- language fallback: Myanmar/English
- confidence/verified/importance ranking

Search must support:

- places
- addresses
- streets
- admin areas
- bus stops
- YBS routes
- express routes
- terminals
- coordinates
- plus codes

Do not add LLM search as the core system in V2.

## 5. Address System

Myanmar addresses are often informal. Support:

- formal address
- street-based address
- landmark address
- village address
- POI-based address
- approximate address

Reverse address should return:

- nearest place
- nearest road
- admin hierarchy
- approximate address
- coordinates
- plus code

Do not pretend exact house-level accuracy when data is approximate.

## 6. Auth and Authorization

V2 needs public accounts for:

- saved places
- reports/contributions
- points
- live location sharing

Required concepts:

- users
- sessions
- refresh tokens
- email verification
- password reset
- roles
- permissions
- login events
- device/session management

Backend must check permissions for every protected action. Frontend hiding is not authorization.

## 7. Contributions and Manual Points

V2 point system is admin-controlled only.

Correct flow:

```text
User submits report/contribution
→ Admin reviews
→ Admin decides usefulness
→ Admin manually adds/subtracts points
→ Point ledger records transaction
→ User sees point history
```

Rules:

- Do not implement automatic point calculation in V2.
- Never edit/delete old point ledger rows.
- Use reversal rows for corrections.
- Audit all admin point actions.

## 8. Live Location Sharing

V2 supports safe, time-limited location sharing.

Include:

- create live session
- expiry duration
- random unguessable share token
- update current location
- viewer map
- stop sharing
- access logs
- retention limits

Exclude:

- always-on tracking
- public location feed
- family safety system
- background native mobile tracking
- live bus tracking

---

## Production Security Requirements

Before a feature is production-ready, check:

- backend authorization exists
- Zod/input validation exists
- rate limits exist for sensitive routes
- audit logs exist for admin/destructive/sensitive actions
- secrets are not exposed to frontend
- CORS is locked in production
- database writes go through API
- public APIs do not leak internal IDs when public IDs should be used
- live-location links expire
- point ledger actions are immutable and auditable
- destructive dashboard actions use confirmation
- errors are logged without leaking secrets

---

## Performance Rules

General:

- performance first over feature volume
- avoid huge GeoJSON payloads
- use vector tiles for large shared map layers
- use API for detail/search/user-specific data
- paginate lists
- debounce search/map queries
- cache where useful, but do not add Redis until needed

Database:

- use GIST indexes for geometry
- use bounding-box filters before expensive spatial operations
- use zoom-level filtering for tile views
- use geometry simplification for tiles
- use GIN indexes for full-text search
- use pg_trgm indexes for fuzzy search
- use partial indexes for public/active rows

Map:

- PMTiles for stable basemap
- Martin only for selected shared dynamic overlays
- API for search results, details, live location, and user-specific overlays
- avoid loading every marker at every zoom
- avoid loading all region packages at once

Dashboard:

- server-side pagination or API pagination
- avoid fetching all rows for list pages
- lazy-load map previews where possible
- keep detail drawers lightweight

---

## Naming and Data Rules

- Use 0–100 score scale, never 0–1, for confidence/importance/popularity/quality scores.
- Prefer `public_id` for public API references.
- Keep internal numeric IDs internal unless dashboard/admin requires them.
- Use soft delete for core production entities where existing patterns support it.
- Preserve source references and normalized data where available.
- Keep Myanmar and English names separate where the schema supports localized names.
- Do not remove existing verification/source/history fields without strong reason.

---

## Testing and Validation Expectations

When implementing changes, add or run appropriate checks:

### API

- typecheck
- unit tests where existing patterns exist
- route/schema validation
- OpenAPI update if needed
- regression script if touching core-review/import-review

### Dashboard

- typecheck
- lint when practical
- verify affected page loads
- verify API errors show readable UI states
- verify list/detail/edit flows

### Web

- typecheck
- build
- test map load
- test search/detail/routing UI manually when affected

### Database

- migration dry-run if possible
- verify indexes
- verify geometry SRID = 4326 where applicable
- verify PostGIS queries do not full-scan large tables unnecessarily

---

## Implementation Order for V2

Follow this priority unless the user explicitly overrides it:

```text
1. Production security foundation
2. National PMTiles and tile package registry
3. Auth + permissions + saved places
4. Contributions + manual admin points
5. Unified search
6. Address system
7. Whole-country Valhalla road routing
8. YBS + express route system
9. Live location sharing
```

Do not start with live location, points UI, or express UI before production foundation and national basemap are stable.

---

## AI configuration

Shared AI docs and skills live under [`docs/ai/`](docs/ai/README.md).

| Location | Purpose |
|----------|---------|
| `docs/ai/skills/` | Canonical skill definitions |
| `docs/ai/workflows/` | Agent workflow checklists |
| `CLAUDE.md` | Claude Code entry point |
| `.claude/skills/` | Claude skill mirror (sync from `docs/ai/skills/`) |
| `.cursor/rules/` | Cursor-specific rules (architecture, workflow, setup) |
| `.cursor/mcp.json` | Cursor MCP configuration |
| `.agents/` | Legacy optional layout; see `.agents/README.md` |

Implementation workflow rules for Cursor are in `.cursor/rules/07-agent-workflow-safety.mdc`. Tool-neutral checklists: [`docs/ai/workflows/`](docs/ai/workflows/).

V2 roadmap summary: [`docs/11-roadmap/v2-plan.md`](docs/11-roadmap/v2-plan.md).

---

## Final Summary

CoreMap must remain:

```text
PostGIS-driven
API-controlled
MapLibre-rendered
PMTiles-first
security-first
performance-first
web-first
modular
production-safe
```

The strongest V2 is not the biggest feature list. The strongest V2 is a safe, fast, nationally usable Myanmar map with trusted Yangon/Kyauktan precision and a dashboard that can control every production-critical dataset.
