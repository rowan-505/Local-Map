-- =============================================================================
-- Stage 08c: assign production township admin_area_id via prod_mirror.
-- Runs after Stage 08b import_class. Local only — no Supabase writes.
--
-- Policy 1C: only importable rows (safe_new/safe_update + IR conflict classes).
-- Families: places, roads, buildings, landuse (2C).
--
-- psql vars:
--   snapshot_version
--   staging_schema      optional (default staging)
--   entity_families     optional (default all)
--   prod_mirror_schema  optional (default prod_mirror)
--   admin_assign_batch  optional (default 5000)
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif
\if :{?prod_mirror_schema}
\else
\set prod_mirror_schema 'prod_mirror'
\endif
\if :{?admin_assign_batch}
\else
\set admin_assign_batch 5000
\endif

BEGIN;

\ir pipeline_entity_families.sql
\ir pipeline_remote_review_conflict.sql
\ir pipeline_prod_admin_assign.sql

CREATE TEMP TABLE stage08c_params (
    snapshot_version text,
    staging_schema text NOT NULL,
    prod_mirror_schema text NOT NULL,
    batch_size integer NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08c_params VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'prod_mirror_schema'), ''), 'prod_mirror'),
    greatest(coalesce(NULLIF(btrim(:'admin_assign_batch'), '')::integer, 5000), 100)
);

CREATE TEMP TABLE stage08c_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    prod_mirror_schema text NOT NULL,
    batch_size integer NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08c_context
SELECT s.id, s.snapshot_version, p.staging_schema, p.prod_mirror_schema, p.batch_size
FROM system.system_source_snapshots s
JOIN stage08c_params p ON p.snapshot_version = s.snapshot_version;

DO $$
DECLARE
    v_schema text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM stage08c_context) THEN
        RAISE EXCEPTION 'snapshot_version not found';
    END IF;

    SELECT prod_mirror_schema INTO v_schema FROM stage08c_context LIMIT 1;

    IF to_regclass(format('%I.core_admin_areas', v_schema)) IS NULL
       OR to_regclass(format('%I.ref_admin_levels', v_schema)) IS NULL THEN
        RAISE EXCEPTION
            'Stage 08c requires %.core_admin_areas and %.ref_admin_levels. Refresh prod_mirror first.',
            v_schema, v_schema;
    END IF;
END $$;

CREATE TEMP TABLE stage08c_family (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL,
    geom_kind text NOT NULL  -- point | line | polygon
) ON COMMIT DROP;

INSERT INTO stage08c_family VALUES
    ('places', 'staging_place_candidates', 'point'),
    ('roads', 'staging_road_candidates', 'line'),
    ('buildings', 'staging_building_candidates', 'polygon'),
    ('landuse', 'staging_landuse_candidates', 'polygon');

DELETE FROM stage08c_family f
WHERE NOT pg_temp.pipeline_entity_family_enabled(f.entity_family);

