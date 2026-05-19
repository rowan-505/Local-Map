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
    ('bus_stops', false),
    ('landuse', false),
    ('water_lines', false),
    ('water_polygons', false),
    ('addresses', false),
    ('admin_areas', false),
    ('routing_barriers', false);

DO $placeholder$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT entity_family FROM stage11_manifest WHERE NOT implemented LOOP
        RAISE NOTICE 'stage11_placeholder family=% (TODO Stage J exporter)', r.entity_family;
    END LOOP;
END
$placeholder$;

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
            'stage11: filtered entity_family has no exporters yet (implementations exist for buildings/places/roads only).';
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
    v_tot bigint := 0;
BEGIN
    SELECT * INTO STRICT prm FROM stage11_params;
    SELECT * INTO STRICT ctx FROM stage11_context;
    v_schema := ctx.staging_schema;

    IF to_regclass(format('%I.%I', v_schema, 'staging_building_candidates')) IS NULL
       OR to_regclass(format('%I.%I', v_schema, 'staging_place_candidates')) IS NULL
       OR to_regclass(format('%I.%I', v_schema, 'staging_road_candidates')) IS NULL THEN
        RAISE EXCEPTION
            'staging schema "%" missing building/place/road candidate tables required for Stage J.',
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
    -- buildings
    ------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'buildings' AND implemented) THEN
        EXECUTE format(
            $jb$
WITH latest_slice AS (
    SELECT DISTINCT ON (di.local_entity_id)
        di.local_entity_id AS staging_pk,
        di.before_data AS core_before,
        di.after_data -> 'f1_comparison' AS f1_comparison,
        di.after_data -> 'f2_comparison' AS f2_cmp,
        CASE
            WHEN di.before_data IS NULL OR trim(coalesce(di.before_data ->> 'id', '')) = '' THEN NULL
            WHEN trim(coalesce(di.before_data ->> 'id', '')) ~ '^[-+]?[0-9]+$' THEN trim(di.before_data ->> 'id')::bigint
            ELSE NULL
        END AS core_id_hint
    FROM system.system_diff_items AS di
    INNER JOIN system.system_diff_runs AS dr ON dr.id = di.diff_run_id
    WHERE dr.status = 'completed'
      AND dr.current_snapshot_id = $1::bigint
      AND dr.entity_family = 'buildings'
    ORDER BY di.local_entity_id ASC, dr.finished_at DESC NULLS LAST,
        dr.started_at DESC NULLS LAST, di.created_at DESC, di.id DESC
),
ranked AS (
    SELECT
        s.id AS local_staging_id,
        'buildings'::text AS entity_family,
        'staging_building_candidates'::text AS source_table,
        s.external_id::text AS external_id,
        s.canonical_name::text AS canonical_name,
        s.class_code::text AS class_code,
        s.confidence_score,
        s.match_status,
        s.auto_action,
        s.review_status,
        s.review_decision::text AS review_decision_text,
        s.normalized_data,
        s.source_refs,
        CASE
            WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb
            ELSE NULL::jsonb
        END AS geometry_geojson,
        f.core_before AS matched_core_data,
        f.f2_cmp AS f2_comparison,
        f.f1_comparison AS f1_comparison,
        f.core_id_hint,
        CASE
            WHEN f.core_before IS NOT NULL THEN 'core_map_buildings'::text
            ELSE NULL::text
        END AS matched_core_table_hint,
        row_number() OVER (ORDER BY s.id) AS rn
    FROM %I.%I AS s
    LEFT JOIN latest_slice AS f ON f.staging_pk = s.id
    WHERE s.source_snapshot_id = $1::bigint
      AND s.match_status IS NOT NULL
      AND s.auto_action IS NOT NULL
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
),
lim AS (
    SELECT * FROM ranked r
    WHERE $3::bigint IS NULL OR r.rn <= $3::bigint
)
INSERT INTO system.system_remote_review_package_items (
    package_id,
    entity_family,
    source_table,
    local_staging_id,
    external_id,
    match_status,
    auto_action,
    review_status,
    review_decision,
    confidence_score,
    canonical_name,
    class_code,
    normalized_data,
    source_refs,
    review_overrides,
    matched_core_id,
    matched_core_table,
    matched_core_data,
    f2_comparison,
    geometry_geojson,
    payload
)
SELECT
    $2::bigint,
    entity_family,
    source_table,
    local_staging_id,
    external_id,
    match_status,
    auto_action,
    review_status,
    NULLIF(trim(review_decision_text), ''),
    confidence_score,
    canonical_name,
    class_code,
    coalesce(normalized_data, '{}'::jsonb),
    coalesce(source_refs, '{}'::jsonb),
    '{}'::jsonb,
    core_id_hint,
    matched_core_table_hint,
    matched_core_data,
    f2_comparison,
    geometry_geojson,
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
            'class_code', class_code,
            'normalized_data', coalesce(normalized_data, '{}'::jsonb),
            'source_refs', coalesce(source_refs, '{}'::jsonb),
            'review_overrides', '{}'::jsonb,
            'matched_core_id', core_id_hint,
            'matched_core_table', matched_core_table_hint,
            'matched_core_data', matched_core_data,
            'f2_comparison', f2_comparison,
            'f1_comparison', f1_comparison,
            '_lineage_stage', 'J_prepare_remote_review_package'
        )
    )
