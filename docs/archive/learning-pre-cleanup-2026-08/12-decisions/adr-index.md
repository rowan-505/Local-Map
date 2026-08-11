---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Architecture decision record index
---

# ADR index

CoreMap does not yet use formal numbered ADR files. Key decisions are documented in:

| Decision | Canonical location |
|----------|-------------------|
| Layered architecture (DB → API → clients) | [`AGENTS.md`](../../AGENTS.md), [Architecture](../00-overview/architecture.md) |
| PMTiles-first basemap | [Tiles overview](../06-tiles/tiles-overview.md) |
| Valhalla for routing (not custom DB engine) | [Routing](../08-search-address-routing/routing.md) |
| Deterministic search (not LLM) | [Search system](../08-search-address-routing/search-system.md) |
| Manual admin points only | [`AGENTS.md`](../../AGENTS.md) |
| Import-review separate auth | [Import review API](../03-api/import-review-api.md) |
| Address components as source of truth | [Address system](../08-search-address-routing/address-system.md) |
| Supabase MCP read-only | [Migrations](../02-database/migrations.md) |

## Historical decisions (archive)

Review archived docs in [`docs/archive/old-docs/`](../archive/old-docs/) for implementation-era choices (promotion contracts, direct-edit migration, transport schema).

## Adding ADRs

When making significant architecture changes, add `docs/12-decisions/NNN-title.md` with context, decision, and consequences.
