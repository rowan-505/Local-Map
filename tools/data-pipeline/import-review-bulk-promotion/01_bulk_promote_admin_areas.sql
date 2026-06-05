-- =============================================================================
-- Bulk promote import_review.admin_area_candidates -> core.core_admin_areas
--
-- Set-based SQL only (no API/dashboard row-by-row promotion).
-- Runs shared preflight first (schemas, columns, indexes).
--
-- psql variables:
--   -v review_batch_id=<bigint>     required
--   -v limit_rows=<int>              optional (empty = no limit)
--   -v dry_run=true                  default true (rollback after report)
--
-- Usage:
--   psql "$DATABASE_URL" -v review_batch_id=2 -v dry_run=true \
--     -f tools/data-pipeline/import-review-bulk-promotion/01_bulk_promote_admin_areas.sql
-- =============================================================================

\set ON_ERROR_STOP on

\ir 00_shared_bulk_promotion_helpers.sql

BEGIN;

CREATE TEMP TABLE bulk_admin_promote_params (
    review_batch_id bigint NOT NULL,
    limit_rows int,
    dry_run boolean NOT NULL DEFAULT true
);

INSERT INTO bulk_admin_promote_params (review_batch_id, limit_rows, dry_run)
SELECT
    p.review_batch_id,
    p.limit_rows,
    CASE lower(coalesce(NULLIF(btrim(:'dry_run'), ''), 'true'))
        WHEN 'false' THEN false
        WHEN '0' THEN false
        WHEN 'no' THEN false
        ELSE true
    END
FROM bulk_promotion_preflight_params AS p;

CREATE TEMP TABLE bulk_admin_promote_context (
    review_batch_id bigint NOT NULL,
    limit_rows int,
    dry_run boolean NOT NULL,
    osm_source_type_id bigint NOT NULL
);

INSERT INTO bulk_admin_promote_context (review_batch_id, limit_rows, dry_run, osm_source_type_id)
SELECT
    pr.review_batch_id,
    pr.limit_rows,
    pr.dry_run,
    st.id
FROM bulk_admin_promote_params AS pr
CROSS JOIN LATERAL (
    SELECT id
    FROM ref.ref_source_types AS st
    WHERE st.code = 'osm'
    LIMIT 1
) AS st
WHERE pr.review_batch_id IS NOT NULL;

CREATE TEMP TABLE bulk_admin_promote_summary (
    total_batch_count bigint NOT NULL DEFAULT 0,
    eligible_count bigint NOT NULL DEFAULT 0,
    inserted_count bigint NOT NULL DEFAULT 0,
    skipped_existing_external_id bigint NOT NULL DEFAULT 0,
    skipped_invalid_count bigint NOT NULL DEFAULT 0,
    skipped_duplicate_or_review_count bigint NOT NULL DEFAULT 0,
    final_promoted_count bigint NOT NULL DEFAULT 0,
    names_inserted_count bigint NOT NULL DEFAULT 0
);

INSERT INTO bulk_admin_promote_summary DEFAULT VALUES;

DO $bulk_admin$
DECLARE
    ctx bulk_admin_promote_context%ROWTYPE;
    v_osm_source_type_id bigint;
    v_limit_clause text := '';
    v_names_inserted bigint := 0;
    rec record;
