-- Township catalogue reclassification (PREVIEW / DO NOT EXECUTE without approval)
-- Project: locghyuranqaqsnbxflc
-- Date: 2026-07-24
-- Source: tmp/township-overlap-repair/final-repair-plan.csv (RECLASSIFY rows)
--
-- Scope:
--   * Insert ref.ref_admin_levels.self_administered_zone (rank 35) if missing
--   * Reclassify SAZ 6115,6192,6693 → self_administered_zone / self_administered_zone
--   * Reclassify town 6497 → town / town
--   * Reclassify subtownship 5979 → town / special_area
--   * Reclassify nested lower 6337,6462,6483 → town / town
--   * Reclassify wrong-entity 7523 → town / special_area (preserve FKs; no soft-delete)
--
-- Preserved: id, public_id, names, parent_id, geom, centroid, source, verification, is_active
-- Changed: admin_level_id, admin_area_type_id, updated_at
-- No geometry changes. No deletes. No lookup-function changes.
-- After apply: update core.admin_area_is_non_operational_township_id denylist OR rely on level!=township
-- (denylist update is a separate follow-up if functions still list these IDs).

BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '30s';

INSERT INTO ref.ref_admin_levels (code, name, rank)
SELECT 'self_administered_zone', 'Self-Administered Zone', 35
WHERE NOT EXISTS (
    SELECT 1 FROM ref.ref_admin_levels WHERE code = 'self_administered_zone'
);

CREATE TABLE IF NOT EXISTS system.repair_township_catalogue_reclass_20260724 (
    id bigint PRIMARY KEY,
    canonical_name text NOT NULL,
    parent_id bigint,
    admin_level_id bigint NOT NULL,
    admin_area_type_id bigint,
    updated_at timestamptz,
    is_active boolean NOT NULL,
    deleted_at timestamptz,
    geom_hash text NOT NULL,
    classification_label text NOT NULL,
    proposed_level text NOT NULL,
    proposed_type text NOT NULL,
    repaired_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system.repair_township_catalogue_reclass_20260724 (
    id, canonical_name, parent_id, admin_level_id, admin_area_type_id,
    updated_at, is_active, deleted_at, geom_hash,
    classification_label, proposed_level, proposed_type
)
SELECT
    aa.id, aa.canonical_name, aa.parent_id, aa.admin_level_id, aa.admin_area_type_id,
    aa.updated_at, aa.is_active, aa.deleted_at,
    md5(encode(ST_AsEWKB(aa.geom), 'hex')),
    v.label, v.prop_level, v.prop_type
FROM core.core_admin_areas aa
JOIN (
    VALUES
        (6115::bigint, 'SELF_ADMINISTERED_CONTAINER', 'self_administered_zone', 'self_administered_zone'),
        (6192, 'SELF_ADMINISTERED_CONTAINER', 'self_administered_zone', 'self_administered_zone'),
        (6693, 'SELF_ADMINISTERED_CONTAINER', 'self_administered_zone', 'self_administered_zone'),
        (6497, 'TOWN_OR_LOWER_LEVEL', 'town', 'town'),
        (5979, 'TOWN_OR_LOWER_LEVEL', 'town', 'special_area'),
        (6337, 'TOWN_OR_LOWER_LEVEL', 'town', 'town'),
        (6462, 'TOWN_OR_LOWER_LEVEL', 'town', 'town'),
        (6483, 'TOWN_OR_LOWER_LEVEL', 'town', 'town'),
        (7523, 'WRONG_ENTITY_GEOMETRY', 'town', 'special_area')
) AS v(id, label, prop_level, prop_type) ON v.id = aa.id
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad
    FROM core.core_admin_areas aa
    JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
    LEFT JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
    WHERE aa.id IN (6115, 6192, 6693, 6497, 5979, 6337, 6462, 6483, 7523)
      AND (
          aa.deleted_at IS NOT NULL
          OR aa.is_active IS NOT TRUE
          OR al.code IS DISTINCT FROM 'township'
          OR t.code IS DISTINCT FROM 'township'
      );
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'Pre-state guard failed for % catalogue row(s)', v_bad;
    END IF;
END $$;

-- SAZ
UPDATE core.core_admin_areas aa
SET admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'self_administered_zone'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'self_administered_zone'),
    updated_at = now()
WHERE aa.id IN (6115, 6192, 6693);

-- Clear town
UPDATE core.core_admin_areas aa
SET admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'town'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'town'),
    updated_at = now()
WHERE aa.id IN (6497, 6337, 6462, 6483);

-- Subtownship + wrong-entity → town/special_area
UPDATE core.core_admin_areas aa
SET admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'town'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'special_area'),
    updated_at = now()
WHERE aa.id IN (5979, 7523);

-- Post guards
DO $$
DECLARE
    v_bad integer;
    v_op integer;
BEGIN
    SELECT count(*) INTO v_bad
    FROM core.core_admin_areas aa
    JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
    WHERE aa.id IN (6115, 6192, 6693, 6497, 5979, 6337, 6462, 6483, 7523) AND al.code = 'township';
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'Post-state: % rows still township level', v_bad;
    END IF;

    SELECT count(*) INTO v_op
    FROM core.core_admin_areas aa
    JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
    WHERE aa.is_active AND aa.deleted_at IS NULL AND al.code = 'township';
    IF v_op <> 364 THEN
        RAISE EXCEPTION 'Expected 364 active township-level rows after catalogue cleanup, got %', v_op;
    END IF;
END $$;

-- Intentionally ends in ROLLBACK for preview safety.
ROLLBACK;
