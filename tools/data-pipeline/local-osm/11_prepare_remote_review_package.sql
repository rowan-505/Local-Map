-- =============================================================================
-- Stage J: prepare_remote_review_package (local-only)
-- -----------------------------------------------------------------------------
-- After Stage G, copy staging review-ready candidates plus latest F2 diff slice
-- into system.system_remote_review_packages / *_items for outbound tooling.
-- Each `_items.payload` echoes `source_snapshot_version`, `snapshot_version`,
-- `source_snapshot_id_local`, and `family` for Stage `14_verify_lineage_alignment.sql`.
--
-- Not implemented here: HTTPS upload / Supabase import_review insert.
--
-- psql vars:
--   snapshot_version        (required)
--   staging_schema          optional → default staging
--   entity_family           optional → narrow to one slug; blank = manifest set
--   max_rows_per_family     optional integer string; blank = unlimited
--   package_name            optional; blank → auto name from snapshot_version + UTC
--   replace_package         optional literal true|false; default false (delete+recreate same name when true)
--
-- Example (from repo: tools/data-pipeline/local-osm):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v snapshot_version="$SNAPSHOT_VERSION" \
--        -v entity_family="" \
--        -v max_rows_per_family="" \
--        -v package_name="" \
--        -v replace_package=false \
--        -f ./11_prepare_remote_review_package.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

\if :{?entity_family}
\else
\set entity_family ''
\endif

\if :{?max_rows_per_family}
\else
\set max_rows_per_family ''
\endif

\if :{?package_name}
\else
\set package_name ''
\endif

\if :{?replace_package}
\else
\set replace_package false
\endif

BEGIN;

create schema if not exists system;

create table if not exists system.system_remote_review_packages (
    id bigserial primary key,
    package_name text not null unique,
    source_snapshot_id bigint not null references system.system_source_snapshots (id),
    snapshot_version text not null,
    region_code text,
    status text not null default 'prepared',
    entity_families text[],
    total_item_count integer not null default 0,
    summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    uploaded_at timestamptz,
    remote_review_batch_id bigint,
    remote_upload_status text,
    note text,
    constraint system_remote_review_packages_status_nonempty_chk check (btrim(status) <> '')
);

create table if not exists system.system_remote_review_package_items (
    id bigserial primary key,
    package_id bigint not null references system.system_remote_review_packages (id) on delete cascade,
    entity_family text not null,
    source_table text not null,
    local_staging_id bigint not null,
    external_id text,
    match_status text,
    auto_action text,
    review_status text,
    review_decision text,
    confidence_score numeric,
    canonical_name text,
    class_code text,
    normalized_data jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    review_overrides jsonb not null default '{}'::jsonb,
    matched_core_id bigint,
    matched_core_table text,
    matched_core_data jsonb,
    f2_comparison jsonb,
    geometry_geojson jsonb,
    payload jsonb not null default '{}'::jsonb,
    upload_status text not null default 'pending',
    remote_candidate_id bigint,
    created_at timestamptz not null default now()
);

create index if not exists system_remote_review_pkg_items_pkg_idx
    on system.system_remote_review_package_items (package_id);

create index if not exists system_remote_review_pkg_items_family_idx
    on system.system_remote_review_package_items (entity_family);

create index if not exists system_remote_review_pkg_items_upload_stat_idx
    on system.system_remote_review_package_items (upload_status);

create index if not exists system_remote_review_pkg_snapver_idx
    on system.system_remote_review_packages (snapshot_version);

DROP TABLE IF EXISTS stage11_params;

CREATE TEMPORARY TABLE stage11_params (
    snapshot_version text not null,
    staging_schema text not null,
    entity_family_filter text not null DEFAULT '',
    max_rows_per_family integer,
    package_name_input text,
    replace_package boolean not null DEFAULT false
);

