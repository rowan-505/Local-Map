-- =============================================================================
-- Kyauktan places Gate 4: preload resolve → COPY into import_work.place_rows
--
-- Requires:
--   -v csv_path='/absolute/path/to/_kyauktan_safe_places.csv'
--   -v batch_code='places_kyauktan_safe_2026_07_22'
--
-- Does NOT write core.*. Does NOT touch import_review.*.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code 'places_kyauktan_safe_2026_07_22'
\endif

-- Caller must replace __CSV_PATH__ before running, or use the shell wrapper.
BEGIN;

CREATE TEMP TABLE kyauktan_safe_export (
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

\copy kyauktan_safe_export FROM '__CSV_PATH__' WITH (FORMAT csv, HEADER true)

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
    ('photo', 'entertainment'),
    -- OSM settlement place=* → ref.ref_poi_categories (migration 140)
    ('city', 'city'),
    ('town', 'town'),
    ('village', 'village'),
    ('hamlet', 'hamlet'),
    ('suburb', 'suburb'),
    ('quarter', 'quarter'),
    ('neighbourhood', 'neighbourhood'),
    ('neighborhood', 'neighbourhood'),
    ('locality', 'locality');

CREATE TEMP TABLE kyauktan_safe_resolved AS
SELECT
    e.*,
    coalesce(m1.category_code, m2.category_code) AS mapped_category_code,
    c.id AS category_id,
    system.pipeline_osm_identity_key(e.external_id) AS identity_key,
    ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geometry(Point, 4326) AS point_geom,
    (
        SELECT p.id
        FROM core.core_places AS p
        WHERE p.deleted_at IS NULL
          AND system.pipeline_osm_identity_key(p.external_id)
              = system.pipeline_osm_identity_key(e.external_id)
        ORDER BY p.id
        LIMIT 1
    ) AS matched_core_id,
    EXISTS (
        SELECT 1
        FROM import_review.place_candidates AS ir
        WHERE ir.external_id = e.external_id
           OR (
                ir.external_id IS NOT NULL
                AND system.pipeline_osm_identity_key(ir.external_id)
                    = system.pipeline_osm_identity_key(e.external_id)
           )
    ) AS in_import_review,
    (
        SELECT aa.id
        FROM core.core_admin_areas AS aa
        JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.deleted_at IS NULL
          AND aa.is_active
          AND al.code IN ('ward_village_tract', 'town', 'township')
          AND ST_Covers(aa.geom, ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326))
        ORDER BY al.rank DESC, aa.id
        LIMIT 1
    ) AS inferred_admin_area_id
FROM kyauktan_safe_export AS e
LEFT JOIN osm_poi_category_map AS m1
    ON m1.osm_key = lower(btrim(e.class_code))
LEFT JOIN osm_poi_category_map AS m2
    ON m2.osm_key = lower(btrim(e.source_type_hint))
LEFT JOIN ref.ref_poi_categories AS c
    ON c.code = coalesce(m1.category_code, m2.category_code);

SELECT
    'preload_counts' AS section,
    import_class,
    count(*) AS n,
    count(*) FILTER (WHERE category_id IS NOT NULL) AS mapped_cat,
    count(*) FILTER (WHERE category_id IS NULL) AS unsupported_cat,
    count(*) FILTER (WHERE in_import_review) AS in_ir,
    count(*) FILTER (WHERE matched_core_id IS NOT NULL) AS identity_in_core,
    count(*) FILTER (WHERE inferred_admin_area_id IS NOT NULL) AS has_admin
FROM kyauktan_safe_resolved
GROUP BY import_class
ORDER BY import_class;

SELECT
    'unsupported_categories' AS section,
    class_code,
    source_type_hint,
    count(*) AS n
FROM kyauktan_safe_resolved
WHERE category_id IS NULL
GROUP BY 1, 2, 3
ORDER BY n DESC;

SELECT 'ir_overlap_count' AS section, count(*) AS n
FROM kyauktan_safe_resolved
WHERE in_import_review;

