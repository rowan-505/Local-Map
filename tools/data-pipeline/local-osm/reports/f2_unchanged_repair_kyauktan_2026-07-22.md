# F2 unchanged repair — Kyauktan (2026-07-22)

**Scope:** Local OSM pipeline only. **No** Supabase core or Import Review writes.  
**Snapshot:** `osm_myanmar_2026_05_15_kyauktan_v2` (id=4)

## Verdict

**PASS** — roads are no longer 1,400/`0` `safe_update`/`unchanged`. Unchanged detection is evidence-based.

| family | old safe_update | old unchanged | new safe_update | new unchanged |
|--------|----------------:|--------------:|----------------:|--------------:|
| **roads** | 1400 | 0 | **183** | **1217** |
| **places** | 21 | 0 | **10** | **11** |
| buildings | 953 | 0 | 950 | 3 |
| landuse | 30 | 0 | 1 | 29 |
| admin_areas | 0 | 0 | 0 | 0 |
| water_* / barriers | (mostly new/dup) | 0 | unchanged | unchanged |

Stage 18 reconciliation: **PASS** (`valid 3047 = class_sum 3047`).

---

## Old counts (2026-07-22 pre-repair)

From `reports/classification_kyauktan_2026-07-22.md`:

| family | valid | safe_new | safe_update | unchanged | duplicate | conflict | manual_protected |
|--------|------:|---------:|------------:|----------:|----------:|---------:|-----------------:|
| places | 117 | 62 | 21 | 0 | 11 | 0 | 23 |
| roads | 1400 | 0 | 1400 | 0 | 0 | 0 | 0 |
| **TOTAL** | 3047 | 499 | 2404 | 0 | 109 | 1 | 34 |

---

## New counts (after stable F2)

| family | valid | safe_new | safe_update | unchanged | duplicate | conflict | manual_protected | note |
|--------|------:|---------:|------------:|----------:|----------:|---------:|-----------------:|------|
| admin_areas | 14 | 0 | 0 | 0 | 2 | 1 | 11 | PASS |
| buildings | 1402 | 379 | 950 | 3 | 70 | 0 | 0 | PASS |
| landuse | 59 | 18 | 1 | 29 | 11 | 0 | 0 | PASS |
| places | 117 | 62 | 10 | 11 | 11 | 0 | 23 | PASS |
| roads | 1400 | 0 | 183 | 1217 | 0 | 0 | 0 | PASS |
| routing_barriers | 15 | 15 | 0 | 0 | 0 | 0 | 0 | PASS |
| water_lines | 26 | 22 | 0 | 0 | 4 | 0 | 0 | PASS |
| water_polygons | 14 | 3 | 0 | 0 | 11 | 0 | 0 | PASS |
| **TOTAL** | **3047** | **499** | **1144** | **1260** | **109** | **1** | **34** | **PASS** |

---

## Main causes of false changes

### Roads (all 1,400 previously `safe_update`)

1. **Geometry serialization:** staging `MultiLineString` vs mirror `LineString` with `ST_Equals = true` for **1,382 / 1,400** rows. Raw `geometry_hash` / WKB differed → false change.  
2. **Synthetic names:** staging often used `osm:way:<id>`; prod used generated `road-<n>` (**~1,347–1,358** rows). Not meaningful name edits.  
3. **Missing slim-mirror attributes:** F2 compared staging `is_oneway=false` and `routing` tags to absent prod columns → always distinct.  
4. **Broad JSON compare (non-road path):** other families used full `to_jsonb(staging) vs to_jsonb(mirror)` with incompatible schemas.

### Places (21 previously `safe_update`)

1. Full-row JSON schema mismatch.  
2. Staging `poi_category_id` always NULL vs prod `category_id` set → false category change.  
3. Real remaining diffs: bilingual / alternate names (10 rows) → correctly stay `safe_update`.

### Other families

- **Landuse:** stable name/class/geom compare → **29 unchanged** (was 0).  
- **Buildings:** only **3 unchanged**; most still look changed (name/type/geom policy still noisy — follow-up).  
- **Admin:** unchanged still 0 (conservative/sensitive path unchanged by this repair).

---

## Field comparison policy

Implemented in `pipeline_f2_stable_compare.sql`, wired in Stage `07_compare_with_prod_mirror.sql`.

