-- =============================================================================
-- Stage J: prepare_remote_review_package (local-only)
-- -----------------------------------------------------------------------------
-- Builds one conflict-only remote review package from staging `import_class`
-- human-decision rows (+ F1 possible_delete). Does not package safe_new,
-- safe_update, unchanged, or invalid.
--
-- Upload classes:
--   duplicate | conflict | manual_protected | verified_conflict | possible_delete
--
-- psql vars:
--   snapshot_version        (required)
--   staging_schema          optional → default staging
--   entity_families        optional → comma list or all
--   entity_family            optional legacy single-slug filter
--   max_rows_per_family     optional integer string; blank = unlimited
--   package_name            optional; blank → remote_review_conflicts_<snapshot>
--   replace_package         optional true|false; default false
--                           (same-name + same-snapshot auto-replaces when conflict_only)
--   conflict_only           optional true|false; default true
--   settlements_only        optional true|false; default false
--   exclude_settlements     optional true|false; default false (places IR: non-settlement only)
--                           when true, places package includes only settlement place=* rows
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

\if :{?entity_families}
\else
\set entity_families 'all'
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

\if :{?conflict_only}
\else
\set conflict_only true
\endif

\if :{?settlements_only}
\else
\set settlements_only false
\endif

\if :{?exclude_settlements}
\else
\set exclude_settlements false
\endif

BEGIN;

create schema if not exists system;

\ir pipeline_remote_review_conflict.sql
\ir pipeline_source_identity.sql
\ir pipeline_import_classification.sql


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
    replace_package boolean not null DEFAULT false,
    conflict_only boolean not null DEFAULT true,
    settlements_only boolean not null DEFAULT false,
    exclude_settlements boolean not null DEFAULT false
);

INSERT INTO stage11_params (
    snapshot_version,
    staging_schema,
    entity_family_filter,
    max_rows_per_family,
    package_name_input,
    replace_package,
    conflict_only,
    settlements_only,
    exclude_settlements
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
    lower(coalesce(nullif(btrim(:'replace_package'), ''), 'false')) IN ('true', 't', '1', 'yes'),
    lower(coalesce(nullif(btrim(:'conflict_only'), ''), 'true')) IN ('true', 't', '1', 'yes'),
    lower(coalesce(nullif(btrim(:'settlements_only'), ''), 'false')) IN ('true', 't', '1', 'yes'),
    lower(coalesce(nullif(btrim(:'exclude_settlements'), ''), 'false')) IN ('true', 't', '1', 'yes')
);

