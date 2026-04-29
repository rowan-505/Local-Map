# 🗺️ Map App Database Context

## 🧠 System Overview

This project is a geospatial map system with strict architecture:

raw → staging → core → tiles → MapLibre

Reference to "database_snapshot.txt" for some details.

Rules:
- raw = untouched source data
- staging = cleaned + classified candidates
- core = production-ready data
- tiles = lightweight views for rendering
- SRID = 4326 everywhere
- Database = source of truth
- Tiles = rendering only (no business logic)

---

## 🧱 Schemas

### 1. raw (source layer)

Tables:

- raw.raw_osm_points
- raw.raw_osm_lines
- raw.raw_osm_polygons
- raw.kyauktan_boundary

Key columns:

- osm_id (text)
- tags (jsonb)
- geom (geometry)
- osm_feature_type (node / way / relation)
- source_snapshot_id (bigint)

Rules:
- DO NOT modify raw tables
- DO NOT clean or normalize here
- Only filter/select from raw

---

### 2. staging (candidate layer)

Purpose:
- Normalize OSM data
- Classify features
- Prepare for core insertion

Key tables:

- staging.staging_road_candidates
- staging.staging_place_candidates
- staging.staging_place_name_candidates
- staging.staging_admin_area_candidates
- staging.staging_bus_stop_candidates
- staging.staging_bus_route_candidates

Key columns:

- external_id (OSM id)
- canonical_name
- normalized_data (jsonb)
- source_refs (jsonb)
- geom / point_geom
- confidence_score
- match_status

Rules:
- Data is cleaned but NOT final
- Geometry must be valid
- Use MultiLineString for roads if needed
- Use MultiPolygon for polygons
- Use Point for POIs

---

### 3. core (production layer)

Purpose:
- Final, trusted data
- Used by API and tiles

Key tables:

#### Admin
- core.core_admin_areas
- core.core_admin_area_names

#### Places
- core.core_places
- core.core_place_names
- core.core_place_contacts
- core.core_place_sources

#### Streets
- core.core_streets
- core.core_street_names

#### Transit
- core.core_bus_routes
- core.core_bus_route_variants
- core.core_bus_stops
- core.core_bus_route_stops

#### Addresses
- core.core_addresses
- core.core_place_addresses

Key geometry columns:

- core_places.point_geom (Point)
- core_places.footprint_geom (Polygon)
- core_streets.geom (LineString / MultiLineString)
- core_admin_areas.geom (Polygon / MultiPolygon)

Rules:
- Only validated data enters core
- Avoid duplicates (by osm_id or external_id)
- Must include indexes on geom
- Must maintain relationships (admin_area_id, etc.)

---

### 4. tiles (render layer)

Purpose:
- Lightweight views for MapLibre + Martin

Existing views:

- tiles.tiles_poi_public_v
- tiles.tiles_bus_stops_public_v
- tiles.tiles_bus_routes_public_v
- tiles.v_admin_areas
- tiles.v_places
- tiles.v_streets

Rules:
- MUST expose `geom`
- MUST be simple SELECT views
- NO heavy joins
- NO raw tables directly
- Only core data

---

## 🧩 Geometry Rules (CRITICAL)

Always enforce:

### Lines (roads, rivers)
- geometry(MultiLineString, 4326)
- use:
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(geom),
      2
    )
  )

### Polygons (buildings, water, landuse)
- geometry(MultiPolygon, 4326)
- use:
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(geom),
      3
    )
  )

### Points (POIs)
- geometry(Point, 4326)
- for polygons:
  ST_PointOnSurface(geom)

---

## 🧠 Classification Rules

### Roads (from tags->>'highway')

- motorway, trunk, primary → major
- secondary, tertiary → medium
- residential, living_street → minor
- service, track → service
- footway, path, pedestrian → path

---

### Water

Polygons:
- natural=water
- water=*
- landuse=reservoir/basin

Lines:
- waterway=*

---

### Buildings

- tags ? 'building'

---

### Landuse

- landuse=*
- natural=wood/grassland/scrub/wetland
- leisure=*

---

### POIs

From tags:
- amenity
- shop
- tourism
- healthcare
- education
- office
- leisure
- historic

---

## 🚨 Constraints for AI (Cursor / ChatGPT)

When generating SQL:

- DO NOT invent columns
- DO NOT rename existing fields
- DO NOT modify raw schema
- DO NOT drop tables
- DO NOT truncate data
- DO NOT duplicate inserts
- ALWAYS check existing tables first
- ALWAYS use SRID 4326
- ALWAYS normalize geometry

---

## ⚙️ Tile Pipeline

core → tiles views → Martin → MapLibre

Tiles must include:

- roads
- water (polygon + line)
- buildings
- landuse
- places
- admin boundaries

---

## 🎯 Current Goal

Build dynamic basemap using:

- roads
- water
- landuse
- buildings

DO NOT use PMTiles yet  
Use Martin dynamic tiles only

---

## 🔒 Final Rule

Cursor generates SQL  
Human reviews  
Execution is manual

Database safety is priority