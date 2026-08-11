-- =============================================================================
-- Supabase migration 149: typed building source identity and manual edit flags
-- =============================================================================
--
-- Purpose:
--   Keep core.core_map_buildings as the only canonical editable building table
--   while promoting stable source identity and source lineage out of source_refs.
--
-- Safety:
--   - Additive columns and constraints only.
--   - Backfills only values explicitly represented by source_refs and resolvable
--     through stable source codes / snapshot versions.
--   - Never copies environment-local numeric snapshot IDs from source_refs.
--   - Fails before creating the unique index if duplicate complete identities
--     exist.
--   - Drops the redundant admin_area_id FK only when both live definitions are
--     confirmed equivalent.
--   - Does not change updated_at or updated_by during the lineage backfill.
--   - Does not drop legacy columns or indexes.
--
-- Apply deliberately after running:
--   infrastructure/database/verification/verify_core_map_buildings_source_identity.sql
--
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE core.core_map_buildings
    ADD COLUMN source_registry_id bigint,
    ADD COLUMN source_snapshot_id bigint,
    ADD COLUMN source_feature_type text,
    ADD COLUMN source_feature_id bigint,
    ADD COLUMN region_code text,
    ADD COLUMN is_geometry_manually_edited boolean NOT NULL DEFAULT false,
    ADD COLUMN is_attributes_manually_edited boolean NOT NULL DEFAULT false;

ALTER TABLE core.core_map_buildings
    ADD CONSTRAINT core_map_buildings_source_registry_id_fkey
        FOREIGN KEY (source_registry_id)
        REFERENCES system.system_source_registry (id)
        NOT VALID,
    ADD CONSTRAINT core_map_buildings_source_snapshot_id_fkey
        FOREIGN KEY (source_snapshot_id)
        REFERENCES system.system_source_snapshots (id)
        NOT VALID,
    ADD CONSTRAINT core_map_buildings_source_feature_type_chk
        CHECK (
            source_feature_type IS NULL
            OR source_feature_type IN ('way', 'relation')
        )
        NOT VALID;

-- Resolve typed values without guessing bare numeric external_id values:
--   * source_refs osm_id + explicit osm_feature_type when present;
--   * otherwise parse external_id via system.pipeline_osm_identity_key
--     (equates osm:W:123 and osm:way:123; bare numerics stay NULL);
--   * source=dashboard maps to the stable manual_dashboard registry code;
--   * only way/relation feature types are stored for buildings;
--   * snapshots resolve by (source registry, snapshot version), never by a
--     numeric source_snapshot_id copied from another database environment.
WITH raw_source AS MATERIALIZED (
    SELECT
        b.id,
        nullif(btrim(b.source_refs ->> 'osm_id'), '') AS osm_id_text,
        lower(nullif(btrim(b.source_refs ->> 'osm_feature_type'), '')) AS osm_feature_type_text,
        lower(nullif(btrim(b.source_refs ->> 'source'), '')) AS source_text,
        nullif(btrim(b.source_refs ->> 'region_code'), '') AS source_region_code,
        coalesce(
            nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
            nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
        ) AS source_snapshot_version
    FROM core.core_map_buildings AS b
),
parsed_source AS MATERIALIZED (
    SELECT
        r.id,
        CASE
            WHEN r.osm_id_text ~ '^[1-9][0-9]*$'
             AND r.osm_id_text::numeric <= 9223372036854775807::numeric
                THEN 'osm_myanmar'
            WHEN r.source_text = 'dashboard'
                THEN 'manual_dashboard'
            ELSE NULL
        END AS source_code,
        CASE r.osm_feature_type_text
            WHEN 'w' THEN 'way'
            WHEN 'way' THEN 'way'
            WHEN 'r' THEN 'relation'
            WHEN 'rel' THEN 'relation'
            WHEN 'relation' THEN 'relation'
            ELSE NULL
        END AS source_feature_type,
        CASE
            WHEN r.osm_id_text ~ '^[1-9][0-9]*$'
             AND r.osm_id_text::numeric <= 9223372036854775807::numeric
                THEN r.osm_id_text::bigint
            ELSE NULL
        END AS source_feature_id,
        r.source_region_code AS region_code,
        r.source_snapshot_version
    FROM raw_source AS r
),
resolved_source AS MATERIALIZED (
    SELECT
        p.id,
        registry.id AS source_registry_id,
        snapshot.id AS source_snapshot_id,
        p.source_feature_type,
        p.source_feature_id,
        p.region_code
    FROM parsed_source AS p
    LEFT JOIN system.system_source_registry AS registry
        ON registry.source_code = p.source_code
    LEFT JOIN system.system_source_snapshots AS snapshot
        ON snapshot.source_registry_id = registry.id
       AND snapshot.snapshot_version = p.source_snapshot_version
)
UPDATE core.core_map_buildings AS b
SET
    source_registry_id = coalesce(b.source_registry_id, r.source_registry_id),
    source_snapshot_id = coalesce(b.source_snapshot_id, r.source_snapshot_id),
    source_feature_type = coalesce(b.source_feature_type, r.source_feature_type),
    source_feature_id = coalesce(b.source_feature_id, r.source_feature_id),
    region_code = coalesce(b.region_code, r.region_code)
