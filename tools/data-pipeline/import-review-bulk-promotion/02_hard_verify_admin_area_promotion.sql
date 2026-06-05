-- =============================================================================
-- Hard verify import-review admin area bulk promotion (read-only, Supabase)
--
-- Confirms a review batch is fully promoted and core rows are consistent.
--
-- psql variables:
--   -v review_batch_id=<bigint>       required
--   -v fail_on_warning=false           (true = treat warnings as hard fail)
--
-- Usage:
--   psql "$DATABASE_URL" -v review_batch_id=2 \
--     -f tools/data-pipeline/import-review-bulk-promotion/02_hard_verify_admin_area_promotion.sql
-- =============================================================================

\set ON_ERROR_STOP on

\ir _psql_default_vars.sql

BEGIN;

\ir _psql_verify_session_reset.sql

CREATE TEMP TABLE bulk_admin_verify_params (
    review_batch_id bigint NOT NULL,
    fail_on_warning boolean NOT NULL DEFAULT false
);

INSERT INTO bulk_admin_verify_params (review_batch_id, fail_on_warning)
VALUES (
    NULLIF(btrim(:'review_batch_id'), '')::bigint,
    CASE lower(coalesce(NULLIF(btrim(:'fail_on_warning'), ''), 'false'))
        WHEN 'true' THEN true
        WHEN '1' THEN true
        WHEN 'yes' THEN true
        ELSE false
    END
);

CREATE TEMP TABLE bulk_admin_verify_scope AS
SELECT
    p.review_batch_id,
    aa.id AS candidate_id,
    aa.external_id AS candidate_external_id,
    aa.promotion_status,
    aa.promoted_core_id,
    c.id AS core_id,
    c.external_id AS core_external_id,
    c.geom AS core_geom,
    c.admin_level_id AS core_admin_level_id,
    c.canonical_name AS core_canonical_name,
    c.slug AS core_slug,
    c.parent_id AS core_parent_id,
    coalesce(c.is_verified, false) AS core_is_verified,
    c.deleted_at AS core_deleted_at,
    coalesce(c.is_active, true) AS core_is_active,
    al.code AS admin_level_code,
    lower(trim(coalesce(al.code, ''))) = 'country' AS is_country_level
FROM bulk_admin_verify_params AS p
INNER JOIN import_review.admin_area_candidates AS aa
    ON aa.review_batch_id = p.review_batch_id
LEFT JOIN core.core_admin_areas AS c
    ON c.id = aa.promoted_core_id
LEFT JOIN ref.ref_admin_levels AS al
    ON al.id = c.admin_level_id;

