# National buildings — outlier review (batch 255)

**Date:** 2026-07-31  
**Mode:** Phase A complete (read-only inspection + dry-run ROLLBACK). Phase B not applied.  
**Publish batch:** `system.system_publish_batches.id = 255`

## Verdict

Exactly **12** distinct inserted outliers (11 large-area + 1 high-levels; no overlap).

| Classification | Count | Action proposed |
|----------------|------:|-----------------|
| `KEEP_AS_IS` | **1** | none |
| `CLEAR_LEVELS_ONLY` | **1** | clear `levels` + `height_m` |
| `MARK_NEEDS_FIX` | **5** | `verification_status = needs_fix` |
| `MANUAL_GEOMETRY_REVIEW` | **1** | `verification_status = needs_fix` |
| `SOFT_DELETE_AS_NOT_A_BUILDING` | **4** | soft-delete + `rejected_after_core_review` |
| `CORRECT_LEVELS_FROM_SOURCE` | **0** | — |

Dry-run transaction updated the 11 planned rows and rolled back. Geometry / identity / names / place links / admin / type were unchanged in the dry-run checks.

---

## Artifact paths

| Item | Path |
|------|------|
| This report | `docs/national-buildings-outlier-review-2026-07-31.md` |
| Package | `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/outlier_review_2026_07_31/` |
| Review CSV | `.../outliers_review.csv` |
| GeoJSON | `.../outliers.geojson` |
| Dry-run SQL | `.../01_dry_run_corrections.sql` |
| Apply SQL | `.../02_apply_corrections.sql` |
| Rollback SQL | `.../03_rollback_corrections.sql` |

---

## Target confirmation

| Check | Result |
|------:|-------:|
| Batch 255 insert/success | 22,703 |
| `area_m2 > 100000` | 11 |
| `levels > 100` | 1 |
| Both conditions | 0 |
| Distinct outlier IDs | **12** |
| Max `area_m2` | **409,070.1** |
| Any `area_m2 > 1e6` | 0 |
| Negative levels/heights | 0 |
| Geom type | MultiPolygon 4326, valid |
| Place-building links on outliers | **0** |
| Local `basemap_source.buildings` matches | **12 / 12** |
| Geometry MD5 match vs local | **12 / 12** |

---

## Per-outlier summary

| ID | Name | Kind | Area m² | Levels | OSM tags | Classification |
|---:|------|------|--------:|-------:|----------|----------------|
| 58170 | ၽြႃးထၢတ်ႈၼွၼ်းလိူင်း | LARGE | 409,070 | — | building=yes, amenity=place_of_worship | `MARK_NEEDS_FIX` |
| 48754 | Myanmar Radio & Televsion | LARGE | 389,095 | — | building=yes, amenity=studio | `MARK_NEEDS_FIX` |
| 58172 | တီႈထႃႇပၼႃႇ … | LARGE | 272,949 | — | building=yes, amenity=place_of_worship | `MARK_NEEDS_FIX` |
| 50170 | Padauk Myay Radio Station | LARGE | 178,912 | — | building=yes, amenity=studio | `MARK_NEEDS_FIX` |
| 58344 | Monechaung Dam | LARGE | 164,400 | — | building=dam, waterway=dam | `SOFT_DELETE_AS_NOT_A_BUILDING` |
| 62031 | Kyaukgū Taw Ya Monastery | LARGE | 150,868 | — | building=monastery, landuse=religious | `MARK_NEEDS_FIX` |
| 48799 | ဟံလင်းမြို့ရိုး… (city wall ruins) | LARGE | 118,536 | — | building=ruins | `SOFT_DELETE_AS_NOT_A_BUILDING` |
| 58624 | Kyeeon Kyeewa Dam | LARGE | 111,516 | — | building=dam, waterway=dam | `SOFT_DELETE_AS_NOT_A_BUILDING` |
| 57248 | Putao Prison | LARGE | 108,521 | — | building=yes | `MANUAL_GEOMETRY_REVIEW` |
| 59890 | တကစ မြိုင် | LARGE | 104,700 | — | building=industrial | `KEEP_AS_IS` |
| 58802 | Nat Mauk Dam | LARGE | 103,779 | — | building=dam, waterway=dam | `SOFT_DELETE_AS_NOT_A_BUILDING` |
| 50066 | Home | LEVELS | 376 | **199** (height 500) | building=house, building:levels=199, height=500 | `CLEAR_LEVELS_ONLY` |

Map links: each row includes `osm_url` and geometry in `outliers.geojson` / envelope WKT in the CSV.

---

## Evidence notes

### levels = 199 (id 50066)

- Core: `levels=199`, `height_m=500`, area ≈ 376 m², type=residential, name=Home.
- OSM tags (also in local basemap_source): `building=house`, `building:levels=199`, `height=500`.
- Not a wrong-field mapping: the source values are present and identical.
- Physically impossible for this footprint → **clear levels and height only**. Do not invent a substitute level count (`CORRECT_LEVELS_FROM_SOURCE` not applicable).

### Dams (58344, 58624, 58802)

- Explicit `building=dam` + `waterway=dam`.
- Names are dam/reservoir names.
- Low compactness (0.18–0.31).
- Not buildings → **soft-delete**.

### Hanlin city wall ruins (48799)

- Name = city wall and related ruins; `building=ruins`.
- Compactness ≈ 0.04, perimeter ≈ 6.1 km, 114 vertices → wall-like.
- Soft-delete as not a building.

### Campus / compound suspects (radio, worship, monastery)

- Keep geometry (no auto-split).
- Set `verification_status = needs_fix` for later manual review.

### Putao Prison (57248)

- Simple high-compactness rectangle; could be real institutional footprint or outer wall.
- `MANUAL_GEOMETRY_REVIEW` → `needs_fix` only.

### Industrial (59890)

- `building=industrial`, plausible large shed/plant → `KEEP_AS_IS`.

---

## Proposed correction plan (Phase B)

Approved IDs only:

1. **50066** — `levels=NULL`, `height_m=NULL` (+ repair note in `normalized_data.outlier_repair`)
2. **48754, 50170, 58170, 58172, 62031, 57248** — `verification_status=needs_fix`
3. **48799, 58344, 58624, 58802** — soft-delete (`deleted_at`, `is_active=false`, `verification_status=rejected_after_core_review`)
4. **59890** — no change

Not changed by design: geometry, names, source identity, place links, admin_area_id, building_type_id.

### Apply (after your approval)

```bash
psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v execute_building_outlier_fixes=I_UNDERSTAND \
  -f tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/outlier_review_2026_07_31/02_apply_corrections.sql
```

Equivalent intent: `EXECUTE_BUILDING_OUTLIER_FIXES=I_UNDERSTAND`.

### Rollback

`03_rollback_corrections.sql` restores from `normalized_data.outlier_repair` markers (review, then COMMIT).

---

## Dry-run result (2026-07-31)

- Eligible planned rows: **11** (KEEP excluded)
- Dry-run checks: geometry_changed=0, identity_changed=0, type_changed=0, admin_changed=0
- Name rows still present for all 12
- Place links remain 0
- Transaction **ROLLBACK** — production unchanged

---

## Out of scope

- No new outlier subsystem / dashboard / validation table / job
- No automatic geometry simplify/split/replace
- No local `basemap_source` writes
- Phase B not executed in this session
