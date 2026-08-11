# Yangon real-apply verification matrix — 2026-07-23

> Historical production-pilot evidence. The loader/preload commands and paths
> recorded below are retired and must not be rerun.

## Overall

Controlled production pilot on project `locghyuranqaqsnbxflc` for every implemented safe-loader family.  
Independent family transactions. **National import was not started.**

Live core after pilot (production):

| Table | Live count |
|-------|----------:|
| `core.core_places` | 11213 |
| `core.core_map_buildings` | 1125 |
| `core.core_map_landuse` | 57 |
| `core.core_map_water_lines` | 2 |
| `core.core_map_water_polygons` | 12 |
| `core.core_streets` | 823006 |
| `routing.routing_barriers` | 15 |

This session (2026-07-23 ~02:07–02:12Z) re-verified identical-batch skip paths after re-preload where work rows had been cleaned. Original controlled applies were completed earlier the same day (family reports under `tools/data-pipeline/import-work/reports/`).

Prod-mirror full refresh was started for this matrix but did not finish within the session window (FDW refresh long-running). Classification for these pilots already used an existing local mirror; re-verify mirror age before the next classify cycle.

---

## Matrix

| # | Family | Scope used | Apply batch | Core delta (apply) | Identical rerun | Conflicts → IR | Safe/invalid/PMTiles in IR? | Duration (apply) | Cleanup | Verdict |
|---|--------|------------|-------------|-------------------:|-----------------|----------------|------------------------------|------------------|---------|---------|
| 1 | Settlements | Yangon City snap **9** | `places_yangon_settlements_safe_2026_07_23` (id **10**) | **+1463** places | skip 20/20 sample dry-run (this session); prior full identical skip | **11** → `remote_review_settlement_conflicts_yangon_city_2026_07_23` | No `pmtiles_only` / `invalid` in IR package | prior apply logged | work retained `applied` | **READY** |
| 2 | Essential places | Yangon City snap **9** (admin-mapped) | `places_yangon_essential_safe_2026_07_23` (id **11**) | **+9407** places | skip 20/20 sample dry-run (this session) | **273** → `remote_review_essential_place_conflicts_yangon_city_2026_07_23` | No `pmtiles_only` / `invalid` in IR package | prior apply logged | work retained `applied` | **READY** |
| 3 | Important/named buildings | Downtown snap **10** (50 named) | `buildings_yangon_downtown_safe_2026_07_23` (id **52**) | **1075 → 1125 (+50)** | skip **50/50** dry-run after re-preload | 0 in loader path (all `safe_new`) | N/A (no IR upload) | apply ~14 ms | cleaned | **READY WITH LIMITATIONS** |
| 4 | Named landuse | Downtown snap **10** (19 `safe_new`) | `landuse_yangon_downtown_safe_2026_07_23` (id **73**) | **38 → 57 (+19)** | skip **19/19** | 0 loader IR | N/A | apply logged | cleaned | **READY WITH LIMITATIONS** |
| 5 | Named water lines | Downtown snap **10** (1 river) | `water_lines_yangon_downtown_safe_2026_07_23` (id **75**) | **1 → 2 (+1)** | skip **1/1** | 0 loader IR | N/A | apply logged | cleaned | **READY WITH LIMITATIONS** |
| 6 | Named water polygons | Yangon downtown **0** eligible; prove-out Kyauktan snap **4** (3) | `water_polygons_kyauktan_safe_2026_07_23` (id **77**) | **9 → 12 (+3)** | skip **3/3** | 0 loader IR | N/A | apply logged | cleaned | **READY WITH LIMITATIONS** |
| 7 | Routing barriers | No Yangon downtown/city sample; Kyauktan snap **4** (15) | `routing_barriers_kyauktan_safe_2026_07_23` (id **85**) | **0 → 15** | skip **15/15** | 0 loader IR | N/A | apply logged; **Valhalla not rebuilt** | cleaned | **READY WITH LIMITATIONS** |
| 8 | Roads (last) | F2 5k gate PASS; 500 dry-run; **5** allowlist surface apply | `roads_yangon_allowlist_probe_5_2026_07_23` (id **92**) | 5 surface updates (no row-count growth) | skip **5/5** dry-run (this session); prior apply identical skip | 0 on probe | N/A | apply ~10 ms; 500 dry-run ~1.4 s | batch `applied` | **READY WITH LIMITATIONS** |

No family is **BLOCKED** for its scoped pilot path. Limitations are sample/geography scope, not loader failure.

---

## Per-family notes

### 1) Settlements — READY

- Classify + eligibility already produced 1463 `safe_new` load-ready and 11 conflicts.
- Production apply committed; live places include this load.
- This session: dry-run `--sample-limit 20` → **skipped=20**, core 11213→11213, ROLLBACK.
- IR package status `reviewing`, 11 uploaded candidates; spot check found **0** `pmtiles_only` / `invalid` class tags on candidates.