DO $v$
BEGIN
    IF EXISTS (SELECT 1 FROM stage11_params WHERE snapshot_version IS NULL) THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
    IF EXISTS (SELECT 1 FROM stage11_params WHERE NOT conflict_only) THEN
        RAISE EXCEPTION
            'full-candidate Import Review packages are retired; conflict_only must be true';
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
    ('landuse', true),
    ('water_lines', true),
    ('water_polygons', true),
    ('addresses', true),
    ('address_components', true),
    ('place_address_links', true),
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
     'jsonb_build_object(''place_class_id'', s.place_class_id, ''poi_category_id'', s.poi_category_id, ''source_entity_type'', s.source_entity_type, ''source_name'', to_jsonb(s) ->> ''source_name'', ''source_type_hint'', to_jsonb(s) ->> ''source_type_hint'', ''source_category_hint'', to_jsonb(s) ->> ''source_category_hint'', ''source_classification'', to_jsonb(s) ->> ''source_classification'', ''address_strength'', to_jsonb(s) ->> ''address_strength'', ''promotion_status'', to_jsonb(s) ->> ''promotion_status'')'),
    ('roads', 'staging_road_candidates', 'roads', 'core_streets', 'matched_core_edge_id',
     'CASE WHEN s.geom IS NOT NULL THEN ST_AsGeoJSON(s.geom)::jsonb END',
     'coalesce(nullif(trim(s.class_code::text), ''''), nullif(trim(s.normalized_data ->> ''class_code''), ''''), nullif(trim(s.normalized_data ->> ''highway''), ''''))',
     's.canonical_name::text', 'staging_road_name_candidates', 'road_candidate_id', 'road_name_candidates', NULL,
     's.geom IS NOT NULL',
     'jsonb_build_object(''road_class_id'', s.road_class_id)'),
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
     'jsonb_build_object(''full_address'', s.full_address, ''house_number'', s.house_number, ''unit_number'', s.normalized_data ->> ''unit_number'', ''street_id'', s.normalized_data ->> ''street_id'', ''admin_area_id'', s.normalized_data ->> ''admin_area_id'', ''street_name'', s.street_name, ''quarter'', s.quarter, ''suburb'', s.suburb, ''township'', s.township, ''city'', s.city, ''district'', s.district, ''state_region'', s.state_region, ''postcode'', s.postcode, ''country'', s.country, ''postal_code'', coalesce(s.normalized_data ->> ''postal_code'', s.postcode), ''plus_code'', s.normalized_data ->> ''plus_code'', ''entrance_geom_geojson'', s.normalized_data -> ''entrance_geom_geojson'', ''source_name'', to_jsonb(s) ->> ''source_name'', ''source_type_hint'', to_jsonb(s) ->> ''source_type_hint'', ''source_category_hint'', to_jsonb(s) ->> ''source_category_hint'', ''source_classification'', to_jsonb(s) ->> ''source_classification'', ''address_strength'', to_jsonb(s) ->> ''address_strength'', ''place_candidate_status'', coalesce(to_jsonb(s) ->> ''place_candidate_status'', case when to_jsonb(s) ->> ''source_classification'' = ''place_with_address'' then ''needs_place_candidate'' end), ''linked_place_candidate_id'', to_jsonb(s) ->> ''matched_place_candidate_id'', ''validation_status'', to_jsonb(s) ->> ''validation_status'', ''promotion_status'', to_jsonb(s) ->> ''promotion_status'')'),
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

\ir pipeline_entity_families.sql

DELETE FROM stage11_manifest AS mf
WHERE NOT pg_temp.pipeline_stage11_family_enabled(mf.entity_family);

DELETE FROM stage11_manifest mf
WHERE (SELECT trim(entity_family_filter) <> '' FROM stage11_params LIMIT 1)
  AND mf.entity_family <> (SELECT trim(entity_family_filter) FROM stage11_params LIMIT 1);

DELETE FROM stage11_family_export AS fe
WHERE NOT EXISTS (
    SELECT 1
    FROM stage11_manifest AS mf
    WHERE mf.entity_family = fe.entity_family
      AND mf.implemented
);

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
            'legacy entity_family filter "%" is not in the remaining ENTITY_FAMILIES manifest set',
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

DROP TABLE IF EXISTS stage11_family_summary;

CREATE TEMPORARY TABLE stage11_family_summary (
    entity_family text NOT NULL PRIMARY KEY,
    package_item_count bigint NOT NULL,
    staging_eligible_count bigint NOT NULL
);

-- Core work
DO $core$
DECLARE
    prm stage11_params%ROWTYPE;
    ctx stage11_context%ROWTYPE;
    v_pkg_name text;
    v_old_id bigint;
    v_old_snap text;
    v_pkg_id bigint;
    v_schema text;
    j_ms jsonb;
    j_aa jsonb;
    j_ef jsonb;
    j_staging jsonb;
    j_import_class jsonb;
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
    v_conflict_filter text;
    v_has_import_class boolean;
    v_has_validation_status boolean;
    v_has_promotion_status boolean;
    v_row_filter text;
    v_import_class_expr text;
    v_valid bigint;
    v_direct bigint;
    v_unchanged bigint;
    v_ir_conflicts bigint;
    v_pmtiles_only bigint;
    v_fam_valid bigint;
    v_fam_direct bigint;
    v_fam_unchanged bigint;
    v_fam_ir bigint;
    v_fam_pmtiles bigint;
    v_del_n bigint;
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
    )
    AND NOT EXISTS (
        SELECT 1
        FROM stage11_manifest mf
        WHERE mf.implemented
          AND mf.entity_family = 'address_components'
          AND to_regclass(format('%I.staging_address_component_candidates', v_schema)) IS NOT NULL
    )
    AND NOT EXISTS (
        SELECT 1
        FROM stage11_manifest mf
        WHERE mf.implemented
          AND mf.entity_family = 'place_address_links'
          AND to_regclass(format('%I.staging_place_address_link_candidates', v_schema)) IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'staging schema "%" has no implemented candidate tables for Stage J export.',
            v_schema;
    END IF;

    v_pkg_name := coalesce(
        nullif(trim(prm.package_name_input), ''),
        format(
            'remote_review_conflicts_%s',
            regexp_replace(trim(ctx.snapshot_version), '[^[:alnum:]_]+', '_', 'g')
        )
    );

    SELECT id, snapshot_version
    INTO v_old_id, v_old_snap
    FROM system.system_remote_review_packages
    WHERE package_name = v_pkg_name;

    IF v_old_id IS NOT NULL THEN
        IF prm.replace_package
           OR (
               prm.conflict_only
               AND v_old_snap IS NOT DISTINCT FROM ctx.snapshot_version
           )
        THEN
            DELETE FROM system.system_remote_review_packages WHERE id = v_old_id;
            RAISE NOTICE 'stage11_replace: removed existing package id=% name=% (same-snapshot conflict package refresh)',
                v_old_id, v_pkg_name;
        ELSE
            RAISE EXCEPTION USING
                MESSAGE = format('package_name "%s" already exists (id=%s)', v_pkg_name, v_old_id),
                HINT = 'Re-run with -v replace_package=true, or use the stable conflict package name for the same snapshot.';
        END IF;
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
                'snapshot_version', ctx.snapshot_version,
                'conflict_only', prm.conflict_only,
                'package_kind', CASE WHEN prm.conflict_only THEN 'human_decision_conflicts' ELSE 'legacy_full' END
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

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = v_schema
              AND table_name = v_fe.staging_table
              AND column_name = 'import_class'
        ) INTO v_has_import_class;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = v_schema
              AND table_name = v_fe.staging_table
              AND column_name = 'validation_status'
        ) INTO v_has_validation_status;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = v_schema
              AND table_name = v_fe.staging_table
              AND column_name = 'promotion_status'
        ) INTO v_has_promotion_status;

        IF prm.conflict_only AND NOT v_has_import_class THEN
            RAISE EXCEPTION
                'conflict_only package requires %.%.import_class — run Stage 08b first',
                v_schema, v_fe.staging_table;
        END IF;

        -- Use the real import_class column — never to_jsonb(s), which serializes
        -- geom and stalls on multi-million-row families (e.g. national buildings).
        IF prm.conflict_only THEN
            v_conflict_filter := $cf$
              AND s.import_class = ANY (system.pipeline_ir_conflict_classes())
            $cf$;
        ELSE
            v_conflict_filter := '';
        END IF;

        IF v_has_import_class THEN
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON %I.%I (source_snapshot_id, import_class)',
                v_fe.staging_table || '_snd_import_class_idx',
                v_schema,
                v_fe.staging_table
            );
            v_import_class_expr := 's.import_class';
        ELSE
            v_import_class_expr := 'NULL::text';
        END IF;

        v_row_filter := '';
        IF v_has_promotion_status THEN
            v_row_filter := v_row_filter || $rf$
      AND coalesce(s.promotion_status, '') IS DISTINCT FROM 'promoted'
$rf$;
        END IF;
        IF v_has_validation_status THEN
            v_row_filter := v_row_filter || $rf$
      AND coalesce(s.validation_status, 'valid') <> 'invalid'
$rf$;
        END IF;
        IF v_has_import_class THEN
            v_row_filter := v_row_filter || $rf$
      AND coalesce(s.import_class, '') IS DISTINCT FROM 'invalid'
$rf$;
        END IF;

        IF prm.settlements_only AND v_fe.entity_family = 'places' THEN
            v_conflict_filter := v_conflict_filter || $cf$
              AND (
                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                  )
            $cf$;
        END IF;

        IF prm.exclude_settlements AND v_fe.entity_family = 'places' THEN
            v_conflict_filter := v_conflict_filter || $cf$
              AND NOT (
                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                  )
            $cf$;
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

        -- Always fold typed place/settlement fields into normalized_data for IR upload.
        -- Prefer Stage 08c production admin_area_id from normalized_data (not local typed column).
        IF v_fe.entity_family = 'places' THEN
            v_child_nd := format(
                $nd$
(%s) || jsonb_strip_nulls(jsonb_build_object(
    'primary_name', to_jsonb(s) -> 'primary_name',
    'display_name', to_jsonb(s) -> 'display_name',
    'category_id', to_jsonb(s) -> 'category_id',
    'poi_category_id', to_jsonb(s) -> 'poi_category_id',
    'place_class_id', to_jsonb(s) -> 'place_class_id',
    'admin_area_id', coalesce(
        nullif((%s) -> 'admin_area_id', 'null'::jsonb),
        nullif((%s) -> 'core_admin_area_id', 'null'::jsonb),
        to_jsonb(s) -> 'admin_area_id'
    ),
    'lat', to_jsonb(s) -> 'lat',
    'lng', to_jsonb(s) -> 'lng',
    'import_class', to_jsonb(s) -> 'import_class',
    'source_hash', coalesce(to_jsonb(s) -> 'normalized_hash', to_jsonb(s) -> 'source_hash')
))
$nd$,
                v_child_nd,
                v_child_nd,
                v_child_nd
            );
        ELSIF v_fe.entity_family IN ('roads', 'buildings', 'landuse') THEN
            v_child_nd := format(
                $nd$
(%s) || jsonb_strip_nulls(jsonb_build_object(
    'admin_area_id', coalesce(
        nullif((%s) -> 'admin_area_id', 'null'::jsonb),
        nullif((%s) -> 'core_admin_area_id', 'null'::jsonb)
    ),
    'admin_assign_source', (%s) -> 'admin_assign_source',
    'import_class', to_jsonb(s) -> 'import_class'
))
$nd$,
                v_child_nd,
                v_child_nd,
                v_child_nd,
                v_child_nd
            );
        END IF;

        IF v_fe.matched_core_id_col IS NOT NULL AND btrim(v_fe.matched_core_id_col) <> '' THEN
            v_matched_col := format('s.%I', v_fe.matched_core_id_col);
        ELSE
            v_matched_col := 'NULL::bigint';
        END IF;

        IF v_fe.matched_core_table IS NOT NULL THEN
            v_matched_table_expr := format('%L::text', v_fe.matched_core_table);
        ELSE
            v_matched_table_expr := 'NULL::text';
        END IF;

        v_sql := format(
            $ex$
WITH filtered AS (
    SELECT
        s.id AS local_staging_id,
        %L::text AS entity_family,
        %L::text AS source_table,
        s.external_id::text AS external_id,
        %s AS canonical_name,
        %s AS class_code_text,
        s.confidence_score,
        CASE
            WHEN %s::boolean THEN system.pipeline_import_class_to_match_status(%s)
            ELSE coalesce(nullif(trim(s.match_status), ''), 'needs_review')
        END AS match_status,
        CASE
            WHEN %s::boolean THEN system.pipeline_import_class_to_auto_action(%s)
            ELSE coalesce(nullif(trim(s.auto_action), ''), 'needs_review')
        END AS auto_action,
        'pending'::text AS review_status,
        NULL::text AS review_decision_text,
        %s AS normalized_data,
        %s AS source_refs,
        %s AS geometry_geojson,
        %s AS staging_matched_core_pk,
        %s AS matched_core_table_base,
        (%s) AS base_extra_payload,
        %s AS import_class_value,
        to_jsonb(s) - 'geom' - 'point_geom' - 'line_geom' - 'polygon_geom' AS staging_row_json,
        row_number() OVER (ORDER BY s.id) AS rn
    FROM %I.%I AS s
    %s
    WHERE s.source_snapshot_id = $1::bigint
      AND (
          s.review_status IS NULL
          OR s.review_status IN (
              'pending', 'needs_review', 'approved', 'rejected', 'ignored', 'merged'
          )
      )
      %s
      %s
      AND (
          (s.match_status IS NOT NULL AND s.auto_action IS NOT NULL)
          OR (%s)
          OR coalesce(s.normalized_data, '{}'::jsonb) <> '{}'::jsonb
          OR coalesce(s.source_refs, '{}'::jsonb) <> '{}'::jsonb
          OR nullif(trim(s.external_id::text), '') IS NOT NULL
          OR %s = ANY (system.pipeline_ir_conflict_classes())
      )
),
lim AS (
    SELECT * FROM filtered r WHERE $3::bigint IS NULL OR r.rn <= $3::bigint
),
ranked AS (
    SELECT
        lim.local_staging_id,
        lim.entity_family,
        lim.source_table,
        lim.external_id,
        lim.canonical_name,
        lim.class_code_text,
        lim.confidence_score,
        lim.match_status,
        lim.auto_action,
        lim.review_status,
        lim.review_decision_text,
        lim.normalized_data,
        lim.source_refs,
        lim.geometry_geojson,
        system.pipeline_compact_core_snapshot(f.core_before) AS matched_core_data,
        f.f2_cmp AS f2_comparison,
        f.f1_comparison AS f1_comparison,
        coalesce(f.core_id_hint, lim.staging_matched_core_pk) AS resolved_core_pk,
        CASE
            WHEN coalesce(f.core_before, '{}'::jsonb) <> '{}'::jsonb THEN lim.matched_core_table_base
            WHEN coalesce(f.core_id_hint, lim.staging_matched_core_pk) IS NOT NULL THEN lim.matched_core_table_base
            ELSE NULL::text
        END AS matched_core_table_hint,
        jsonb_strip_nulls(
            coalesce(lim.base_extra_payload, '{}'::jsonb)
            || jsonb_build_object(
                'import_class', lim.import_class_value,
                'apply_status', 'not_ready',
                'promotion_status', 'not_ready',
                'imported_values', system.pipeline_compact_imported_place_values(lim.staging_row_json),
                'core_snapshot', system.pipeline_compact_core_snapshot(f.core_before),
                'difference_summary', system.pipeline_conflict_difference_summary(
                    system.pipeline_compact_imported_place_values(lim.staging_row_json),
                    system.pipeline_compact_core_snapshot(f.core_before)
                )
            )
        ) AS extra_payload
    FROM lim
    LEFT JOIN LATERAL (
        SELECT
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
          AND coalesce(dr.summary->>'comparison_type', '') IN ('staging_vs_prod_mirror', '')
          AND di.local_entity_id = lim.local_staging_id
        ORDER BY
            CASE WHEN dr.summary->>'comparison_type' = 'staging_vs_prod_mirror' THEN 0 ELSE 1 END,
            dr.finished_at DESC NULLS LAST,
            dr.started_at DESC NULLS LAST,
            di.created_at DESC,
            di.id DESC
        LIMIT 1
    ) AS f ON true
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
            'review_decision', NULL,
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
FROM ranked;
$ex$,
            v_fe.entity_family,
            v_fe.staging_table,
            v_fe.canonical_expr,
            v_fe.class_code_expr,
            prm.conflict_only::text,
            v_import_class_expr,
            prm.conflict_only::text,
            v_import_class_expr,
            v_child_nd,
            v_child_sr,
            v_fe.geom_expr,
            v_matched_col,
            v_matched_table_expr,
            v_fe.extra_payload_expr,
            v_import_class_expr,
            v_schema,
            v_fe.staging_table,
            v_child_join,
            v_row_filter,
            v_conflict_filter,
            v_fe.eligibility_geom_expr,
            v_import_class_expr,
            v_fe.diff_entity_family
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

    ------------------------------------------------------------------
    -- Explicit classified child/link exports.
    -- Address components and place-address links need their own package
    -- rows because Stage K uploads them to non-generic import_review tables.
    -- Conflict-only packages skip these (pilot human-decision path is parent families).
    ------------------------------------------------------------------
    IF NOT prm.conflict_only
       AND EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'address_components' AND implemented)
       AND to_regclass(format('%I.staging_address_component_candidates', v_schema)) IS NOT NULL
       AND to_regclass(format('%I.staging_address_candidates', v_schema)) IS NOT NULL THEN
        v_sql := format(
            $ac$
            WITH ranked AS (
                SELECT
                    comp.id AS local_staging_id,
                    'address_components'::text AS entity_family,
                    'staging_address_component_candidates'::text AS source_table,
                    concat_ws(
                        ':',
                        address.external_id,
                        'component',
                        comp.component_type_code,
                        comp.language_code,
                        md5(comp.component_value)
                    ) AS external_id,
                    'new_candidate'::text AS match_status,
                    'needs_review'::text AS auto_action,
                    coalesce(nullif(trim(address.review_status), ''), 'pending') AS review_status,
                    NULL::text AS review_decision_text,
                    NULL::numeric AS confidence_score,
                    comp.component_value AS canonical_name,
                    comp.component_type_code AS class_code_text,
                    coalesce(comp.normalized_data, '{}'::jsonb)
                        || jsonb_build_object(
                            'address_local_staging_id', address.id,
                            'address_external_id', address.external_id,
                            'component_type_code', comp.component_type_code,
                            'component_value', comp.component_value,
                            'language_code', comp.language_code,
                            'source_tag', comp.source_tag,
                            'sort_order', comp.sort_order
                        ) AS normalized_data,
                    coalesce(comp.source_refs, '{}'::jsonb)
                        || jsonb_build_object(
                            'source_snapshot_id', ctx.source_snapshot_id,
                            'snapshot_version', ctx.snapshot_version,
                            'address_local_staging_id', address.id,
                            'address_external_id', address.external_id,
                            'promoted_from', 'staging.staging_address_component_candidates'
                        ) AS source_refs,
                    NULL::jsonb AS geometry_geojson,
                    jsonb_build_object(
                        'address_local_staging_id', address.id,
                        'address_external_id', address.external_id,
                        'component_type_code', comp.component_type_code,
                        'component_value', comp.component_value,
                        'language_code', comp.language_code,
                        'source_tag', comp.source_tag,
                        'sort_order', comp.sort_order
                    ) AS payload_extra,
                    row_number() OVER (ORDER BY comp.id) AS rn
                FROM %I.staging_address_component_candidates AS comp
                INNER JOIN %I.staging_address_candidates AS address
                    ON address.id = comp.address_candidate_id
                CROSS JOIN stage11_context AS ctx
                WHERE comp.source_snapshot_id = ctx.source_snapshot_id
                  AND address.source_snapshot_id = ctx.source_snapshot_id
                  AND NOT (
                      to_jsonb(comp) ? 'is_deleted'
                      AND to_jsonb(comp) ->> 'is_deleted' = 'true'
                  )
            ),
            lim AS (
                SELECT * FROM ranked WHERE $3::bigint IS NULL OR rn <= $3::bigint
            )
            INSERT INTO system.system_remote_review_package_items (
                package_id, entity_family, source_table, local_staging_id, external_id,
                match_status, auto_action, review_status, review_decision, confidence_score,
                canonical_name, class_code, normalized_data, source_refs, review_overrides,
                matched_core_id, matched_core_table, matched_core_data, f2_comparison,
                geometry_geojson, payload
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
                normalized_data,
                source_refs,
                '{}'::jsonb,
                NULL::bigint,
                NULL::text,
                NULL::jsonb,
                NULL::jsonb,
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
                        'confidence_score', confidence_score,
                        'canonical_name', canonical_name,
                        'class_code', class_code_text,
                        'normalized_data', normalized_data,
                        'source_refs', source_refs,
                        '_lineage_stage', 'J_prepare_remote_review_package'
                    ) || payload_extra
                )
            FROM lim
            $ac$,
            v_schema,
            v_schema
        );
        EXECUTE v_sql USING ctx.source_snapshot_id, v_pkg_id, prm.max_rows_per_family, ctx.snapshot_version, v_pkg_name, ctx.region_code;
        RAISE NOTICE 'stage11_export family=address_components table=%.staging_address_component_candidates', v_schema;
    END IF;

    IF NOT prm.conflict_only
       AND EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'place_address_links' AND implemented)
       AND to_regclass(format('%I.staging_place_address_link_candidates', v_schema)) IS NOT NULL THEN
        v_sql := format(
            $pal$
            WITH ranked AS (
                SELECT
                    link.id AS local_staging_id,
                    'place_address_links'::text AS entity_family,
                    'staging_place_address_link_candidates'::text AS source_table,
                    link.external_id,
                    coalesce(nullif(trim(link.match_status), ''), 'new_candidate') AS match_status,
                    coalesce(nullif(trim(link.auto_action), ''), 'needs_review') AS auto_action,
                    coalesce(nullif(trim(link.review_status), ''), 'pending') AS review_status,
                    NULL::text AS review_decision_text,
                    link.confidence_score,
                    coalesce(place.canonical_name, link.external_id) AS canonical_name,
                    link.relation_type AS class_code_text,
                    coalesce(link.normalized_data, '{}'::jsonb)
                        || jsonb_build_object(
                            'place_local_staging_id', link.place_candidate_id,
                            'place_external_id', place.external_id,
                            'address_local_staging_id', link.address_candidate_id,
                            'address_external_id', address.external_id,
                            'relation_type', link.relation_type,
                            'is_primary', link.is_primary,
                            'source_classification', link.source_classification,
                            'address_strength', link.address_strength,
                            'validation_status', link.validation_status,
                            'promotion_status', link.promotion_status
                        ) AS normalized_data,
                    coalesce(link.source_refs, '{}'::jsonb)
                        || jsonb_build_object(
                            'source_snapshot_id', ctx.source_snapshot_id,
                            'snapshot_version', ctx.snapshot_version,
                            'place_local_staging_id', link.place_candidate_id,
                            'place_external_id', place.external_id,
                            'address_local_staging_id', link.address_candidate_id,
                            'address_external_id', address.external_id,
                            'promoted_from', 'staging.staging_place_address_link_candidates'
                        ) AS source_refs,
                    NULL::jsonb AS geometry_geojson,
                    jsonb_build_object(
                        'place_local_staging_id', link.place_candidate_id,
                        'place_external_id', place.external_id,
                        'address_local_staging_id', link.address_candidate_id,
                        'address_external_id', address.external_id,
                        'relation_type', link.relation_type,
                        'is_primary', link.is_primary,
                        'source_classification', link.source_classification,
                        'address_strength', link.address_strength,
                        'validation_status', link.validation_status,
                        'promotion_status', link.promotion_status
                    ) AS payload_extra,
                    row_number() OVER (ORDER BY link.id) AS rn
                FROM %I.staging_place_address_link_candidates AS link
                LEFT JOIN %I.staging_place_candidates AS place
                    ON place.id = link.place_candidate_id
                LEFT JOIN %I.staging_address_candidates AS address
                    ON address.id = link.address_candidate_id
                CROSS JOIN stage11_context AS ctx
                WHERE link.source_snapshot_id = ctx.source_snapshot_id
            ),
            lim AS (
                SELECT * FROM ranked WHERE $3::bigint IS NULL OR rn <= $3::bigint
            )
            INSERT INTO system.system_remote_review_package_items (
                package_id, entity_family, source_table, local_staging_id, external_id,
                match_status, auto_action, review_status, review_decision, confidence_score,
                canonical_name, class_code, normalized_data, source_refs, review_overrides,
                matched_core_id, matched_core_table, matched_core_data, f2_comparison,
                geometry_geojson, payload
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
                normalized_data,
                source_refs,
                '{}'::jsonb,
                NULL::bigint,
                NULL::text,
                NULL::jsonb,
                NULL::jsonb,
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
                        'confidence_score', confidence_score,
                        'canonical_name', canonical_name,
                        'class_code', class_code_text,
                        'normalized_data', normalized_data,
                        'source_refs', source_refs,
                        '_lineage_stage', 'J_prepare_remote_review_package'
                    ) || payload_extra
                )
            FROM lim
            $pal$,
            v_schema,
            v_schema,
            v_schema
        );
        EXECUTE v_sql USING ctx.source_snapshot_id, v_pkg_id, prm.max_rows_per_family, ctx.snapshot_version, v_pkg_name, ctx.region_code;
        RAISE NOTICE 'stage11_export family=place_address_links table=%.staging_place_address_link_candidates', v_schema;
    END IF;

    ------------------------------------------------------------------
    -- possible_delete: F1 OSM-derived deleted_candidate rows (no current staging)
    ------------------------------------------------------------------
    IF prm.conflict_only THEN
        FOR v_fe IN
            SELECT fe.*
            FROM stage11_family_export AS fe
            INNER JOIN stage11_manifest AS mf
                ON mf.entity_family = fe.entity_family AND mf.implemented
            ORDER BY fe.entity_family
        LOOP
            INSERT INTO system.system_remote_review_package_items (
                package_id, entity_family, source_table, local_staging_id, external_id,
                match_status, auto_action, review_status, review_decision, confidence_score,
                canonical_name, class_code, normalized_data, source_refs, review_overrides,
                matched_core_id, matched_core_table, matched_core_data, f2_comparison,
                geometry_geojson, payload
            )
            SELECT
                v_pkg_id,
                v_fe.entity_family,
                format('f1_deleted:%s', v_fe.staging_table),
                coalesce(
                    NULLIF(trim(di.before_data ->> 'id'), '')::bigint,
                    (-1 * abs(hashtext(coalesce(di.external_id, di.id::text))))::bigint
                ),
                di.external_id,
                'delete_candidate',
                'delete_candidate',
                'pending',
                NULL,
                NULL,
                coalesce(di.before_data ->> 'canonical_name', di.before_data ->> 'primary_name', di.external_id),
                di.before_data ->> 'class_code',
                coalesce(di.before_data -> 'normalized_data', di.before_data, '{}'::jsonb),
                coalesce(di.before_data -> 'source_refs', '{}'::jsonb),
                '{}'::jsonb,
                CASE
                    WHEN trim(coalesce(di.before_data ->> 'id', '')) ~ '^[0-9]+$'
                        THEN (di.before_data ->> 'id')::bigint
                    ELSE NULL
                END,
                v_fe.matched_core_table,
                system.pipeline_compact_core_snapshot(di.before_data),
                NULL,
                NULL,
                jsonb_strip_nulls(jsonb_build_object(
                    'package_name', v_pkg_name,
                    'package_id', v_pkg_id,
                    'source_snapshot_version', ctx.snapshot_version,
                    'snapshot_version', ctx.snapshot_version,
                    'source_snapshot_id_local', ctx.source_snapshot_id,
                    'region_code', ctx.region_code,
                    'entity_family', v_fe.entity_family,
                    'import_class', 'possible_delete',
                    'apply_status', 'not_ready',
                    'promotion_status', 'not_ready',
                    'review_status', 'pending',
                    'review_decision', NULL,
                    'match_status', 'delete_candidate',
                    'auto_action', 'delete_candidate',
                    'core_snapshot', system.pipeline_compact_core_snapshot(di.before_data),
                    'difference_summary', jsonb_build_object('kind', 'possible_delete'),
                    'external_id', di.external_id,
                    '_lineage_stage', 'J_prepare_remote_review_package'
                ))
            FROM system.system_diff_items AS di
            INNER JOIN LATERAL (
                SELECT run.id
                FROM system.system_diff_runs AS run
                WHERE run.current_snapshot_id = ctx.source_snapshot_id
                  AND run.entity_family = v_fe.diff_entity_family
                  AND run.status = 'completed'
                  AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
                ORDER BY run.finished_at DESC NULLS LAST, run.id DESC
                LIMIT 1
            ) AS latest ON latest.id = di.diff_run_id
            WHERE di.diff_type = 'deleted_candidate'
              AND system.pipeline_is_osm_derived(
                  di.external_id,
                  CASE WHEN di.before_data ? 'source_refs' THEN di.before_data->'source_refs' ELSE NULL END,
                  di.before_data->>'source_type'
              );

            GET DIAGNOSTICS v_del_n = ROW_COUNT;
            IF v_del_n > 0 THEN
                RAISE NOTICE 'stage11_export possible_delete family=% rows=%', v_fe.entity_family, v_del_n;
            END IF;
        END LOOP;
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

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_schema
              AND table_name = v_fe.staging_table
              AND column_name = 'import_class'
        ) INTO v_has_import_class;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_schema
              AND table_name = v_fe.staging_table
              AND column_name = 'validation_status'
        ) INTO v_has_validation_status;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_schema
              AND table_name = v_fe.staging_table
              AND column_name = 'promotion_status'
        ) INTO v_has_promotion_status;

        v_row_filter := '';
        IF v_has_promotion_status THEN
            v_row_filter := v_row_filter || $rf$
              AND coalesce(s.promotion_status, '') IS DISTINCT FROM 'promoted'
$rf$;
        END IF;
        IF v_has_validation_status THEN
            v_row_filter := v_row_filter || $rf$
              AND coalesce(s.validation_status, 'valid') <> 'invalid'
$rf$;
        END IF;
        IF v_has_import_class THEN
            v_row_filter := v_row_filter || $rf$
              AND coalesce(s.import_class, '') IS DISTINCT FROM 'invalid'
$rf$;
            v_import_class_expr := 's.import_class';
        ELSE
            v_import_class_expr := 'NULL::text';
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
              %s
              AND (
                  NOT $2::boolean
                  OR %s = ANY (system.pipeline_ir_conflict_classes())
              )
              AND (
                  (s.match_status IS NOT NULL AND s.auto_action IS NOT NULL)
                  OR (%s)
                  OR coalesce(s.normalized_data, '{}'::jsonb) <> '{}'::jsonb
                  OR coalesce(s.source_refs, '{}'::jsonb) <> '{}'::jsonb
                  OR nullif(trim(s.external_id::text), '') IS NOT NULL
                  OR %s = ANY (system.pipeline_ir_conflict_classes())
              )
            $el$,
            v_schema,
            v_fe.staging_table,
            v_row_filter,
            v_import_class_expr,
            v_fe.eligibility_geom_expr,
            v_import_class_expr
        );

        EXECUTE v_eligible_sql INTO v_staging_cnt
        USING ctx.source_snapshot_id, prm.conflict_only;
        j_staging := j_staging || jsonb_build_object(v_fe.entity_family, v_staging_cnt);
    END LOOP;

    IF NOT prm.conflict_only
       AND EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'address_components' AND implemented)
       AND to_regclass(format('%I.staging_address_component_candidates', v_schema)) IS NOT NULL THEN
        EXECUTE format(
            'SELECT count(*)::bigint FROM %I.staging_address_component_candidates WHERE source_snapshot_id = $1',
            v_schema
        )
        INTO v_staging_cnt
        USING ctx.source_snapshot_id;
        j_staging := j_staging || jsonb_build_object('address_components', v_staging_cnt);
    END IF;

    IF NOT prm.conflict_only
       AND EXISTS (SELECT 1 FROM stage11_manifest WHERE entity_family = 'place_address_links' AND implemented)
       AND to_regclass(format('%I.staging_place_address_link_candidates', v_schema)) IS NOT NULL THEN
        EXECUTE format(
            'SELECT count(*)::bigint FROM %I.staging_place_address_link_candidates WHERE source_snapshot_id = $1',
            v_schema
        )
        INTO v_staging_cnt
        USING ctx.source_snapshot_id;
        j_staging := j_staging || jsonb_build_object('place_address_links', v_staging_cnt);
    END IF;

    -- import_class buckets from package payloads
    SELECT coalesce(
        (
            SELECT coalesce(jsonb_object_agg(x.import_class, x.c_cnt), '{}'::jsonb)
            FROM (
                SELECT coalesce(payload->>'import_class', match_status, 'unknown') AS import_class,
                       count(*)::bigint AS c_cnt
                FROM system.system_remote_review_package_items
                WHERE package_id = v_pkg_id
                GROUP BY 1
            ) AS x
        ),
        '{}'::jsonb
    )
    INTO j_import_class;

    -- Pre-upload reconciliation:
    --   valid = direct-core + unchanged + import-review conflicts (staging)
    IF prm.conflict_only THEN
        v_valid := 0;
        v_direct := 0;
        v_unchanged := 0;
        v_ir_conflicts := 0;
        v_pmtiles_only := 0;

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
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_schema
                  AND table_name = v_fe.staging_table
                  AND column_name = 'import_class'
            ) THEN
                CONTINUE;
            END IF;

            -- Fast path when settlement filters are off: index-friendly GROUP BY.
            IF v_fe.entity_family <> 'places'
               OR (NOT prm.settlements_only AND NOT prm.exclude_settlements) THEN
                EXECUTE format(
                    $a$
                    SELECT
                        coalesce(sum(c_cnt), 0),
                        coalesce(sum(c_cnt) FILTER (
                            WHERE import_class = ANY (system.pipeline_direct_core_classes())
                        ), 0),
                        coalesce(sum(c_cnt) FILTER (WHERE import_class = 'unchanged'), 0),
                        coalesce(sum(c_cnt) FILTER (
                            WHERE import_class IN (
                                'duplicate', 'conflict', 'manual_protected', 'verified_conflict'
                            )
                        ), 0),
                        coalesce(sum(c_cnt) FILTER (WHERE import_class = 'pmtiles_only'), 0)
                    FROM (
                        SELECT import_class, count(*)::bigint AS c_cnt
                        FROM %I.%I AS s
                        WHERE s.source_snapshot_id = $1
                          AND coalesce(s.import_class, '') IS DISTINCT FROM 'invalid'
                        GROUP BY import_class
                    ) AS g
                    $a$,
                    v_schema,
                    v_fe.staging_table
                )
                INTO v_fam_valid, v_fam_direct, v_fam_unchanged, v_fam_ir, v_fam_pmtiles
                USING ctx.source_snapshot_id;
            ELSE
            EXECUTE format(
                $a$
                SELECT
                    count(*) FILTER (
                        WHERE coalesce(validation_status, 'valid') NOT IN ('invalid', 'blocked', 'failed')
                          AND (
                            CASE
                                WHEN $2 AND %3$L = 'places' THEN (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                WHEN $3 AND %3$L = 'places' THEN NOT (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                ELSE true
                            END
                          )
                    ),
                    count(*) FILTER (
                        WHERE import_class = ANY (system.pipeline_direct_core_classes())
                          AND (
                            CASE
                                WHEN $2 AND %3$L = 'places' THEN (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                WHEN $3 AND %3$L = 'places' THEN NOT (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                ELSE true
                            END
                          )
                    ),
                    count(*) FILTER (
                        WHERE import_class = 'unchanged'
                          AND (
                            CASE
                                WHEN $2 AND %3$L = 'places' THEN (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                WHEN $3 AND %3$L = 'places' THEN NOT (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                ELSE true
                            END
                          )
                    ),
                    count(*) FILTER (
                        WHERE import_class IN (
                            'duplicate', 'conflict', 'manual_protected', 'verified_conflict'
                        )
                          AND (
                            CASE
                                WHEN $2 AND %3$L = 'places' THEN (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                WHEN $3 AND %3$L = 'places' THEN NOT (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                ELSE true
                            END
                          )
                    ),
                    count(*) FILTER (
                        WHERE import_class = 'pmtiles_only'
                          AND (
                            CASE
                                WHEN $2 AND %3$L = 'places' THEN (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                WHEN $3 AND %3$L = 'places' THEN NOT (
                                    system.pipeline_is_settlement_place(to_jsonb(s) ->> 'class_code')
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_classification', ''))) = 'settlement'
                                    OR lower(btrim(coalesce(to_jsonb(s) ->> 'source_category_hint', ''))) = 'settlement'
                                )
                                ELSE true
                            END
                          )
                    )
                FROM %1$I.%2$I AS s
                WHERE s.source_snapshot_id = $1
                $a$,
                v_schema,
                v_fe.staging_table,
                v_fe.entity_family
            )
            INTO v_fam_valid, v_fam_direct, v_fam_unchanged, v_fam_ir, v_fam_pmtiles
            USING ctx.source_snapshot_id, prm.settlements_only, prm.exclude_settlements;
            END IF;

            v_valid := v_valid + v_fam_valid;
            v_direct := v_direct + v_fam_direct;
            v_unchanged := v_unchanged + v_fam_unchanged;
            v_ir_conflicts := v_ir_conflicts + v_fam_ir;
            v_pmtiles_only := v_pmtiles_only + coalesce(v_fam_pmtiles, 0);
        END LOOP;

        SELECT count(*) INTO STRICT v_tot
        FROM system.system_remote_review_package_items
        WHERE package_id = v_pkg_id;

        IF v_valid <> (v_direct + v_unchanged + v_ir_conflicts + v_pmtiles_only) THEN
            RAISE EXCEPTION
                'Stage J assertion failed: valid(%) <> direct-core(%) + unchanged(%) + ir_conflicts(%) + pmtiles_only(%)',
                v_valid, v_direct, v_unchanged, v_ir_conflicts, v_pmtiles_only;
        END IF;

        IF (
            SELECT count(*) FROM system.system_remote_review_package_items
            WHERE package_id = v_pkg_id
              AND coalesce(payload->>'import_class', '') <> 'possible_delete'
        ) <> v_ir_conflicts THEN
            RAISE EXCEPTION
                'Stage J assertion failed: packaged non-delete conflicts (%) <> staging ir_conflicts (%)',
                (
                    SELECT count(*) FROM system.system_remote_review_package_items
                    WHERE package_id = v_pkg_id
                      AND coalesce(payload->>'import_class', '') <> 'possible_delete'
                ),
                v_ir_conflicts;
        END IF;
    END IF;

    UPDATE system.system_remote_review_packages p
    SET total_item_count = v_tot::integer,
        summary =
            coalesce(p.summary, '{}'::jsonb)
                || jsonb_build_object(
                    'counts_by_entity_family', j_ef,
                    'staging_eligible_counts', j_staging,
                    'counts_match_status', j_ms,
                    'counts_auto_action', j_aa,
                    'counts_import_class', j_import_class,
                    'total_package_items', v_tot,
                    'reconciliation', jsonb_build_object(
                        'valid', v_valid,
                        'direct_core', v_direct,
                        'unchanged', v_unchanged,
                        'import_review_conflicts_staging', v_ir_conflicts,
                        'package_items', v_tot
                    )
                )
    WHERE id = v_pkg_id;

    TRUNCATE stage11_last_pkg;
    INSERT INTO stage11_last_pkg VALUES (v_pkg_id, v_pkg_name);

    TRUNCATE stage11_family_summary;

    INSERT INTO stage11_family_summary (entity_family, package_item_count, staging_eligible_count)
    SELECT
        fam.entity_family,
        coalesce(items.package_item_count, 0)::bigint,
        coalesce(
            nullif(j_staging ->> fam.entity_family, '')::bigint,
            0
        )::bigint
    FROM (
        SELECT entity_family
        FROM stage11_manifest
        WHERE implemented
        UNION
        SELECT entity_family
        FROM system.system_remote_review_package_items
        WHERE package_id = v_pkg_id
    ) AS fam(entity_family)
    LEFT JOIN (
        SELECT entity_family, count(*)::bigint AS package_item_count
        FROM system.system_remote_review_package_items
        WHERE package_id = v_pkg_id
        GROUP BY entity_family
    ) AS items
        ON items.entity_family = fam.entity_family;

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

SELECT
    'stage11_family_summary' AS section,
    fs.entity_family,
    fs.package_item_count,
    fs.staging_eligible_count
FROM stage11_family_summary AS fs
ORDER BY fs.entity_family;

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
