-- =============================================================================
-- Stage L: verify_remote_review_upload
-- -----------------------------------------------------------------------------
-- Part A: LOCAL package + item linkage (default connection: LOCAL_DATABASE_URL)
-- Part B: import_review quality (when import_review schema exists on connection)
--
-- Part C: coverage report (staging vs package vs remote when available)
--
-- psql vars:
--   fail_on_coverage_gap   optional default true — RAISE on FAIL rows in coverage report
--   staging_schema         optional default staging
--   import_review_schema   optional default import_review
--   entity_families        optional; default all (see pipeline_entity_families.sql)
--   entity_family          optional legacy comma filter / REMOTE_REVIEW_ENTITY_FAMILY
--
\if :{?fail_on_coverage_gap}
\else
\set fail_on_coverage_gap true
\endif

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?entity_family}
\else
\set entity_family ''
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif

SELECT CASE
    WHEN lower(btrim(coalesce(:'entity_families', 'all'))) IN ('', 'all', '*')
         AND nullif(btrim(coalesce(:'entity_family', '')), '') IS NOT NULL
        THEN lower(btrim(:'entity_family'))
    ELSE lower(btrim(coalesce(nullif(btrim(:'entity_families'), ''), 'all')))
END AS effective_entity_families \gset stage13_ef_

\set entity_families :stage13_ef_effective_entity_families

-- Local example:
--   PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
--        -v entity_families='admin_areas' \
--        -f ./13_verify_remote_review_upload.sql
--
-- Supabase example (Part B only; Part A warns if package table missing):
--   PAGER=cat psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
--        -f ./13_verify_remote_review_upload.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?import_review_schema}
\else
\set import_review_schema 'import_review'
\endif

SELECT CAST(
        CASE WHEN NULLIF(trim(:'package_name'), '') IS NULL THEN
            E'missing_package_name:_use_-v_package_name_same_as_REMOTE_REVIEW_PACKAGE_NAME'
        ELSE '0' END AS integer)
    AS _package_name_guard;

BEGIN;

\ir pipeline_entity_families.sql

DROP TABLE IF EXISTS stage13_ctx;
CREATE TEMP TABLE stage13_ctx (
    package_name text NOT NULL,
    import_review_schema text NOT NULL,
    has_local_package boolean NOT NULL DEFAULT false,
    has_import_review boolean NOT NULL DEFAULT false,
    remote_batch_id bigint,
    staging_schema text NOT NULL DEFAULT 'staging',
    fail_on_coverage_gap boolean NOT NULL DEFAULT true
);

INSERT INTO stage13_ctx (
    package_name,
    import_review_schema,
    has_local_package,
    has_import_review,
    staging_schema,
    fail_on_coverage_gap
)
SELECT
    trim(:'package_name'),
    coalesce(NULLIF(trim(:'import_review_schema'), ''), 'import_review'),
    to_regclass('system.system_remote_review_packages') IS NOT NULL,
    EXISTS (
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = coalesce(NULLIF(trim(:'import_review_schema'), ''), 'import_review')
    ),
    lower(trim(coalesce(NULLIF(trim(:'staging_schema'), ''), 'staging'))),
    coalesce(NULLIF(trim(:'fail_on_coverage_gap'), ''), 'true')::boolean;

-- remote_batch_id populated in Part B when import_review exists

-- -----------------------------------------------------------------------------
-- Part A: LOCAL package (skipped with notice when not on local DB)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS stage13_local_package;
CREATE TEMP TABLE stage13_local_package (
    id bigint,
    package_name text,
    source_snapshot_id bigint,
    snapshot_version text,
    region_code text,
    status text,
    entity_families text[],
    total_item_count integer,
    summary jsonb,
    created_at timestamptz,
    uploaded_at timestamptz,
    remote_review_batch_id bigint,
    remote_upload_status text,
    note text
);

DROP TABLE IF EXISTS stage13_local_items_by_family;
CREATE TEMP TABLE stage13_local_items_by_family (
    entity_family text,
    rows_n bigint,
    with_remote_candidate_id bigint,
    non_pending_upload_status bigint
);

DROP TABLE IF EXISTS stage13_local_items_quality_gaps;
CREATE TEMP TABLE stage13_local_items_quality_gaps (
    entity_family text,
    missing_source_refs bigint,
    missing_normalized_data bigint,
    missing_geometry_geojson bigint,
    missing_external_id bigint,
    total_rows bigint
);

DROP TABLE IF EXISTS stage13_local_status_breakdown;
CREATE TEMP TABLE stage13_local_status_breakdown (
    entity_family text,
    status_dimension text,
    status_value text,
    count_n bigint
);

DO $a$
DECLARE
    ctx stage13_ctx%ROWTYPE;
