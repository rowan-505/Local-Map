-- Township operational-set reclassification (non-township entities)
-- Project: locghyuranqaqsnbxflc
-- Date: 2026-07-24
-- Stage: reclassify SELF_ADMINISTERED_CONTAINER + high-confidence TOWN only
--
-- Scope (high confidence only):
--   * 6115, 6192, 6693  → admin_level + admin_area_type = self_administered_zone
--   * 6497              → admin_level + admin_area_type = town
--
-- Explicitly NOT in this transaction (held / needs separate decision):
--   * 5979 ပုံပါကျင်မြို့နယ်ခွဲ — subtownship; no matching ref type/level yet
--   * 6337, 6462, 6483 — low-confidence TOWN_OR_LOWER_LEVEL demotions
--   * All TRUE_TOWNSHIP / PARTIAL_DUPLICATE / WRONG_ENTITY_GEOMETRY rows
--
-- Preserved on every updated row:
--   id, public_id, canonical_name, slug, parent_id, geom, centroid,
--   source fields, verification fields, is_active, deleted_at
--
-- Changes only:
--   admin_level_id, admin_area_type_id, updated_at
--
-- Prerequisite reference addition (smallest reasonable):
--   INSERT into ref.ref_admin_levels:
--     code = 'self_administered_zone'
--     name = 'Self-Administered Zone'
--     rank = 35   -- between district(30) and township(40)
--   Type ref.ref_admin_area_types.self_administered_zone already exists (id=5).
--
-- DO NOT EXECUTE until explicit user approval of this preview.
-- Local backup GPKG:
--   tmp/township-overlap-repair/backups/non_township_reclassify_candidates_20260724.gpkg

BEGIN;
SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 0) Proposed reference addition (required for SAZ rows)
-- ---------------------------------------------------------------------------
INSERT INTO ref.ref_admin_levels (code, name, rank)
SELECT 'self_administered_zone', 'Self-Administered Zone', 35
WHERE NOT EXISTS (
    SELECT 1 FROM ref.ref_admin_levels WHERE code = 'self_administered_zone'
);

-- ---------------------------------------------------------------------------
-- 1) Slim production backup of rows we will change
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system.repair_township_reclass_non_township_20260724 (
    id bigint PRIMARY KEY,
    canonical_name text NOT NULL,
    parent_id bigint,
    admin_level_id bigint NOT NULL,
    admin_area_type_id bigint,
    updated_at timestamptz,
    is_active boolean NOT NULL,
    deleted_at timestamptz,
    is_verified boolean,
    verification_status text,
    geom_hash text NOT NULL,
    classification_label text NOT NULL,
    repaired_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system.repair_township_reclass_non_township_20260724 (
    id, canonical_name, parent_id, admin_level_id, admin_area_type_id,
    updated_at, is_active, deleted_at, is_verified, verification_status,
    geom_hash, classification_label
)
SELECT
    aa.id,
    aa.canonical_name,
    aa.parent_id,
    aa.admin_level_id,
    aa.admin_area_type_id,
    aa.updated_at,
    aa.is_active,
    aa.deleted_at,
    aa.is_verified,
    aa.verification_status,
    md5(encode(ST_AsEWKB(aa.geom), 'hex')),
    v.label
FROM core.core_admin_areas AS aa
JOIN (
    VALUES
        (6115::bigint, 'SELF_ADMINISTERED_CONTAINER'),
        (6192, 'SELF_ADMINISTERED_CONTAINER'),
        (6693, 'SELF_ADMINISTERED_CONTAINER'),
        (6497, 'TOWN_OR_LOWER_LEVEL')
) AS v(id, label) ON v.id = aa.id
ON CONFLICT (id) DO NOTHING;

-- Guard: expected pre-state is active township/township
DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    LEFT JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
    WHERE aa.id IN (6115, 6192, 6693, 6497)
      AND (
          aa.deleted_at IS NOT NULL
          OR aa.is_active IS NOT TRUE
          OR al.code IS DISTINCT FROM 'township'
          OR t.code IS DISTINCT FROM 'township'
      );
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'Pre-state guard failed for % row(s); aborting', v_bad;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Apply SAZ reclassification (level + type only)
-- ---------------------------------------------------------------------------
UPDATE core.core_admin_areas AS aa
SET
    admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'self_administered_zone'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'self_administered_zone'),
    updated_at = now()
WHERE aa.id IN (6115, 6192, 6693)
  AND aa.deleted_at IS NULL
  AND aa.is_active IS TRUE;

-- ---------------------------------------------------------------------------
-- 3) Apply Lashio town reclassification (level + type only)
-- ---------------------------------------------------------------------------
UPDATE core.core_admin_areas AS aa
SET
    admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'town'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'town'),
    updated_at = now()
