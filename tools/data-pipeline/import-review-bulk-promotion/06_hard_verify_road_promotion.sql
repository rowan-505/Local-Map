-- =============================================================================
-- Hard verify import-review road bulk promotion (read-only, Supabase)
--
-- Fast batch verify: lightweight scope (no per-row admin geom in CTAS).
-- admin_area_id NULL is allowed (warning only). Expensive geom checks off by default.
--
-- psql variables:
--   -v review_batch_id=<bigint>         required
--   -v fail_on_warning=false            (true = treat warnings as hard fail)
--   -v enable_expensive_verify=false    (true = admin geom intersect + multi-admin warnings)
--
-- Usage:
--   psql "$SUPABASE_DATABASE_URL" -v review_batch_id=4 \
--     -f tools/data-pipeline/import-review-bulk-promotion/06_hard_verify_road_promotion.sql
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\ir _psql_default_vars.sql

BEGIN;

SELECT set_config('statement_timeout', '0', true);

\ir _psql_verify_session_reset.sql
\ir _psql_road_verify_progress.sql

SELECT pg_temp.bulk_road_verify_phase('start');

CREATE TEMP TABLE bulk_road_verify_params (
    review_batch_id bigint NOT NULL,
    fail_on_warning boolean NOT NULL DEFAULT false
);

INSERT INTO bulk_road_verify_params (review_batch_id, fail_on_warning)
VALUES (
    NULLIF(btrim(:'review_batch_id'), '')::bigint,
    CASE lower(coalesce(NULLIF(btrim(:'fail_on_warning'), ''), 'false'))
        WHEN 'true' THEN true
        WHEN '1' THEN true
        WHEN 'yes' THEN true
        ELSE false
    END
);

\echo '=== Ensure verify indexes (idempotent) ==='

CREATE INDEX IF NOT EXISTS irr_road_rbid_pstat_id_idx
    ON import_review.road_candidates (review_batch_id, promotion_status, id);

CREATE INDEX IF NOT EXISTS irr_road_rbid_promoted_core_id_idx
    ON import_review.road_candidates (review_batch_id, promoted_core_id, id)
    WHERE promoted_core_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS core_streets_external_id_promote_idx
    ON core.core_streets (external_id)
    WHERE external_id IS NOT NULL AND btrim(external_id) <> '';

SELECT pg_temp.bulk_road_verify_phase('indexes ensured');

CREATE TEMP TABLE bulk_road_verify_summary (
    review_batch_id bigint,
    total_batch_count bigint NOT NULL DEFAULT 0,
    promoted_candidate_count bigint NOT NULL DEFAULT 0,
    skipped_candidate_count bigint NOT NULL DEFAULT 0,
    matched_core_count bigint NOT NULL DEFAULT 0,
    distinct_promoted_core_id_count bigint NOT NULL DEFAULT 0,
    hard_fail_count bigint NOT NULL DEFAULT 0,
    warning_count bigint NOT NULL DEFAULT 0,
    fail_on_warning boolean NOT NULL DEFAULT false
);

INSERT INTO bulk_road_verify_summary (
    review_batch_id,
    total_batch_count,
    promoted_candidate_count,
    skipped_candidate_count,
    matched_core_count,
    distinct_promoted_core_id_count,
    fail_on_warning
)
SELECT
    p.review_batch_id,
    count(*)::bigint,
    count(*) FILTER (
        WHERE coalesce(rc.promotion_status, '') = 'promoted'
    )::bigint,
    count(*) FILTER (
        WHERE coalesce(rc.promotion_status, '') = 'skipped'
    )::bigint,
    count(*) FILTER (
        WHERE coalesce(rc.promotion_status, '') = 'promoted'
          AND rc.promoted_core_id IS NOT NULL
          AND c.id IS NOT NULL
          AND coalesce(c.is_active, true)
          AND c.deleted_at IS NULL
    )::bigint,
    count(DISTINCT rc.promoted_core_id) FILTER (
        WHERE coalesce(rc.promotion_status, '') = 'promoted'
          AND rc.promoted_core_id IS NOT NULL
    )::bigint,
    p.fail_on_warning
FROM bulk_road_verify_params AS p
INNER JOIN import_review.road_candidates AS rc
    ON rc.review_batch_id = p.review_batch_id
