-- =============================================================================
-- Preload Yangon roads into import_work.road_rows (set-based).
-- Expects temp table yangon_road_export already populated (via preload.sh COPY).
-- Resolves road_class_id from class_code against the TARGET database ref table.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'roads_yangon_safe_2026_07_23'
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

CREATE TEMP TABLE IF NOT EXISTS yangon_road_export (
    external_id text,
    classification text,
    canonical_name text,
    name_en text,
    name_mm text,
    class_code text,
    geom geometry,
    is_oneway boolean,
    bridge boolean,
    tunnel boolean,
    layer integer,
    surface text,
    admin_area_id bigint,
    confidence_score numeric,
    source_refs jsonb,
    normalized_data jsonb,
    source_hash text,
    local_staging_id bigint,
    target_core_id bigint
) ON COMMIT PRESERVE ROWS;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM yangon_road_export) THEN
        RAISE EXCEPTION 'yangon_road_export is empty — run COPY first';
    END IF;
    IF EXISTS (
        SELECT 1 FROM yangon_road_export
        WHERE classification NOT IN ('safe_new', 'safe_update')
    ) THEN
        RAISE EXCEPTION 'preload refused: only safe_new/safe_update allowed';
    END IF;
END $$;

-- Resolve target_core_id from live core when export only has identity
UPDATE yangon_road_export AS e
SET target_core_id = c.id
FROM core.core_streets AS c
WHERE e.target_core_id IS NULL
  AND c.deleted_at IS NULL
  AND coalesce(c.is_active, true)
  AND c.external_id = e.external_id;

-- Prefer live core row by external_id (and short/long OSM variants)
UPDATE yangon_road_export AS e
SET target_core_id = c.id
FROM core.core_streets AS c
WHERE e.classification = 'safe_update'
  AND c.deleted_at IS NULL
  AND coalesce(c.is_active, true)
  AND c.external_id IN (
        e.external_id,
        system.pipeline_osm_identity_key(e.external_id),
        CASE
            WHEN system.pipeline_osm_identity_key(e.external_id) LIKE 'osm:way:%'
                THEN 'osm:W:' || split_part(system.pipeline_osm_identity_key(e.external_id), ':', 3)
            WHEN system.pipeline_osm_identity_key(e.external_id) LIKE 'osm:node:%'
                THEN 'osm:N:' || split_part(system.pipeline_osm_identity_key(e.external_id), ':', 3)
            WHEN system.pipeline_osm_identity_key(e.external_id) LIKE 'osm:relation:%'
                THEN 'osm:R:' || split_part(system.pipeline_osm_identity_key(e.external_id), ':', 3)
            ELSE NULL
        END
  );

-- For allowlist probes: keep core geometry attrs; only nudge surface
UPDATE yangon_road_export AS e
SET
    is_oneway = c.is_oneway,
    bridge = c.bridge,
    tunnel = c.tunnel,
    layer = c.layer,
    admin_area_id = coalesce(e.admin_area_id, c.admin_area_id),
    class_code = coalesce(nullif(btrim(e.class_code), ''), c.road_class),
    geom = c.geom,
    surface = CASE
        WHEN nullif(btrim(c.surface), '') IS DISTINCT FROM 'asphalt' THEN 'asphalt'
        ELSE 'concrete'
    END
FROM core.core_streets AS c
WHERE e.target_core_id = c.id
  AND coalesce(e.normalized_data->>'probe', '') = 'allowlist_surface';

INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, validation_status
) VALUES (
    btrim(:'batch_code'),
    'roads',
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

DELETE FROM import_work.road_rows AS r
USING import_work.import_batches AS b
WHERE r.import_batch_id = b.id
  AND b.batch_code = btrim(:'batch_code');

INSERT INTO import_work.road_rows (
    import_batch_id,
    source_snapshot_id,
    source_snapshot_version,
    external_id,
    classification,
    target_core_id,
    canonical_name,
    name_en,
    name_mm,
    road_class_id,
    class_code,
    admin_area_id,
    geom,
    is_oneway,
    bridge,
    tunnel,
    layer,
    surface,
    confidence_score,
    source_refs,
    normalized_data,
    source_hash,
    local_staging_id,
    validation_status
)
SELECT
    b.id,
    :'snapshot_id'::bigint,
    btrim(:'snapshot_version'),
    e.external_id,
    e.classification,
    e.target_core_id,
    e.canonical_name,
    e.name_en,
    e.name_mm,
    coalesce(
        (
            SELECT rc.id FROM ref.ref_road_classes AS rc
            WHERE lower(btrim(rc.code)) = lower(btrim(coalesce(e.class_code, '')))
            ORDER BY rc.id LIMIT 1
        ),
        (
            SELECT c.road_class_id FROM core.core_streets AS c
            WHERE c.id = e.target_core_id
        )
    ),
    e.class_code,
    e.admin_area_id,
    e.geom,
    coalesce(e.is_oneway, false),
    coalesce(e.bridge, false),
    coalesce(e.tunnel, false),
    coalesce(e.layer, 0),
    e.surface,
    e.confidence_score,
    coalesce(e.source_refs, '{}'::jsonb),
    coalesce(e.normalized_data, '{}'::jsonb),
    e.source_hash,
    e.local_staging_id,
    'pending'
FROM yangon_road_export AS e
CROSS JOIN import_work.import_batches AS b
WHERE b.batch_code = btrim(:'batch_code');

UPDATE import_work.import_batches AS b
SET
    status = 'loaded',
    loaded_row_count = (
        SELECT count(*) FROM import_work.road_rows r WHERE r.import_batch_id = b.id
    ),
    expected_row_count = (
        SELECT count(*) FROM import_work.road_rows r WHERE r.import_batch_id = b.id
    ),
    loaded_at = now(),
    validation_status = 'passed',
    updated_at = now()
WHERE b.batch_code = btrim(:'batch_code');

SELECT
    'roads_preload' AS section,
    b.id AS batch_id,
    b.batch_code,
    b.loaded_row_count,
    count(*) FILTER (WHERE r.classification = 'safe_new') AS safe_new,
    count(*) FILTER (WHERE r.classification = 'safe_update') AS safe_update
FROM import_work.import_batches AS b
JOIN import_work.road_rows AS r ON r.import_batch_id = b.id
WHERE b.batch_code = btrim(:'batch_code')
GROUP BY b.id, b.batch_code, b.loaded_row_count;

COMMIT;
