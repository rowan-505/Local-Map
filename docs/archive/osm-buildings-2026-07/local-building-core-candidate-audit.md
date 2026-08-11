# Local national building → Core candidate audit

**Date:** 2026-07-31  
**Database:** local `geo_core` @ `localhost:5433` (read-only)  
**Snapshot:** `system.system_source_snapshots.id = 13`  
`snapshot_version = osm_myanmar_2026_07_21_national_dry_run_v1`  
**Prod mirror freshness:** `prod_mirror.mirror_meta` ≈ `2026-07-28 04:30 UTC`  
**Scope:** Determine how many national building footprints are genuinely suitable for eventual promotion into Supabase `core.core_map_buildings`.

No candidate rows were updated. No Core inserts were performed.

---

## 1. Source inspection (do not assume staging)

| Relation | Role | Exact rows / notes |
|----------|------|--------------------|
| `raw.raw_osm_polygons` (snapshot 13, `building` present) | Upstream OSM polygons | **5,578,282** |
| `staging.staging_building_candidates` | Classified national building candidates | **5,578,282** |
| `prod_mirror.core_map_buildings` | Mirror of production Core buildings | **1,125** active (`deleted_at IS NULL`) |
| `prod_mirror.core_places` | Mirror of production Core places | **11,213** active |
| Local `core.*` | — | **Absent** (Mode B lab cleanup). Production Core comparisons use **`prod_mirror`**. |

**Completeness check:** raw buildingish polygons for snapshot 13 equals staging row count exactly (`5,578,282`). Distinct `external_id` = `5,578,282` (no duplicate external IDs). Null geom = 0. Invalid geom = 0.

**Conclusion:** `staging.staging_building_candidates` **is** the complete national building candidate set for this snapshot. No other local building candidate table holds additional national footprints.

---

## 2. Headline counts

| Metric | Count | % of 5,578,282 |
|--------|------:|---------------:|
| Total national building footprints | 5,578,282 | 100% |
| Named (`canonical_name` non-blank) | 10,049 | 0.1801% |
| Unnamed | 5,568,233 | 99.8199% |
| Pipeline `eligible_for_core = true` | 22,800 | 0.4087% |
| Pipeline `pmtiles_only` | 5,555,482 | 99.5913% |

### Conservative audit classification (this report)

| Category | Count | % |
|----------|------:|--:|
| **BASEMAP_ONLY** | 5,543,842 | 99.3826% |
| **STRONG_CORE_CANDIDATE** | 23,198 | 0.4159% |
| **REVIEW_CANDIDATE** | 10,522 | 0.1886% |
| **INVALID_OR_AMBIGUOUS** | 720 | 0.0129% |

**Genuinely suitable for eventual Core (STRONG only):** **23,198** footprints (~0.42%).  
Most of these still need staged review before a first production import (see §12).

---

## 3. Pipeline status breakdown

### `import_class`

| import_class | Count |
|--------------|------:|
| `pmtiles_only` | 5,555,482 |
| `safe_new` | 22,703 |
| `safe_update` | 82 |
| `duplicate` | 15 |

No `conflict` / `invalid` import_class values are present on this snapshot.

### `match_status`

| match_status | Count |
|--------------|------:|
| `new_auto` | 5,577,191 |
| `matched_auto_update` | 1,000 |
| `duplicate_candidate` | 88 |
| `unchanged` | 3 |

### `validation_status`

| validation_status | Count |
|-------------------|------:|
| `warning` | 5,568,233 |
| `valid` | 10,049 |

(`valid` aligns exactly with named buildings.)

### `auto_action` / review

| Field | Dominant values |
|-------|-----------------|
| `auto_action` | `insert_candidate` 5,577,191; `update_candidate` 1,000; `possible_duplicate` 88; `ignore_unchanged` 3 |
| `review_status` | `pending` 5,578,279; `ignored` 3 |
| `review_decision` | all null |
| `source_status` | all `source_new` |

### Pipeline core vs PMTiles selection

| core_selection_reason | Count |
|-----------------------|------:|
| (null / pmtiles path) | 5,555,482 |
| `named_building` | 8,118 |
| `hospital_or_clinic` | 6,984 |
| `important_landmark` | 3,232 |
| `school_or_university` | 1,987 |
| `government_building` | 663 |
| `market` | 641 |
| `station_or_terminal` | 632 |
| `important_public_building` | 539 |
| `linked_to_important_place` | 4 |

| pmtiles_only_reason | Count |
|---------------------|------:|
| `unnamed_ordinary_building` | 5,555,482 |

---

## 4. Named vs unnamed; class_code

Named: **10,049** (0.18%). Unnamed: **5,568,233**.

### Top `class_code` (all buildings)

| class_code | Count | Named |
|------------|------:|------:|
| `unknown` | 5,521,132 | 7,075 |
| `residential` | 42,919 | 1,936 |
| `healthcare` | 6,899 | 50 |
| `religious` | 2,304 | 152 |
| `education` | 1,773 | 431 |
| `industrial` | 1,231 | 67 |
| `commercial` | 1,076 | 247 |
| `transport` | 544 | 56 |
| `agriculture` | 241 | 4 |
| `warehouse_storage` | 120 | 21 |
| `recreation` | 28 | 3 |
| `government_civic` | 14 | 7 |
| `military_restricted` | 1 | 0 |

### Top `class_code` among STRONG_CORE_CANDIDATE

| class_code | Count |
|------------|------:|
| `unknown` | 10,958 |
| `healthcare` | 6,889 |
| `religious` | 2,304 |
| `education` | 1,772 |
| `commercial` | 588 |
| `transport` | 544 |
| `residential` | 82 |
| others | ≤28 each |

---

## 5. `normalized_data` and `source_refs` structure

### Top-level `normalized_data` keys