BEGIN
    SELECT * INTO STRICT ctx FROM stage13_ctx;

    IF NOT ctx.has_local_package THEN
        RAISE NOTICE 'stage13: system.system_remote_review_packages not found — skipping local sections (run Part A with LOCAL_DATABASE_URL)';
        RETURN;
    END IF;

    EXECUTE $q$
        INSERT INTO stage13_local_package (
            id, package_name, source_snapshot_id, snapshot_version, region_code,
            status, entity_families, total_item_count, summary, created_at,
            uploaded_at, remote_review_batch_id, remote_upload_status, note
        )
        SELECT
            id, package_name, source_snapshot_id, snapshot_version, region_code,
            status, entity_families, total_item_count, summary, created_at,
            uploaded_at, remote_review_batch_id, remote_upload_status, note
        FROM system.system_remote_review_packages
        WHERE package_name = $1
    $q$
    USING ctx.package_name;

    EXECUTE $q$
        INSERT INTO stage13_local_items_by_family (
            entity_family, rows_n, with_remote_candidate_id, non_pending_upload_status
        )
        SELECT
            i.entity_family,
            count(*)::bigint,
            count(*) FILTER (WHERE i.remote_candidate_id IS NOT NULL)::bigint,
            count(*) FILTER (WHERE coalesce(trim(i.upload_status), '') <> 'pending')::bigint
        FROM system.system_remote_review_packages p
        JOIN system.system_remote_review_package_items i ON i.package_id = p.id
        WHERE p.package_name = $1
          AND pg_temp.pipeline_entity_family_enabled(i.entity_family)
        GROUP BY i.entity_family
    $q$
    USING ctx.package_name;

    EXECUTE $q$
        INSERT INTO stage13_local_items_quality_gaps (
            entity_family, missing_source_refs, missing_normalized_data,
            missing_geometry_geojson, missing_external_id, total_rows
        )
        SELECT
            i.entity_family,
            count(*) FILTER (WHERE i.source_refs IS NULL OR i.source_refs = '{}'::jsonb)::bigint,
            count(*) FILTER (WHERE i.normalized_data IS NULL OR i.normalized_data = '{}'::jsonb)::bigint,
            count(*) FILTER (WHERE i.geometry_geojson IS NULL)::bigint,
            count(*) FILTER (WHERE nullif(trim(i.external_id), '') IS NULL)::bigint,
            count(*)::bigint
        FROM system.system_remote_review_packages p
        JOIN system.system_remote_review_package_items i ON i.package_id = p.id
        WHERE p.package_name = $1
          AND pg_temp.pipeline_entity_family_enabled(i.entity_family)
        GROUP BY i.entity_family
    $q$
    USING ctx.package_name;

    EXECUTE $q$
        INSERT INTO stage13_local_status_breakdown (entity_family, status_dimension, status_value, count_n)
        SELECT i.entity_family, 'review_status', coalesce(i.review_status, '(null)'), count(*)::bigint
        FROM system.system_remote_review_packages p
        JOIN system.system_remote_review_package_items i ON i.package_id = p.id
        WHERE p.package_name = $1
          AND pg_temp.pipeline_entity_family_enabled(i.entity_family)
        GROUP BY i.entity_family, coalesce(i.review_status, '(null)')
    $q$
    USING ctx.package_name;

    EXECUTE $q$
        INSERT INTO stage13_local_status_breakdown (entity_family, status_dimension, status_value, count_n)
        SELECT i.entity_family, 'match_status', coalesce(i.match_status, '(null)'), count(*)::bigint
        FROM system.system_remote_review_packages p
        JOIN system.system_remote_review_package_items i ON i.package_id = p.id
        WHERE p.package_name = $1
          AND pg_temp.pipeline_entity_family_enabled(i.entity_family)
        GROUP BY i.entity_family, coalesce(i.match_status, '(null)')
    $q$
    USING ctx.package_name;

    EXECUTE $q$
        INSERT INTO stage13_local_status_breakdown (entity_family, status_dimension, status_value, count_n)
        SELECT i.entity_family, 'auto_action', coalesce(i.auto_action, '(null)'), count(*)::bigint
        FROM system.system_remote_review_packages p
        JOIN system.system_remote_review_package_items i ON i.package_id = p.id
        WHERE p.package_name = $1
          AND pg_temp.pipeline_entity_family_enabled(i.entity_family)
        GROUP BY i.entity_family, coalesce(i.auto_action, '(null)')
    $q$
    USING ctx.package_name;
END $a$;

SELECT 'local_package'::text AS section, p.*
FROM stage13_local_package AS p;

SELECT 'local_items_by_family'::text AS section, f.*
FROM stage13_local_items_by_family AS f
ORDER BY f.entity_family;

SELECT 'local_items_quality_gaps'::text AS section, g.*
FROM stage13_local_items_quality_gaps AS g
ORDER BY g.entity_family;

SELECT 'local_status_breakdown'::text AS section, s.*
FROM stage13_local_status_breakdown AS s
ORDER BY s.entity_family, s.status_dimension, s.status_value;

