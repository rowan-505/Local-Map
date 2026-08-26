-- =============================================================================
-- READ-ONLY audit: local basemap_source vs production core (supabase_fdw)
-- Families: buildings, land_areas
--
-- No durable INSERT/UPDATE/DELETE. Session temp objects only. ROLLBACK at end.
--
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f tools/data-pipeline/basemap-source/sql/audit_buildings_land_areas_readonly.sql
--
-- Identity reuses system.pipeline_osm_identity_key (osm:W:123 ≡ osm:way:123).
--
-- Geometry tolerances (meters via geography; Hausdorff via EPSG:3857):
--   Buildings
--     same: ST_Equals OR (Hausdorff<0.5m AND area_diff<1% AND centroid<0.5m)
--     tiny: Hausdorff<2m AND area_diff<5% AND centroid<5m
--     meaningful: Hausdorff<20m OR area_diff<25% OR IoU>0.70
--     major: otherwise
--   Land areas
--     same: ST_Equals OR (IoU>=0.99 AND area_diff<1% AND centroid<2m)
--     tiny: IoU>=0.95 AND area_diff<5% AND centroid<10m
--     meaningful: IoU>=0.70 OR area_diff<25%
--     major: otherwise
--
-- Full ST_IsValid is not run on 5.5M local buildings (hours of IO).
-- Those rows use typmod MultiPolygon 4326 NOT NULL + probes + TABLESAMPLE.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\timing on

BEGIN;

SET LOCAL statement_timeout = '25min';
SET LOCAL work_mem = '256MB';
SET LOCAL jit = off;

CREATE OR REPLACE FUNCTION pg_temp.audit_identity(
    p_external_id text,
    p_source_feature_type text,
    p_source_feature_id text,
    p_source_refs jsonb,
    p_osm_feature_type text,
    p_osm_id bigint
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        system.pipeline_osm_identity_key(
            CASE
                WHEN p_osm_feature_type IS NOT NULL AND p_osm_id IS NOT NULL
                    THEN 'osm:' || p_osm_feature_type || ':' || p_osm_id::text
            END
        ),
        system.pipeline_osm_identity_key(
            CASE
                WHEN nullif(btrim(p_source_feature_type), '') IS NOT NULL
                 AND nullif(btrim(p_source_feature_id), '') ~ '^[0-9]+$'
                    THEN 'osm:' || p_source_feature_type || ':' || btrim(p_source_feature_id)
            END
        ),
        system.pipeline_osm_identity_key(p_external_id),
        system.pipeline_osm_identity_key(
            CASE
                WHEN nullif(btrim(p_source_refs->>'osm_feature_type'), '') IS NOT NULL
                 AND nullif(btrim(p_source_refs->>'osm_id'), '') ~ '^[0-9]+$'
                    THEN 'osm:' || (p_source_refs->>'osm_feature_type') || ':'
                         || btrim(p_source_refs->>'osm_id')
            END
        ),
        system.pipeline_osm_identity_key(
            CASE
                WHEN btrim(coalesce(p_external_id, '')) ~ '^[0-9]+$'
                 AND nullif(btrim(p_source_refs->>'osm_feature_type'), '') IS NOT NULL
                    THEN 'osm:' || (p_source_refs->>'osm_feature_type') || ':'
                         || btrim(p_external_id)
            END
        )
    );
$$;

CREATE TEMP TABLE sb_buildings ON COMMIT DROP AS
SELECT
    b.id,
    b.public_id,
    b.external_id,
    pg_temp.audit_identity(
        b.external_id,
        b.source_feature_type,
        b.source_feature_id::text,
        b.source_refs,
        NULL,
        NULL
    ) AS identity_key,
    system.pipeline_osm_classify_identity(b.external_id) AS external_id_class,
    b.source_registry_id,
    b.source_feature_type,
    b.source_feature_id,
    b.name,
    b.is_active,
    b.deleted_at,
    b.is_geometry_manually_edited,
    b.is_attributes_manually_edited,
    b.is_verified,
    b.verification_status,
    b.geom