| Key | Rows with key |
|-----|--------------:|
| `building` | 5,578,282 |
| `source_building_tag` | 5,578,282 |
| `tags` | 5,578,282 |
| `address` | 5,578,282 (often empty object) |
| `admin_assign_source` | 22,800 |
| `admin_assign_at` | 22,800 |
| `admin_area_id` | 20,092 |

### `source_refs` keys (uniform)

Every row has: `osm_feature_type`, `osm_id`, `raw_id`, `raw_table`, `region_code`, `snapshot_version`, `source_snapshot_id`.

Staging `external_id` form: `osm:way:<id>` / similar.  
Prod mirror building `external_id` is often bare OSM id (`604729710`); matching uses normalized `osm_id`.

### Top OSM tag keys inside `normalized_data.tags` (selected)

| Tag | Count |
|-----|------:|
| `building` | 5,578,282 |
| `source` | 87,881 |
| `building:levels` | 44,803 |
| `name` | 9,839 |
| `amenity` | 8,478 |
| `addr:city` | 6,408 |
| `religion` | 5,032 |
| `addr:street` | 2,668 |
| `addr:housenumber` | 2,153 |
| `office` | 688 |
| `shop` | 651 |
| `tourism` | 427 |
| `phone` | 187 |
| `operator` | 174 |
| `website` | 102 |
| `healthcare` | 102 |
| `government` | 94 |
| `wikidata` | 67 |

### Non-empty `address` object keys

| Key | Count |
|-----|------:|
| `city` | 6,408 |
| `postcode` | 3,158 |
| `street` | 2,668 |
| `house_number` | 2,153 |
| `district` | 13 |
| `state` | 5 |

---

## 6. Functional tags

| Signal | Count |
|--------|------:|
| `amenity` (non-empty, not no/none) | 8,478 |
| `healthcare` | 102 |
| `education` class or school-like amenity | 1,955 |
| `office` | 688 |
| `government` | 94 |
| `shop` | 651 |
| `tourism` (excl. no/none/yes) | 427 |
| **Any of the above families** | **11,940** |

### Top `amenity` values

| Value | Count |
|-------|------:|
| `place_of_worship` | 5,165 |
| `toilets` | 1,507 |
| `monastery` | 527 |
| `school` | 190 |
| `restaurant` | 179 |
| `police` | 111 |
| `bank` | 76 |
| `marketplace` | 76 |
| `townhall` | 64 |
| `clinic` | 62 |
| `hospital` | 42 |

**Note:** `amenity=toilets` alone is a strong signal under the requested functional-tag rule, but is a weak product entity. Tier-1 import recommendation below **excludes** amenity-only / shop-only rows that lack an important pipeline type.

---

## 7. Identity metadata

| Signal | Count |
|--------|------:|
| `operator` | 174 |
| `brand` | 39 |
| `website` / `contact:website` | 113 |
| `phone` / `contact:phone` | 192 |
| `wikidata` | 67 |
| `wikipedia` | 47 |
| **Any identity metadata** | **462** |

---

## 8. Address / entrance metadata

| Signal | Count |
|--------|------:|
| Address signal (house number or street in address object or `addr:*` tags) | 3,887 |
| Non-empty `address` JSON object | 7,776 |
| Entrance signal | **0** |

Address alone does **not** qualify as STRONG (per rules).

---

## 9. Spatial containment of existing Core places (`prod_mirror`)

Join: active `prod_mirror.core_places.point_geom` contained in staging building geom (`ST_Contains`).

**Publicish proxy** (mirror has no `is_public` flag): `is_verified` **or** category in  
`hospital, clinic, school, university, government, township_office, police_station, market, bus_stop, ferry_terminal, train_station, city, town, village, religion, monastery, hotel, pharmacy, health, bank, fuel, shopping, supermarket`.

| Metric | Count |
|--------|------:|
| Buildings containing any active place | 3,144 |
| Buildings containing a verified place | 10 |
| Buildings containing a publicish place | 1,277 |
| Buildings containing multiple places | 482 |
| Place↔building pairs | 3,880 |
| Distinct places inside some building | 3,834 |

---

## 10. Match to existing Core buildings (stable OSM identity)

Normalized OSM id: staging `source_refs.osm_id` / `external_id` suffix ↔ prod_mirror `source_refs.osm_id` / `external_id`.

| Metric | Count |
|--------|------:|
| Active Core buildings in mirror | 1,125 |
| Core buildings with OSM id | 1,019 |
| Staging rows matching Core OSM id | **1,019** |
| Distinct Core buildings matched | **1,019** |

All OSM-identified Core buildings in the mirror are present in this national staging set.

---

## 11. Collisions / duplicate identity

| Check | Result |
|-------|--------|
| Duplicate `external_id` groups | **0** |
| Duplicate normalized OSM id groups | **0** |
| `normalized_hash` collision groups | **0** |
| `geometry_hash` collision groups | **368** groups (**736** rows) — likely near-identical geometries / remaps; treat as review risk, not id collision |
| `match_status = duplicate_candidate` | 88 |
| `import_class = duplicate` | 15 |
| `demolished:building` tag | 632 |

---

## 12. Classification rules (conservative, deterministic)

Applied in order:

1. **INVALID_OR_AMBIGUOUS** if `import_class = duplicate` OR `match_status = duplicate_candidate` OR `tags.demolished:building` present.
2. **STRONG_CORE_CANDIDATE** if any strong signal:
   - important class: `healthcare|education|religious|government_civic|transport|military_restricted`
   - important pipeline reason: `hospital_or_clinic|school_or_university|government_building|market|station_or_terminal|important_landmark`  
     (**excludes** `named_building` and `important_public_building` alone)
   - functional tags: amenity / healthcare / office / government / shop / tourism (meaningful)
   - identity metadata: operator / brand / website / phone / wikidata / wikipedia
   - contains verified or publicish Core place
