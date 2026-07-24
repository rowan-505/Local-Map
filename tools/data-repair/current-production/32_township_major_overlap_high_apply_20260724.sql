-- High-confidence major-overlap subtractive repair (preview)
-- Project: locghyuranqaqsnbxflc
-- Date: 2026-07-24
-- Source plan: tmp/township-overlap-repair/major-overlap-repair-plan.csv
--
-- Scope: confidence = HIGH only. REVIEW_REQUIRED and MEDIUM pairs are excluded.
--
-- Pairs included:
--   OV-006-7323-7525  ASSIGN_FULL_TO_B
--     loser  7323 ဝါးခယ်မမြို့နယ်  (remove A∩B only)
--     keeper 7525 မအူပင်မြို့နယ်      (unchanged)
--     expected area removed ≈ 1,704,870.145 m² (1.704870 km²)
--
--   OV-007-7298-7524  ASSIGN_FULL_TO_B
--     loser  7298 ထန်းတပင်မြို့နယ်  (remove A∩B only)
--     keeper 7524 ညောင်တုန်းမြို့နယ်   (unchanged)
--     expected area removed ≈ 1,275,953.158 m² (1.275953 km²)
--
-- Method:
--   new_loser = ST_Multi(ST_CollectionExtract(ST_MakeValid(
--                 ST_Difference(loser.geom, keeper.geom)), 3))
--   keeper.geom unchanged
--   No MIMU polygon replacement. Only shared overlap is subtracted from loser.
--
-- Local backup GPKG:
--   tmp/township-overlap-repair/backups/major_overlap_high_apply_backup_20260724.gpkg
--
-- Hard gates before each UPDATE:
--   * live geom hashes must match the preview snapshot
--   * old_union − new_union < 100 m²
--   * new_union − old_union < 100 m²
--   * remaining pair overlap < 100 m²
--   * third-party township overlap must not increase (>0 m² fails)
--   * only_overlap_removed (no added area; non-overlap part preserved)
--   * new geom valid MultiPolygon SRID 4326
--   * UPDATE touches only geom (+ updated_at if trigger/default fires)
--
-- DO NOT EXECUTE until explicit user approval.
-- File ends with ROLLBACK for safe preview runs.
-- To apply later: replace final ROLLBACK with COMMIT (one pair at a time
-- preferred), after re-checking hashes.

BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '15s';

