# Settlements rural township pilot — 2026-07-23

**Township:** Kyauktan (`MM-KYAUKTAN`) — rural character (villages, tracks, agricultural surroundings, water); manageable volume.  
**Snapshot:** `osm_myanmar_2026_05_15_kyauktan_v2` (local raw snapshot id **4**; no national import; no re-PBF).  
**Env:** `tools/data-pipeline/local-osm/imports/kyauktan_settlements_rural_pilot_2026_07_23.env`  
**Destination:** `core.core_places` + settlement categories; conflicts → `import_review.place_candidates`

## Verdict

**PASS** for the rural settlements pilot scope.

- Settlement extraction added (no duplicate of an existing settlement extractor — Stage 05 was POI-only before).
- Same snapshot classified twice → **identical fingerprint**.
- **77** settlement `safe_new` rows loaded via `import_work` → core.
- **3** settlement conflicts uploaded to Import Review (batch **7**).
- No safe / invalid rows in that IR batch; no duplicate active core external identities; all loaded settlements have admin; protected matches not auto-written.

Previous-snapshot deletion handling: **not added** (no second raw snapshot).

---

## 1. What was missing (inspection)

| Check | Result |
|-------|--------|
| Dedicated settlement extractor | **None** — Stage 05 required POI tags + name |
| Raw `place=*` already present | village 59, quarter 19, town 1, city 1 (points+polygons) |
| `ref.ref_poi_categories` settlement codes | **Missing** → migration **140** |
| Type-aware duplicate radii | Places used fixed **30 m** |

---

## 2. Category mapping (migration 140)

| OSM `place=*` | `ref.ref_poi_categories.code` | `ref.ref_place_classes` |
|---------------|-------------------------------|-------------------------|
| city | `city` | `settlement` |
| town | `town` | `settlement` |
| village | `village` | `settlement` |
| hamlet | `hamlet` | `settlement` |
| suburb | `suburb` | `settlement` |
| quarter | `quarter` | `settlement` |
| neighbourhood | `neighbourhood` | `settlement` |
| locality | `locality` | `settlement` |

Parent category: `settlement`. Applied on local + Supabase.

---

## 3. Name / preserve / admin rules

| Rule | Definition |
|------|------------|
| Required name | **All** supported settlement types (including locality) |
| Canonical name | Myanmar first (`name:my` / `name:mm` / `name` / `name:en`) |
| Preserved | Myanmar + English names, other name tags, `population`, OSM identity, comparison tags in `normalized_data` / `source_refs` |
| Township / admin | `system.pipeline_assign_admin_area_for_point` → smallest covering ward/town/township; stored as `normalized_data.core_admin_area_id` (not staging FK) |

---

## 4. Duplicate radii (metres)

| Type | Radius | Notes |
|------|--------|-------|
| city | 500 | larger match |
| town | 300 | larger match |
| suburb | 150 | |
| village | 100 | |
| locality | 100 | new localities forced to review |
| quarter | 80 | denser |
| hamlet | 75 | |
| neighbourhood | 50 | denser; stronger name/admin |
| other places (POI) | 30 | unchanged default |

---

## 5. Final actions ↔ `import_class`

| Final action | Pipeline `import_class` |
|--------------|-------------------------|
| `safe_insert` | `safe_new` |
| `safe_update` | `safe_update` |
| `skip` | `unchanged` |
| `send_to_review` | `duplicate`, `conflict`, `manual_protected`, `verified_conflict` |
| `invalid` | `invalid` |

Review reasons (when applicable): `possible_duplicate`, `manual_protected`, `verified_conflict`, `category_conflict`, `geometry_conflict`, `missing_required_name`, `outside_admin`, `unsupported_type`.

Helpers: `tools/data-pipeline/local-osm/pipeline_settlements.sql`.

---

## 6. Counts (settlements only)

| Metric | Count |
|--------|------:|
| raw (supported `place=*`) | **80** |
| normalized (`source_classification=settlement`) | **80** |
| valid | **80** |
| warning | **0** |
| invalid | **0** |
| safe_insert (`safe_new`) | **77** |
| safe_update | **0** |
| skip (`unchanged`) | **0** |
| send_to_review | **3** (duplicate 1 + manual_protected 2) |

