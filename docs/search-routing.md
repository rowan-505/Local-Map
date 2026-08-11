# Search, address, routing

## Search

Deterministic search in the API (PostgreSQL FTS + `pg_trgm` + PostGIS distance). Not LLM-based.

Covers places, addresses, streets, admin areas, bus/express entities, coordinates, plus codes.

Language: Myanmar + English with aliases. Ranking uses confidence / verified / importance (0–100 scale).

Public routes live under `/public/*` in `apps/api` (`public-map` module).

## Address

Myanmar addresses are often informal. Support formal, street, landmark, village, POI, and approximate forms.

Reverse address should return nearest place/road, admin hierarchy, approximate text, coordinates, plus code — without claiming house-level accuracy when data is weak.

## Routing

Production road routing uses **Valhalla** (walk, drive, motorcycle).

- API adapter: `apps/api/src/modules/routing/`
- Engine setup: `infrastructure/routing/valhalla/README.md`
- Env: `ROUTING_ENABLED`, `VALHALLA_BASE_URL`

Core street tables are for correction/export — **not** a custom production routing engine in V2.
