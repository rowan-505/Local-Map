-- =============================================================================
-- Bulk promote import_review.road_candidates -> core.core_streets (+ names)
--
-- Resumable chunked promotion: only unpromoted rows per run (ORDER BY id LIMIT).
-- Fast path: midpoint admin assignment; overlap fallback off by default.
-- admin_area_id is optional: valid roads insert with NULL admin when unassigned.
--
-- psql variables:
--   -v review_batch_id=<bigint>           required
--   -v limit_rows=<int>                  chunk size (unpromoted only; empty = no limit)
--   -v dry_run=true                      default true (rollback after report)
--   -v show_progress_counts=false        skip full-batch COUNT(*) each chunk (faster)
--   -v enable_expensive_fallback=false   ward/overlap ST_Intersection fallback (slow)
--
-- Usage examples:
--   # Dry run small sample
--   psql "$SUPABASE_DATABASE_URL" -v review_batch_id=4 -v limit_rows=1000 -v dry_run=true \
--     -f tools/data-pipeline/import-review-bulk-promotion/05_bulk_promote_roads.sql
--
--   # Real 50k chunk (repeat until NO_UNPROMOTED_ROWS_LEFT)
--   psql "$SUPABASE_DATABASE_URL" -v review_batch_id=4 -v limit_rows=50000 -v dry_run=false \
--     -f tools/data-pipeline/import-review-bulk-promotion/05_bulk_promote_roads.sql
--
--   # Loop remaining chunks (bash)
--   while psql "$SUPABASE_DATABASE_URL" -v review_batch_id=4 -v limit_rows=50000 -v dry_run=false \
--     -f tools/data-pipeline/import-review-bulk-promotion/05_bulk_promote_roads.sql 2>&1 | tee -a road_promote.log \
--     | grep -q 'NO_UNPROMOTED_ROWS_LEFT'; do echo "chunk done, next..."; sleep 2; done
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\ir 00_shared_bulk_promotion_helpers.sql

BEGIN;

SELECT set_config('statement_timeout', '0', true);

\ir _psql_road_full_session_reset.sql

CREATE TEMP TABLE bulk_road_promote_params (
    review_batch_id bigint NOT NULL,
    limit_rows int,
    dry_run boolean NOT NULL DEFAULT true,
    show_progress_counts boolean NOT NULL DEFAULT false,
    enable_expensive_fallback boolean NOT NULL DEFAULT false
);

INSERT INTO bulk_road_promote_params (
    review_batch_id,
    limit_rows,
    dry_run,
    show_progress_counts,
    enable_expensive_fallback
)
SELECT
    p.review_batch_id,
    p.limit_rows,
    CASE lower(coalesce(NULLIF(btrim(:'dry_run'), ''), 'true'))
        WHEN 'false' THEN false
        WHEN '0' THEN false
        WHEN 'no' THEN false
        ELSE true
    END,
    CASE lower(coalesce(NULLIF(btrim(:'show_progress_counts'), ''), 'false'))
        WHEN 'true' THEN true
        WHEN '1' THEN true
        WHEN 'yes' THEN true
        ELSE false
    END,
    CASE lower(coalesce(NULLIF(btrim(:'enable_expensive_fallback'), ''), 'false'))
        WHEN 'true' THEN true
        WHEN '1' THEN true
        WHEN 'yes' THEN true
        ELSE false
    END
FROM bulk_promotion_preflight_params AS p;

CREATE TEMP TABLE bulk_road_promote_context (
    review_batch_id bigint NOT NULL,
    limit_rows int,
    dry_run boolean NOT NULL,
    show_progress_counts boolean NOT NULL,
    enable_expensive_fallback boolean NOT NULL,
    osm_source_type_id bigint NOT NULL,
    unknown_road_class_id bigint NOT NULL,
    has_verification_status boolean NOT NULL DEFAULT false
);

INSERT INTO bulk_road_promote_context (
    review_batch_id,
    limit_rows,
    dry_run,
    show_progress_counts,
    enable_expensive_fallback,
    osm_source_type_id,
    unknown_road_class_id,
    has_verification_status
)
SELECT
    pr.review_batch_id,
    pr.limit_rows,
    pr.dry_run,
    pr.show_progress_counts,
    pr.enable_expensive_fallback,
    st.id,
    urc.id,
    EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'verification_status'
    )
FROM bulk_road_promote_params AS pr
CROSS JOIN LATERAL (
    SELECT id
    FROM ref.ref_source_types AS st
    WHERE st.code = 'osm'
    LIMIT 1
) AS st
CROSS JOIN LATERAL (
    SELECT id
    FROM ref.ref_road_classes AS rc
    WHERE rc.code = 'unknown'
    LIMIT 1
) AS urc
WHERE pr.review_batch_id IS NOT NULL;

DO $road_ctx_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM bulk_road_promote_context AS ctx
        WHERE ctx.unknown_road_class_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'ref.ref_road_classes code=unknown is required for road bulk promotion';
    END IF;
END;
$road_ctx_check$;

CREATE TEMP TABLE bulk_road_promote_summary (
    total_batch_count bigint NOT NULL DEFAULT 0,
    already_promoted_before_count bigint NOT NULL DEFAULT 0,
    selected_unpromoted_chunk_count bigint NOT NULL DEFAULT 0,
    remaining_after_count bigint NOT NULL DEFAULT 0,
    eligible_count bigint NOT NULL DEFAULT 0,
    fast_admin_assigned_count bigint NOT NULL DEFAULT 0,
    fallback_admin_assigned_count bigint NOT NULL DEFAULT 0,
    inserted_count bigint NOT NULL DEFAULT 0,
    skipped_existing_external_id bigint NOT NULL DEFAULT 0,
    skipped_invalid_geom bigint NOT NULL DEFAULT 0,
    null_admin_area_warning_count bigint NOT NULL DEFAULT 0,
    skipped_duplicate_or_review bigint NOT NULL DEFAULT 0,
    fallback_unknown_road_class_count bigint NOT NULL DEFAULT 0,
    missing_required_count bigint NOT NULL DEFAULT 0,
    invalid_geom_count bigint NOT NULL DEFAULT 0,
    chunk_promoted_count bigint NOT NULL DEFAULT 0,
    final_promoted_count bigint,
    names_inserted_count bigint NOT NULL DEFAULT 0
);

INSERT INTO bulk_road_promote_summary DEFAULT VALUES;

\ir _psql_road_phase_progress.sql
\ir _psql_road_chunk_progress.sql

\echo '=== Ensure promotion indexes (idempotent, persistent) ==='

