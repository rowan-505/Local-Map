-- Progress helper for 06_hard_verify_road_promotion.sql

CREATE OR REPLACE FUNCTION pg_temp.bulk_road_verify_phase(p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE NOTICE '[06 roads verify] % | %', p_label, clock_timestamp();
END;
$$;
