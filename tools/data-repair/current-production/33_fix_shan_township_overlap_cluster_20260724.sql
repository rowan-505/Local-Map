-- Shan township overlap-cluster repair (APPLY)
-- Project: locghyuranqaqsnbxflc
-- Date: 2026-07-24
-- Source: tmp/township-overlap-repair/shan-cluster-repair-plan.csv
-- Local backup: tmp/township-overlap-repair/backups/shan-cluster-before-repair.gpkg
--
-- Affected IDs only: 6445, 6467, 6468, 6523, 6560
--
-- Plan (HIGH):
--   OV-SHAN-001  6468 × 6560  → keep 6560; remove overlap from 6468
--   OV-SHAN-002  6468 × 6523  → keep 6523; remove overlap from 6468
--   OV-SHAN-003  6467 × 6468  → keep 6467; remove overlap from 6468
--   OV-SHAN-004  6445 × 6467  → keep 6467; remove overlap from 6445
--
-- Method:
--   6468' = ST_Difference(6468, ST_Union(6560, 6523, 6467))
--   6445' = ST_Difference(6445, 6467)
--   keepers unchanged
--
-- Single transaction. Rolls back on any validation failure.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '30s';

-- =============================================================================
-- 0) Slim DB backup of the five rows
-- =============================================================================
CREATE TABLE IF NOT EXISTS system.repair_shan_cluster_admin_areas_20260724 (
    id bigint PRIMARY KEY,
    role text NOT NULL,
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

CREATE TABLE IF NOT EXISTS system.repair_shan_cluster_apply_log_20260724 (
    id bigserial PRIMARY KEY,
    loser_id bigint NOT NULL,
    area_before_m2 double precision NOT NULL,
    area_after_m2 double precision NOT NULL,
    area_removed_m2 double precision NOT NULL,
    five_union_old_minus_new_m2 double precision NOT NULL,
    five_union_new_minus_old_m2 double precision NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system.repair_shan_cluster_admin_areas_20260724 (
    id, role, canonical_name, parent_id, admin_level_id, admin_area_type_id,
    is_active, deleted_at, is_verified, verification_status,
    geom, geom_hash, area_m2, updated_at
)
SELECT
    aa.id,
    CASE WHEN aa.id IN (6445, 6468) THEN 'loser' ELSE 'keeper' END,
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
WHERE aa.id IN (6445, 6467, 6468, 6523, 6560)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 1) Lock rows + preflight hash match vs preview
-- =============================================================================
DO $$
DECLARE
    r record;
    v_hash text;
    expected constant text[][] := ARRAY[
        ARRAY['6445', '56ab41435d8a93011d542bcb0767ec25'],
        ARRAY['6467', 'ed1d347273223e4fa6fb49dd6d00b333'],
        ARRAY['6468', 'b2cf58a71a0327a9ae78a11f65b58b63'],
        ARRAY['6523', '9517d9be0e22ee369897c3a406542bba'],
        ARRAY['6560', '726322795aaa1d7f7979c9cc7ad1625c']
    ];
    i int;
BEGIN
    FOR i IN 1..array_length(expected, 1) LOOP
        SELECT md5(encode(ST_AsEWKB(geom), 'hex')) INTO v_hash
        FROM core.core_admin_areas
        WHERE id = expected[i][1]::bigint
        FOR UPDATE;

        IF v_hash IS DISTINCT FROM expected[i][2] THEN
            RAISE EXCEPTION
                'Shan cluster SKIP: id % live hash % != preview %',
                expected[i][1], v_hash, expected[i][2];
        END IF;
    END LOOP;
END $$;

-- =============================================================================
-- 2) Apply subtractive updates (overlap only)
-- =============================================================================
DO $$
DECLARE
    v_6445 geometry;
    v_6467 geometry;
    v_6468 geometry;
    v_6523 geometry;
    v_6560 geometry;
    v_6468_new geometry;
    v_6445_new geometry;
    v_old_union geometry;
    v_new_union geometry;
    v_gap_m2 double precision;
    v_add_m2 double precision;
    v_before_6468 double precision;
    v_after_6468 double precision;
    v_before_6445 double precision;
    v_after_6445 double precision;
    v_removed_outside double precision;
    v_a_only_lost double precision;
    v_tp_before double precision;
    v_tp_after double precision;
    v_pair_remain double precision;
    v_keeper_hash text;
    pair record;