### 2) Essential places — READY

- 9407 load-ready with township/admin mapping; 273 conflicts uploaded.
- This session: dry-run sample 20 → all skip, no core growth.
- Same IR hygiene check as settlements on the essential conflict package.

### 3) Buildings — READY WITH LIMITATIONS

- Limitation: downtown named sample (50), not full Yangon City footprints.
- Apply + identical rerun proven; this session re-preload + dry-run skip 50/50 (~10 ms).
- Policy: important/named only; `pmtiles_only` never entered `import_work`.

### 4) Landuse — READY WITH LIMITATIONS

- Limitation: 19 named downtown `safe_new` (7 downtown rows were `pmtiles_only` and stayed out of work/core).
- Identical skip 19/19 re-verified this session.

### 5) Water lines — READY WITH LIMITATIONS

- Limitation: single named downtown waterway.
- Identical skip 1/1 re-verified.

### 6) Water polygons — READY WITH LIMITATIONS

- Yangon downtown named filter → **0** eligible rows (empty is acceptable).
- Loader path proven on Kyauktan 3 reservoirs; identical skip 3/3 re-verified.
- Do not treat Kyauktan prove-out as Yangon City coverage.

### 7) Routing barriers — READY WITH LIMITATIONS

- No Yangon city/downtown staging classify sample was available for this matrix.
- Kyauktan 15-barrier path applied earlier; identical skip 15/15 re-verified.
- Valhalla rebuild intentionally **not** run.

### 8) Roads — READY WITH LIMITATIONS

- F2 precondition after synthetic-name + class-code fingerprint fix: **5000/5000 unchanged**.
- 500-row production dry-run planned updates then ROLLBACK.
- Controlled apply: 5-road surface allowlist probe (batch 92); identical rerun skip.
- Limitation: not a bulk Yangon road load; geom/name/class meaning changes stay on conflict/IR path.
- This session dry-run: skipped=5, conflict_ir=0, core delta 0.

---

## Checklist coverage (all families)

| Step | Done? |
|------|-------|
| 1 Refresh production mirror | Attempted; full refresh did not finish in-session (see Overall) |
| 2 Normalize / validate | Prior pipeline stages for each sample |
| 3 Core eligibility filter | Enforced in classify + preload |
| 4 Classify | Prior family samples / city runs |
| 5 Reconcile counts | Batch expected/loaded matched at apply |
| 6 Load typed `import_work` | Preload scripts |
| 7 Production dry-run | Yes (original + this session re-verify) |
| 8 Review expected actions | Metrics / plan notices reviewed |
| 9 Controlled apply | Yes (scoped batches only) |
| 10 Verify core state | Live counts match apply deltas |
| 11 Identical batch rerun | Skip / zero growth |
| 12 Zero duplicate / unnecessary update | Confirmed on reruns |
| 13 Upload conflicts only | Places IR packages; other families had 0 conflicts in sample |
| 14 No safe/invalid/PMTiles-only in IR | Conflict packages checked for pmtiles/invalid |
| 15 Record duration | See matrix + family reports |
| 16 Clean completed work rows | Cleaned for sample families; places batches still `applied` with rows retained |

---

## Evidence index

| Family | Primary report |
|--------|----------------|
| Settlements / essential | `tools/data-pipeline/local-osm/reports/yangon_production_pilot_2026-07-23.md` |
| Buildings | `tools/data-pipeline/import-work/reports/buildings_yangon_safe_loader_2026-07-23.md` |
| Landuse | `tools/data-pipeline/import-work/reports/landuse_yangon_safe_loader_2026-07-23.md` |
| Water lines | `tools/data-pipeline/import-work/reports/water_lines_yangon_safe_loader_2026-07-23.md` |
| Water polygons | `tools/data-pipeline/import-work/reports/water_polygons_yangon_safe_loader_2026-07-23.md` |
| Routing barriers | `tools/data-pipeline/import-work/reports/routing_barriers_kyauktan_safe_loader_2026-07-23.md` |
| Roads | `tools/data-pipeline/import-work/reports/roads_yangon_safe_loader_2026-07-23.md` |
| Admin assignment | `tools/data-pipeline/local-osm/reports/yangon_admin_assignment_2026-07-23.md` |

This-session dry-run logs: `tools/data-pipeline/import-work/reports/*_20260723T020*.log`

---

## Explicit non-goals

- National OSM import
- Full Yangon City buildings / landuse / water / roads bulk apply
- Valhalla rebuild after barrier load
- Automatic continue across family failure (not required; no family blocked)

---

## Next safe steps (optional)

1. Finish / schedule a clean `prod-mirror` refresh and record age.
2. Classify a Yangon-scoped routing-barrier + water-polygon sample if those families must be Yangon-native before wider load.
3. Expand roads only with allowlisted fields and capped batches after another F2 gate on the next extract.
4. Keep places conflict IR packages in human review; do not bulk-promote conflicts.
