-- =============================================================================
-- Supabase migration 162: sparse street routing metadata
-- =============================================================================
--
-- Adds normalized routing/access projections without rewriting existing rows.
-- The one-time data normalization is intentionally separate and keyset-batched.
--
-- Sparse semantics:
--   travel_direction NULL = normal/default bidirectional or no special value
--   access_rules NULL      = no explicit supported source access rule
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE core.core_streets
  ADD COLUMN IF NOT EXISTS travel_direction text,
  ADD COLUMN IF NOT EXISTS access_rules jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'core.core_streets'::regclass
      AND conname = 'core_streets_travel_direction_chk'
  ) THEN
    ALTER TABLE core.core_streets
      ADD CONSTRAINT core_streets_travel_direction_chk
      CHECK (
        travel_direction IS NULL
        OR travel_direction IN (
          'forward',
          'reverse',
          'reversible',
          'alternating',
          'unknown'
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE core.core_streets
  VALIDATE CONSTRAINT core_streets_travel_direction_chk;

COMMENT ON COLUMN core.core_streets.travel_direction IS
  'Sparse source-derived direction: NULL=normal/default bidirectional; forward=follows LineString coordinate order; reverse=opposes it; reversible/alternating preserve source semantics; unknown=explicit direction cannot be safely normalized.';

COMMENT ON COLUMN core.core_streets.access_rules IS
  'Sparse normalized JSONB projection of explicit access, vehicle, motor_vehicle, motorcar, motorcycle, bicycle, foot, bus, and hgv source tags. NULL means no explicit supported source access rule; full source remains in normalized_data.';

COMMIT;