FROM supabase_fdw.core_buildings b;

ALTER TABLE sb_buildings
    ADD COLUMN osm_ft text,
    ADD COLUMN osm_oid bigint;

UPDATE sb_buildings
SET
    osm_ft = NULLIF(split_part(identity_key, ':', 2), ''),
    osm_oid = CASE
        WHEN split_part(identity_key, ':', 3) ~ '^[0-9]+$'
            THEN split_part(identity_key, ':', 3)::bigint
    END;

CREATE INDEX ON sb_buildings (identity_key);
CREATE INDEX ON sb_buildings (osm_ft, osm_oid);

CREATE TEMP TABLE sb_land ON COMMIT DROP AS
SELECT
    l.id,
    l.public_id,
    l.external_id,
    pg_temp.audit_identity(
        l.external_id,
        l.source_feature_type,
        l.source_feature_id::text,
        l.source_refs,
        NULL,
        NULL
    ) AS identity_key,
    system.pipeline_osm_classify_identity(l.external_id) AS external_id_class,
    l.source_registry_id,
    l.source_feature_type,
    l.source_feature_id,
    l.name,
    l.land_area_class_id,
    l.is_active,
    l.deleted_at,
    l.manual_override,
    l.is_verified,
    l.verification_status,
    l.geom
FROM supabase_fdw.core_land_areas l;

ALTER TABLE sb_land
    ADD COLUMN osm_ft text,
    ADD COLUMN osm_oid bigint;

UPDATE sb_land
SET
    osm_ft = NULLIF(split_part(identity_key, ':', 2), ''),
    osm_oid = CASE
        WHEN split_part(identity_key, ':', 3) ~ '^[0-9]+$'
            THEN split_part(identity_key, ':', 3)::bigint
    END;

CREATE INDEX ON sb_land (identity_key);
CREATE INDEX ON sb_land (osm_ft, osm_oid);

CREATE TEMP TABLE loc_land ON COMMIT DROP AS
SELECT
    l.id,
    l.external_id,
    l.osm_feature_type,
    l.osm_id,
    l.canonical_name,
    l.class_code,
    l.import_class,
    pg_temp.audit_identity(
        l.external_id, NULL, NULL, l.source_refs, l.osm_feature_type, l.osm_id
    ) AS identity_key,
    l.geom
FROM basemap_source.land_areas l;

CREATE INDEX ON loc_land (identity_key);
CREATE INDEX ON loc_land (osm_feature_type, osm_id);

\echo '=== HEALTH local buildings (no full-table ST_IsValid) ==='
SELECT
    'local_buildings' AS dataset,
    count(*) AS total_rows,
    count(*) FILTER (WHERE osm_feature_type IS NULL OR osm_id IS NULL) AS missing_osm_pair,
    count(*) FILTER (WHERE external_id IS NULL OR btrim(external_id) = '') AS missing_external_id
FROM basemap_source.buildings;

SELECT 'local_buildings_unique_indexes' AS section, indexrelid::regclass AS idx, indisunique
FROM pg_index
WHERE indrelid = 'basemap_source.buildings'::regclass AND indisunique;

SELECT 'local_buildings_typmod' AS section,
       format_type(a.atttypid, a.atttypmod) AS geom_typmod,
       a.attnotnull AS geom_not_null
FROM pg_attribute a
WHERE a.attrelid = 'basemap_source.buildings'::regclass
  AND a.attname = 'geom';

SELECT 'local_buildings_empty_probe' AS section,
       EXISTS (SELECT 1 FROM basemap_source.buildings WHERE ST_IsEmpty(geom)) AS has_empty;

SELECT 'local_buildings_invalid_sample' AS section,
       count(*) AS sample_n,
       count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_in_sample
FROM (SELECT geom FROM basemap_source.buildings TABLESAMPLE SYSTEM (0.2) REPEATABLE (42)) s;

SELECT 'local_buildings_external_id_class' AS section,
       system.pipeline_osm_classify_identity(external_id) AS cls,
       count(*) AS n
FROM basemap_source.buildings
GROUP BY 2
ORDER BY n DESC;

