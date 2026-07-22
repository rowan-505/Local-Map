-- =============================================================================
-- Validate import_work.place_rows counts for one batch (no core writes).
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?batch_code}
\else
\set batch_code ''
\endif

CREATE TEMP TABLE import_work_validate_params (
    batch_code text
) ON COMMIT DROP;

INSERT INTO import_work_validate_params VALUES (NULLIF(btrim(:'batch_code'), ''));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM import_work_validate_params WHERE batch_code IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'batch_code is required (-v batch_code=...)';
    END IF;
END $$;

SELECT
    b.id AS import_batch_id,
    b.batch_code,
    b.entity_family,
    b.status,
    b.expected_row_count,
    b.loaded_row_count,
    count(r.*) AS actual_rows,
    count(*) FILTER (WHERE r.classification = 'safe_new') AS safe_new,
    count(*) FILTER (WHERE r.classification = 'safe_update') AS safe_update,
    count(*) FILTER (WHERE r.validation_status = 'failed') AS validation_failed,
    CASE
        WHEN b.expected_row_count IS NOT NULL
             AND b.expected_row_count <> count(r.*) THEN 'FAIL: expected_row_count mismatch'
        WHEN b.loaded_row_count IS NOT NULL
             AND b.loaded_row_count <> count(r.*) THEN 'FAIL: loaded_row_count mismatch'
        ELSE 'PASS'
    END AS status
FROM import_work.import_batches AS b
CROSS JOIN import_work_validate_params AS p
LEFT JOIN import_work.place_rows AS r ON r.import_batch_id = b.id
WHERE b.batch_code = p.batch_code
GROUP BY b.id;

DO $$
DECLARE
    v_code text;
    v_expected bigint;
    v_loaded bigint;
    v_actual bigint;
BEGIN
    SELECT p.batch_code INTO v_code FROM import_work_validate_params AS p;

    SELECT b.expected_row_count, b.loaded_row_count, c.n
    INTO v_expected, v_loaded, v_actual
    FROM import_work.import_batches AS b
    CROSS JOIN LATERAL (
        SELECT count(*)::bigint AS n
        FROM import_work.place_rows AS r
        WHERE r.import_batch_id = b.id
    ) AS c
    WHERE b.batch_code = v_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'import_work batch not found: %', v_code;
    END IF;

    IF v_expected IS NOT NULL AND v_expected <> v_actual THEN
        RAISE EXCEPTION 'expected_row_count (%) <> actual (%) for %', v_expected, v_actual, v_code;
    END IF;

    IF v_loaded IS NOT NULL AND v_loaded <> v_actual THEN
        RAISE EXCEPTION 'loaded_row_count (%) <> actual (%) for %', v_loaded, v_actual, v_code;
    END IF;
END $$;
