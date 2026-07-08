---
status: archived
reason: replaced by docs/08-search-address-routing/search-system.md
archived_at: 2026-07-01
---

# Unified Search — Manual QA & Performance Checklist

Manual QA for the public search experience: the `GET /public/search` query endpoint,
the `GET /public/search/:entityType/:entityId/geometry` overlay endpoint, Plus Code
handling, the MapLibre highlight overlay, and lightweight performance expectations.

Use this before shipping search changes. Check each box manually; this is not an
automated suite.

---

## Prerequisites

```bash
export API=http://localhost:3001          # apps/api dev server
export WEB=http://localhost:5173          # apps/web dev server (Vite)
```

1. API running (`pnpm --filter @core-map/api dev` or equivalent) on `$API`.
2. Web running on `$WEB`.
3. Unified search index built (only needed once data exists):
   ```bash
   # Apply migrations 115–121, then populate the index via the npm scripts.
   #   115_search_documents_unified_search.sql
   #   116_search_source_views.sql
   #   117_search_rebuild_function.sql        (superseded by 118)
   #   118_search_rebuild_resilient.sql       (parameterized, per-view, resilient)
   #   119_search_rebuild_streets_batch.sql   (REMOVED by 121 — per-segment batch)
   #   120_search_disable_segment_streets.sql (disabled per-segment streets)
   #   121_search_street_groups.sql           (GROUPED street source; ~14.8k rows)

   # Default rebuild — ALL default views incl. grouped streets (street_groups).
   # Fast (seconds): grouped streets are ~14.8k rows, not 823k segments.
   npm --prefix apps/api run rebuild:search-index

   # All views except streets:
   npm --prefix apps/api run rebuild:search-index:light

   # Grouped streets only:
   npm --prefix apps/api run rebuild:search-index:street-groups
   ```
   `search.rebuild_search_documents(p_views text[] default null)` takes an array
   of view keys (`places`, `admin_areas`, `street_groups`, `addresses`,
   `bus_stops`, `bus_routes`, `buildings`, `water_lines`, `water_polygons`,
   `landuse`) or `NULL` for all. Each view is processed in its own
   sub-transaction, so a broken view never rolls back the ones that succeeded.

   > **Streets are GROUPED.** Migration 121 replaces the per-segment street source
   > (~823k rows, 35–50 min) with `search.v_search_street_groups_source`
   > (~14.8k rows): one document per logical road, grouped by
   > `normalize(name) + admin_area_id + road_class`, `entity_type = 'street_group'`.
   > Unnamed `road-<number>` placeholders are excluded. Click-to-highlight
   > resolves the whole group's geometry live from `core.core_streets`. To run a
   > subset by hand:
   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT search.rebuild_search_documents(ARRAY['places','street_groups']);"
   ```
   Confirm the run completed and counts are non-zero:
   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT status, started_at, finished_at, entity_counts
        FROM search.search_index_runs ORDER BY id DESC LIMIT 1;"
   ```

### Current coverage note

- `GET /public/search` now runs entirely on the unified index
  (`search.search_documents`): normalize → Plus Code branch → unified index. It
  returns **places, grouped streets (`street_group`), admin areas, addresses,
  bus stops, bus route variants, buildings, water lines/polygons, and landuse**.
  The parent `bus_route` is intentionally excluded (only `bus_route_variant` has a
  geometry endpoint). An optional `types=` CSV filters the entity types.
- Streets return **one logical road per result**, not one per segment.
- The geometry overlay endpoint supports the allowlist:
  `place, address, bus_stop, admin_area, street, street_group, bus_route_variant,
  building, water_line, water_polygon, landuse`. For `street_group`, geometry is
  the `ST_Multi(ST_Collect(...))` of all member segments (same normalized name +
  admin area + road class).

---

## API smoke test

```bash
# Basic text query
curl -s "$API/public/search?q=Kyauktan" | jq '.[0]'

# With map center for nearby ranking + short Plus Code expansion
curl -s "$API/public/search?q=hospital&lat=16.78&lng=96.16&limit=10" | jq 'length'

# Selected-result geometry (fetched only after a click in the UI)
curl -s "$API/public/search/admin_area/<entityId>/geometry?zoom=11" | jq '.geometryType, .bbox'
```

Expected response shape per search hit (relevant fields):

```jsonc
{
  "id": "place:123",
  "entityType": "place",          // or street/admin_area/plus_code/...
  "type": "place",                 // deprecated alias of entityType
  "publicId": "…",
  "displayName": "…",
  "subtitle": "…",
  "geometryType": "Point",         // Point | LineString | Polygon | MultiPolygon | …
  "center": [96.16, 16.78],        // [lng, lat]
  "bbox": [minLng, minLat, maxLng, maxLat],
  "hasGeometry": true,
  "isVerified": false,
  "confidenceScore": 0,            // 0–100
  "boundaryConfidenceScore": null  // 0–100 (admin areas)
}
```

Geometry endpoint response shape:

```jsonc
{
  "entityType": "admin_area",
  "entityId": "123",
  "geometryType": "MultiPolygon",
  "bbox": [minLng, minLat, maxLng, maxLat],
  "feature": { "type": "Feature", "bbox": [...], "geometry": {...}, "properties": { "entityType": "admin_area", "entityId": "123" } }
}
```

---

## 1. Text search

| Query | Expectation |
| --- | --- |
| `Kyauktan` | - [ ] Returns the Kyauktan area/township near the top. |
| `ကျောက်တန်း` | - [ ] Myanmar-script query returns the same Kyauktan entity (multilingual names match). |
| `hospital` | - [ ] Returns hospital places; nearby ones rank higher when `lat`/`lng` are sent. |
| road name (e.g. a known street) | - [ ] Returns ONE `street_group` result (not many segments) with `geometryType: MultiLineString`. |
| river / water line name | - [ ] Returns a `water_line` result *(via unified index until wired into `/public/search`)*. |

```bash
curl -s "$API/public/search?q=Kyauktan" | jq '.[] | {entityType, displayName}'
curl -s --get "$API/public/search" --data-urlencode "q=ကျောက်တန်း" | jq '.[] | {entityType, displayName}'
curl -s "$API/public/search?q=hospital&lat=16.78&lng=96.16" | jq '.[] | {entityType, displayName, center}'
```

General checks:

- [ ] Empty / whitespace `q` → `400` (validation).
- [ ] Results are ordered by relevance (exact > prefix > fuzzy), not random.
- [ ] Passing `lat`/`lng` changes ordering toward nearby results.

---

## 2. Address search

*(Now served directly by `/public/search` as `address` rows.)*

| Query | Expectation |
| --- | --- |
| `<village>, <township>, <district>` | - [ ] Full hierarchical address resolves to the most specific match. |
| `<ward>, <township>` | - [ ] Ward + township partial address resolves. |
| township only | - [ ] Township name alone returns the admin area / addresses within it. |

- [ ] Partial address (drop the district) still returns a sensible match.
- [ ] `admin_hierarchy` / `address_parts` are reflected in the subtitle (admin area shown).

---

## 3. Bus search

*(Now served directly by `/public/search`: `bus_stop` + `bus_route_variant`.)*

| Query | Expectation |
| --- | --- |
| route code (e.g. YBS line code) | - [ ] Returns a `bus_route_variant` result. |
| stop code | - [ ] Returns a `bus_stop` result with `geometryType: Point`. |

- [ ] Clicking a bus route → `LineString` overlay (see §5).
- [ ] Clicking a bus stop → point highlight (see §4 click behavior).

---

## 4. Admin boundary

- [ ] Search a **region/state**, click the result → boundary polygon overlay appears.
- [ ] Search a **township**, click the result → township boundary overlay appears.
- [ ] Boundary overlay is drawn with fill + outline and the camera fits the bbox.
- [ ] Low-confidence boundaries show an **"Approx. boundary"** badge in the result row
      (`boundaryConfidenceScore < 60`).

```bash
curl -s "$API/public/search/admin_area/<entityId>/geometry?zoom=9" | jq '.geometryType, .bbox'
```

---

## 5. Line overlay

For each: click the result in the panel and confirm the map draws a line highlight
and fits the bbox, fetching geometry **only after the click**.

- [ ] Click a **street** (`street_group`) → `MultiLineString` overlay covering the whole road.
- [ ] Click a **river / water line** → `LineString` overlay.
- [ ] Click a **bus route** → `LineString` overlay.

```bash
curl -s "$API/public/search/street_group/<entityId>/geometry?zoom=15" | jq '.geometryType'
curl -s "$API/public/search/water_line/<entityId>/geometry?zoom=13" | jq '.geometryType'
curl -s "$API/public/search/bus_route_variant/<entityId>/geometry?zoom=12" | jq '.geometryType'
```

- [ ] Long lines are simplified at low zoom (smaller `zoom` → fewer vertices) but
      never broken into invalid geometry.

---

## 6. Polygon overlay

- [ ] Click an **admin area** → polygon overlay (fill + outline).
- [ ] Click a **building** → polygon overlay.
- [ ] Click a **water polygon** → polygon overlay.

```bash
curl -s "$API/public/search/admin_area/<entityId>/geometry?zoom=11" | jq '.geometryType'
curl -s "$API/public/search/building/<entityId>/geometry?zoom=17" | jq '.geometryType'
curl -s "$API/public/search/water_polygon/<entityId>/geometry?zoom=12" | jq '.geometryType'
```

- [ ] Point geometries are **never** simplified.
- [ ] `bbox` matches the original (un-simplified) geometry extent.
- [ ] Unknown `entityType` → `400`; missing / non-public / no-geometry entity → `404`.

---

## 7. Plus Code

Yangon reference example: full code around Kyauktan/Yangon. Replace `<FULL>` /
`<SHORT>` with a real Plus Code for the test area.