-- -----------------------------------------------------------------------------
-- Part B: import_review remote counts + quality (dynamic per candidate table)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS stage13_family_manifest;
CREATE TEMP TABLE stage13_family_manifest (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL,
    import_review_table text NOT NULL,
    geom_column text,
    geom_extra_column text,
    missing_geom_expr text NOT NULL,
    eligibility_geom_expr text NOT NULL
);

INSERT INTO stage13_family_manifest (
    entity_family, staging_table, import_review_table, geom_column, geom_extra_column, missing_geom_expr, eligibility_geom_expr
)
VALUES
    ('buildings', 'staging_building_candidates', 'building_candidates', 'geom', NULL, 't.geom IS NULL', 's.geom IS NOT NULL'),
    ('places', 'staging_place_candidates', 'place_candidates', 'point_geom', NULL, 't.point_geom IS NULL', 's.point_geom IS NOT NULL'),
    ('roads', 'staging_road_candidates', 'road_candidates', 'geom', NULL, 't.geom IS NULL', 's.geom IS NOT NULL'),
    ('bus_stops', 'staging_bus_stop_candidates', 'bus_stop_candidates', 'geom', NULL, 't.geom IS NULL', 's.point_geom IS NOT NULL'),
    ('landuse', 'staging_landuse_candidates', 'landuse_candidates', 'geom', 'centroid', 't.geom IS NULL', 's.geom IS NOT NULL'),
    ('water_lines', 'staging_water_line_candidates', 'water_line_candidates', 'geom', NULL, 't.geom IS NULL', 's.geom IS NOT NULL'),
    ('water_polygons', 'staging_water_polygon_candidates', 'water_polygon_candidates', 'geom', 'centroid', 't.geom IS NULL', 's.geom IS NOT NULL'),
    ('addresses', 'staging_address_candidates', 'address_candidates', 'point_geom', 'entrance_geom', 't.point_geom IS NULL', '(s.point_geom IS NOT NULL OR s.geom IS NOT NULL)'),
    ('admin_areas', 'staging_admin_area_candidates', 'admin_area_candidates', 'geom', 'centroid', 't.geom IS NULL', 's.geom IS NOT NULL'),
    ('routing_barriers', 'staging_routing_barrier_candidates', 'routing_barrier_candidates', 'point_geom', NULL, 't.point_geom IS NULL', '(s.point_geom IS NOT NULL OR s.geom IS NOT NULL)');

DROP TABLE IF EXISTS stage13_ir_manifest;
CREATE TEMP TABLE stage13_ir_manifest (
    entity_family text PRIMARY KEY,
    import_review_table text NOT NULL,
    geom_column text,
    geom_extra_column text,
    missing_geom_expr text NOT NULL
);

INSERT INTO stage13_ir_manifest (entity_family, import_review_table, geom_column, geom_extra_column, missing_geom_expr)
SELECT entity_family, import_review_table, geom_column, geom_extra_column, missing_geom_expr
FROM stage13_family_manifest;

DELETE FROM stage13_family_manifest AS mf
WHERE NOT pg_temp.pipeline_entity_family_enabled(mf.entity_family);

DELETE FROM stage13_ir_manifest AS mf
WHERE NOT pg_temp.pipeline_entity_family_enabled(mf.entity_family);

DROP TABLE IF EXISTS stage13_ir_counts;
CREATE TEMP TABLE stage13_ir_counts (
    entity_family text,
    import_review_table text,
    uploaded_count bigint,
    missing_source_refs bigint,
    missing_normalized_data bigint,
    missing_geometry bigint,
    missing_geometry_extra bigint,
    missing_external_id bigint,
    duplicate_local_staging_id bigint,
    invalid_promotion_status bigint,
    invalid_confidence_score bigint,
    warning text
);

DROP TABLE IF EXISTS stage13_ir_status_breakdown;
CREATE TEMP TABLE stage13_ir_status_breakdown (
    entity_family text,
    status_dimension text,
    status_value text,
    count_n bigint
);

DROP TABLE IF EXISTS stage13_ir_classification_counts;
CREATE TEMP TABLE stage13_ir_classification_counts (
    entity_family text,
    source_classification text,
    address_strength text,
    count_n bigint
);

DROP TABLE IF EXISTS stage13_ir_batch;
CREATE TEMP TABLE stage13_ir_batch (
    id bigint,
    batch_name text,
    source_snapshot_version text,
    source_snapshot_id_local bigint,
    entity_families text[],
    total_candidate_count integer,
    uploaded_candidate_count integer,
    preserved_reviewed_count integer,
    status text,
    uploaded_at timestamptz
);

DO $ir$
DECLARE
    ctx stage13_ctx%ROWTYPE;
    r stage13_ir_manifest%ROWTYPE;
    v_reg oid;
    v_sql text;
    v_batch_id bigint;
