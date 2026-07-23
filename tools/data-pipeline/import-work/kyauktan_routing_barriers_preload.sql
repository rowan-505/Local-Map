-- Preload Kyauktan safe_new routing barriers into import_work.

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'routing_barriers_kyauktan_safe_2026_07_23'
\endif

\if :{?snapshot_id}
\else
\set snapshot_id '4'
\endif

\if :{?snapshot_version}
\else
\set snapshot_version 'osm_myanmar_2026_05_15_kyauktan_v2'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS kyauktan_routing_barrier_export (
    external_id text,
    classification text,
    barrier_type text,
    access_tags jsonb,
    point_geom geometry,
    geom geometry,
    confidence_score numeric,
    source_refs jsonb,
    normalized_data jsonb,
    source_hash text,
    local_staging_id bigint
) ON COMMIT PRESERVE ROWS;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM kyauktan_routing_barrier_export) THEN
        RAISE EXCEPTION 'kyauktan_routing_barrier_export is empty — run COPY first';
    END IF;
    IF EXISTS (
        SELECT 1 FROM kyauktan_routing_barrier_export
        WHERE classification NOT IN ('safe_new', 'safe_update')
    ) THEN
        RAISE EXCEPTION 'preload refused: only safe_new/safe_update allowed';
    END IF;
END $$;

INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, validation_status
) VALUES (
    btrim(:'batch_code'), 'routing_barriers', :'snapshot_id'::bigint, btrim(:'snapshot_version'),
    'loading', 0, 'not_started'
)
ON CONFLICT (batch_code) DO UPDATE SET
    entity_family = EXCLUDED.entity_family,
    source_snapshot_id = EXCLUDED.source_snapshot_id,
    source_snapshot_version = EXCLUDED.source_snapshot_version,
    status = 'loading',
    updated_at = now()
RETURNING id;

DELETE FROM import_work.routing_barrier_rows r
USING import_work.import_batches b
WHERE r.import_batch_id = b.id AND b.batch_code = btrim(:'batch_code');

INSERT INTO import_work.routing_barrier_rows (
    import_batch_id, source_snapshot_id, source_snapshot_version,
    external_id, classification, target_core_id,
    barrier_type, access_tags, point_geom, geom,
    confidence_score, source_refs, normalized_data, source_hash, local_staging_id
)
SELECT
    b.id,
    :'snapshot_id'::bigint,
    btrim(:'snapshot_version'),
    e.external_id,
    e.classification,
    NULL,
    nullif(btrim(e.barrier_type), ''),
    coalesce(e.access_tags, '{}'::jsonb),
    CASE
        WHEN e.point_geom IS NOT NULL THEN e.point_geom::geometry(Point, 4326)
        WHEN e.geom IS NOT NULL THEN ST_PointOnSurface(ST_MakeValid(e.geom))::geometry(Point, 4326)
        ELSE NULL
    END,
    e.geom,
    e.confidence_score,
    coalesce(e.source_refs, '{}'::jsonb) || jsonb_build_object('external_id', e.external_id),
    coalesce(e.normalized_data, '{}'::jsonb) || jsonb_build_object('access_tags', coalesce(e.access_tags, '{}'::jsonb)),
    e.source_hash,
    e.local_staging_id
FROM kyauktan_routing_barrier_export AS e
CROSS JOIN import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

UPDATE import_work.import_batches AS b
SET
    status = 'loaded',
    expected_row_count = (SELECT count(*) FROM import_work.routing_barrier_rows r WHERE r.import_batch_id = b.id),
    loaded_row_count = (SELECT count(*) FROM import_work.routing_barrier_rows r WHERE r.import_batch_id = b.id),
    loaded_at = now(),
    updated_at = now()
WHERE b.batch_code = btrim(:'batch_code');

SELECT
    'routing_barriers_preload' AS section,
    b.id AS batch_id,
    b.batch_code,
    b.status,
    b.expected_row_count,
    b.loaded_row_count,
    (SELECT count(*) FROM import_work.routing_barrier_rows r
     WHERE r.import_batch_id = b.id AND r.point_geom IS NULL AND r.geom IS NULL) AS missing_geom
FROM import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

SELECT 1 / CASE
    WHEN EXISTS (
        SELECT 1 FROM import_work.routing_barrier_rows r
        JOIN import_work.import_batches b ON b.id = r.import_batch_id
        WHERE b.batch_code = btrim(:'batch_code')
          AND nullif(btrim(r.barrier_type), '') IS NULL
    ) THEN 0 ELSE 1
END AS type_check_ok;

COMMIT;
