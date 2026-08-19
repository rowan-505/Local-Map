/** MapLibre vector source id for the Myanmar overview PMTiles archive (z0–z8). */
export const OVERVIEW_VECTOR_SOURCE_ID = 'overview' as const;

/** Overview tiles are built for low zoom only; hide layers above this zoom. */
export const OVERVIEW_MAX_ZOOM = 8;

/** MapLibre layer `maxzoom` — tiles stop at z8; layers use 9 so z8 is still visible. */
export const OVERVIEW_LAYER_MAX_ZOOM = 9;

/** Public map viewport — locked to the overview PMTiles extent (z0–z8). */
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
  'mmr_admin0_z0_2',
  'mmr_admin0_z3_4',
  'mmr_admin0_z5_6',
  'mmr_admin1',
] as const;

/** High-precision Myanmar admin0 PMTiles source-layers (zoom-tier geometry). */
export const OVERVIEW_MMR_ADMIN0_ZOOM_TIER_SOURCE_LAYERS = [
  'mmr_admin0_z0_2',
  'mmr_admin0_z3_4',
  'mmr_admin0_z5_6',
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

/** Country neighbor labels — z4–6 only; Myanmar excluded (MIMU admin1 labels cover Myanmar). */
export const OVERVIEW_COUNTRY_LABEL_MIN_ZOOM = 3;
export const OVERVIEW_COUNTRY_LABEL_MAX_ZOOM = 6.5;

/** Myanmar state/region labels — visible from z4 with reference-style subtle purple-gray. */
export const OVERVIEW_MMR_ADMIN1_LABEL_MIN_ZOOM = 4;

/** Major cities — after country/admin context is established. */
export const OVERVIEW_POPULATED_PLACES_MIN_ZOOM = 7;

/**
 * Exclude Natural Earth Myanmar segments from neighbor `country_boundaries` so only
 * `mmr_admin0_z0_2` / `z3_4` / `z5_6` (NE land-aligned tiers) draw the Myanmar outer ring z0–z6.
 */
export const OVERVIEW_EXCLUDE_MMR_COUNTRY_BOUNDARY_FILTER = [
  '!',
  [
    'any',
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_A3_L'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_A3_R'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'SOV_A3_L'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'SOV_A3_R'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'BRK_A3_L'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'BRK_A3_R'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_LEFT'], '']], 'MYANMAR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_RIGHT'], '']], 'MYANMAR'],
  ],
] as const;

/** Overview boundary layer ids (paint order: neighbor → internal → admin0 casing → admin0 line). */
export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_LAYER_ID = 'neighbor-country-boundary-line' as const;

export const OVERVIEW_MMR_INTERNAL_ADMIN_BOUNDARY_LAYER_ID =
  'myanmar-internal-admin-boundary-line' as const;

/** Myanmar admin0 zoom-tier MapLibre layers (land-aligned NE, z0–z6). */
export const OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS = [
  {
    sourceLayer: 'mmr_admin0_z0_2',
    casingLayerId: 'myanmar-admin0-boundary-casing-z02',
    lineLayerId: 'myanmar-admin0-boundary-line-z02',
    minZoom: 0,
    maxZoom: 3,
    zoomBand: 'z0-z2',
  },
  {
    sourceLayer: 'mmr_admin0_z3_4',
    casingLayerId: 'myanmar-admin0-boundary-casing-z34',
    lineLayerId: 'myanmar-admin0-boundary-line-z34',
    minZoom: 3,
    maxZoom: 5,
    zoomBand: 'z3-z4',
  },
  {
    sourceLayer: 'mmr_admin0_z5_6',
    casingLayerId: 'myanmar-admin0-boundary-casing-z56',
    lineLayerId: 'myanmar-admin0-boundary-line-z56',
    minZoom: 5,
    maxZoom: 7,
    zoomBand: 'z5-z6',
  },
] as const;

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_LAYER_IDS = OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS.map(
  (t) => t.casingLayerId,
) as readonly string[];

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_LAYER_IDS = OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS.map(
  (t) => t.lineLayerId,
) as readonly string[];

/** @deprecated Use tier line ids from {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS}. */
export const OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_LAYER_ID = 'myanmar-admin0-boundary-line-z56' as const;

/** @deprecated Use tier casing ids from {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS}. */
export const OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_LAYER_ID =
  'myanmar-admin0-boundary-casing-z56' as const;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_LAYER_ID}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_LAYER_ID = OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_LAYER_ID;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_LAYER_ID}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_CASING_LAYER_ID =
  OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_LAYER_ID;

/** Overview Myanmar admin0 hidden at z7+ (regional OSM admin takes over). */
export const OVERVIEW_MMR_ADMIN0_OVERVIEW_MAX_ZOOM = 7;

/** Neighbor country boundaries — visible but lighter than Myanmar admin0. */
export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_COLOR = '#b8b4c7';

export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.28,
  3,
  0.4,
  6,
  0.52,
] as const;

export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.45,
  3,
  0.65,
  6,
  0.85,
] as const;

/** Myanmar admin0 inner stroke — medium purple, elegant z0–z6 silhouette. */
export const OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_COLOR = '#5f5478';

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_MIN_ZOOM = 0;

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.72,
  3,
  0.82,
  6,
  0.88,
] as const;

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.9,
  3,
  1.25,
  6,
  1.65,
] as const;

/** Subtle land-tone halo under Myanmar admin0 (not thick white). */
export const OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_COLOR = '#f6f5ee';

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.35,
  3,
  0.45,
  6,
  0.55,
] as const;

export const OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  1.4,
  3,
  1.8,
  6,
  2.2,
] as const;

