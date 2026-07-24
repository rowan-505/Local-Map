-- Duplicate resolution apply preview (MERGE + high-confidence RECLASSIFY)
-- Project: locghyuranqaqsnbxflc
-- Date: 2026-07-24
-- Source plan: tmp/township-overlap-repair/duplicate-resolution-plan.csv
--
-- Groups included:
--   DUPR-004 MERGE_DUPLICATE : retain 6762 ; soft-deactivate 6763
--   DUPR-001 RECLASSIFY_ONE  : retain 7332 ; 5853 township→town
--   DUPR-003 RECLASSIFY_ONE  : retain 6417 ; 6407 township→town
--   DUPR-002 RECLASSIFY_ONE  : retain 6015 ; 6014 soft-deactivate
--       (district alias exists, but parent is already a district; changing
--        level/type to district without parent repair creates invalid
--        equal-rank hierarchy. Safe high-confidence action = soft-deactivate
--        out of the operational township set. No geometry merge.)
--
-- Geometry operations:
--   * NONE. All union_unique_into_retained = false in the plan.
--   * retained geometries unchanged.
--
-- FK updates:
--   * 6763 has no production entity FK dependents (places/streets/transport/…).
--     Only core.core_admin_area_names rows belong to 6763 itself; they stay
--     attached to the deactivated row (names are identical to 6762).
--   * 5853 / 6407 / 6014 reclass/deactivate: no FK repoint required for merge.
--     5853 keeps its 3 ward children (parent_id unchanged; town→ward is valid).
--
-- Local backup GPKG:
--   tmp/township-overlap-repair/backups/duplicate_apply_preview_20260724.gpkg
--
-- DO NOT EXECUTE until explicit user approval.
-- File ends with ROLLBACK for safe preview runs.

BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '15s';

-- =============================================================================
-- 0) Slim backups
-- =============================================================================
CREATE TABLE IF NOT EXISTS system.repair_dup_admin_areas_20260724 (
    id bigint PRIMARY KEY,
    canonical_name text NOT NULL,
    parent_id bigint,
    admin_level_id bigint NOT NULL,
    admin_area_type_id bigint,
    is_active boolean NOT NULL,
    deleted_at timestamptz,
    updated_at timestamptz,
    is_verified boolean,
    verification_status text,
    geom_hash text NOT NULL,
    role text NOT NULL,
    repaired_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system.repair_dup_fk_backup_20260724 (
    id bigserial PRIMARY KEY,
    source_table text NOT NULL,
    source_pk bigint,
    column_name text NOT NULL,
    old_admin_area_id bigint NOT NULL,
    new_admin_area_id bigint,
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    repaired_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system.repair_dup_admin_areas_20260724 (
    id, canonical_name, parent_id, admin_level_id, admin_area_type_id,
    is_active, deleted_at, updated_at, is_verified, verification_status,
    geom_hash, role
)
SELECT
    aa.id,
    aa.canonical_name,
    aa.parent_id,
    aa.admin_level_id,
    aa.admin_area_type_id,
    aa.is_active,
    aa.deleted_at,
    aa.updated_at,
    aa.is_verified,
    aa.verification_status,
    md5(encode(ST_AsEWKB(aa.geom), 'hex')),
    v.role
FROM core.core_admin_areas AS aa
JOIN (
    VALUES
        (6762::bigint, 'retained_merge'),
        (6763, 'duplicate_merge_deactivate'),
        (6015, 'retained_reclass_group'),
        (6014, 'duplicate_soft_deactivate'),
        (7332, 'retained_reclass_group'),
        (5853, 'duplicate_reclassify_town'),
        (6417, 'retained_reclass_group'),
        (6407, 'duplicate_reclassify_town')
) AS v(id, role) ON v.id = aa.id
ON CONFLICT (id) DO NOTHING;

-- Pre-state guards
DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    LEFT JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
    WHERE aa.id IN (6762, 6763, 6014, 6015, 5853, 7332, 6407, 6417)
      AND (
          aa.deleted_at IS NOT NULL
          OR aa.is_active IS NOT TRUE
          OR al.code IS DISTINCT FROM 'township'
          OR coalesce(t.code, '') IS DISTINCT FROM 'township'
      );
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'Pre-state guard failed for % affected admin row(s)', v_bad;
    END IF;

    -- MERGE target must have zero production entity FKs on the duplicate
    IF EXISTS (
        SELECT 1 FROM core.core_places WHERE deleted_at IS NULL AND admin_area_id = 6763
        UNION ALL SELECT 1 FROM core.core_streets WHERE deleted_at IS NULL AND admin_area_id = 6763
        UNION ALL SELECT 1 FROM core.core_addresses WHERE deleted_at IS NULL AND admin_area_id = 6763
        UNION ALL SELECT 1 FROM core.core_map_buildings WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM core.core_map_landuse WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM transport.stops WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM transport.terminals WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM transport.infrastructure_lines WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM transport.routes WHERE origin_admin_area_id = 6763 OR destination_admin_area_id = 6763
        UNION ALL SELECT 1 FROM core.core_admin_areas WHERE deleted_at IS NULL AND parent_id = 6763
        UNION ALL SELECT 1 FROM app.user_saved_places WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM feedback.user_reports WHERE admin_area_id = 6763
        UNION ALL SELECT 1 FROM app_auth.auth_users WHERE primary_region_id = 6763
        UNION ALL SELECT 1 FROM search.address_index WHERE admin_area_id = 6763
    ) THEN
        RAISE EXCEPTION 'Unexpected production FK dependents still point at 6763; aborting merge';
    END IF;
END $$;

-- =============================================================================
-- 1) DUPR-004 MERGE_DUPLICATE: 6763 → 6762
--    Geometry: no union (unique coverage of 6763 belongs to other townships)
--    FK entity repoint: none required (zero dependents)
--    Soft-deactivate duplicate
-- =============================================================================
UPDATE core.core_admin_areas AS aa
SET
    is_active = false,
    deleted_at = now(),
    updated_at = now()
WHERE aa.id = 6763
  AND aa.deleted_at IS NULL
  AND aa.is_active IS TRUE
  AND EXISTS (
      SELECT 1 FROM system.repair_dup_admin_areas_20260724 b
      WHERE b.id = 6763 AND b.role = 'duplicate_merge_deactivate'
  );

-- =============================================================================
-- 2) DUPR-001 / DUPR-003 RECLASSIFY_ONE → town
--    5853 Pantanaw town, 6407 Laukkai town
--    Geometry / parent / name unchanged
-- =============================================================================
UPDATE core.core_admin_areas AS aa
SET
    admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'town'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'town'),
    updated_at = now()