SELECT
    'safe_update_core' AS section,
    count(*) FILTER (WHERE matched_core_id IS NOT NULL) AS with_core,
    count(*) FILTER (WHERE matched_core_id IS NULL) AS without_core
FROM kyauktan_safe_resolved
WHERE import_class = 'safe_update';

SELECT 'safe_new_already_core' AS section, count(*) AS n
FROM kyauktan_safe_resolved
WHERE import_class = 'safe_new'
  AND matched_core_id IS NOT NULL;

SELECT
    'protection_on_safe_update_targets' AS section,
    count(*) FILTER (WHERE p.is_verified) AS verified_targets,
    count(*) FILTER (
        WHERE coalesce((p.source_refs->>'manual_override') IN ('true', 't', '1'), false)
           OR p.source_refs @> '{"source":"dashboard"}'::jsonb
           OR p.source_refs @> '{"source":"manual"}'::jsonb
    ) AS manual_targets
FROM kyauktan_safe_resolved AS r
JOIN core.core_places AS p ON p.id = r.matched_core_id
WHERE r.import_class = 'safe_update';

SELECT 'dup_external' AS section, count(*) AS n
FROM (
    SELECT external_id
    FROM kyauktan_safe_resolved
    GROUP BY external_id
    HAVING count(*) > 1
) AS d;

SELECT 'dup_identity' AS section, count(*) AS n
FROM (
    SELECT identity_key
    FROM kyauktan_safe_resolved
    GROUP BY identity_key
    HAVING count(*) > 1
) AS d;

SELECT 'core_before' AS section, count(*) AS active_places
FROM core.core_places
WHERE deleted_at IS NULL;

-- Load-ready: mapped category, not in IR, and safe_update has core OR safe_new has no core
CREATE TEMP TABLE kyauktan_load_ready AS
SELECT *
FROM kyauktan_safe_resolved
WHERE category_id IS NOT NULL
  AND NOT in_import_review
  AND (
        (import_class = 'safe_new' AND matched_core_id IS NULL)
        OR (import_class = 'safe_update' AND matched_core_id IS NOT NULL)
      );

SELECT
    'load_ready' AS section,
    import_class,
    count(*) AS n
FROM kyauktan_load_ready
GROUP BY import_class
ORDER BY import_class;

SELECT 'load_ready_total' AS section, count(*) AS n FROM kyauktan_load_ready;

-- Exclusions detail
SELECT
    'excluded' AS section,
    CASE
        WHEN in_import_review THEN 'in_import_review'
        WHEN category_id IS NULL THEN 'unsupported_category'
        WHEN import_class = 'safe_update' AND matched_core_id IS NULL THEN 'safe_update_no_core'
        WHEN import_class = 'safe_new' AND matched_core_id IS NOT NULL THEN 'safe_new_already_in_core'
        ELSE 'other'
    END AS reason,
    count(*) AS n
FROM kyauktan_safe_resolved
WHERE NOT EXISTS (
    SELECT 1 FROM kyauktan_load_ready lr WHERE lr.external_id = kyauktan_safe_resolved.external_id
)
GROUP BY 1, 2
ORDER BY n DESC;

-- Upsert batch header
INSERT INTO import_work.import_batches (
    batch_code,
    entity_family,
    source_snapshot_id,
    source_snapshot_version,
    status,
    expected_row_count,
    validation_status,
    notes
) VALUES (
    :'batch_code',
    'places',
    4,
    'osm_myanmar_2026_05_15_kyauktan_v2',
    'loading',
    (SELECT count(*) FROM kyauktan_load_ready),
    'not_started',
    'Kyauktan Gate 4 real safe places load'
)
ON CONFLICT (batch_code) DO UPDATE
SET
    status = 'loading',
    expected_row_count = EXCLUDED.expected_row_count,
    updated_at = now(),
    cleaned_at = NULL
RETURNING id, batch_code, expected_row_count;

DELETE FROM import_work.place_rows AS r
USING import_work.import_batches AS b
WHERE r.import_batch_id = b.id
  AND b.batch_code = :'batch_code';