| Input | Expectation |
| --- | --- |
| full code `<FULL>` (e.g. `6PH58QMF+2X`) | - [ ] One `plus_code` pin result; `geometryType: Point`, `hasGeometry: true`, `center` = cell center. |
| lowercase full code | - [ ] Same result as uppercase (input normalized). |
| full code with spaces | - [ ] Same result (spaces stripped). |
| short code `<SHORT>` **with** map center | - [ ] Expands against center and returns a pin. |
| short code **without** map center | - [ ] Result row shows **"Short Plus Code needs map area or current location."** |
| invalid code (e.g. `not-a-code`) | - [ ] No Plus Code pin; falls through to normal text search (no error). |

```bash
# Full code
curl -s --get "$API/public/search" --data-urlencode "q=6PH58QMF+2X" | jq '.[0] | {entityType, center, hasGeometry}'

# Lowercase + spaces
curl -s --get "$API/public/search" --data-urlencode "q=6ph58qmf+2x" | jq '.[0].entityType'
curl -s --get "$API/public/search" --data-urlencode "q=6PH5 8QMF +2X" | jq '.[0].entityType'

# Short code WITH center → expands
curl -s --get "$API/public/search" --data-urlencode "q=8QMF+2X" --data-urlencode "lat=16.78" --data-urlencode "lng=96.16" | jq '.[0] | {entityType, center}'

# Short code WITHOUT center → reference required
curl -s --get "$API/public/search" --data-urlencode "q=8QMF+2X" | jq '.[0] | {entityType, referenceRequired, reason}'

# Invalid → normal text search (no plus_code hit)
curl -s --get "$API/public/search" --data-urlencode "q=not-a-code" | jq 'map(.entityType) | unique'
```

Additional checks:

- [ ] A valid decoded Plus Code outside the Myanmar service area → `outsideServiceArea: true`.
- [ ] Plus Code result carries reverse-address fields (`reverse` / `reverseAddress`) when available.
- [ ] Clicking a Plus Code pin draws a point highlight and `flyTo`s the center.
- [ ] In the UI, a short Plus Code auto-retries with map center once the viewport is set
      (no manual retry needed); the reference-required message only shows before any
      map area is known.

---

## 8. Performance checks

- [ ] **Search response excludes heavy geometry** — hits contain only `center` +
      `bbox` (+ `geometryType` / `hasGeometry`), never full polygon/line coordinates.
      ```bash
      curl -s "$API/public/search?q=Kyauktan" | jq '.[0] | has("feature"), (.geometry // "no-geometry")'
      # expect: false  and  "no-geometry"
      ```
- [ ] **Geometry loads only after click** — opening a search returns no geometry
      coordinates; the `/geometry` request fires only when a result is selected
      (watch the browser Network tab).
- [ ] **Basemap is not reloaded** — selecting results does not re-fetch PMTiles /
      re-create the map style; only the highlight source changes.
- [ ] **Highlight uses `source.setData()`** — one `search-highlight-source` and its
      layers are created once; subsequent results update via `setData()` (no
      add/remove layer churn). Verify a single source/layer set in the style.
- [ ] **Result limit** — default `limit` is `20`, max is `50`.
      ```bash
      curl -s "$API/public/search?q=hospital" | jq 'length'              # ≤ 20
      curl -s "$API/public/search?q=hospital&limit=50" | jq 'length'     # ≤ 50
      curl -s -o /dev/null -w '%{http_code}\n' "$API/public/search?q=hospital&limit=100"  # 400
      ```
- [ ] Debounced typing — rapid typing issues one request ~300ms after typing stops
      (not one per keystroke).
- [ ] Small map pans do not refire the search (center is rounded to ~100m).

---

## Unified index spot-check

Until bus/address/water/building/landuse are wired into `/public/search`, validate
them directly against the index that powers `searchUnified`:

```bash
# Entity counts in the last rebuild
psql "$DATABASE_URL" -c \
  "SELECT entity_counts FROM search.search_index_runs ORDER BY id DESC LIMIT 1;"

# Confirm rows exist per entity type
psql "$DATABASE_URL" -c \
  "SELECT entity_type, count(*) FROM search.search_documents GROUP BY 1 ORDER BY 1;"

# Confirm no full geometry is stored (only centroid/bbox metadata)
psql "$DATABASE_URL" -c \
  "SELECT column_name FROM information_schema.columns
    WHERE table_schema='search' AND table_name='search_documents' ORDER BY 1;"
```

- [ ] `entity_counts` covers all 10 source types.
- [ ] `search_documents` has `centroid`, bbox columns, `geometry_type`,
      `has_geometry`, `supports_plus_code` — and **no** full-geometry column.
- [ ] Failed / zero-result queries appear in `search.failed_search_logs`.

---

## Test case summary

1. **Text:** Kyauktan / ကျောက်တန်း / hospital / road name / water line name.
2. **Address:** village+township+district / ward+township / township only.
3. **Bus:** route code / stop code.
4. **Admin boundary:** region click / township click / boundary overlay.
5. **Line overlay:** street / river / bus route.
6. **Polygon overlay:** admin area / building / water polygon.
7. **Plus Code:** full / lowercase / spaced / short+center / short-no-center / invalid.
8. **Performance:** no heavy geometry in search / geometry only after click / no
   basemap reload / highlight via `setData()` / limit default 20, max 50.