SELECT 'local_buildings_identity_mismatch_vs_osm_cols' AS section, count(*) AS n
FROM basemap_source.buildings
WHERE system.pipeline_osm_identity_key(external_id)
   IS DISTINCT FROM system.pipeline_osm_identity_key(
       CASE WHEN osm_feature_type IS NOT NULL AND osm_id IS NOT NULL
            THEN 'osm:' || osm_feature_type || ':' || osm_id::text END
   );

SELECT 'local_buildings_managed_in_core' AS section,
       count(*) FILTER (WHERE is_managed_in_core) AS managed_in_core,
       count(*) FILTER (WHERE NOT is_managed_in_core) AS not_managed
FROM basemap_source.buildings;

\echo '=== HEALTH local land_areas ==='
SELECT
    'local_land_areas' AS dataset,
    count(*) AS total_rows,
    count(*) FILTER (WHERE import_class = 'pmtiles_only') AS pmtiles_only,
    count(*) FILTER (WHERE geom IS NULL) AS null_geom,
    count(*) FILTER (WHERE ST_IsEmpty(geom)) AS empty_geom,
    count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom,
    count(*) FILTER (WHERE ST_SRID(geom) <> 4326) AS non_4326,
    count(*) FILTER (WHERE GeometryType(geom) <> 'MULTIPOLYGON') AS non_multipolygon,
    count(*) FILTER (WHERE identity_key IS NULL) AS missing_canonical_identity
FROM loc_land;

SELECT 'local_land_external_id_class' AS section,
       system.pipeline_osm_classify_identity(external_id) AS cls,
       count(*) AS n
FROM loc_land
GROUP BY 2
ORDER BY n DESC;

SELECT 'local_land_dup_canonical' AS section,
       count(*) AS dup_keys,
       coalesce(sum(c - 1), 0) AS extra_rows
FROM (
    SELECT identity_key, count(*) AS c
    FROM loc_land
    WHERE identity_key IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
) d;

SELECT 'local_land_class_code' AS section, class_code, count(*) AS n
FROM loc_land
GROUP BY 2
ORDER BY n DESC
LIMIT 15;