LEFT JOIN core.core_streets AS c
    ON c.id = rc.promoted_core_id
GROUP BY p.review_batch_id, p.fail_on_warning;

SELECT pg_temp.bulk_road_verify_phase('batch summary aggregated');

\echo '=== batch summary (pre-scope) ==='

SELECT
    s.review_batch_id,
    s.total_batch_count,
    s.promoted_candidate_count,
    s.skipped_candidate_count,
    s.matched_core_count,
    s.distinct_promoted_core_id_count
FROM bulk_road_verify_summary AS s;

CREATE TEMP TABLE bulk_road_verify_scope AS
SELECT
    p.review_batch_id,
    rc.id AS candidate_id,
    nullif(btrim(rc.external_id), '') AS candidate_external_id,
    nullif(btrim(rc.name_mm), '') AS candidate_name_mm,
    nullif(btrim(rc.name_en), '') AS candidate_name_en,
    rc.promotion_status,
    rc.promoted_core_id,
    c.id AS core_id,
    c.external_id AS core_external_id,
    c.geom AS core_geom,
    c.road_class_id AS core_road_class_id,
    c.admin_area_id AS core_admin_area_id,
    c.canonical_name AS core_canonical_name,
    coalesce(c.routing_status, '') AS core_routing_status,
    coalesce(c.is_verified, false) AS core_is_verified,
    c.deleted_at AS core_deleted_at,
    coalesce(c.is_active, true) AS core_is_active,
    aa.id AS admin_area_id,
    coalesce(aa.is_active, false) AS admin_is_active,
    aa.deleted_at AS admin_deleted_at
FROM bulk_road_verify_params AS p
INNER JOIN import_review.road_candidates AS rc
    ON rc.review_batch_id = p.review_batch_id
LEFT JOIN core.core_streets AS c
    ON c.id = rc.promoted_core_id
LEFT JOIN core.core_admin_areas AS aa
    ON aa.id = c.admin_area_id;

CREATE INDEX bulk_road_verify_scope_status_idx
    ON bulk_road_verify_scope (promotion_status);

CREATE INDEX bulk_road_verify_scope_cand_idx
    ON bulk_road_verify_scope (candidate_id);

CREATE INDEX bulk_road_verify_scope_core_ext_idx
    ON bulk_road_verify_scope (core_external_id)
    WHERE core_external_id IS NOT NULL;

CREATE TEMP TABLE bulk_road_verify_batch_ext_all AS
SELECT DISTINCT s.core_external_id AS external_id
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_external_id IS NOT NULL;

CREATE UNIQUE INDEX bulk_road_verify_batch_ext_all_uidx
    ON bulk_road_verify_batch_ext_all (external_id);

SELECT pg_temp.bulk_road_verify_phase(
    format(
        'scope loaded rows=%s promoted_distinct_external_ids=%s',
        (SELECT count(*)::bigint FROM bulk_road_verify_scope),
        (SELECT count(*)::bigint FROM bulk_road_verify_batch_ext_all)
    )
);

CREATE TEMP TABLE bulk_road_verify_hard_fails (
    ord bigserial PRIMARY KEY,
    check_key text NOT NULL,
    candidate_id bigint,
    core_id bigint,
    detail text
);

CREATE TEMP TABLE bulk_road_verify_warnings (
    ord bigserial PRIMARY KEY,
    check_key text NOT NULL,
    candidate_id bigint,
    core_id bigint,
    detail text
);

SELECT pg_temp.bulk_road_verify_phase('batch-level hard fail checks');

-- Batch-level hard fails
INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'zero_batch_candidates',
    NULL::bigint,
    NULL::bigint,
    format('review_batch_id=%s has no road_candidates', s.review_batch_id)
FROM bulk_road_verify_summary AS s
WHERE s.total_batch_count = 0;

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'promoted_count_mismatch',
    NULL::bigint,
    NULL::bigint,
    format(
        'promoted_candidate_count=%s matched_core_count=%s distinct_promoted_core_id_count=%s',
        s.promoted_candidate_count,
        s.matched_core_count,
        s.distinct_promoted_core_id_count
    )