CREATE TEMP TABLE stage08c_report (
    entity_family text,
    metric text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

DO $stage08c$
DECLARE
    ctx stage08c_context%ROWTYPE;
    fam RECORD;
    v_has_import_class boolean;
    v_has_point_geom boolean;
    v_has_geom boolean;
    v_eligible bigint;
    v_updated bigint;
    v_assigned bigint;
    v_null bigint;
    v_last_id bigint;
    v_batch integer;
    v_sql text;
    v_geom_expr text;
    v_fn text;
BEGIN
    SELECT * INTO ctx FROM stage08c_context LIMIT 1;

    FOR fam IN
        SELECT * FROM stage08c_family ORDER BY entity_family
    LOOP
        IF to_regclass(format('%I.%I', ctx.staging_schema, fam.staging_table)) IS NULL THEN
            INSERT INTO stage08c_report VALUES (
                fam.entity_family, 'skipped', 0, 'WARN',
                format('missing table %.%', ctx.staging_schema, fam.staging_table)
            );
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = fam.staging_table
              AND column_name = 'import_class'
        ) INTO v_has_import_class;

        IF NOT v_has_import_class THEN
            INSERT INTO stage08c_report VALUES (
                fam.entity_family, 'skipped', 0, 'WARN',
                'import_class column missing — run Stage 08b first'
            );
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = fam.staging_table
              AND column_name = 'point_geom'
        ) INTO v_has_point_geom;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = fam.staging_table
              AND column_name = 'geom'
        ) INTO v_has_geom;

        IF fam.geom_kind = 'point' THEN
            IF v_has_point_geom THEN
                v_geom_expr := 's.point_geom';
            ELSIF v_has_geom THEN
                v_geom_expr := 's.geom';
            ELSE
                INSERT INTO stage08c_report VALUES (
                    fam.entity_family, 'skipped', 0, 'WARN', 'no point_geom/geom column'
                );
                CONTINUE;
            END IF;
            v_fn := 'system.pipeline_find_township_for_point_prod';
        ELSIF fam.geom_kind = 'line' THEN
            IF NOT v_has_geom THEN
                INSERT INTO stage08c_report VALUES (
                    fam.entity_family, 'skipped', 0, 'WARN', 'no geom column'
                );
                CONTINUE;
            END IF;
            v_geom_expr := 's.geom';
            v_fn := 'system.pipeline_find_township_for_line_prod';
        ELSE
            IF NOT v_has_geom THEN
                INSERT INTO stage08c_report VALUES (
                    fam.entity_family, 'skipped', 0, 'WARN', 'no geom column'
                );
                CONTINUE;
            END IF;
            -- Buildings/landuse: use representative point for township lookup.
            -- Full polygon spatial match is too slow for multi-million national rows.
            IF fam.entity_family IN ('buildings', 'landuse') THEN
                v_geom_expr := 'ST_PointOnSurface(s.geom)';
                v_fn := 'system.pipeline_find_township_for_point_prod';
            ELSE
                v_geom_expr := 's.geom';
                v_fn := 'system.pipeline_find_township_for_polygon_prod';
            END IF;
        END IF;

        EXECUTE format(
            $c$
            SELECT count(*)
            FROM %I.%I AS s
            WHERE s.source_snapshot_id = $1
              AND system.pipeline_is_importable_for_admin_class(s.import_class)
              AND %s IS NOT NULL
            $c$,
            ctx.staging_schema, fam.staging_table, v_geom_expr
        )
        INTO v_eligible
        USING ctx.source_snapshot_id;

        INSERT INTO stage08c_report VALUES (
            fam.entity_family, 'eligible_importable', v_eligible, 'INFO',
            format('geom_kind=%s fn=%s', fam.geom_kind, v_fn)
        );

        v_updated := 0;
        v_last_id := 0;

        LOOP
            v_sql := format(
                $u$
                WITH batch AS (
                    SELECT s.id
                    FROM %I.%I AS s
                    WHERE s.source_snapshot_id = $1
                      AND s.id > $2
                      AND system.pipeline_is_importable_for_admin_class(s.import_class)
                      AND %s IS NOT NULL
                    ORDER BY s.id
                    LIMIT $3
                ),
                assigned AS (
                    SELECT
                        s.id,
                        %s(%s, $4) AS prod_admin_id
                    FROM %I.%I AS s
                    INNER JOIN batch AS b ON b.id = s.id
                ),
                upd AS (
                    UPDATE %I.%I AS s
                    SET
                        normalized_data = system.pipeline_set_prod_admin_normalized_data(
                            s.normalized_data,
                            a.prod_admin_id
                        ),
                        updated_at = now()
                    FROM assigned AS a
                    WHERE s.id = a.id
                    RETURNING s.id,
                        (a.prod_admin_id IS NOT NULL) AS has_admin
                )
                SELECT
                    coalesce(max(id), $2) AS last_id,
                    count(*)::bigint AS n_updated,
                    count(*) FILTER (WHERE has_admin)::bigint AS n_assigned
                FROM upd
                $u$,
                ctx.staging_schema, fam.staging_table, v_geom_expr,
                v_fn, v_geom_expr,
                ctx.staging_schema, fam.staging_table,
                ctx.staging_schema, fam.staging_table
            );

            EXECUTE v_sql
            INTO v_last_id, v_batch, v_assigned
            USING ctx.source_snapshot_id, v_last_id, ctx.batch_size, ctx.prod_mirror_schema;

            v_updated := v_updated + coalesce(v_batch, 0);

            RAISE NOTICE 'progress: %/% (%)%% stage08c family=% batch last_id=% updated=% assigned=%',
                v_updated,
                greatest(v_eligible, v_updated),
                CASE
                    WHEN greatest(v_eligible, 1) > 0
                    THEN round(100.0 * v_updated / greatest(v_eligible, 1), 2)
                    ELSE 100
                END,
                fam.entity_family, v_last_id, v_batch, v_assigned;
            RAISE NOTICE 'stage08c_%: batch last_id=% updated=% assigned=%',
                fam.entity_family, v_last_id, v_batch, v_assigned;

            EXIT WHEN coalesce(v_batch, 0) = 0;
        END LOOP;

        EXECUTE format(
            $n$
            SELECT count(*)
            FROM %I.%I AS s
            WHERE s.source_snapshot_id = $1
              AND system.pipeline_is_importable_for_admin_class(s.import_class)
              AND nullif(s.normalized_data->>'admin_area_id', '') IS NULL
            $n$,
            ctx.staging_schema, fam.staging_table
        )
        INTO v_null
        USING ctx.source_snapshot_id;

        INSERT INTO stage08c_report VALUES (
            fam.entity_family, 'updated_rows', v_updated, 'PASS',
            'normalized_data.admin_area_id written from prod_mirror'
        );
        INSERT INTO stage08c_report VALUES (
            fam.entity_family, 'null_admin_after', v_null,
            CASE WHEN v_null = 0 THEN 'PASS' ELSE 'WARN' END,
            'importable rows still missing admin_area_id (NO_MATCH/AMBIGUOUS OK)'
        );
    END LOOP;
END
$stage08c$;

SELECT * FROM stage08c_report ORDER BY entity_family, metric;

COMMIT;