FROM resolved_source AS r
WHERE r.id = b.id
  AND (
      r.source_registry_id IS NOT NULL
      OR r.source_snapshot_id IS NOT NULL
      OR r.source_feature_type IS NOT NULL
      OR r.source_feature_id IS NOT NULL
      OR r.region_code IS NOT NULL
  );

-- Also resolve typed identity from canonical/legacy external_id strings
-- (osm:way:123 ≡ osm:W:123 via system.pipeline_osm_identity_key).
-- Bare numeric IDs return NULL from the helper — leave those nullable; never guess way/relation.
WITH from_external AS (
    SELECT
        b.id,
        registry.id AS source_registry_id,
        split_part(system.pipeline_osm_identity_key(b.external_id), ':', 2) AS source_feature_type,
        nullif(split_part(system.pipeline_osm_identity_key(b.external_id), ':', 3), '')::bigint
            AS source_feature_id
    FROM core.core_map_buildings AS b
    JOIN system.system_source_registry AS registry
      ON registry.source_code = 'osm_myanmar'
    WHERE system.pipeline_osm_identity_key(b.external_id) IS NOT NULL
      AND split_part(system.pipeline_osm_identity_key(b.external_id), ':', 2) IN ('way', 'relation')
)
UPDATE core.core_map_buildings AS b
SET
    source_registry_id = coalesce(b.source_registry_id, e.source_registry_id),
    source_feature_type = coalesce(b.source_feature_type, e.source_feature_type),
    source_feature_id = coalesce(b.source_feature_id, e.source_feature_id)
FROM from_external AS e
WHERE e.id = b.id;

ALTER TABLE core.core_map_buildings
    VALIDATE CONSTRAINT core_map_buildings_source_registry_id_fkey;

ALTER TABLE core.core_map_buildings
    VALIDATE CONSTRAINT core_map_buildings_source_snapshot_id_fkey;

ALTER TABLE core.core_map_buildings
    VALIDATE CONSTRAINT core_map_buildings_source_feature_type_chk;

-- Fail closed before creating the unique index. The exception rolls back the
-- entire migration and leaves the duplicate building rows untouched for review.
DO $$
DECLARE
    duplicate_group_count bigint;
BEGIN
    SELECT count(*)
    INTO duplicate_group_count
    FROM (
        SELECT
            source_registry_id,
            source_feature_type,
            source_feature_id
        FROM core.core_map_buildings
        WHERE source_registry_id IS NOT NULL
          AND source_feature_type IS NOT NULL
          AND source_feature_id IS NOT NULL
        GROUP BY
            source_registry_id,
            source_feature_type,
            source_feature_id
        HAVING count(*) > 1
    ) AS duplicate_groups;

    IF duplicate_group_count > 0 THEN
        RAISE EXCEPTION
            'Cannot create core_map_buildings source identity index: % duplicate identity group(s) require review',
            duplicate_group_count;
    END IF;
END
$$;

CREATE UNIQUE INDEX core_map_buildings_source_identity_uidx
    ON core.core_map_buildings (
        source_registry_id,
        source_feature_type,
        source_feature_id
    )
    WHERE source_registry_id IS NOT NULL
      AND source_feature_type IS NOT NULL
      AND source_feature_id IS NOT NULL;

