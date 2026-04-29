# Core Schema Engineering Rules

This document defines strict engineering rules for the `core` schema of the PostgreSQL + PostGIS geospatial platform.

## Role Of The Core Schema

- `raw` stores untouched imports.
- `staging` stores normalized review candidates.
- `core` stores approved, product-ready data.
- `tiles` will later expose render-ready public views derived from `core`.
- `core` is the source of truth for the application.

## Core Design Priorities

- Prioritize correctness, auditability, and stable application behavior over ingestion convenience.
- Model data for long-term ownership, not for temporary import workflows.
- Support API usage, search, and vector tile rendering from the same trusted data foundation.
- Keep promotion from `staging` explicit, reviewable, and reversible through audit records.

## Naming And Type Rules

- Use `snake_case` for schemas, tables, columns, indexes, constraints, and SQL identifiers.
- Use plural table names.
- Use `bigint` primary keys for internal identifiers.
- Use `timestamptz` for timestamps.
- Use `jsonb` only where flexible structured payloads are genuinely needed.
- Use reference tables instead of enums.
- Geometry columns must always declare explicit geometry types with `SRID 4326`.

## Identity And Public Access

- Internal relational identity must use `bigint`.
- Public-facing entities should also have `uuid` `public_id` where stable external identifiers are useful.
- `public_id` should be immutable once assigned.
- Do not expose internal surrogate keys as public API identifiers when a stable public identifier is appropriate.

## Dependency Rules

- `core` must not have foreign keys to `staging` tables.
- Staging-to-core is a promotion workflow, not a permanent dependency.
- `core` may reference `ref` and `system` tables where appropriate, but never depend on temporary candidate rows for integrity.
- Any temporary linkage from approval actions to staging must live in workflow or audit records, not in core entity tables.

## Lineage And Audit Rules

- Every core entity must preserve source lineage through source tables and versioning tables.
- Promotion into `core` must always record where the approved data came from.
- Every mutable core entity should have version records that describe what changed, when it changed, and why.
- Source records and version records are mandatory for editability and auditability, not optional metadata.
- Lineage design must support both imported data and direct editorial changes.

## Modeling Rules

### General

- Normalize enough for correctness, but not so aggressively that API, search, and rendering become difficult.
- Design primary entities to be practical for product usage first, with derived presentation structures handled outside `core` where possible.

### Names

- Use separate name tables for multilingual or alternate names where needed.
- Name tables should support primary names, alternate names, language tagging, script tagging, and search-oriented weighting where useful.
- Do not overload a single text column to represent all localized naming needs.

### Places

- Place data should support point-based API and search workflows efficiently.
- Place classification should be normalized through reference tables.
- Place/contact/source/version tables should support real editing and audit workflow.

### Streets And Roads

- Street and road data should be normalized enough for correctness in routing, labeling, and public API use.
- Keep geometry and classification explicit.
- Avoid import-specific shortcuts that make later editorial maintenance difficult.

### Routes And Transit

- Transit design should support route visualization first, not full schedule optimization.
- Route geometry, names, codes, and source/version history should be first-class concerns.
- Do not prematurely model schedule complexity in `core` unless the product requires it.

### Administrative Areas

- Admin area data should support hierarchy, names, geometry, centroid use cases, and downstream search/rendering needs.
- Hierarchical relationships must be explicit and auditable.

### Addresses

- Address design should support incomplete Myanmar-style address data pragmatically.
- Do not require every address component to exist for a record to be valid.
- Prefer structured address components where known, while allowing partial or uncertain data to remain usable.
- Address storage should support search, display, and gradual improvement over time.

## Geometry Rules

- Geometry types must match real entity intent.
- Use point geometries for point-like entities, line geometries for linear entities, and polygon or multipolygon geometries for areal entities.
- Do not use untyped `geometry` columns.
- Store geometry in forms that are practical for API usage, spatial indexing, and vector tile derivation.

## Search And Rendering Rules

- Core entities should support search without requiring direct dependence on raw import payloads.
- Core entities should be structured so `tiles` can derive render-ready public views cleanly from them.
- Rendering-oriented denormalization belongs in `tiles` or materialized outputs, not by weakening `core` integrity.

## Workflow Rules

- Promotion into `core` must happen only after review and approval.
- Core inserts and updates must be explicit application or migration actions, not hidden trigger side effects unless clearly necessary.
- Do not create permanent coupling between moderation workflow tables and core entity integrity.

## Promotion Workflow

- `staging` candidate -> review -> approval -> insert/update `core` -> create source record -> create version record -> create publish item

## Implementation Guardrails

- Prefer explicit DDL and explicit workflow steps over implicit automation.
- Do not introduce enums, polymorphic foreign keys, or staging dependencies into core entity tables.
- Keep schema rules strict enough to protect data quality, but practical enough for iterative map editing and publication.
- Any exception to these rules must be documented before implementation.