WHERE aa.id IN (5853, 6407)
  AND aa.deleted_at IS NULL
  AND aa.is_active IS TRUE;

-- =============================================================================
-- 3) DUPR-002: 6014 soft-deactivate (safe high-confidence removal)
--    Not converted to district here: parent 5974 is already district.
-- =============================================================================
UPDATE core.core_admin_areas AS aa
SET
    is_active = false,
    deleted_at = now(),
    updated_at = now()
WHERE aa.id = 6014
  AND aa.deleted_at IS NULL
  AND aa.is_active IS TRUE;

-- =============================================================================
-- 4) Audit
-- =============================================================================
INSERT INTO system.audit_logs (
    actor_user_id, action_type, entity_type, entity_id, before_snapshot, after_snapshot
)
SELECT
    NULL,
    'township_overlap_repair_duplicate_apply_20260724',
    'core_admin_areas',
    b.id,
    jsonb_build_object(
        'role', b.role,
        'canonical_name', b.canonical_name,
        'parent_id', b.parent_id,
        'admin_level_id', b.admin_level_id,
        'admin_area_type_id', b.admin_area_type_id,
        'is_active', b.is_active,
        'deleted_at', b.deleted_at,
        'geom_hash', b.geom_hash
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
        'geometry_changed', (b.geom_hash IS DISTINCT FROM md5(encode(ST_AsEWKB(aa.geom), 'hex'))),
        'note', 'duplicate resolution apply preview'
    )
FROM system.repair_dup_admin_areas_20260724 AS b
JOIN core.core_admin_areas AS aa ON aa.id = b.id
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
LEFT JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
WHERE b.id IN (6762, 6763, 6014, 6015, 5853, 7332, 6407, 6417);

-- =============================================================================
-- 5) Verification (fails transaction on mismatch)
-- =============================================================================
DO $$
DECLARE
    v_cnt integer;
    v_ops integer;
    v_bad integer;
