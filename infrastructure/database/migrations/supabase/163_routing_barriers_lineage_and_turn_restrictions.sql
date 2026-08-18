-- =============================================================================
-- Supabase migration 163: routing barriers lineage + Core turn restrictions
-- =============================================================================
--
-- Purpose (schema prep only — no OSM extract / no production import):
--   1) Add typed source identity + access_rules to routing.routing_barriers.
--   2) Create routing.routing_turn_restrictions as a Core-street source table
--      for reviewed OSM turn-restriction relations.
--
-- Does NOT:
--   - Import OSM barriers or turn restrictions
--   - Modify core.core_streets geometry or attributes
--   - Touch Valhalla, PMTiles, routing_nodes/edges, or graph-build jobs
--   - Create barrier node/edge/relation tables or a restriction-type ref table
--
-- Important import rule for later work:
--   One OSM way may map to multiple core.core_streets segments.
--   Barrier / via resolution MUST pick the Core segment that touches the
--   barrier or via intersection. Never SELECT the first core_streets row by
--   OSM way id alone.
--
-- Coexistence note:
--   Migration 050 defined a graph-scoped routing.routing_turn_restrictions
--   (build_job_id / from_edge_id / to_edge_id). That table is not present in
--   current production (routing_nodes/edges are also absent). If a legacy
--   graph-shaped table is found, it is renamed to
--   routing.routing_graph_turn_restrictions before creating the Core table.
--
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS routing;

-- ---------------------------------------------------------------------------
-- 1) routing.routing_barriers — additive source lineage + access_rules
-- ---------------------------------------------------------------------------
ALTER TABLE routing.routing_barriers
  ADD COLUMN IF NOT EXISTS access_rules jsonb,
  ADD COLUMN IF NOT EXISTS source_registry_id bigint,
  ADD COLUMN IF NOT EXISTS source_snapshot_id bigint,
  ADD COLUMN IF NOT EXISTS source_feature_type text,
  ADD COLUMN IF NOT EXISTS source_feature_id bigint,
  ADD COLUMN IF NOT EXISTS external_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routing_barriers_source_registry_id_fkey'
      AND conrelid = 'routing.routing_barriers'::regclass
  ) THEN
    ALTER TABLE routing.routing_barriers
      ADD CONSTRAINT routing_barriers_source_registry_id_fkey
        FOREIGN KEY (source_registry_id)
        REFERENCES system.system_source_registry (id)
        NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routing_barriers_source_snapshot_id_fkey'
      AND conrelid = 'routing.routing_barriers'::regclass
  ) THEN
    ALTER TABLE routing.routing_barriers
      ADD CONSTRAINT routing_barriers_source_snapshot_id_fkey
        FOREIGN KEY (source_snapshot_id)
        REFERENCES system.system_source_snapshots (id)
        NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routing_barriers_source_feature_type_chk'
      AND conrelid = 'routing.routing_barriers'::regclass
  ) THEN
    ALTER TABLE routing.routing_barriers
      ADD CONSTRAINT routing_barriers_source_feature_type_chk
        CHECK (
          source_feature_type IS NULL
          OR source_feature_type IN ('node', 'way', 'relation')
        )
        NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routing_barriers_external_id_nonempty_chk'
      AND conrelid = 'routing.routing_barriers'::regclass
  ) THEN
    ALTER TABLE routing.routing_barriers
      ADD CONSTRAINT routing_barriers_external_id_nonempty_chk
        CHECK (external_id IS NULL OR btrim(external_id) <> '')
        NOT VALID;
  END IF;
END $$;

ALTER TABLE routing.routing_barriers
  VALIDATE CONSTRAINT routing_barriers_source_registry_id_fkey;
ALTER TABLE routing.routing_barriers
  VALIDATE CONSTRAINT routing_barriers_source_snapshot_id_fkey;
ALTER TABLE routing.routing_barriers
  VALIDATE CONSTRAINT routing_barriers_source_feature_type_chk;
ALTER TABLE routing.routing_barriers
  VALIDATE CONSTRAINT routing_barriers_external_id_nonempty_chk;

COMMENT ON COLUMN routing.routing_barriers.access_rules IS
  'Sparse normalized access projection (access/foot/bicycle/motor_vehicle/…). '
  'NULL means no explicit supported rule; full source remains in normalized_data/source_refs.';

COMMENT ON COLUMN routing.routing_barriers.source_feature_type IS
  'OSM source type when known: node | way | relation.';

COMMENT ON COLUMN routing.routing_barriers.external_id IS
  'Stable OSM identity key when known (e.g. osm:node:123). Prefer typed source_* columns for uniqueness.';