INSERT INTO import_work.place_rows (
    import_batch_id,
    source_snapshot_id,
    source_snapshot_version,
    external_id,
    classification,
    target_core_id,
    primary_name,
    display_name,
    category_id,
    admin_area_id,
    point_geom,
    lat,
    lng,
    plus_code,
    importance_score,
    popularity_score,
    confidence_score,
    source_refs,
    source_hash,
    validation_status,
    validation_result
)
SELECT
    b.id,
    4,
    'osm_myanmar_2026_05_15_kyauktan_v2',
    r.external_id,
    r.import_class,
    r.matched_core_id,
    nullif(btrim(r.primary_name), ''),
    nullif(btrim(r.display_name), ''),
    r.category_id,
    r.inferred_admin_area_id,
    r.point_geom,
    r.lat,
    r.lng,
    NULL,
    least(100, greatest(0, coalesce(r.confidence_score, 50))),
    least(100, greatest(0, coalesce(r.confidence_score, 50))),
    least(100, greatest(0, coalesce(r.confidence_score, 50))),
    coalesce(r.source_refs::jsonb, '{}'::jsonb)
        || jsonb_build_object(
            'mapped_category_code', r.mapped_category_code,
            'class_code', r.class_code,
            'source_type_hint', r.source_type_hint,
            'gate', 'kyauktan_places_gate4'
        ),
    nullif(btrim(r.source_hash), ''),
    'passed',
    jsonb_build_object(
        'preload', 'kyauktan_places_preload_and_copy',
        'mapped_category_code', r.mapped_category_code
    )
FROM kyauktan_load_ready AS r
CROSS JOIN import_work.import_batches AS b
WHERE b.batch_code = :'batch_code';

UPDATE import_work.import_batches AS b
SET
    loaded_row_count = (SELECT count(*) FROM import_work.place_rows r WHERE r.import_batch_id = b.id),
    expected_row_count = (SELECT count(*) FROM import_work.place_rows r WHERE r.import_batch_id = b.id),
    status = 'loaded',
    loaded_at = now(),
    updated_at = now(),
    validation_status = 'passed',
    validation_summary = jsonb_build_object(
        'preload_at', now(),
        'source_snapshot_version', 'osm_myanmar_2026_05_15_kyauktan_v2',
        'classified_safe_total', (SELECT count(*) FROM kyauktan_safe_resolved),
        'load_ready_total', (SELECT count(*) FROM kyauktan_load_ready),
        'excluded_in_ir', (SELECT count(*) FROM kyauktan_safe_resolved WHERE in_import_review),
        'excluded_unsupported_category', (SELECT count(*) FROM kyauktan_safe_resolved WHERE category_id IS NULL),
        'safe_new', (SELECT count(*) FROM kyauktan_load_ready WHERE import_class = 'safe_new'),
        'safe_update', (SELECT count(*) FROM kyauktan_load_ready WHERE import_class = 'safe_update')
    )
WHERE b.batch_code = :'batch_code';

SELECT
    'import_work_loaded' AS section,
    b.id AS import_batch_id,
    b.batch_code,
    b.status,
    b.expected_row_count,
    b.loaded_row_count,
    count(*) FILTER (WHERE r.classification = 'safe_new') AS safe_new,
    count(*) FILTER (WHERE r.classification = 'safe_update') AS safe_update,
    count(*) FILTER (WHERE r.point_geom IS NULL OR NOT ST_IsValid(r.point_geom)) AS bad_geom,
    count(*) FILTER (WHERE r.category_id IS NULL) AS null_category,
    count(*) FILTER (
        WHERE r.classification = 'safe_update'
          AND (r.target_core_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM core.core_places p
                WHERE p.id = r.target_core_id AND p.deleted_at IS NULL
          ))
    ) AS bad_target_core,
    count(*) AS actual_rows
FROM import_work.import_batches AS b
LEFT JOIN import_work.place_rows AS r ON r.import_batch_id = b.id
WHERE b.batch_code = :'batch_code'
GROUP BY b.id;

COMMIT;