BEGIN
    SELECT * INTO STRICT ctx FROM stage13_ctx;

    IF NOT ctx.has_import_review THEN
        INSERT INTO stage13_ir_counts (entity_family, import_review_table, warning, uploaded_count)
        VALUES (
            '_schema',
            ctx.import_review_schema,
            'import_review schema not on this connection — run Part B with SUPABASE_DATABASE_URL',
            0
        );
        RAISE NOTICE 'stage13: Part B skipped (no % schema). Local Part A completed.', ctx.import_review_schema;
        RETURN;
    END IF;

    EXECUTE format(
        $q$
        SELECT id FROM %I.review_batches WHERE batch_name = $1 LIMIT 1
        $q$,
        ctx.import_review_schema
    )
    INTO v_batch_id
    USING ctx.package_name;

    IF v_batch_id IS NULL THEN
        INSERT INTO stage13_ir_counts (entity_family, import_review_table, warning, uploaded_count)
        VALUES (
            '_batch',
            ctx.import_review_schema || '.review_batches',
            format('FAIL: no review_batches row for batch_name=%s (run Stage 12 upload for this package first)', ctx.package_name),
            0
        );
        RAISE NOTICE 'stage13 FAIL: no import_review.review_batches row for package_name=%', ctx.package_name;
        RETURN;
    END IF;

    UPDATE stage13_ctx SET remote_batch_id = v_batch_id WHERE package_name = ctx.package_name;

    EXECUTE format(
        $q$
        INSERT INTO stage13_ir_batch (
            id, batch_name, source_snapshot_version, source_snapshot_id_local,
            entity_families, total_candidate_count, uploaded_candidate_count,
            preserved_reviewed_count, status, uploaded_at
        )
        SELECT
            id, batch_name, source_snapshot_version, source_snapshot_id_local,
            entity_families, total_candidate_count, uploaded_candidate_count,
            preserved_reviewed_count, status, uploaded_at
        FROM %I.review_batches
        WHERE id = $1
        $q$,
        ctx.import_review_schema
    )
    USING v_batch_id;
    FOR r IN SELECT * FROM stage13_ir_manifest ORDER BY entity_family LOOP
        v_reg := to_regclass(format('%I.%I', ctx.import_review_schema, r.import_review_table));
        IF v_reg IS NULL THEN
            INSERT INTO stage13_ir_counts (entity_family, import_review_table, warning, uploaded_count)
            VALUES (r.entity_family, r.import_review_table, 'table missing', 0);
            CONTINUE;
        END IF;

        v_sql := format(
            $q$
            INSERT INTO stage13_ir_counts (
                entity_family, import_review_table, uploaded_count,
                missing_source_refs, missing_normalized_data, missing_geometry,
                missing_geometry_extra, missing_external_id, duplicate_local_staging_id,
                invalid_promotion_status, invalid_confidence_score
            )
            SELECT
                %L,
                %L,
                count(*)::bigint,
                count(*) FILTER (WHERE t.source_refs IS NULL OR t.source_refs = '{}'::jsonb)::bigint,
                count(*) FILTER (WHERE t.normalized_data IS NULL OR t.normalized_data = '{}'::jsonb)::bigint,
                count(*) FILTER (WHERE %s)::bigint,
                count(*) FILTER (WHERE %s)::bigint,
                count(*) FILTER (WHERE nullif(trim(t.external_id), '') IS NULL)::bigint,
                coalesce((
                    SELECT count(*)::bigint FROM (
                        SELECT t2.local_staging_id
                        FROM %I.%I AS t2
                        WHERE t2.review_batch_id = %s
                        GROUP BY t2.local_staging_id
                        HAVING count(*) > 1
                    ) d
                ), 0)::bigint,
                count(*) FILTER (
                    WHERE t.promotion_status IS NOT NULL
                      AND t.promotion_status NOT IN ('not_ready', 'ready', 'batched', 'promoting', 'promoted', 'failed', 'skipped')
                )::bigint,
                count(*) FILTER (
                    WHERE t.confidence_score IS NOT NULL
                      AND (t.confidence_score < 0 OR t.confidence_score > 100)
                )::bigint
            FROM %I.%I AS t
            WHERE t.review_batch_id = %s
            $q$,
            r.entity_family,
            r.import_review_table,
            r.missing_geom_expr,
            CASE
                WHEN r.geom_extra_column IS NOT NULL AND r.geom_extra_column <> 'geom' THEN
                    format('t.%I IS NULL', r.geom_extra_column)
                WHEN r.geom_extra_column = 'geom' THEN 'false'
                ELSE 'false'
            END,
            ctx.import_review_schema,
            r.import_review_table,
            v_batch_id,
            ctx.import_review_schema,
            r.import_review_table,
            v_batch_id
        );
        EXECUTE v_sql;

        FOR v_sql IN
            SELECT format(
                $q$
                INSERT INTO stage13_ir_status_breakdown (entity_family, status_dimension, status_value, count_n)
                SELECT %L, %L, coalesce(%s::text, '(null)'), count(*)::bigint
                FROM %I.%I AS t
                WHERE t.review_batch_id = %s
                GROUP BY coalesce(%s::text, '(null)')
                $q$,
                r.entity_family,
                dim.status_dimension,
                dim.status_col,
                ctx.import_review_schema,
                r.import_review_table,
                v_batch_id,
                dim.status_col
            )
            FROM (
                VALUES
                    ('review_status', 't.review_status'),
                    ('match_status', 't.match_status'),
                    ('auto_action', 't.auto_action'),
                    ('promotion_status', 't.promotion_status')
            ) AS dim(status_dimension, status_col)
        LOOP
            EXECUTE v_sql;
        END LOOP;
    END LOOP;
