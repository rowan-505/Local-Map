# Buildings storage separation — inspection report

**Status:** Read-only inspection only. No schema/table created. No database writes.  
**Inspected at:** 2026-07-31  
**Local DB:** `geo_core` on localhost (Docker/`172.17.0.2`)  
**Supabase production:** project `locghyuranqaqsnbxflc` (`core` schema live)

---

## 1. Verdict

Current national building candidates live in **one local staging table** only:

| Location | Table | Role today |
|----------|-------|------------|
| **Local** `staging.staging_building_candidates` | 5,578,282 rows (snapshot 13) | All national OSM buildings after Stage 05 + classify |
| **Local** `raw.raw_osm_polygons` | 5,578,282 building-tagged polygons | Immutable raw archive for same snapshot |
| **Local** `core.*` | **Does not exist** | No local Core schema |
| **Local** `basemap_source.*` | **Does not exist** | Planned destination only |
| **Local** `prod_mirror.core_map_buildings` | 1,133 rows | Mirror of production Core (not authoritative) |
| **Supabase** `core.core_map_buildings` | 1,133 rows | Mixed managed + ordinary footprints |

Exact classify buckets on local staging (snapshot 13):

| `import_class` | Count | `eligible_for_core` |
|----------------|------:|---------------------|
| `pmtiles_only` | **5,555,482** | false |
| `safe_new` | **22,703** | true |
| `safe_update` | **82** | true |
| `duplicate` | **15** | true |
| **Total** | **5,578,282** | |

`safe_new` + `safe_update` = **22,785** (matches the “~22k safe” planning figure).  
`pmtiles_only` = **5,555,482** (matches the “~5.5M pmtiles_only” figure).

**PMTiles today does not read staging.** Regional export uses `tiles.tiles_buildings_v` → Supabase/Core only (~1,125 active footprints). The 5.5M ordinary footprints are **not** yet in any persistent basemap table and are **not** exported to PMTiles.

---

## 2. Pipeline map (local-osm buildings)

### 2.1 Flow

```text
PBF → osm2pgsql tmp_import
  → raw.raw_osm_polygons (source_snapshot_id)
  → staging.staging_building_candidates   [Stage 05]
  → validation / content hash             [Stage 05b]
  → eligible_for_core / pmtiles_only_*    [Stage 05c]
  → F1/F2 diffs                           [Stages 06–07]
  → match_status / import_class           [Stages 08 / 08b]
  → optional IR package (conflicts only)  [Stage 11+]
  → optional direct-core CSV export       [tools/data-pipeline/direct-core]
```

Local-osm **never writes Supabase `core`**. Promotion is a separate direct-core path.

### 2.2 Key scripts

| Step | Script | Effect on buildings |
|------|--------|---------------------|
| Extract | `05_raw_to_staging.sql` | Inserts from `raw_osm_polygons` where `tags ? 'building'` |
| Reset | `pipeline_stage05_reset.sql` | **DELETE** current-snapshot rows in `staging_building_candidates` before regenerate |
| Core vs PMTiles | `pipeline_core_pmtiles_selection.sql` + `pipeline_stage05c_core_pmtiles_selection.sql` | Sets `eligible_for_core`, `core_selection_reason`, `pmtiles_only_reason` |
| Classify | `08_assign_statuses.sql`, `08b_assign_import_class.sql` | Sets `import_class` (`pmtiles_only` when not core-eligible) |
| National core-only shortcut | `national_buildings_core_eligible_stage.sql` + `run_national_buildings_classify.sh` | **DELETE all snapshot buildings**, then insert **only** core-eligible |
| Full national footprints | `imports/_batch/myanmar_national_buildings_all_geom.env` | Full Stage 05 for all ~5.58M |
| Direct-core export | `direct-core/export/export_buildings.sql` | CSV of `safe_new`/`safe_update` only |
| Direct-core apply | `direct-core/sql/buildings.sql` | Writes Supabase `core.core_map_buildings` (+ names, publish audit) |
| PMTiles export | `infrastructure/tiles/pmtiles/scripts/export-region.sh` | `buildings` ← `tiles.tiles_buildings_v` (Core-backed view) |

### 2.3 Snapshot holding the national set

| Field | Value |
|-------|-------|
| `system.system_source_snapshots.id` | **13** |
| `snapshot_ref` | `myanmar-260721.osm.pbf` |
| `snapshot_version` | `osm_myanmar_2026_07_21_national_dry_run_v1` |
| `region_code` | `MM` |
| `boundary_id` | NULL (whole-country) |