3. **REVIEW_CANDIDATE** if named, pipeline-eligible, address-bearing, matches Core, contains any place, `safe_new`/`safe_update`, or weak commercial/civic reason — but not strong.
4. Else **BASEMAP_ONLY**.

Explicitly **not** enough for STRONG alone: name, confidence, address, residential/apartments/commercial class, `safe_new` / `safe_update`.

### Counts by category and primary reason

| Category | Primary reason | Count | % within category |
|----------|----------------|------:|------------------:|
| BASEMAP_ONLY | unnamed_ordinary_basemap | 5,543,842 | 100% |
| INVALID_OR_AMBIGUOUS | demolished_building_tag | 632 | 87.78% |
| INVALID_OR_AMBIGUOUS | duplicate_or_ambiguous_match | 88 | 12.22% |
| REVIEW_CANDIDATE | named_only | 5,850 | 55.60% |
| REVIEW_CANDIDATE | address_only | 2,534 | 24.08% |
| REVIEW_CANDIDATE | matches_existing_core_building | 917 | 8.72% |
| REVIEW_CANDIDATE | contains_nonpublic_place | 732 | 6.96% |
| REVIEW_CANDIDATE | commercial_or_civic_weak | 489 | 4.65% |
| STRONG_CORE_CANDIDATE | functional_tag:amenity | 6,938 | 29.91% |
| STRONG_CORE_CANDIDATE | important_type:hospital_or_clinic | 6,887 | 29.69% |
| STRONG_CORE_CANDIDATE | important_type:important_landmark | 3,181 | 13.71% |
| STRONG_CORE_CANDIDATE | important_type:school_or_university | 1,919 | 8.27% |
| STRONG_CORE_CANDIDATE | contains_publicish_core_place | 1,265 | 5.45% |
| STRONG_CORE_CANDIDATE | important_type:station_or_terminal | 630 | 2.72% |
| STRONG_CORE_CANDIDATE | important_type:government_building | 621 | 2.68% |
| STRONG_CORE_CANDIDATE | important_type:market | 589 | 2.54% |
| STRONG_CORE_CANDIDATE | functional_tag:shop | 531 | 2.29% |
| STRONG_CORE_CANDIDATE | functional_tag:office | 275 | 1.19% |
| STRONG_CORE_CANDIDATE | functional_tag:tourism | 273 | 1.18% |
| STRONG_CORE_CANDIDATE | identity_metadata | 70 | 0.30% |
| STRONG_CORE_CANDIDATE | contains_verified_core_place | 7 | 0.03% |
| STRONG_CORE_CANDIDATE | other functional/class | ≤6 | — |

### STRONG × pipeline import_class

| import_class | STRONG count |
|--------------|-------------:|
| `safe_new` | 16,387 |
| `pmtiles_only` | 6,752 |
| `safe_update` | 59 |

**6,752** buildings are STRONG by tag/place signals but still `pmtiles_only` in the pipeline (often unnamed amenity footprints). They are **not** ready for automated Core import until selection/classification is reconciled.

---

## 13. Recommendation — maximum safe first Core import

Do **not** import all 23,198 STRONG rows in one shot.

### Recommended first production batch (maximum safe)

**Tier 1 — preferred ceiling: 13,805 buildings**

Filters:

- audit category = `STRONG_CORE_CANDIDATE`
- `import_class = safe_new`
- not already matched to `prod_mirror.core_map_buildings`
- `primary_reason` starts with `important_type:`  
  (`hospital_or_clinic`, `school_or_university`, `government_building`, `market`, `station_or_terminal`, `important_landmark`)

This excludes named-only, commercial-weak, amenity-only toilets/shops, and pmtiles_only STRONG leftovers.

### Safer pilot inside Tier 1

**Tier 1a — named important types: 1,540 buildings**

Same as Tier 1 **plus** non-blank `canonical_name`.  
Best first direct-Core / IR promote pilot (searchable entities, easier QA).

### Optional Tier 2 (still review-gated): 14,373

Tier 1 plus `important_class:*` or contains verified/publicish Core place, still `safe_new` and not already in Core.

### Explicitly postpone

| Set | Why |
|-----|-----|
| ~5.54M BASEMAP_ONLY | Ordinary unnamed footprints — tiles only |
| 5,850 named_only REVIEW | Name alone ≠ Core |
| 2,534 address_only REVIEW | Address alone ≠ Core |
| 489 commercial_or_civic_weak | Pipeline `important_public_building` too weak |
| 6,752 STRONG ∩ `pmtiles_only` | Pipeline/selection inconsistency; amenity-heavy |
| 720 INVALID | Demolished / duplicate |
| 1,019 already in Core | Updates/reconcile, not first insert |
| Shop / office / tourism-only STRONG | Need human review of tag quality |

### Conditions that still require manual review

1. Unnamed important-type footprints (majority of Tier 1) — confirm building use is real, not mis-tagged polygon.
2. Religious / landmark footprints without names.
3. Any building containing multiple Core places (482).
4. Geometry-hash twin pairs (368 groups).
5. `safe_update` / matched Core rows (reconcile attributes, do not blind insert).
6. Functional-tag STRONG without important_type (toilets, restaurants, generic shop).
7. Cross-border / Thailand-adjacent named POIs visible in samples (region filter before national apply).
8. Mirror lag: Core place/building truth is as of prod_mirror refresh (~2026-07-28), not live Supabase.

---

## 14. SQL queries used

All queries were read-only against local `geo_core`. Classification used session `TEMP` tables only (no durable writes).

### Source discovery / completeness