-- =============================================================================
-- 0) Slim DB backups
-- =============================================================================
CREATE TABLE IF NOT EXISTS system.repair_major_overlap_admin_areas_20260724 (
    id bigint PRIMARY KEY,
    pair_id text NOT NULL,
    role text NOT NULL, -- loser | keeper
    canonical_name text NOT NULL,
    parent_id bigint,
    admin_level_id bigint NOT NULL,
    admin_area_type_id bigint,
    is_active boolean NOT NULL,
    deleted_at timestamptz,
    is_verified boolean,
    verification_status text,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    geom_hash text NOT NULL,
    area_m2 double precision NOT NULL,
    updated_at timestamptz,
    repaired_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system.repair_major_overlap_apply_log_20260724 (
    id bigserial PRIMARY KEY,
    pair_id text NOT NULL,
    loser_id bigint NOT NULL,
    keeper_id bigint NOT NULL,
    area_before_m2 double precision NOT NULL,
    area_after_m2 double precision NOT NULL,
    area_removed_m2 double precision NOT NULL,
    union_old_minus_new_m2 double precision NOT NULL,
    union_new_minus_old_m2 double precision NOT NULL,
    remaining_overlap_m2 double precision NOT NULL,
    third_party_overlap_increase_m2 double precision NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- Snapshot all four affected rows (idempotent on re-run of preview)
INSERT INTO system.repair_major_overlap_admin_areas_20260724 (
    id, pair_id, role, canonical_name, parent_id, admin_level_id, admin_area_type_id,
    is_active, deleted_at, is_verified, verification_status,
    geom, geom_hash, area_m2, updated_at
)
SELECT
    aa.id,
    x.pair_id,
    x.role,
    aa.canonical_name,
    aa.parent_id,
    aa.admin_level_id,
    aa.admin_area_type_id,
    aa.is_active,
    aa.deleted_at,
    aa.is_verified,
    aa.verification_status,
    aa.geom,
    md5(encode(ST_AsEWKB(aa.geom), 'hex')),
    ST_Area(ST_Transform(aa.geom, 6933)),
    aa.updated_at
FROM core.core_admin_areas aa
JOIN (
    VALUES
        (7323::bigint, 'OV-006-7323-7525', 'loser'),
        (7525::bigint, 'OV-006-7323-7525', 'keeper'),
        (7298::bigint, 'OV-007-7298-7524', 'loser'),
        (7524::bigint, 'OV-007-7298-7524', 'keeper')
) AS x(id, pair_id, role) ON x.id = aa.id
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Helper: apply one ASSIGN_FULL_TO_B pair (subtract loser∩keeper from loser)
-- =============================================================================
CREATE OR REPLACE FUNCTION pg_temp.apply_overlap_full_to_keeper(
    p_pair_id text,
    p_loser_id bigint,
    p_keeper_id bigint,
    p_loser_hash text,
    p_keeper_hash text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_loser core.core_admin_areas%ROWTYPE;
    v_keeper core.core_admin_areas%ROWTYPE;
    v_new geometry;
    v_removed geometry;
    v_added geometry;
    v_old_union geometry;
    v_new_union geometry;
    v_remain geometry;
    v_a_only_before geometry;
    v_a_only_lost geometry;
    v_removed_outside_keeper geometry;
    v_hash_loser text;
    v_hash_keeper text;
    v_area_before double precision;
    v_area_after double precision;
    v_area_removed double precision;
    v_old_minus_new double precision;
    v_new_minus_old double precision;
    v_remain_m2 double precision;
    v_tp_before double precision;
    v_tp_after double precision;
    v_tp_increase double precision;
    v_changed_cols int;
BEGIN
    SELECT * INTO v_loser
    FROM core.core_admin_areas
    WHERE id = p_loser_id
    FOR UPDATE;

    SELECT * INTO v_keeper
    FROM core.core_admin_areas
    WHERE id = p_keeper_id
    FOR UPDATE;

    IF v_loser.id IS NULL OR v_keeper.id IS NULL THEN
        RAISE EXCEPTION '%: missing loser/keeper row', p_pair_id;
    END IF;

    IF v_loser.deleted_at IS NOT NULL OR NOT v_loser.is_active
       OR v_keeper.deleted_at IS NOT NULL OR NOT v_keeper.is_active THEN
        RAISE EXCEPTION '%: loser/keeper not active', p_pair_id;
    END IF;

    v_hash_loser := md5(encode(ST_AsEWKB(v_loser.geom), 'hex'));
    v_hash_keeper := md5(encode(ST_AsEWKB(v_keeper.geom), 'hex'));

    IF v_hash_loser IS DISTINCT FROM p_loser_hash
       OR v_hash_keeper IS DISTINCT FROM p_keeper_hash THEN
        RAISE EXCEPTION
            '%: SKIP — live geom hash mismatch (loser % vs %, keeper % vs %)',
            p_pair_id, v_hash_loser, p_loser_hash, v_hash_keeper, p_keeper_hash;
    END IF;

    v_new := ST_Multi(
        ST_CollectionExtract(
            ST_MakeValid(
                ST_Difference(ST_MakeValid(v_loser.geom), ST_MakeValid(v_keeper.geom))
            ),
            3
        )
    );

    IF v_new IS NULL OR ST_IsEmpty(v_new) OR NOT ST_IsValid(v_new)
       OR GeometryType(v_new) <> 'MULTIPOLYGON'
       OR ST_SRID(v_new) <> 4326 THEN
        RAISE EXCEPTION '%: proposed loser geom invalid / empty / wrong type/srid', p_pair_id;
    END IF;

    v_removed := ST_MakeValid(ST_Difference(ST_MakeValid(v_loser.geom), v_new));
    v_added := ST_MakeValid(ST_Difference(v_new, ST_MakeValid(v_loser.geom)));
    v_old_union := ST_MakeValid(ST_Union(ST_MakeValid(v_loser.geom), ST_MakeValid(v_keeper.geom)));
    v_new_union := ST_MakeValid(ST_Union(v_new, ST_MakeValid(v_keeper.geom)));
    v_remain := ST_MakeValid(ST_Intersection(v_new, ST_MakeValid(v_keeper.geom)));

    v_a_only_before := ST_MakeValid(
        ST_Difference(ST_MakeValid(v_loser.geom), ST_MakeValid(v_keeper.geom))
    );
    v_a_only_lost := ST_MakeValid(ST_Difference(v_a_only_before, v_new));
    v_removed_outside_keeper := ST_MakeValid(
        ST_Difference(v_removed, ST_MakeValid(v_keeper.geom))
    );

    v_area_before := ST_Area(ST_Transform(v_loser.geom, 6933));
    v_area_after := ST_Area(ST_Transform(v_new, 6933));
    v_area_removed := ST_Area(ST_Transform(v_removed, 6933));
    v_old_minus_new := ST_Area(ST_Transform(ST_MakeValid(ST_Difference(v_old_union, v_new_union)), 6933));
    v_new_minus_old := ST_Area(ST_Transform(ST_MakeValid(ST_Difference(v_new_union, v_old_union)), 6933));
    v_remain_m2 := COALESCE(ST_Area(ST_Transform(v_remain, 6933)), 0);

    IF v_old_minus_new >= 100 THEN
        RAISE EXCEPTION '%: union loss %.3f m² >= 100', p_pair_id, v_old_minus_new;
    END IF;
    IF v_new_minus_old >= 100 THEN
        RAISE EXCEPTION '%: union gain %.3f m² >= 100', p_pair_id, v_new_minus_old;
    END IF;
    IF v_remain_m2 >= 100 THEN
        RAISE EXCEPTION '%: remaining overlap %.3f m² >= 100', p_pair_id, v_remain_m2;
    END IF;
    IF COALESCE(ST_Area(ST_Transform(v_added, 6933)), 0) >= 1 THEN
        RAISE EXCEPTION '%: new area added %.3f m²', p_pair_id,
            ST_Area(ST_Transform(v_added, 6933));
    END IF;
    IF COALESCE(ST_Area(ST_Transform(v_a_only_lost, 6933)), 0) >= 100 THEN
        RAISE EXCEPTION '%: non-overlap geometry lost %.3f m²', p_pair_id,
            ST_Area(ST_Transform(v_a_only_lost, 6933));
    END IF;
    IF COALESCE(ST_Area(ST_Transform(v_removed_outside_keeper, 6933)), 0) >= 100 THEN
        RAISE EXCEPTION '%: removed area outside original overlap %.3f m²', p_pair_id,
            ST_Area(ST_Transform(v_removed_outside_keeper, 6933));
    END IF;

    SELECT COALESCE(SUM(ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(v_loser.geom, o.geom)), 6933))), 0)
      INTO v_tp_before
    FROM core.core_admin_areas o
    JOIN ref.ref_admin_levels al ON al.id = o.admin_level_id
    WHERE o.deleted_at IS NULL AND o.is_active AND al.code = 'township'
      AND o.id NOT IN (v_loser.id, v_keeper.id)
      AND o.geom && v_loser.geom
      AND ST_Intersects(o.geom, v_loser.geom);

    SELECT COALESCE(SUM(ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(v_new, o.geom)), 6933))), 0)
      INTO v_tp_after
    FROM core.core_admin_areas o
    JOIN ref.ref_admin_levels al ON al.id = o.admin_level_id
    WHERE o.deleted_at IS NULL AND o.is_active AND al.code = 'township'
      AND o.id NOT IN (v_loser.id, v_keeper.id)
      AND o.geom && v_new
      AND ST_Intersects(o.geom, v_new);

    v_tp_increase := GREATEST(v_tp_after - v_tp_before, 0);
    IF v_tp_increase > 0 THEN
        RAISE EXCEPTION '%: third-party overlap increased by %.3f m²', p_pair_id, v_tp_increase;
    END IF;

    UPDATE core.core_admin_areas
    SET geom = v_new,
        updated_at = now()
    WHERE id = p_loser_id
      AND md5(encode(ST_AsEWKB(geom), 'hex')) = p_loser_hash;

    GET DIAGNOSTICS v_changed_cols = ROW_COUNT;
    IF v_changed_cols <> 1 THEN
        RAISE EXCEPTION '%: UPDATE touched % rows (expected 1)', p_pair_id, v_changed_cols;
    END IF;

    -- Keeper must be byte-identical
    IF md5(encode(ST_AsEWKB((SELECT geom FROM core.core_admin_areas WHERE id = p_keeper_id)), 'hex'))
       IS DISTINCT FROM p_keeper_hash THEN
        RAISE EXCEPTION '%: keeper geometry changed unexpectedly', p_pair_id;
    END IF;

    -- Post-update re-check
    IF NOT ST_IsValid((SELECT geom FROM core.core_admin_areas WHERE id = p_loser_id)) THEN
        RAISE EXCEPTION '%: post-update loser geom invalid', p_pair_id;
    END IF;

    INSERT INTO system.repair_major_overlap_apply_log_20260724 (
        pair_id, loser_id, keeper_id,
        area_before_m2, area_after_m2, area_removed_m2,
        union_old_minus_new_m2, union_new_minus_old_m2,
        remaining_overlap_m2, third_party_overlap_increase_m2
    ) VALUES (
        p_pair_id, p_loser_id, p_keeper_id,
        v_area_before, v_area_after, v_area_removed,
        v_old_minus_new, v_new_minus_old,
        v_remain_m2, v_tp_increase
    );

    RAISE NOTICE '% applied: loser=% removed_m2=%.3f remain_m2=%.3f unionΔ=(%.3f,%.3f)',
        p_pair_id, p_loser_id, v_area_removed, v_remain_m2, v_old_minus_new, v_new_minus_old;