-- Useful indexes only (geom + core_street_id already exist from 052).
CREATE UNIQUE INDEX IF NOT EXISTS routing_barriers_source_identity_uidx
  ON routing.routing_barriers (source_registry_id, source_feature_type, source_feature_id)
  WHERE source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS routing_barriers_external_id_idx
  ON routing.routing_barriers (external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS routing_barriers_source_registry_id_idx
  ON routing.routing_barriers (source_registry_id)
  WHERE source_registry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS routing_barriers_source_snapshot_id_idx
  ON routing.routing_barriers (source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

-- Best-effort lineage backfill for existing Kyauktan pilot rows.
-- Never copy numeric source_snapshot_id from source_refs (local DB ids).
-- Resolve snapshots only by (registry, snapshot_version).
WITH raw_source AS (
  SELECT
    b.id,
    nullif(btrim(b.source_refs ->> 'external_id'), '') AS external_id_text,
    nullif(btrim(b.source_refs ->> 'osm_id'), '') AS osm_id_text,
    lower(nullif(btrim(b.source_refs ->> 'osm_feature_type'), '')) AS osm_feature_type_text,
    nullif(btrim(b.source_refs ->> 'snapshot_version'), '') AS snapshot_version,
    CASE
      WHEN jsonb_typeof(b.source_refs -> 'access_tags') = 'object'
           AND b.source_refs -> 'access_tags' <> '{}'::jsonb
        THEN b.source_refs -> 'access_tags'
      WHEN jsonb_typeof(b.normalized_data -> 'access_tags') = 'object'
           AND b.normalized_data -> 'access_tags' <> '{}'::jsonb
        THEN b.normalized_data -> 'access_tags'
      ELSE NULL
    END AS access_rules
  FROM routing.routing_barriers AS b
),
parsed AS (
  SELECT
    r.id,
    r.external_id_text,
    r.snapshot_version,
    r.access_rules,
    CASE r.osm_feature_type_text
      WHEN 'n' THEN 'node'
      WHEN 'node' THEN 'node'
      WHEN 'w' THEN 'way'
      WHEN 'way' THEN 'way'
      WHEN 'r' THEN 'relation'
      WHEN 'rel' THEN 'relation'
      WHEN 'relation' THEN 'relation'
      ELSE NULL
    END AS source_feature_type,
    CASE
      WHEN r.osm_id_text ~ '^[1-9][0-9]*$'
       AND r.osm_id_text::numeric <= 9223372036854775807::numeric
        THEN r.osm_id_text::bigint
      ELSE NULL
    END AS source_feature_id
  FROM raw_source AS r
)
UPDATE routing.routing_barriers AS b
SET
  access_rules = COALESCE(b.access_rules, p.access_rules),
  source_registry_id = COALESCE(b.source_registry_id, reg.id),
  source_snapshot_id = COALESCE(b.source_snapshot_id, snap.id),
  source_feature_type = COALESCE(b.source_feature_type, p.source_feature_type),
  source_feature_id = COALESCE(b.source_feature_id, p.source_feature_id),
  external_id = COALESCE(b.external_id, p.external_id_text)
FROM parsed AS p
LEFT JOIN system.system_source_registry AS reg
  ON reg.source_code = 'osm_myanmar'
 AND reg.is_active
LEFT JOIN system.system_source_snapshots AS snap
  ON snap.source_registry_id = reg.id
 AND snap.snapshot_version = p.snapshot_version
WHERE b.id = p.id
  AND (
    b.access_rules IS NULL
    OR b.source_registry_id IS NULL
    OR b.source_snapshot_id IS NULL
    OR b.source_feature_type IS NULL
    OR b.source_feature_id IS NULL
    OR b.external_id IS NULL
  );

-- ---------------------------------------------------------------------------
-- 2) routing.routing_turn_restrictions — Core-street source table (V1)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('routing.routing_turn_restrictions') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'routing'
         AND table_name = 'routing_turn_restrictions'
         AND column_name = 'build_job_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'routing'
         AND table_name = 'routing_turn_restrictions'
         AND column_name = 'from_street_id'
     )
  THEN
    ALTER TABLE routing.routing_turn_restrictions
      RENAME TO routing_graph_turn_restrictions;

    COMMENT ON TABLE routing.routing_graph_turn_restrictions IS
      'Legacy validation-graph turn restrictions (build_job scoped). '
      'Renamed by migration 163; Core-street source of truth is routing.routing_turn_restrictions.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS routing.routing_turn_restrictions (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),

  restriction_type text NOT NULL,

  from_street_id bigint NOT NULL,
  to_street_id bigint NOT NULL,
  via_node_external_id text,
  via_street_id bigint,
  via_geom geometry(Point, 4326),

  except_modes text[],
  condition text,

  source_registry_id bigint,
  source_snapshot_id bigint,
  source_feature_type text,
  source_feature_id bigint,
  external_id text,

  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,

  is_active boolean NOT NULL DEFAULT true,

  is_verified boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified',
  verified_at timestamptz,
  verified_by bigint,
  verification_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT routing_turn_restrictions_restriction_type_chk CHECK (
    restriction_type IN (
      'no_left_turn',
      'no_right_turn',
      'no_u_turn',
      'no_straight_on',
      'only_left_turn',
      'only_right_turn',
      'only_u_turn',
      'only_straight_on',
      'no_entry',
      'no_exit'
    )
  ),
  CONSTRAINT routing_turn_restrictions_verification_status_chk CHECK (
    verification_status IN (
      'unverified',
      'verified',
      'needs_fix',
      'questionable',
      'rejected_after_core_review'
    )
  ),
  CONSTRAINT routing_turn_restrictions_source_feature_type_chk CHECK (
    source_feature_type IS NULL
    OR source_feature_type IN ('node', 'way', 'relation')
  ),
  CONSTRAINT routing_turn_restrictions_external_id_nonempty_chk CHECK (
    external_id IS NULL OR btrim(external_id) <> ''
  ),
  CONSTRAINT routing_turn_restrictions_via_node_external_id_nonempty_chk CHECK (
    via_node_external_id IS NULL OR btrim(via_node_external_id) <> ''
  )
);