\echo '=== HEALTH supabase buildings ==='
SELECT
    'sb_buildings' AS dataset,
    count(*) AS total_rows,
    count(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted,
    count(*) FILTER (WHERE deleted_at IS NULL AND is_active) AS active,
    count(*) FILTER (WHERE geom IS NULL) AS null_geom,
    count(*) FILTER (WHERE ST_IsEmpty(geom)) AS empty_geom,
    count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom,
    count(*) FILTER (WHERE ST_SRID(geom) <> 4326) AS non_4326,
    count(*) FILTER (WHERE identity_key IS NULL) AS missing_canonical_identity,
    count(*) FILTER (WHERE is_geometry_manually_edited) AS geom_manual,
    count(*) FILTER (WHERE is_attributes_manually_edited) AS attrs_manual
FROM sb_buildings;

SELECT 'sb_buildings_external_id_class' AS section, external_id_class, count(*) AS n
FROM sb_buildings GROUP BY 2 ORDER BY n DESC;

SELECT 'sb_buildings_dup_canonical' AS section,
       count(*) AS dup_keys,
       coalesce(sum(c - 1), 0) AS extra_rows
FROM (
    SELECT identity_key, count(*) AS c
    FROM sb_buildings
    WHERE identity_key IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
) d;

SELECT 'sb_buildings_geom_type' AS section, GeometryType(geom) AS gtype, ST_SRID(geom) AS srid, count(*) AS n
FROM sb_buildings GROUP BY 2, 3;

\echo '=== HEALTH supabase land_areas ==='
SELECT
    'sb_land' AS dataset,
    count(*) AS total_rows,
    count(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted,
    count(*) FILTER (WHERE deleted_at IS NULL AND is_active) AS active,
    count(*) FILTER (WHERE geom IS NULL) AS null_geom,
    count(*) FILTER (WHERE ST_IsEmpty(geom)) AS empty_geom,
    count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom,
    count(*) FILTER (WHERE ST_SRID(geom) <> 4326) AS non_4326,
    count(*) FILTER (WHERE identity_key IS NULL) AS missing_canonical_identity,
    count(*) FILTER (WHERE manual_override) AS manual_override
FROM sb_land;

SELECT 'sb_land_external_id_class' AS section, external_id_class, count(*) AS n
FROM sb_land GROUP BY 2 ORDER BY n DESC;

SELECT 'sb_land_dup_canonical' AS section,
       count(*) AS dup_keys,
       coalesce(sum(c - 1), 0) AS extra_rows
FROM (
    SELECT identity_key, count(*) AS c
    FROM sb_land
    WHERE identity_key IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
) d;

SELECT 'sb_land_geom_type' AS section, GeometryType(geom) AS gtype, ST_SRID(geom) AS srid, count(*) AS n
FROM sb_land GROUP BY 2, 3;

\echo '=== BUILDINGS identity + geometry compare ==='
CREATE TEMP TABLE bldg_matched ON COMMIT DROP AS
SELECT
    s.identity_key,
    b.id AS local_id,
    s.id AS sb_id,
    b.canonical_name AS local_name,
    s.name AS sb_name,
    s.is_geometry_manually_edited,
    s.is_attributes_manually_edited,
    ST_Equals(b.geom, s.geom) AS st_equals,
    ST_HausdorffDistance(ST_Transform(b.geom, 3857), ST_Transform(s.geom, 3857)) AS hausdorff_m,
    abs(ST_Area(b.geom::geography) - ST_Area(s.geom::geography))
        / NULLIF(ST_Area(s.geom::geography), 0) * 100 AS area_diff_pct,
    ST_Distance(ST_Centroid(b.geom)::geography, ST_Centroid(s.geom)::geography) AS centroid_m,
    ST_Area(ST_Intersection(b.geom, s.geom)::geography)
        / NULLIF(ST_Area(ST_Union(b.geom, s.geom)::geography), 0) AS iou,
    (nullif(btrim(b.canonical_name), '') IS DISTINCT FROM nullif(btrim(s.name), '')) AS name_diff
FROM sb_buildings s
JOIN basemap_source.buildings b
  ON b.osm_feature_type = s.osm_ft
 AND b.osm_id = s.osm_oid
WHERE s.identity_key IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.osm_ft IS NOT NULL
  AND s.osm_oid IS NOT NULL;

SELECT 'buildings_match_stats' AS section,
    (SELECT count(*) FROM basemap_source.buildings) AS local_rows,
    (SELECT count(*) FROM sb_buildings WHERE deleted_at IS NULL) AS sb_active_rows,
    (SELECT count(*) FROM bldg_matched) AS matched_rows,
    (SELECT count(*) FROM sb_buildings s
      WHERE s.deleted_at IS NULL AND s.identity_key IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM basemap_source.buildings b
            WHERE b.osm_feature_type = s.osm_ft AND b.osm_id = s.osm_oid
        )) AS sb_only_with_identity,
    (SELECT count(*) FROM sb_buildings WHERE deleted_at IS NULL AND identity_key IS NULL) AS sb_missing_identity,
    (SELECT count(*) FROM basemap_source.buildings b
      WHERE NOT EXISTS (
          SELECT 1 FROM sb_buildings s
          WHERE s.deleted_at IS NULL
            AND s.osm_ft = b.osm_feature_type
            AND s.osm_oid = b.osm_id
      )) AS local_only_rows;

SELECT 'buildings_geom_class' AS section,
    CASE
        WHEN st_equals
          OR (hausdorff_m < 0.5 AND coalesce(area_diff_pct, 0) < 1 AND centroid_m < 0.5)
            THEN 'same'
        WHEN hausdorff_m < 2 AND coalesce(area_diff_pct, 0) < 5 AND centroid_m < 5
            THEN 'tiny_difference'
        WHEN hausdorff_m < 20 OR coalesce(area_diff_pct, 0) < 25 OR coalesce(iou, 0) > 0.70
            THEN 'meaningful_difference'
        ELSE 'major_conflict'
    END AS geom_class,
    count(*) AS n,
    count(*) FILTER (WHERE is_geometry_manually_edited) AS geom_manual,
    count(*) FILTER (WHERE name_diff) AS name_diff,
    round(avg(hausdorff_m)::numeric, 3) AS avg_hausdorff_m,
    round(avg(centroid_m)::numeric, 3) AS avg_centroid_m,
    round(avg(area_diff_pct)::numeric, 3) AS avg_area_diff_pct
FROM bldg_matched
GROUP BY 2
ORDER BY n DESC;

SELECT 'buildings_final_class' AS section, cls, n,
       round(100.0 * n / NULLIF(sum(n) OVER (), 0), 2) AS pct
FROM (
    SELECT 'exact_overlap' AS cls, count(*) AS n
    FROM bldg_matched m
    WHERE (m.st_equals OR (m.hausdorff_m < 0.5 AND coalesce(m.area_diff_pct, 0) < 1 AND m.centroid_m < 0.5))
      AND NOT m.name_diff
      AND NOT m.is_geometry_manually_edited
      AND NOT m.is_attributes_manually_edited
    UNION ALL
    SELECT 'supabase_override', count(*)
    FROM bldg_matched m
    WHERE NOT (
        (m.st_equals OR (m.hausdorff_m < 0.5 AND coalesce(m.area_diff_pct, 0) < 1 AND m.centroid_m < 0.5))
        AND NOT m.name_diff
        AND NOT m.is_geometry_manually_edited
        AND NOT m.is_attributes_manually_edited
    )
    UNION ALL
    SELECT 'local_only', (
        SELECT count(*) FROM basemap_source.buildings b
        WHERE NOT EXISTS (
            SELECT 1 FROM sb_buildings s
            WHERE s.deleted_at IS NULL
              AND s.osm_ft = b.osm_feature_type
              AND s.osm_oid = b.osm_id
        )
    )
    UNION ALL
    SELECT 'supabase_only', (
        SELECT count(*) FROM sb_buildings s
        WHERE s.deleted_at IS NULL
          AND s.identity_key IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM basemap_source.buildings b
              WHERE b.osm_feature_type = s.osm_ft AND b.osm_id = s.osm_oid
          )
    )
    UNION ALL
    SELECT 'local_duplicate', 0
    UNION ALL
    SELECT 'supabase_duplicate', coalesce((
        SELECT sum(c - 1) FROM (
            SELECT identity_key, count(*) AS c FROM sb_buildings
            WHERE identity_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1
        ) d
    ), 0)
    UNION ALL
    SELECT 'sb_missing_identity', (
        SELECT count(*) FROM sb_buildings WHERE deleted_at IS NULL AND identity_key IS NULL
    )
) x
ORDER BY 1;