BEGIN
    SELECT geom INTO v_6445 FROM core.core_admin_areas WHERE id = 6445;
    SELECT geom INTO v_6467 FROM core.core_admin_areas WHERE id = 6467;
    SELECT geom INTO v_6468 FROM core.core_admin_areas WHERE id = 6468;
    SELECT geom INTO v_6523 FROM core.core_admin_areas WHERE id = 6523;
    SELECT geom INTO v_6560 FROM core.core_admin_areas WHERE id = 6560;

    v_before_6468 := ST_Area(ST_Transform(v_6468, 6933));
    v_before_6445 := ST_Area(ST_Transform(v_6445, 6933));

    -- 6468 loses overlaps with 6560, 6523, 6467 only
    v_6468_new := ST_Multi(
        ST_CollectionExtract(
            ST_MakeValid(
                ST_Difference(
                    ST_MakeValid(v_6468),
                    ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[
                        ST_MakeValid(v_6560),
                        ST_MakeValid(v_6523),
                        ST_MakeValid(v_6467)
                    ])))
                )
            ),
            3
        )
    );

    -- 6445 loses overlap with 6467 only
    v_6445_new := ST_Multi(
        ST_CollectionExtract(
            ST_MakeValid(
                ST_Difference(ST_MakeValid(v_6445), ST_MakeValid(v_6467))
            ),
            3
        )
    );

    IF v_6468_new IS NULL OR ST_IsEmpty(v_6468_new) OR NOT ST_IsValid(v_6468_new)
       OR GeometryType(v_6468_new) <> 'MULTIPOLYGON' OR ST_SRID(v_6468_new) <> 4326 THEN
        RAISE EXCEPTION 'proposed 6468 geom invalid';
    END IF;
    IF v_6445_new IS NULL OR ST_IsEmpty(v_6445_new) OR NOT ST_IsValid(v_6445_new)
       OR GeometryType(v_6445_new) <> 'MULTIPOLYGON' OR ST_SRID(v_6445_new) <> 4326 THEN
        RAISE EXCEPTION 'proposed 6445 geom invalid';
    END IF;

    -- Removed area must lie inside original overlaps with keepers
    v_removed_outside := ST_Area(ST_Transform(
        ST_MakeValid(ST_Difference(
            ST_MakeValid(ST_Difference(v_6468, v_6468_new)),
            ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[v_6560, v_6523, v_6467])))
        )),
        6933
    ));
    IF v_removed_outside >= 1 THEN
        RAISE EXCEPTION '6468 removed area outside overlaps: %.3f m²', v_removed_outside;
    END IF;

    v_removed_outside := ST_Area(ST_Transform(
        ST_MakeValid(ST_Difference(
            ST_MakeValid(ST_Difference(v_6445, v_6445_new)),
            ST_MakeValid(v_6467)
        )),
        6933
    ));
    IF v_removed_outside >= 1 THEN
        RAISE EXCEPTION '6445 removed area outside overlap: %.3f m²', v_removed_outside;
    END IF;

    -- Non-overlap parts preserved
    v_a_only_lost := ST_Area(ST_Transform(
        ST_MakeValid(ST_Difference(
            ST_MakeValid(ST_Difference(
                v_6468,
                ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[v_6560, v_6523, v_6467])))
            )),
            v_6468_new
        )),
        6933
    ));
    IF v_a_only_lost >= 1 THEN
        RAISE EXCEPTION '6468 non-overlap lost %.3f m²', v_a_only_lost;
    END IF;

    v_a_only_lost := ST_Area(ST_Transform(
        ST_MakeValid(ST_Difference(
            ST_MakeValid(ST_Difference(v_6445, v_6467)),
            v_6445_new
        )),
        6933
    ));
    IF v_a_only_lost >= 1 THEN
        RAISE EXCEPTION '6445 non-overlap lost %.3f m²', v_a_only_lost;
    END IF;

    -- Five-union invariance (<= 1 m²)
    v_old_union := ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[v_6445, v_6467, v_6468, v_6523, v_6560])));
    v_new_union := ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[v_6445_new, v_6467, v_6468_new, v_6523, v_6560])));
    v_gap_m2 := ST_Area(ST_Transform(ST_MakeValid(ST_Difference(v_old_union, v_new_union)), 6933));
    v_add_m2 := ST_Area(ST_Transform(ST_MakeValid(ST_Difference(v_new_union, v_old_union)), 6933));
    IF v_gap_m2 > 1 OR v_add_m2 > 1 THEN
        RAISE EXCEPTION 'five-union Δ fail gap=%.3f add=%.3f', v_gap_m2, v_add_m2;
    END IF;

    -- No new area on losers
    IF ST_Area(ST_Transform(ST_MakeValid(ST_Difference(v_6468_new, v_6468)), 6933)) >= 1 THEN
        RAISE EXCEPTION '6468 gained area';
    END IF;
    IF ST_Area(ST_Transform(ST_MakeValid(ST_Difference(v_6445_new, v_6445)), 6933)) >= 1 THEN
        RAISE EXCEPTION '6445 gained area';
    END IF;

    -- Third-party overlap must not increase for losers
    SELECT COALESCE(SUM(ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(v_6468, o.geom)), 6933))), 0)
      INTO v_tp_before
    FROM core.core_admin_areas o
    JOIN ref.ref_admin_levels al ON al.id = o.admin_level_id
    WHERE o.deleted_at IS NULL AND o.is_active AND al.code = 'township'
      AND o.id NOT IN (6445, 6467, 6468, 6523, 6560)
      AND o.geom && v_6468 AND ST_Intersects(o.geom, v_6468);

    SELECT COALESCE(SUM(ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(v_6468_new, o.geom)), 6933))), 0)
      INTO v_tp_after
    FROM core.core_admin_areas o
    JOIN ref.ref_admin_levels al ON al.id = o.admin_level_id
    WHERE o.deleted_at IS NULL AND o.is_active AND al.code = 'township'
      AND o.id NOT IN (6445, 6467, 6468, 6523, 6560)
      AND o.geom && v_6468_new AND ST_Intersects(o.geom, v_6468_new);

    IF v_tp_after > v_tp_before + 1 THEN
        RAISE EXCEPTION '6468 third-party overlap increased by %.3f m²', v_tp_after - v_tp_before;
    END IF;

    SELECT COALESCE(SUM(ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(v_6445, o.geom)), 6933))), 0)
      INTO v_tp_before
    FROM core.core_admin_areas o
    JOIN ref.ref_admin_levels al ON al.id = o.admin_level_id
    WHERE o.deleted_at IS NULL AND o.is_active AND al.code = 'township'
      AND o.id NOT IN (6445, 6467, 6468, 6523, 6560)
      AND o.geom && v_6445 AND ST_Intersects(o.geom, v_6445);

    SELECT COALESCE(SUM(ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(v_6445_new, o.geom)), 6933))), 0)
      INTO v_tp_after
    FROM core.core_admin_areas o
    JOIN ref.ref_admin_levels al ON al.id = o.admin_level_id
    WHERE o.deleted_at IS NULL AND o.is_active AND al.code = 'township'
      AND o.id NOT IN (6445, 6467, 6468, 6523, 6560)
      AND o.geom && v_6445_new AND ST_Intersects(o.geom, v_6445_new);

    IF v_tp_after > v_tp_before + 1 THEN
        RAISE EXCEPTION '6445 third-party overlap increased by %.3f m²', v_tp_after - v_tp_before;
    END IF;

    -- Apply
    UPDATE core.core_admin_areas
    SET geom = v_6468_new, updated_at = now()
    WHERE id = 6468
      AND md5(encode(ST_AsEWKB(geom), 'hex')) = 'b2cf58a71a0327a9ae78a11f65b58b63';
    IF NOT FOUND THEN
        RAISE EXCEPTION '6468 UPDATE failed hash gate';
    END IF;

    UPDATE core.core_admin_areas
    SET geom = v_6445_new, updated_at = now()
    WHERE id = 6445
      AND md5(encode(ST_AsEWKB(geom), 'hex')) = '56ab41435d8a93011d542bcb0767ec25';
    IF NOT FOUND THEN
        RAISE EXCEPTION '6445 UPDATE failed hash gate';
    END IF;

    -- Keepers unchanged
    IF md5(encode(ST_AsEWKB((SELECT geom FROM core.core_admin_areas WHERE id = 6467)), 'hex'))
       IS DISTINCT FROM 'ed1d347273223e4fa6fb49dd6d00b333' THEN
        RAISE EXCEPTION 'keeper 6467 changed';
    END IF;
    IF md5(encode(ST_AsEWKB((SELECT geom FROM core.core_admin_areas WHERE id = 6523)), 'hex'))
       IS DISTINCT FROM '9517d9be0e22ee369897c3a406542bba' THEN
        RAISE EXCEPTION 'keeper 6523 changed';
    END IF;
    IF md5(encode(ST_AsEWKB((SELECT geom FROM core.core_admin_areas WHERE id = 6560)), 'hex'))
       IS DISTINCT FROM '726322795aaa1d7f7979c9cc7ad1625c' THEN
        RAISE EXCEPTION 'keeper 6560 changed';
    END IF;

    -- Targeted pair overlaps <= 100 m²
    FOR pair IN
        SELECT * FROM (VALUES
            (6468::bigint, 6560::bigint),
            (6468, 6523),
            (6467, 6468),
            (6445, 6467)
        ) AS v(id_a, id_b)
    LOOP
        SELECT COALESCE(ST_Area(ST_Transform(
            ST_MakeValid(ST_Intersection(a.geom, b.geom)), 6933)), 0)
          INTO v_pair_remain
        FROM core.core_admin_areas a, core.core_admin_areas b
        WHERE a.id = pair.id_a AND b.id = pair.id_b;

        IF v_pair_remain > 100 THEN
            RAISE EXCEPTION 'pair %×% remaining overlap %.3f m² > 100',
                pair.id_a, pair.id_b, v_pair_remain;
        END IF;
    END LOOP;

    -- Non-geom fields unchanged vs backup
    IF EXISTS (
        SELECT 1
        FROM core.core_admin_areas l
        JOIN system.repair_shan_cluster_admin_areas_20260724 b ON b.id = l.id
        WHERE l.id IN (6445, 6467, 6468, 6523, 6560)
          AND (
            l.canonical_name IS DISTINCT FROM b.canonical_name
            OR l.parent_id IS DISTINCT FROM b.parent_id
            OR l.admin_level_id IS DISTINCT FROM b.admin_level_id
            OR l.admin_area_type_id IS DISTINCT FROM b.admin_area_type_id
            OR l.is_active IS DISTINCT FROM b.is_active
            OR l.deleted_at IS DISTINCT FROM b.deleted_at
            OR l.is_verified IS DISTINCT FROM b.is_verified
            OR l.verification_status IS DISTINCT FROM b.verification_status
          )
    ) THEN
        RAISE EXCEPTION 'forbidden non-geom column change detected';
    END IF;

    v_after_6468 := ST_Area(ST_Transform((SELECT geom FROM core.core_admin_areas WHERE id = 6468), 6933));
    v_after_6445 := ST_Area(ST_Transform((SELECT geom FROM core.core_admin_areas WHERE id = 6445), 6933));

    INSERT INTO system.repair_shan_cluster_apply_log_20260724 (
        loser_id, area_before_m2, area_after_m2, area_removed_m2,
        five_union_old_minus_new_m2, five_union_new_minus_old_m2
    ) VALUES
        (6468, v_before_6468, v_after_6468, v_before_6468 - v_after_6468, v_gap_m2, v_add_m2),
        (6445, v_before_6445, v_after_6445, v_before_6445 - v_after_6445, v_gap_m2, v_add_m2);

    RAISE NOTICE 'Shan cluster OK: 6468 removed=%.3f m² 6445 removed=%.3f m² unionΔ=(%.3f,%.3f)',
        v_before_6468 - v_after_6468, v_before_6445 - v_after_6445, v_gap_m2, v_add_m2;