END $ir$;

DO $ir_classified$
DECLARE
    ctx stage13_ctx%ROWTYPE;
    v_batch_id bigint;
BEGIN
    SELECT * INTO STRICT ctx FROM stage13_ctx;
    v_batch_id := ctx.remote_batch_id;

    IF NOT ctx.has_import_review OR v_batch_id IS NULL THEN
        RETURN;
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('address_components')
       AND to_regclass(format('%I.address_components', ctx.import_review_schema)) IS NOT NULL
       AND to_regclass(format('%I.address_candidates', ctx.import_review_schema)) IS NOT NULL THEN
        EXECUTE format(
            $q$
            INSERT INTO stage13_ir_counts (
                entity_family, import_review_table, uploaded_count,
                missing_source_refs, missing_normalized_data, missing_geometry,
                missing_geometry_extra, missing_external_id, duplicate_local_staging_id,
                invalid_promotion_status
            )
            SELECT
                'address_components',
                'address_components',
                count(*)::bigint,
                count(*) FILTER (WHERE ac.source_refs IS NULL OR ac.source_refs = '{}'::jsonb)::bigint,
                count(*) FILTER (WHERE ac.normalized_data IS NULL OR ac.normalized_data = '{}'::jsonb)::bigint,
                0::bigint,
                0::bigint,
                count(*) FILTER (WHERE nullif(trim(ac.source_refs ->> 'external_id'), '') IS NULL)::bigint,
                0::bigint,
                0::bigint
            FROM %I.address_components AS ac
            INNER JOIN %I.address_candidates AS a
                ON a.id = ac.address_candidate_id
            WHERE a.review_batch_id = $1::bigint
            $q$,
            ctx.import_review_schema,
            ctx.import_review_schema
        )
        USING v_batch_id;
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('place_address_links')
       AND to_regclass(format('%I.place_address_links', ctx.import_review_schema)) IS NOT NULL THEN
        EXECUTE format(
            $q$
            INSERT INTO stage13_ir_counts (
                entity_family, import_review_table, uploaded_count,
                missing_source_refs, missing_normalized_data, missing_geometry,
                missing_geometry_extra, missing_external_id, duplicate_local_staging_id,
                invalid_promotion_status
            )
            SELECT
                'place_address_links',
                'place_address_links',
                count(*)::bigint,
                count(*) FILTER (WHERE pal.source_refs IS NULL OR pal.source_refs = '{}'::jsonb)::bigint,
                count(*) FILTER (WHERE pal.normalized_data IS NULL OR pal.normalized_data = '{}'::jsonb)::bigint,
                0::bigint,
                0::bigint,
                count(*) FILTER (WHERE nullif(trim(pal.external_id), '') IS NULL)::bigint,
                0::bigint,
                count(*) FILTER (
                    WHERE pal.promotion_status IS NOT NULL
                      AND pal.promotion_status NOT IN ('not_ready', 'ready', 'batched', 'promoting', 'promoted', 'failed', 'skipped')
                )::bigint
            FROM %I.place_address_links AS pal
            WHERE pal.review_batch_id = $1::bigint
            $q$,
            ctx.import_review_schema
        )
        USING v_batch_id;

        EXECUTE format(
            $q$
            INSERT INTO stage13_ir_status_breakdown (entity_family, status_dimension, status_value, count_n)
            SELECT 'place_address_links', 'review_status', coalesce(review_status, '(null)'), count(*)::bigint
            FROM %I.place_address_links
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(review_status, '(null)')
            UNION ALL
            SELECT 'place_address_links', 'match_status', coalesce(match_status, '(null)'), count(*)::bigint
            FROM %I.place_address_links
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(match_status, '(null)')
            UNION ALL
            SELECT 'place_address_links', 'auto_action', coalesce(auto_action, '(null)'), count(*)::bigint
            FROM %I.place_address_links
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(auto_action, '(null)')
            UNION ALL
            SELECT 'place_address_links', 'promotion_status', coalesce(promotion_status, '(null)'), count(*)::bigint
            FROM %I.place_address_links
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(promotion_status, '(null)')
            $q$,
            ctx.import_review_schema,
            ctx.import_review_schema,
            ctx.import_review_schema,
            ctx.import_review_schema
        )
        USING v_batch_id;
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('addresses')
       AND to_regclass(format('%I.address_candidates', ctx.import_review_schema)) IS NOT NULL THEN
        EXECUTE format(
            $q$
            INSERT INTO stage13_ir_classification_counts (
                entity_family, source_classification, address_strength, count_n
            )
            SELECT
                'addresses',
                coalesce(source_classification, '(null)'),
                coalesce(address_strength, '(null)'),
                count(*)::bigint
            FROM %I.address_candidates
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(source_classification, '(null)'), coalesce(address_strength, '(null)')
            $q$,
            ctx.import_review_schema
        )
        USING v_batch_id;
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('places')
       AND to_regclass(format('%I.place_candidates', ctx.import_review_schema)) IS NOT NULL THEN
        EXECUTE format(
            $q$
            INSERT INTO stage13_ir_classification_counts (
                entity_family, source_classification, address_strength, count_n
            )
            SELECT
                'places',
                coalesce(normalized_data ->> 'source_classification', '(null)'),
                coalesce(normalized_data ->> 'address_strength', '(null)'),
                count(*)::bigint
            FROM %I.place_candidates
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(normalized_data ->> 'source_classification', '(null)'),
                     coalesce(normalized_data ->> 'address_strength', '(null)')
            $q$,
            ctx.import_review_schema
        )
        USING v_batch_id;
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('place_address_links')
       AND to_regclass(format('%I.place_address_links', ctx.import_review_schema)) IS NOT NULL THEN
        EXECUTE format(
            $q$
            INSERT INTO stage13_ir_classification_counts (
                entity_family, source_classification, address_strength, count_n
            )
            SELECT
                'place_address_links',
                coalesce(normalized_data ->> 'source_classification', '(null)'),
                coalesce(normalized_data ->> 'address_strength', '(null)'),
                count(*)::bigint
            FROM %I.place_address_links
            WHERE review_batch_id = $1::bigint
            GROUP BY coalesce(normalized_data ->> 'source_classification', '(null)'),
                     coalesce(normalized_data ->> 'address_strength', '(null)')
            $q$,
            ctx.import_review_schema
        )
        USING v_batch_id;
    END IF;
