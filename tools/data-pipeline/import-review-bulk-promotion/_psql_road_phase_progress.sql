-- Session-scoped progress helper for 05_bulk_promote_roads.sql (included once per run).

DROP TABLE IF EXISTS bulk_road_promote_timing;

CREATE TEMP TABLE bulk_road_promote_timing (
    pipeline_started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO bulk_road_promote_timing DEFAULT VALUES;

CREATE OR REPLACE FUNCTION pg_temp.bulk_road_phase_done(
    p_label text,
    p_done bigint DEFAULT NULL,
    p_total bigint DEFAULT NULL,
    p_extra text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_started timestamptz;
    v_elapsed interval;
    v_pct numeric;
BEGIN
    SELECT t.pipeline_started_at
    INTO v_started
    FROM bulk_road_promote_timing AS t
    LIMIT 1;

    v_elapsed := clock_timestamp() - v_started;

    IF p_total IS NOT NULL AND p_total > 0 AND p_done IS NOT NULL THEN
        v_pct := round(100.0 * p_done::numeric / p_total::numeric, 2);
        RAISE NOTICE '%', format(
            '[05 roads] %s — %s/%s (%s%%) | pipeline elapsed %s',
            p_label, p_done, p_total, v_pct::text, v_elapsed
        );
    ELSIF p_done IS NOT NULL THEN
        RAISE NOTICE '[05 roads] % — count=% | pipeline elapsed %',
            p_label, p_done, v_elapsed;
    ELSE
        RAISE NOTICE '[05 roads] % | pipeline elapsed %', p_label, v_elapsed;
    END IF;

    IF p_extra IS NOT NULL AND btrim(p_extra) <> '' THEN
        RAISE NOTICE '[05 roads]   detail: %', p_extra;
    END IF;
END;
$$;