FROM lim;
$jb$,
            v_schema,
            'staging_building_candidates'
        )
        USING ctx.source_snapshot_id,
            v_pkg_id,
            prm.max_rows_per_family,
            ctx.snapshot_version,
            v_pkg_name,
            ctx.region_code;
    END IF;

    ------------------------------------------------------------------
    -- places
    ------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'places' AND implemented) THEN
        EXECUTE format(
            $jp$
WITH latest_slice AS (
    SELECT DISTINCT ON (di.local_entity_id)
        di.local_entity_id AS staging_pk,
        di.before_data AS core_before,
        di.after_data -> 'f1_comparison' AS f1_comparison,
        di.after_data -> 'f2_comparison' AS f2_cmp,
        CASE
            WHEN di.before_data IS NULL OR trim(coalesce(di.before_data ->> 'id', '')) = '' THEN NULL
            WHEN trim(coalesce(di.before_data ->> 'id', '')) ~ '^[-+]?[0-9]+$' THEN trim(di.before_data ->> 'id')::bigint
            ELSE NULL
        END AS core_id_hint
    FROM system.system_diff_items AS di
    INNER JOIN system.system_diff_runs AS dr ON dr.id = di.diff_run_id
    WHERE dr.status = 'completed'
      AND dr.current_snapshot_id = $1::bigint
      AND dr.entity_family = 'places'
    ORDER BY di.local_entity_id ASC, dr.finished_at DESC NULLS LAST,
        dr.started_at DESC NULLS LAST, di.created_at DESC, di.id DESC
),
ranked AS (
    SELECT
        s.id AS local_staging_id,
        'places'::text AS entity_family,
        'staging_place_candidates'::text AS source_table,
        s.external_id::text AS external_id,
        s.canonical_name::text AS canonical_name,
        CASE
            WHEN trim(coalesce(s.class_code::text, '')) <> '' THEN s.class_code::text
            WHEN trim(coalesce(s.normalized_data ->> 'class_code', '')) <> ''
                THEN trim(s.normalized_data ->> 'class_code')
            ELSE NULL::text
        END AS class_code_text,
        s.confidence_score,
        s.match_status,
        s.auto_action,
        s.review_status,
        s.review_decision::text AS review_decision_text,
        s.normalized_data,
        s.source_refs,
        s.place_class_id,
        s.poi_category_id,
        s.source_entity_type,
        CASE
            WHEN s.point_geom IS NOT NULL THEN ST_AsGeoJSON(s.point_geom)::jsonb
            ELSE NULL::jsonb
        END AS geometry_geojson,
        f.core_before AS matched_core_data,
        f.f2_cmp AS f2_comparison,
        f.f1_comparison AS f1_comparison,
        coalesce(f.core_id_hint, s.matched_core_place_id) AS resolved_core_pk,
        CASE
            WHEN coalesce(f.core_before, '{}'::jsonb) <> '{}'::jsonb THEN 'core_places'::text
            WHEN s.matched_core_place_id IS NOT NULL THEN 'core_places'::text
            ELSE NULL::text
        END AS matched_core_table_hint,
        row_number() OVER (ORDER BY s.id) AS rn
    FROM %I.%I AS s
    LEFT JOIN latest_slice AS f ON f.staging_pk = s.id
    WHERE s.source_snapshot_id = $1::bigint
      AND s.match_status IS NOT NULL
      AND s.auto_action IS NOT NULL
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
),
lim AS (
    SELECT * FROM ranked r WHERE $3::bigint IS NULL OR r.rn <= $3::bigint
)
INSERT INTO system.system_remote_review_package_items (
    package_id,
    entity_family,
    source_table,
    local_staging_id,
    external_id,
    match_status,
    auto_action,
    review_status,
    review_decision,
    confidence_score,
    canonical_name,
    class_code,
    normalized_data,
    source_refs,
    review_overrides,
    matched_core_id,
    matched_core_table,
    matched_core_data,
    f2_comparison,
    geometry_geojson,
    payload
)
SELECT
    $2::bigint,
    entity_family,
    source_table,
    local_staging_id,
    external_id,
    match_status,
    auto_action,
    review_status,
    NULLIF(trim(review_decision_text), ''),
    confidence_score,
    canonical_name,
    class_code_text,
    coalesce(normalized_data, '{}'::jsonb),
    coalesce(source_refs, '{}'::jsonb),
    '{}'::jsonb,
    resolved_core_pk,
    matched_core_table_hint,
    matched_core_data,
    f2_comparison,
    geometry_geojson,
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
            'place_class_id', place_class_id,
            'poi_category_id', poi_category_id,
            'source_entity_type', source_entity_type,
            '_lineage_stage', 'J_prepare_remote_review_package'
        )
    )