INSERT INTO stage11_params (
    snapshot_version,
    staging_schema,
    entity_family_filter,
    max_rows_per_family,
    package_name_input,
    replace_package
)
VALUES (
    NULLIF(trim(:'snapshot_version'), ''),
    lower(trim(coalesce(NULLIF(trim(:'staging_schema'), ''), 'staging'))),
    coalesce(lower(trim(coalesce(NULLIF(trim(:'entity_family'), ''), ''))), ''),
    CASE
        WHEN trim(:'max_rows_per_family') = '' THEN NULL
        ELSE NULLIF(trim(:'max_rows_per_family'), '')::integer
    END,
    NULLIF(trim(:'package_name'), ''),
    :replace_package
);

DO $v$
BEGIN
    IF EXISTS (SELECT 1 FROM stage11_params WHERE snapshot_version IS NULL) THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
END
$v$;

DROP TABLE IF EXISTS stage11_context;

CREATE TEMPORARY TABLE stage11_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text,
    staging_schema text NOT NULL
);

INSERT INTO stage11_context (
    source_snapshot_id,
    snapshot_version,
    region_code,
    staging_schema
)
SELECT
    s.id,
    s.snapshot_version,
    s.region_code,
    p.staging_schema
FROM system.system_source_snapshots AS s
INNER JOIN stage11_params AS p
    ON p.snapshot_version = s.snapshot_version;

DO $uniq$
DECLARE
    n integer := 0;
BEGIN
    SELECT count(*) INTO STRICT n FROM stage11_context;

    IF n = 0 THEN
        RAISE EXCEPTION
            'snapshot_version "%" missing in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage11_params LIMIT 1);

    ELSIF n > 1 THEN
        RAISE EXCEPTION
            'snapshot_version "%" matches % snapshots (expected exactly 1)',
            (SELECT snapshot_version FROM stage11_params LIMIT 1),
            n;

    END IF;
END
$uniq$;

DROP TABLE IF EXISTS stage11_manifest;

CREATE TEMPORARY TABLE stage11_manifest (
    entity_family text primary key,
    implemented boolean NOT NULL DEFAULT false
);

INSERT INTO stage11_manifest (entity_family, implemented)
VALUES
    ('buildings', true),
    ('places', true),
    ('roads', true),
    ('bus_stops', true),
    ('landuse', true),
    ('water_lines', true),
    ('water_polygons', true),
    ('addresses', true),
    ('admin_areas', true),
    ('routing_barriers', true);

DROP TABLE IF EXISTS stage11_family_export;

CREATE TEMPORARY TABLE stage11_family_export (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL,
    diff_entity_family text NOT NULL,
    matched_core_table text,
    matched_core_id_col text,
    geom_expr text NOT NULL,
    class_code_expr text NOT NULL,
    canonical_expr text NOT NULL,
    child_table text,
    child_fk_col text,
    child_package_key text,
    child_nd_key text,
    eligibility_geom_expr text NOT NULL,
    extra_payload_expr text NOT NULL DEFAULT '{}'::text
);