\echo '=== LAND AREAS identity + geometry compare ==='
CREATE TEMP TABLE land_matched ON COMMIT DROP AS
SELECT
    s.identity_key,
    l.id AS local_id,
    s.id AS sb_id,
    l.canonical_name AS local_name,
    s.name AS sb_name,
    l.class_code,
    s.manual_override,
    ST_Equals(l.geom, s.geom) AS st_equals,
    ST_HausdorffDistance(ST_Transform(l.geom, 3857), ST_Transform(s.geom, 3857)) AS hausdorff_m,
    abs(ST_Area(l.geom::geography) - ST_Area(s.geom::geography))
        / NULLIF(ST_Area(s.geom::geography), 0) * 100 AS area_diff_pct,
    ST_Distance(ST_Centroid(l.geom)::geography, ST_Centroid(s.geom)::geography) AS centroid_m,
    ST_Area(ST_Intersection(l.geom, s.geom)::geography)
        / NULLIF(ST_Area(ST_Union(l.geom, s.geom)::geography), 0) AS iou,
    ST_Area(ST_SymDifference(l.geom, s.geom)::geography) AS symdiff_m2,
    (nullif(btrim(l.canonical_name), '') IS DISTINCT FROM nullif(btrim(s.name), '')) AS name_diff
FROM sb_land s
JOIN loc_land l
  ON l.osm_feature_type = s.osm_ft
 AND l.osm_id = s.osm_oid
