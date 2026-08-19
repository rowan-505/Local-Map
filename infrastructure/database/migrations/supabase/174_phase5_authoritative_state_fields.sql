-- Phase 5: make travel_direction and verification_status authoritative without
-- rewriting core rows or dropping compatibility columns.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Production audit found four legacy/manual streets whose only direction record
-- is is_oneway=true in current rows and version history. Preserve that meaning
-- before compatibility reads start deriving from travel_direction. Target the
-- primary keys explicitly: a predicate-only repair scanned the 4 GB street table
-- and timed out even though only four rows qualified.
DO $block$
DECLARE
  repair_count bigint;
BEGIN
  SELECT count(*) INTO repair_count
  FROM core.core_streets AS s
  JOIN (VALUES
    (25::bigint, '82402886-c62b-4a14-9300-f0e1c56e9365'::uuid),
    (488::bigint, '73283652-9bba-442e-827c-62628ddcadb7'::uuid),
    (491::bigint, '04cdc359-62f7-4c46-a54d-626955f22e76'::uuid),
    (492::bigint, '64ef727b-e3cd-47ff-89d6-68f8d0339c8c'::uuid)
  ) AS audited(id, public_id)
    ON audited.id = s.id AND audited.public_id = s.public_id
  WHERE s.travel_direction IS NULL
    AND s.is_oneway IS TRUE;

  IF repair_count <> 4 THEN
    RAISE EXCEPTION
      'Migration 174 refused: expected 4 audited legacy one-way rows, found %',
      repair_count;
  END IF;

  UPDATE core.core_streets AS s
  SET travel_direction = 'forward'
  FROM (VALUES
    (25::bigint, '82402886-c62b-4a14-9300-f0e1c56e9365'::uuid),
    (488::bigint, '73283652-9bba-442e-827c-62628ddcadb7'::uuid),
    (491::bigint, '04cdc359-62f7-4c46-a54d-626955f22e76'::uuid),
    (492::bigint, '64ef727b-e3cd-47ff-89d6-68f8d0339c8c'::uuid)
  ) AS audited(id, public_id)
  WHERE audited.id = s.id
    AND audited.public_id = s.public_id
    AND s.travel_direction IS NULL
    AND s.is_oneway IS TRUE;
END;
$block$;

CREATE OR REPLACE FUNCTION core.sync_street_is_oneway_from_travel_direction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  -- Rolling-deploy compatibility: translate a legacy-only boolean write into
  -- the authoritative field. New writers provide travel_direction directly.
  IF TG_OP = 'INSERT' THEN
    IF NEW.travel_direction IS NULL AND NEW.is_oneway IS TRUE THEN
      NEW.travel_direction := 'forward';
    END IF;
  ELSIF NEW.travel_direction IS NOT DISTINCT FROM OLD.travel_direction
        AND NEW.is_oneway IS DISTINCT FROM OLD.is_oneway THEN
    NEW.travel_direction := CASE WHEN NEW.is_oneway THEN 'forward' ELSE NULL END;
  END IF;

  NEW.is_oneway := COALESCE(NEW.travel_direction IN ('forward', 'reverse'), FALSE);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION core.sync_street_is_oneway_from_travel_direction() IS
  'Keeps deprecated core_streets.is_oneway derived from authoritative travel_direction; also bridges legacy-only writes during rolling deployment.';

DROP TRIGGER IF EXISTS trg_sync_street_is_oneway_from_travel_direction
  ON core.core_streets;

CREATE TRIGGER trg_sync_street_is_oneway_from_travel_direction
BEFORE INSERT OR UPDATE OF travel_direction, is_oneway
ON core.core_streets
FOR EACH ROW
EXECUTE FUNCTION core.sync_street_is_oneway_from_travel_direction();

CREATE OR REPLACE FUNCTION core.sync_is_verified_from_verification_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.is_verified := (NEW.verification_status = 'verified');

  IF NEW.verification_status = 'verified' AND TG_OP = 'INSERT' THEN
    NEW.verified_at := COALESCE(NEW.verified_at, statement_timestamp());
  ELSIF NEW.verification_status = 'verified'
        AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    NEW.verified_at := COALESCE(NEW.verified_at, statement_timestamp());
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION core.sync_is_verified_from_verification_status() IS
  'Derives compatibility is_verified from authoritative verification_status and timestamps future transitions to verified.';