Raw building polygons for snapshot 13: **5,578,282** (equals staging count).

---

## 3. Local candidate table (exact)

### 3.1 Table

`staging.staging_building_candidates`

- **Size:** ~28 GB total (heap ~22 GB, indexes ~5.3 GB)
- **Geometry:** `geom geometry(MultiPolygon,4326)` NOT NULL  
- **No** `centroid` / `area_m2` / `levels` / `height_m` / `building_type_id` / `admin_area_id` columns (those values live inside `normalized_data` JSON when present)
- **No UNIQUE** on `(source_snapshot_id, external_id)` — only btree on `external_id` and PK on `id`

### 3.2 Columns (live)

| Column | Type | Null | Default / notes |
|--------|------|------|-----------------|
| `id` | bigint | NO | sequence PK |
| `source_snapshot_id` | bigint | NO | FK-ish to snapshots |
| `raw_id` | bigint | NO | `raw.raw_osm_polygons.id` |
| `external_id` | text | NO | canonical `osm:way:<id>` / `osm:relation:<id>` |
| `canonical_name` | text | YES | nonempty check if present |
| `class_code` | text | NO | pipeline class bucket |
| `normalized_data` | jsonb | NO | `{}` |
| `source_refs` | jsonb | NO | `{}` |
| `confidence_score` | numeric | NO | default 70 (0–100) |
| `match_status` | text | NO | default `new` |
| `geom` | geometry | NO | MultiPolygon 4326 |
| `created_at` / `updated_at` | timestamptz | NO | |
| `auto_action` | text | YES | |
| `review_status` | text | NO | default `pending` |
| `review_decision` / `reviewed_by` / `reviewed_at` / `review_note` | mixed | YES | |
| `normalized_hash` | text | YES | Stage 05 hash |
| `validation_status` / `validation_notes` | text/jsonb | YES | |
| `source_status` | text | YES | |
| `geometry_hash` | text | YES | |
| `import_class` | text | YES | classify result |
| `import_class_reason` | jsonb | YES | |
| `eligible_for_core` | boolean | YES | Stage 05c |
| `core_selection_reason` | text | YES | |
| `pmtiles_only_reason` | text | YES | |

### 3.3 Source identity format (local staging)

| Format | Count |
|--------|------:|
| `osm:way:<id>` | 5,577,528 |
| `osm:relation:<id>` | 754 |
| Compact `osm:W:` / bare numeric | **0** |

Built by `system.pipeline_osm_external_id(osm_feature_type, osm_id)` → `osm:way|relation:<id>`.

**Duplicate `external_id` within staging:** **0** groups.

### 3.4 Status / class breakdowns (local staging)

**Import class × eligibility:** see §1.

**`core_selection_reason` (eligible only, 22,800 rows):**

| Reason | Count |
|--------|------:|
| `named_building` | 8,118 |
| `hospital_or_clinic` | 6,984 |
| `important_landmark` | 3,232 |
| `school_or_university` | 1,987 |
| `government_building` | 663 |
| `market` | 641 |
| `station_or_terminal` | 632 |
| `important_public_building` | 539 |
| `linked_to_important_place` | 4 |

**`pmtiles_only_reason`:** essentially all `unnamed_ordinary_building`.

**Top `class_code` (all rows):**

| class_code | Count |
|------------|------:|
| `unknown` | 5,521,132 |
| `residential` | 42,919 |
| `healthcare` | 6,899 |
| `religious` | 2,304 |
| `education` | 1,773 |
| `industrial` | 1,231 |
| `commercial` | 1,076 |
| `transport` | 544 |
| others | <300 each |

**Match / review (all rows):**

| Field | Dominant value | Count |
|-------|----------------|------:|
| `match_status` | `new_auto` | 5,577,191 |
| `auto_action` | `insert_candidate` | 5,577,191 |
| `review_status` | `pending` | 5,578,279 |

**Names on core-eligible rows:**

| Metric | Count |
|--------|------:|
| `canonical_name` present | 10,049 |
| `normalized_data.names` nonempty array | **0** |

Stage 05 / current snapshot did **not** populate the migration-153 names array into staging JSON. Direct-core export falls back to tags + `canonical_name`.

### 3.5 Raw source table

`raw.raw_osm_polygons`:

| Column | Type |
|--------|------|
| `id`, `source_snapshot_id` | bigint |
| `osm_feature_type`, `osm_id` | text |
| `geom` | MultiPolygon 4326 |
| `tags`, `raw_payload` | jsonb |
| `ingested_at` | timestamptz |

---

## 4. Where the 5.5M and 22k live (exact)

