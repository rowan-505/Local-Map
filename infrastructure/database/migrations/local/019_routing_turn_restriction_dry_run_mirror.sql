-- =============================================================================
-- Local-only: turn-restriction dry-run mirror + staging columns
-- =============================================================================
-- Does not touch Supabase. Used by national turn-restriction dry-run only.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS prod_mirror;
CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE IF NOT EXISTS prod_mirror.core_routing_turn_restrictions (
  id bigint PRIMARY KEY,
  public_id uuid,
  restriction_type text,
  from_street_id bigint,
  to_street_id bigint,
  via_node_external_id text,
  via_street_id bigint,
  via_geom geometry(Point, 4326),
  except_modes text[],
  condition text,
  external_id text,
  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean,
  is_verified boolean,
  verification_status text,
  verified_at timestamptz,
  verified_by bigint,
  verification_note text,
  created_at timestamptz,
  updated_at timestamptz,
  mirrored_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prod_mirror_core_routing_turn_restrictions_via_geom_gix
  ON prod_mirror.core_routing_turn_restrictions USING GIST (via_geom);

CREATE INDEX IF NOT EXISTS prod_mirror_core_routing_turn_restrictions_external_id_idx
  ON prod_mirror.core_routing_turn_restrictions (external_id);

CREATE INDEX IF NOT EXISTS prod_mirror_core_routing_turn_restrictions_from_to_idx
  ON prod_mirror.core_routing_turn_restrictions (from_street_id, to_street_id);

COMMENT ON TABLE prod_mirror.core_routing_turn_restrictions IS
  'Local mirror of routing.routing_turn_restrictions for dry-run F2 compare. Not production.';

ALTER TABLE staging.staging_routing_turn_restriction_candidates
  ADD COLUMN IF NOT EXISTS import_class text NULL;

ALTER TABLE staging.staging_routing_turn_restriction_candidates
  ADD COLUMN IF NOT EXISTS import_class_reason jsonb NULL;

ALTER TABLE staging.staging_routing_turn_restriction_candidates
  ADD COLUMN IF NOT EXISTS via_geom geometry(Point, 4326) NULL;

CREATE INDEX IF NOT EXISTS staging_routing_turn_restriction_candidates_import_class_idx
  ON staging.staging_routing_turn_restriction_candidates (source_snapshot_id, import_class);

CREATE INDEX IF NOT EXISTS staging_routing_turn_restriction_candidates_via_geom_gix
  ON staging.staging_routing_turn_restriction_candidates USING GIST (via_geom);

COMMIT;