DO $block$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relkind IN ('r', 'p')
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = c.oid AND a.attname = 'is_verified'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = c.oid AND a.attname = 'verification_status'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = c.oid AND a.attname = 'verified_at'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      'trg_sync_is_verified_from_verification_status',
      target.schema_name,
      target.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF verification_status, is_verified ON %I.%I FOR EACH ROW EXECUTE FUNCTION core.sync_is_verified_from_verification_status()',
      'trg_sync_is_verified_from_verification_status',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END;
$block$;

COMMENT ON COLUMN core.core_streets.travel_direction IS
  'Authoritative travel direction. NULL means normal/default bidirectional; forward/reverse are one-way; reversible/alternating/unknown retain their explicit semantics.';
COMMENT ON COLUMN core.core_streets.is_oneway IS
  'DEPRECATED compatibility mirror derived from travel_direction. Do not write independently.';
COMMENT ON COLUMN core.core_streets.edit_status IS
  'DEPRECATED per-row lifecycle field. Current application workflow does not use it as authoritative state.';
COMMENT ON COLUMN core.core_streets.routing_status IS
  'DEPRECATED per-row build field. Authoritative build/job state belongs in routing.routing_builds and routing.routing_build_jobs.';

CREATE OR REPLACE VIEW tiles.tiles_streets_v AS
SELECT
  s.id,
  s.public_id::text AS public_id,
  COALESCE(
    NULLIF(btrim(mm.name), ''),
    NULLIF(btrim(en.name), ''),
    NULLIF(btrim(s.canonical_name), ''),
    'Unnamed street'
  ) AS name,
  s.canonical_name,
  s.admin_area_id,
  s.is_active,
  s.updated_at,
  ST_Force2D(ST_SetSRID(s.geom, 4326))::geometry(LineString, 4326) AS geom,
  mm.name AS name_mm,
  en.name AS name_en,
  COALESCE(rc.code, 'unknown') AS road_class,
  COALESCE(rc.code, 'unknown') AS road_class_code,
  COALESCE(rc.rank, 100) AS sort_rank,
  COALESCE(rc.min_zoom, 12::numeric) AS min_zoom,
  s.surface,
  COALESCE(s.travel_direction IN ('forward', 'reverse'), false) AS is_oneway,
  COALESCE(s.bridge, false) AS bridge,
  COALESCE(s.tunnel, false) AS tunnel,
  COALESCE(s.layer, 0) AS layer
FROM core.core_streets AS s
LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
LEFT JOIN LATERAL (
  SELECT sn.name
  FROM core.core_street_names AS sn
  WHERE sn.street_id = s.id
    AND coalesce(btrim(sn.name_type), '') <> 'generated'
    AND (lower(btrim(sn.language_code)) IN ('mm', 'my')
      OR upper(btrim(coalesce(sn.script_code, ''))) = 'MYMR')
  ORDER BY sn.is_primary DESC NULLS LAST,
    CASE WHEN sn.name_type = 'official' THEN 0 ELSE 1 END,
    sn.id
  LIMIT 1
) AS mm ON true
LEFT JOIN LATERAL (
  SELECT sn.name
  FROM core.core_street_names AS sn
  WHERE sn.street_id = s.id
    AND coalesce(btrim(sn.name_type), '') <> 'generated'
    AND (lower(btrim(sn.language_code)) = 'en'
      OR upper(btrim(coalesce(sn.script_code, ''))) = 'LATN')
  ORDER BY sn.is_primary DESC NULLS LAST,
    CASE WHEN sn.name_type = 'official' THEN 0 ELSE 1 END,
    sn.id
  LIMIT 1
) AS en ON true
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND ST_IsValid(s.geom)
  AND NOT ST_IsEmpty(s.geom)
  AND ST_GeometryType(ST_Force2D(ST_SetSRID(s.geom, 4326))) = 'ST_LineString';

COMMENT ON VIEW tiles.tiles_streets_v IS
  'Street MVT compatibility view; classification derives from road_class_id and is_oneway derives from travel_direction.';

COMMIT;