| Group | Exact table | Filter | Count |
|-------|-------------|--------|------:|
| PMTiles-only footprints | **Local** `staging.staging_building_candidates` | `import_class = 'pmtiles_only'` | **5,555,482** |
| Safe Core inserts | same | `import_class = 'safe_new'` | **22,703** |
| Safe Core updates | same | `import_class = 'safe_update'` | **82** |
| Duplicate class | same | `import_class = 'duplicate'` | **15** |
| Raw archive | **Local** `raw.raw_osm_polygons` | snapshot 13 + `tags ? 'building'` | **5,578,282** |

There is **no** second local table already holding the 5.5M set. Staging is the only classified store. Staging is **pipeline-ephemeral** under Stage 05 reset / core-eligible DELETE.

---

## 5. Core definitions

### 5.1 Local Core

**Absent.** `pg_namespace` has no `core` schema on `geo_core`.

Closest local copy: `prod_mirror.core_map_buildings` (1,133 rows). Mirror columns observed:

`core_id`, `id`, `public_id`, `external_id`, `source_refs`, `name`, `building_type_id`, `admin_area_id`, `geom`, `centroid`, `is_verified`, `verification_status`, `deleted_at`, `updated_at`, `created_at`, `geometry_hash`, `source_content_hash`

Mirror is **not** identical to live Supabase (see §5.2 — production lacks migration 149 columns).

### 5.2 Supabase `core.core_map_buildings` (live columns)

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint PK | sequence |
| `source_staging_id` | bigint | nullable |
| `external_id` | text | nullable; nonempty check if set; **non-unique** btree only |
| `name` | text | **deprecated** for writes; still populated historically |
| `normalized_data` | jsonb | NOT NULL |
| `source_refs` | jsonb | NOT NULL |
| `geom` | MultiPolygon 4326 | NOT NULL |
| `is_active` | boolean | default true |
| `created_at` / `updated_at` | timestamptz | |
| `public_id` | uuid | UNIQUE |
| `centroid` | Point 4326 | nullable |
| `area_m2` | numeric | |
| `levels` | int | |
| `height_m` | numeric | |
| `confidence_score` | numeric | default 80 |
| `is_verified` | boolean | default false |
| `created_by` / `updated_by` | bigint | |
| `deleted_at` | timestamptz | soft delete |
| `building_type_id` | bigint FK → `ref.ref_building_types` | |
| `admin_area_id` | bigint FK → `core.core_admin_areas` | **two live FKs** (duplicate constraint names) |
| `verification_status` | text | `unverified\|verified\|needs_fix\|questionable\|rejected_after_core_review` |
| `verified_at` / `verified_by` / `verification_note` | mixed | |

**Not present on production (migration 149 not applied):**

- `source_registry_id`, `source_snapshot_id`, `source_feature_type`, `source_feature_id`, `region_code`
- `is_geometry_manually_edited`, `is_attributes_manually_edited`
- Also absent vs some docs/mirrors: `geometry_hash`, `source_content_hash`

Direct-core SQL **expects** migration 149 columns. Applying national/regional direct-core buildings without 149 will fail.

---

## 6. Related building tables (Supabase)

| Schema.table | Kind | Size / count | Role |
|--------------|------|--------------|------|
| `core.core_map_building_names` | table | 259 rows | Canonical names (`my`/`en`/`und`; types official/local/imported/…) |
| `core.core_place_buildings` | table | 51 links | Place↔building (`relation_type` `inside`) |
| `ref.ref_building_types` | table | ref | Type codes |
| `ref.ref_building_type_merge_map` | table | ref | Type merge map |
| `import_review.building_candidates` | table | 15 pending | IR queue |
| `tiles.tiles_buildings_v` | view | — | PMTiles/Martin source from Core + names |
| `search.v_search_buildings_source` | view | — | Search source over Core buildings |
| `system.backup_core_map_buildings_before_building_type_simplification` | backup table | empty-ish | Historical backup |
| `import_review.address_candidates.matched_building_id` | FK | 0 rows set | Soft dependency |

**No dedicated building history/audit table** found. Direct-core writes `system.system_publish_batches` / `system.system_publish_items` (`entity_family='buildings'`; current count **0** on production).

Local building-related objects: staging candidates + review views; `prod_mirror.core_map_buildings`; FDW foreign table `supabase_fdw.core_map_buildings`.

---

## 7. Existing Core row counts

### 7.1 Local Core

**N/A** (no `core` schema). Use `prod_mirror` only as a non-authoritative mirror of production counts (1,133).

### 7.2 Supabase Core (`core.core_map_buildings`)

