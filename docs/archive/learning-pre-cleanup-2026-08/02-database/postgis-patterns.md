---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: PostGIS conventions in CoreMap
---

# PostGIS patterns

## SRID

All production geometry uses **EPSG:4326** (WGS84). Do not mix SRIDs without explicit migration.

## Column types

Use explicit geometry types (`geometry(Point,4326)`, `geometry(LineString,4326)`, etc.) — avoid untyped `geometry`.

## Query patterns

1. **Bounding-box filter first** — use `&&` or `ST_Intersects` with envelope before expensive ops.
2. **GIST indexes** on geometry columns used in public/search paths.
3. **Simplification** for tile export views — appropriate tolerance per zoom.
4. **Distance ranking** — `ST_Distance` / geography casts for search proximity.

## API usage

Heavy spatial queries live in `apps/api/src/modules/*/ *.repo.ts` as raw SQL. Prisma is used where ORM fits; geo/search uses `pg` pool.

## Validation

- `apps/api/src/lib/geo/` — geometry schemas, polygon normalization
- Dashboard/API validate GeoJSON before write

## Checks

Run scripts in `infrastructure/database/checks/` after migrations or large imports.

## Related docs

- [Schemas and tables](schemas-and-tables.md)
- [Database debugging](../10-debugging/database-debugging.md)
