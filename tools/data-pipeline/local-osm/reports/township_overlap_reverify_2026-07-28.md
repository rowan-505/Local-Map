# Township overlap re-verification — 2026-07-28

**Project:** `locghyuranqaqsnbxflc` (Map Project)  
**Mode:** read-only Supabase inspection  
**Supersedes:** `tmp/township-overlap-repair/reports/final-verification-20260724.md` (status was **INCOMPLETE**)

## Final status: **FIXED**

Operational township covering is clean enough for national Stage 08c production township assign.

| Metric | 2026-07-24 report | 2026-07-28 live |
|---|---:|---:|
| Operational townships | 364 | **364** |
| Pairs with overlap area > 100 m² | 24 | **0** |
| Pairs with overlap area > 0.1 km² | 7 | **0** |
| Max interior-ish overlap | ~16.23 km² | **≈ 0.000015 km²** (sliver only) |
| Non-touch intersect pairs (any area) | — | 86 (all below 100 m²) |

## Interpretation

- Migration **146** operational set (364) remains the assign target.
- Residual non-touch intersects are boundary slivers only; exact-one `ST_Covers` still returns NULL on true multi-cover, which is correct.
- No further geometry rewrite is required before Stage 08c national dry-run assign.

## Re-run SQL (read-only)

```sql
WITH ops AS (
  SELECT aa.id, aa.geom
  FROM core.core_admin_areas aa
  JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
  WHERE aa.deleted_at IS NULL AND aa.is_active
    AND core.admin_area_is_operational_township(aa.id, al.code)
), pairs AS (
  SELECT a.id AS id_a, b.id AS id_b,
    ST_Area(geography(ST_MakeValid(ST_Intersection(a.geom, b.geom)))) / 1e6 AS overlap_km2
  FROM ops a
  JOIN ops b ON a.id < b.id
    AND a.geom && b.geom
    AND ST_Intersects(a.geom, b.geom)
    AND NOT ST_Touches(a.geom, b.geom)
)
SELECT (SELECT count(*) FROM ops) AS ops_townships,
  (SELECT count(*) FROM pairs) AS non_touch_pairs,
  (SELECT count(*) FROM pairs WHERE overlap_km2 > 0.0001) AS pairs_gt_100m2,
  (SELECT count(*) FROM pairs WHERE overlap_km2 > 0.1) AS pairs_gt_0_1_km2,
  (SELECT round(coalesce(max(overlap_km2),0)::numeric, 6) FROM pairs) AS max_km2;
```