END $$;

-- =============================================================================
-- 3) Post-apply report (same transaction)
-- =============================================================================
SELECT loser_id,
       round((area_before_m2/1e6)::numeric, 6) AS before_km2,
       round((area_after_m2/1e6)::numeric, 6) AS after_km2,
       round(area_removed_m2::numeric, 3) AS removed_m2,
       round((area_removed_m2/1e6)::numeric, 6) AS removed_km2,
       round(five_union_old_minus_new_m2::numeric, 3) AS union_gap_m2,
       round(five_union_new_minus_old_m2::numeric, 3) AS union_add_m2,
       applied_at
FROM system.repair_shan_cluster_apply_log_20260724
ORDER BY id;

SELECT * FROM (VALUES
    (6468::bigint, 6560::bigint),
    (6468, 6523),
    (6467, 6468),
    (6445, 6467)
) AS p(id_a, id_b)
CROSS JOIN LATERAL (
    SELECT round(COALESCE(ST_Area(ST_Transform(
        ST_MakeValid(ST_Intersection(a.geom, b.geom)), 6933)), 0)::numeric, 3) AS remain_m2,
           ST_IsValid(a.geom) AS a_valid,
           ST_IsValid(b.geom) AS b_valid
    FROM core.core_admin_areas a, core.core_admin_areas b
    WHERE a.id = p.id_a AND b.id = p.id_b
) x;

SELECT aa.id,
       aa.canonical_name,
       round((ST_Area(ST_Transform(aa.geom,6933))/1e6)::numeric,6) AS area_km2,
       ST_IsValid(aa.geom) AS valid,
       GeometryType(aa.geom) AS gtype,
       ST_SRID(aa.geom) AS srid,
       md5(encode(ST_AsEWKB(aa.geom),'hex')) AS geom_hash,
       (md5(encode(ST_AsEWKB(aa.geom),'hex')) IS DISTINCT FROM b.geom_hash) AS geom_changed
FROM core.core_admin_areas aa
JOIN system.repair_shan_cluster_admin_areas_20260724 b ON b.id = aa.id
WHERE aa.id IN (6445,6467,6468,6523,6560)
ORDER BY aa.id;

COMMIT;
