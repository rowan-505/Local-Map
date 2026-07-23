-- =============================================================================
-- Yangon essential places: fast preload into import_work.place_rows
-- Uses one GIST join for admin (not correlated ST_Covers per row).
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'places_yangon_essential_safe_2026_07_23'
\endif

BEGIN;

CREATE TEMP TABLE yangon_essential_export (
    external_id text,
    import_class text,
    primary_name text,
    display_name text,
    class_code text,
    source_type_hint text,
    source_category_hint text,
    lat double precision,
    lng double precision,
    confidence_score numeric,
    source_hash text,
    source_refs text
) ON COMMIT DROP;

\copy yangon_essential_export FROM '/Users/nyihtet/Documents/Projects/Core-Map/tools/data-pipeline/import-work/reports/_yangon_safe_essential_places.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE osm_poi_category_map (
    osm_key text PRIMARY KEY,
    category_code text NOT NULL
) ON COMMIT DROP;

INSERT INTO osm_poi_category_map (osm_key, category_code) VALUES
    ('place_of_worship', 'religion'),
    ('monastery', 'monastery'),
    ('hospital', 'hospital'),
    ('clinic', 'clinic'),
    ('pharmacy', 'pharmacy'),
    ('school', 'school'),
    ('university', 'university'),
    ('library', 'library'),
    ('restaurant', 'restaurant'),
    ('cafe', 'cafe'),
    ('teashop', 'teashop'),
    ('tea', 'teashop'),
    ('atm', 'atm'),
    ('bank', 'bank'),
    ('fuel', 'fuel'),
    ('hotel', 'hotel'),
    ('guest_house', 'hotel'),
    ('marketplace', 'market'),
    ('supermarket', 'supermarket'),
    ('convenience', 'convenience_store'),
    ('bakery', 'shopping'),
    ('beverages', 'shopping'),
    ('battery', 'shopping'),
    ('dry_cleaning', 'services'),
    ('government', 'government'),
    ('police', 'police_station'),
    ('police_station', 'police_station'),
    ('post_office', 'post_office'),
    ('township_office', 'township_office'),
    ('company', 'office'),
    ('social_facility', 'community'),
    ('nursing_home', 'community'),
    ('childcare', 'services'),
    ('artwork', 'entertainment'),
    ('attraction', 'entertainment'),
    ('park', 'entertainment'),
    ('playground', 'entertainment'),
    ('golf_course', 'entertainment'),
    ('fountain', 'facility'),
    ('station', 'transport'),
    ('stop_position', 'bus_stop'),
    ('ferry_terminal', 'ferry_terminal'),
    ('train_station', 'train_station'),
    ('building', 'facility'),
    ('yes', 'health'),
    ('apartment', 'facility'),
    ('photo', 'entertainment');

CREATE TEMP TABLE yangon_essential_pts AS
SELECT
    e.*,
    coalesce(m1.category_code, m2.category_code) AS mapped_category_code,
    c.id AS category_id,
    system.pipeline_osm_identity_key(e.external_id) AS identity_key,
    ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geometry(Point, 4326) AS point_geom
FROM yangon_essential_export AS e
LEFT JOIN osm_poi_category_map AS m1 ON m1.osm_key = lower(btrim(e.class_code))
LEFT JOIN osm_poi_category_map AS m2 ON m2.osm_key = lower(btrim(e.source_type_hint))
LEFT JOIN ref.ref_poi_categories AS c ON c.code = coalesce(m1.category_code, m2.category_code);

CREATE INDEX yangon_essential_pts_gix ON yangon_essential_pts USING GIST (point_geom);

CREATE TEMP TABLE yangon_essential_admin AS
SELECT DISTINCT ON (p.external_id)
    p.external_id,
    aa.id AS admin_area_id
FROM yangon_essential_pts AS p
JOIN core.core_admin_areas AS aa
  ON aa.deleted_at IS NULL
 AND aa.is_active
 AND ST_Covers(aa.geom, p.point_geom)
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE al.code IN ('township')
ORDER BY p.external_id, al.rank DESC, aa.id;

CREATE TEMP TABLE yangon_essential_core AS
SELECT DISTINCT ON (system.pipeline_osm_identity_key(cp.external_id))
    system.pipeline_osm_identity_key(cp.external_id) AS identity_key,
    cp.id AS matched_core_id
FROM core.core_places AS cp
WHERE cp.deleted_at IS NULL
  AND cp.external_id IS NOT NULL
ORDER BY system.pipeline_osm_identity_key(cp.external_id), cp.id;

CREATE INDEX yangon_essential_core_idx ON yangon_essential_core (identity_key);

CREATE TEMP TABLE yangon_essential_ir AS
SELECT DISTINCT system.pipeline_osm_identity_key(ir.external_id) AS identity_key
FROM import_review.place_candidates AS ir
WHERE ir.external_id IS NOT NULL;

