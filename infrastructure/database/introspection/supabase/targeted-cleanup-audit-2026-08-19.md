# CoreMap targeted cleanup audit — 2026-08-19

Scope: repository and live production catalog inspection before the targeted cleanup. No database object was changed while producing this report.

Baseline: database 5,662,862,483 bytes; indexes 1,910,611,968 bytes; 970 indexes. Core counts: streets 823,013; buildings 23,828; land areas 23,615; water lines 51,232; water polygons 19,371; places 65,750. Routing barriers 2,258 and turn restrictions 1,658. Search documents 28,982 and document names 41,067.

## A. SAFE TO REMOVE

| Object | Current usage and dependencies | Risk | Recommended action | Expected benefit |
|---|---|---|---|---|
| Seven named `admin_qa` township-gap tables and four `admin_qa.v_township_gap_*` views | 23 total rows. Repository references are limited to historical verification/introspection material. Catalog dependencies are internal to the QA views, table-owned sequences/indexes/constraints, and PostGIS types; no application view, function, trigger, FK, or current tile path depends on them. | Low after archive; losing the historical QGIS working set without an archive would be irreversible. | Export all rows and definitions, then remove views in dependency order and explicit tables with `RESTRICT`. Drop the schema only if empty. | About 761 KiB plus catalog clutter; simpler production schema. |

## B. REQUIRES CODE MIGRATION FIRST

| Object | Current usage and dependencies | Risk | Recommended action | Expected benefit |
|---|---|---|---|---|
| `core.core_addresses.postcode` | The empty address table has both `postcode` and `postal_code`. `search.v_search_addresses_source` references both. Import-review/API/dashboard code still uses `postcode` for candidate/source input, while Core CRUD already exposes `postal_code`. | Medium: confusing candidate input with the canonical Core column can break promotion or search projection. | Keep candidate-side `postcode` where it is the source contract; make Core persistence and search source use `postal_code`, recreate the dependent view, then drop only `core_addresses.postcode` with `RESTRICT`. | Negligible storage now; prevents future duplicated address truth. |
| Scalar `name` on buildings, land areas, water lines, and water polygons | Live comparison shows every populated scalar value exists in the corresponding normalized names table. Remaining readers/writers exist, especially building CRUD/import SQL; land/water tile and search views directly depend on scalar names. | Medium/high: premature removal would blank labels or break views/imports. | Migrate readers and writers to normalized names with current language fallback, recreate dependent views, compile/test, then drop per entity family. | Small storage saving; removes four duplicated name authorities. |
| `core.core_streets.road_class` | API, public-map grouping, import-review, scripts, tests, map-style compatibility, and `search.v_search_street_groups_source` still reference it. `road_class_id` and `tiles.tiles_streets_v` already use the reference table. One live semantic mismatch remains. | High on 823k streets: broad compatibility surface and possible table-lock/WAL risk if mishandled. | Resolve the single mismatch from provenance, migrate every consumer to the reference code, then consider a metadata-only column drop in a later reviewed migration. No table-wide update. | Removes duplicated classification and future drift; modest physical saving without a rewrite. |
| `edit_status` and `routing_status` | Every street currently has one value, but API/dashboard/import/routing code still exposes or writes these fields. `routing_status` also has a live index. | High compatibility risk; unclear whether all per-street workflow semantics have been retired. | Migrate lifecycle consumers to explicit replacement state before removal. Do not update all street rows. | Potential column/index storage and less write amplification, but not yet safe. |
| Street `is_verified` indexes | Columns are still used widely and synchronized by trigger from `verification_status`; search/dashboard/public-map compatibility paths still read `is_verified`. | Medium: `idx_scan = 0` alone is insufficient, and filtered list plans must be tested. | Retain until representative verification-filter EXPLAINs prove the `verification_status` path is the complete replacement. | Up to roughly 47 MiB if eventually removable. |

## C. KEEP

| Object | Current usage and dependencies | Risk | Recommended action | Expected benefit |
|---|---|---|---|---|
| `core.core_addresses.full_address` | `NOT NULL`, constrained, used by address composition/API and `search.v_search_addresses_source`. | Dropping it would break the current read/search cache contract. | Keep as intentional display/search cache while components remain normalized truth. | Avoids repeated composition and preserves API output. |
| `search.address_index` | Empty because Core addresses are empty, but it is the intended future address-search structure. | Removing valid empty infrastructure would block the national address import/search path. | Keep. | Future address search readiness. |
| `core_streets_source_refs_gin_idx` | Production/import queries use `source_refs @>` to protect dashboard/manual records during promotion and direct-core imports. | Dropping can turn source-protection lookups into scans over 823k streets. | Keep unless later workload-specific EXPLAINs prove another strategy. | Preserves import/promotion performance and safety. |
| Provenance and raw JSON columns | `source_refs`, `normalized_data`, registry/snapshot/feature identifiers, and review raw fields are actively read by import, repair, routing, and audit tooling. | Data lineage loss. | Keep. | Auditability and repeatable imports. |
| Geometry GiST, PK/unique identity, routing, transport, search, auth, and PMTiles-current objects | Current architecture and queries depend on them. | Functional/data integrity failure if removed. | Keep. Do not change grants or add permissive RLS. | Preserves production behavior and security. |
| `is_oneway` and `travel_direction` | Compatibility derivation is established but both remain part of current API/import contracts. | Removing compatibility too early breaks consumers. | Keep in this targeted pass. | Stable API and routing semantics. |

## D. INSUFFICIENT EVIDENCE

| Object | Current usage and dependencies | Risk | Recommended action | Expected benefit |
|---|---|---|---|---|
| `core_streets_normalized_data_gin_idx` | Repository uses many nested `normalized_data -> 'tags'` reads and JSON key tests; most do not obviously match the whole-column GIN expression. Statistics show zero scans but include limited/administrative workload. | A 112 MiB index is expensive to maintain, but dropping without workload proof may hurt uncommon repair/import queries. | Obtain representative EXPLAINs for every production JSON predicate. If removal is proven, execute `DROP INDEX CONCURRENTLY` as a protected non-transactional manual step, one large index at a time. | About 112 MiB and reduced write/WAL amplification if ultimately removable. |
| Large street pagination indexes | Several 50–126 MiB variants overlap, but actual list paths differ on deleted/active filters and keyset pagination. Current scan counts alone are inconclusive. | Removing the wrong index can regress dashboard pagination on 823k rows. | Map exact query shapes and compare EXPLAIN plans with surviving alternatives; retain any uncertain index. Large removals must be concurrent/manual. | Potentially substantial index/WAL reduction after proof. |
| Dropping scalar `name`, `road_class`, `edit_status`, `routing_status`, or `is_verified` columns in this pass | Live DB dependencies and repository consumers remain. | Column drops can take locks and break compatibility even when metadata-only. | Do not remove until their code migrations and validations are complete. | Deferred. |

## Execution gates

1. Archive and remove only the proven historical `admin_qa` family.
2. Normalize the empty Core address column after recreating its search source view.
3. Treat scalar-name, road-class, verification, and lifecycle work as independent migrations; stop any family whose consumers cannot be migrated and tested cleanly.
4. Never bundle large index removal with schema cleanup. Use protected, non-transactional `DROP INDEX CONCURRENTLY`, one index per manual production step, only after EXPLAIN evidence.
5. Re-run counts, geometry validity, FKs, views/functions, search/tile/API tests, privileges, and storage after each applied group.
