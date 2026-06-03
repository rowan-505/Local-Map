-- =============================================================================
-- Stage 06: promote_admin_to_core
-- Upsert staging.staging_admin_area_candidates -> core.core_admin_areas + core_admin_area_names.
-- Does not delete or soft-delete core rows.
--
-- psql variables: snapshot_version, staging_schema, raw_schema, force_recalculate_verified
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?force_recalculate_verified}
\else
\set force_recalculate_verified 'false'
\endif
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif

BEGIN;

CREATE TEMP TABLE stage06_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    raw_schema text NOT NULL,
    force_recalculate_verified boolean NOT NULL
);

INSERT INTO stage06_params (snapshot_version, staging_schema, raw_schema, force_recalculate_verified)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(nullif(trim(:'staging_schema'), ''), 'staging'),
    coalesce(nullif(trim(:'raw_schema'), ''), 'raw'),
    lower(nullif(btrim(:'force_recalculate_verified'), '')) IN ('true', 't', '1', 'yes', 'on')
);

CREATE TEMP TABLE stage06_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    osm_source_type_id bigint NOT NULL
);

CREATE TEMP TABLE stage06_result (
    staging_ready_count bigint NOT NULL,
    inserted_count bigint NOT NULL,
    updated_count bigint NOT NULL,
    skipped_verified_count bigint NOT NULL,
    names_inserted_count bigint NOT NULL,
    names_updated_count bigint NOT NULL
);

DO $stage06$
DECLARE
    p stage06_params%ROWTYPE;
    ctx stage06_context%ROWTYPE;
    q text;
    v_ready bigint;
    v_inserted bigint;
    v_updated bigint;
    v_skipped_verified bigint;
    v_names_inserted bigint;
    v_names_updated bigint;
    v_country_level_id bigint;
    v_legacy_country_merged bigint := 0;
    v_duplicate_country_deactivated bigint := 0;
    v_has_external_id boolean;
    v_area_names_guard text;
    v_has_is_verified boolean;
    v_has_verification_status boolean;
    v_has_boundary_status boolean;
    v_has_is_official_boundary boolean;
    v_has_boundary_confidence boolean;
    v_has_address_usage boolean;
    v_has_source_refs boolean;
    v_has_normalized_data boolean;
    v_has_deleted_at boolean;
    v_upd_verif text := '';
    v_ins_verif_col text := '';
    v_ins_verif_val text := '';
    v_upd_boundary text := '';
    v_ins_boundary_col text := '';
    v_ins_boundary_val text := '';
    v_skipped_verified_sql text;
    v_update_verified_guard text;