/** Regional OSM admin0/admin1 boundaries from z7+ (`admin_boundaries` source-layer). */
export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_MIN_ZOOM = 7;

/** Regional z7+ state/region boundaries (overview admin0 outer border hides at z7). */
export const REGIONAL_ADMIN_PRIMARY_LEVEL_CODES = ['state_region'] as const;

export const REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER = [
  'in',
  ['get', 'admin_level_code'],
  ['literal', [...REGIONAL_ADMIN_PRIMARY_LEVEL_CODES]],
] as const;

export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_COLOR = '#aaa4bd';

/** Top-level zoom interpolate; case only inside stops (MapLibre paint rule). */
export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  7,
  ['case', REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER, 0.6, 0.35],
  10,
  ['case', REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER, 0.9, 0.55],
] as const;

/** Top-level zoom interpolate; country outer border hidden; lower admin stays weak. */
export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  7,
  [
    'case',
    ['==', ['get', 'admin_level_code'], 'country'],
    0,
    REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER,
    0.45,
    ['==', ['get', 'admin_level_code'], 'village'],
    0,
    0.22,
  ],
  10,
  [
    'case',
    ['==', ['get', 'admin_level_code'], 'country'],
    0,
    REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER,
    0.45,
    ['==', ['get', 'admin_level_code'], 'village'],
    0,
    0.28,
  ],
] as const;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_COLOR}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_COLOR = OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_COLOR;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_MIN_ZOOM}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_MIN_ZOOM = OVERVIEW_MMR_ADMIN0_BOUNDARY_MIN_ZOOM;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_OPACITY}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_OPACITY = OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_OPACITY;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_WIDTH}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_WIDTH = OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_WIDTH;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_COLOR}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_CASING_COLOR = OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_COLOR;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_OPACITY}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_CASING_OPACITY = OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_OPACITY;

/** @deprecated Use {@link OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_WIDTH}. */
export const OVERVIEW_MMR_COUNTRY_HIGHLIGHT_CASING_WIDTH = OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_WIDTH;

/** Myanmar admin1/state internal boundaries — subtle purple-gray from z3. */
export const OVERVIEW_MMR_ADMIN1_BOUNDARY_COLOR = '#aaa4bd';

export const OVERVIEW_MMR_ADMIN1_BOUNDARY_MIN_ZOOM = 3;

/** Overview mmr_admin1 lines stay through z10; regional state_region takes over from z7. */
export const OVERVIEW_MMR_ADMIN1_BOUNDARY_MAX_ZOOM = 10;

export const OVERVIEW_MMR_ADMIN1_BOUNDARY_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  0.35,
  5,
  0.48,
  6,
  0.55,
] as const;

export const OVERVIEW_MMR_ADMIN1_BOUNDARY_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  0.45,
  5,
  0.65,
  6,
  0.8,
] as const;

/** Neighbor country labels — clean gray on cream halo. */
export const OVERVIEW_COUNTRY_LABEL_TEXT_COLOR = '#6f7488';

export const OVERVIEW_COUNTRY_LABEL_HALO_COLOR = '#f4f3ec';

export const OVERVIEW_COUNTRY_LABEL_HALO_WIDTH = 0.9;

export const OVERVIEW_COUNTRY_LABEL_TEXT_SIZE = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  10.5,
  5,
  12,
] as const;

/** Myanmar admin1 labels — reference-style muted purple-gray. */
export const OVERVIEW_MMR_ADMIN1_LABEL_TEXT_COLOR = '#74708b';

export const OVERVIEW_MMR_ADMIN1_LABEL_HALO_COLOR = '#f4f3ec';

export const OVERVIEW_MMR_ADMIN1_LABEL_HALO_WIDTH = 0.8;

export const OVERVIEW_MMR_ADMIN1_LABEL_TEXT_SIZE = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  10.5,
  5,
  11.5,
  6,
  12.5,
] as const;

export const OVERVIEW_MMR_ADMIN1_LABEL_TEXT_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.55,
  5,
  0.75,
  6,
  0.85,
] as const;

/** Hide Myanmar country polygon label when admin1 labels are visible. */
export const OVERVIEW_EXCLUDE_MMR_COUNTRY_LABEL_FILTER = [
  '!',
  [
    'any',
    ['==', ['upcase', ['coalesce', ['get', 'ISO_A3'], ['get', 'iso_a3'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADMIN'], '']], 'MYANMAR'],
    ['==', ['upcase', ['coalesce', ['get', 'BRK_A3'], '']], 'MMR'],
  ],
] as const;

/**
 * Country labels — fewer names at low zoom; neighbors only.
 * Tighter `LABELRANK` below z6; excludes micro-states (`TINY`) and Myanmar.
 */
export const OVERVIEW_COUNTRY_LABEL_FILTER = [
  'all',
  ['!=', ['coalesce', ['get', 'TINY'], 0], 1],
  [
    '<=',
    ['coalesce', ['get', 'LABELRANK'], 10],
    ['step', ['zoom'], 4, 5.5, 5, 6, 6],
  ],
  OVERVIEW_EXCLUDE_MMR_COUNTRY_LABEL_FILTER,
] as const;

/** Admin1 labels — one name per state/region polygon feature with a non-empty ST* field. */
export const OVERVIEW_MMR_ADMIN1_LABEL_FILTER = [
  'all',
  [
    '!=',
    [
      'coalesce',
      ['get', 'ST_MMR'],
      ['get', 'ST'],
      ['get', 'SR_MMR'],
      ['get', 'SR'],
      '',
    ],
    '',
  ],
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