CREATE INDEX IF NOT EXISTS irr_road_rbid_pstat_id_idx
    ON import_review.road_candidates (review_batch_id, promotion_status, id);

CREATE INDEX IF NOT EXISTS irr_road_rbid_promoted_core_id_idx
    ON import_review.road_candidates (review_batch_id, promoted_core_id, id);

CREATE INDEX IF NOT EXISTS irr_road_rbid_unpromoted_id_idx
    ON import_review.road_candidates (review_batch_id, id)
    WHERE coalesce(promotion_status, '') IS DISTINCT FROM 'promoted'
      AND promoted_core_id IS NULL;

CREATE INDEX IF NOT EXISTS irr_road_extid_promote_idx
    ON import_review.road_candidates (external_id)
    WHERE external_id IS NOT NULL AND btrim(external_id) <> '';

-- core_streets_external_id_unique_idx is the canonical Core lookup index.
-- Do not recreate the retired non-unique core_streets_external_id_promote_idx.

CREATE INDEX IF NOT EXISTS core_admin_areas_geom_gix
    ON core.core_admin_areas USING gist (geom);

CREATE INDEX IF NOT EXISTS core_admin_areas_centroid_gix
    ON core.core_admin_areas USING gist (centroid)
    WHERE centroid IS NOT NULL
      AND is_active IS TRUE
      AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS core_admin_areas_level_idx
    ON core.core_admin_areas (admin_level_id);

SELECT pg_temp.bulk_road_emit_phase('indexes ensured (road_candidates + admin_areas)');

\echo '=== Select unpromoted chunk into bulk_road_base ==='

SELECT
    p.review_batch_id,
    p.limit_rows AS configured_limit_rows,
    p.show_progress_counts,
    p.enable_expensive_fallback,
    CASE
        WHEN p.limit_rows IS NOT NULL AND p.limit_rows > 0 THEN p.limit_rows
        ELSE NULL::bigint
    END AS effective_row_cap
FROM bulk_road_promote_params AS p;

CREATE TEMP TABLE bulk_road_chunk_stats (
    total_batch_count bigint,
    already_promoted_before_count bigint,
    unpromoted_before_limit_count bigint,
    selected_unpromoted_chunk_count bigint NOT NULL DEFAULT 0,
    remaining_after_count bigint,
    first_candidate_id bigint,
    last_candidate_id bigint
);

INSERT INTO bulk_road_chunk_stats DEFAULT VALUES;

DO $chunk_stats$
DECLARE
    p bulk_road_promote_params%ROWTYPE;
BEGIN
    SELECT * INTO p FROM bulk_road_promote_params;

    IF p.show_progress_counts THEN
        UPDATE bulk_road_chunk_stats AS cs
        SET
            total_batch_count = stats.total_batch_count,
            already_promoted_before_count = stats.already_promoted_before_count,
            unpromoted_before_limit_count = stats.unpromoted_before_limit_count
        FROM (
            SELECT
                count(*)::bigint AS total_batch_count,
                count(*) FILTER (
                    WHERE coalesce(r.promotion_status, '') = 'promoted'
                       OR r.promoted_core_id IS NOT NULL
                )::bigint AS already_promoted_before_count,
                count(*) FILTER (
                    WHERE coalesce(r.promotion_status, '') IS DISTINCT FROM 'promoted'
                      AND r.promoted_core_id IS NULL
                )::bigint AS unpromoted_before_limit_count
            FROM import_review.road_candidates AS r
            WHERE r.review_batch_id = p.review_batch_id
        ) AS stats;

        UPDATE bulk_road_promote_summary AS s
        SET
            total_batch_count = coalesce(cs.total_batch_count, 0),
            already_promoted_before_count = coalesce(cs.already_promoted_before_count, 0)
        FROM bulk_road_chunk_stats AS cs;

        RAISE NOTICE '[05 roads] batch progress: total_batch_count=% already_promoted_before_count=% unpromoted_remaining=% limit_rows=%',
            (SELECT total_batch_count FROM bulk_road_chunk_stats),
            (SELECT already_promoted_before_count FROM bulk_road_chunk_stats),
            (SELECT unpromoted_before_limit_count FROM bulk_road_chunk_stats),
            p.limit_rows;
    ELSE
        RAISE NOTICE '[05 roads] batch progress counts skipped (show_progress_counts=false)';
    END IF;
END;
$chunk_stats$;

\ir _psql_road_promote_session_reset.sql

CREATE TEMP TABLE bulk_road_base AS
SELECT
    r.id AS candidate_id,
    r.external_id,
    r.review_batch_id,
    r.canonical_name,
    r.name_mm,
    r.name_en,
    r.road_class_id,
    r.road_class,
    r.surface,
    r.is_oneway,
    r.bridge,
    r.tunnel,
    r.layer,
    r.source_refs,
    r.normalized_data,
    r.match_status,
    r.auto_action,
    r.promotion_status,
    r.promoted_core_id,
    r.matched_core_id,
    r.geom AS raw_geom,
    nullif(btrim(r.external_id), '') AS external_id_ready,
    nullif(btrim(r.name_mm), '') AS name_mm_ready,
    nullif(btrim(r.name_en), '') AS name_en_ready,
    coalesce(
        nullif(btrim(coalesce(r.canonical_name, r.name_mm, r.name_en)), ''),
        'Unnamed Street'
    ) AS canonical_name_ready,
    coalesce(r.road_class_id, ctx.unknown_road_class_id) AS effective_road_class_id,
    coalesce(
        nullif(btrim(coalesce(r.road_class, r.class_code, 'unknown')), ''),
        'unknown'
    ) AS effective_road_class,
    coalesce(
        nullif(btrim(coalesce(r.road_class, r.class_code, 'unknown')), ''),
        'unknown'
    ) AS road_class_code_ready,
    CASE
        WHEN r.geom IS NULL THEN NULL::geometry(LineString, 4326)
        WHEN st_geometrytype(r.geom) = 'ST_LineString'
            THEN r.geom::geometry(LineString, 4326)
        ELSE NULL::geometry(LineString, 4326)
    END AS geom_ready,
    coalesce(
        CASE WHEN r.source_refs ? 'tags' THEN r.source_refs->'tags' END,
        r.source_refs
    ) AS source_tags_ready,
    coalesce(r.source_refs, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
        'review_candidate_id', r.id::text,
        'review_batch_id', r.review_batch_id::text,
        'entity_family', 'roads',
        'promotion_path', 'tools/data-pipeline/import-review-bulk-promotion/05_bulk_promote_roads.sql'
    )) AS merged_source_refs,
    coalesce(r.normalized_data, '{}'::jsonb) AS normalized_data_ready,
    NULL::text AS existing_core_external_id,
    NULL::geometry(Point, 4326) AS rep_point,
    NULL::geometry AS geom_bbox,
    CASE
        WHEN r.matched_core_id IS NOT NULL
            THEN 'existing_matched'
        WHEN coalesce(r.match_status, '') IN (
            'duplicate_candidate', 'possible_duplicate', 'needs_review'
        )
            THEN 'duplicate_or_review'
        WHEN coalesce(r.match_status, '') IS DISTINCT FROM 'new_auto'
            THEN 'duplicate_or_review'
        WHEN coalesce(r.auto_action, '') IS DISTINCT FROM 'insert_candidate'
            THEN 'duplicate_or_review'
        WHEN nullif(btrim(r.external_id), '') IS NULL
            THEN 'missing_required'
        WHEN r.geom IS NULL
            OR NOT st_isvalid(r.geom)
            OR st_isempty(r.geom)
            OR st_srid(r.geom) IS DISTINCT FROM 4326
            OR upper(st_geometrytype(r.geom)) NOT IN ('ST_LINESTRING', 'ST_MULTILINESTRING')
            THEN 'invalid_geom'
        WHEN EXISTS (
            SELECT 1
            FROM core.core_streets AS c
            WHERE c.external_id = nullif(btrim(r.external_id), '')
              AND btrim(c.external_id) <> ''
              AND coalesce(c.is_active, true)
              AND c.deleted_at IS NULL
        )
            THEN 'existing_external_id'
        ELSE NULL
    END AS precheck_skip_reason
