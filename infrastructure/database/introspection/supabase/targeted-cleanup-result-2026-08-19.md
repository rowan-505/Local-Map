# CoreMap targeted cleanup result — 2026-08-19

## Outcome

Repository audit and production read-only inspection completed. Two small, independent migrations were prepared, but **neither was applied to production** because the connected Supabase migration tool rejected the operation after its usage limit was reached. No raw-SQL workaround was attempted.

Production therefore remains unchanged by this targeted pass.

## Prepared changes

### Migration 190 — historical `admin_qa`

- Archives all 23 rows from seven dated township-gap QA tables as exact JSON/EWKB under `infrastructure/database/introspection/archive/admin-qa-2026-08-19/`.
- Removes four internally dependent QA views in dependency order.
- Removes the seven explicit QA tables with `RESTRICT`.
- Removes the empty `admin_qa` schema with `RESTRICT`.
- Dependency inspection found no active application, tile, function, trigger, policy, or FK consumer.

### Migration 191 — canonical Core postal field

- Recreates `search.v_search_addresses_source` without `core.core_addresses.postcode`.
- Keeps candidate/component/search response terminology `postcode` where that is the established external contract.
- Makes `core.core_addresses.postal_code` the sole Core persistence field.
- Drops only `core.core_addresses.postcode` with `RESTRICT`.
- Keeps `full_address`, normalized components, and `search.address_index`.
- Production `core_addresses` and `address_index` both had zero rows at audit time; no backfill or mass update is included.

## Intentionally retained

- Scalar feature names on buildings, land areas, water lines, and water polygons: normalized coverage is complete, but remaining API/view/import/legacy inspection consumers make a drop unsafe in this pass.
- `core_streets.road_class`: one mismatch remains and active search/import/script compatibility consumers remain. No 823k-row update or column drop was attempted.
- `is_verified` columns and both street verification indexes: compatibility reads and synchronization triggers remain; no representative alternative EXPLAIN could be completed after the connector limit.
- `edit_status` and `routing_status`: current API/dashboard consumers remain, and road-pipeline documentation still uses routing status as a test-build signal.
- `core_streets_source_refs_gin_idx`: real `source_refs @>` predicates protect dashboard/manual rows during promotion and direct import.
- `core_streets_normalized_data_gin_idx` and large pagination indexes: insufficient plan evidence for safe removal. No index was dropped based on `idx_scan = 0`.
- All geometry, routing, transport, search, auth, provenance, PMTiles-current objects, and grants.

## Storage

| Metric | Before | After this pass |
|---|---:|---:|
| Database | 5,662,862,483 bytes | unchanged |
| Indexes | 1,910,611,968 bytes | unchanged |
| Index count | 970 | unchanged |

Expected direct saving after migration 190 is about 761 KiB. Migration 191 is primarily schema normalization because the table is empty.

## Repository validation

- Fastify API TypeScript typecheck: PASS.
- Prisma validate and generate: PASS.
- Address composer tests: 16/16 PASS.
- Full search suite: PASS.
- Broad import-review suite: 687 PASS, 1 intentional live-write skip, 0 failures.
- Main API/transport suite: 349 PASS, 1 environment-dependent live HTTP skip, 0 failures.
- Map-style/PMTiles style validation: 14/14 PASS.
- Dashboard TypeScript check: PASS.
- Dashboard production build: BLOCKED only by sandbox network denial fetching configured Google Geist fonts; no TypeScript failure was reported. Escalated retry was also rejected by the same tool usage limit.

## Production validation status

The pre-change snapshot established unchanged Core/routing/search counts, all 302 FKs validated, no direct anon/authenticated private-schema access, and the storage baseline above. Post-migration checks cannot be reported because migrations 190–191 were not applied. Run `verify_190_191_targeted_cleanup.sql` immediately after they are eventually applied, followed by the full validation checklist.

## Remaining technical debt

1. Apply migrations 190 and 191 through the normal Supabase migration channel when connector capacity is available.
2. Re-run catalog dependencies, Core/routing/search counts, geometry validity, view/function execution, grants, and storage after each migration.
3. Complete consumer migration before considering scalar-name or `road_class` drops.
4. Collect representative production EXPLAIN evidence before any verification/JSON/pagination index removal.
5. Any 100–200 MiB index removal must be a protected, non-transactional `DROP INDEX CONCURRENTLY` manual step, one index at a time; do not substitute a blocking transactional drop.