DO $$
BEGIN
  IF to_regclass('core.core_streets') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'routing_turn_restrictions_from_street_id_fkey'
        AND conrelid = 'routing.routing_turn_restrictions'::regclass
    ) THEN
      ALTER TABLE routing.routing_turn_restrictions
        ADD CONSTRAINT routing_turn_restrictions_from_street_id_fkey
          FOREIGN KEY (from_street_id)
          REFERENCES core.core_streets (id)
          ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'routing_turn_restrictions_to_street_id_fkey'
        AND conrelid = 'routing.routing_turn_restrictions'::regclass
    ) THEN
      ALTER TABLE routing.routing_turn_restrictions
        ADD CONSTRAINT routing_turn_restrictions_to_street_id_fkey
          FOREIGN KEY (to_street_id)
          REFERENCES core.core_streets (id)
          ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'routing_turn_restrictions_via_street_id_fkey'
        AND conrelid = 'routing.routing_turn_restrictions'::regclass
    ) THEN
      ALTER TABLE routing.routing_turn_restrictions
        ADD CONSTRAINT routing_turn_restrictions_via_street_id_fkey
          FOREIGN KEY (via_street_id)
          REFERENCES core.core_streets (id)
          ON DELETE SET NULL;
    END IF;
  END IF;

  IF to_regclass('system.system_source_registry') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'routing_turn_restrictions_source_registry_id_fkey'
         AND conrelid = 'routing.routing_turn_restrictions'::regclass
     )
  THEN
    ALTER TABLE routing.routing_turn_restrictions
      ADD CONSTRAINT routing_turn_restrictions_source_registry_id_fkey
        FOREIGN KEY (source_registry_id)
        REFERENCES system.system_source_registry (id);
  END IF;

  IF to_regclass('system.system_source_snapshots') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'routing_turn_restrictions_source_snapshot_id_fkey'
         AND conrelid = 'routing.routing_turn_restrictions'::regclass
     )
  THEN
    ALTER TABLE routing.routing_turn_restrictions
      ADD CONSTRAINT routing_turn_restrictions_source_snapshot_id_fkey
        FOREIGN KEY (source_snapshot_id)
        REFERENCES system.system_source_snapshots (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS routing_turn_restrictions_public_id_uq
  ON routing.routing_turn_restrictions (public_id);

CREATE INDEX IF NOT EXISTS routing_turn_restrictions_from_street_id_idx
  ON routing.routing_turn_restrictions (from_street_id);

CREATE INDEX IF NOT EXISTS routing_turn_restrictions_to_street_id_idx
  ON routing.routing_turn_restrictions (to_street_id);

CREATE INDEX IF NOT EXISTS routing_turn_restrictions_via_street_id_idx
  ON routing.routing_turn_restrictions (via_street_id)
  WHERE via_street_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS routing_turn_restrictions_via_geom_gix
  ON routing.routing_turn_restrictions USING gist (via_geom)
  WHERE via_geom IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS routing_turn_restrictions_source_identity_uidx
  ON routing.routing_turn_restrictions (
    source_registry_id,
    source_feature_type,
    source_feature_id
  )
  WHERE source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS routing_turn_restrictions_external_id_idx
  ON routing.routing_turn_restrictions (external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS routing_turn_restrictions_is_active_idx
  ON routing.routing_turn_restrictions (is_active);

COMMENT ON TABLE routing.routing_turn_restrictions IS
  'Reviewed OSM turn restrictions linked to core.core_streets segments. '
  'Source of truth for CoreMap; not a Valhalla internal graph table. '
  'Resolve from/to/via streets by geometry at the via intersection — never by first OSM-way match.';

COMMENT ON COLUMN routing.routing_turn_restrictions.via_node_external_id IS
  'OSM via node identity when the restriction uses a via node (e.g. osm:node:123).';

COMMENT ON COLUMN routing.routing_turn_restrictions.via_street_id IS
  'Optional via way mapped to a Core street segment when the restriction uses via ways.';

COMMIT;

-- =============================================================================
-- Verification (manual)
-- =============================================================================
--
-- SELECT column_name, udt_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'routing' AND table_name = 'routing_barriers'
-- ORDER BY ordinal_position;
--
-- SELECT column_name, udt_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'routing' AND table_name = 'routing_turn_restrictions'
-- ORDER BY ordinal_position;
--
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'routing'
--   AND tablename IN ('routing_barriers', 'routing_turn_restrictions')
-- ORDER BY 1;
--
-- SELECT count(*) FROM routing.routing_barriers;
-- SELECT count(*) FROM routing.routing_turn_restrictions;
--