| Metric | Count |
|--------|------:|
| Total rows | **1,133** |
| `deleted_at` IS NULL | 1,125 |
| Soft-deleted | 8 |
| `is_active` true | 1,125 |
| `is_active` false | 8 |
| `is_verified` / `verification_status='verified'` | 6 / 6 |
| Unverified | 1,127 |
| Legacy `name` present | 205 |
| Name table nonempty | 197 active |
| No name anywhere (active) | 928 |
| Has `external_id` | 1,019 |
| Missing `external_id` | 114 |
| Has `admin_area_id` | 1,133 |
| Has `building_type_id` | 1,116 |
| Has `source_staging_id` | 969 |
| Place-linked buildings | **51** |
| Name rows total | 259 |

**`source_refs->>'source'`:**

| Value | Count |
|-------|------:|
| (no `source` key) | 1,019 |
| `dashboard` | 114 |

**Building type codes:**

| code | Count |
|------|------:|
| residential | 579 |
| industrial | 230 |
| unknown | 150 |
| commercial | 58 |
| religious | 56 |
| (null type) | 17 |
| government_civic | 16 |
| education | 12 |
| healthcare | 10 |
| recreation | 3 |
| transport | 2 |

**Conservative KEEP preview (active only, read-only heuristic):**

| Bucket | Count |
|--------|------:|
| Strict keep (verified OR dashboard/manual source OR place-linked OR curated official/local name OR missing external_id) | **157** |
| Keep if also any name | **198** |
| Ordinary unnamed (candidate to leave Core / move concept to basemap) | **927** |
| …of which residential/unknown/industrial | 889 |

This is **not** an apply plan — only evidence that most production Core rows look like ordinary footprints.

---

## 8. Duplicate / collision risks (`external_id`)

### 8.1 Formats in Supabase Core

| Format | Count | `pipeline_osm_identity_key` |
|--------|------:|-----------------------------|
| Compact `osm:W:` / `osm:N:` / `osm:R:` | 953 | OK → `osm:way|node|relation:<id>` |
| Verbose `osm:way:` / `osm:relation:` | 50 | OK |
| Bare numeric (`604729710`) | 16 | **NULL** (cannot normalize without assuming type) |
| Blank / null | 114 | NULL |

Canonicalizer: `system.pipeline_osm_identity_key` equates `osm:W:123` ≡ `osm:way:123`. Bare numeric returns NULL.

### 8.2 Collision findings

| Check | Result |
|-------|--------|
| Exact duplicate `external_id` in Core | **0** |
| Duplicate after `pipeline_osm_identity_key` in Core | **0** |
| Unique constraint on Core `external_id` | **None** (btree only) |
| Unique typed identity (registry+type+id) | **Blocked** until migration 149 |
| Local staging duplicate `external_id` | **0** |
| `safe_update` exact string match → prod_mirror | 50 |
| `safe_update` identity-key match → prod_mirror | **82** |
| `safe_new` identity-key collision → prod_mirror | **0** |

**Risks that block safe automation:**

1. **Three live identity dialects** (compact, verbose, bare) plus blank IDs.
2. Bare numeric rows need `source_refs.osm_id` + assumed feature type (`way` default is unsafe for relations).
3. Missing external_id (114) — treat as **managed / do not auto-delete** (likely dashboard-created).
4. `national_buildings_core_eligible_stage.sql` builds `osm:N|W|R:` compact IDs, while Stage 05 builds verbose `osm:way:` — both normalize, but raw string compares fail.
5. No UNIQUE on normalized identity → future double-load can insert duplicates until 149’s unique index exists.
6. Fifteen staging `duplicate` rows (Kyauktan-ish identities) need human/policy handling before Core apply.

### 8.3 Node / way / relation

Local national buildings: **ways + relations only** (no nodes).  
Direct-core rejects `source_feature_type NOT IN ('way','relation')`.  
Core check constraint in migration 149 also allows only way/relation.

---

## 9. Reset / cleanup risks to planned `basemap_source`

`basemap_source` **does not exist** today. No script currently drops it by name.

Scripts that **would destroy building footprints if those footprints stay only in staging**:

| Script | Dangerous action |
|--------|------------------|
| `pipeline_stage05_reset.sql` | `DELETE FROM staging_building_candidates WHERE source_snapshot_id = current` |
| `national_buildings_core_eligible_stage.sql` | `DELETE` all snapshot buildings, re-insert **core-eligible only** (wipes 5.5M) |
| `run_national_buildings_classify.sh` | Invokes the DELETE above before classify |
| `admin-fast-core/00_cleanup_current_snapshot.sql` | `DROP SCHEMA IF EXISTS <tmp_admin_schema> CASCADE` (admin tmp only; **not** basemap) |
| `transport-fast-publish/.../00_prepare_local_transport_import.sql` | `DROP SCHEMA IF EXISTS tmp_transport_import CASCADE` (transport only) |

