-- =============================================================================
-- Supabase migration 071: deprecate legacy core.core_bus_* (comments only)
-- =============================================================================
--
-- Purpose:
--   Mark legacy bus tables as deprecated after core_transport + tile view
--   cutover (070). No structural changes, no data loss.
--
-- Safety:
--   - COMMENT ON TABLE / COLUMN only.
--   - Does NOT DROP, TRUNCATE, or ALTER data.
--   - Does NOT use CASCADE.
--
-- Final DROP policy (manual, later migration only):
--   Drop core.core_bus_* only after ALL of the following are migrated and verified:
--     - API modules (core-review, import-review promote, public-map geo)
--     - Dashboard bus / transit pages
--     - tiles.tiles_bus_route_variants_v (still on core today)
--     - GTFS exporter reading core_transport
--     - Row parity / rollback window agreed with operators
--
-- Depends on: 067+ core_transport schema (comments reference replacement).
--
-- Apply: Supabase SQL Editor or your usual migration workflow.
--
-- =============================================================================

begin;

-- Shared deprecation text (exact wording per project request).
-- ---------------------------------------------------------------------------

comment on table core.core_bus_routes is
    'Deprecated. Replaced by core_transport.*. Do not insert new transport data here. Kept temporarily for rollback.';

comment on table core.core_bus_route_variants is
    'Deprecated. Replaced by core_transport.*. Do not insert new transport data here. Kept temporarily for rollback.';

comment on table core.core_bus_route_stops is
    'Deprecated. Replaced by core_transport.*. Do not insert new transport data here. Kept temporarily for rollback.';

comment on table core.core_bus_stops is
    'Deprecated. Replaced by core_transport.*. Do not insert new transport data here. Kept temporarily for rollback.';

comment on table core.core_bus_route_names is
    'Deprecated. Replaced by core_transport.*. Do not insert new transport data here. Kept temporarily for rollback.';

comment on table core.core_bus_stop_names is
    'Deprecated. Replaced by core_transport.*. Do not insert new transport data here. Kept temporarily for rollback.';

-- Optional column hints for operators and rollback mapping.
-- ---------------------------------------------------------------------------

comment on column core.core_bus_routes.id is
    'Legacy internal route id. Map to core_transport.routes.id after backfill (ids will not match across schemas).';

comment on column core.core_bus_route_variants.id is
    'Legacy internal variant id. Map to core_transport.route_variants.id after backfill.';

comment on column core.core_bus_stops.id is
    'Legacy internal stop id. Map to core_transport.stops.id after backfill.';

comment on column core.core_bus_stops.public_id is
    'Legacy public stop uuid. Prefer core_transport.stops.public_id for new APIs.';

comment on column core.core_bus_route_stops.route_variant_id is
    'Legacy composite pattern key part — see core_transport.route_stops.route_variant_id.';

comment on column core.core_bus_route_stops.stop_id is
    'Legacy composite pattern key part — see core_transport.route_stops.stop_id.';

comment on column core.core_bus_route_names.id is
    'Legacy name row id. Map to core_transport.route_names.id after backfill.';

comment on column core.core_bus_stop_names.id is
    'Legacy name row id. Map to core_transport.stop_names.id after backfill.';

commit;

-- =============================================================================
-- Verification (run after migration; safe read-only)
-- =============================================================================
-- Expect row counts for rollback baseline. Re-run before any future DROP migration.
-- If a table is missing in an environment, comment out that UNION branch.

select 'core.core_bus_routes' as table_name, count(*)::bigint as row_count
from core.core_bus_routes
union all
select 'core.core_bus_route_variants', count(*)::bigint
from core.core_bus_route_variants
union all
select 'core.core_bus_route_stops', count(*)::bigint
from core.core_bus_route_stops
union all
select 'core.core_bus_stops', count(*)::bigint
from core.core_bus_stops
union all
select 'core.core_bus_route_names', count(*)::bigint
from core.core_bus_route_names
union all
select 'core.core_bus_stop_names', count(*)::bigint
from core.core_bus_stop_names
order by table_name;