END;
$$;

-- =============================================================================
-- 1) Small transaction unit A — OV-006
-- =============================================================================
SELECT pg_temp.apply_overlap_full_to_keeper(
    'OV-006-7323-7525',
    7323,
    7525,
    'e47ab0b7a5240f3ee9e28da7e03adfdc',
    'b11a7adf700ef18ce79e5d8ee1e2ccb4'
);

-- =============================================================================
-- 2) Small transaction unit B — OV-007
-- =============================================================================
SELECT pg_temp.apply_overlap_full_to_keeper(
    'OV-007-7298-7524',
    7298,
    7524,
    'd1c97212d1526aef73bf1c538d07cad2',
    '69e300905e700c8f29ce3e4eb9b66a63'
);

-- =============================================================================
-- 3) Post-apply verification (same session, still uncommitted)
-- =============================================================================
-- Confirm only geom (+ updated_at) differ vs backup for losers; keepers identical.
WITH backup AS (
    SELECT * FROM system.repair_major_overlap_admin_areas_20260724
    WHERE id IN (7323, 7525, 7298, 7524)
),
live AS (
    SELECT aa.*
    FROM core.core_admin_areas aa
    WHERE aa.id IN (7323, 7525, 7298, 7524)
)
SELECT
    l.id,
    b.role,
    b.pair_id,
    (l.canonical_name IS NOT DISTINCT FROM b.canonical_name) AS name_same,
    (l.parent_id IS NOT DISTINCT FROM b.parent_id) AS parent_same,
    (l.admin_level_id IS NOT DISTINCT FROM b.admin_level_id) AS level_same,
    (l.admin_area_type_id IS NOT DISTINCT FROM b.admin_area_type_id) AS type_same,
    (l.is_active IS NOT DISTINCT FROM b.is_active) AS active_same,
    (l.deleted_at IS NOT DISTINCT FROM b.deleted_at) AS deleted_same,
    (l.is_verified IS NOT DISTINCT FROM b.is_verified) AS verified_same,
    (l.verification_status IS NOT DISTINCT FROM b.verification_status) AS ver_status_same,
    (md5(encode(ST_AsEWKB(l.geom),'hex')) IS DISTINCT FROM b.geom_hash) AS geom_changed,
    round((ST_Area(ST_Transform(ST_MakeValid(ST_Difference(b.geom, l.geom)), 6933)))::numeric, 3)
        AS removed_vs_backup_m2
FROM live l
JOIN backup b ON b.id = l.id
ORDER BY l.id;

SELECT * FROM system.repair_major_overlap_apply_log_20260724
ORDER BY id;

-- Preview safety: do not commit.
ROLLBACK;

-- =============================================================================
-- APPLY INSTRUCTIONS (after approval)
-- =============================================================================
-- 1. Re-run hash check against live.
-- 2. Change the final ROLLBACK above to COMMIT, OR run each
--    pg_temp.apply_overlap_full_to_keeper(...) in its own BEGIN/COMMIT.
-- 3. Prefer two separate commits (one per pair) for smaller blast radius.
-- 4. Re-audit operational overlaps after apply.
