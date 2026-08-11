---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Documentation reorganization audit record (2026-07-01)
---

# Documentation reorganization audit

Record of the 2026-07-01 docs consolidation. See [`README.md`](README.md) for navigation.

## Summary

| Action | Count |
|--------|------:|
| Canonical docs created in `docs/` | 60+ |
| Files archived (preserved in `docs/archive/old-docs/`) | 50+ |
| Scattered docs replaced with pointer stubs | 16 |
| Infrastructure/app READMEs updated with links | 6 |

## Classification by source

### Root

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `AGENTS.md` | AI + architecture operating guide | **current** | **keep** at root | Active agent contract; summarized in `docs/00-overview/` |
| `learning.md` | Personal learning notes | **partial** (empty) | **archive** + stub | Empty; pointer to docs index |

### `apps/api`

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `README.md` | API quick start | **current** | **keep** + link | Operational entry next to code |
| `docs/API.md` | Generated route reference | **current** | **keep** | Auto-generated from OpenAPI |
| `docs/openapi.md` | Swagger usage | **duplicate** | **merge** → stub | Merged into `docs/03-api/` |
| `docs/import-review-auth.md` | Import-review auth | **current** | **merge** → stub | Canonical `docs/03-api/import-review-api.md` |
| `docs/*-qa-checklist.md` (4) | Manual QA | **partial** | **archive** + stub | QA preserved in archive |

### `apps/web` / `apps/dashboard`

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `README.md` | Boilerplate (web) / minimal (dash) | **outdated** | **replace** | Now points to `docs/04-web-map`, `docs/05-dashboard` |
| `docs/regional-pmtiles-qa.md` | Tile QA | **partial** | **archive** + stub | Linked from debugging docs |
| `docs/manual-qa-street-editor.md` | Street editor QA | **partial** | **archive** + stub | Linked from geometry-editor doc |

### `docs/` (pre-reorg scattered `.md` files)

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `address-architecture.md` | Address model | **current** | **archive** + canonical | Merged into `08-search-address-routing/address-system.md` |
| `search-system-qa.md` | Search QA | **partial** | **archive** + canonical ref | Checklist stays in archive |
| `api-route-inventory.md` | Routes snapshot 2026-05 | **outdated** | **archive** | Superseded by live OpenAPI |
| `import-review-*.md` | Import/promotion notes | **partial** | **archive** | Many era-specific; indexed from `05-dashboard/import-review.md` |
| `routing-graph-build.md` | Routing build | **partial** | **archive** + canonical ref | Summary in `08-search-address-routing/routing.md` |
| `tiles/*` | Tile QA and R2 guides | **partial** | **archive** + canonical ref | Summary in `docs/06-tiles/` |
| `transport/*` | Transit plans | **archive-worthy** | **archive** | Future scope per AGENTS.md |
| `project-structure.txt` | Full tree dump | **outdated** | **archive** | Use docs index instead |

### `infrastructure/database/docs/`

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| All 7 `.md` files | DB design rules | **current** | **merge** + stub | Canonical `docs/02-database/` and `docs/07-data-pipeline/` |
| `README.md` | DB folder guide | **current** | **keep** + link | Operational; points to `docs/02-database/` |

### `infrastructure/tiles/`, `cloud/r2/`

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `tiles/README.md` | Tile pipeline index | **current** | **keep** + link | Operational runbooks stay in place |
| `pmtiles/README.md` | Build commands | **current** | **keep** | Canonical `docs/06-tiles/pmtiles.md` summarizes + links |
| `cloud/r2/README.md` | CORS commands | **current** | **keep** + fix links | Fixed broken `docs/tiles/` paths |

### `tools/`

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `data-pipeline/*/README.md` | Pipeline runbooks | **current** | **keep** | Operational; linked from `docs/07-data-pipeline/` |
| `_archived/*/README.md` | Old scripts | **archive-worthy** | **keep** in place | Already archived folder |
| `import-review/README.md` | Utilities | **current** | **keep** | Linked from pipeline docs |

### `apps/mobile/`

| File | Topic | Status | Action | Reason |
|------|-------|--------|--------|--------|
| `andriod-kotlin/docs/*.md` | Mobile architecture | **partial** | **keep** | Experimental; not in V2 scope |

## Conflicts / needs verification

1. **`V2_PRODUCTION_IMPLEMENTATION_PLAN.md`** — referenced in `AGENTS.md` but **not found** in repo.
2. **Production domain names** — not committed; see `docs/09-deployment/domains-dns.md`.
3. **`api-route-inventory.md`** (2026-05-08) — likely stale vs current `app.ts` routes; use OpenAPI.
4. **`import-review-current-status.md`** — point-in-time status; historical only.

## Important content preserved

- All pre-move markdown content under `docs/archive/old-docs/` (with `status: archived` frontmatter)
- Generated `apps/api/docs/API.md` unchanged
- `AGENTS.md` unchanged at repo root
- Tool and infrastructure operational READMEs kept; stubs only where content was duplicated