```sql
-- building-related relations
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','v') AND c.relname ILIKE '%building%';

SELECT count(*) FROM raw.raw_osm_polygons
WHERE source_snapshot_id = 13 AND tags ? 'building';

SELECT count(*), count(DISTINCT external_id),
       count(*) FILTER (WHERE geom IS NULL),
       count(*) FILTER (WHERE NOT ST_IsValid(geom))
FROM staging.staging_building_candidates;
```

### Status / name / class / JSON

```sql
SELECT import_class, count(*) FROM staging.staging_building_candidates GROUP BY 1;
SELECT match_status, count(*) FROM staging.staging_building_candidates GROUP BY 1;
SELECT validation_status, count(*) FROM staging.staging_building_candidates GROUP BY 1;
SELECT core_selection_reason, count(*) FROM staging.staging_building_candidates GROUP BY 1;
SELECT pmtiles_only_reason, count(*) FROM staging.staging_building_candidates GROUP BY 1;

SELECT count(*) FILTER (WHERE nullif(btrim(canonical_name),'') IS NOT NULL) AS named
FROM staging.staging_building_candidates;

SELECT class_code, count(*) FROM staging.staging_building_candidates GROUP BY 1 ORDER BY 2 DESC;

SELECT k, count(*) FROM staging.staging_building_candidates b
CROSS JOIN LATERAL jsonb_object_keys(coalesce(b.normalized_data,'{}'::jsonb)) k
GROUP BY 1 ORDER BY 2 DESC;
```

### Functional / identity / address

```sql
SELECT
  count(*) FILTER (WHERE nullif(btrim(normalized_data#>>'{tags,amenity}'),'') IS NOT NULL) AS amenity,
  count(*) FILTER (WHERE nullif(btrim(normalized_data#>>'{tags,healthcare}'),'') IS NOT NULL) AS healthcare,
  count(*) FILTER (WHERE nullif(btrim(normalized_data#>>'{tags,office}'),'') IS NOT NULL) AS office,
  count(*) FILTER (WHERE nullif(btrim(normalized_data#>>'{tags,government}'),'') IS NOT NULL) AS government,
  count(*) FILTER (WHERE nullif(btrim(normalized_data#>>'{tags,shop}'),'') IS NOT NULL) AS shop,
  count(*) FILTER (WHERE nullif(btrim(normalized_data#>>'{tags,tourism}'),'') IS NOT NULL) AS tourism
FROM staging.staging_building_candidates;
-- (+ operator/brand/website/phone/wikidata/wikipedia and address filters)
```

### Place containment + Core identity match

```sql
-- places inside buildings
SELECT b.id AS building_id, p.id AS place_id, p.is_verified, c.code
FROM prod_mirror.core_places p
JOIN staging.staging_building_candidates b ON ST_Contains(b.geom, p.point_geom)
LEFT JOIN prod_mirror.ref_poi_categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL AND p.point_geom IS NOT NULL;

-- OSM identity match
SELECT count(*)
FROM staging.staging_building_candidates s
JOIN prod_mirror.core_map_buildings pm
  ON pm.deleted_at IS NULL
 AND coalesce(pm.source_refs->>'osm_id', pm.external_id)
   = coalesce(s.source_refs->>'osm_id',
              substring(s.external_id from 'osm:(?:way|relation|node):([0-9]+)'),
              s.external_id);
```

### Classification core (abbreviated)

```sql
CASE
  WHEN import_class = 'duplicate'
    OR match_status = 'duplicate_candidate'
    OR normalized_data#>>'{tags,demolished:building}' IS NOT NULL
    THEN 'INVALID_OR_AMBIGUOUS'
  WHEN /* important class/type OR functional OR identity OR publicish/verified place */
    THEN 'STRONG_CORE_CANDIDATE'
  WHEN eligible_for_core OR named OR address OR matches_core OR contains_any_place
    OR import_class IN ('safe_new','safe_update')
    THEN 'REVIEW_CANDIDATE'
  ELSE 'BASEMAP_ONLY'
END
```

Deterministic samples used `ORDER BY md5(id::text || '<salt>') LIMIT 100` per category.

---

## 15. Random samples (100 per category)