END $ir_classified$;

SELECT 'import_review_batch'::text AS section, b.*
FROM stage13_ir_batch AS b;

SELECT 'import_review_upload_counts'::text AS section, *
FROM stage13_ir_counts
ORDER BY entity_family;

SELECT 'import_review_status_breakdown'::text AS section, *
FROM stage13_ir_status_breakdown
ORDER BY entity_family, status_dimension, status_value;

SELECT 'classification_counts'::text AS section, *
FROM stage13_ir_classification_counts
ORDER BY entity_family, source_classification, address_strength;

SELECT
    'classified_summary'::text AS section,
    coalesce(sum(count_n) FILTER (WHERE entity_family = 'addresses' AND address_strength = 'weak'), 0)::bigint AS weak_address_count,
    coalesce(sum(count_n) FILTER (WHERE source_classification = 'place_with_address'), 0)::bigint AS place_with_address_count
FROM stage13_ir_classification_counts;

-- -----------------------------------------------------------------------------
-- Part C: coverage report (staging eligible vs package vs remote)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS stage13_coverage_report;
CREATE TEMP TABLE stage13_coverage_report (
    entity_family text PRIMARY KEY,
    staging_eligible bigint NOT NULL DEFAULT 0,
    package_items bigint NOT NULL DEFAULT 0,
    remote_uploaded bigint NOT NULL DEFAULT 0,
    coverage_status text NOT NULL
);

DO $cov$
DECLARE
    ctx stage13_ctx%ROWTYPE;
    r stage13_family_manifest%ROWTYPE;
    v_snapshot_id bigint;
    v_staging_schema text;
    v_staging_cnt bigint;
    v_pkg_cnt bigint;
    v_remote_cnt bigint;
    v_status text;
    v_eligible_sql text;
    v_family text;
