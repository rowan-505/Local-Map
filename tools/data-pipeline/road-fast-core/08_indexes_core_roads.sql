-- =============================================================================
-- Stage 08 (optional): ensure core.core_streets query indexes exist
-- Idempotent: CREATE INDEX IF NOT EXISTS only; never drops indexes.
-- Run after bulk promote (stage 06). No explicit transaction (per-statement commit).
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('core.core_streets') IS NULL THEN
        RAISE EXCEPTION 'core.core_streets does not exist';
    END IF;
END $$;

-- Partial unique on external_id only when no UNIQUE constraint/index already covers it
-- and active rows have no duplicate external_id values.
DO $$
DECLARE
    v_has_deleted_at boolean;
    v_where text;
    v_has_unique boolean;
    v_has_duplicates boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'core'
          AND t.relname = 'core_streets'
          AND c.contype IN ('u', 'p')
          AND (
              SELECT array_agg(a.attname ORDER BY ord.ordinality)
              FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid
               AND a.attnum = ord.attnum
               AND NOT a.attisdropped
          ) = ARRAY['external_id']::name[]
    )
    INTO v_has_unique;

    IF NOT v_has_unique THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes i
            WHERE i.schemaname = 'core'
              AND i.tablename = 'core_streets'
              AND i.indexdef ILIKE '%UNIQUE%'
              AND i.indexdef ILIKE '%(external_id%'
        )
        INTO v_has_unique;
    END IF;

    IF v_has_unique THEN
        RAISE NOTICE 'stage08: skip external_id unique index (constraint or unique index already present)';
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'deleted_at'
    )
    INTO v_has_deleted_at;

    v_where := 'external_id IS NOT NULL';
    IF v_has_deleted_at THEN
        v_where := v_where || ' AND deleted_at IS NULL';
    END IF;

    EXECUTE format(
        $q$
        SELECT EXISTS (
            SELECT 1
            FROM core.core_streets
            WHERE %s
            GROUP BY external_id
            HAVING count(*) > 1
        )
        $q$,
        v_where
    )
    INTO v_has_duplicates;

    IF v_has_duplicates THEN
        RAISE NOTICE 'stage08: skip external_id unique index (duplicate external_id values in scope)';
        RETURN;
    END IF;

    EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS core_streets_external_id_unique_idx ON core.core_streets (external_id) WHERE %s',
        v_where
    );
    RAISE NOTICE 'stage08: ensured core_streets_external_id_unique_idx';
END $$;

CREATE INDEX IF NOT EXISTS core_streets_geom_gix
    ON core.core_streets USING gist (geom);

CREATE INDEX IF NOT EXISTS core_streets_road_class_id_idx
    ON core.core_streets (road_class_id);

CREATE INDEX IF NOT EXISTS core_streets_is_active_idx
    ON core.core_streets (is_active);

CREATE INDEX IF NOT EXISTS core_streets_is_verified_idx
    ON core.core_streets (is_verified);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'verification_status'
    ) THEN
        EXECUTE $sql$
            CREATE INDEX IF NOT EXISTS core_streets_verification_status_idx
                ON core.core_streets (verification_status)
        $sql$;
        RAISE NOTICE 'stage08: ensured core_streets_verification_status_idx';
    ELSE
        RAISE NOTICE 'stage08: skip verification_status index (column missing)';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'source_type_id'
    ) THEN
        EXECUTE $sql$
            CREATE INDEX IF NOT EXISTS core_streets_source_type_id_idx
                ON core.core_streets (source_type_id)
        $sql$;
        RAISE NOTICE 'stage08: ensured core_streets_source_type_id_idx';
    ELSE
        RAISE NOTICE 'stage08: skip source_type_id index (column missing)';
    END IF;
END $$;

SELECT 'stage08_indexes_core_roads' AS stage, 'ok' AS status;
