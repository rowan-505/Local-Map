-- Phase 3: remove obsolete Core staging lineage columns.
--
-- The production staging schema no longer exists. Durable provenance remains in
-- source_registry_id/source_snapshot_id/source_feature_type/source_feature_id,
-- external_id, source_refs, and normalized_data.
--
-- DROP COLUMN is a catalog-only operation for these nullable, dependency-free
-- columns; it does not rewrite table rows. Do not add CASCADE here.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE core.core_buildings
    DROP COLUMN source_staging_id;

ALTER TABLE core.core_land_areas
    DROP COLUMN source_staging_id;

ALTER TABLE core.core_water_lines
    DROP COLUMN source_staging_id;

ALTER TABLE core.core_water_polygons
    DROP COLUMN source_staging_id;

COMMIT;
