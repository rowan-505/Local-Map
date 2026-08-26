-- =============================================================================
-- Supabase migration 198: normalize canonical YBS variant direction labels
-- =============================================================================
--
-- Scope is deliberately narrow:
--   transport.routes.mode = 'bus'
--   transport.routes.route_code LIKE 'YBS-%'
--   both route and variant are not soft-deleted
--
-- Canonical contract:
--   direction_id = 0 -> direction_name D0, variant_code <route_code>-D0
--   direction_id = 1 -> direction_name D1, variant_code <route_code>-D1
--
-- Only route_variants.variant_code and route_variants.direction_name are set by
-- this migration. The existing updated_at trigger will stamp touched rows.
-- No variants are recreated and no related transport rows are changed.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Lock the intended route/variant rows so the checks and update see one stable
-- target set. Locking the parent routes also prevents concurrent variant inserts
-- for those routes through their foreign key while this short migration runs.
DO $block$
DECLARE
    target_count bigint;
    abnormal_direction_count bigint;
    abnormal_pair_count bigint;
    duplicate_proposal_count bigint;
    collision_count bigint;
BEGIN
    PERFORM 1
    FROM transport.routes AS r
    JOIN transport.route_variants AS v ON v.route_id = r.id
    WHERE r.deleted_at IS NULL
      AND v.deleted_at IS NULL
      AND r.mode = 'bus'
      AND r.route_code LIKE 'YBS-%'
    FOR UPDATE OF r, v;

    SELECT count(*)
    INTO target_count
    FROM transport.routes AS r
    JOIN transport.route_variants AS v ON v.route_id = r.id
    WHERE r.deleted_at IS NULL
      AND v.deleted_at IS NULL
      AND r.mode = 'bus'
      AND r.route_code LIKE 'YBS-%';

    IF target_count = 0 THEN
        RAISE EXCEPTION '198 refused: no non-deleted YBS- bus route variants found';
    END IF;

    SELECT count(*)
    INTO abnormal_direction_count
    FROM transport.routes AS r
    JOIN transport.route_variants AS v ON v.route_id = r.id
    WHERE r.deleted_at IS NULL
      AND v.deleted_at IS NULL
      AND r.mode = 'bus'
      AND r.route_code LIKE 'YBS-%'
      AND v.direction_id IS DISTINCT FROM 0
      AND v.direction_id IS DISTINCT FROM 1;

    IF abnormal_direction_count > 0 THEN
        RAISE EXCEPTION
            '198 refused: % target YBS variant(s) have direction_id outside 0/1',
            abnormal_direction_count;
    END IF;

    SELECT count(*)
    INTO abnormal_pair_count
    FROM (
        SELECT r.id
        FROM transport.routes AS r
        JOIN transport.route_variants AS v
          ON v.route_id = r.id
         AND v.deleted_at IS NULL
        WHERE r.deleted_at IS NULL
          AND r.mode = 'bus'
          AND r.route_code LIKE 'YBS-%'
        GROUP BY r.id
        HAVING count(*) <> 2
            OR count(*) FILTER (WHERE v.direction_id = 0) <> 1
            OR count(*) FILTER (WHERE v.direction_id = 1) <> 1
    ) AS abnormal_pairs;

    IF abnormal_pair_count > 0 THEN
        RAISE EXCEPTION
            '198 refused: % target YBS route(s) do not have exactly one D0 and one D1 variant',
            abnormal_pair_count;
    END IF;

    WITH proposed AS (
        SELECT
            v.id,
            v.route_id,
            r.route_code || '-D' || v.direction_id::text AS proposed_variant_code
        FROM transport.routes AS r
        JOIN transport.route_variants AS v ON v.route_id = r.id
        WHERE r.deleted_at IS NULL
          AND v.deleted_at IS NULL
          AND r.mode = 'bus'
          AND r.route_code LIKE 'YBS-%'
    )
    SELECT count(*)
    INTO duplicate_proposal_count
    FROM (
        SELECT route_id, proposed_variant_code
        FROM proposed
        GROUP BY route_id, proposed_variant_code
        HAVING count(*) > 1
    ) AS duplicate_proposals;

    IF duplicate_proposal_count > 0 THEN
        RAISE EXCEPTION
            '198 refused: % duplicate (route_id, proposed_variant_code) key(s) would be produced',
            duplicate_proposal_count;
    END IF;

    WITH proposed AS (
        SELECT
            v.id,
            v.route_id,
            r.route_code || '-D' || v.direction_id::text AS proposed_variant_code
        FROM transport.routes AS r
        JOIN transport.route_variants AS v ON v.route_id = r.id
        WHERE r.deleted_at IS NULL
          AND v.deleted_at IS NULL
          AND r.mode = 'bus'
          AND r.route_code LIKE 'YBS-%'
    )
    SELECT count(*)
    INTO collision_count
    FROM proposed AS p
    JOIN transport.route_variants AS existing
      ON existing.route_id = p.route_id
     AND existing.variant_code = p.proposed_variant_code
     AND existing.id <> p.id;

    IF collision_count > 0 THEN
        RAISE EXCEPTION
            '198 refused: % proposed YBS variant code(s) collide with existing route variants',
            collision_count;
    END IF;
END
$block$;

UPDATE transport.route_variants AS v
SET
    variant_code = r.route_code || '-D' || v.direction_id::text,
    direction_name = 'D' || v.direction_id::text
FROM transport.routes AS r
WHERE r.id = v.route_id
  AND r.deleted_at IS NULL
  AND v.deleted_at IS NULL
  AND r.mode = 'bus'
  AND r.route_code LIKE 'YBS-%'
  AND (
      v.variant_code IS DISTINCT FROM r.route_code || '-D' || v.direction_id::text
      OR v.direction_name IS DISTINCT FROM 'D' || v.direction_id::text
  );

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM transport.routes AS r
        JOIN transport.route_variants AS v ON v.route_id = r.id
        WHERE r.deleted_at IS NULL
          AND v.deleted_at IS NULL
          AND r.mode = 'bus'
          AND r.route_code LIKE 'YBS-%'
          AND (
              v.variant_code IS DISTINCT FROM r.route_code || '-D' || v.direction_id::text
              OR v.direction_name IS DISTINCT FROM 'D' || v.direction_id::text
          )
    ) THEN
        RAISE EXCEPTION '198 failed: target YBS variants are not fully normalized';
    END IF;
END
$block$;

COMMIT;
