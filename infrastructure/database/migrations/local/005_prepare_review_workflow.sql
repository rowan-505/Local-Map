-- =============================================================================
-- Local migration 005: prepare_review_workflow
-- =============================================================================
--
-- Purpose:
--   Add human review decision columns and supporting indexes on main staging
--   candidate tables for controlled batch promotion (no promotion here).
--
-- Scope:
--   - Local database only (staging schema).
--   - Does not touch Supabase, prod_mirror, core, or raw tables.
--   - Does not modify F1/F2/G pipeline scripts.
--
-- Missing staging tables are skipped with NOTICE (non-fatal).
--
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

DO $prepare_review$
DECLARE
    tbl text;
    tbls text[] := ARRAY[
        'staging_address_candidates',
        'staging_admin_area_candidates',
        'staging_building_candidates',
        'staging_bus_route_candidates',
        'staging_bus_route_stop_candidates',
        'staging_bus_route_variant_candidates',
        'staging_bus_stop_candidates',
        'staging_landuse_candidates',
        'staging_place_candidates',
        'staging_road_candidates',
        'staging_routing_barrier_candidates',
        'staging_routing_road_candidates',
        'staging_routing_turn_restriction_candidates',
        'staging_water_line_candidates',
        'staging_water_polygon_candidates'
    ];
    v_con_name text;
    v_has_snap boolean;
    v_has_match boolean;
    v_has_review_decision boolean;
    v_has_review_status boolean;
    v_has_auto boolean;
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        IF to_regclass(format('staging.%I', tbl)) IS NULL THEN
            RAISE NOTICE '005_prepare_review_workflow: skip missing table staging.%', tbl;
            CONTINUE;
        END IF;

        EXECUTE format(
            $sql$
            ALTER TABLE staging.%I
                ADD COLUMN IF NOT EXISTS review_decision text,
                ADD COLUMN IF NOT EXISTS reviewed_by text,
                ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
                ADD COLUMN IF NOT EXISTS review_note text,
                ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'pending',
                ADD COLUMN IF NOT EXISTS auto_action text,
                ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()
            $sql$,
            tbl
        );

        v_con_name := tbl || '_review_decision_allowed_chk';

        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint AS c
            INNER JOIN pg_catalog.pg_class AS rel
                ON rel.oid = c.conrelid
            INNER JOIN pg_catalog.pg_namespace AS n
                ON n.oid = rel.relnamespace
            WHERE n.nspname = 'staging'
              AND rel.relname = tbl
              AND c.conname = v_con_name
        ) THEN
            EXECUTE format(
                $sql$
                ALTER TABLE staging.%I
                    ADD CONSTRAINT %I
                    CHECK (
                        review_decision IS NULL
                        OR review_decision IN (
                            'approved',
                            'rejected',
                            'needs_more_review',
                            'ignored',
                            'merged'
                        )
                    )
                    NOT VALID
                $sql$,
                tbl,
                v_con_name
            );
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = 'staging'
              AND c.table_name = tbl
              AND c.column_name = 'source_snapshot_id'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = 'staging'
              AND c.table_name = tbl
              AND c.column_name = 'match_status'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = 'staging'
              AND c.table_name = tbl
              AND c.column_name = 'review_decision'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = 'staging'
              AND c.table_name = tbl
              AND c.column_name = 'review_status'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = 'staging'
              AND c.table_name = tbl
              AND c.column_name = 'auto_action'
        )
        INTO v_has_snap, v_has_match, v_has_review_decision, v_has_review_status,
            v_has_auto;

        IF v_has_snap AND v_has_review_decision THEN
            EXECUTE format(
                $sql$
                CREATE INDEX IF NOT EXISTS %I
                    ON staging.%I (source_snapshot_id, review_decision)
                $sql$,
                tbl || '_snd_review_decision_idx',
                tbl
            );
        END IF;

        IF v_has_snap AND v_has_review_status THEN
            EXECUTE format(
                $sql$
                CREATE INDEX IF NOT EXISTS %I
                    ON staging.%I (source_snapshot_id, review_status)
                $sql$,
                tbl || '_snd_review_status_idx',
                tbl
            );
        END IF;

        IF v_has_snap AND v_has_match THEN
            EXECUTE format(
                $sql$
                CREATE INDEX IF NOT EXISTS %I
                    ON staging.%I (source_snapshot_id, match_status)
                $sql$,
                tbl || '_snd_match_status_idx',
                tbl
            );
        END IF;

        IF v_has_snap AND v_has_auto THEN
            EXECUTE format(
                $sql$
                CREATE INDEX IF NOT EXISTS %I
                    ON staging.%I (source_snapshot_id, auto_action)
                $sql$,
                tbl || '_snd_auto_action_idx',
                tbl
            );
        END IF;
    END LOOP;
END
$prepare_review$;

WITH
targets AS (
    SELECT unnest(
        ARRAY[
            'staging_address_candidates',
            'staging_admin_area_candidates',
            'staging_building_candidates',
            'staging_bus_route_candidates',
            'staging_bus_route_stop_candidates',
            'staging_bus_route_variant_candidates',
            'staging_bus_stop_candidates',
            'staging_landuse_candidates',
            'staging_place_candidates',
            'staging_road_candidates',
            'staging_routing_barrier_candidates',
            'staging_routing_road_candidates',
            'staging_routing_turn_restriction_candidates',
            'staging_water_line_candidates',
            'staging_water_polygon_candidates'
        ]::text[]
    ) AS table_name
)
SELECT
    t.table_name,
    EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'staging'
          AND c.table_name = t.table_name
          AND c.column_name = 'review_status'
    ) AS has_review_status,
    EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'staging'
          AND c.table_name = t.table_name
          AND c.column_name = 'review_decision'
    ) AS has_review_decision,
    EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'staging'
          AND c.table_name = t.table_name
          AND c.column_name = 'reviewed_by'
    ) AS has_reviewed_by,
    EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'staging'
          AND c.table_name = t.table_name
          AND c.column_name = 'reviewed_at'
    ) AS has_reviewed_at,
    EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'staging'
          AND c.table_name = t.table_name
          AND c.column_name = 'review_note'
    ) AS has_review_note
FROM targets AS t
ORDER BY t.table_name;