WHERE s.identity_key IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.osm_ft IS NOT NULL
  AND s.osm_oid IS NOT NULL;

SELECT 'land_match_stats' AS section,
    (SELECT count(*) FROM loc_land) AS local_rows,
    (SELECT count(*) FROM sb_land WHERE deleted_at IS NULL) AS sb_active_rows,
    (SELECT count(*) FROM land_matched) AS matched_rows,
    (SELECT count(*) FROM loc_land l
      WHERE l.identity_key IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM sb_land s
            WHERE s.deleted_at IS NULL AND s.osm_ft = l.osm_feature_type AND s.osm_oid = l.osm_id
        )) AS local_only_rows,
    (SELECT count(*) FROM sb_land s
      WHERE s.deleted_at IS NULL AND s.identity_key IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM loc_land l
            WHERE l.osm_feature_type = s.osm_ft AND l.osm_id = s.osm_oid
        )) AS sb_only_with_identity,
    (SELECT count(*) FROM sb_land WHERE deleted_at IS NULL AND identity_key IS NULL) AS sb_missing_identity;

SELECT 'land_geom_class' AS section,
    CASE
        WHEN st_equals
          OR (coalesce(iou, 0) >= 0.99 AND coalesce(area_diff_pct, 0) < 1 AND centroid_m < 2)
            THEN 'same'
        WHEN coalesce(iou, 0) >= 0.95 AND coalesce(area_diff_pct, 0) < 5 AND centroid_m < 10
            THEN 'tiny_difference'
        WHEN coalesce(iou, 0) >= 0.70 OR coalesce(area_diff_pct, 0) < 25
            THEN 'meaningful_difference'
        ELSE 'major_conflict'
    END AS geom_class,
    count(*) AS n,
    count(*) FILTER (WHERE manual_override) AS manual_override,
    count(*) FILTER (WHERE name_diff) AS name_diff,
    round(avg(iou)::numeric, 4) AS avg_iou,
    round(avg(area_diff_pct)::numeric, 3) AS avg_area_diff_pct,
    round(avg(centroid_m)::numeric, 3) AS avg_centroid_m
FROM land_matched
GROUP BY 2
ORDER BY n DESC;

SELECT 'land_final_class' AS section, cls, n,
       round(100.0 * n / NULLIF(sum(n) OVER (), 0), 2) AS pct
FROM (
    SELECT 'exact_overlap' AS cls, count(*) AS n
    FROM land_matched m
    WHERE (m.st_equals OR (coalesce(m.iou, 0) >= 0.99 AND coalesce(m.area_diff_pct, 0) < 1 AND m.centroid_m < 2))
      AND NOT m.name_diff
      AND NOT coalesce(m.manual_override, false)
    UNION ALL
    SELECT 'supabase_override', count(*)
    FROM land_matched m
    WHERE NOT (
        (m.st_equals OR (coalesce(m.iou, 0) >= 0.99 AND coalesce(m.area_diff_pct, 0) < 1 AND m.centroid_m < 2))
        AND NOT m.name_diff
        AND NOT coalesce(m.manual_override, false)
    )
    UNION ALL
    SELECT 'local_only', (
        SELECT count(*) FROM loc_land l
        WHERE NOT EXISTS (
            SELECT 1 FROM sb_land s
            WHERE s.deleted_at IS NULL AND s.osm_ft = l.osm_feature_type AND s.osm_oid = l.osm_id
        )
    )
    UNION ALL
    SELECT 'supabase_only', (
        SELECT count(*) FROM sb_land s
        WHERE s.deleted_at IS NULL
          AND s.identity_key IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM loc_land l
              WHERE l.osm_feature_type = s.osm_ft AND l.osm_id = s.osm_oid
          )
    )
    UNION ALL
    SELECT 'local_duplicate', coalesce((
        SELECT sum(c - 1) FROM (
            SELECT identity_key, count(*) AS c FROM loc_land
            WHERE identity_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1
        ) d
    ), 0)
    UNION ALL
    SELECT 'supabase_duplicate', coalesce((
        SELECT sum(c - 1) FROM (
            SELECT identity_key, count(*) AS c FROM sb_land
            WHERE identity_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1
        ) d
    ), 0)
    UNION ALL
    SELECT 'sb_missing_identity', (
        SELECT count(*) FROM sb_land WHERE deleted_at IS NULL AND identity_key IS NULL
    )
) x
ORDER BY 1;