FROM bulk_road_verify_summary AS s
WHERE s.total_batch_count > 0
  AND s.promoted_candidate_count IS DISTINCT FROM s.matched_core_count;

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'batch_promotion_incomplete',
    NULL::bigint,
    NULL::bigint,
    format(
        'total_batch_count=%s promoted=%s skipped=%s unresolved=%s',
        s.total_batch_count,
        s.promoted_candidate_count,
        s.skipped_candidate_count,
        s.total_batch_count - s.promoted_candidate_count - s.skipped_candidate_count
    )
FROM bulk_road_verify_summary AS s
WHERE s.total_batch_count > 0
  AND (s.promoted_candidate_count + s.skipped_candidate_count) IS DISTINCT FROM s.total_batch_count;

SELECT pg_temp.bulk_road_verify_phase('per-candidate hard fail checks');

-- Per-candidate / per-core hard fails
INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'not_promoted',
    s.candidate_id,
    s.promoted_core_id,
    format('promotion_status=%s', coalesce(s.promotion_status, '<null>'))
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') NOT IN ('promoted', 'skipped');

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'promoted_missing_core_id',
    s.candidate_id,
    NULL::bigint,
    'promotion_status=promoted but promoted_core_id IS NULL'
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.promoted_core_id IS NULL;

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'promoted_core_row_missing',
    s.candidate_id,
    s.promoted_core_id,
    'promoted_core_id does not reference an active core.core_streets row'
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.promoted_core_id IS NOT NULL
  AND (
      s.core_id IS NULL
      OR NOT s.core_is_active
      OR s.core_deleted_at IS NOT NULL
  );

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'candidate_external_id_null',
    s.candidate_id,
    s.core_id,
    'candidate.external_id IS NULL or blank'
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.candidate_external_id IS NULL;

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_external_id_mismatch',
    s.candidate_id,
    s.core_id,
    format(
        'candidate.external_id=%s core.external_id=%s',
        coalesce(s.candidate_external_id, '<null>'),
        coalesce(s.core_external_id, '<null>')
    )
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.candidate_external_id IS DISTINCT FROM nullif(btrim(s.core_external_id), '');

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_geom_null',
    s.candidate_id,
    s.core_id,
    'core.geom IS NULL'
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_geom IS NULL;

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_geom_invalid',
    s.candidate_id,
    s.core_id,
    format('ST_IsValid=%s geometry_type=%s', ST_IsValid(s.core_geom), ST_GeometryType(s.core_geom))
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_geom IS NOT NULL
  AND NOT ST_IsValid(s.core_geom);

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_road_class_id_null',
    s.candidate_id,
    s.core_id,
    'core.road_class_id IS NULL'
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_road_class_id IS NULL;

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_admin_area_inactive_or_missing',
    s.candidate_id,
    s.core_id,
    format(
        'admin_area_id=%s active=%s deleted_at=%s',
        coalesce(s.core_admin_area_id::text, '<null>'),
        coalesce(s.admin_is_active::text, '<null>'),
        coalesce(s.admin_deleted_at::text, 'null')
    )
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_admin_area_id IS NOT NULL
  AND (
      s.admin_area_id IS NULL
      OR NOT s.admin_is_active
      OR s.admin_deleted_at IS NOT NULL
  );

SELECT pg_temp.bulk_road_verify_phase('duplicate external_id checks (batch-scoped)');

CREATE TEMP TABLE bulk_road_verify_dup_batch_ext AS
SELECT
    s.core_external_id AS external_id,
    count(*)::bigint AS promoted_in_batch
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_external_id IS NOT NULL
GROUP BY s.core_external_id
HAVING count(*) > 1;

CREATE UNIQUE INDEX bulk_road_verify_dup_batch_ext_uidx
    ON bulk_road_verify_dup_batch_ext (external_id);

-- Duplicate core.external_id among promoted cores in this batch
INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'duplicate_core_external_id',
    s.candidate_id,
    s.core_id,
    format('external_id=%s appears %s times in promoted batch rows', d.external_id, d.promoted_in_batch)
FROM bulk_road_verify_scope AS s
INNER JOIN bulk_road_verify_dup_batch_ext AS d
    ON d.external_id = s.core_external_id
WHERE coalesce(s.promotion_status, '') = 'promoted';