CREATE TEMP TABLE bulk_admin_verify_summary (
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

INSERT INTO bulk_admin_verify_summary (
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
    (SELECT count(*)::bigint FROM bulk_admin_verify_scope AS s WHERE s.review_batch_id = p.review_batch_id),
    (
        SELECT count(*)::bigint
        FROM bulk_admin_verify_scope AS s
        WHERE s.review_batch_id = p.review_batch_id
          AND coalesce(s.promotion_status, '') = 'promoted'
    ),
    (
        SELECT count(*)::bigint
        FROM bulk_admin_verify_scope AS s
        WHERE s.review_batch_id = p.review_batch_id
          AND coalesce(s.promotion_status, '') = 'skipped'
    ),
    (
        SELECT count(*)::bigint
        FROM bulk_admin_verify_scope AS s
        WHERE s.review_batch_id = p.review_batch_id
          AND coalesce(s.promotion_status, '') = 'promoted'
          AND s.promoted_core_id IS NOT NULL
          AND s.core_id IS NOT NULL
          AND s.core_is_active
          AND s.core_deleted_at IS NULL
    ),
    (
        SELECT count(DISTINCT s.promoted_core_id)::bigint
        FROM bulk_admin_verify_scope AS s
        WHERE s.review_batch_id = p.review_batch_id
          AND coalesce(s.promotion_status, '') = 'promoted'
          AND s.promoted_core_id IS NOT NULL
    ),
    p.fail_on_warning
FROM bulk_admin_verify_params AS p;

CREATE TEMP TABLE bulk_admin_verify_hard_fails (
    ord bigserial PRIMARY KEY,
    check_key text NOT NULL,
    candidate_id bigint,
    core_id bigint,
    detail text
);

CREATE TEMP TABLE bulk_admin_verify_warnings (
    ord bigserial PRIMARY KEY,
    check_key text NOT NULL,
    candidate_id bigint,
    core_id bigint,
    detail text
);

-- Batch-level hard fails
INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'zero_batch_candidates',
    NULL::bigint,
    NULL::bigint,
    format('review_batch_id=%s has no admin_area_candidates', s.review_batch_id)
FROM bulk_admin_verify_summary AS s
WHERE s.total_batch_count = 0;

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
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
FROM bulk_admin_verify_summary AS s
WHERE s.total_batch_count > 0
  AND s.promoted_candidate_count IS DISTINCT FROM s.matched_core_count;

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
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
FROM bulk_admin_verify_summary AS s
WHERE s.total_batch_count > 0
  AND (s.promoted_candidate_count + s.skipped_candidate_count) IS DISTINCT FROM s.total_batch_count;

-- Per-candidate / per-core hard fails
INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'not_promoted',
    s.candidate_id,
    s.promoted_core_id,
    format('promotion_status=%s', coalesce(s.promotion_status, '<null>'))
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') NOT IN ('promoted', 'skipped');

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'promoted_missing_core_id',
    s.candidate_id,
    NULL::bigint,
    'promotion_status=promoted but promoted_core_id IS NULL'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.promoted_core_id IS NULL;

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'promoted_core_row_missing',
    s.candidate_id,
    s.promoted_core_id,
    'promoted_core_id does not reference an active core.core_admin_areas row'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.promoted_core_id IS NOT NULL
  AND (
      s.core_id IS NULL
      OR NOT s.core_is_active
      OR s.core_deleted_at IS NOT NULL
  );

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'candidate_external_id_null',
    s.candidate_id,
    s.core_id,
    'candidate.external_id IS NULL or blank'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND (
      s.candidate_external_id IS NULL
      OR btrim(s.candidate_external_id) = ''
  );

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_external_id_mismatch',
    s.candidate_id,
    s.core_id,
    format(
        'candidate.external_id=%s core.external_id=%s',
        coalesce(s.candidate_external_id, '<null>'),
        coalesce(s.core_external_id, '<null>')
    )
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.candidate_external_id IS DISTINCT FROM s.core_external_id;

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_geom_null',
    s.candidate_id,
    s.core_id,
    'core.geom IS NULL'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_geom IS NULL;

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_geom_invalid',
    s.candidate_id,
    s.core_id,
    format('ST_IsValid=%s geometry_type=%s', ST_IsValid(s.core_geom), ST_GeometryType(s.core_geom))
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_geom IS NOT NULL
  AND NOT ST_IsValid(s.core_geom);

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_admin_level_id_null',
    s.candidate_id,
    s.core_id,
    'core.admin_level_id IS NULL'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND s.core_admin_level_id IS NULL;

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_canonical_name_null',
    s.candidate_id,
    s.core_id,
    'core.canonical_name IS NULL or blank'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND (
      s.core_canonical_name IS NULL
      OR btrim(s.core_canonical_name) = ''
  );

INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'core_slug_null',
    s.candidate_id,
    s.core_id,
    'core.slug IS NULL or blank'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND (
      s.core_slug IS NULL
      OR btrim(s.core_slug) = ''
  );

-- Duplicate core.external_id among promoted cores in this batch
INSERT INTO bulk_admin_verify_hard_fails (check_key, candidate_id, core_id, detail)
SELECT
    'duplicate_core_external_id',
    s.candidate_id,
    s.core_id,
    format('external_id=%s appears %s times in promoted core rows', d.external_id, d.cnt)
FROM bulk_admin_verify_scope AS s
INNER JOIN (
    SELECT
        c.external_id,
        count(*)::bigint AS cnt
    FROM bulk_admin_verify_scope AS x
    INNER JOIN core.core_admin_areas AS c ON c.id = x.promoted_core_id
    WHERE coalesce(x.promotion_status, '') = 'promoted'
      AND x.promoted_core_id IS NOT NULL
      AND c.external_id IS NOT NULL
      AND btrim(c.external_id) <> ''
    GROUP BY c.external_id
    HAVING count(*) > 1
) AS d ON d.external_id = s.core_external_id
WHERE coalesce(s.promotion_status, '') = 'promoted';

-- Warnings
INSERT INTO bulk_admin_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'missing_core_admin_area_names',
    s.candidate_id,
    s.core_id,
    'no rows in core.core_admin_area_names for promoted core admin area'
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_admin_area_names AS n
      WHERE n.admin_area_id = s.core_id
  );

INSERT INTO bulk_admin_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'parent_id_null_non_country',
    s.candidate_id,
    s.core_id,
    format(
        'parent_id IS NULL for admin_level_code=%s (hierarchy not linked yet)',
        coalesce(s.admin_level_code, '<unknown>')
    )
FROM bulk_admin_verify_scope AS s
WHERE coalesce(s.promotion_status, '') = 'promoted'
  AND s.core_id IS NOT NULL
  AND NOT s.is_country_level
  AND s.core_parent_id IS NULL;

INSERT INTO bulk_admin_verify_warnings (check_key, candidate_id, core_id, detail)
SELECT
    'multiple_country_rows',
    NULL::bigint,
    NULL::bigint,
    format(
        'batch has %s country-level promoted core row(s); expected at most 1 before hierarchy repair',
        cc.country_count
    )
FROM (
    SELECT count(*)::bigint AS country_count
    FROM bulk_admin_verify_scope AS x
    WHERE coalesce(x.promotion_status, '') = 'promoted'
      AND x.core_id IS NOT NULL
      AND x.is_country_level
) AS cc
WHERE cc.country_count > 1;

UPDATE bulk_admin_verify_summary AS s
SET
    hard_fail_count = (SELECT count(*)::bigint FROM bulk_admin_verify_hard_fails),
    warning_count = (SELECT count(*)::bigint FROM bulk_admin_verify_warnings);

\echo ''
\echo '=== admin area promotion hard verify — batch summary ==='

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
FROM bulk_admin_verify_summary AS s;

\echo ''
\echo '=== hard fail checks (counts by check_key) ==='

SELECT
    f.check_key,
    count(*)::bigint AS row_count
FROM bulk_admin_verify_hard_fails AS f
GROUP BY f.check_key
ORDER BY f.check_key;

\echo ''
\echo '=== warning checks (counts by check_key) ==='

SELECT
    w.check_key,
    count(*)::bigint AS row_count
FROM bulk_admin_verify_warnings AS w
GROUP BY w.check_key
ORDER BY w.check_key;

\echo ''
\echo '=== sample hard fail rows (up to 15) ==='

SELECT
    f.check_key,
    f.candidate_id,
    f.core_id,
    f.detail
FROM bulk_admin_verify_hard_fails AS f
ORDER BY f.ord
LIMIT 15;

\echo ''
\echo '=== sample warning rows (up to 15) ==='

SELECT
    w.check_key,
    w.candidate_id,
    w.core_id,
    w.detail
FROM bulk_admin_verify_warnings AS w
ORDER BY w.ord
LIMIT 15;

DO $finalize$
DECLARE
    s bulk_admin_verify_summary%ROWTYPE;
    v_status text;
BEGIN
    SELECT * INTO s FROM bulk_admin_verify_summary LIMIT 1;

    IF s.review_batch_id IS NULL THEN
        RAISE EXCEPTION 'review_batch_id is required (psql -v review_batch_id=...)';
    END IF;

    IF s.hard_fail_count > 0 THEN
        RAISE EXCEPTION
            'admin area promotion hard verify FAILED: review_batch_id=% hard_fail_count=%',
            s.review_batch_id,
            s.hard_fail_count;
    END IF;

    IF s.fail_on_warning AND s.warning_count > 0 THEN
        RAISE EXCEPTION
            'admin area promotion hard verify FAILED (fail_on_warning=true): review_batch_id=% warning_count=%',
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
FROM bulk_admin_verify_summary AS s;

COMMIT;