BEGIN
    SELECT * INTO STRICT ctx FROM stage13_ctx;
    v_staging_schema := ctx.staging_schema;

    SELECT source_snapshot_id INTO v_snapshot_id
    FROM stage13_local_package
    LIMIT 1;

    IF v_snapshot_id IS NULL THEN
        SELECT source_snapshot_id_local INTO v_snapshot_id
        FROM stage13_ir_batch
        LIMIT 1;
    END IF;

    FOR r IN SELECT * FROM stage13_family_manifest ORDER BY entity_family LOOP
        v_staging_cnt := 0;
        v_pkg_cnt := 0;
        v_remote_cnt := 0;

        SELECT coalesce((
            SELECT f.rows_n FROM stage13_local_items_by_family f WHERE f.entity_family = r.entity_family
        ), 0) INTO v_pkg_cnt;

        SELECT coalesce(max(c.uploaded_count), 0) INTO v_remote_cnt
        FROM stage13_ir_counts c
        WHERE c.entity_family = r.entity_family;

        IF ctx.has_local_package AND v_snapshot_id IS NOT NULL
           AND to_regclass(format('%I.%I', v_staging_schema, r.staging_table)) IS NOT NULL THEN
            v_eligible_sql := format(
                $el$
                SELECT count(*)::bigint
                FROM %I.%I AS s
                WHERE s.source_snapshot_id = $1::bigint
                  AND (
                      s.review_status IS NULL
                      OR s.review_status IN (
                          'pending', 'needs_review', 'approved', 'rejected', 'ignored', 'merged'
                      )
                  )
                  AND NOT (
                      to_jsonb(s) ? 'promotion_status'
                      AND to_jsonb(s) ->> 'promotion_status' = 'promoted'
                  )
                  AND (
                      (s.match_status IS NOT NULL AND s.auto_action IS NOT NULL)
                      OR (%s)
                      OR coalesce(s.normalized_data, '{}'::jsonb) <> '{}'::jsonb
                      OR coalesce(s.source_refs, '{}'::jsonb) <> '{}'::jsonb
                      OR nullif(trim(s.external_id::text), '') IS NOT NULL
                  )
                $el$,
                v_staging_schema,
                r.staging_table,
                r.eligibility_geom_expr
            );
            EXECUTE v_eligible_sql INTO v_staging_cnt USING v_snapshot_id;
        ELSIF ctx.has_local_package THEN
            SELECT coalesce((lp.summary -> 'staging_eligible_counts' ->> r.entity_family)::bigint, 0)
            INTO v_staging_cnt
            FROM stage13_local_package lp
            LIMIT 1;
        END IF;

        IF v_staging_cnt > 0 AND v_pkg_cnt = 0 THEN
            v_status := 'FAIL';
        ELSIF ctx.has_import_review AND v_staging_cnt > 0 AND v_remote_cnt = 0 AND v_pkg_cnt > 0 THEN
            v_status := 'FAIL';
        ELSIF v_staging_cnt > v_pkg_cnt THEN
            v_status := 'WARN';
        ELSIF v_pkg_cnt > 0 AND ctx.has_import_review AND v_remote_cnt < v_pkg_cnt THEN
            v_status := 'WARN';
        ELSIF v_staging_cnt = 0 AND v_pkg_cnt = 0 AND v_remote_cnt = 0 THEN
            v_status := 'SKIP';
        ELSE
            v_status := 'PASS';
        END IF;

        INSERT INTO stage13_coverage_report (
            entity_family, staging_eligible, package_items, remote_uploaded, coverage_status
        )
        VALUES (r.entity_family, v_staging_cnt, v_pkg_cnt, v_remote_cnt, v_status);
    END LOOP;

    FOREACH v_family IN ARRAY ARRAY['address_components', 'place_address_links'] LOOP
        IF NOT pg_temp.pipeline_stage11_family_enabled(v_family) THEN
            CONTINUE;
        END IF;

        v_staging_cnt := 0;
        v_pkg_cnt := 0;
        v_remote_cnt := 0;

        SELECT coalesce((
            SELECT f.rows_n FROM stage13_local_items_by_family f WHERE f.entity_family = v_family
        ), 0) INTO v_pkg_cnt;

        SELECT coalesce(max(c.uploaded_count), 0) INTO v_remote_cnt
        FROM stage13_ir_counts c
        WHERE c.entity_family = v_family;

        IF ctx.has_local_package AND v_snapshot_id IS NOT NULL THEN
            IF v_family = 'address_components'
               AND to_regclass(format('%I.staging_address_component_candidates', v_staging_schema)) IS NOT NULL THEN
                EXECUTE format(
                    'SELECT count(*)::bigint FROM %I.staging_address_component_candidates WHERE source_snapshot_id = $1',
                    v_staging_schema
                )
                INTO v_staging_cnt
                USING v_snapshot_id;
            ELSIF v_family = 'place_address_links'
               AND to_regclass(format('%I.staging_place_address_link_candidates', v_staging_schema)) IS NOT NULL THEN
                EXECUTE format(
                    'SELECT count(*)::bigint FROM %I.staging_place_address_link_candidates WHERE source_snapshot_id = $1',
                    v_staging_schema
                )
                INTO v_staging_cnt
                USING v_snapshot_id;
            ELSE
                SELECT coalesce((lp.summary -> 'staging_eligible_counts' ->> v_family)::bigint, 0)
                INTO v_staging_cnt
                FROM stage13_local_package lp
                LIMIT 1;
            END IF;
        END IF;

        IF v_staging_cnt > 0 AND v_pkg_cnt = 0 THEN
            v_status := 'FAIL';
        ELSIF ctx.has_import_review AND v_staging_cnt > 0 AND v_remote_cnt = 0 AND v_pkg_cnt > 0 THEN
            v_status := 'FAIL';
        ELSIF v_staging_cnt > v_pkg_cnt THEN
            v_status := 'WARN';
        ELSIF v_pkg_cnt > 0 AND ctx.has_import_review AND v_remote_cnt < v_pkg_cnt THEN
            v_status := 'WARN';
        ELSIF v_staging_cnt = 0 AND v_pkg_cnt = 0 AND v_remote_cnt = 0 THEN
            v_status := 'SKIP';
        ELSE
            v_status := 'PASS';
        END IF;

        INSERT INTO stage13_coverage_report (
            entity_family, staging_eligible, package_items, remote_uploaded, coverage_status
        )
        VALUES (v_family, v_staging_cnt, v_pkg_cnt, v_remote_cnt, v_status)
        ON CONFLICT (entity_family) DO UPDATE
        SET staging_eligible = excluded.staging_eligible,
            package_items = excluded.package_items,
            remote_uploaded = excluded.remote_uploaded,
            coverage_status = excluded.coverage_status;
    END LOOP;