FROM lim;
$jp$,
            v_schema,
            'staging_place_candidates'
        )
        USING ctx.source_snapshot_id,
            v_pkg_id,
            prm.max_rows_per_family,
            ctx.snapshot_version,
            v_pkg_name,
            ctx.region_code;
    END IF;

    ------------------------------------------------------------------
    -- roads
    ------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'roads' AND implemented) THEN
        EXECUTE format(
            $jr$
WITH latest_slice AS (
    SELECT DISTINCT ON (di.local_entity_id)
        di.local_entity_id AS staging_pk,
        di.before_data AS core_before,
        di.after_data -> 'f1_comparison' AS f1_comparison,
        di.after_data -> 'f2_comparison' AS f2_cmp,
        CASE
            WHEN di.before_data IS NULL OR trim(coalesce(di.before_data ->> 'id', '')) = '' THEN NULL
            WHEN trim(coalesce(di.before_data ->> 'id', '')) ~ '^[-+]?[0-9]+$' THEN trim(di.before_data ->> 'id')::bigint
            ELSE NULL
        END AS core_id_hint
    FROM system.system_diff_items AS di
    INNER JOIN system.system_diff_runs AS dr ON dr.id = di.diff_run_id
    WHERE dr.status = 'completed'
      AND dr.current_snapshot_id = $1::bigint
      AND dr.entity_family = 'roads'
    ORDER BY di.local_entity_id ASC, dr.finished_at DESC NULLS LAST,
        dr.started_at DESC NULLS LAST, di.created_at DESC, di.id DESC
),
ranked AS (
    SELECT
        s.id AS local_staging_id,
        'roads'::text AS entity_family,
        'staging_road_candidates'::text AS source_table,
        s.external_id::text AS external_id,
        s.canonical_name::text AS canonical_name,
        CASE
            WHEN trim(coalesce(s.class_code::text, '')) <> '' THEN trim(s.class_code::text)
            WHEN trim(coalesce(s.normalized_data ->> 'class_code', '')) <> '' THEN trim(s.normalized_data ->> 'class_code')
            WHEN trim(coalesce(s.normalized_data ->> 'highway', '')) <> '' THEN trim(s.normalized_data ->> 'highway')
            ELSE NULL::text
        END AS road_class_slug,
        s.road_class_id,
        s.confidence_score,
        s.match_status,
        s.auto_action,
        s.review_status,
        s.review_decision::text AS review_decision_text,
        s.normalized_data,
        s.source_refs,
        CASE
            WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb
            ELSE NULL::jsonb
        END AS geometry_geojson,
        f.core_before AS matched_core_data,
        f.f2_cmp AS f2_comparison,
        f.f1_comparison AS f1_comparison,
        coalesce(f.core_id_hint, s.matched_core_edge_id) AS resolved_core_pk,
        CASE
            WHEN coalesce(f.core_before, '{}'::jsonb) <> '{}'::jsonb THEN 'core_streets'::text
            WHEN s.matched_core_edge_id IS NOT NULL THEN 'core_streets'::text
            ELSE NULL::text
        END AS matched_core_table_hint,
        row_number() OVER (ORDER BY s.id) AS rn
    FROM %I.%I AS s
    LEFT JOIN latest_slice AS f ON f.staging_pk = s.id
    WHERE s.source_snapshot_id = $1::bigint
      AND s.match_status IS NOT NULL
      AND s.auto_action IS NOT NULL
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
),
lim AS (
    SELECT * FROM ranked r WHERE $3::bigint IS NULL OR r.rn <= $3::bigint
)
INSERT INTO system.system_remote_review_package_items (
    package_id,
    entity_family,
    source_table,
    local_staging_id,
    external_id,
    match_status,
    auto_action,
    review_status,
    review_decision,
    confidence_score,
    canonical_name,
    class_code,
    normalized_data,
    source_refs,
    review_overrides,
    matched_core_id,
    matched_core_table,
    matched_core_data,
    f2_comparison,
    geometry_geojson,
    payload
)
SELECT
    $2::bigint,
    entity_family,
    source_table,
    local_staging_id,
    external_id,
    match_status,
    auto_action,
    review_status,
    NULLIF(trim(review_decision_text), ''),
    confidence_score,
    canonical_name,
    road_class_slug,
    coalesce(normalized_data, '{}'::jsonb),
    coalesce(source_refs, '{}'::jsonb),
    '{}'::jsonb,
    resolved_core_pk,
    matched_core_table_hint,
    matched_core_data,
    f2_comparison,
    geometry_geojson,
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
            'class_code', road_class_slug,
            'normalized_data', coalesce(normalized_data, '{}'::jsonb),
            'source_refs', coalesce(source_refs, '{}'::jsonb),
            'review_overrides', '{}'::jsonb,
            'matched_core_id', resolved_core_pk,
            'matched_core_table', matched_core_table_hint,
            'matched_core_data', matched_core_data,
            'f2_comparison', f2_comparison,
            'f1_comparison', f1_comparison,
            'road_class_id', road_class_id,
            '_lineage_stage', 'J_prepare_remote_review_package'
        )
    )
FROM lim;
$jr$,
            v_schema,
            'staging_road_candidates'
        )
        USING ctx.source_snapshot_id,
            v_pkg_id,
            prm.max_rows_per_family,
            ctx.snapshot_version,
            v_pkg_name,
            ctx.region_code;
    END IF;

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
    UPDATE system.system_remote_review_packages p
    SET total_item_count = v_tot::integer,
        summary =
            coalesce(p.summary, '{}'::jsonb)
                || jsonb_build_object(
                    'counts_by_entity_family', j_ef,
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