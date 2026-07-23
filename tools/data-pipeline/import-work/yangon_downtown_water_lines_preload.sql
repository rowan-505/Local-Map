-- Preload Yangon downtown safe_new water lines into import_work.

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'water_lines_yangon_downtown_safe_2026_07_23'
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

CREATE TEMP TABLE IF NOT EXISTS yangon_downtown_water_line_export (
    external_id text,
    classification text,
    canonical_name text,
    name_en text,
    name_mm text,
    class_code text,
    geom geometry,
    source_refs jsonb,
    normalized_data jsonb,
    source_hash text,
    core_selection_reason text
) ON COMMIT PRESERVE ROWS;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM yangon_downtown_water_line_export) THEN
        RAISE EXCEPTION 'yangon_downtown_water_line_export is empty — run COPY first';
    END IF;
    IF EXISTS (SELECT 1 FROM yangon_downtown_water_line_export WHERE classification = 'pmtiles_only') THEN
        RAISE EXCEPTION 'preload refused: pmtiles_only rows present';
    END IF;
    IF EXISTS (
        SELECT 1 FROM yangon_downtown_water_line_export
        WHERE classification NOT IN ('safe_new', 'safe_update')
    ) THEN
        RAISE EXCEPTION 'preload refused: only safe_new/safe_update allowed';
    END IF;
END $$;

INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, validation_status
) VALUES (
    btrim(:'batch_code'), 'water_lines', :'snapshot_id'::bigint, btrim(:'snapshot_version'),
    'loading', 0, 'not_started'
)
ON CONFLICT (batch_code) DO UPDATE SET
    entity_family = EXCLUDED.entity_family,
    source_snapshot_id = EXCLUDED.source_snapshot_id,
    source_snapshot_version = EXCLUDED.source_snapshot_version,
    status = 'loading',
    updated_at = now()
RETURNING id;

DELETE FROM import_work.water_line_rows r
USING import_work.import_batches b
WHERE r.import_batch_id = b.id AND b.batch_code = btrim(:'batch_code');

INSERT INTO import_work.water_line_rows (
    import_batch_id, source_snapshot_id, source_snapshot_version,
    external_id, classification, target_core_id,
    name, name_en, name_mm, class_code, geom,
    source_refs, normalized_data, source_hash, core_selection_reason
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
    lower(btrim(e.class_code)),
    ST_Multi(ST_CollectionExtract(ST_MakeValid(e.geom), 2))::geometry(MultiLineString, 4326),
    coalesce(e.source_refs, '{}'::jsonb),
    coalesce(e.normalized_data, '{}'::jsonb),
    e.source_hash,
    e.core_selection_reason
FROM yangon_downtown_water_line_export AS e
CROSS JOIN import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

UPDATE import_work.import_batches AS b
SET
    status = 'loaded',
    expected_row_count = (SELECT count(*) FROM import_work.water_line_rows r WHERE r.import_batch_id = b.id),
    loaded_row_count = (SELECT count(*) FROM import_work.water_line_rows r WHERE r.import_batch_id = b.id),
    loaded_at = now(),
    updated_at = now()
WHERE b.batch_code = btrim(:'batch_code');

SELECT 'water_lines_preload' AS section, b.id AS batch_id, b.batch_code, b.status,
       b.expected_row_count, b.loaded_row_count
FROM import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

COMMIT;