**Requirement:** persist ordinary footprints in `basemap_source.buildings` **before** any re-run of Stage 05 buildings or the core-eligible shortcut. Stage 05 must never target `basemap_source`.

---

## 10. PMTiles building export — inputs and required fields

### 10.1 Current path

```text
DATABASE_URL (usually Supabase)
  → tiles.tiles_buildings_v
  → ogr2ogr → exports/<region>/buildings.geojson
  → prepare-tippecanoe-input.py (minzoom 14, maxzoom 20)
  → tippecanoe layer name `buildings`
```

### 10.2 `tiles.tiles_buildings_v` output columns

`id`, `public_id`, `name_mm`, `name_en`, `name_und`, `name_my`, `name`, `building_type_id`, `building_type`, `building_type_code`, `building_type_name`, `building_type_name_mm`, `levels`, `height_m`, `area_m2`, `confidence_score`, `is_verified`, `geom`, `admin_area_id`, `admin_area_name`

Filter: `is_active IS TRUE AND deleted_at IS NULL`.

### 10.3 What the public style actually uses

`packages/map-style/base-map.json` layer `buildings` is a **fill** with fixed colors. It reads **no feature properties** — only geometry + `source-layer: buildings`.

So for **ordinary basemap footprints**, tippecanoe strictly needs:

| Field | Required? |
|-------|-----------|
| Polygon/MultiPolygon geometry (EPSG:4326) | **Yes** |
| Any name/type attributes | **No** for current public style |
| Stable feature id | Recommended for tippecanoe / debugging |

Martin/dashboard may still want Core-backed attributes for named/managed buildings via the existing view.

### 10.4 Gap

Ordinary 5.5M footprints are classified `pmtiles_only` but **have no export path**. National basemap buildings cannot be built from Core alone without either:

- loading ordinary footprints into Core (rejected architecture), or
- exporting from a new local `basemap_source.buildings` (recommended).

---

## 11. Source → destination column mapping

### 11.1 Staging `pmtiles_only` → proposed `basemap_source.buildings`

| Source (`staging.staging_building_candidates`) | Destination (`basemap_source.buildings`) | Transform |
|-----------------------------------------------|------------------------------------------|-----------|
| `id` | `source_staging_id` | copy (lineage only) |
| `source_snapshot_id` | `source_snapshot_id` | copy |
| `raw_id` | `raw_id` | copy |
| `external_id` | `external_id` | prefer `system.pipeline_osm_identity_key(external_id)` |
| `source_refs->>'osm_feature_type'` / identity parse | `osm_feature_type` | `way` \| `relation` |
| identity id part | `osm_id` | bigint |
| `geom` | `geom` | keep MultiPolygon 4326; `ST_Multi(ST_CollectionExtract(ST_MakeValid(geom),3))` if needed |
| `class_code` | `class_code` | copy |
| `canonical_name` | `canonical_name` | copy (usually NULL for pmtiles_only) |
| `normalized_data` | `normalized_data` | copy |
| `source_refs` | `source_refs` | copy + loader stamp |
| `geometry_hash` / hash(geom) | `geometry_hash` | copy or recompute |
| `normalized_hash` | `content_hash` | copy or recompute |
| `pmtiles_only_reason` | `pmtiles_only_reason` | copy |
| — | `imported_at` | `now()` |
| — | `updated_at` | `now()` |

Do **not** copy review workflow columns (`match_status`, `auto_action`, `review_*`, `import_class`) into the persistent basemap table.

### 11.2 Staging `safe_new`/`safe_update` → Supabase Core (existing direct-core)

From `export_buildings.sql` / `sql/buildings.sql`:

| Export CSV / staging | Core column |
|----------------------|-------------|
| `pipeline_osm_identity_key(external_id)` | `external_id` (+ typed identity cols after 149) |
| `name_my` / `name_en` / `name_und` | `core_map_building_names` only (legacy `name` left NULL on insert) |
| `building_type_id` | `building_type_id` |
| `admin_area_id` | `admin_area_id` |
| `geom_ewkt` | `geom` + derived `centroid`, `area_m2` |
| `levels`, `height_m`, `confidence_score` | same |
| `source_refs`, `normalized_data` | merged with loader metadata |
| classification | drives insert vs update |

