-- Preload Yangon downtown safe_new landuse into import_work (set-based).
-- Expects temp table yangon_downtown_landuse_export (from preload.sh COPY).

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'landuse_yangon_downtown_safe_2026_07_23'
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

CREATE TEMP TABLE IF NOT EXISTS yangon_downtown_landuse_export (
    external_id text,
    classification text,
    canonical_name text,
    name_en text,
    name_mm text,
    class_code text,
    geom geometry,
    area_m2 numeric,
    confidence_score numeric,
    source_refs jsonb,
    normalized_data jsonb,
    source_hash text,
    core_selection_reason text,
    admin_area_id bigint
) ON COMMIT PRESERVE ROWS;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM yangon_downtown_landuse_export) THEN
        RAISE EXCEPTION 'yangon_downtown_landuse_export is empty — run COPY first';
    END IF;
    IF EXISTS (SELECT 1 FROM yangon_downtown_landuse_export WHERE classification = 'pmtiles_only') THEN
        RAISE EXCEPTION 'preload refused: pmtiles_only rows present';
    END IF;
    IF EXISTS (
        SELECT 1 FROM yangon_downtown_landuse_export
        WHERE classification NOT IN ('safe_new', 'safe_update')
    ) THEN
        RAISE EXCEPTION 'preload refused: only safe_new/safe_update allowed';
    END IF;
END $$;

INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, validation_status
) VALUES (
    btrim(:'batch_code'), 'landuse', :'snapshot_id'::bigint, btrim(:'snapshot_version'),
    'loading', 0, 'not_started'
)
ON CONFLICT (batch_code) DO UPDATE SET
    entity_family = EXCLUDED.entity_family,
    source_snapshot_id = EXCLUDED.source_snapshot_id,
    source_snapshot_version = EXCLUDED.source_snapshot_version,
    status = 'loading',
    updated_at = now()
RETURNING id;

DELETE FROM import_work.landuse_rows r
USING import_work.import_batches b
WHERE r.import_batch_id = b.id AND b.batch_code = btrim(:'batch_code');

INSERT INTO import_work.landuse_rows (
    import_batch_id, source_snapshot_id, source_snapshot_version,
    external_id, classification, target_core_id,
    name, name_en, name_mm, landuse_class_id, class_code, admin_area_id,
    geom, centroid, area_m2, confidence_score, source_tags, source_refs,
    normalized_data, source_hash, core_selection_reason, detail_level, crop_code
)
SELECT
    b.id,
    :'snapshot_id'::bigint,
    btrim(:'snapshot_version'),
    e.external_id,
    e.classification,
    NULL,
    nullif(btrim(e.canonical_name), ''),
    e.name_en,
    e.name_mm,
    lc.id,
    coalesce(lc.code, mapped.map_code, lower(btrim(e.class_code))),
    e.admin_area_id,
    ST_Multi(ST_CollectionExtract(ST_MakeValid(e.geom), 3))::geometry(MultiPolygon, 4326),
    ST_PointOnSurface(ST_MakeValid(e.geom))::geometry(Point, 4326),
    coalesce(e.area_m2, ST_Area(e.geom::geography)::numeric),
    e.confidence_score,
    coalesce(e.normalized_data->'tags', e.source_refs->'tags', '{}'::jsonb),
    coalesce(e.source_refs, '{}'::jsonb),
    coalesce(e.normalized_data, '{}'::jsonb),
    e.source_hash,
    e.core_selection_reason,
    'zone',
    CASE WHEN lower(coalesce(lc.code, mapped.map_code, e.class_code, '')) IN ('paddy', 'rice')
         THEN 'rice' ELSE NULL END
FROM yangon_downtown_landuse_export AS e
CROSS JOIN import_work.import_batches AS b
LEFT JOIN LATERAL (
    SELECT CASE lower(btrim(e.class_code))
        WHEN 'traffic_island' THEN 'transport'
        WHEN 'park' THEN 'park'
        WHEN 'retail' THEN 'retail'
        WHEN 'industrial' THEN 'industrial'
        WHEN 'cemetery' THEN 'cemetery'
        WHEN 'religious' THEN 'religious'
        WHEN 'healthcare' THEN 'healthcare'
        WHEN 'education' THEN 'education'
        WHEN 'government' THEN 'government'
        WHEN 'commercial' THEN 'commercial'
        WHEN 'residential' THEN 'residential'
        ELSE lower(btrim(e.class_code))
    END AS map_code
) AS mapped ON true
LEFT JOIN ref.ref_landuse_classes AS lc
    ON lower(lc.code) = mapped.map_code AND coalesce(lc.is_active, true)
WHERE b.batch_code = btrim(:'batch_code');

UPDATE import_work.import_batches AS b
SET
    status = 'loaded',
    expected_row_count = (SELECT count(*) FROM import_work.landuse_rows r WHERE r.import_batch_id = b.id),
    loaded_row_count = (SELECT count(*) FROM import_work.landuse_rows r WHERE r.import_batch_id = b.id),
    loaded_at = now(),
    updated_at = now()
WHERE b.batch_code = btrim(:'batch_code');

SELECT
    'landuse_preload' AS section,
    b.id AS batch_id,
    b.batch_code,
    b.status,
    b.expected_row_count,
    b.loaded_row_count,
    (SELECT count(*) FROM import_work.landuse_rows r WHERE r.import_batch_id = b.id AND r.landuse_class_id IS NULL) AS missing_type
FROM import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

SELECT 1 / CASE
    WHEN EXISTS (
        SELECT 1 FROM import_work.landuse_rows r
        JOIN import_work.import_batches b ON b.id = r.import_batch_id
        WHERE b.batch_code = btrim(:'batch_code') AND r.landuse_class_id IS NULL
    ) THEN 0 ELSE 1
END AS type_check_ok;

COMMIT;