-- Migration 013 created core_map_buildings_admin_area_id_fkey. A later schema
-- path also created fk_buildings_admin_area. Preserve the canonical migration
-- 013 name and remove the later duplicate only if every behaviorally relevant
-- definition property matches.
DO $$
DECLARE
    canonical_fk pg_constraint%ROWTYPE;
    duplicate_fk pg_constraint%ROWTYPE;
    canonical_definition text;
    duplicate_definition text;
BEGIN
    SELECT c.*
    INTO canonical_fk
    FROM pg_constraint AS c
    WHERE c.conrelid = 'core.core_map_buildings'::regclass
      AND c.conname = 'core_map_buildings_admin_area_id_fkey';

    SELECT c.*
    INTO duplicate_fk
    FROM pg_constraint AS c
    WHERE c.conrelid = 'core.core_map_buildings'::regclass
      AND c.conname = 'fk_buildings_admin_area';

    IF canonical_fk.oid IS NULL OR duplicate_fk.oid IS NULL THEN
        RAISE NOTICE
            'Admin-area FK deduplication skipped: both named constraints are not present';
        RETURN;
    END IF;

    canonical_definition := pg_get_constraintdef(canonical_fk.oid, true);
    duplicate_definition := pg_get_constraintdef(duplicate_fk.oid, true);

    IF canonical_definition IS NOT DISTINCT FROM duplicate_definition
       AND canonical_fk.contype IS NOT DISTINCT FROM duplicate_fk.contype
       AND canonical_fk.conkey IS NOT DISTINCT FROM duplicate_fk.conkey
       AND canonical_fk.confrelid IS NOT DISTINCT FROM duplicate_fk.confrelid
       AND canonical_fk.confkey IS NOT DISTINCT FROM duplicate_fk.confkey
       AND canonical_fk.confupdtype IS NOT DISTINCT FROM duplicate_fk.confupdtype
       AND canonical_fk.confdeltype IS NOT DISTINCT FROM duplicate_fk.confdeltype
       AND canonical_fk.confmatchtype IS NOT DISTINCT FROM duplicate_fk.confmatchtype
       AND canonical_fk.condeferrable IS NOT DISTINCT FROM duplicate_fk.condeferrable
       AND canonical_fk.condeferred IS NOT DISTINCT FROM duplicate_fk.condeferred
       AND canonical_fk.convalidated IS NOT DISTINCT FROM duplicate_fk.convalidated
       AND canonical_fk.conpfeqop IS NOT DISTINCT FROM duplicate_fk.conpfeqop
       AND canonical_fk.conppeqop IS NOT DISTINCT FROM duplicate_fk.conppeqop
       AND canonical_fk.conffeqop IS NOT DISTINCT FROM duplicate_fk.conffeqop
    THEN
        ALTER TABLE core.core_map_buildings
            DROP CONSTRAINT fk_buildings_admin_area;
    ELSE
        RAISE EXCEPTION
            'Admin-area FK definitions differ; refusing to drop fk_buildings_admin_area. canonical=%, duplicate=%',
            canonical_definition,
            duplicate_definition;
    END IF;
END
$$;

COMMENT ON COLUMN core.core_map_buildings.source_registry_id IS
    'Registered source responsible for the building row; references system.system_source_registry.';

COMMENT ON COLUMN core.core_map_buildings.source_snapshot_id IS
    'Last resolved immutable source snapshot; never backfilled from environment-local numeric JSON IDs.';

COMMENT ON COLUMN core.core_map_buildings.source_feature_type IS
    'Canonical source feature type for building footprints: way or relation.';

COMMENT ON COLUMN core.core_map_buildings.source_feature_id IS
    'Source-native numeric feature ID, unique with source_registry_id and source_feature_type when all are present.';

COMMENT ON COLUMN core.core_map_buildings.region_code IS
    'Source region/package code when explicitly supplied by source lineage.';

COMMENT ON COLUMN core.core_map_buildings.is_geometry_manually_edited IS
    'True when an authorized editor has manually changed geom; use updated_at and updated_by for the latest edit audit.';

COMMENT ON COLUMN core.core_map_buildings.is_attributes_manually_edited IS
    'True when an authorized editor has manually changed building attributes; use updated_at and updated_by for the latest edit audit.';

COMMIT;
