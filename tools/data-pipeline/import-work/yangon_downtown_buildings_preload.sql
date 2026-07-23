-- =============================================================================
-- Preload Yangon downtown safe_new buildings into import_work (set-based).
-- Run against the TARGET database after migration 141.
--
-- Expects staging export loaded into temp table yangon_downtown_building_export
-- OR run via yangon_downtown_buildings_preload.sh which COPYs from local staging.
--
-- Policy: only eligible_for_core + safe_new|safe_update; never pmtiles_only.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'buildings_yangon_downtown_safe_2026_07_23'
\endif

\if :{?snapshot_id}
\else
\set snapshot_id '10'
\endif

\if :{?snapshot_version}
\else
\set snapshot_version 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS yangon_downtown_building_export (
    external_id text,
    classification text,
    canonical_name text,
    name_en text,
    name_mm text,
    class_code text,
    geom geometry,
    area_m2 numeric,
    levels integer,
    height_m numeric,
    confidence_score numeric,
    source_refs jsonb,
    normalized_data jsonb,
    source_hash text,
    core_selection_reason text,
    admin_area_id bigint
) ON COMMIT PRESERVE ROWS;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM yangon_downtown_building_export) THEN
        RAISE EXCEPTION 'yangon_downtown_building_export is empty — run COPY first';
    END IF;
    IF EXISTS (
        SELECT 1 FROM yangon_downtown_building_export
        WHERE classification = 'pmtiles_only'
    ) THEN
        RAISE EXCEPTION 'preload refused: pmtiles_only rows present in export';
    END IF;
    IF EXISTS (
        SELECT 1 FROM yangon_downtown_building_export
        WHERE classification NOT IN ('safe_new', 'safe_update')
    ) THEN
        RAISE EXCEPTION 'preload refused: only safe_new/safe_update allowed';
    END IF;
END $$;

INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, validation_status
) VALUES (
    btrim(:'batch_code'),
    'buildings',
    :'snapshot_id'::bigint,
    btrim(:'snapshot_version'),
    'loading',
    0,
    'not_started'
)
ON CONFLICT (batch_code) DO UPDATE
SET
    status = 'loading',
    source_snapshot_id = EXCLUDED.source_snapshot_id,
    source_snapshot_version = EXCLUDED.source_snapshot_version,
    updated_at = now()
RETURNING id;

DELETE FROM import_work.building_rows AS r
USING import_work.import_batches AS b
WHERE r.import_batch_id = b.id
  AND b.batch_code = btrim(:'batch_code');

INSERT INTO import_work.building_rows (
    import_batch_id,
    source_snapshot_id,
    source_snapshot_version,
    external_id,
    classification,
    target_core_id,
    name,
    name_en,
    name_mm,
    building_type_id,
    class_code,
    admin_area_id,
    geom,
    centroid,
    area_m2,
    levels,
    height_m,
    confidence_score,
    source_refs,
    normalized_data,
    source_hash,
    core_selection_reason,
    validation_status
)
SELECT
    b.id,
    :'snapshot_id'::bigint,
    btrim(:'snapshot_version'),
    e.external_id,
    e.classification,
    NULL::bigint,
    nullif(btrim(e.canonical_name), ''),
    nullif(btrim(e.name_en), ''),
    nullif(btrim(e.name_mm), ''),
    bt.id,
    coalesce(nullif(btrim(e.class_code), ''), 'unknown'),
    e.admin_area_id,
    ST_Multi(ST_CollectionExtract(ST_MakeValid(e.geom), 3))::geometry(MultiPolygon, 4326),
    ST_PointOnSurface(ST_MakeValid(e.geom))::geometry(Point, 4326),
    coalesce(
        e.area_m2,
        ST_Area(ST_MakeValid(e.geom)::geography)::numeric
    ),
    e.levels,
    e.height_m,
    coalesce(e.confidence_score, 80),
    coalesce(e.source_refs, '{}'::jsonb),
    coalesce(e.normalized_data, '{}'::jsonb),
    e.source_hash,
    e.core_selection_reason,
    'passed'
FROM yangon_downtown_building_export AS e
CROSS JOIN import_work.import_batches AS b
LEFT JOIN ref.ref_building_types AS bt
    ON bt.code = coalesce(nullif(btrim(e.class_code), ''), 'unknown')
   AND coalesce(bt.is_active, true)
WHERE b.batch_code = btrim(:'batch_code');

UPDATE import_work.import_batches AS b
SET
    loaded_row_count = (SELECT count(*) FROM import_work.building_rows r WHERE r.import_batch_id = b.id),
    expected_row_count = (SELECT count(*) FROM import_work.building_rows r WHERE r.import_batch_id = b.id),
    status = 'loaded',
    loaded_at = now(),
    updated_at = now(),
    validation_status = 'passed'
WHERE b.batch_code = btrim(:'batch_code');

SELECT
    'buildings_preload' AS section,
    b.id AS batch_id,
    b.batch_code,
    b.status,
    b.expected_row_count,
    b.loaded_row_count,
    (SELECT count(*) FROM import_work.building_rows r WHERE r.import_batch_id = b.id AND r.building_type_id IS NULL) AS missing_type
FROM import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

-- Fail if any row lacks building_type_id (raise via division by zero when missing)
SELECT 1 / CASE
    WHEN EXISTS (
        SELECT 1
        FROM import_work.building_rows r
        JOIN import_work.import_batches b ON b.id = r.import_batch_id
        WHERE b.batch_code = btrim(:'batch_code')
          AND r.building_type_id IS NULL
    ) THEN 0
    ELSE 1
END AS type_check_ok;

COMMIT;