### 11.3 Core → tiles (managed only)

Existing `tiles.tiles_buildings_v` mapping unchanged (Core + `core_map_building_names` + `ref_building_types` + admin name).

---

## 12. Proposed `basemap_source.buildings` DDL (proposal only — do not apply in this task)

Minimal persistent local table, no partitions, no lifecycle subsystem:

```sql
-- PROPOSAL ONLY. Not applied.
CREATE SCHEMA IF NOT EXISTS basemap_source;

CREATE TABLE basemap_source.buildings (
  id                    bigserial PRIMARY KEY,
  external_id           text NOT NULL,
  osm_feature_type      text NOT NULL CHECK (osm_feature_type IN ('way', 'relation')),
  osm_id                bigint NOT NULL CHECK (osm_id > 0),
  source_snapshot_id    bigint NOT NULL,
  raw_id                bigint,
  source_staging_id     bigint,
  class_code            text NOT NULL,
  canonical_name        text CHECK (canonical_name IS NULL OR btrim(canonical_name) <> ''),
  geom                  geometry(MultiPolygon, 4326) NOT NULL,
  normalized_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_refs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  geometry_hash         text,
  content_hash          text,
  pmtiles_only_reason   text,
  imported_at           timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basemap_buildings_external_id_chk CHECK (btrim(external_id) <> '')
);

CREATE UNIQUE INDEX basemap_buildings_identity_uidx
  ON basemap_source.buildings (osm_feature_type, osm_id);

CREATE UNIQUE INDEX basemap_buildings_external_id_uidx
  ON basemap_source.buildings (external_id);

CREATE INDEX basemap_buildings_geom_gix
  ON basemap_source.buildings USING gist (geom);

CREATE INDEX basemap_buildings_snapshot_idx
  ON basemap_source.buildings (source_snapshot_id);
```

Optional later (not required for v1): `tiles.tiles_basemap_buildings_v` selecting `id`, `geom` (and maybe `class_code`) for ogr2ogr.

---

## 13. Conservative Core classification rules

### 13.1 Keep in Supabase `core.core_map_buildings` (managed)

Keep a row if **any** of:

1. `is_verified` OR `verification_status = 'verified'`
2. `source_refs` indicates dashboard/manual (`source` in `dashboard`,`manual` OR future manual-edit flags after 149)
3. Linked via `core.core_place_buildings` (existing links only; **do not implement new POI linking now**)
4. Has curated name: `core_map_building_names.name_type IN ('official','local','manual')`  
   (note: live check constraint has no `manual` type today — only official/local/imported/…)
5. Missing `external_id` (cannot safely reconcile to OSM basemap identity)
6. Soft-deleted rows: retain for audit; do not move to basemap
7. Import-review / publish lineage that marks intentional Core promotion (when present)

Optional broader keep (more Core growth): any nonempty name (legacy or names table). That expands keep from ~157 → ~198 active.

### 13.2 Do **not** auto-delete from Core yet

Do not auto-remove the ~927 ordinary unnamed active rows until:

1. `basemap_source.buildings` is populated and PMTiles export proven  
2. Identity normalization + migration 149 applied  
3. Explicit operator approval with backup/PITR gate  
4. Search / Martin / dashboard smoke tests pass without those rows

### 13.3 Staging → Core eligibility (already implemented)

Keep using `system.pipeline_select_core_vs_pmtiles('buildings', …)`:

- important type / named / linked-to-important-place → Core path  
- else → `pmtiles_only` → basemap_source path  

**Ambiguities that prevent fully safe automated Core cleanup:**

| Ambiguity | Why it blocks automation |
|-----------|--------------------------|
| Mixed external_id dialects + bare IDs | Matching to basemap/OSM can miss or false-match |
| Migration 149 absent | No typed unique identity; no manual-edit flags |
| `linked_to_important_place` almost unused in staging (4) while Core has 51 place links | Spatial link policy ≠ stored place_buildings |
| `important_public_building` / `commercial` / weak `named_building` | May over-promote low-value names into Core |
| Staging `normalized_data.names` empty | Name quality for promote depends on tags/`canonical_name` only |
| Local has no Core | Cannot rehearse Core deletes locally against real `core.*` |
| Ordinary footprints already in production Core | Cleanup is a production data change, not just import routing |

---

## 14. Dependencies that block deletion of Core / staging buildings

### 14.1 Cannot drop/truncate production Core buildings casually