CREATE INDEX yangon_essential_ir_idx ON yangon_essential_ir (identity_key);

CREATE TEMP TABLE yangon_essential_resolved AS
SELECT
    p.*,
    c.matched_core_id,
    (ir.identity_key IS NOT NULL) AS in_import_review,
    a.admin_area_id AS inferred_admin_area_id
FROM yangon_essential_pts AS p
LEFT JOIN yangon_essential_admin AS a ON a.external_id = p.external_id
LEFT JOIN yangon_essential_core AS c ON c.identity_key = p.identity_key
LEFT JOIN yangon_essential_ir AS ir ON ir.identity_key = p.identity_key;

SELECT 'preload_counts' AS section, import_class, count(*) AS n,
       count(*) FILTER (WHERE category_id IS NOT NULL) AS mapped_cat,
       count(*) FILTER (WHERE category_id IS NULL) AS unsupported_cat,
       count(*) FILTER (WHERE in_import_review) AS in_ir,
       count(*) FILTER (WHERE matched_core_id IS NOT NULL) AS identity_in_core,
       count(*) FILTER (WHERE inferred_admin_area_id IS NOT NULL) AS has_admin
FROM yangon_essential_resolved
GROUP BY import_class
ORDER BY import_class;

SELECT 'unsupported_top' AS section, class_code, source_type_hint, count(*) AS n
FROM yangon_essential_resolved
WHERE category_id IS NULL
GROUP BY 1, 2, 3
ORDER BY n DESC
LIMIT 20;

CREATE TEMP TABLE yangon_essential_ready AS
SELECT *
FROM yangon_essential_resolved
WHERE category_id IS NOT NULL
  AND NOT in_import_review
  AND inferred_admin_area_id IS NOT NULL
  AND (
        (import_class = 'safe_new' AND matched_core_id IS NULL)
        OR (import_class = 'safe_update' AND matched_core_id IS NOT NULL)
      );

SELECT 'load_ready' AS section, import_class, count(*) AS n
FROM yangon_essential_ready
GROUP BY import_class;

INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, validation_status, notes
) VALUES (
    :'batch_code', 'places', 9, 'osm_myanmar_2026_07_21_yangon_city_v1',
    'loading', (SELECT count(*) FROM yangon_essential_ready), 'not_started',
    'Yangon essential places safe load 2026-07-23'
)
ON CONFLICT (batch_code) DO UPDATE
SET status = 'loading',
    expected_row_count = EXCLUDED.expected_row_count,
    updated_at = now(),
    cleaned_at = NULL
RETURNING id, batch_code, expected_row_count;

DELETE FROM import_work.place_rows AS r
USING import_work.import_batches AS b
WHERE r.import_batch_id = b.id AND b.batch_code = :'batch_code';

INSERT INTO import_work.place_rows (
    import_batch_id, source_snapshot_id, source_snapshot_version, external_id,
    classification, target_core_id, primary_name, display_name, category_id,
    admin_area_id, point_geom, lat, lng, plus_code, importance_score,
    popularity_score, confidence_score, source_refs, source_hash,
    validation_status, validation_result
)
SELECT
    b.id, 9, 'osm_myanmar_2026_07_21_yangon_city_v1', r.external_id,
    r.import_class, r.matched_core_id,
    nullif(btrim(r.primary_name), ''), nullif(btrim(r.display_name), ''),
    r.category_id, r.inferred_admin_area_id, r.point_geom, r.lat, r.lng, NULL,
    least(100, greatest(0, coalesce(r.confidence_score, 50))),
    least(100, greatest(0, coalesce(r.confidence_score, 50))),
    least(100, greatest(0, coalesce(r.confidence_score, 50))),
    coalesce(r.source_refs::jsonb, '{}'::jsonb)
        || jsonb_build_object(
            'mapped_category_code', r.mapped_category_code,
            'class_code', r.class_code,
            'gate', 'yangon_essential_places_pilot'
        ),
    nullif(btrim(r.source_hash), ''),
    'passed',
    jsonb_build_object('preload', 'yangon_essential_places_preload_and_copy')
FROM yangon_essential_ready AS r
CROSS JOIN import_work.import_batches AS b
WHERE b.batch_code = :'batch_code';

UPDATE import_work.import_batches AS b
SET
    loaded_row_count = (SELECT count(*) FROM import_work.place_rows r WHERE r.import_batch_id = b.id),
    expected_row_count = (SELECT count(*) FROM import_work.place_rows r WHERE r.import_batch_id = b.id),
    status = 'loaded',
    loaded_at = now(),
    updated_at = now(),
    validation_status = 'passed'
WHERE b.batch_code = :'batch_code';

SELECT 'import_work_loaded' AS section, b.id, b.batch_code, b.status,
       b.expected_row_count, b.loaded_row_count
FROM import_work.import_batches b
WHERE b.batch_code = :'batch_code';

COMMIT;