FROM import_review.road_candidates AS r
INNER JOIN bulk_road_promote_params AS p ON p.review_batch_id = r.review_batch_id
CROSS JOIN bulk_road_promote_context AS ctx
WHERE r.review_batch_id = p.review_batch_id
  AND coalesce(r.promotion_status, '') IS DISTINCT FROM 'promoted'
  AND r.promoted_core_id IS NULL
ORDER BY r.id ASC
LIMIT (
    SELECT CASE
        WHEN pr.limit_rows IS NOT NULL AND pr.limit_rows > 0 THEN pr.limit_rows
    END
    FROM bulk_road_promote_params AS pr
);

UPDATE bulk_road_chunk_stats AS cs
SET
    selected_unpromoted_chunk_count = (SELECT count(*)::bigint FROM bulk_road_base),
    first_candidate_id = (SELECT min(b.candidate_id) FROM bulk_road_base AS b),
    last_candidate_id = (SELECT max(b.candidate_id) FROM bulk_road_base AS b),
    remaining_after_count = CASE
        WHEN cs.unpromoted_before_limit_count IS NOT NULL THEN
            cs.unpromoted_before_limit_count - (SELECT count(*)::bigint FROM bulk_road_base)
    END;

UPDATE bulk_road_promote_summary AS s
SET
    selected_unpromoted_chunk_count = cs.selected_unpromoted_chunk_count,
    remaining_after_count = coalesce(cs.remaining_after_count, 0)
FROM bulk_road_chunk_stats AS cs;

DO $chunk_selected$
DECLARE
    cs bulk_road_chunk_stats%ROWTYPE;
    p bulk_road_promote_params%ROWTYPE;
BEGIN
    SELECT * INTO cs FROM bulk_road_chunk_stats;
    SELECT * INTO p FROM bulk_road_promote_params;

    RAISE NOTICE '[05 roads] chunk selected: selected_unpromoted_chunk_count=% first_candidate_id=% last_candidate_id=%',
        cs.selected_unpromoted_chunk_count, cs.first_candidate_id, cs.last_candidate_id;

    IF p.show_progress_counts AND cs.remaining_after_count IS NOT NULL THEN
        RAISE NOTICE '[05 roads] estimated remaining after chunk: remaining_after_count=%',
            cs.remaining_after_count;
    END IF;
END;
$chunk_selected$;

\echo ''
\echo '=== bulk road chunk (after unpromoted filter + limit) ==='

SELECT
    cs.selected_unpromoted_chunk_count,
    cs.first_candidate_id,
    cs.last_candidate_id,
    cs.total_batch_count,
    cs.already_promoted_before_count,
    cs.remaining_after_count,
    p.limit_rows AS configured_limit_rows,
    p.show_progress_counts
FROM bulk_road_chunk_stats AS cs
CROSS JOIN bulk_road_promote_params AS p;

SELECT (SELECT selected_unpromoted_chunk_count FROM bulk_road_chunk_stats LIMIT 1) AS bulk_road_chunk_count \gset

\if :bulk_road_chunk_count = 0
\echo 'NO_UNPROMOTED_ROWS_LEFT'

UPDATE bulk_road_promote_summary AS s
SET
    eligible_count = 0,
    inserted_count = 0,
    chunk_promoted_count = 0,
    names_inserted_count = 0;

\timing off

\echo ''
\echo '=== bulk road promote summary (empty chunk) ==='

SELECT
    s.selected_unpromoted_chunk_count,
    s.total_batch_count,
    s.already_promoted_before_count,
    s.remaining_after_count,
    s.eligible_count,
    s.inserted_count,
    s.chunk_promoted_count,
    p.dry_run
FROM bulk_road_promote_summary AS s
CROSS JOIN bulk_road_promote_params AS p;

\ir _psql_dry_run_commit.sql
\else

SELECT pg_temp.bulk_road_phase_done(
    'bulk_road_base staged (cheap precheck)',
    (SELECT count(*)::bigint FROM bulk_road_base),
    coalesce(
        (SELECT CASE
            WHEN pr.limit_rows IS NOT NULL AND pr.limit_rows > 0 THEN pr.limit_rows::bigint
         END
         FROM bulk_road_promote_params AS pr),
        (SELECT count(*)::bigint FROM bulk_road_base)
    ),
    format(
        'limit_rows=%s selected_unpromoted_chunk=%s remaining_after=%s skipped_precheck=%s pending_geom=%s',
        (SELECT limit_rows FROM bulk_road_promote_params),
        (SELECT selected_unpromoted_chunk_count FROM bulk_road_chunk_stats),
        (SELECT remaining_after_count FROM bulk_road_chunk_stats),
        (SELECT count(*) FROM bulk_road_base WHERE precheck_skip_reason IS NOT NULL),
        (SELECT count(*) FROM bulk_road_base WHERE precheck_skip_reason IS NULL)
    )
);