CREATE TEMP TABLE bulk_road_verify_dup_global_ext AS
SELECT
    batch_ext.external_id,
    count(c.id)::bigint AS active_core_rows
FROM bulk_road_verify_batch_ext_all AS batch_ext
INNER JOIN core.core_streets AS c
    ON c.external_id = batch_ext.external_id
   AND coalesce(c.is_active, true)
   AND c.deleted_at IS NULL
GROUP BY batch_ext.external_id
HAVING count(c.id) > 1;

CREATE UNIQUE INDEX bulk_road_verify_dup_global_ext_uidx
    ON bulk_road_verify_dup_global_ext (external_id);

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'duplicate_core_external_id_global',
    s.candidate_id,
    s.core_id,
    format('external_id=%s has %s active core.core_streets rows', d.external_id, d.active_core_rows)
FROM bulk_road_verify_scope AS s
INNER JOIN bulk_road_verify_dup_global_ext AS d
    ON d.external_id = s.core_external_id
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL;

SELECT pg_temp.bulk_road_verify_phase('warning checks (fast)');

-- Warnings
INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'core_admin_area_id_null',
    s.candidate_id,
    s.core_id,
    'core.admin_area_id IS NULL (allowed for routing foundation)'
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_admin_area_id IS NULL;

INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'canonical_name_unnamed_street',
    s.candidate_id,
    s.core_id,
    format('canonical_name=%s', coalesce(s.core_canonical_name, '<null>'))
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND btrim(coalesce(s.core_canonical_name, '')) = 'Unnamed Street';

\if :enable_expensive_verify
INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'missing_core_street_name_mm',
    s.candidate_id,
    s.core_id,
    format('candidate name_mm=%s but no matching core_street_names row', s.candidate_name_mm)
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.candidate_name_mm IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_street_names AS n
      WHERE n.street_id = s.core_id
        AND lower(btrim(n.name)) = lower(btrim(s.candidate_name_mm))
        AND coalesce(n.language_code, '') IN ('my', '')
  );

INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'missing_core_street_name_en',
    s.candidate_id,
    s.core_id,
    format('candidate name_en=%s but no matching core_street_names row', s.candidate_name_en)
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.candidate_name_en IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_street_names AS n
      WHERE n.street_id = s.core_id
        AND lower(btrim(n.name)) = lower(btrim(s.candidate_name_en))
        AND coalesce(n.language_code, '') IN ('en', '')
  );

SELECT pg_temp.bulk_road_verify_phase('expensive admin geom intersect checks');

INSERT INTO bulk_road_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_geom_not_intersect_admin',
    s.candidate_id,
    s.core_id,
    format('street geom does not intersect admin_area_id=%s', s.core_admin_area_id)
FROM bulk_road_verify_scope AS s
INNER JOIN core.core_admin_areas AS aa
    ON aa.id = s.core_admin_area_id
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_geom IS NOT NULL
  AND st_isvalid(s.core_geom)
  AND s.core_admin_area_id IS NOT NULL
  AND aa.is_active IS TRUE
  AND aa.deleted_at IS NULL
  AND aa.geom IS NOT NULL
  AND NOT (
      CASE
          WHEN to_regprocedure('core.is_admin_area_id_valid_for_line(bigint,geometry)') IS NOT NULL
              THEN core.is_admin_area_id_valid_for_line(s.core_admin_area_id, s.core_geom)
          ELSE st_intersects(aa.geom, s.core_geom)
      END
  );

INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'road_crosses_multiple_small_admin_areas',
    s.candidate_id,
    s.core_id,
    format('%s intersecting small admin polygons (area < 2500 km², non-country)', x.small_count)
FROM bulk_road_verify_scope AS s
INNER JOIN LATERAL (
    SELECT count(*)::bigint AS small_count
    FROM core.core_admin_areas AS aa
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE s.core_geom IS NOT NULL
      AND st_isvalid(s.core_geom)
      AND aa.geom IS NOT NULL
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND st_intersects(aa.geom, s.core_geom)
      AND lower(trim(coalesce(al.code, ''))) IS DISTINCT FROM 'country'
      AND st_area(aa.geom::geography) < 2500000000
) AS x ON true
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND x.small_count > 1;