### Roads (compare when available on both sides)

| field | rule |
|-------|------|
| identity | already matched via `pipeline_osm_identity_key` |
| name | `pipeline_meaningful_name` — ignore `osm:way:N`, `road-N`, empty |
| road class | prefer `road_class_id`; else resolve class text via `ref.ref_road_classes` |
| geometry | `LineMerge` Multi→Line, `SnapToGrid(1e-7°)`, hash/equals; Hausdorff `< 1e-7°` → unchanged |
| admin_area_id | only if staging has it |
| oneway / surface / bridge / tunnel / layer | only if slim mirror has columns (`include_optional_attrs`); **currently off** |
| deleted | prod `deleted_at` |

### Places

| field | rule |
|-------|------|
| name | meaningful normalized primary/canonical |
| category_id | only if staging `poi_category_id` present |
| geometry | stable point hash / equals |
| admin_area_id | only if staging has it |
| deleted | prod `deleted_at` |

Excluded from F2: processing timestamps, review metadata, local row ids, full OSM tag bags, JSON key-order noise (`jsonb` canonicalization + `jsonb_strip_nulls`).

---

## Sample corrected rows (roads now `unchanged`)

Typical pattern: synthetic names + equal class id + equal geometry after normalize.

| external_id | staging name | prod name | class |
|-------------|--------------|-----------|-------|
| osm:way:1075668729 | osm:way:1075668729 | road-1038 | service / 7 |
| osm:way:699793072 | osm:way:699793072 | road-1123 | service / 7 |
| osm:way:659196568 | osm:way:659196568 | road-1290 | residential / 6 |

## Sample remaining `safe_update` (roads) — real evidence

| external_id | evidence |
|-------------|----------|
| osm:way:40480206 | staging `unclassified` (null id) vs prod `tertiary` (id 5) |
| osm:way:40481636 | class diff + meaningful geom Hausdorff ~4 m |
| osm:way:40479822 | staging `unclassified` vs prod `unclassified` id 21 (local ref lacks code; id differs) |

183 road updates each carry field-level `f2_comparison.field_diffs` (class and/or geom). Not accepted as “all changed.”

## Sample places

| class | count | example |
|-------|------:|---------|
| unchanged | 11 | same normalized name + geom (e.g. Water Fountain) |
| safe_update | 10 | bilingual / alternate labels (e.g. Pagoda + Myanmar suffix vs English-only primary) |

---

## Reconciliation

```text
valid (3047)
  = safe_new (499)
  + safe_update (1144)
  + unchanged (1260)
  + duplicate (109)
  + conflict (1)
  + manual_protected (34)
  + verified_conflict (0)
```

Stage 18: **PASS**

---

## Tests

`scripts/test_f2_stable_compare.sql` — **PASS**, covering:

- identical normalized data → unchanged  
- timestamps not in payload → unchanged  
- JSON key order → unchanged hash  
- MultiLineString vs LineString equal coords → unchanged  
- real geometry change → changed  
- road_class_id change → changed  
- synthetic names ignored  
- missing staging category → not a place change  
- optional attrs absent on prod → unchanged  

Diagnostic: `scripts/diagnose_f2_false_changes.sql`

---

## Artifacts

| path | role |
|------|------|
| `pipeline_f2_stable_compare.sql` | stable compare functions |
| `07_compare_with_prod_mirror.sql` | Stage 07 uses stable compare |
| `scripts/test_f2_stable_compare.sql` | unit tests |
| `scripts/diagnose_f2_false_changes.sql` | sample field diffs |
| `reports/stage07_f2_stable_kyauktan.log` | F2 rerun |
| `reports/stage08b_f2_stable_kyauktan.log` | import_class assign |
| `reports/stage18_f2_stable_kyauktan.log` | Stage 18 report |

---

## Follow-ups (not blockers for this repair)

1. Expand slim `prod_mirror.core_streets` columns (oneway, surface, bridge, tunnel, layer) when attribute F2 is required.  
2. Harden **buildings** F2 further (still 950 `safe_update` / 3 `unchanged`).  
3. Align local `ref.ref_road_classes` with production codes (`track`, `unclassified`, …) to reduce id/text ambiguity.

**No production data was written.**