UPDATE bulk_road_base AS b
SET geom_ready = picked.geom_ready
FROM (
    SELECT DISTINCT ON (b.candidate_id)
        b.candidate_id,
        (dp).geom::geometry(LineString, 4326) AS geom_ready
    FROM bulk_road_base AS b
    CROSS JOIN LATERAL st_dump(b.raw_geom) AS dp
    WHERE b.precheck_skip_reason IS NULL
      AND st_geometrytype(b.raw_geom) = 'ST_MultiLineString'
    ORDER BY b.candidate_id, st_length((dp).geom::geography) DESC NULLS LAST
) AS picked
WHERE b.candidate_id = picked.candidate_id;

SELECT pg_temp.bulk_road_phase_done(
    'multilinestring geom_ready resolved',
    (SELECT count(*)::bigint FROM bulk_road_base WHERE precheck_skip_reason IS NULL AND geom_ready IS NOT NULL),
    (SELECT count(*)::bigint FROM bulk_road_base WHERE precheck_skip_reason IS NULL)
);

UPDATE bulk_road_base AS b
SET precheck_skip_reason = 'invalid_geom'
WHERE b.precheck_skip_reason IS NULL
  AND (
      b.geom_ready IS NULL
      OR NOT st_isvalid(b.geom_ready)
      OR st_isempty(b.geom_ready)
      OR st_srid(b.geom_ready) IS DISTINCT FROM 4326
      OR upper(st_geometrytype(b.geom_ready)) <> 'ST_LINESTRING'
  );

UPDATE bulk_road_base AS b
SET
    rep_point = st_lineinterpolatepoint(b.geom_ready, 0.5)::geometry(Point, 4326),
    geom_bbox = st_setsrid(
        st_makeenvelope(
            st_xmin(b.geom_ready),
            st_ymin(b.geom_ready),
            st_xmax(b.geom_ready),
            st_ymax(b.geom_ready)
        ),
        4326
    )
WHERE b.precheck_skip_reason IS NULL
  AND b.geom_ready IS NOT NULL;

UPDATE bulk_road_base AS b
SET precheck_skip_reason = 'invalid_geom'
WHERE b.precheck_skip_reason IS NULL
  AND (
      b.rep_point IS NULL
      OR NOT st_isvalid(b.rep_point)
  );

SELECT pg_temp.bulk_road_phase_done(
    'rep_point + geom_bbox on assignable candidates',
    (SELECT count(*)::bigint FROM bulk_road_base WHERE precheck_skip_reason IS NULL AND rep_point IS NOT NULL),
    (SELECT count(*)::bigint FROM bulk_road_base WHERE precheck_skip_reason IS NULL)
);

DO $geom_prepared$
DECLARE
    v_prepared bigint;
    v_skipped bigint;
BEGIN
    SELECT count(*)::bigint INTO v_prepared
    FROM bulk_road_base AS b
    WHERE b.precheck_skip_reason IS NULL AND b.geom_ready IS NOT NULL;

    SELECT count(*)::bigint INTO v_skipped
    FROM bulk_road_base AS b
    WHERE b.precheck_skip_reason IS NOT NULL;

    RAISE NOTICE '[05 roads] geometry prepared: prepared_count=% skipped_precheck_count=%',
        v_prepared, v_skipped;
END;
$geom_prepared$;

CREATE TEMP TABLE bulk_road_assignable AS
SELECT b.*
FROM bulk_road_base AS b
WHERE b.precheck_skip_reason IS NULL;

CREATE INDEX bulk_road_base_geom_gix ON bulk_road_base USING gist (geom_ready)
    WHERE geom_ready IS NOT NULL;
CREATE INDEX bulk_road_base_rep_point_gix ON bulk_road_base USING gist (rep_point)
    WHERE rep_point IS NOT NULL;
CREATE INDEX bulk_road_base_geom_bbox_gix ON bulk_road_base USING gist (geom_bbox)
    WHERE geom_bbox IS NOT NULL;
CREATE INDEX bulk_road_base_external_id_idx ON bulk_road_base (external_id_ready);
CREATE INDEX bulk_road_base_precheck_idx ON bulk_road_base (precheck_skip_reason);

CREATE INDEX bulk_road_assignable_geom_gix ON bulk_road_assignable USING gist (geom_ready);
CREATE INDEX bulk_road_assignable_rep_point_gix ON bulk_road_assignable USING gist (rep_point);
CREATE INDEX bulk_road_assignable_cand_idx ON bulk_road_assignable (candidate_id);

ANALYZE bulk_road_base;
ANALYZE bulk_road_assignable;

SELECT pg_temp.bulk_road_phase_done(
    'bulk_road_base loaded',
    (SELECT count(*)::bigint FROM bulk_road_base),
    (SELECT count(*)::bigint FROM bulk_road_base),
    format(
        'assignable=%s skipped_precheck=%s',
        (SELECT count(*)::bigint FROM bulk_road_assignable),
        (SELECT count(*)::bigint FROM bulk_road_base WHERE precheck_skip_reason IS NOT NULL)
    )
);

\echo '=== Build admin assignment candidates ==='

CREATE TEMP TABLE bulk_admin_assignment_candidates AS
SELECT
    a.id AS admin_area_id,
    a.admin_level_id,
    lower(trim(coalesce(al.code, ''))) AS admin_level_code,
    coalesce(al.rank::integer, 99) AS admin_rank,
    CASE lower(trim(coalesce(al.code, '')))
        WHEN 'township' THEN 1
        WHEN 'town' THEN 1
        WHEN 'city' THEN 1
        WHEN 'district' THEN 2
        WHEN 'state_region' THEN 3
        WHEN 'state' THEN 3
        WHEN 'division' THEN 3
        WHEN 'region' THEN 3
        WHEN 'ward_village_tract' THEN 4
        WHEN 'ward' THEN 4
        WHEN 'suburb' THEN 4
        WHEN 'quarter' THEN 4
        WHEN 'village_tract' THEN 4
        WHEN 'village' THEN 4
        WHEN 'hamlet' THEN 4
        WHEN 'neighbourhood' THEN 4
        WHEN 'country' THEN 99
        ELSE 50
    END AS level_preference,
    a.geom,
    st_area(a.geom::geography) AS area_m2
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
WHERE coalesce(a.is_active, true) IS TRUE
  AND a.deleted_at IS NULL
  AND a.geom IS NOT NULL
  AND NOT st_isempty(a.geom)
  AND st_isvalid(a.geom);

