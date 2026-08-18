-- =============================================================================
-- Local-only: prod_mirror table for routing.routing_barriers dry-run compare
-- =============================================================================
-- Does not touch Supabase. Used by national routing-barrier dry-run only.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS prod_mirror;

CREATE TABLE IF NOT EXISTS prod_mirror.core_routing_barriers (
  id bigint PRIMARY KEY,
  public_id uuid,
  barrier_type text,
  core_street_id bigint,
  geom geometry(Point, 4326),
  is_active boolean,
  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_verified boolean,
  verification_status text,
  verified_at timestamptz,
  verified_by bigint,
  verification_note text,
  created_at timestamptz,
  updated_at timestamptz,
  mirrored_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prod_mirror_core_routing_barriers_geom_gix
  ON prod_mirror.core_routing_barriers USING GIST (geom);

CREATE INDEX IF NOT EXISTS prod_mirror_core_routing_barriers_core_street_id_idx
  ON prod_mirror.core_routing_barriers (core_street_id);

CREATE INDEX IF NOT EXISTS prod_mirror_core_routing_barriers_barrier_type_idx
  ON prod_mirror.core_routing_barriers (barrier_type);

COMMENT ON TABLE prod_mirror.core_routing_barriers IS
  'Local mirror of routing.routing_barriers for barrier dry-run F2 compare. Not production.';

COMMIT;