By type (normalized): village 59, quarter 19, town 1, city 1.

### Stability (same snapshot × 2)

| Run | Fingerprint | Stable |
|-----|-------------|--------|
| 1 | `903e0262e6be353bf5601bd790e09958` | |
| 2 | `903e0262e6be353bf5601bd790e09958` | **yes** |

---

## 7. Safe load (`import_work` → core)

| Item | Value |
|------|-------|
| Batch | `places_kyauktan_settlements_safe_2026_07_23` (id **9**) |
| Preload | 77 `safe_new`, 0 unsupported category, 0 IR overlap, 77/77 admin |
| Dry-run | inserted 77, updated 0, skipped 0, failed 0 (rolled back) |
| Apply | inserted **77**, core 266 → **343** (+77) |
| Identical rerun | inserted 0, skipped 77, delta 0 |

Loader: existing `places_safe_loader.sql` + settlement codes in `kyauktan_places_preload_and_copy.sql`.

---

## 8. Import Review (conflicts only)

| Item | Value |
|------|-------|
| Package | `remote_review_settlement_conflicts_kyauktan_2026_07_23` |
| Remote batch | **7** |
| Uploaded | **3** settlement conflicts only (`REMOTE_REVIEW_SETTLEMENTS_ONLY=true`) |
| Rows | 1× `duplicate` (quarter), 2× `manual_protected` (town ကျောက်တန်း, village ဆေးဘိုဝ) |

### IR checks

| Check | Result |
|-------|--------|
| Safe records in IR batch 7 | **0** |
| Invalid records in IR batch 7 | **0** |
| Duplicate active core external IDs | **0** |
| Loaded settlements with admin | **77 / 77** |
| Manual-protected conflicts auto-written to core | **No** (not in safe set) |

---

## 9. Code / config touched

| Path | Role |
|------|------|
| `infrastructure/database/migrations/supabase/140_settlement_poi_categories.sql` | Settlement place class + categories |
| `tools/data-pipeline/local-osm/pipeline_settlements.sql` | Mapping, radii, actions, admin helper |
| `tools/data-pipeline/local-osm/05_raw_to_staging.sql` | Settlement extraction |
| `tools/data-pipeline/local-osm/07_compare_with_prod_mirror.sql` | Type-aware F2 place radii |
| `tools/data-pipeline/local-osm/08b_assign_import_class.sql` | Settlement-aware final class |
| `tools/data-pipeline/local-osm/pipeline_candidate_validation.sql` | Required name / outside_admin |
| `tools/data-pipeline/local-osm/11_prepare_remote_review_package.sql` | `settlements_only` filter |
| `tools/data-pipeline/local-osm/imports/kyauktan_settlements_rural_pilot_2026_07_23.env` | Pilot config |
| `tools/data-pipeline/import-work/kyauktan_places_preload_and_copy.sql` | Settlement category map rows |

---

## 10. How to re-run

```bash
# Classify only (reuse raw snapshot 4)
./run_local_osm_pipeline.sh imports/kyauktan_settlements_rural_pilot_2026_07_23.env

# Safe load (after export CSV) — see import-work preload + places_safe_loader
# IR conflicts: REMOTE_REVIEW_UPLOAD_ENABLED=true REMOTE_REVIEW_SETTLEMENTS_ONLY=true
#   PIPELINE_FROM_STAGE=11 ./run_local_osm_pipeline.sh imports/kyauktan_settlements_rural_pilot_2026_07_23.env
```

**Note:** Stage K maps `admin_area_id` from `normalized_data.admin_area_id`. Settlements store local core admin as `core_admin_area_id` so IR upload does not FK-fail on local-only admin IDs. Category IDs must be remapped to Supabase IDs when local ≠ remote (done for this package).

---

## 11. Remaining risks

- Local vs Supabase `ref.ref_poi_categories` IDs differ — upload path should eventually resolve by **code**, not local id.
- No second raw snapshot → no previous-snapshot deletion / F1 deleted_candidate proof.
- Kyauktan used as rural pilot (existing clipped raw); a different rural township clip is optional later.
- POI places still share the places family run; settlement metrics above are filtered by `source_classification='settlement'`.