| Dependency | Effect |
|------------|--------|
| `core.core_map_building_names` FK `ON DELETE CASCADE` | Names deleted with building |
| `core.core_place_buildings` FK `ON DELETE CASCADE` | 51 links deleted with building |
| `import_review.address_candidates.matched_building_id` FK | Blocks delete if set (currently 0) |
| `tiles.tiles_buildings_v` | Martin + PMTiles export shrink |
| `search.v_search_buildings_source` | Search results shrink |
| Dashboard / API building modules | Expect Core rows for managed buildings |
| Duplicate admin_area FKs | Schema smell; unrelated to counts but touch ALTER carefully |

### 14.2 Cannot treat staging as disposable until basemap_source exists

| Dependency | Effect |
|------------|--------|
| Only store of 5.5M classified footprints | Stage 05 / core-eligible DELETE destroys national basemap input |
| Direct-core export reads staging `safe_*` | Needs core-eligible rows retained until exported/applied |
| Snapshot 13 raw polygons | Rebuild possible but expensive (~hours); classified columns would need recompute |

---

## 15. Ordered execution plan (recommended)

1. **Freeze destructive local ops** for buildings: do not run Stage 05 buildings reset or `run_national_buildings_classify.sh` until basemap_source is loaded (or a dump of staging buildings exists).
2. **Document + backup:** local `pg_dump` of `staging.staging_building_candidates` for snapshot 13 (or COPY of `pmtiles_only` subset). Supabase managed backup/PITR gate before any Core cleanup.
3. **Apply migration 149** on Supabase (typed identity + manual flags) after verification SQL — required before further direct-core applies.
4. **Create `basemap_source.buildings`** via migration on **local** geo_core only (proposal §12).
5. **Load** `import_class='pmtiles_only'` (and optionally decide whether Core-eligible footprints also copy to basemap for complete tile coverage — recommend **yes for geometry-only tiles**, Core remains search/API source).
6. **Add tile export path** from `basemap_source.buildings` (new view or SQL in export-region) and rebuild one pilot region PMTiles; confirm style still works with geometry-only features.
7. **Regional direct-core** for `safe_new`/`safe_update` only (22,785), after 149 + identity checks; exclude `duplicate` (15) until reviewed.
8. **Classify existing Core rows** with conservative KEEP rules; produce a review list of ~927 ordinary unnamed candidates — **do not delete** until tiles proven.
9. **Only then** soft-delete or move ordinary Core footprints out of search/Martin views (prefer soft-delete + view filter over hard DELETE).
10. **Hardening:** Stage 05/reset must never touch `basemap_source`; add explicit allowlist schemas for DROP SCHEMA scripts; unique identity indexes on Core after 149 backfill.

---

## 16. Rollback strategy

| Phase | Rollback |
|-------|----------|
| Local basemap_source create/load | `DROP TABLE/SCHEMA basemap_source` (local only) or truncate table; staging still holds source until deliberately cleaned |
| Local staging wipe accident | Restore from dump / re-extract Stage 05 from `raw` snapshot 13 + re-run 05c/08b |
| Failed direct-core region apply | Use `system.system_publish_items` before/after payloads; soft-delete inserted ids; restore updated rows from `before_data` |
| Supabase Core cleanup gone wrong | PITR / managed backup restore; scoped `pg_dump` of buildings/names/links taken pre-cleanup (see national building runbook backup evidence) |
| PMTiles wrong buildings | Republish previous region PMTiles artifact; tiles are not source of truth |

Keep **raw** + **staging dump** + **Supabase backup** as three independent recovery layers.

---

## 17. SQL verification queries (read-only)

### 17.1 Local — staging groups

```sql
SELECT import_class, eligible_for_core, count(*)
FROM staging.staging_building_candidates
GROUP BY 1, 2
ORDER BY count(*) DESC;

SELECT
  count(*) FILTER (WHERE import_class = 'pmtiles_only') AS pmtiles_only,
  count(*) FILTER (WHERE import_class = 'safe_new') AS safe_new,
  count(*) FILTER (WHERE import_class = 'safe_update') AS safe_update,
  count(*) FILTER (WHERE import_class = 'duplicate') AS duplicate
FROM staging.staging_building_candidates;
```

### 17.2 Local — identity + snapshot

```sql
SELECT id, snapshot_version, region_code
FROM system.system_source_snapshots WHERE id = 13;

SELECT
  CASE
    WHEN external_id ~ '^osm:way:' THEN 'osm:way'
    WHEN external_id ~ '^osm:relation:' THEN 'osm:relation'
    ELSE 'other'
  END AS kind,
  count(*)
FROM staging.staging_building_candidates
GROUP BY 1;
```

### 17.3 Local — collision vs prod_mirror

