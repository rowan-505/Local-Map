-- =============================================================================
-- 03_create_admin_assignment_functions.sql
-- Core schema functions for geometry-based admin_area assignment + pipeline helpers.
-- Idempotent: CREATE OR REPLACE only (no DROP). Does not touch import_review.
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

-- ---------------------------------------------------------------------------
-- Session helpers (repair/backfill scripts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.pipeline_dry_run_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT lower(trim(coalesce(current_setting('coremap.dry_run', true), 'false'))) IN (
        'true', 't', '1', 'yes', 'on'
    );
$$;

CREATE OR REPLACE FUNCTION core.pipeline_truthy_setting(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(trim(coalesce(p_value, ''))) IN ('true', 't', '1', 'yes', 'on');
$$;

CREATE OR REPLACE FUNCTION core.pipeline_force_recalculate_verified()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT core.pipeline_truthy_setting(
        current_setting('coremap.force_recalculate_verified', true)
    );
$$;

CREATE OR REPLACE FUNCTION core.pipeline_force_manual_override()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT core.pipeline_truthy_setting(
        current_setting('coremap.force_manual_override', true)
    );
$$;

CREATE OR REPLACE FUNCTION core.pipeline_write_admin_repair_metadata()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT core.pipeline_truthy_setting(
        current_setting('coremap.write_admin_repair_metadata', true)
    );
$$;

COMMENT ON FUNCTION core.pipeline_write_admin_repair_metadata() IS
    'When false (default), entity backfill skips normalized_data.admin_area_repair writes.';

CREATE OR REPLACE FUNCTION core.pipeline_chunk_limit()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
    SELECT greatest(
        coalesce(
            nullif(trim(current_setting('coremap.limit_rows', true)), '')::integer,
            1000
        ),
        1
    );
$$;

COMMENT ON FUNCTION core.pipeline_chunk_limit() IS
    'Chunk size for entity admin backfill loops (coremap.limit_rows psql var; default 1000).';

CREATE OR REPLACE FUNCTION core.entity_row_is_verified_protected(
    p_is_verified boolean,
    p_verification_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(p_is_verified, false)
        OR lower(trim(coalesce(p_verification_status, ''))) = 'verified';
$$;

COMMENT ON FUNCTION core.entity_row_is_verified_protected(boolean, text) IS
    'True when is_verified or verification_status indicates a verified row.';

CREATE OR REPLACE FUNCTION core.entity_admin_assignment_is_protected(
    p_manual_override boolean,
    p_is_verified boolean,
    p_verification_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT (
            coalesce(p_manual_override, false)
            AND NOT core.pipeline_force_manual_override()
        )
        OR (
            core.entity_row_is_verified_protected(p_is_verified, p_verification_status)
            AND NOT core.pipeline_force_recalculate_verified()
        );
$$;

COMMENT ON FUNCTION core.entity_admin_assignment_is_protected(boolean, boolean, text) IS
    'Skip backfill when manual_override or verified (unless force recalculate).';

CREATE OR REPLACE FUNCTION core.build_admin_area_repair_metadata(
    p_previous_admin_area_id bigint,
    p_calculated_admin_area_id bigint,
    p_repair_method text
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'previous_admin_area_id', p_previous_admin_area_id,
        'calculated_admin_area_id', p_calculated_admin_area_id,
        'repair_run_at', to_jsonb(clock_timestamp()),
        'repair_method', p_repair_method
    );
$$;

COMMENT ON FUNCTION core.build_admin_area_repair_metadata(bigint, bigint, text) IS
    'Single admin_area_repair object (replaced on each run, never nested).';

CREATE OR REPLACE FUNCTION core.merge_admin_area_repair_normalized_data(
    p_normalized_data jsonb,
    p_repair jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_normalized_data IS NULL THEN
            jsonb_build_object('admin_area_repair', p_repair)
        ELSE
            jsonb_set(p_normalized_data, '{admin_area_repair}', p_repair, true)
    END;
$$;

COMMENT ON FUNCTION core.merge_admin_area_repair_normalized_data(jsonb, jsonb) IS
    'Overwrite normalized_data.admin_area_repair; preserve all other keys.';

CREATE OR REPLACE FUNCTION core.normalized_data_admin_area_repair_is_current(
    p_normalized_data jsonb,
    p_previous_admin_area_id bigint,
    p_calculated_admin_area_id bigint,
    p_repair_method text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    WITH rep AS (
        SELECT coalesce(p_normalized_data->'admin_area_repair', '{}'::jsonb) AS j
    )
    SELECT coalesce(rep.j->>'repair_method', rep.j->>'assignment_method', '')
        = coalesce(p_repair_method, '')
      AND coalesce(
            nullif(rep.j->>'calculated_admin_area_id', '')::bigint,
            nullif(rep.j->>'new_admin_area_id', '')::bigint
        ) IS NOT DISTINCT FROM p_calculated_admin_area_id
      AND coalesce(
            nullif(rep.j->>'previous_admin_area_id', '')::bigint,
            nullif(rep.j->>'old_admin_area_id', '')::bigint
        ) IS NOT DISTINCT FROM p_previous_admin_area_id
    FROM rep;
$$;

CREATE OR REPLACE FUNCTION core.normalized_data_needs_admin_area_repair_update(
    p_normalized_data jsonb,
    p_previous_admin_area_id bigint,
    p_calculated_admin_area_id bigint,
    p_repair_method text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT NOT core.normalized_data_admin_area_repair_is_current(
        p_normalized_data,
        p_previous_admin_area_id,
        p_calculated_admin_area_id,
        p_repair_method
    );
$$;

CREATE OR REPLACE FUNCTION core.admin_area_hierarchy_is_protected(p_is_verified boolean)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(p_is_verified, false)
        AND NOT core.pipeline_force_recalculate_verified();
$$;

-- ---------------------------------------------------------------------------
-- Geometry + admin-level matching helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.normalize_admin_lookup_geom(p_geom geometry)
RETURNS geometry
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_geom IS NULL OR st_isempty(p_geom) THEN
        RETURN NULL;
    END IF;

    RETURN st_makevalid(st_setsrid(p_geom, 4326));
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION core.admin_level_matches_target(
    p_level_code text,
    p_level_name text,
    p_target_admin_level_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_target_admin_level_code, '')), '') IS NULL THEN false
        ELSE lower(btrim(p_target_admin_level_code)) IN (
            lower(btrim(coalesce(p_level_code, ''))),
            lower(btrim(coalesce(p_level_name, '')))
        )
        OR (
            lower(btrim(p_target_admin_level_code)) IN ('township', 'town')
            AND lower(btrim(coalesce(p_level_code, ''))) IN ('township', 'town')
        )
        OR (
            lower(btrim(p_target_admin_level_code)) = 'village'
            AND lower(btrim(coalesce(p_level_code, ''))) IN ('village', 'hamlet', 'village_tract')
        )
        OR (
            lower(btrim(p_target_admin_level_code)) IN ('state', 'state_region', 'region')
            AND lower(btrim(coalesce(p_level_code, ''))) IN (
                'state', 'state_region', 'region', 'division'
            )
        )
    END;
$$;

CREATE OR REPLACE FUNCTION core.admin_area_row_matches_target(
    p_admin_level_id bigint,
    p_level_code text,
    p_level_name text,
    p_target_admin_level_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_target_admin_level_code, '')), '') IS NULL THEN false
        WHEN core.admin_level_matches_target(
            p_level_code,
            p_level_name,
            p_target_admin_level_code
        ) THEN true
        ELSE EXISTS (
            SELECT 1
            FROM ref.ref_admin_levels AS tl
            WHERE tl.id = p_admin_level_id
              AND (
                  lower(btrim(tl.code)) = lower(btrim(p_target_admin_level_code))
                  OR lower(btrim(tl.name)) = lower(btrim(p_target_admin_level_code))
              )
        )
        OR EXISTS (
            SELECT 1
            FROM ref.ref_admin_levels AS want
            INNER JOIN ref.ref_admin_levels AS have ON have.id = p_admin_level_id
            WHERE (
                lower(btrim(want.code)) = lower(btrim(p_target_admin_level_code))
                OR lower(btrim(want.name)) = lower(btrim(p_target_admin_level_code))
            )
              AND want.rank IS NOT NULL
              AND have.rank IS NOT NULL
              AND want.rank = have.rank
        )
    END;
$$;

COMMENT ON FUNCTION core.admin_area_row_matches_target(bigint, text, text, text) IS
    'Match target admin level via ref code/name aliases, ref row id, or equal ref.rank.';

CREATE OR REPLACE FUNCTION core.admin_area_matches_assignment_target(
    p_admin_level_id bigint,
    p_level_code text,
    p_level_name text,
    p_target_admin_level_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_target_admin_level_code, '')), '') IS NULL THEN true
        ELSE core.admin_area_row_matches_target(
            p_admin_level_id,
            p_level_code,
            p_level_name,
            p_target_admin_level_code
        )
    END;
$$;

COMMENT ON FUNCTION core.admin_area_matches_assignment_target(bigint, text, text, text) IS
    'When target level is NULL, any active admin level matches; otherwise filter to target level.';

CREATE OR REPLACE FUNCTION core.admin_area_level_code_is_ward_like(p_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(trim(coalesce(p_code, ''))) IN (
        'ward', 'suburb', 'quarter', 'neighbourhood', 'village_tract'
    );
$$;

COMMENT ON FUNCTION core.admin_area_level_code_is_ward_like(text) IS
    'True for fine-grained admin levels where line overlap can be ambiguous.';

CREATE OR REPLACE FUNCTION core.admin_area_rep_point(
    p_geom geometry,
    p_centroid geometry
)
RETURNS geometry(Point, 4326)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT st_setsrid(
        coalesce(
            CASE
                WHEN p_centroid IS NOT NULL
                     AND NOT st_isempty(p_centroid)
                     AND st_isvalid(p_centroid)
                    THEN p_centroid
                ELSE NULL
            END,
            CASE
                WHEN p_geom IS NOT NULL
                     AND NOT st_isempty(p_geom)
                     AND st_isvalid(p_geom)
                    THEN st_pointonsurface(st_makevalid(st_setsrid(p_geom, 4326)))
                ELSE NULL
            END
        ),
        4326
    )::geometry(Point, 4326);
$$;

CREATE OR REPLACE FUNCTION core.entity_rep_point_for_admin_lookup(p_geom geometry)
RETURNS geometry(Point, 4326)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL OR st_isempty(p_geom) THEN NULL::geometry(Point, 4326)
        WHEN st_geometrytype(p_geom) IN ('ST_Point', 'ST_MultiPoint')
            THEN st_setsrid(st_pointonsurface(p_geom), 4326)::geometry(Point, 4326)
        ELSE st_setsrid(st_pointonsurface(st_makevalid(st_setsrid(p_geom, 4326))), 4326)::geometry(Point, 4326)
    END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Point → smallest containing active admin area (optional level filter)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.find_admin_area_for_point(
    p_geom geometry,
    target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_point geometry(Point, 4326);
    v_result bigint;
BEGIN
    v_point := core.entity_rep_point_for_admin_lookup(p_geom);
    IF v_point IS NULL OR st_isempty(v_point) OR NOT st_isvalid(v_point) THEN
        RETURN NULL;
    END IF;

    SELECT aa.id
    INTO v_result
    FROM core.core_admin_areas AS aa
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND aa.geom IS NOT NULL
      AND NOT st_isempty(aa.geom)
      AND st_isvalid(aa.geom)
      AND core.admin_area_matches_assignment_target(
          aa.admin_level_id, al.code, al.name, target_admin_level_code
      )
      AND (
          st_covers(aa.geom, v_point)
          OR st_contains(aa.geom, v_point)
          OR st_intersects(aa.geom, v_point)
      )
    ORDER BY st_area(aa.geom::geography) ASC NULLS LAST, aa.id ASC
    LIMIT 1;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.find_admin_area_for_point(geometry, text) IS
    'Smallest active admin polygon containing the representative point. NULL target = any level (township not required).';

CREATE OR REPLACE FUNCTION core.pick_admin_area_for_line_overlap(
    p_line_geom geometry,
    p_target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_line geometry;
    v_line_len double precision;
    v_result bigint;
BEGIN
    v_line := core.normalize_admin_lookup_geom(p_line_geom);
    IF v_line IS NULL OR st_isempty(v_line) OR NOT st_isvalid(v_line) THEN
        RETURN NULL;
    END IF;

    v_line_len := st_length(v_line::geography);
    IF v_line_len IS NULL OR v_line_len <= 0 THEN
        RETURN core.find_admin_area_for_point(
            core.entity_rep_point_for_admin_lookup(v_line),
            p_target_admin_level_code
        );
    END IF;

    SELECT c.id
    INTO v_result
    FROM core.core_admin_areas AS c
    INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
    CROSS JOIN LATERAL (
        SELECT st_length(st_intersection(c.geom, v_line)::geography) AS overlap_m
    ) AS x
    WHERE c.is_active IS TRUE
      AND c.deleted_at IS NULL
      AND c.geom IS NOT NULL
      AND NOT st_isempty(c.geom)
      AND st_isvalid(c.geom)
      AND core.admin_area_matches_assignment_target(
          c.admin_level_id, al.code, al.name, p_target_admin_level_code
      )
      AND st_intersects(c.geom, v_line)
      AND x.overlap_m > 0
    ORDER BY
        x.overlap_m DESC NULLS LAST,
        (x.overlap_m / v_line_len) DESC NULLS LAST,
        st_area(c.geom::geography) ASC NULLS LAST,
        c.id ASC
    LIMIT 1;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.pick_admin_area_for_line_overlap(geometry, text) IS
    'Best admin area for a line: largest intersection length/ratio, then smallest polygon.';

-- ---------------------------------------------------------------------------
-- 2. Line → overlap-based assignment with ward instability fallback
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.find_admin_area_for_line(
    p_geom geometry,
    target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_geom geometry;
    v_line_len double precision;
    v_result bigint;
    v_ward_hit_count integer := 0;
    v_level text;
    v_levels text[] := ARRAY['township', 'district', 'state_region'];
BEGIN
    v_geom := core.normalize_admin_lookup_geom(p_geom);
    IF v_geom IS NULL OR st_isempty(v_geom) OR NOT st_isvalid(v_geom) THEN
        RETURN NULL;
    END IF;

    IF st_dimension(v_geom) <> 1
       AND st_geometrytype(v_geom) NOT IN ('ST_LineString', 'ST_MultiLineString') THEN
        RETURN core.find_admin_area_for_point(v_geom, target_admin_level_code);
    END IF;

    IF nullif(btrim(coalesce(target_admin_level_code, '')), '') IS NOT NULL THEN
        v_result := core.pick_admin_area_for_line_overlap(v_geom, target_admin_level_code);
        IF v_result IS NOT NULL THEN
            RETURN v_result;
        END IF;
        RETURN core.find_admin_area_for_point(
            core.entity_rep_point_for_admin_lookup(v_geom),
            target_admin_level_code
        );
    END IF;

    v_line_len := st_length(v_geom::geography);

    IF v_line_len IS NOT NULL AND v_line_len > 0 THEN
        SELECT count(*)::integer
        INTO v_ward_hit_count
        FROM core.core_admin_areas AS c
        INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
        CROSS JOIN LATERAL (
            SELECT st_length(st_intersection(c.geom, v_geom)::geography) AS overlap_m
        ) AS x
        WHERE c.is_active IS TRUE
          AND c.deleted_at IS NULL
          AND c.geom IS NOT NULL
          AND NOT st_isempty(c.geom)
          AND st_isvalid(c.geom)
          AND st_intersects(c.geom, v_geom)
          AND x.overlap_m > 0
          AND core.admin_area_level_code_is_ward_like(al.code)
          AND (
              x.overlap_m >= (v_line_len * 0.08)
              OR (x.overlap_m / v_line_len) >= 0.08
          );
    END IF;

    IF coalesce(v_ward_hit_count, 0) >= 2 THEN
        FOREACH v_level IN ARRAY v_levels LOOP
            v_result := core.pick_admin_area_for_line_overlap(v_geom, v_level);
            IF v_result IS NOT NULL THEN
                RETURN v_result;
            END IF;
        END LOOP;
    END IF;

    v_result := core.pick_admin_area_for_line_overlap(v_geom, NULL);
    IF v_result IS NOT NULL THEN
        RETURN v_result;
    END IF;

    SELECT c.id
    INTO v_result
    FROM core.core_admin_areas AS c
    INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
    WHERE c.is_active IS TRUE
      AND c.deleted_at IS NULL
      AND c.geom IS NOT NULL
      AND NOT st_isempty(c.geom)
      AND st_isvalid(c.geom)
      AND (
          st_covers(c.geom, v_geom)
          OR st_contains(c.geom, v_geom)
      )
    ORDER BY st_area(c.geom::geography) ASC NULLS LAST, c.id ASC
    LIMIT 1;

    IF v_result IS NULL THEN
        v_result := core.find_admin_area_for_point(
            core.entity_rep_point_for_admin_lookup(v_geom),
            NULL
        );
    END IF;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.find_admin_area_for_line(geometry, text) IS
    'Line: prefer largest overlap with smallest admin polygon; if multiple ward-like hits, fallback township→district→state_region.';

-- ---------------------------------------------------------------------------
-- 3. Polygon → point-on-surface, then smallest containing intersection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.find_admin_area_for_polygon(
    p_geom geometry,
    target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_geom geometry;
    v_point geometry(Point, 4326);
    v_result bigint;
BEGIN
    v_geom := core.normalize_admin_lookup_geom(p_geom);
    IF v_geom IS NULL OR st_isempty(v_geom) OR NOT st_isvalid(v_geom) THEN
        RETURN NULL;
    END IF;

    v_point := st_pointonsurface(v_geom)::geometry(Point, 4326);
    v_result := core.find_admin_area_for_point(v_point, target_admin_level_code);
    IF v_result IS NOT NULL THEN
        RETURN v_result;
    END IF;

    BEGIN
        SELECT aa.id
        INTO v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_matches_assignment_target(
              aa.admin_level_id, al.code, al.name, target_admin_level_code
          )
          AND st_intersects(aa.geom, v_geom)
        ORDER BY
            st_area(st_intersection(aa.geom, v_geom)::geography) DESC NULLS LAST,
            st_area(aa.geom::geography) ASC NULLS LAST,
            aa.id ASC
        LIMIT 1;
    EXCEPTION
        WHEN OTHERS THEN
            v_result := NULL;
    END;

    IF v_result IS NULL THEN
        v_result := core.find_admin_area_for_point(v_point, target_admin_level_code);
    END IF;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.find_admin_area_for_polygon(geometry, text) IS
    'Polygon: smallest containing area at point-on-surface, then largest intersection patch.';

-- ---------------------------------------------------------------------------
-- Backfill compatibility wrapper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.lookup_admin_area_id_for_point(
    p_point geometry,
    p_prefer_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    SELECT core.find_admin_area_for_point(p_point, p_prefer_level_code);
$$;

COMMENT ON FUNCTION core.lookup_admin_area_id_for_point(geometry, text) IS
    'Alias for core.find_admin_area_for_point (backfill scripts). NULL level = smallest containing area.';

-- ---------------------------------------------------------------------------
-- Validate existing FK assignment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.is_admin_area_id_valid_for_point(
    p_admin_area_id bigint,
    p_point geometry
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_admin_area_id IS NULL THEN false
        WHEN p_point IS NULL OR st_isempty(p_point) THEN false
        ELSE EXISTS (
            SELECT 1
            FROM core.core_admin_areas AS aa
            WHERE aa.id = p_admin_area_id
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND aa.geom IS NOT NULL
              AND NOT st_isempty(aa.geom)
              AND st_isvalid(aa.geom)
              AND (st_covers(aa.geom, p_point) OR st_intersects(aa.geom, p_point))
        )
    END;
$$;

CREATE OR REPLACE FUNCTION core.is_admin_area_id_valid_for_line(
    p_admin_area_id bigint,
    p_line_geom geometry
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_admin_area_id IS NULL THEN false
        WHEN p_line_geom IS NULL OR st_isempty(p_line_geom) OR NOT st_isvalid(p_line_geom) THEN false
        ELSE EXISTS (
            SELECT 1
            FROM core.core_admin_areas AS aa
            WHERE aa.id = p_admin_area_id
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND aa.geom IS NOT NULL
              AND NOT st_isempty(aa.geom)
              AND st_isvalid(aa.geom)
              AND st_intersects(aa.geom, p_line_geom)
        )
    END;
$$;

COMMENT ON FUNCTION core.is_admin_area_id_valid_for_line(bigint, geometry) IS
    'True when admin_area_id is active and its geom intersects the line.';

-- ---------------------------------------------------------------------------
-- Hierarchy repair (01 parity)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.inferred_parent_admin_area_id(p_child_admin_area_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    WITH child AS (
        SELECT
            a.id,
            core.admin_area_rep_point(a.geom, a.centroid) AS child_centroid,
            coalesce(
                al.rank::integer,
                CASE lower(trim(coalesce(al.code, '')))
                    WHEN 'country' THEN 2
                    WHEN 'state_region' THEN 4
                    WHEN 'state' THEN 4
                    WHEN 'division' THEN 4
                    WHEN 'region' THEN 4
                    WHEN 'district' THEN 5
                    WHEN 'township' THEN 6
                    WHEN 'town' THEN 6
                    WHEN 'city' THEN 6
                    WHEN 'suburb' THEN 7
                    WHEN 'ward' THEN 7
                    WHEN 'quarter' THEN 7
                    WHEN 'village_tract' THEN 7
                    WHEN 'village' THEN 8
                    WHEN 'hamlet' THEN 8
                    WHEN 'neighbourhood' THEN 9
                    ELSE NULL
                END,
                99
            ) AS hierarchy_order,
            (
                lower(trim(coalesce(al.code, ''))) = 'country'
                OR coalesce(al.rank::integer, 99) <= 2
            ) AS is_country_level
        FROM core.core_admin_areas AS a
        LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
        WHERE a.id = p_child_admin_area_id
          AND coalesce(a.is_active, true) IS TRUE
          AND a.deleted_at IS NULL
    )
    SELECT CASE
        WHEN c.is_country_level THEN NULL::bigint
        ELSE pick.parent_id
    END
    FROM child AS c
    LEFT JOIN LATERAL (
        SELECT parent.id AS parent_id
        FROM core.core_admin_areas AS parent
        LEFT JOIN ref.ref_admin_levels AS pal ON pal.id = parent.admin_level_id
        WHERE parent.is_active IS TRUE
          AND parent.deleted_at IS NULL
          AND parent.id <> c.id
          AND parent.geom IS NOT NULL
          AND NOT st_isempty(parent.geom)
          AND st_isvalid(parent.geom)
          AND coalesce(
              pal.rank::integer,
              CASE lower(trim(coalesce(pal.code, '')))
                  WHEN 'country' THEN 2
                  WHEN 'state_region' THEN 4
                  WHEN 'state' THEN 4
                  WHEN 'division' THEN 4
                  WHEN 'region' THEN 4
                  WHEN 'district' THEN 5
                  WHEN 'township' THEN 6
                  WHEN 'town' THEN 6
                  WHEN 'city' THEN 6
                  WHEN 'suburb' THEN 7
                  WHEN 'ward' THEN 7
                  WHEN 'quarter' THEN 7
                  WHEN 'village_tract' THEN 7
                  WHEN 'village' THEN 8
                  WHEN 'hamlet' THEN 8
                  WHEN 'neighbourhood' THEN 9
                  ELSE NULL
              END,
              99
          ) < c.hierarchy_order
          AND c.child_centroid IS NOT NULL
          AND NOT st_isempty(c.child_centroid)
          AND st_isvalid(c.child_centroid)
          AND st_contains(parent.geom, c.child_centroid)
        ORDER BY coalesce(
            pal.rank::integer,
            CASE lower(trim(coalesce(pal.code, '')))
                WHEN 'country' THEN 2
                WHEN 'state_region' THEN 4
                WHEN 'state' THEN 4
                WHEN 'division' THEN 4
                WHEN 'region' THEN 4
                WHEN 'district' THEN 5
                WHEN 'township' THEN 6
                WHEN 'town' THEN 6
                WHEN 'city' THEN 6
                WHEN 'suburb' THEN 7
                WHEN 'ward' THEN 7
                WHEN 'quarter' THEN 7
                WHEN 'village_tract' THEN 7
                WHEN 'village' THEN 8
                WHEN 'hamlet' THEN 8
                WHEN 'neighbourhood' THEN 9
                ELSE NULL
            END,
            99
        ) DESC,
        st_area(parent.geom::geography) ASC NULLS LAST,
        parent.id ASC
        LIMIT 1
    ) AS pick ON true;
$$;

\echo '=== Ensure core.core_admin_areas indexes (idempotent) ==='

CREATE INDEX IF NOT EXISTS core_admin_areas_geom_gix
    ON core.core_admin_areas USING gist (geom);

CREATE INDEX IF NOT EXISTS core_admin_areas_parent_idx
    ON core.core_admin_areas (parent_id);

CREATE INDEX IF NOT EXISTS core_admin_areas_level_idx
    ON core.core_admin_areas (admin_level_id);

\echo 'Installed/updated core admin assignment functions:'
\echo '  - core.find_admin_area_for_point(geometry, text default null)'
\echo '  - core.find_admin_area_for_line(geometry, text default null)'
\echo '  - core.find_admin_area_for_polygon(geometry, text default null)'
\echo '  - core.pick_admin_area_for_line_overlap / ward instability fallback'
\echo '  - core.admin_area_matches_assignment_target (NULL target = any level)'
\echo '  - core.is_admin_area_id_valid_for_point / _for_line'
\echo '  - core.lookup_admin_area_id_for_point (wrapper)'
\echo '  - core.entity_admin_assignment_is_protected / repair metadata helpers'
\echo '  - pipeline / hierarchy helpers'
\echo 'Indexes: core_admin_areas_geom_gix, core_admin_areas_parent_idx, core_admin_areas_level_idx'