BEGIN
    SELECT * INTO ctx FROM bulk_admin_promote_context;
    v_osm_source_type_id := ctx.osm_source_type_id;

    IF ctx.review_batch_id IS NULL THEN
        RAISE EXCEPTION 'review_batch_id is required (psql -v review_batch_id=...)';
    END IF;
    IF ctx.osm_source_type_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_source_types code=osm is required';
    END IF;

    IF ctx.limit_rows IS NOT NULL AND ctx.limit_rows > 0 THEN
        RAISE NOTICE 'limit_rows=% — only that many eligible candidates will be inserted this run (omit -v limit_rows for full batch)',
            ctx.limit_rows;
    END IF;

    CREATE TEMP TABLE bulk_admin_classified ON COMMIT DROP AS
    SELECT
            aa.id AS candidate_id,
            aa.external_id,
            aa.review_batch_id,
            aa.admin_level_id,
            aa.slug AS candidate_slug,
            aa.confidence_score,
            aa.source_refs,
            aa.normalized_data,
            nullif(btrim(aa.external_id), '') AS external_id_ready,
            nullif(
                btrim(coalesce(aa.canonical_name, aa.name_mm, aa.name_en)),
                ''
            ) AS canonical_name_ready,
            nullif(btrim(aa.name_mm), '') AS name_mm_ready,
            nullif(btrim(aa.name_en), '') AS name_en_ready,
            coalesce(
                nullif(btrim(aa.slug), ''),
                nullif(btrim(aa.external_id), ''),
                lower(
                    regexp_replace(
                        coalesce(aa.canonical_name, aa.name_mm, aa.name_en, 'admin-area'),
                        '[^a-zA-Z0-9က-အ]+',
                        '-',
                        'g'
                    )
                )
            ) AS slug_ready,
            CASE
                WHEN aa.geom IS NULL THEN NULL::geometry(MultiPolygon, 4326)
                WHEN ST_GeometryType(aa.geom) = 'ST_Polygon'
                    THEN ST_Multi(aa.geom)::geometry(MultiPolygon, 4326)
                WHEN ST_GeometryType(aa.geom) = 'ST_MultiPolygon'
                    THEN aa.geom::geometry(MultiPolygon, 4326)
                ELSE NULL::geometry(MultiPolygon, 4326)
            END AS geom_ready,
            coalesce(
                CASE
                    WHEN aa.centroid IS NOT NULL
                         AND ST_GeometryType(aa.centroid) = 'ST_Point'
                    THEN aa.centroid::geometry(Point, 4326)
                END,
                CASE
                    WHEN aa.geom IS NOT NULL AND ST_IsValid(aa.geom)
                    THEN ST_PointOnSurface(
                        CASE
                            WHEN ST_GeometryType(aa.geom) = 'ST_Polygon'
                                THEN ST_Multi(aa.geom)
                            ELSE aa.geom
                        END
                    )::geometry(Point, 4326)
                END
            ) AS centroid_ready,
            coalesce(aa.source_refs, '{}'::jsonb)
            || jsonb_strip_nulls(jsonb_build_object(
                'review_candidate_id', aa.id::text,
                'review_batch_id', aa.review_batch_id::text,
                'entity_family', 'admin_areas',
                'promotion_path', 'tools/data-pipeline/import-review-bulk-promotion/01_bulk_promote_admin_areas.sql'
            )) AS merged_source_refs,
            coalesce(aa.normalized_data, '{}'::jsonb) AS normalized_data_ready,
            CASE
                WHEN coalesce(aa.promotion_status, '') = 'promoted' OR aa.promoted_core_id IS NOT NULL
                    THEN 'already_promoted'
                WHEN coalesce(aa.match_status, '') IN (
                    'duplicate_candidate', 'possible_duplicate', 'needs_review'
                )
                    THEN 'duplicate_or_review'
                WHEN coalesce(aa.match_status, '') IS DISTINCT FROM 'new_auto'
                    THEN 'duplicate_or_review'
                WHEN coalesce(aa.auto_action, '') IS DISTINCT FROM 'insert_candidate'
                    THEN 'duplicate_or_review'
                WHEN nullif(btrim(aa.external_id), '') IS NULL
                    THEN 'missing_required'
                WHEN aa.admin_level_id IS NULL
                    THEN 'missing_required'
                WHEN aa.geom IS NULL
                    THEN 'missing_required'
                WHEN nullif(btrim(coalesce(aa.canonical_name, aa.name_mm, aa.name_en)), '') IS NULL
                    THEN 'missing_required'
                WHEN NOT ST_IsValid(aa.geom) OR ST_IsEmpty(aa.geom) OR ST_SRID(aa.geom) IS DISTINCT FROM 4326
                    THEN 'invalid_geom'
                WHEN aa.confidence_score IS NULL
                     OR aa.confidence_score < 0
                     OR aa.confidence_score > 100
                    THEN 'invalid_confidence'
                WHEN EXISTS (
                    SELECT 1
                    FROM core.core_admin_areas AS c
                    WHERE c.external_id = nullif(btrim(aa.external_id), '')
                      AND coalesce(c.is_active, true)
                      AND (
                          coalesce(c.is_verified, false) = true
                          OR c.verification_status = 'verified'
                          OR c.source_refs @> '{"source":"dashboard"}'::jsonb
                          OR c.source_refs @> '{"source":"manual"}'::jsonb
                      )
                )
                    THEN 'protected_core_conflict'
                WHEN EXISTS (
                    SELECT 1
                    FROM core.core_admin_areas AS c
                    WHERE c.external_id = nullif(btrim(aa.external_id), '')
                      AND coalesce(c.is_active, true)
                      AND (c.deleted_at IS NULL)
                )
                    THEN 'existing_external_id'
                ELSE NULL
            END AS skip_reason
    FROM import_review.admin_area_candidates AS aa
    WHERE aa.review_batch_id = ctx.review_batch_id;

    UPDATE bulk_admin_promote_summary
    SET total_batch_count = (SELECT count(*) FROM bulk_admin_classified);

    IF ctx.limit_rows IS NOT NULL AND ctx.limit_rows > 0 THEN
        v_limit_clause := format(' LIMIT %s', ctx.limit_rows);
    END IF;

    EXECUTE format(
        $ready$
        CREATE TEMP TABLE bulk_admin_ready ON COMMIT DROP AS
        SELECT *
        FROM bulk_admin_classified AS c
        WHERE c.skip_reason IS NULL
          AND c.geom_ready IS NOT NULL
          AND c.centroid_ready IS NOT NULL
          AND c.canonical_name_ready IS NOT NULL
          AND c.slug_ready IS NOT NULL
          AND btrim(c.slug_ready) <> ''
        ORDER BY c.candidate_id
        %s
        $ready$,
        v_limit_clause
    );

    UPDATE bulk_admin_promote_summary
    SET
        eligible_count = (SELECT count(*) FROM bulk_admin_ready),
        skipped_existing_external_id = (
            SELECT count(*)
            FROM bulk_admin_classified AS c
            WHERE c.skip_reason = 'existing_external_id'
        ),
        skipped_invalid_count = (
            SELECT count(*)
            FROM bulk_admin_classified AS c
            WHERE c.skip_reason IN ('missing_required', 'invalid_geom', 'invalid_confidence')
        ),
        skipped_duplicate_or_review_count = (
            SELECT count(*)
            FROM bulk_admin_classified AS c
            WHERE c.skip_reason IN (
                'already_promoted',
                'duplicate_or_review',
                'protected_core_conflict'
            )
        );

    CREATE TEMP TABLE bulk_admin_inserted ON COMMIT DROP AS
    WITH ins AS (
        INSERT INTO core.core_admin_areas (
            public_id,
            parent_id,
            admin_level_id,
            canonical_name,
            slug,
            geom,
            centroid,
            source_type_id,
            is_active,
            external_id,
            source_refs,
            normalized_data,
            is_verified,
            verification_status,
            boundary_status,
            is_official_boundary,
            boundary_confidence_score,
            address_usage,
            created_at,
            updated_at
        )
        SELECT
            gen_random_uuid(),
            NULL::bigint,
            r.admin_level_id,
            r.canonical_name_ready,
            r.slug_ready,
            r.geom_ready,
            r.centroid_ready,
            v_osm_source_type_id,
            true,
            r.external_id_ready,
            r.merged_source_refs,
            r.normalized_data_ready,
            false,
            'unverified',
            'official',
            true,
            coalesce(r.confidence_score, 80::numeric),
            'official',
            now(),
            now()
        FROM bulk_admin_ready AS r
        ORDER BY r.candidate_id
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL
        DO NOTHING
        RETURNING id, external_id
    )
    SELECT
        ready.candidate_id,
        ins.id AS core_admin_area_id,
        ins.external_id,
        ready.canonical_name_ready
    FROM ins
    INNER JOIN bulk_admin_ready AS ready
        ON ready.external_id_ready = ins.external_id;

    UPDATE bulk_admin_promote_summary
    SET inserted_count = (SELECT count(*) FROM bulk_admin_inserted);

    INSERT INTO core.core_admin_area_names (
        admin_area_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    SELECT
        n.admin_area_id,
        n.name,
        n.language_code,
        n.script_code,
        'primary',
        n.is_primary,
        100
    FROM (
        SELECT
            i.core_admin_area_id AS admin_area_id,
            r.name_mm_ready AS name,
            'my'::text AS language_code,
            'Mymr'::text AS script_code,
            true AS is_primary
        FROM bulk_admin_inserted AS i
        INNER JOIN bulk_admin_classified AS r ON r.candidate_id = i.candidate_id
        WHERE r.name_mm_ready IS NOT NULL

        UNION ALL

        SELECT
            i.core_admin_area_id,
            r.name_en_ready,
            'en',
            'Latn',
            CASE WHEN r.name_mm_ready IS NULL THEN true ELSE false END
        FROM bulk_admin_inserted AS i
        INNER JOIN bulk_admin_classified AS r ON r.candidate_id = i.candidate_id
        WHERE r.name_en_ready IS NOT NULL

        UNION ALL

        SELECT
            i.core_admin_area_id,
            r.canonical_name_ready,
            'und',
            NULL::text,
            true
        FROM bulk_admin_inserted AS i
        INNER JOIN bulk_admin_classified AS r ON r.candidate_id = i.candidate_id
        WHERE r.name_mm_ready IS NULL
          AND r.name_en_ready IS NULL
          AND r.canonical_name_ready IS NOT NULL
    ) AS n
    WHERE n.name IS NOT NULL
      AND btrim(n.name) <> ''
      AND NOT EXISTS (
          SELECT 1
          FROM core.core_admin_area_names AS existing
          WHERE existing.admin_area_id = n.admin_area_id
            AND lower(btrim(existing.name)) = lower(btrim(n.name))
            AND coalesce(existing.language_code, '') = coalesce(n.language_code, '')
      );

    GET DIAGNOSTICS v_names_inserted = ROW_COUNT;
    UPDATE bulk_admin_promote_summary
    SET names_inserted_count = v_names_inserted;

    UPDATE import_review.admin_area_candidates AS aa
    SET
        promotion_status = 'promoted',
        promoted_core_id = i.core_admin_area_id,
        promoted_at = now(),
        promoted_by = NULL,
        updated_at = now()
    FROM bulk_admin_inserted AS i
    WHERE aa.id = i.candidate_id
      AND coalesce(aa.promotion_status, '') IS DISTINCT FROM 'promoted';

    UPDATE bulk_admin_promote_summary
    SET final_promoted_count = (
        SELECT count(*)
        FROM import_review.admin_area_candidates AS aa
        WHERE aa.review_batch_id = ctx.review_batch_id
          AND coalesce(aa.promotion_status, '') = 'promoted'
    );

    UPDATE import_review.admin_area_candidates AS aa
    SET
        promotion_status = 'skipped',
        updated_at = now()
    FROM bulk_admin_classified AS c
    WHERE aa.id = c.candidate_id
      AND c.skip_reason IS NOT NULL
      AND coalesce(aa.promotion_status, '') IS DISTINCT FROM 'promoted';

    RAISE NOTICE '--- bulk admin area promote summary ---';
    FOR rec IN SELECT * FROM bulk_admin_promote_summary LOOP
        RAISE NOTICE 'review_batch_id=% dry_run=% limit=% osm_source_type_id=%',
            ctx.review_batch_id, ctx.dry_run, ctx.limit_rows, ctx.osm_source_type_id;
        RAISE NOTICE 'total_batch=% eligible=% inserted=% skipped_existing_external_id=%',
            rec.total_batch_count, rec.eligible_count, rec.inserted_count, rec.skipped_existing_external_id;
        RAISE NOTICE 'skipped_invalid=% skipped_duplicate_or_review=% names_in_batch=% final_promoted_in_batch=%',
            rec.skipped_invalid_count, rec.skipped_duplicate_or_review_count,
            rec.names_inserted_count, rec.final_promoted_count;
    END LOOP;
END;
$bulk_admin$;

\echo ''
\echo '=== bulk admin area promote summary ==='

SELECT
    s.total_batch_count,
    s.eligible_count,
    s.inserted_count,
    s.skipped_existing_external_id,
    s.skipped_invalid_count,
    s.skipped_duplicate_or_review_count,
    s.final_promoted_count,
    s.names_inserted_count,
    p.dry_run
FROM bulk_admin_promote_summary AS s
CROSS JOIN bulk_admin_promote_params AS p;

\echo ''
\echo '=== sample inserted (up to 5) ==='

SELECT
    i.candidate_id,
    i.core_admin_area_id,
    i.external_id,
    i.canonical_name_ready AS canonical_name
FROM bulk_admin_inserted AS i
ORDER BY i.candidate_id
LIMIT 5;

\echo ''
\echo '=== sample skipped rows (up to 15) ==='

SELECT
    c.candidate_id,
    c.external_id,
    c.skip_reason
FROM bulk_admin_classified AS c
WHERE c.skip_reason IS NOT NULL
ORDER BY c.skip_reason, c.candidate_id
LIMIT 15;

\ir _psql_dry_run_commit.sql