BEGIN
    SELECT * INTO p FROM stage06_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass('core.core_admin_areas') IS NULL THEN
        RAISE EXCEPTION 'core.core_admin_areas does not exist';
    END IF;

    IF to_regclass(format('%I.staging_admin_area_candidates', p.staging_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.staging_admin_area_candidates', p.staging_schema;
    END IF;

    SELECT s.id
    INTO ctx.source_snapshot_id
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF ctx.source_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'snapshot_version "%" not found', p.snapshot_version;
    END IF;

    SELECT st.id
    INTO ctx.osm_source_type_id
    FROM ref.ref_source_types AS st
    WHERE st.code = 'osm';

    IF ctx.osm_source_type_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_source_types row with code=osm is required';
    END IF;

    ctx.snapshot_version := p.snapshot_version;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'external_id'
    ) INTO v_has_external_id;

    IF NOT v_has_external_id THEN
        RAISE EXCEPTION 'core.core_admin_areas.external_id column is required for admin-fast-core promotion';
    END IF;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'is_verified'
    ) INTO v_has_is_verified;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'verification_status'
    ) INTO v_has_verification_status;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'boundary_status'
    ) INTO v_has_boundary_status;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'is_official_boundary'
    ) INTO v_has_is_official_boundary;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'boundary_confidence_score'
    ) INTO v_has_boundary_confidence;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'address_usage'
    ) INTO v_has_address_usage;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'source_refs'
    ) INTO v_has_source_refs;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'normalized_data'
    ) INTO v_has_normalized_data;

    SELECT exists (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'core' AND c.table_name = 'core_admin_areas' AND c.column_name = 'deleted_at'
    ) INTO v_has_deleted_at;

    IF v_has_is_verified AND v_has_verification_status THEN
        v_upd_verif := E',
                is_verified = false,
                verification_status = ''unverified''';
        v_ins_verif_col := E', is_verified, verification_status';
        v_ins_verif_val := E', false, ''unverified''';
    ELSIF v_has_is_verified THEN
        v_upd_verif := E',
                is_verified = false';
        v_ins_verif_col := E', is_verified';
        v_ins_verif_val := E', false';
    END IF;

    IF v_has_boundary_status AND v_has_is_official_boundary AND v_has_boundary_confidence AND v_has_address_usage THEN
        v_upd_boundary := E',
                boundary_status = ''official'',
                is_official_boundary = true,
                boundary_confidence_score = 80,
                address_usage = ''official''';
        v_ins_boundary_col := E', boundary_status, is_official_boundary, boundary_confidence_score, address_usage';
        v_ins_boundary_val := E', ''official'', true, 80, ''official''';
    END IF;

    IF v_has_is_verified THEN
        v_skipped_verified_sql := $skip$
            SELECT count(*)::bigint AS n
            FROM ready AS r
            INNER JOIN core.core_admin_areas AS ca
                ON ca.external_id = r.external_id
            WHERE coalesce(ca.is_verified, false) = true
              AND NOT $4::boolean
        $skip$;
        v_update_verified_guard := $guard$
              AND (
                  coalesce(ca.is_verified, false) = false
                  OR $4::boolean = true
              )
        $guard$;
    ELSE
        v_skipped_verified_sql := 'SELECT 0::bigint AS n';
        v_update_verified_guard := '';
    END IF;

    IF v_has_is_verified THEN
        v_area_names_guard := $ng$
              AND (
                  coalesce(ca.is_verified, false) = false
                  OR $2::boolean = true
              )
        $ng$;
    ELSE
        v_area_names_guard := '';
    END IF;

    IF to_regclass('core.core_admin_area_names') IS NULL THEN
        RAISE EXCEPTION 'core.core_admin_area_names does not exist';
    END IF;

    SELECT levels.id
    INTO v_country_level_id
    FROM ref.ref_admin_levels AS levels
    WHERE levels.code = 'country'
    LIMIT 1;

    IF v_country_level_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_admin_levels row with code=country is required';
    END IF;

    q := format(
        $q$
        WITH legacy_country AS (
            SELECT ca.id
            FROM core.core_admin_areas AS ca
            WHERE ca.admin_level_id = $1
              AND coalesce(ca.is_active, true)
              AND (ca.external_id IS NULL OR btrim(ca.external_id) = '')
              AND btrim(ca.canonical_name) = 'မြန်မာ'
            ORDER BY ca.id
            LIMIT 1
        ),
        deactivated_dup_country AS (
            UPDATE core.core_admin_areas AS ca
            SET
                is_active = false,
                slug = 'inactive-admin-' || ca.id::text,
                external_id = NULL,
                updated_at = now()
            WHERE ca.admin_level_id = $1
              AND coalesce(ca.is_active, true)
              AND (
                  NOT EXISTS (SELECT 1 FROM legacy_country)
                  OR ca.id NOT IN (SELECT id FROM legacy_country)
              )
            RETURNING ca.id
        )
        SELECT count(*)::bigint FROM deactivated_dup_country
        $q$
    );

    EXECUTE q
        USING v_country_level_id;
    GET DIAGNOSTICS v_duplicate_country_deactivated = ROW_COUNT;

    q := format(
        $q$
        WITH ready_country AS (
            SELECT
                s.id AS staging_id,
                s.external_id,
                s.canonical_name,
                s.admin_level_id,
                coalesce(s.source_refs, '{}'::jsonb) AS source_refs,
                coalesce(s.normalized_data, '{}'::jsonb) AS normalized_data,
                ST_Multi(ST_MakeValid(s.geom))::geometry(MultiPolygon, 4326) AS geom,
                coalesce(s.centroid, ST_PointOnSurface(ST_Multi(ST_MakeValid(s.geom))))::geometry(Point, 4326) AS centroid
            FROM %I.staging_admin_area_candidates AS s
            WHERE s.source_snapshot_id = $1
              AND coalesce(s.source_refs->>'pipeline', '') = 'admin-fast-core'
              AND s.admin_level_id = $2
              AND s.external_id IS NOT NULL
              AND btrim(s.external_id) <> ''
              AND s.geom IS NOT NULL
              AND ST_IsValid(s.geom)
              AND NOT ST_IsEmpty(s.geom)
              AND ST_SRID(s.geom) = 4326
              AND s.centroid IS NOT NULL
              AND ST_IsValid(s.centroid)
              AND s.canonical_name IS NOT NULL
              AND btrim(s.canonical_name) <> ''
            ORDER BY s.id
            LIMIT 1
        ),
        legacy_country AS (
            SELECT ca.id
            FROM core.core_admin_areas AS ca
            WHERE ca.admin_level_id = $2
              AND coalesce(ca.is_active, true)
              AND (ca.external_id IS NULL OR btrim(ca.external_id) = '')
              AND btrim(ca.canonical_name) = 'မြန်မာ'
            ORDER BY ca.id
            LIMIT 1
        ),
        merged_legacy AS (
            UPDATE core.core_admin_areas AS ca
            SET
                external_id = r.external_id,
                slug = r.external_id,
                canonical_name = r.canonical_name,
                geom = r.geom,
                centroid = r.centroid,
                is_active = true,
                updated_at = now()%s%s
            FROM ready_country AS r
            CROSS JOIN legacy_country AS legacy
            WHERE ca.id = legacy.id
            RETURNING ca.id
        )
        SELECT count(*)::bigint FROM merged_legacy
        $q$,
        p.staging_schema,
        CASE WHEN v_has_source_refs THEN E',
                source_refs = coalesce(ca.source_refs, ''{}''::jsonb)
                    || jsonb_build_object(
                        ''admin_fast_core_legacy_country_merge'', jsonb_build_object(
                            ''merged_at'', to_jsonb(now()),
                            ''previous_external_id'', ca.external_id,
                            ''osm_external_id'', r.external_id
                        )
                    )
                    || r.source_refs
                    || jsonb_build_object(
                        ''promoted_by'', ''admin-fast-core'',
                        ''promoted_at'', to_jsonb(now()),
                        ''staging_id'', r.staging_id
                    )' ELSE '' END,
        CASE WHEN v_has_normalized_data THEN E',
                normalized_data = coalesce(ca.normalized_data, ''{}''::jsonb)
                    || r.normalized_data
                    || jsonb_build_object(
                        ''promotion'', jsonb_build_object(
                            ''pipeline'', ''admin-fast-core'',
                            ''snapshot_version'', $3
                        )
                    )' ELSE '' END
    );

    EXECUTE q INTO v_legacy_country_merged
        USING
            ctx.source_snapshot_id,
            v_country_level_id,
            ctx.snapshot_version;

    q := format(
        $q$
        WITH staging_rows AS (
            SELECT
                s.id AS staging_id,
                s.raw_id,
                s.external_id,
                s.canonical_name,
                s.admin_level_id,
                coalesce(s.normalized_data, '{}'::jsonb) AS normalized_data,
                coalesce(s.source_refs, '{}'::jsonb) AS source_refs,
                ST_Multi(ST_MakeValid(s.geom))::geometry(MultiPolygon, 4326) AS geom,
                coalesce(s.centroid, ST_PointOnSurface(ST_Multi(ST_MakeValid(s.geom))))::geometry(Point, 4326) AS centroid
            FROM %I.staging_admin_area_candidates AS s
            WHERE s.source_snapshot_id = $1
              AND coalesce(s.source_refs->>'pipeline', '') = 'admin-fast-core'
        ),
        ready AS (
            SELECT
                r.*,
                $2::bigint AS source_type_id,
                r.external_id AS slug,
                r.source_refs || jsonb_build_object(
                    'promoted_by', 'admin-fast-core',
                    'promoted_at', to_jsonb(now()),
                    'staging_id', r.staging_id
                ) AS merged_source_refs,
                r.normalized_data || jsonb_build_object(
                    'promotion', jsonb_build_object(
                        'pipeline', 'admin-fast-core',
                        'snapshot_version', $3
                    )
                ) AS merged_normalized_data
            FROM staging_rows AS r
            WHERE r.geom IS NOT NULL
              AND ST_IsValid(r.geom)
              AND NOT ST_IsEmpty(r.geom)
              AND ST_SRID(r.geom) = 4326
              AND r.centroid IS NOT NULL
              AND ST_IsValid(r.centroid)
              AND r.external_id IS NOT NULL
              AND btrim(r.external_id) <> ''
              AND r.canonical_name IS NOT NULL
              AND btrim(r.canonical_name) <> ''
              AND r.admin_level_id IS NOT NULL
        ),
        skipped_verified AS (
            %s
        ),
        updated AS (
            UPDATE core.core_admin_areas AS ca
            SET
                canonical_name = r.canonical_name,
                slug = r.slug,
                admin_level_id = r.admin_level_id,
                geom = r.geom,
                centroid = r.centroid,
                is_active = true,
                updated_at = now()%s%s%s%s
            FROM ready AS r
            WHERE ca.external_id = r.external_id
              %s
              %s
            RETURNING id
        ),
        inserted AS (
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
                external_id%s%s%s%s,
                created_at,
                updated_at
            )
            SELECT
                gen_random_uuid(),
                NULL::bigint,
                r.admin_level_id,
                r.canonical_name,
                r.slug,
                r.geom,
                r.centroid,
                r.source_type_id,
                true,
                r.external_id%s%s%s%s,
                now(),
                now()
            FROM ready AS r
            WHERE NOT EXISTS (
                SELECT 1
                FROM core.core_admin_areas AS ca
                WHERE ca.external_id = r.external_id
            )
              AND NOT (
                  r.admin_level_id = $5
                  AND EXISTS (
                      SELECT 1
                      FROM core.core_admin_areas AS legacy
                      WHERE legacy.admin_level_id = $5
                        AND btrim(legacy.canonical_name) = 'မြန်မာ'
                        AND legacy.external_id = r.external_id
                  )
              )
            RETURNING id
        )
        SELECT
            (SELECT count(*)::bigint FROM ready),
            (SELECT count(*)::bigint FROM inserted),
            (SELECT count(*)::bigint FROM updated),
            (SELECT n FROM skipped_verified)
        $q$,
        p.staging_schema,
        v_skipped_verified_sql,
        CASE WHEN v_has_source_refs THEN E', source_refs = r.merged_source_refs' ELSE '' END,
        CASE WHEN v_has_normalized_data THEN E', normalized_data = r.merged_normalized_data' ELSE '' END,
        v_upd_verif,
        v_upd_boundary,
        v_update_verified_guard,
        CASE
            WHEN v_has_deleted_at THEN E'AND ca.deleted_at IS NULL'
            ELSE ''
        END,
        CASE WHEN v_has_source_refs THEN E', source_refs' ELSE '' END,
        v_ins_verif_col,
        v_ins_boundary_col,
        CASE WHEN v_has_normalized_data THEN E', normalized_data' ELSE '' END,
        CASE WHEN v_has_source_refs THEN E', r.merged_source_refs' ELSE '' END,
        v_ins_verif_val,
        v_ins_boundary_val,
        CASE WHEN v_has_normalized_data THEN E', r.merged_normalized_data' ELSE '' END
    );

    EXECUTE q INTO v_ready, v_inserted, v_updated, v_skipped_verified
        USING
            ctx.source_snapshot_id,
            ctx.osm_source_type_id,
            ctx.snapshot_version,
            p.force_recalculate_verified,
            v_country_level_id;

    q := format(
        $q$
        UPDATE %I.staging_admin_area_candidates AS s
        SET
            matched_core_admin_area_id = ca.id,
            updated_at = now()
        FROM core.core_admin_areas AS ca
        WHERE s.source_snapshot_id = $1
          AND coalesce(s.source_refs->>'pipeline', '') = 'admin-fast-core'
          AND ca.external_id = s.external_id
        $q$,
        p.staging_schema
    );
    EXECUTE q USING ctx.source_snapshot_id;

    IF v_ready = 0 THEN
        RAISE EXCEPTION 'Stage 06: no valid staging admin candidates for snapshot %', ctx.snapshot_version;
    END IF;

    q := format(
        $q$
        WITH promoted_areas AS (
            SELECT
                ca.id AS admin_area_id,
                s.external_id,
                coalesce(raw.tags, '{}'::jsonb) AS tags,
                coalesce(s.normalized_data, '{}'::jsonb) AS normalized_data
            FROM %I.staging_admin_area_candidates AS s
            INNER JOIN core.core_admin_areas AS ca
                ON ca.external_id = s.external_id
            LEFT JOIN %I.raw_osm_polygons AS raw
                ON raw.id = s.raw_id
               AND raw.source_snapshot_id = s.source_snapshot_id
            WHERE s.source_snapshot_id = $1
              AND coalesce(s.source_refs->>'pipeline', '') = 'admin-fast-core'
              %s
        ),
        tag_values AS (
            SELECT
                p.admin_area_id,
                coalesce(nullif(btrim(p.tags->>'name:my'), ''), nullif(btrim(p.normalized_data->>'name:my'), '')) AS name_my,
                coalesce(nullif(btrim(p.tags->>'name'), ''), nullif(btrim(p.normalized_data->>'name'), '')) AS name_default,
                coalesce(nullif(btrim(p.tags->>'name:en'), ''), nullif(btrim(p.normalized_data->>'name:en'), '')) AS name_en,
                coalesce(nullif(btrim(p.tags->>'official_name'), ''), nullif(btrim(p.normalized_data->>'official_name'), '')) AS official_name,
                coalesce(nullif(btrim(p.tags->>'alt_name'), ''), nullif(btrim(p.normalized_data->>'alt_name'), '')) AS alt_name
            FROM promoted_areas AS p
        ),
        name_rows AS (
            SELECT
                tv.admin_area_id,
                n.name_value AS name,
                n.language_code,
                n.name_type,
                n.search_weight,
                n.priority
            FROM tag_values AS tv
            CROSS JOIN LATERAL (
                VALUES
                    (tv.name_my, 'my', 'official', 100, 1),
                    (tv.name_default, 'und', 'official', 100, 2),
                    (tv.name_en, 'en', 'official', 90, 3),
                    (tv.official_name, 'und', 'official', 90, 4),
                    (tv.alt_name, 'und', 'alternate', 50, 5)
            ) AS n(name_value, language_code, name_type, search_weight, priority)
            WHERE n.name_value IS NOT NULL
              AND btrim(n.name_value) <> ''
        ),
        deduped_names AS (
            SELECT DISTINCT ON (nr.admin_area_id, nr.language_code, nr.name_type, nr.name)
                nr.admin_area_id,
                nr.name,
                nr.language_code,
                nr.name_type,
                nr.search_weight,
                nr.priority
            FROM name_rows AS nr
            ORDER BY
                nr.admin_area_id,
                nr.language_code,
                nr.name_type,
                nr.name,
                nr.priority
        ),
        best_primary AS (
            SELECT DISTINCT ON (dn.admin_area_id)
                dn.admin_area_id,
                dn.name,
                dn.language_code,
                dn.name_type
            FROM deduped_names AS dn
            ORDER BY dn.admin_area_id, dn.priority
        ),
        cleared_primary AS (
            UPDATE core.core_admin_area_names AS existing
            SET is_primary = false
            FROM promoted_areas AS pa
            WHERE existing.admin_area_id = pa.admin_area_id
            RETURNING existing.id
        ),
        updated_names AS (
            UPDATE core.core_admin_area_names AS existing
            SET
                search_weight = dn.search_weight,
                is_primary = false
            FROM deduped_names AS dn
            WHERE existing.admin_area_id = dn.admin_area_id
              AND existing.language_code IS NOT DISTINCT FROM dn.language_code
              AND existing.name_type = dn.name_type
              AND existing.name = dn.name
            RETURNING existing.id
        ),
        inserted_names AS (
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
                dn.admin_area_id,
                dn.name,
                dn.language_code,
                NULL::text,
                dn.name_type,
                false,
                dn.search_weight
            FROM deduped_names AS dn
            WHERE NOT EXISTS (
                SELECT 1
                FROM core.core_admin_area_names AS existing
                WHERE existing.admin_area_id = dn.admin_area_id
                  AND existing.language_code IS NOT DISTINCT FROM dn.language_code
                  AND existing.name_type = dn.name_type
                  AND existing.name = dn.name
            )
            RETURNING id
        ),
        marked_primary AS (
            UPDATE core.core_admin_area_names AS existing
            SET is_primary = true
            FROM best_primary AS bp
            WHERE existing.admin_area_id = bp.admin_area_id
              AND existing.language_code IS NOT DISTINCT FROM bp.language_code
              AND existing.name_type = bp.name_type
              AND existing.name = bp.name
            RETURNING existing.id
        )
        SELECT
            (SELECT count(*)::bigint FROM inserted_names),
            (SELECT count(*)::bigint FROM updated_names)
        $q$,
        p.staging_schema,
        p.raw_schema,
        v_area_names_guard
    );

    EXECUTE q INTO v_names_inserted, v_names_updated
        USING ctx.source_snapshot_id, p.force_recalculate_verified;

    INSERT INTO stage06_result (
        staging_ready_count,
        inserted_count,
        updated_count,
        skipped_verified_count,
        names_inserted_count,
        names_updated_count
    )
    VALUES (v_ready, v_inserted, v_updated, v_skipped_verified, v_names_inserted, v_names_updated);
END
$stage06$;

SELECT
    ctx.snapshot_version,
    ctx.source_snapshot_id,
    r.staging_ready_count,
    r.inserted_count,
    r.updated_count,
    r.skipped_verified_count,
    r.names_inserted_count,
    r.names_updated_count
FROM stage06_context AS ctx
CROSS JOIN stage06_result AS r;

COMMIT;