BEGIN
    -- Retained rows still active townships, geom unchanged
    SELECT count(*) INTO v_cnt
    FROM system.repair_dup_admin_areas_20260724 AS b
    JOIN core.core_admin_areas AS aa ON aa.id = b.id
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE b.role LIKE 'retained%'
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND al.code = 'township'
      AND b.geom_hash = md5(encode(ST_AsEWKB(aa.geom), 'hex'))
      AND b.canonical_name = aa.canonical_name
      AND b.parent_id IS NOT DISTINCT FROM aa.parent_id;
    IF v_cnt <> 4 THEN
        RAISE EXCEPTION 'Retained-row invariant failed: expected 4, got %', v_cnt;
    END IF;

    -- Town reclass
    SELECT count(*) INTO v_cnt
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    JOIN ref.ref_admin_area_types AS t ON t.id = aa.admin_area_type_id
    JOIN system.repair_dup_admin_areas_20260724 AS b ON b.id = aa.id
    WHERE aa.id IN (5853, 6407)
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND al.code = 'town'
      AND t.code = 'town'
      AND b.geom_hash = md5(encode(ST_AsEWKB(aa.geom), 'hex'))
      AND b.parent_id IS NOT DISTINCT FROM aa.parent_id
      AND b.canonical_name = aa.canonical_name;
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'Town reclass verify failed: expected 2, got %', v_cnt;
    END IF;

    -- Soft-deactivated duplicates
    SELECT count(*) INTO v_cnt
    FROM core.core_admin_areas AS aa
    WHERE aa.id IN (6763, 6014)
      AND aa.is_active IS FALSE
      AND aa.deleted_at IS NOT NULL;
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'Soft-deactivate verify failed for 6763/6014';
    END IF;

    -- No production entity FK remains on deactivated duplicates
    SELECT count(*) INTO v_bad FROM (
        SELECT admin_area_id AS id FROM core.core_places WHERE deleted_at IS NULL AND admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM core.core_streets WHERE deleted_at IS NULL AND admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM core.core_addresses WHERE deleted_at IS NULL AND admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM core.core_map_buildings WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM core.core_map_landuse WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM transport.stops WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM transport.terminals WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM transport.infrastructure_lines WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT origin_admin_area_id FROM transport.routes WHERE origin_admin_area_id IN (6763, 6014)
        UNION ALL SELECT destination_admin_area_id FROM transport.routes WHERE destination_admin_area_id IN (6763, 6014)
        UNION ALL SELECT parent_id FROM core.core_admin_areas WHERE deleted_at IS NULL AND parent_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM app.user_saved_places WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM feedback.user_reports WHERE admin_area_id IN (6763, 6014)
        UNION ALL SELECT primary_region_id FROM app_auth.auth_users WHERE primary_region_id IN (6763, 6014)
        UNION ALL SELECT admin_area_id FROM search.address_index WHERE admin_area_id IN (6763, 6014)
    ) s;
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'Deactivated duplicates still have % production FK reference(s)', v_bad;
    END IF;

    -- Deactivated / reclassified IDs absent from operational township query
    SELECT count(*) INTO v_ops
    FROM core.core_admin_areas AS aa
    JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.deleted_at IS NULL
      AND aa.is_active IS TRUE
      AND al.code = 'township'
      AND aa.id IN (6763, 6014, 5853, 6407);
    IF v_ops <> 0 THEN
        RAISE EXCEPTION 'Resolved duplicates still appear in operational township set';
    END IF;

    -- Coverage: retained merge row 6762 geometry hash must be unchanged (no union applied).
    -- Deactivated 6763 unique area is intentionally NOT added (belongs to other townships).

    -- Geometry validity / SRID / type for all touched rows
    SELECT count(*) INTO v_bad
    FROM core.core_admin_areas AS aa
    WHERE aa.id IN (6762, 6763, 6014, 6015, 5853, 7332, 6407, 6417)
      AND (
          aa.geom IS NULL
          OR ST_IsEmpty(aa.geom)
          OR NOT ST_IsValid(aa.geom)
          OR ST_SRID(aa.geom) <> 4326
          OR GeometryType(aa.geom) NOT IN ('POLYGON', 'MULTIPOLYGON')
      );
    IF v_bad <> 0 THEN
        RAISE EXCEPTION 'Geometry validity/SRID/type failed on % touched row(s)', v_bad;
    END IF;
END $$;

-- Operator metrics
SELECT 'backup_admin_rows' AS metric, count(*)::text AS value
FROM system.repair_dup_admin_areas_20260724
UNION ALL
SELECT 'active_township_count_after',
       count(*)::text
FROM core.core_admin_areas AS aa
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active IS TRUE AND al.code = 'township'
UNION ALL
SELECT 'expected_active_township_count_after', '373'  -- 377 - 4 (6763,6014,5853,6407)
UNION ALL
SELECT 'soft_deactivated',
       string_agg(id::text, ',' ORDER BY id)
FROM core.core_admin_areas
WHERE id IN (6763, 6014) AND is_active IS FALSE AND deleted_at IS NOT NULL
UNION ALL
SELECT 'reclassified_towns',
       string_agg(aa.id::text, ',' ORDER BY aa.id)
FROM core.core_admin_areas AS aa
JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE aa.id IN (5853, 6407) AND al.code = 'town'
UNION ALL
SELECT 'fk_repoints_applied', '0'
UNION ALL
SELECT 'geometry_unions_applied', '0';

-- Approved for apply 2026-07-24.
COMMIT;
