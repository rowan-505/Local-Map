-- Emit a single-line phase progress NOTICE (call from SQL or psql includes).

CREATE OR REPLACE FUNCTION pg_temp.bulk_road_emit_phase(p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE NOTICE '[05 roads] %', p_message;
END;
$$;