CREATE INDEX bulk_admin_assign_geom_gix ON bulk_admin_assignment_candidates USING gist (geom);
CREATE INDEX bulk_admin_assign_level_pref_idx ON bulk_admin_assignment_candidates (level_preference);
CREATE INDEX bulk_admin_assign_area_idx ON bulk_admin_assignment_candidates (area_m2);
CREATE INDEX bulk_admin_assign_fast_geom_gix ON bulk_admin_assignment_candidates USING gist (geom)
    WHERE level_preference BETWEEN 1 AND 3;
CREATE INDEX bulk_admin_assign_ward_geom_gix ON bulk_admin_assignment_candidates USING gist (geom)
    WHERE level_preference = 4;

ANALYZE bulk_admin_assignment_candidates;

SELECT pg_temp.bulk_road_phase_done(
    'admin assignment candidates',
    (SELECT count(*)::bigint FROM bulk_admin_assignment_candidates),
    (SELECT count(*)::bigint FROM bulk_admin_assignment_candidates),
    format(
        'township+=%s district=%s state=%s ward=%s',
        (SELECT count(*) FROM bulk_admin_assignment_candidates WHERE level_preference = 1),
        (SELECT count(*) FROM bulk_admin_assignment_candidates WHERE level_preference = 2),
        (SELECT count(*) FROM bulk_admin_assignment_candidates WHERE level_preference = 3),
        (SELECT count(*) FROM bulk_admin_assignment_candidates WHERE level_preference = 4)
    )
);

\echo '=== Fast admin assignment (midpoint containment: township > district > state_region) ==='

CREATE TEMP TABLE bulk_road_admin_fast AS
SELECT
    b.candidate_id,
    pick.admin_area_id AS calculated_admin_area_id,
    'midpoint_contains'::text AS assign_method
FROM bulk_road_assignable AS b
CROSS JOIN LATERAL (
    SELECT aa.admin_area_id
    FROM bulk_admin_assignment_candidates AS aa
    WHERE aa.level_preference BETWEEN 1 AND 3
      AND b.rep_point IS NOT NULL
      AND aa.geom && b.rep_point
      AND st_covers(aa.geom, b.rep_point)
    ORDER BY aa.level_preference ASC, aa.area_m2 ASC NULLS LAST, aa.admin_area_id ASC
    LIMIT 1
) AS pick;

CREATE UNIQUE INDEX bulk_road_admin_fast_cand_uidx ON bulk_road_admin_fast (candidate_id);

ANALYZE bulk_road_admin_fast;

SELECT pg_temp.bulk_road_phase_done(
    'fast admin assignment (midpoint)',
    (SELECT count(*)::bigint FROM bulk_road_admin_fast),
    (SELECT count(*)::bigint FROM bulk_road_assignable),
    format(
        'still_unresolved=%s',
        (SELECT count(*)::bigint FROM bulk_road_assignable AS b
         WHERE NOT EXISTS (
             SELECT 1 FROM bulk_road_admin_fast AS f WHERE f.candidate_id = b.candidate_id
         ))
    )
);

\if :enable_expensive_fallback
\echo '=== Fallback admin assignment (expensive: ward + line overlap + country) ==='

CREATE TEMP TABLE bulk_road_admin_fallback_ward AS
SELECT
    b.candidate_id,
    pick.admin_area_id AS calculated_admin_area_id,
    'midpoint_contains_ward'::text AS assign_method
FROM bulk_road_assignable AS b
LEFT JOIN bulk_road_admin_fast AS f ON f.candidate_id = b.candidate_id
CROSS JOIN LATERAL (
    SELECT aa.admin_area_id
    FROM bulk_admin_assignment_candidates AS aa
    WHERE f.candidate_id IS NULL
      AND b.rep_point IS NOT NULL
      AND aa.level_preference = 4
      AND aa.geom && b.rep_point
      AND st_covers(aa.geom, b.rep_point)
    ORDER BY aa.area_m2 ASC NULLS LAST, aa.admin_area_id ASC
    LIMIT 1
) AS pick
WHERE f.candidate_id IS NULL;

CREATE UNIQUE INDEX bulk_road_admin_fallback_ward_cand_uidx
    ON bulk_road_admin_fallback_ward (candidate_id);

CREATE TEMP TABLE bulk_road_admin_fallback_overlap AS
SELECT
    b.candidate_id,
    pick.admin_area_id AS calculated_admin_area_id,
    'line_overlap'::text AS assign_method
FROM bulk_road_assignable AS b
LEFT JOIN bulk_road_admin_fast AS f ON f.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_ward AS w ON w.candidate_id = b.candidate_id
CROSS JOIN LATERAL (
    SELECT
        aa.admin_area_id,
        x.overlap_m
    FROM bulk_admin_assignment_candidates AS aa
    CROSS JOIN LATERAL (
        SELECT st_length(st_intersection(b.geom_ready, aa.geom)::geography) AS overlap_m
    ) AS x
    WHERE f.candidate_id IS NULL
      AND w.candidate_id IS NULL
      AND b.geom_ready IS NOT NULL
      AND aa.level_preference BETWEEN 1 AND 4
      AND aa.geom && b.geom_ready
      AND st_intersects(aa.geom, b.geom_ready)
      AND x.overlap_m > 0
    ORDER BY
        aa.level_preference ASC,
        x.overlap_m DESC NULLS LAST,
        aa.area_m2 ASC NULLS LAST,
        aa.admin_area_id ASC
    LIMIT 1
) AS pick
WHERE f.candidate_id IS NULL
  AND w.candidate_id IS NULL;

CREATE UNIQUE INDEX bulk_road_admin_fallback_overlap_cand_uidx
    ON bulk_road_admin_fallback_overlap (candidate_id);

CREATE TEMP TABLE bulk_road_admin_fallback_country AS
SELECT
    b.candidate_id,
    pick.admin_area_id AS calculated_admin_area_id,
    'country_fallback'::text AS assign_method
FROM bulk_road_assignable AS b
LEFT JOIN bulk_road_admin_fast AS f ON f.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_ward AS w ON w.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_overlap AS o ON o.candidate_id = b.candidate_id
CROSS JOIN LATERAL (
    SELECT aa.admin_area_id
    FROM bulk_admin_assignment_candidates AS aa
    WHERE aa.level_preference = 99
      AND b.geom_ready IS NOT NULL
      AND aa.geom && b.geom_ready
      AND st_intersects(aa.geom, b.geom_ready)
    ORDER BY aa.area_m2 ASC NULLS LAST, aa.admin_area_id ASC
    LIMIT 1
) AS pick
WHERE f.candidate_id IS NULL
  AND w.candidate_id IS NULL
  AND o.candidate_id IS NULL;