\echo '=== spatial_possible_duplicate (missing identity only) ==='
CREATE TEMP TABLE spatial_possible_duplicate ON COMMIT DROP AS
SELECT
    'buildings'::text AS family,
    s.id AS sb_id,
    s.public_id AS sb_public_id,
    b.id AS local_id,
    b.external_id AS local_external_id,
    ST_Distance(ST_Centroid(s.geom)::geography, ST_Centroid(b.geom)::geography) AS centroid_m,
    ST_Area(ST_Intersection(s.geom, b.geom)::geography)
        / NULLIF(ST_Area(ST_Union(s.geom, b.geom)::geography), 0) AS iou,
    abs(ST_Area(s.geom::geography) - ST_Area(b.geom::geography))
        / NULLIF(GREATEST(ST_Area(s.geom::geography), ST_Area(b.geom::geography)), 0) AS area_rel_diff
FROM sb_buildings s
JOIN basemap_source.buildings b
  ON b.geom && ST_Expand(s.geom, 0.00015)
 AND ST_DWithin(ST_Centroid(s.geom)::geography, ST_Centroid(b.geom)::geography, 15)
WHERE s.deleted_at IS NULL
  AND s.identity_key IS NULL
  AND ST_Area(ST_Intersection(s.geom, b.geom)::geography)
        / NULLIF(ST_Area(ST_Union(s.geom, b.geom)::geography), 0) >= 0.70;

INSERT INTO spatial_possible_duplicate
SELECT
    'land_areas',
    s.id,
    s.public_id,
    l.id,
    l.external_id,
    ST_Distance(ST_Centroid(s.geom)::geography, ST_Centroid(l.geom)::geography),
    ST_Area(ST_Intersection(s.geom, l.geom)::geography)
        / NULLIF(ST_Area(ST_Union(s.geom, l.geom)::geography), 0),
    abs(ST_Area(s.geom::geography) - ST_Area(l.geom::geography))
        / NULLIF(GREATEST(ST_Area(s.geom::geography), ST_Area(l.geom::geography)), 0)
FROM sb_land s
JOIN loc_land l
  ON l.geom && ST_Expand(s.geom, 0.0003)
 AND ST_DWithin(ST_Centroid(s.geom)::geography, ST_Centroid(l.geom)::geography, 50)
WHERE s.deleted_at IS NULL
  AND s.identity_key IS NULL
  AND ST_Area(ST_Intersection(s.geom, l.geom)::geography)
        / NULLIF(ST_Area(ST_Union(s.geom, l.geom)::geography), 0) >= 0.80;

SELECT family, count(*) AS candidate_pairs
FROM spatial_possible_duplicate
GROUP BY 1
ORDER BY 1;

SELECT * FROM spatial_possible_duplicate
ORDER BY family, iou DESC NULLS LAST
LIMIT 15;

SELECT 'sb_only_building_sample' AS section, id, public_id, external_id, identity_key, name
FROM sb_buildings s
WHERE s.deleted_at IS NULL
  AND s.identity_key IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM basemap_source.buildings b
      WHERE b.osm_feature_type = s.osm_ft AND b.osm_id = s.osm_oid
  )
LIMIT 8;

SELECT 'sb_only_land_sample' AS section, id, public_id, external_id, identity_key, name, manual_override
FROM sb_land s
WHERE s.deleted_at IS NULL
  AND s.identity_key IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM loc_land l
      WHERE l.osm_feature_type = s.osm_ft AND l.osm_id = s.osm_oid
  )
LIMIT 8;

ROLLBACK;