```sql
SELECT count(*) AS safe_update_identity_matches
FROM staging.staging_building_candidates s
JOIN prod_mirror.core_map_buildings p
  ON system.pipeline_osm_identity_key(p.external_id)
   = system.pipeline_osm_identity_key(s.external_id)
WHERE s.import_class = 'safe_update';

SELECT count(*) AS safe_new_identity_collisions
FROM staging.staging_building_candidates s
JOIN prod_mirror.core_map_buildings p
  ON system.pipeline_osm_identity_key(p.external_id)
   = system.pipeline_osm_identity_key(s.external_id)
WHERE s.import_class = 'safe_new';
```

### 17.4 Supabase — Core inventory

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE deleted_at IS NULL) AS live,
  count(*) FILTER (WHERE is_verified OR verification_status = 'verified') AS verified,
  count(*) FILTER (WHERE external_id IS NULL OR btrim(external_id) = '') AS missing_external_id
FROM core.core_map_buildings;

SELECT
  CASE
    WHEN external_id IS NULL OR btrim(external_id) = '' THEN 'blank'
    WHEN external_id ~ '^[0-9]+$' THEN 'bare_numeric'
    WHEN external_id ~ '^osm:[NWR]:' THEN 'compact'
    WHEN external_id ~ '^osm:(way|node|relation):' THEN 'verbose'
    ELSE 'other'
  END AS fmt,
  count(*),
  count(system.pipeline_osm_identity_key(external_id)) AS with_identity_key
FROM core.core_map_buildings
GROUP BY 1
ORDER BY 2 DESC;
```

### 17.5 Supabase — keep vs ordinary preview

```sql
WITH b AS (
  SELECT * FROM core.core_map_buildings WHERE deleted_at IS NULL
), flags AS (
  SELECT b.id,
    (b.is_verified OR lower(b.verification_status) = 'verified') AS is_ver,
    (b.source_refs @> '{"source":"dashboard"}'::jsonb
      OR b.source_refs @> '{"source":"manual"}'::jsonb) AS is_manual_src,
    EXISTS (SELECT 1 FROM core.core_place_buildings pb WHERE pb.building_id = b.id) AS is_linked,
    EXISTS (
      SELECT 1 FROM core.core_map_building_names n
      WHERE n.building_id = b.id AND n.name_type IN ('official', 'local')
    ) AS has_curated_name,
    (b.external_id IS NULL OR btrim(coalesce(b.external_id, '')) = '') AS missing_ext
  FROM b
)
SELECT
  count(*) AS active,
  count(*) FILTER (
    WHERE is_ver OR is_manual_src OR is_linked OR has_curated_name OR missing_ext
  ) AS keep_strict,
  count(*) FILTER (
    WHERE NOT (is_ver OR is_manual_src OR is_linked OR has_curated_name OR missing_ext)
  ) AS ordinary_candidates
FROM flags;
```

### 17.6 After basemap_source exists (future)

```sql
SELECT count(*) FROM basemap_source.buildings;
SELECT count(*) FROM basemap_source.buildings b
WHERE NOT EXISTS (
  SELECT 1 FROM staging.staging_building_candidates s
  WHERE s.import_class = 'pmtiles_only'
    AND system.pipeline_osm_identity_key(s.external_id) = b.external_id
);
```

---

## 18. Minimal architecture recommendation

```text
Local persistent:   basemap_source.buildings     ← ordinary national footprints (1 table)
Local ephemeral:    staging.staging_building_candidates  ← classify only
Local archive:      raw.raw_osm_polygons
Supabase managed:   core.core_map_buildings (+ names, place links)
Tiles:              basemap footprints from basemap_source; managed attributes from tiles_buildings_v
```

- **One** persistent local buildings table for ordinary footprints  
- **No** partitioning  
- **No** new lifecycle/status subsystem on basemap_source  
- **Do not** implement POI-building linking in this separation work  
- **Do not** put 5.5M ordinary footprints into Supabase Core  

---

## 19. Inspection limits / honesty

- Read-only SQL only; no DDL/DML applied.  
- Local `core` absent — “local Core counts” are N/A.  
- `prod_mirror` column set differs from live Supabase; do not treat mirror DDL as production truth.  
- Migration 149/150 production apply status: **149 columns absent** on live Core (matches prior NO-GO runbook).  
- Name extraction into staging `normalized_data.names` is currently empty for this snapshot — verify migration 153 helpers on local before the next Stage 05 buildings extract.  
- Exact wall-clock for a full Stage 05 rebuild from raw was not re-measured in this inspection.