WHERE aa.id = 6497
  AND aa.deleted_at IS NULL
  AND aa.is_active IS TRUE;

-- ---------------------------------------------------------------------------
-- 4) Audit
-- ---------------------------------------------------------------------------
INSERT INTO system.audit_logs (
    actor_user_id, action_type, entity_type, entity_id, before_snapshot, after_snapshot
)
SELECT
    NULL,
    'township_overlap_repair_reclassify_non_township_20260724',
    'core_admin_areas',
    b.id,
    jsonb_build_object(
        'canonical_name', b.canonical_name,
        'parent_id', b.parent_id,
        'admin_level_id', b.admin_level_id,
        'admin_area_type_id', b.admin_area_type_id,
        'is_active', b.is_active,
        'deleted_at', b.deleted_at,
        'geom_hash', b.geom_hash,
        'classification_label', b.classification_label
    ),
    jsonb_build_object(
        'canonical_name', aa.canonical_name,
        'parent_id', aa.parent_id,
        'admin_level_id', aa.admin_level_id,
        'admin_level_code', al.code,
        'admin_area_type_id', aa.admin_area_type_id,
        'admin_area_type_code', t.code,
        'is_active', aa.is_active,
        'deleted_at', aa.deleted_at,
        'geom_hash', md5(encode(ST_AsEWKB(aa.geom), 'hex')),
        'note', 'reclassified out of operational township set; geometry/name/parent unchanged'
    )
FROM system.repair_township_reclass_non_township_20260724 AS b
JOIN core.core_admin_areas AS aa ON aa.id = b.id
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
LEFT JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
WHERE b.id IN (6115, 6192, 6693, 6497);

-- ---------------------------------------------------------------------------
-- 5) In-transaction verification (fails the transaction on mismatch)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_cnt integer;
    v_ops integer;
    v_geom_changed integer;
    v_name_changed integer;
    v_parent_changed integer;
    v_deleted integer;
BEGIN
    SELECT count(*) INTO v_cnt
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
    WHERE aa.id IN (6115, 6192, 6693)
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND al.code = 'self_administered_zone'
      AND t.code = 'self_administered_zone';
    IF v_cnt <> 3 THEN
        RAISE EXCEPTION 'SAZ reclass verify failed: expected 3, got %', v_cnt;
    END IF;

    SELECT count(*) INTO v_cnt
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
    WHERE aa.id = 6497
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND al.code = 'town'
      AND t.code = 'town';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'Town reclass verify failed for 6497';
    END IF;

    SELECT count(*) INTO v_geom_changed
    FROM system.repair_township_reclass_non_township_20260724 AS b
    JOIN core.core_admin_areas AS aa ON aa.id = b.id
    WHERE b.geom_hash IS DISTINCT FROM md5(encode(ST_AsEWKB(aa.geom), 'hex'))
       OR b.canonical_name IS DISTINCT FROM aa.canonical_name
       OR b.parent_id IS DISTINCT FROM aa.parent_id
       OR aa.deleted_at IS NOT NULL
       OR aa.is_active IS NOT TRUE;
    IF v_geom_changed <> 0 THEN
        RAISE EXCEPTION 'Invariant failed: geometry/name/parent/active/deleted changed on % row(s)', v_geom_changed;
    END IF;

    -- Affected IDs must no longer appear in operational township query
    SELECT count(*) INTO v_ops
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.deleted_at IS NULL
      AND aa.is_active IS TRUE
      AND al.code = 'township'
      AND aa.id IN (6115, 6192, 6693, 6497);
    IF v_ops <> 0 THEN
        RAISE EXCEPTION 'Affected rows still in operational township set: %', v_ops;
    END IF;
END $$;

-- Metrics for the operator
SELECT 'backup_rows' AS metric, count(*)::text AS value
FROM system.repair_township_reclass_non_township_20260724
UNION ALL
SELECT 'active_township_count_after',
       count(*)::text
FROM core.core_admin_areas AS aa
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active IS TRUE AND al.code = 'township'
UNION ALL
SELECT 'expected_active_township_count_after', '373'  -- 377 - 4
UNION ALL
SELECT 'saz_active_rows',
       count(*)::text
FROM core.core_admin_areas AS aa
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE aa.id IN (6115, 6192, 6693) AND al.code = 'self_administered_zone'
UNION ALL
SELECT 'town_6497_level',
       al.code
FROM core.core_admin_areas AS aa
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE aa.id = 6497;

-- COMMIT only after explicit approval. Leave as ROLLBACK during dry preview runs.
-- COMMIT;
ROLLBACK;