### STRONG_CORE_CANDIDATE (n=100)
| id | external_id | canonical_name | class_code | import_class | core_selection_reason | primary_reason | place_n | matches_core_building |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8461335 | osm:way:1241275924 | စာသင်ဆောင် | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 7868994 | osm:way:1375867394 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8346606 | osm:way:1379652178 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8649903 | osm:way:1233989258 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 6870483 | osm:way:1278264095 | မဉ္ဇူသက စာသင်ဆောင် | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 8687781 | osm:way:1389012576 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 6473779 | osm:way:1308582990 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 5834984 | osm:way:1376093384 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8109268 | osm:way:1376136722 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 8490997 | osm:way:597038181 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 7386751 | osm:way:453548120 |  | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 10869166 | osm:way:504417468 | နည်းပညာတက္ကသိုလ် | unknown | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 8460230 | osm:way:467133395 |  | unknown | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 8458560 | osm:way:1087229204 | Hello Energy Station | unknown | safe_new | named_building | functional_tag:amenity | 0 | f |
| 8730321 | osm:way:1389151330 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 7338175 | osm:way:372684829 | PT | unknown | safe_new | named_building | functional_tag:amenity | 0 | f |
| 8340618 | osm:way:1289863120 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 5840138 | osm:way:1375783731 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 6299182 | osm:way:1340981662 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 7873747 | osm:way:1375867338 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 11146133 | osm:way:1378652588 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8233702 | osm:way:1374857566 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 10921668 | osm:way:690384279 |  | commercial | safe_new | market | important_type:market | 0 | f |
| 8402122 | osm:way:819115791 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8638334 | osm:way:1377200817 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8510745 | osm:way:595898684 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 9023226 | osm:way:711121078 | အထက (ရွှေတောင်) | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 5796830 | osm:way:663086554 | B.E.H.S (Branch) Kyone Par Chaung Wa | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 7276092 | osm:way:1293574665 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8462329 | osm:way:1376672861 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 5843999 | osm:way:1268051208 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 10827167 | osm:way:1466655172 |  | transport | safe_new | station_or_terminal | important_type:station_or_terminal | 0 | f |
| 8459841 | osm:way:238379648 |  | unknown | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 7455441 | osm:way:1379083833 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8460420 | osm:way:507810372 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8573868 | osm:way:1378289957 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 5748854 | osm:way:1216237706 |  | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 9653301 | osm:way:1378652577 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 7338209 | osm:way:373902311 | ช.พาเลส | unknown | safe_new | named_building | functional_tag:tourism | 0 | f |
| 9361374 | osm:way:987369460 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8962472 | osm:way:1377200494 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 5833288 | osm:way:1376093221 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 5846780 | osm:way:1274590667 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 9054678 | osm:way:1376978061 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 7503120 | osm:way:1268655067 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 9263598 | osm:way:1379611511 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 7770481 | osm:way:337249756 |  | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 5603861 | osm:way:522962755 |  | education | safe_new | school_or_university | contains_publicish_core_place | 1 | f |
| 7341463 | osm:way:1348626510 | 勐拉县政府 မိုင်းလားခရိုင် အုပ်ချုပ်ရေးရုံး | unknown | safe_new | government_building | important_type:government_building | 0 | f |
| 9387166 | osm:way:707478390 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 10822284 | osm:way:507682665 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 6379339 | osm:way:948956679 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8461040 | osm:way:416192646 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8002704 | osm:way:401322272 | Kalemyo Town Hall | unknown | safe_new | government_building | important_type:government_building | 0 | f |
| 5785592 | osm:way:1376093410 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8453191 | osm:way:795611198 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8459475 | osm:way:418609166 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 9771512 | osm:way:1482439515 |  | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 8462957 | osm:way:1300683809 | ထီးလင်းမြို့နယ်ရဲတပ်ဖွဲ့မှူးရုံး | unknown | safe_new | government_building | important_type:government_building | 0 | f |
| 9159550 | osm:way:1378290032 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 6049159 | osm:way:1356655192 |  | unknown | safe_new | government_building | important_type:government_building | 0 | f |
| 8688059 | osm:way:1389078724 |  | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 5602692 | osm:way:117384553 | ခြောက်ထပ်ကြီး စေတီ | unknown | safe_new | important_landmark | contains_publicish_core_place | 1 | f |
| 11147955 | osm:way:565752910 | ObserverWorks | unknown | safe_new | named_building | identity_metadata | 1 | f |
| 7886857 | osm:way:1375867076 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 10590216 | osm:way:500200178 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 10942681 | osm:way:1377382738 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8391157 | osm:way:798893293 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 7112038 | osm:way:1301295212 | Golden Palace Condo | unknown | safe_new | named_building | functional_tag:tourism | 0 | f |
| 5590407 | osm:way:379864843 | Customs House | unknown | safe_new | government_building | contains_publicish_core_place | 1 | f |
| 8955065 | osm:way:972271510 |  | transport | safe_new | station_or_terminal | important_type:station_or_terminal | 0 | f |
| 7894307 | osm:way:1375867244 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 10711100 | osm:way:657455288 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 9554439 | osm:way:711558079 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 11154542 | osm:way:520945723 |  | commercial | safe_new | important_public_building | functional_tag:office | 0 | f |
| 10015845 | osm:way:1380263721 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 7991715 | osm:way:401332076 | Aung Thu Min Mobiles&Electronics | unknown | safe_new | named_building | functional_tag:shop | 0 | f |
| 6762838 | osm:way:1269287924 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 5607800 | osm:way:567087367 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 7769639 | osm:way:700456764 | ဂြိုဟ်တုပေါက်ဆီ | unknown | safe_new | named_building | functional_tag:amenity | 0 | f |
| 8712338 | osm:way:1418582759 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 8882569 | osm:way:1377200879 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 5601138 | osm:way:380344947 |  | unknown | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 7520418 | osm:way:1388130908 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 7276114 | osm:way:1298750073 | စာသင်ဆောင် | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 11155611 | osm:way:987145963 | Maharsi San kyung taw | unknown | safe_new | named_building | contains_publicish_core_place | 1 | f |
| 8490855 | osm:way:597900808 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 7551410 | osm:way:1268579253 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8410522 | osm:way:800401513 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8402020 | osm:way:819116329 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 8577521 | osm:way:1001685662 |  | transport | safe_new | station_or_terminal | important_type:station_or_terminal | 0 | f |
| 6507769 | osm:way:1386663099 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 5837997 | osm:way:1249069000 |  | religious | safe_new | important_landmark | important_type:important_landmark | 0 | f |
| 9923242 | osm:way:1486517502 |  | education | safe_new | school_or_university | important_type:school_or_university | 0 | f |
| 6052032 | osm:way:1463249554 |  | commercial | safe_new | market | important_type:market | 0 | f |
| 8463639 | osm:way:1377200089 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 8230407 | osm:way:566236513 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
| 9649526 | osm:way:1378652563 |  | healthcare | safe_new | hospital_or_clinic | important_type:hospital_or_clinic | 0 | f |
| 7121263 | osm:way:722507539 | My Tree Cafe | unknown | safe_new | named_building | functional_tag:amenity | 0 | f |
| 8461082 | osm:way:421067773 |  | unknown | pmtiles_only |  | functional_tag:amenity | 0 | f |
### REVIEW_CANDIDATE (n=100)
| id | external_id | canonical_name | class_code | import_class | core_selection_reason | primary_reason | place_n | matches_core_building |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10898750 | osm:way:693695487 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 10016769 | osm:way:524117302 | building 2 | unknown | safe_new | named_building | named_only | 0 | f |
| 5654621 | osm:way:740761729 | ငွေလမင်း ဆီစက် | industrial | safe_new | named_building | named_only | 0 | f |
| 10438933 | osm:way:541104423 | Brentsward Hospital | unknown | safe_new | named_building | named_only | 0 | f |
| 5602246 | osm:way:1057697012 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 5603863 | osm:way:565278175 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 7338472 | osm:way:1364455522 |  | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 5969068 | osm:way:240460926 | officer | residential | safe_new | named_building | named_only | 0 | f |
| 6971062 | osm:way:930097294 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 7446919 | osm:way:1351839197 | building | unknown | safe_new | named_building | named_only | 0 | f |
| 10025670 | osm:way:499956104 | Geography Department | unknown | safe_new | named_building | named_only | 0 | f |
| 7446921 | osm:way:1351840498 | building | unknown | safe_new | named_building | named_only | 0 | f |
| 10897789 | osm:way:707585912 | บ้าน | unknown | safe_new | named_building | named_only | 0 | f |
| 7886483 | osm:way:1418092310 | Kitchen and Dinning room | unknown | safe_new | named_building | named_only | 0 | f |
| 5599414 | osm:relation:9176733 | Block 5 | residential | safe_new | named_building | named_only | 1 | f |
| 10908039 | osm:way:687555594 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 10923080 | osm:way:733176528 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 11126467 | osm:way:604695609 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 6019305 | osm:way:1088736276 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 5595771 | osm:way:478258481 | New World Mart | unknown | safe_new | named_building | named_only | 1 | f |
| 5836531 | osm:way:414252716 |  | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 10152537 | osm:way:586871616 | #MCCares #YoProsPUN | unknown | safe_new | named_building | named_only | 0 | f |
| 5602215 | osm:way:1057675595 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 5866786 | osm:way:1088083503 |  | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 5810259 | osm:way:696048793 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 11126443 | osm:way:604695617 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 6863336 | osm:way:606038935 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 8128880 | osm:way:1375594039 | House #15 | unknown | safe_new | named_building | named_only | 0 | f |
| 5608819 | osm:way:1216219296 |  | residential | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 11127587 | osm:way:605321618 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 5595326 | osm:way:532421033 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 8568384 | osm:way:1081060650 | St. Martin's Island Lighthouse | unknown | safe_new | named_building | named_only | 0 | f |
| 8169207 | osm:way:1373446599 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 5599254 | osm:way:564994262 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 10833541 | osm:way:647994777 | # Cisco | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 6017084 | osm:way:1053264752 | J - 5 | residential | safe_new | named_building | named_only | 0 | f |
| 10923266 | osm:way:1354406600 | 8 | unknown | safe_new | named_building | named_only | 0 | f |
| 11127599 | osm:way:605321603 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 10670796 | osm:way:524161792 |  | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 5595679 | osm:way:478869547 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 5582262 | osm:way:564914179 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 11127606 | osm:way:605323881 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 5809964 | osm:way:694918662 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 5597136 | osm:way:477865427 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 11151139 | osm:way:1520461659 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 8459739 | osm:way:1290860824 |  | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 5810736 | osm:way:696062174 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 6233313 | osm:way:521875366 | Resident of Shan State Government | unknown | safe_new | named_building | named_only | 0 | f |
| 8169202 | osm:way:1373446609 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 7275939 | osm:way:1390524729 | ညွှန်မှူးအိမ် | residential | safe_new | named_building | named_only | 0 | f |
| 11126430 | osm:way:1052440539 |  | industrial | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 5605000 | osm:way:565684518 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 7479106 | osm:way:1236052732 | ခရိုင်အားကစားရုံ | unknown | safe_new | named_building | named_only | 0 | f |
| 8277166 | osm:way:1374721138 | temple | unknown | safe_new | named_building | named_only | 0 | f |
| 11127395 | osm:way:605345684 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 11150866 | osm:way:1516826582 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 5597837 | osm:way:575285160 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 8613522 | osm:way:1343478074 | kahtaykywe | unknown | safe_new | named_building | named_only | 0 | f |
| 11151025 | osm:way:1527090887 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 10330706 | osm:way:527449575 | 1 | unknown | safe_new | named_building | named_only | 0 | f |
| 7275935 | osm:relation:17734169 | ပရ‌ဆေးဥယျဉ် | agriculture | safe_new | named_building | named_only | 0 | f |
| 10923784 | osm:way:1354371546 | 富利大厦 | unknown | safe_new | named_building | named_only | 0 | f |
| 5810270 | osm:way:698448454 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 10898014 | osm:way:707570527 | บ้าน | unknown | safe_new | named_building | named_only | 0 | f |
| 5809771 | osm:way:696063381 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 5810654 | osm:way:696059445 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 9517678 | osm:way:688311350 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 7099801 | osm:way:1391092763 | Temple | unknown | safe_new | named_building | named_only | 0 | f |
| 11153168 | osm:way:519210454 | Recreation Centre | unknown | safe_new | named_building | named_only | 1 | f |
| 10898152 | osm:way:707575457 | บ้าน | unknown | safe_new | named_building | named_only | 0 | f |
| 6015637 | osm:way:286245849 | Union Civil Service Board | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 10898683 | osm:way:693686104 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 5602747 | osm:way:447327606 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 6017090 | osm:way:1053264753 | J - 6 | residential | safe_new | named_building | named_only | 0 | f |
| 10898243 | osm:way:707556104 | บ้าน | unknown | safe_new | named_building | named_only | 0 | f |
| 10795424 | osm:way:451303143 | Building 3 | unknown | safe_new | named_building | named_only | 0 | f |
| 7290648 | osm:way:479204523 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 5810820 | osm:way:694884365 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 5810171 | osm:way:696059481 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 7190454 | osm:way:1385160721 | Edificio 1 | unknown | safe_new | named_building | named_only | 0 | f |
| 9396913 | osm:way:835142942 | #hpe #hpegives #hpe_PR | unknown | safe_new | named_building | named_only | 0 | f |
| 5596110 | osm:way:478029114 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 6927654 | osm:way:933859700 | Garage of loods | unknown | safe_new | named_building | named_only | 0 | f |
| 10510080 | osm:way:525786756 | BLD | unknown | safe_new | named_building | named_only | 0 | f |
| 11127387 | osm:way:605340541 |  | unknown | pmtiles_only |  | matches_existing_core_building | 0 | t |
| 5616890 | osm:way:565024710 | Building(61) | unknown | safe_new | named_building | named_only | 1 | f |
| 9517496 | osm:way:688310886 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 6637595 | osm:way:1411077789 | bunker | unknown | safe_new | named_building | named_only | 0 | f |
| 5606204 | osm:way:565482283 |  | unknown | pmtiles_only |  | contains_nonpublic_place | 1 | f |
| 5602232 | osm:way:1057687200 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 10903904 | osm:way:691575129 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 5625140 | osm:way:522830706 | Building 1, Taw Win Housing | residential | safe_new | named_building | named_only | 1 | f |
| 8461187 | osm:way:491376354 | The Regency | commercial | safe_new | important_public_building | commercial_or_civic_weak | 0 | f |
| 11151120 | osm:way:1495558282 |  | residential | pmtiles_only |  | address_only | 0 | f |
| 6019294 | osm:way:1088737604 |  | unknown | pmtiles_only |  | address_only | 0 | f |
| 5809832 | osm:way:694897058 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 10898313 | osm:way:707551923 | บ้าน | unknown | safe_new | named_building | named_only | 0 | f |
| 9747961 | osm:way:526378841 | Farm house | unknown | safe_new | named_building | named_only | 0 | f |
| 5809649 | osm:way:696060712 | บ้าน | residential | safe_new | named_building | named_only | 0 | f |
| 5616414 | osm:way:672593647 |  | unknown | pmtiles_only |  | address_only | 0 | f |
### BASEMAP_ONLY (n=100)
| id | external_id | canonical_name | class_code | import_class | core_selection_reason | primary_reason | place_n | matches_core_building |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 9423848 | osm:way:654649790 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7665286 | osm:way:1378831679 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10828692 | osm:way:699397177 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7480733 | osm:way:634934732 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 5830826 | osm:way:1427381350 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8620032 | osm:way:1430670337 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9040671 | osm:way:717430905 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7751690 | osm:way:706840681 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10401402 | osm:way:575396083 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 5630439 | osm:way:565733457 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10601846 | osm:way:490184574 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7015569 | osm:way:1375335714 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10648991 | osm:way:516404345 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6584007 | osm:way:1414242386 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8350303 | osm:way:1419933907 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6484722 | osm:way:1409166697 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7596949 | osm:way:889627109 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10985061 | osm:way:575329089 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 11073947 | osm:way:650130143 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10127499 | osm:way:575047430 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6356697 | osm:way:1342645431 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8969146 | osm:way:1540234645 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10238257 | osm:way:526339598 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6303142 | osm:way:1340709112 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10335205 | osm:way:586779538 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8081045 | osm:way:1377731974 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6670195 | osm:way:1390719065 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9719168 | osm:way:501816703 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9059111 | osm:way:707854498 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7937683 | osm:way:365317360 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6308489 | osm:way:1342409498 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10621202 | osm:way:488535593 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6063374 | osm:way:1341020726 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6640013 | osm:way:1386551252 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7272388 | osm:way:1389971634 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8000091 | osm:way:402095262 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9781938 | osm:way:1482120567 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 11043950 | osm:way:666013199 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6209267 | osm:way:913417332 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7138845 | osm:way:870861705 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 5621273 | osm:way:565745392 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7148674 | osm:way:1375427194 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6536886 | osm:way:1414838642 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7483720 | osm:way:629180884 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8879367 | osm:way:1431930925 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9225506 | osm:way:834069104 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9520630 | osm:way:649011040 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7985952 | osm:way:365339023 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6422026 | osm:way:841567278 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10356893 | osm:way:539619212 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6650153 | osm:way:1386560988 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9582869 | osm:way:686159756 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8493681 | osm:way:596956988 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9921220 | osm:way:1490227500 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9318063 | osm:way:655741838 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8757675 | osm:way:1418562888 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9314756 | osm:way:724296467 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8148728 | osm:way:1374006154 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7502991 | osm:way:693690955 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6844710 | osm:way:1378591834 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7830946 | osm:way:628377621 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9099663 | osm:way:698332245 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6035310 | osm:way:1415526488 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8720103 | osm:way:1417654764 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10297606 | osm:way:547373403 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7766160 | osm:way:703786944 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7230691 | osm:way:1444121164 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 5765988 | osm:way:1429738018 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8529053 | osm:way:749368264 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 8546838 | osm:way:1176507856 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9360550 | osm:way:773991959 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10960390 | osm:way:627991323 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6874238 | osm:way:1387756290 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6024570 | osm:way:1385640037 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7620787 | osm:way:1377828792 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7470384 | osm:way:682210480 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10378670 | osm:way:536166996 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7885198 | osm:way:523015163 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10150049 | osm:way:597167064 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7332583 | osm:way:940943158 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6140955 | osm:way:1343552058 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9914549 | osm:way:560170696 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10969115 | osm:way:572860624 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7636839 | osm:way:1383024197 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7873864 | osm:way:793938592 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 5720125 | osm:way:423764696 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10279823 | osm:way:564185120 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9379693 | osm:way:691744673 |  | residential | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 6945056 | osm:way:1374397432 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9770873 | osm:way:652836168 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 5953206 | osm:way:1383567428 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10680679 | osm:way:572225767 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7011887 | osm:way:1376473937 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10797807 | osm:way:608301197 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 9532844 | osm:way:678685220 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 11096528 | osm:way:641817000 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 11072023 | osm:way:701649438 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7418235 | osm:way:674380604 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 10492444 | osm:way:532343802 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
| 7358189 | osm:way:734761034 |  | unknown | pmtiles_only |  | unnamed_ordinary_basemap | 0 | f |
### INVALID_OR_AMBIGUOUS (n=100)
| id | external_id | canonical_name | class_code | import_class | core_selection_reason | primary_reason | place_n | matches_core_building |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7257881 | osm:way:1381963427 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7257858 | osm:way:1382247065 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249614 | osm:way:1374702000 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7257801 | osm:way:1382247073 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7257889 | osm:way:1372674415 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11127211 | osm:way:605340659 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 5589605 | osm:way:479070575 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7254876 | osm:way:1381930525 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255068 | osm:way:1381619063 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7250653 | osm:way:1381617399 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254856 | osm:way:1381930526 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249801 | osm:way:1381609935 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 5589300 | osm:way:247166568 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7250678 | osm:way:1381617419 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249724 | osm:way:1381606884 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255026 | osm:way:1376576699 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249837 | osm:way:1373575401 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7250628 | osm:way:1381606923 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249861 | osm:way:1373575419 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249720 | osm:way:1381606929 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249781 | osm:way:1373579995 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11126747 | osm:way:604726886 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7255158 | osm:way:1376660728 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249706 | osm:way:1381609937 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249519 | osm:way:1381604096 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249748 | osm:way:1373003530 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249726 | osm:way:1373003534 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254927 | osm:way:1375341344 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249747 | osm:way:1373003526 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249873 | osm:way:1381601227 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254938 | osm:way:1372686067 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255018 | osm:way:1376427841 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249917 | osm:way:1373575333 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11126869 | osm:way:604752320 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7249793 | osm:way:1373580008 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11127950 | osm:way:605321623 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 11127089 | osm:way:604753517 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7249556 | osm:way:1374701606 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249624 | osm:way:1376576732 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254999 | osm:way:1381599727 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249783 | osm:way:1373003569 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249921 | osm:way:1375222308 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249741 | osm:way:1373003566 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249736 | osm:way:1381609943 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7257856 | osm:way:1382247064 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11127227 | osm:way:605340686 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7255012 | osm:way:1376427820 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249811 | osm:way:1373580057 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249773 | osm:way:1373044248 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249897 | osm:way:1373575352 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249547 | osm:way:1374701611 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249884 | osm:way:1375242201 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254866 | osm:way:1381613597 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11126524 | osm:way:418507491 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 1 | t |
| 7250595 | osm:way:1381606909 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255191 | osm:way:1381613632 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254874 | osm:way:1372686100 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11126531 | osm:way:1378652547 |  | healthcare | duplicate | hospital_or_clinic | duplicate_or_ambiguous_match | 0 | t |
| 5589328 | osm:way:531063200 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 7249611 | osm:way:1376576753 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249890 | osm:way:1375242210 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254880 | osm:way:1381930523 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249616 | osm:way:1374701618 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255061 | osm:way:1381619065 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249672 | osm:way:1373491340 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254948 | osm:way:1381617391 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249721 | osm:way:1373003548 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254898 | osm:way:1375341347 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255027 | osm:way:1376576700 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249695 | osm:way:1381606931 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7250589 | osm:way:1381606901 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255011 | osm:way:1376427839 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254805 | osm:way:1381617618 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7250634 | osm:way:1373044279 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249762 | osm:way:1381609978 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249639 | osm:way:1376576727 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254807 | osm:way:1381617408 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7255185 | osm:way:1381604101 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 11127127 | osm:way:604752310 |  | unknown | pmtiles_only |  | duplicate_or_ambiguous_match | 0 | f |
| 11126529 | osm:way:1378652545 |  | healthcare | duplicate | hospital_or_clinic | duplicate_or_ambiguous_match | 0 | t |
| 7255112 | osm:way:1373491365 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249696 | osm:way:1381606930 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7256582 | osm:way:1376660717 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249728 | osm:way:1373003522 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249774 | osm:way:1373003655 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254989 | osm:way:1381618464 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7257791 | osm:way:1382248982 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249842 | osm:way:1373575402 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249546 | osm:way:1374701609 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249483 | osm:way:1375222257 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249557 | osm:way:1374701612 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249870 | osm:way:1373575417 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249739 | osm:way:1373579992 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249831 | osm:way:1373575397 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249545 | osm:way:1374701608 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249620 | osm:way:1376576757 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7250645 | osm:way:1381617395 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7254942 | osm:way:1381930521 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249763 | osm:way:1381609979 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |
| 7249503 | osm:way:1375242265 |  | unknown | pmtiles_only |  | demolished_building_tag | 0 | f |

---

## 16. Bottom line

1. National building source of truth for this lab run is **`staging.staging_building_candidates`** (complete vs raw for snapshot 13).
2. **~99.4%** are basemap-only ordinary footprints.
3. Under conservative rules, **23,198** are STRONG Core candidates; **10,522** need review; **720** are invalid/ambiguous.
4. **Maximum safe first Core import:** **13,805** (`safe_new` + important_type + not already in Core).  
   **Recommended pilot:** **1,540** named important-type rows.
5. Reconcile the **6,752** STRONG∩`pmtiles_only` rows before relying on pipeline `eligible_for_core` alone.
6. Do not promote named-only, address-only, or commercial-weak buildings without manual review.