INSERT INTO stage11_family_export (
    entity_family, staging_table, diff_entity_family, matched_core_table, matched_core_id_col,
    geom_expr, class_code_expr, canonical_expr,
    child_table, child_fk_col, child_package_key, child_nd_key, eligibility_geom_expr, extra_payload_expr
)
VALUES
    ('buildings', 'staging_building_candidates', 'buildings', 'core_map_buildings', NULL,
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     's.class_code::text', 's.canonical_name::text', NULL, NULL, NULL, NULL, 's.geom IS NOT NULL', '''{}''::jsonb'),
    ('places', 'staging_place_candidates', 'places', 'core_places', 'matched_core_place_id',
     'CASE WHEN s.point_geom IS NOT NULL THEN ST_AsGeoJSON(s.point_geom)::jsonb END',
     'coalesce(nullif(trim(s.class_code::text), ''''), nullif(trim(s.normalized_data ->> ''class_code''), ''''))',
     's.canonical_name::text', 'staging_place_name_candidates', 'place_candidate_id', 'place_name_candidates', NULL,
     's.point_geom IS NOT NULL',
     'jsonb_build_object(''place_class_id'', s.place_class_id, ''poi_category_id'', s.poi_category_id, ''source_entity_type'', s.source_entity_type)'),
    ('roads', 'staging_road_candidates', 'roads', 'core_streets', 'matched_core_edge_id',
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'coalesce(nullif(trim(s.class_code::text), ''''), nullif(trim(s.normalized_data ->> ''class_code''), ''''), nullif(trim(s.normalized_data ->> ''highway''), ''''))',
     's.canonical_name::text', 'staging_road_name_candidates', 'road_candidate_id', 'road_name_candidates', NULL,
     's.geom IS NOT NULL',
     'jsonb_build_object(''road_class_id'', s.road_class_id)'),
    ('bus_stops', 'staging_bus_stop_candidates', 'bus_stops', 'core_bus_stops', 'matched_core_bus_stop_id',
     'CASE WHEN s.point_geom IS NOT NULL THEN ST_AsGeoJSON(s.point_geom)::jsonb END',
     'NULL::text', 's.canonical_name::text', 'staging_bus_stop_name_candidates', 'bus_stop_candidate_id', 'bus_stop_name_candidates', NULL,
     's.point_geom IS NOT NULL',
     'jsonb_build_object(''name'', s.canonical_name, ''name_local'', s.normalized_data ->> ''name_local'', ''stop_code'', s.normalized_data ->> ''stop_code'', ''admin_area_id'', s.normalized_data ->> ''admin_area_id'', ''admin_area_candidate_id'', s.admin_area_candidate_id)'),
    ('landuse', 'staging_landuse_candidates', 'landuse', 'core_map_landuse', NULL,
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     's.class_code::text', 's.canonical_name::text', NULL, NULL, NULL, NULL,
     's.geom IS NOT NULL',
     'jsonb_build_object(''name'', s.canonical_name, ''centroid_geojson'', CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(ST_Centroid(s.geom))::jsonb END)'),
    ('water_lines', 'staging_water_line_candidates', 'water_lines', 'core_map_water_lines', NULL,
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'coalesce(nullif(trim(s.class_code::text), ''''), nullif(trim(s.canonical_name::text), ''''))',
     's.canonical_name::text', NULL, NULL, NULL, NULL,
     's.geom IS NOT NULL',
     'jsonb_build_object(''name'', s.canonical_name)'),
    ('water_polygons', 'staging_water_polygon_candidates', 'water_polygons', 'core_map_water_polygons', NULL,
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'coalesce(nullif(trim(s.class_code::text), ''''), nullif(trim(s.canonical_name::text), ''''))',
     's.canonical_name::text', NULL, NULL, NULL, NULL,
     's.geom IS NOT NULL',
     'jsonb_build_object(''name'', s.canonical_name, ''centroid_geojson'', CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(ST_Centroid(s.geom))::jsonb END)'),
    ('addresses', 'staging_address_candidates', 'addresses', 'core_addresses', 'matched_core_address_id',
     'CASE WHEN s.point_geom IS NOT NULL THEN ST_AsGeoJSON(s.point_geom)::jsonb WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'NULL::text', 'coalesce(nullif(trim(s.full_address), ''''), s.external_id::text)',
     'staging_address_component_candidates', 'address_candidate_id', 'address_components', 'address_components',
     '(s.point_geom IS NOT NULL OR s.geom IS NOT NULL)',
     'jsonb_build_object(''full_address'', s.full_address, ''house_number'', s.house_number, ''unit_number'', s.normalized_data ->> ''unit_number'', ''street_id'', s.normalized_data ->> ''street_id'', ''admin_area_id'', s.normalized_data ->> ''admin_area_id'', ''street_name'', s.street_name, ''quarter'', s.quarter, ''suburb'', s.suburb, ''township'', s.township, ''city'', s.city, ''district'', s.district, ''state_region'', s.state_region, ''postcode'', s.postcode, ''country'', s.country, ''postal_code'', coalesce(s.normalized_data ->> ''postal_code'', s.postcode), ''plus_code'', s.normalized_data ->> ''plus_code'', ''entrance_geom_geojson'', s.normalized_data -> ''entrance_geom_geojson'')'),
    ('admin_areas', 'staging_admin_area_candidates', 'admin_areas', 'core_admin_areas', 'matched_core_admin_area_id',
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'NULL::text', 's.canonical_name::text', 'staging_admin_area_name_candidates', 'admin_area_candidate_id', 'names', 'names',
     's.geom IS NOT NULL',
     'jsonb_build_object(''admin_level_id'', s.admin_level_id, ''parent_id'', s.parent_candidate_id, ''parent_candidate_id'', s.parent_candidate_id, ''slug'', s.normalized_data ->> ''slug'', ''centroid_geojson'', CASE WHEN s.centroid IS NOT NULL THEN ST_AsGeoJSON(s.centroid)::jsonb END)'),
    ('routing_barriers', 'staging_routing_barrier_candidates', 'routing_barriers', NULL, NULL,
     'CASE WHEN s.point_geom IS NOT NULL THEN ST_AsGeoJSON(s.point_geom)::jsonb WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'coalesce(nullif(trim(s.barrier_type), ''''))',
     'coalesce(nullif(trim(s.barrier_type), ''''), s.external_id::text)',
     NULL, NULL, NULL, NULL,
     '(s.point_geom IS NOT NULL OR s.geom IS NOT NULL)',
     'jsonb_build_object(''barrier_type'', s.barrier_type, ''raw_table'', s.raw_table, ''raw_id'', s.raw_id)');

DELETE FROM stage11_manifest mf
WHERE (SELECT trim(entity_family_filter) <> '' FROM stage11_params LIMIT 1)
  AND mf.entity_family <> (SELECT trim(entity_family_filter) FROM stage11_params LIMIT 1);

DO $ef$
BEGIN
    IF trim((SELECT entity_family_filter FROM stage11_params LIMIT 1)) = '' THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM stage11_manifest mf
        WHERE mf.entity_family = trim((SELECT entity_family_filter FROM stage11_params LIMIT 1))
    ) THEN
        RAISE EXCEPTION
            'unsupported entity_family "%"',
            trim((SELECT entity_family_filter FROM stage11_params LIMIT 1));
    END IF;
END
$ef$;

DO $impl$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM stage11_manifest WHERE implemented) THEN
        RAISE EXCEPTION
            'stage11: filtered entity_family has no exporters in manifest.';
    END IF;
END
$impl$;

DROP TABLE IF EXISTS stage11_last_pkg;

CREATE TEMPORARY TABLE stage11_last_pkg (
    pkg_id bigint not null primary key,
    pkg_name text not null
);

-- Core work
DO $core$
DECLARE
    prm stage11_params%ROWTYPE;
    ctx stage11_context%ROWTYPE;
    v_pkg_name text;
    v_old_id bigint;
    v_pkg_id bigint;
    v_schema text;
    j_ms jsonb;
    j_aa jsonb;
    j_ef jsonb;
    j_staging jsonb;
    v_tot bigint := 0;
    v_staging_cnt bigint;
    v_eligible_sql text;
    v_fe stage11_family_export%ROWTYPE;
    v_sql text;
    v_child_join text;
    v_child_nd text;
    v_child_sr text;
    v_matched_col text;
    v_matched_table_expr text;
BEGIN
    SELECT * INTO STRICT prm FROM stage11_params;
    SELECT * INTO STRICT ctx FROM stage11_context;
    v_schema := ctx.staging_schema;

    IF NOT EXISTS (
        SELECT 1
        FROM stage11_family_export fe
        INNER JOIN stage11_manifest mf
            ON mf.entity_family = fe.entity_family AND mf.implemented
        WHERE to_regclass(format('%I.%I', v_schema, fe.staging_table)) IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'staging schema "%" has no implemented candidate tables for Stage J export.',
            v_schema;
    END IF;

    v_pkg_name := coalesce(
        nullif(trim(prm.package_name_input), ''),
        format(
            'remote_review_pkg_%s_%s',
            regexp_replace(trim(ctx.snapshot_version), '[^[:alnum:]_]+', '_', 'g'),
            lower(to_char((clock_timestamp() AT TIME ZONE 'utc'), 'YYYYMMDDHH24MISS'))
        )
    );

    SELECT id INTO v_old_id FROM system.system_remote_review_packages WHERE package_name = v_pkg_name;

    IF v_old_id IS NOT NULL THEN
        IF NOT prm.replace_package THEN
            RAISE EXCEPTION USING
                MESSAGE = format('package_name "%s" already exists (id=%s)', v_pkg_name, v_old_id),
                HINT = 'Re-run with -v replace_package=true to replace items safely.';
        END IF;

        DELETE FROM system.system_remote_review_packages WHERE id = v_old_id;
        RAISE NOTICE 'stage11_replace: removed existing package id=% name=%', v_old_id, v_pkg_name;
    END IF;

    INSERT INTO system.system_remote_review_packages (
        package_name,
        source_snapshot_id,
        snapshot_version,
        region_code,
        status,
        entity_families,
        summary
    )
    VALUES (
        v_pkg_name,
        ctx.source_snapshot_id,
        ctx.snapshot_version,
        ctx.region_code,
        'prepared',
        (
            SELECT coalesce(array_agg(m.entity_family ORDER BY m.entity_family), ARRAY[]::text[])
            FROM stage11_manifest m
            WHERE m.implemented
        ),
        jsonb_strip_nulls(
            jsonb_build_object(
                'pipeline_stage', 'J_prepare_remote_review_package',
                'snapshot_version', ctx.snapshot_version
            )
        )
    )
    RETURNING id INTO STRICT v_pkg_id;

    ------------------------------------------------------------------
    -- Generic export: all families in stage11_family_export × manifest
    ------------------------------------------------------------------
    FOR v_fe IN
        SELECT fe.*
        FROM stage11_family_export AS fe
        INNER JOIN stage11_manifest AS mf
            ON mf.entity_family = fe.entity_family AND mf.implemented
        ORDER BY fe.entity_family
    LOOP
        IF to_regclass(format('%I.%I', v_schema, v_fe.staging_table)) IS NULL THEN
            RAISE NOTICE 'stage11_skip family=% missing table %.%',
                v_fe.entity_family, v_schema, v_fe.staging_table;
            CONTINUE;
        END IF;

        v_child_join := '';
        v_child_nd := '''{}''::jsonb';
        v_child_sr := '''{}''::jsonb';
        IF v_fe.child_table IS NOT NULL AND v_fe.child_fk_col IS NOT NULL THEN
            IF to_regclass(format('%I.%I', v_schema, v_fe.child_table)) IS NOT NULL THEN
                v_child_join := format(
                    $cj$
LEFT JOIN LATERAL (
    SELECT coalesce(
        jsonb_agg(
            jsonb_strip_nulls(to_jsonb(cn) - 'source_snapshot_id')
            ORDER BY cn.id
        ),
        '[]'::jsonb
    ) AS child_rows
    FROM %I.%I AS cn
    WHERE cn.%I = s.id
      AND cn.source_snapshot_id = s.source_snapshot_id
) AS child ON true
$cj$,
                    v_schema,
                    v_fe.child_table,
                    v_fe.child_fk_col
                );
                IF v_fe.child_nd_key IS NOT NULL AND btrim(v_fe.child_nd_key) <> '' THEN
                    v_child_nd := format(
                        'coalesce(s.normalized_data, ''{}''::jsonb) || jsonb_build_object(%L, coalesce(child.child_rows, ''[]''::jsonb))',
                        v_fe.child_nd_key
                    );
                ELSE
                    v_child_nd := format(
                        'coalesce(s.normalized_data, ''{}''::jsonb) || jsonb_build_object(''_child_%s'', coalesce(child.child_rows, ''[]''::jsonb))',
                        v_fe.child_package_key
                    );
                END IF;
                v_child_sr := format(
                    'coalesce(s.source_refs, ''{}''::jsonb) || jsonb_build_object(''%s'', coalesce(child.child_rows, ''[]''::jsonb))',
                    v_fe.child_package_key
                );
            ELSE
                RAISE NOTICE 'stage11_warn family=% child table %.% missing; exporting parent only',
                    v_fe.entity_family, v_schema, v_fe.child_table;
                v_child_nd := 'coalesce(s.normalized_data, ''{}''::jsonb)';
                v_child_sr := 'coalesce(s.source_refs, ''{}''::jsonb)';
            END IF;
        ELSE
            v_child_nd := 'coalesce(s.normalized_data, ''{}''::jsonb)';
            v_child_sr := 'coalesce(s.source_refs, ''{}''::jsonb)';
        END IF;

        IF v_fe.matched_core_id_col IS NOT NULL AND btrim(v_fe.matched_core_id_col) <> '' THEN
            v_matched_col := format('coalesce(f.core_id_hint, s.%I)', v_fe.matched_core_id_col);
        ELSE
            v_matched_col := 'f.core_id_hint';
        END IF;

        IF v_fe.matched_core_table IS NOT NULL THEN
            v_matched_table_expr := format(
                $mt$
CASE
    WHEN coalesce(f.core_before, '{}'::jsonb) <> '{}'::jsonb THEN %L::text
    WHEN %s IS NOT NULL THEN %L::text
    ELSE NULL::text
END
$mt$,
                v_fe.matched_core_table,
                v_matched_col,
                v_fe.matched_core_table
            );
        ELSE
            v_matched_table_expr := 'NULL::text';
        END IF;

        v_sql := format(
            $ex$
WITH latest_slice AS (
    SELECT DISTINCT ON (di.local_entity_id)
        di.local_entity_id AS staging_pk,
        di.before_data AS core_before,
        di.after_data -> 'f1_comparison' AS f1_comparison,
        di.after_data -> 'f2_comparison' AS f2_cmp,
        CASE
            WHEN di.before_data IS NULL OR trim(coalesce(di.before_data ->> 'id', '')) = '' THEN NULL
            WHEN trim(coalesce(di.before_data ->> 'id', '')) ~ '^[-+]?[0-9]+$'
                THEN trim(di.before_data ->> 'id')::bigint
            ELSE NULL
        END AS core_id_hint
    FROM system.system_diff_items AS di
    INNER JOIN system.system_diff_runs AS dr ON dr.id = di.diff_run_id
    WHERE dr.status = 'completed'
      AND dr.current_snapshot_id = $1::bigint
      AND dr.entity_family = %L
    ORDER BY di.local_entity_id ASC, dr.finished_at DESC NULLS LAST,
        dr.started_at DESC NULLS LAST, di.created_at DESC, di.id DESC
),
ranked AS (
    SELECT
        s.id AS local_staging_id,
        %L::text AS entity_family,
        %L::text AS source_table,
        s.external_id::text AS external_id,
        %s AS canonical_name,
        %s AS class_code_text,
        s.confidence_score,
        coalesce(nullif(trim(s.match_status), ''), 'needs_review') AS match_status,
        coalesce(nullif(trim(s.auto_action), ''), 'needs_review') AS auto_action,
        coalesce(nullif(trim(s.review_status), ''), 'pending') AS review_status,
        s.review_decision::text AS review_decision_text,
        %s AS normalized_data,
        %s AS source_refs,
        %s AS geometry_geojson,
        f.core_before AS matched_core_data,
        f.f2_cmp AS f2_comparison,
        f.f1_comparison AS f1_comparison,
        %s AS resolved_core_pk,
        %s AS matched_core_table_hint,
        jsonb_strip_nulls(%s) AS extra_payload,
        row_number() OVER (ORDER BY s.id) AS rn
    FROM %I.%I AS s
    %s
    LEFT JOIN latest_slice AS f ON f.staging_pk = s.id
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
),
lim AS (
    SELECT * FROM ranked r WHERE $3::bigint IS NULL OR r.rn <= $3::bigint
)
INSERT INTO system.system_remote_review_package_items (
    package_id, entity_family, source_table, local_staging_id, external_id,
    match_status, auto_action, review_status, review_decision, confidence_score,
    canonical_name, class_code, normalized_data, source_refs, review_overrides,
    matched_core_id, matched_core_table, matched_core_data, f2_comparison,
    geometry_geojson, payload
)
SELECT
    $2::bigint, entity_family, source_table, local_staging_id, external_id,
    match_status, auto_action, review_status,
    NULLIF(trim(review_decision_text), ''), confidence_score,
    canonical_name, class_code_text,
    coalesce(normalized_data, '{}'::jsonb),
    coalesce(source_refs, '{}'::jsonb),
    '{}'::jsonb,
    resolved_core_pk, matched_core_table_hint,
    matched_core_data, f2_comparison, geometry_geojson,
    jsonb_strip_nulls(
        jsonb_build_object(
            'package_name', $5::text,
            'package_id', $2::bigint,
            'source_snapshot_version', $4::text,
            'snapshot_version', $4::text,
            'source_snapshot_id_local', $1::bigint,
            'region_code', $6::text,
            'entity_family', entity_family,
            'source_table', source_table,
            'local_staging_id', local_staging_id,
            'external_id', external_id,
            'match_status', match_status,
            'auto_action', auto_action,
            'review_status', review_status,
            'review_decision', NULLIF(trim(review_decision_text), ''),
            'confidence_score', confidence_score,
            'canonical_name', canonical_name,
            'class_code', class_code_text,
            'normalized_data', coalesce(normalized_data, '{}'::jsonb),
            'source_refs', coalesce(source_refs, '{}'::jsonb),
            'review_overrides', '{}'::jsonb,
            'matched_core_id', resolved_core_pk,
            'matched_core_table', matched_core_table_hint,
            'matched_core_data', matched_core_data,
            'f2_comparison', f2_comparison,
            'f1_comparison', f1_comparison,
            '_lineage_stage', 'J_prepare_remote_review_package'
        ) || coalesce(extra_payload, '{}'::jsonb)
    )
FROM lim;
$ex$,
            v_fe.diff_entity_family,
            v_fe.entity_family,
            v_fe.staging_table,
            v_fe.canonical_expr,
            v_fe.class_code_expr,
            v_child_nd,
            v_child_sr,
            v_fe.geom_expr,
            v_matched_col,
            v_matched_table_expr,
            v_fe.extra_payload_expr,
            v_schema,
            v_fe.staging_table,
            v_child_join,
            v_fe.eligibility_geom_expr
        );

        EXECUTE v_sql
        USING ctx.source_snapshot_id,
            v_pkg_id,
            prm.max_rows_per_family,
            ctx.snapshot_version,
            v_pkg_name,
            ctx.region_code;

        RAISE NOTICE 'stage11_export family=% table=%.%',
            v_fe.entity_family, v_schema, v_fe.staging_table;
    END LOOP;

    SELECT count(*) INTO STRICT v_tot
    FROM system.system_remote_review_package_items
    WHERE package_id = v_pkg_id;

    SELECT coalesce(
        (
            SELECT coalesce(jsonb_object_agg(inner_ms.match_status, inner_ms.c_cnt), '{}'::jsonb)
            FROM (
                SELECT match_status, count(*)::bigint AS c_cnt
                FROM system.system_remote_review_package_items
                WHERE package_id = v_pkg_id
                  AND match_status IS NOT NULL
                GROUP BY match_status
            ) AS inner_ms
        ),
        '{}'::jsonb
    )
    INTO j_ms;

    SELECT coalesce(
        (
            SELECT coalesce(jsonb_object_agg(inner_aa.auto_action, inner_aa.c_cnt), '{}'::jsonb)
            FROM (
                SELECT auto_action, count(*)::bigint AS c_cnt
                FROM system.system_remote_review_package_items
                WHERE package_id = v_pkg_id
                  AND auto_action IS NOT NULL
                GROUP BY auto_action
            ) AS inner_aa
        ),
        '{}'::jsonb
    )
    INTO j_aa;

    SELECT coalesce(
        (
            SELECT coalesce(jsonb_object_agg(inner_ef.entity_family, inner_ef.c_cnt), '{}'::jsonb)
            FROM (
                SELECT entity_family, count(*)::bigint AS c_cnt
                FROM system.system_remote_review_package_items
                WHERE package_id = v_pkg_id
                GROUP BY entity_family
            ) AS inner_ef
        ),
        '{}'::jsonb
    )
    INTO j_ef;

    j_staging := '{}'::jsonb;
    FOR v_fe IN
        SELECT fe.*
        FROM stage11_family_export AS fe
        INNER JOIN stage11_manifest AS mf
            ON mf.entity_family = fe.entity_family AND mf.implemented
        ORDER BY fe.entity_family
    LOOP
        IF to_regclass(format('%I.%I', v_schema, v_fe.staging_table)) IS NULL THEN
            CONTINUE;
        END IF;

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
            v_schema,
            v_fe.staging_table,
            v_fe.eligibility_geom_expr
        );

        EXECUTE v_eligible_sql INTO v_staging_cnt USING ctx.source_snapshot_id;
        j_staging := j_staging || jsonb_build_object(v_fe.entity_family, v_staging_cnt);
    END LOOP;

    UPDATE system.system_remote_review_packages p
    SET total_item_count = v_tot::integer,
        summary =
            coalesce(p.summary, '{}'::jsonb)
                || jsonb_build_object(
                    'counts_by_entity_family', j_ef,
                    'staging_eligible_counts', j_staging,
                    'counts_match_status', j_ms,
                    'counts_auto_action', j_aa,
                    'total_package_items', v_tot
                )
    WHERE id = v_pkg_id;

    TRUNCATE stage11_last_pkg;
    INSERT INTO stage11_last_pkg VALUES (v_pkg_id, v_pkg_name);

    RAISE NOTICE 'stage11_package id=% name=% snapshot=% total_rows=% families=% match_status_buckets=% auto_action_buckets=%',
        v_pkg_id,
        v_pkg_name,
        ctx.snapshot_version,
        v_tot,
        j_ef,
        j_ms,
        j_aa;
END
$core$;

COMMIT;

\echo Reporting (latest Stage J package in this session):

SELECT pkg_id AS package_id,
    pkg_name AS package_name,
    pk.total_item_count,
    pk.snapshot_version,
    pk.entity_families,
    pk.summary -> 'counts_match_status' AS counts_match_status,
    pk.summary -> 'counts_auto_action' AS counts_auto_action,
    pk.summary -> 'counts_by_entity_family' AS counts_entity_family,
    pk.summary -> 'staging_eligible_counts' AS staging_eligible_counts,
    pk.created_at
FROM stage11_last_pkg AS last
JOIN system.system_remote_review_packages AS pk ON pk.id = last.pkg_id;

-- =============================================================================
-- Verification SQL (manual)
-- -----------------------------------------------------------------------------
-- Packages + items totals:
--
-- SELECT id, package_name, snapshot_version, entity_families, total_item_count, created_at,
--        summary -> 'counts_by_entity_family'
-- FROM system.system_remote_review_packages
-- ORDER BY id DESC
-- LIMIT 5;
--
-- SELECT package_id,
--        count(*) FILTER (WHERE entity_family='buildings') AS buildings_pkg,
--        count(*) FILTER (WHERE entity_family='places') AS places_pkg,
--        count(*) FILTER (WHERE entity_family='roads') AS roads_pkg
-- FROM system.system_remote_review_package_items
-- GROUP BY package_id;
--
-- Quick sample row payloads:
--
-- SELECT id, entity_family, local_staging_id, external_id,
--        match_status, auto_action, review_status, matched_core_table
-- FROM system.system_remote_review_package_items
-- WHERE package_id = (SELECT max(id) FROM system.system_remote_review_packages)
-- LIMIT 50;