CREATE UNIQUE INDEX bulk_road_admin_fallback_country_cand_uidx
    ON bulk_road_admin_fallback_country (candidate_id);

CREATE TEMP TABLE bulk_road_admin_assignment AS
SELECT
    b.candidate_id,
    coalesce(
        f.calculated_admin_area_id,
        w.calculated_admin_area_id,
        o.calculated_admin_area_id,
        c.calculated_admin_area_id
    ) AS calculated_admin_area_id,
    coalesce(
        f.assign_method,
        w.assign_method,
        o.assign_method,
        c.assign_method
    ) AS assign_method
FROM bulk_road_assignable AS b
LEFT JOIN bulk_road_admin_fast AS f ON f.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_ward AS w ON w.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_overlap AS o ON o.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_country AS c ON c.candidate_id = b.candidate_id;

CREATE UNIQUE INDEX bulk_road_admin_assignment_cand_uidx ON bulk_road_admin_assignment (candidate_id);

SELECT pg_temp.bulk_road_phase_done(
    'fallback admin assignment (ward + overlap + country)',
    (
        SELECT count(*)::bigint
        FROM bulk_road_admin_assignment AS a
        WHERE a.calculated_admin_area_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM bulk_road_admin_fast AS f WHERE f.candidate_id = a.candidate_id
          )
    ),
    (SELECT count(*)::bigint FROM bulk_road_assignable),
    format(
        'ward=%s overlap=%s country=%s total_assigned=%s null_admin=%s',
        (SELECT count(*) FROM bulk_road_admin_fallback_ward),
        (SELECT count(*) FROM bulk_road_admin_fallback_overlap),
        (SELECT count(*) FROM bulk_road_admin_fallback_country),
        (SELECT count(*) FROM bulk_road_admin_assignment WHERE calculated_admin_area_id IS NOT NULL),
        (SELECT count(*) FROM bulk_road_admin_assignment WHERE calculated_admin_area_id IS NULL)
    )
);

\else
\echo '=== Fallback admin assignment (fast: district/state/country midpoint only) ==='

CREATE TEMP TABLE bulk_road_admin_fallback_simple AS
SELECT
    b.candidate_id,
    pick.admin_area_id AS calculated_admin_area_id,
    'midpoint_contains_fallback'::text AS assign_method
FROM bulk_road_assignable AS b
LEFT JOIN bulk_road_admin_fast AS f ON f.candidate_id = b.candidate_id
CROSS JOIN LATERAL (
    SELECT aa.admin_area_id
    FROM bulk_admin_assignment_candidates AS aa
    WHERE f.candidate_id IS NULL
      AND b.rep_point IS NOT NULL
      AND aa.level_preference IN (2, 3, 99)
      AND aa.geom && b.rep_point
      AND st_covers(aa.geom, b.rep_point)
    ORDER BY aa.level_preference ASC, aa.area_m2 ASC NULLS LAST, aa.admin_area_id ASC
    LIMIT 1
) AS pick
WHERE f.candidate_id IS NULL;

CREATE UNIQUE INDEX bulk_road_admin_fallback_simple_cand_uidx
    ON bulk_road_admin_fallback_simple (candidate_id);

CREATE TEMP TABLE bulk_road_admin_assignment AS
SELECT
    b.candidate_id,
    coalesce(f.calculated_admin_area_id, s.calculated_admin_area_id) AS calculated_admin_area_id,
    coalesce(f.assign_method, s.assign_method) AS assign_method
FROM bulk_road_assignable AS b
LEFT JOIN bulk_road_admin_fast AS f ON f.candidate_id = b.candidate_id
LEFT JOIN bulk_road_admin_fallback_simple AS s ON s.candidate_id = b.candidate_id;

CREATE UNIQUE INDEX bulk_road_admin_assignment_cand_uidx ON bulk_road_admin_assignment (candidate_id);

\endif

DO $admin_assigned$
DECLARE
    v_assigned bigint;
    v_null_admin bigint;
BEGIN
    SELECT count(*)::bigint INTO v_assigned
    FROM bulk_road_admin_assignment AS a
    WHERE a.calculated_admin_area_id IS NOT NULL;

    SELECT count(*)::bigint INTO v_null_admin
    FROM bulk_road_admin_assignment AS a
    WHERE a.calculated_admin_area_id IS NULL;

    RAISE NOTICE '[05 roads] admin assigned: assigned_count=% null_admin_count=%',
        v_assigned, v_null_admin;
END;
$admin_assigned$;

\echo '=== Classify roads (final skip_reason) ==='

CREATE TEMP TABLE bulk_road_classified AS
SELECT
    b.*,
    a.calculated_admin_area_id,
    a.assign_method,
    CASE
        WHEN b.precheck_skip_reason IS NOT NULL
            THEN b.precheck_skip_reason
        ELSE NULL
    END AS skip_reason
FROM bulk_road_base AS b
LEFT JOIN bulk_road_admin_assignment AS a ON a.candidate_id = b.candidate_id;

CREATE INDEX bulk_road_classified_skip_idx ON bulk_road_classified (skip_reason);
CREATE INDEX bulk_road_classified_cand_idx ON bulk_road_classified (candidate_id);

ANALYZE bulk_road_classified;

UPDATE bulk_road_promote_summary AS s
SET
    fast_admin_assigned_count = (SELECT count(*)::bigint FROM bulk_road_admin_fast),
    fallback_admin_assigned_count = (
        SELECT count(*)::bigint
        FROM bulk_road_admin_assignment AS a
        WHERE a.calculated_admin_area_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM bulk_road_admin_fast AS f
              WHERE f.candidate_id = a.candidate_id
          )
    ),
    skipped_existing_external_id = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.skip_reason = 'existing_external_id'
    ),
    skipped_invalid_geom = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.skip_reason = 'invalid_geom'
    ),
    missing_required_count = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.skip_reason = 'missing_required'
    ),
    invalid_geom_count = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.skip_reason = 'invalid_geom'
    ),
    fallback_unknown_road_class_count = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.road_class_id IS NULL
          AND c.skip_reason IS NULL
    ),
    null_admin_area_warning_count = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.skip_reason IS NULL
          AND c.calculated_admin_area_id IS NULL
    ),
    skipped_duplicate_or_review = (
        SELECT count(*)::bigint
        FROM bulk_road_classified AS c
        WHERE c.skip_reason IN (
            'existing_matched',
            'duplicate_or_review'
        )
    );

CREATE TEMP TABLE bulk_road_ready AS
SELECT c.*
FROM bulk_road_classified AS c
WHERE c.skip_reason IS NULL
ORDER BY c.candidate_id;

