/** MapLibre vector source id for the Myanmar overview PMTiles archive (z0–z8). */
export const OVERVIEW_VECTOR_SOURCE_ID = 'overview' as const;

/** Overview tiles are built for low zoom only; hide layers above this zoom. */
export const OVERVIEW_MAX_ZOOM = 8;

/** MapLibre layer `maxzoom` — tiles stop at z8; layers use 9 so z8 is still visible. */
export const OVERVIEW_LAYER_MAX_ZOOM = 9;

/**
 * Public map viewport — aligned with overview PMTiles coverage (Natural Earth + MIMU z0–z8).
 * Pan and minimum zoom are locked so users stay within the overview archive extent.
 */
export const MYANMAR_OVERVIEW_CENTER: [number, number] = [96.2, 20.5];

/** Opening zoom — frames Myanmar and neighbors within overview tiles. */
export const MYANMAR_OVERVIEW_ZOOM = 4.7;

/** Users cannot zoom out past the overview country framing. */
export const MYANMAR_OVERVIEW_MIN_ZOOM = 4.3;

/**
 * Pan limits for overview PMTiles bbox (SW then NE, [lng, lat]).
 * Slightly wider than Myanmar alone so edge panning does not hit a hard wall immediately.
 */
export const MYANMAR_OVERVIEW_MAX_BOUNDS: readonly [[number, number], [number, number]] = [
  [78.0, 3.0],
  [112.0, 34.0],
];

export const DEFAULT_OVERVIEW_CURRENT_JSON_URL =
  'http://localhost:8080/overview/regions/current.json';

/**
 * Placeholder token in committed `overview-map.json` — never fetch tiles from this URL.
 * Runtime callers inject `VITE_OVERVIEW_PMTILES_URL` (web) or pass HTTP(S) URL to
 * `createOverviewStyle()`.
 */
export const OVERVIEW_PMTILES_URL_PLACEHOLDER = '__OVERVIEW_PMTILES_URL__' as const;

/** Committed overview MapLibre style source URL (template only). */
export const OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER =
  `pmtiles://${OVERVIEW_PMTILES_URL_PLACEHOLDER}` as const;

/**
 * Vector tile layer names in the overview PMTiles archive (tippecanoe `-L` / MapLibre `source-layer`).
 * Keep in sync with infrastructure/tiles/pmtiles/overview build and overview-map.json.
 */
export const OVERVIEW_PMTILES_SOURCE_LAYERS = [
  'land',
  'ocean',
  'coastline',
  'countries',
  'country_boundaries',
  'populated_places',
  'lakes',
  'rivers',
  'mmr_admin0',
  'mmr_admin1',
] as const;

export type OverviewPmtilesSourceLayer = (typeof OVERVIEW_PMTILES_SOURCE_LAYERS)[number];

/** Regional OSM / PostGIS source-layers that must not appear in overview style. */
export const OVERVIEW_FORBIDDEN_SOURCE_LAYERS = [
  'landuse',
  'water_polygons',
  'water_lines',
  'admin_boundaries',
  'admin_areas',
  'village_labels',
  'streets',
  'buildings',
  'admin_area_label_points',
  'road_labels',
] as const;

/**
 * Country labels — fewer names at low zoom; neighbors get names only (no city clutter below z5).
 * Uses Natural Earth `LABELRANK` and hides `TINY` countries until mid zoom.
 */
/** Country labels — hide micro-states; cap label rank (zoom gating via layer minzoom/maxzoom). */
export const OVERVIEW_COUNTRY_LABEL_FILTER = [
  'all',
  ['!=', ['coalesce', ['get', 'TINY'], 0], 1],
  ['<=', ['coalesce', ['get', 'LABELRANK'], 10], 6],
] as const;

/**
 * Major cities — capitals or high-importance settlements only.
 * Layer `minzoom: 5` controls when labels appear; no zoom `step` in filter.
 */
export const OVERVIEW_MAJOR_CITY_FILTER = [
  'any',
  ['<=', ['to-number', ['coalesce', ['get', 'SCALERANK'], ['get', 'scalerank'], 99]], 4],
  ['==', ['to-number', ['coalesce', ['get', 'ADM0CAP'], ['get', 'adm0cap'], 0]], 1],
] as const;

/** Large lakes — `min_zoom` from tile props; layer `minzoom: 6` limits visibility. */
export const OVERVIEW_LAKES_FILTER = [
  'all',
  ['<=', ['coalesce', ['get', 'min_zoom'], 0], ['zoom']],
  ['<=', ['coalesce', ['get', 'scalerank'], 99], 6],
] as const;

/** Major rivers — same rank gate as lakes; layer `minzoom: 6`. */
export const OVERVIEW_RIVERS_FILTER = [
  'all',
  ['<=', ['coalesce', ['get', 'min_zoom'], 0], ['zoom']],
  ['<=', ['coalesce', ['get', 'scalerank'], 99], 6],
] as const;
