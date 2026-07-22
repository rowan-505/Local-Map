DO $refresh_prod_mirror$
DECLARE
    t record;
    v_available text[];
    v_selected text[];
    v_missing_required text[];
    v_select_list text;
    v_sql text;
    v_live bigint;
    v_mirror bigint;
    v_geom_expr text;
    v_name_expr text;
    v_class_expr text;
    v_manual_expr text;
    v_verified_expr text;
    v_verstatus_expr text;
    v_deleted_expr text;
    v_ext_expr text;
    col record;
    idx_name text;
    v_project_ref text;
    v_host text;
    v_database text;
    v_user text;
BEGIN
    SELECT source_project_ref, source_host, source_database, source_user
    INTO v_project_ref, v_host, v_database, v_user
    FROM prod_mirror_source_params
    LIMIT 1;

    FOR t IN SELECT * FROM prod_mirror_table_manifest ORDER BY table_name LOOP
        IF to_regclass(format('supabase_fdw.%I', t.table_name)) IS NULL THEN
            INSERT INTO prod_mirror_refresh_report
            VALUES (
                t.table_name, t.family_group, NULL, NULL, NULL,
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                'Foreign table missing; run 02_import_foreign_tables.sql.'
            );
            IF t.required_for_f2 THEN
                RAISE EXCEPTION 'required foreign table supabase_fdw.% is missing', t.table_name;
            END IF;
            CONTINUE;
        END IF;

        v_available := prod_mirror.fdw_columns(t.table_name);
        v_selected := prod_mirror.intersect_columns(v_available, t.wanted_columns);

        IF NOT ('id' = ANY (v_selected)) THEN
            INSERT INTO prod_mirror_refresh_report
            VALUES (
                t.table_name, t.family_group, NULL, NULL, cardinality(v_selected),
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                'FDW table has no id column; skipped.'
            );
            IF t.required_for_f2 THEN
                RAISE EXCEPTION 'required mirror table % has no id column on FDW', t.table_name;
            END IF;
            CONTINUE;
        END IF;

        v_missing_required := ARRAY[]::text[];
        IF t.has_external_id AND NOT ('external_id' = ANY (v_available)) THEN
            v_missing_required := array_append(v_missing_required, 'external_id');
        END IF;
        IF t.required_for_f2 AND t.geom_column IS NOT NULL AND NOT (t.geom_column = ANY (v_available)) THEN
            v_missing_required := array_append(v_missing_required, t.geom_column);
        END IF;
        IF cardinality(v_missing_required) > 0 AND t.required_for_f2 THEN
            RAISE EXCEPTION
                'required columns missing on supabase_fdw.%: %',
                t.table_name,
                array_to_string(v_missing_required, ', ');
        END IF;

        v_select_list := prod_mirror.quote_ident_list(v_selected);

        IF t.geom_column IS NOT NULL AND t.geom_column = ANY (v_selected) THEN
            v_geom_expr := format('src.%I', t.geom_column);
        ELSE
            v_geom_expr := 'NULL::geometry';
        END IF;

        IF cardinality(prod_mirror.intersect_columns(v_selected, t.name_columns)) > 0 THEN
            SELECT 'coalesce(' || string_agg(format('nullif(btrim(src.%I::text), '''')', c), ', ') || ')'
            INTO v_name_expr
            FROM unnest(prod_mirror.intersect_columns(v_selected, t.name_columns)) AS c;
        ELSE
            v_name_expr := 'NULL::text';
        END IF;

        IF cardinality(prod_mirror.intersect_columns(v_selected, t.class_columns)) > 0 THEN
            SELECT 'coalesce(' || string_agg(format('nullif(btrim(src.%I::text), '''')', c), ', ') || ')'
            INTO v_class_expr
            FROM unnest(prod_mirror.intersect_columns(v_selected, t.class_columns)) AS c;
        ELSE
            v_class_expr := 'NULL::text';
        END IF;

        v_manual_expr := CASE
            WHEN t.has_manual_override AND 'manual_override' = ANY (v_selected) THEN 'src.manual_override'
            ELSE 'NULL::boolean'
        END;
        v_verified_expr := CASE
            WHEN t.has_is_verified AND 'is_verified' = ANY (v_selected) THEN 'src.is_verified'
            ELSE 'NULL::boolean'
        END;
        v_verstatus_expr := CASE
            WHEN t.has_verification_status AND 'verification_status' = ANY (v_selected)
                THEN 'src.verification_status'
            ELSE 'NULL::text'
        END;
        v_deleted_expr := CASE
            WHEN t.has_deleted_at AND 'deleted_at' = ANY (v_selected) THEN 'src.deleted_at'
            ELSE 'NULL::timestamptz'
        END;
        v_ext_expr := CASE
            WHEN 'external_id' = ANY (v_selected) THEN 'src.external_id'
            ELSE 'NULL::text'
        END;

        EXECUTE format('SELECT count(*)::bigint FROM supabase_fdw.%I', t.table_name) INTO v_live;
        EXECUTE format('DROP TABLE IF EXISTS prod_mirror.%I', t.table_name);

        v_sql := format(
            $c$
            CREATE TABLE prod_mirror.%1$I AS
            SELECT
                src.id AS core_id,
                src.*,
                prod_mirror.geometry_hash(%2$s) AS geometry_hash,
                prod_mirror.source_content_hash(
                    %3$s,
                    %4$s,
                    %5$s,
                    %2$s,
                    %6$s,
                    %7$s,
                    %8$s,
                    %9$s
                ) AS source_content_hash
            FROM (
                SELECT %10$s
                FROM supabase_fdw.%1$I
            ) AS src
            $c$,
            t.table_name,
            v_geom_expr,
            v_ext_expr,
            v_name_expr,
            v_class_expr,
            v_manual_expr,
            v_verified_expr,
            v_verstatus_expr,
            v_deleted_expr,
            v_select_list
        );

        EXECUTE v_sql;
        EXECUTE format('SELECT count(*)::bigint FROM prod_mirror.%I', t.table_name) INTO v_mirror;

        IF v_live IS DISTINCT FROM v_mirror THEN
            RAISE EXCEPTION
                'row-count mismatch for %: live FDW=%s mirror=%s',
                t.table_name, v_live, v_mirror;
        END IF;

        INSERT INTO prod_mirror_count_json VALUES (t.table_name, v_live, v_mirror);
        INSERT INTO prod_mirror_refresh_report
        VALUES (
            t.table_name,
            t.family_group,
            v_live,
            v_mirror,
            cardinality(v_selected),
            'PASS',
            format('Slim copy (%s columns) + core_id/geometry_hash/source_content_hash.', cardinality(v_selected))
        );

        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (core_id)',
            left('pm_' || t.table_name || '_core_id_idx', 63),
            t.table_name
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (id)',
            left('pm_' || t.table_name || '_id_idx', 63),
            t.table_name
        );

        IF 'external_id' = ANY (v_selected) THEN
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (external_id)',
                left('pm_' || t.table_name || '_external_id_idx', 63),
                t.table_name
            );
        END IF;
        IF 'deleted_at' = ANY (v_selected) THEN
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (deleted_at)',
                left('pm_' || t.table_name || '_deleted_at_idx', 63),
                t.table_name
            );
        END IF;
        IF 'manual_override' = ANY (v_selected) THEN
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (manual_override)',
                left('pm_' || t.table_name || '_manual_idx', 63),
                t.table_name
            );
        END IF;
        IF 'is_verified' = ANY (v_selected) THEN
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (is_verified)',
                left('pm_' || t.table_name || '_verified_idx', 63),
                t.table_name
            );
        END IF;

        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (source_content_hash)',
            left('pm_' || t.table_name || '_sch_idx', 63),
            t.table_name
        );

        FOR col IN
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'prod_mirror'
              AND table_name = t.table_name
              AND column_name IN (
                  'canonical_name', 'primary_name', 'display_name', 'name',
                  'full_address', 'place_id', 'street_id', 'admin_area_id', 'address_id'
              )
        LOOP
            idx_name := left(format('pm_%s_%s_idx', t.table_name, col.column_name), 63);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (%I)',
                idx_name, t.table_name, col.column_name
            );
        END LOOP;

        FOR col IN
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'prod_mirror'
              AND table_name = t.table_name
              AND udt_name = 'geometry'
        LOOP
            idx_name := left(format('pm_%s_%s_gix', t.table_name, col.column_name), 63);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I USING gist (%I)',
                idx_name, t.table_name, col.column_name
            );
        END LOOP;
    END LOOP;

    INSERT INTO prod_mirror.mirror_meta AS m (
        id,
        refreshed_at,
        source_project_ref,
        source_host,
        source_database,
        source_user,
        refresh_mode,
        table_counts,
        live_counts,
        notes,
        updated_at
    )
    VALUES (
        1,
        now(),
        v_project_ref,
        v_host,
        v_database,
        v_user,
        'slim_family_columns',
        coalesce(
            (SELECT jsonb_object_agg(table_name, mirror_count) FROM prod_mirror_count_json),
            '{}'::jsonb
        ),
        coalesce(
            (SELECT jsonb_object_agg(table_name, live_count) FROM prod_mirror_count_json),
            '{}'::jsonb
        ),
        jsonb_build_object(
            'includes_deleted_rows', true,
            'omits_normalized_data', true,
            'computed_fields', jsonb_build_array('core_id', 'geometry_hash', 'source_content_hash')
        ),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
        refreshed_at = EXCLUDED.refreshed_at,
        source_project_ref = EXCLUDED.source_project_ref,
        source_host = EXCLUDED.source_host,
        source_database = EXCLUDED.source_database,
        source_user = EXCLUDED.source_user,
        refresh_mode = EXCLUDED.refresh_mode,
        table_counts = EXCLUDED.table_counts,
        live_counts = EXCLUDED.live_counts,
        notes = EXCLUDED.notes,
        updated_at = now();
END
$refresh_prod_mirror$;