CREATE INDEX bulk_road_ready_cand_idx ON bulk_road_ready (candidate_id);
CREATE INDEX bulk_road_ready_ext_idx ON bulk_road_ready (external_id_ready);

ANALYZE bulk_road_ready;

UPDATE bulk_road_promote_summary AS s
SET eligible_count = (SELECT count(*)::bigint FROM bulk_road_ready);

SELECT pg_temp.bulk_road_phase_done(
    'classification + ready queue',
    (SELECT count(*)::bigint FROM bulk_road_ready),
    (SELECT count(*)::bigint FROM bulk_road_classified),
    format(
        'eligible_pct_of_batch=%s%% null_admin_area_warning_count=%s',
        round(
            100.0 * (SELECT count(*) FROM bulk_road_ready)::numeric
                / NULLIF((SELECT count(*) FROM bulk_road_classified), 0)::numeric,
            2
        )::text,
        (SELECT null_admin_area_warning_count FROM bulk_road_promote_summary)
    )
);

DO $ready_queue$
DECLARE
    v_ready bigint;
    v_skipped bigint;
BEGIN
    SELECT count(*)::bigint INTO v_ready FROM bulk_road_ready;
    SELECT count(*)::bigint INTO v_skipped
    FROM bulk_road_classified AS c
    WHERE c.skip_reason IS NOT NULL;

    RAISE NOTICE '[05 roads] ready queue: ready_count=% skipped_count=%',
        v_ready, v_skipped;
END;
$ready_queue$;

DO $bulk_road$
DECLARE
    ctx bulk_road_promote_context%ROWTYPE;
    v_names_inserted bigint := 0;
    v_verification_col text := '';
    v_verification_val text := '';
    rec record;
BEGIN
    SELECT * INTO ctx FROM bulk_road_promote_context;

    IF ctx.review_batch_id IS NULL THEN
        RAISE EXCEPTION 'review_batch_id is required (psql -v review_batch_id=...)';
    END IF;
    IF ctx.osm_source_type_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_source_types code=osm is required';
    END IF;
    IF ctx.unknown_road_class_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_road_classes code=unknown is required';
    END IF;

    IF ctx.has_verification_status THEN
        v_verification_col := ', verification_status';
        v_verification_val := ', ''unverified''::text';
    END IF;

    EXECUTE format(
        $ins$
        CREATE TEMP TABLE bulk_road_inserted ON COMMIT DROP AS
        WITH ins AS (
            INSERT INTO core.core_streets (
                public_id,
                canonical_name,
                geom,
                admin_area_id,
                source_type_id,
                is_active,
                road_class_id,
                road_class,
                surface,
                travel_direction,
                bridge,
                tunnel,
                layer,
                source_tags,
                external_id,
                source_refs,
                normalized_data,
                manual_override
                %s,
                created_at,
                updated_at,
                last_edited_at
            )
            SELECT
                gen_random_uuid(),
                r.canonical_name_ready,
                r.geom_ready,
                r.calculated_admin_area_id,
                $1::bigint,
                true,
                r.effective_road_class_id,
                r.effective_road_class,
                nullif(btrim(coalesce(r.surface, '')), ''),
                CASE WHEN coalesce(r.is_oneway, false) THEN 'forward' ELSE NULL END,
                coalesce(r.bridge, false),
                coalesce(r.tunnel, false),
                coalesce(r.layer, 0),
                r.source_tags_ready,
                r.external_id_ready,
                r.merged_source_refs,
                r.normalized_data_ready,
                false
                %s,
                now(),
                now(),
                now()
            FROM bulk_road_ready AS r
            ORDER BY r.candidate_id
            ON CONFLICT (external_id) WHERE external_id IS NOT NULL
            DO NOTHING
            RETURNING id, external_id
        )
        SELECT
            ready.candidate_id,
            ins.id AS core_street_id,
            ins.external_id,
            ready.canonical_name_ready
        FROM ins
        INNER JOIN bulk_road_ready AS ready
            ON ready.external_id_ready = ins.external_id
        $ins$,
        v_verification_col,
        v_verification_val
    ) USING ctx.osm_source_type_id;

    UPDATE bulk_road_promote_summary
    SET
        inserted_count = (SELECT count(*)::bigint FROM bulk_road_inserted),
        chunk_promoted_count = (SELECT count(*)::bigint FROM bulk_road_inserted);

    INSERT INTO core.core_street_names (
        street_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary
    )
    SELECT
        n.street_id,
        n.name,
        n.language_code,
        n.script_code,
        'primary',
        n.is_primary
    FROM (
        SELECT
            i.core_street_id AS street_id,
            r.name_mm_ready AS name,
            'my'::text AS language_code,
            'Mymr'::text AS script_code,
            true AS is_primary
        FROM bulk_road_inserted AS i
        INNER JOIN bulk_road_classified AS r ON r.candidate_id = i.candidate_id
        WHERE r.name_mm_ready IS NOT NULL

        UNION ALL

        SELECT
            i.core_street_id,
            r.name_en_ready,
            'en',
            'Latn',
            CASE WHEN r.name_mm_ready IS NULL THEN true ELSE false END
        FROM bulk_road_inserted AS i
        INNER JOIN bulk_road_classified AS r ON r.candidate_id = i.candidate_id
        WHERE r.name_en_ready IS NOT NULL

        UNION ALL

        SELECT
            i.core_street_id,
            nullif(btrim(r.canonical_name), '') AS name,
            'und',
            NULL::text,
            CASE
                WHEN r.name_mm_ready IS NULL AND r.name_en_ready IS NULL THEN true
                ELSE false
            END
        FROM bulk_road_inserted AS i
        INNER JOIN bulk_road_classified AS r ON r.candidate_id = i.candidate_id
        WHERE nullif(btrim(r.canonical_name), '') IS NOT NULL
          AND nullif(btrim(r.canonical_name), '') <> 'Unnamed Street'
    ) AS n
    WHERE n.name IS NOT NULL
      AND btrim(n.name) <> ''
      AND NOT EXISTS (
          SELECT 1
          FROM core.core_street_names AS existing
          WHERE existing.street_id = n.street_id
            AND lower(btrim(existing.name)) = lower(btrim(n.name))
            AND coalesce(existing.language_code, '') = coalesce(n.language_code, '')
      );

    GET DIAGNOSTICS v_names_inserted = ROW_COUNT;
    UPDATE bulk_road_promote_summary
    SET names_inserted_count = v_names_inserted;

    UPDATE import_review.road_candidates AS rc
    SET
        promotion_status = 'promoted',
        promoted_core_id = i.core_street_id,
        promoted_at = now(),
        promoted_by = NULL,
        updated_at = now()
    FROM bulk_road_inserted AS i
    WHERE rc.id = i.candidate_id
      AND coalesce(rc.promotion_status, '') IS DISTINCT FROM 'promoted';

    UPDATE import_review.road_candidates AS rc
    SET
        promotion_status = 'skipped',
        updated_at = now()
    FROM bulk_road_classified AS c
    WHERE rc.id = c.candidate_id
      AND c.skip_reason IS NOT NULL
      AND coalesce(rc.promotion_status, '') IS DISTINCT FROM 'promoted';

    IF ctx.show_progress_counts THEN
        UPDATE bulk_road_promote_summary
        SET final_promoted_count = (
            SELECT count(*)::bigint
            FROM import_review.road_candidates AS rc
            WHERE rc.review_batch_id = ctx.review_batch_id
              AND coalesce(rc.promotion_status, '') = 'promoted'
        );
    END IF;

    RAISE NOTICE '[05 roads] inserted/promoted: inserted_count=% chunk_promoted_count=% null_admin_area_warning_count=% names_inserted_count=%',
        (SELECT inserted_count FROM bulk_road_promote_summary),
        (SELECT chunk_promoted_count FROM bulk_road_promote_summary),
        (SELECT null_admin_area_warning_count FROM bulk_road_promote_summary),
        (SELECT names_inserted_count FROM bulk_road_promote_summary);

    IF ctx.show_progress_counts THEN
        RAISE NOTICE '[05 roads] batch promoted total (exact count): final_promoted_count=%',
            (SELECT final_promoted_count FROM bulk_road_promote_summary);
    END IF;

    PERFORM pg_temp.bulk_road_phase_done(
        'core insert + candidate promotion',
        (SELECT inserted_count FROM bulk_road_promote_summary),
        (SELECT eligible_count FROM bulk_road_promote_summary),
        format(
            'inserted_pct_of_eligible=%s%% names=%s chunk_promoted_count=%s final_promoted_in_batch=%s',
            round(
                100.0 * (SELECT inserted_count FROM bulk_road_promote_summary)::numeric
                    / NULLIF((SELECT eligible_count FROM bulk_road_promote_summary), 0)::numeric,
                2
            )::text,
            (SELECT names_inserted_count FROM bulk_road_promote_summary),
            (SELECT chunk_promoted_count FROM bulk_road_promote_summary),
            (SELECT final_promoted_count FROM bulk_road_promote_summary)
        )
    );

    RAISE NOTICE '--- bulk road promote summary ---';
    FOR rec IN SELECT * FROM bulk_road_promote_summary LOOP
        RAISE NOTICE 'review_batch_id=% dry_run=% limit=% osm_source_type_id=% unknown_road_class_id=%',
            ctx.review_batch_id, ctx.dry_run, ctx.limit_rows, ctx.osm_source_type_id,
            ctx.unknown_road_class_id;
        RAISE NOTICE 'total_batch=% already_promoted_before=% selected_chunk=% remaining_after=%',
            rec.total_batch_count, rec.already_promoted_before_count,
            rec.selected_unpromoted_chunk_count, rec.remaining_after_count;
        RAISE NOTICE 'eligible=% fast_admin=% fallback_admin=% inserted=%',
            rec.eligible_count, rec.fast_admin_assigned_count,
            rec.fallback_admin_assigned_count, rec.inserted_count;
        RAISE NOTICE 'fallback_unknown_road_class=% missing_required=% invalid_geom=% skipped_existing_external_id=% null_admin_area_warning_count=% skipped_duplicate_or_review=%',
            rec.fallback_unknown_road_class_count, rec.missing_required_count,
            rec.invalid_geom_count, rec.skipped_existing_external_id,
            rec.null_admin_area_warning_count, rec.skipped_duplicate_or_review;
        RAISE NOTICE 'names=% chunk_promoted_count=% final_promoted_in_batch=%',
            rec.names_inserted_count, rec.chunk_promoted_count, rec.final_promoted_count;
    END LOOP;
