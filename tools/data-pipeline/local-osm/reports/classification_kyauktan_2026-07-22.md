# Classification dry-run — Kyauktan (2026-07-22)

Snapshot: `osm_myanmar_2026_05_15_kyauktan_v2` (id=4)  
Scope: local PostGIS only. **No Supabase / production writes.**

Stages run: F2 Stage 07 (per family) → Stage 08b → Stage 18.

Rules / thresholds: [`docs/osm-pipeline-import-classification.md`](../../../docs/osm-pipeline-import-classification.md)

## Family report

| family | valid | safe_new | safe_update | unchanged | duplicate | conflict | manual_protected | verified_conflict | possible_delete | invalid |
|--------|------:|---------:|------------:|----------:|----------:|---------:|-----------------:|------------------:|----------------:|--------:|
| admin_areas | 14 | 0 | 0 | 0 | 2 | 1 | 11 | 0 | 0 | 0 |
| buildings | 1402 | 379 | 953 | 0 | 70 | 0 | 0 | 0 | 0 | 0 |
| landuse | 59 | 18 | 30 | 0 | 11 | 0 | 0 | 0 | 0 | 0 |
| places | 117 | 62 | 21 | 0 | 11 | 0 | 23 | 0 | 0 | 0 |
| roads | 1400 | 0 | 1400 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| routing_barriers | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| water_lines | 26 | 22 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| water_polygons | 14 | 3 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **3047** | **499** | **2404** | **0** | **109** | **1** | **34** | **0** | **0** | **0** |

## Reconciliation

```text
valid (3047)
  = safe_new (499)
  + safe_update (2404)
  + unchanged (0)
  + duplicate (109)
  + conflict (1)
  + manual_protected (34)
  + verified_conflict (0)
```

Stage 18 assertion: **PASS**

## Notes

- Identity matching works for roads: all 1400 Kyauktan road candidates are identity-matched OSM-derived `safe_update` against `prod_mirror.core_streets` (legacy `osm:W:` keys).
- `unchanged = 0` for this run because Stage 07 F2 `changed` compares broad staging vs slim-mirror JSON shapes, so almost every identity hit looks “changed”. Next harden: prefer `source_content_hash` / allow-listed field diffs for F2 `changed`.
- `possible_delete = 0`: no F1 OSM-derived `deleted_candidate` rows for this snapshot pair (or no prior snapshot F1 run in scope).
- Stage 07 buildings needed ~6 minutes; statement timeout raised to 30 minutes. Prefer per-family Stage 07 reruns when debugging.
- Admin `manual_protected=11` matches F2 `protect_manual` after protection was ordered before duplicate.

## Artifacts

- `reports/stage07_*_kyauktan.log`
- `reports/stage08b_kyauktan.log`
- `reports/stage18_kyauktan.log`