\else
SELECT pg_temp.bulk_road_verify_phase('expensive admin geom checks skipped (enable_expensive_verify=false)');
\endif

INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'routing_status_not_needs_rebuild',
    s.candidate_id,
    s.core_id,
    format('routing_status=%s', nullif(s.core_routing_status, ''))
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_routing_status IS DISTINCT FROM 'needs_rebuild';

INSERT INTO bulk_road_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'core_is_verified_unexpected',
    s.candidate_id,
    s.core_id,
    format('is_verified=%s (expected false for bulk OSM promotion)', s.core_is_verified)
FROM bulk_road_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_is_verified IS TRUE;

UPDATE bulk_road_verify_summary AS s
SET
    hard_fail_count = (SELECT count(*)::bigint FROM bulk_road_verify_hard_fails),
    warning_count = (SELECT count(*)::bigint FROM bulk_road_verify_warnings);

SELECT pg_temp.bulk_road_verify_phase(
    format(
        'checks complete hard_fail_count=%s warning_count=%s',
        (SELECT hard_fail_count FROM bulk_road_verify_summary),
        (SELECT warning_count FROM bulk_road_verify_summary)
    )
);

\echo ''
\echo '=== road promotion hard verify — batch summary ==='

SELECT
    s.review_batch_id,
    s.total_batch_count,
    s.promoted_candidate_count,
    s.skipped_candidate_count,
    s.matched_core_count,
    s.distinct_promoted_core_id_count,
    s.hard_fail_count,
    s.warning_count,
    s.fail_on_warning
FROM bulk_road_verify_summary AS s;

\echo ''
\echo '=== hard fail checks (counts by check_key) ==='

SELECT
    f.check_key,
    count(*)::bigint AS row_count
FROM bulk_road_verify_hard_fails AS f
GROUP BY f.check_key
ORDER BY f.check_key;

\echo ''
\echo '=== warning checks (counts by check_key) ==='

SELECT
    w.check_key,
    count(*)::bigint AS row_count
FROM bulk_road_verify_warnings AS w
GROUP BY w.check_key
ORDER BY w.check_key;

\echo ''
\echo '=== sample hard fail rows (up to 15) ==='

SELECT
    f.check_key,
    f.candidate_id,
    f.core_id,
    f.detail
FROM bulk_road_verify_hard_fails AS f
ORDER BY f.ord
LIMIT 15;

\echo ''
\echo '=== sample warning rows (up to 15) ==='

SELECT
    w.check_key,
    w.candidate_id,
    w.core_id,
    w.detail
FROM bulk_road_verify_warnings AS w
ORDER BY w.ord
LIMIT 15;

DO $finalize$
DECLARE
    s bulk_road_verify_summary%ROWTYPE;
    v_status text;
BEGIN
    SELECT * INTO s FROM bulk_road_verify_summary LIMIT 1;

    IF s.review_batch_id IS NULL THEN
        RAISE EXCEPTION 'review_batch_id is required (psql -v review_batch_id=...)';
    END IF;

    IF s.hard_fail_count > 0 THEN
        RAISE EXCEPTION
            'road promotion hard verify FAILED: review_batch_id=% hard_fail_count=%',
            s.review_batch_id,
            s.hard_fail_count;
    END IF;

    IF s.fail_on_warning AND s.warning_count > 0 THEN
        RAISE EXCEPTION
            'road promotion hard verify FAILED (fail_on_warning=true): review_batch_id=% warning_count=%',
            s.review_batch_id,
            s.warning_count;
    END IF;

    v_status := 'HARD_VERIFY_PASSED';
    RAISE NOTICE '% review_batch_id=% promoted=% matched_core=% warnings=% (fail_on_warning=%)',
        v_status,
        s.review_batch_id,
        s.promoted_candidate_count,
        s.matched_core_count,
        s.warning_count,
        s.fail_on_warning;

END;
$finalize$;

SELECT 'HARD_VERIFY_PASSED'::text AS verify_status,
       s.review_batch_id,
       s.promoted_candidate_count,
       s.matched_core_count,
       s.warning_count
FROM bulk_road_verify_summary AS s;

\timing off

SELECT pg_temp.bulk_road_verify_phase('done — committing read-only verify');

COMMIT;