END $cov$;

SELECT 'coverage_report'::text AS section, *
FROM stage13_coverage_report
ORDER BY entity_family;

DROP TABLE IF EXISTS stage13_family_upload_summary;
CREATE TEMP TABLE stage13_family_upload_summary (
    entity_family text PRIMARY KEY,
    import_review_table text NOT NULL,
    local_package_count bigint NOT NULL,
    remote_uploaded_count bigint NOT NULL,
    count_delta bigint NOT NULL,
    upload_status text NOT NULL
);

INSERT INTO stage13_family_upload_summary (
    entity_family,
    import_review_table,
    local_package_count,
    remote_uploaded_count,
    count_delta,
    upload_status
)
SELECT
    mf.entity_family,
    mf.import_review_table,
    coalesce(loc.rows_n, 0)::bigint AS local_package_count,
    coalesce(rem.uploaded_count, 0)::bigint AS remote_uploaded_count,
    coalesce(loc.rows_n, 0)::bigint - coalesce(rem.uploaded_count, 0)::bigint AS count_delta,
    CASE
        WHEN coalesce(loc.rows_n, 0) = 0 AND coalesce(rem.uploaded_count, 0) = 0 THEN 'SKIP'
        WHEN NOT (SELECT has_import_review FROM stage13_ctx LIMIT 1) THEN 'LOCAL_ONLY'
        WHEN coalesce(loc.rows_n, 0) > 0 AND coalesce(rem.uploaded_count, 0) = 0 THEN 'FAIL'
        WHEN coalesce(rem.uploaded_count, 0) <> coalesce(loc.rows_n, 0) THEN 'WARN'
        ELSE 'PASS'
    END AS upload_status
FROM stage13_family_manifest AS mf
LEFT JOIN stage13_local_items_by_family AS loc
    ON loc.entity_family = mf.entity_family
LEFT JOIN stage13_ir_counts AS rem
    ON rem.entity_family = mf.entity_family
    AND rem.warning IS NULL
ORDER BY mf.entity_family;

SELECT 'family_upload_summary'::text AS section, *
FROM stage13_family_upload_summary
ORDER BY entity_family;

DO $upload_fail$
DECLARE
    v_fail_n integer;
    v_fail_on boolean;
BEGIN
    SELECT fail_on_coverage_gap INTO v_fail_on FROM stage13_ctx LIMIT 1;
    IF NOT v_fail_on THEN
        RETURN;
    END IF;

    SELECT count(*)::integer INTO v_fail_n
    FROM stage13_family_upload_summary
    WHERE upload_status = 'FAIL';

    IF v_fail_n > 0 THEN
        RAISE EXCEPTION
            'stage13 upload FAIL: % selected families with local package rows but zero remote upload (see family_upload_summary)',
            v_fail_n;
    END IF;
END $upload_fail$;

DO $batch_fail$
DECLARE
    ctx stage13_ctx%ROWTYPE;
BEGIN
    SELECT * INTO ctx FROM stage13_ctx;
    IF ctx.has_import_review AND ctx.remote_batch_id IS NULL THEN
        RAISE EXCEPTION
            'stage13 FAIL: no import_review.review_batches row for package_name=% (Stage 12 upload has not run for this package)',
            ctx.package_name;
    END IF;
END $batch_fail$;

DO $fail$
DECLARE
    v_fail_n integer;
    v_fail_on boolean;
BEGIN
    SELECT fail_on_coverage_gap INTO v_fail_on FROM stage13_ctx LIMIT 1;
    IF NOT v_fail_on THEN
        RAISE NOTICE 'stage13: fail_on_coverage_gap=false — skipping coverage FAIL guard';
        RETURN;
    END IF;

    SELECT count(*)::integer INTO v_fail_n
    FROM stage13_coverage_report
    WHERE coverage_status = 'FAIL';

    IF v_fail_n > 0 THEN
        RAISE EXCEPTION 'stage13 coverage FAIL: % entity families with staging/package/remote gap (see coverage_report)',
            v_fail_n;
    END IF;
END $fail$;

\echo Stage 13 verification complete.

COMMIT;