END;
$bulk_road$;

\timing off

\echo ''
\echo '=== bulk road promote summary ==='

SELECT
    s.total_batch_count,
    s.already_promoted_before_count,
    s.selected_unpromoted_chunk_count,
    s.remaining_after_count,
    s.eligible_count,
    round(
        100.0 * s.eligible_count::numeric
        / NULLIF(s.selected_unpromoted_chunk_count, 0)::numeric,
        2
    ) AS eligible_pct_of_chunk,
    s.fast_admin_assigned_count,
    round(
        100.0 * s.fast_admin_assigned_count::numeric
        / NULLIF((SELECT count(*) FROM bulk_road_assignable), 0)::numeric,
        2
    ) AS fast_admin_pct_of_assignable,
    s.fallback_admin_assigned_count,
    s.inserted_count,
    round(100.0 * s.inserted_count::numeric / NULLIF(s.eligible_count, 0)::numeric, 2) AS inserted_pct_of_eligible,
    s.skipped_existing_external_id,
    s.skipped_invalid_geom,
    s.null_admin_area_warning_count,
    s.skipped_duplicate_or_review,
    s.fallback_unknown_road_class_count,
    s.missing_required_count,
    s.invalid_geom_count,
    s.chunk_promoted_count,
    s.final_promoted_count AS final_promoted_in_batch,
    s.names_inserted_count,
    p.dry_run,
    (SELECT pipeline_started_at FROM bulk_road_promote_timing LIMIT 1) AS pipeline_started_at,
    clock_timestamp() AS pipeline_finished_at,
    clock_timestamp() - (SELECT pipeline_started_at FROM bulk_road_promote_timing LIMIT 1) AS pipeline_elapsed
FROM bulk_road_promote_summary AS s
CROSS JOIN bulk_road_promote_params AS p;

\echo ''
\echo '=== sample inserted (up to 5) ==='

SELECT
    i.candidate_id,
    i.core_street_id,
    i.external_id,
    i.canonical_name_ready AS canonical_name
FROM bulk_road_inserted AS i
ORDER BY i.candidate_id
LIMIT 5;

\echo ''
\echo '=== sample skipped rows (up to 15) ==='

SELECT
    c.candidate_id,
    c.external_id,
    c.skip_reason
FROM bulk_road_classified AS c
WHERE c.skip_reason IS NOT NULL
ORDER BY c.skip_reason, c.candidate_id
LIMIT 15;

\endif

\ir _psql_dry_run_commit.sql
