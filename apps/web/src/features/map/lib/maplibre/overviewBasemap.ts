/**
 * Overview basemap source + layers for apps/web (Natural Earth + MIMU, z0–z8).
 * No OSM roads, buildings, POIs, or transit — API overlays are added separately in MapView.
 *
 * PMTiles URL: `VITE_OVERVIEW_PMTILES_URL` (see `config/overviewPmtilesUrl.ts`).
 *
 * **populated_places filters** — Natural Earth field names vary by export; we coalesce common casings.
 * Adjust `isMajorPopulatedPlaceFilter()` if your PMTiles uses different property names.
 */
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import {
  OVERVIEW_COUNTRY_LABEL_FILTER,
  OVERVIEW_LAKES_FILTER,
  OVERVIEW_MAJOR_CITY_FILTER,
  OVERVIEW_MAX_ZOOM,
  OVERVIEW_PMTILES_SOURCE_LAYERS,
  OVERVIEW_RIVERS_FILTER,
} from '../../../../../../../packages/map-style/overviewConstants.js';
import {
  OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
  OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD,
  OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
} from './overviewLabelTextFields';
import { OVERVIEW_BOUNDARY_MAX_ZOOM } from './basemapZoomVisibility';

/** Must match `apps/web/public/fonts/NotoSansMyanmar-Regular/` and regional basemap fontstack. */
const OVERVIEW_TEXT_FONT = ['NotoSansMyanmar-Regular'] as const;

/** MapLibre vector source id — must match PMTiles style and `overview-map.json` metadata. */
export const OVERVIEW_SOURCE_ID = 'overview' as const;

/** Layer `maxzoom` for fills/labels — tiles end at z8; use 9 so z8 remains visible. */
const LAYER_MAX_ZOOM = OVERVIEW_MAX_ZOOM + 1;

export const OVERVIEW_LAYER_IDS = [
  'overview-ocean',
  'overview-land',
  'overview-lakes',
  'overview-rivers',
  'overview-countries-fill',
  'overview-mmr-admin1-fill',
  'overview-coastline',
  'overview-country-boundaries',
  'overview-mmr-admin1-boundaries',
  'overview-mmr-admin0-outline',
  'overview-country-labels',
  'overview-mmr-admin1-labels',
  'overview-populated-places',
] as const;

export type OverviewLayerId = (typeof OVERVIEW_LAYER_IDS)[number];

/** Expected PMTiles vector layers — keep in sync with infrastructure overview build. */
export const EXPECTED_OVERVIEW_SOURCE_LAYERS = OVERVIEW_PMTILES_SOURCE_LAYERS;

const FORBIDDEN_SOURCE_LAYER_SET = new Set([
  'streets',
  'buildings',
  'landuse',
  'road_labels',
  'admin_boundaries',
  'admin_areas',
]);

/** Regional/OSM source-layer substrings that must not appear in overview style. */
const FORBIDDEN_SOURCE_LAYER_SUBSTRINGS = [
  'road',
  'street',
  'building',
  'landuse',
  'poi',
  'bus',
  'rail',
  'transit',
] as const;

function toPmtilesSchemeUrl(httpUrl: string): string {
  const u = httpUrl.trim();
  if (!u) {
    throw new Error('Empty overview PMTiles URL');
  }
  return u.startsWith('pmtiles://') ? u : `pmtiles://${u}`;
}

/** Vector source for overview PMTiles (`pmtiles://` URL). */
export function createOverviewSource(pmtilesHttpUrl: string): SourceSpecification {
  return {
    type: 'vector',
    url: toPmtilesSchemeUrl(pmtilesHttpUrl),
    minzoom: 0,
    maxzoom: OVERVIEW_MAX_ZOOM,
  };
}

/**
 * Major cities only — capitals / world cities at z5–6; more at z7–8.
 * Uses `OVERVIEW_MAJOR_CITY_FILTER` from shared constants (ADM0CAP, SCALERANK, FEATURECLA, …).
 */
export const OVERVIEW_POPULATED_PLACES_FILTER =
  OVERVIEW_MAJOR_CITY_FILTER as unknown as ExpressionSpecification;

/** Paint-ordered overview basemap layers (bottom → top). */
export function createOverviewLayers(): LayerSpecification[] {
  const src = OVERVIEW_SOURCE_ID;
  return [
    oceanLayer(src),
    landLayer(src),
    lakesLayer(src),
    riversLayer(src),
    countriesFillLayer(src),
    mmrAdmin1FillLayer(src),
    coastlineLayer(src),
    countryBoundariesLayer(src),
    mmrAdmin1BoundariesLayer(src),
    mmrAdmin0OutlineLayer(src),
    countryLabelsLayer(src),
    mmrAdmin1LabelsLayer(src),
    populatedPlacesLayer(src),
  ];
}

/** Full MapLibre style for overview mode — used by `overviewBasemapStyle.ts`. */
export function createOverviewBasemapStyle(pmtilesHttpUrl: string): StyleSpecification {
  return {
    version: 8,
    name: 'CoreMap Myanmar Overview',
    metadata: {
      'local-map:purpose': 'Natural Earth + MIMU overview basemap for z0–z8 only. No OSM detail.',
      'local-map:zoom-range': '0-8',
      'local-map:source-layers': OVERVIEW_PMTILES_SOURCE_LAYERS.join(','),
    },
    glyphs: '/fonts/{fontstack}/{range}.pbf',
    sources: {
      [OVERVIEW_SOURCE_ID]: createOverviewSource(pmtilesHttpUrl),
    },
    layers: createOverviewLayers(),
  };
}

function oceanLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-ocean',
    type: 'fill',
    source,
    'source-layer': 'ocean',
    maxzoom: LAYER_MAX_ZOOM,
    paint: { 'fill-color': '#b8ddea', 'fill-opacity': 1 },
  };
}

function landLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-land',
    type: 'fill',
    source,
    'source-layer': 'land',
    maxzoom: LAYER_MAX_ZOOM,
    paint: { 'fill-color': '#e8ebe0', 'fill-opacity': 1 },
  };
}

function lakesLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-lakes',
    type: 'fill',
    source,
    'source-layer': 'lakes',
    minzoom: 6,
    maxzoom: LAYER_MAX_ZOOM,
    filter: OVERVIEW_LAKES_FILTER as unknown as ExpressionSpecification,
    paint: {
      'fill-color': '#c5dde8',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.45, 7, 0.62, 8, 0.72],
    },
  };
}

function riversLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-rivers',
    type: 'line',
    source,
    'source-layer': 'rivers',
    minzoom: 6,
    maxzoom: LAYER_MAX_ZOOM,
    filter: OVERVIEW_RIVERS_FILTER as unknown as ExpressionSpecification,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#9cc6d8',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 7, 0.58, 8, 0.7],
      'line-width': [
        'interpolate',
        ['exponential', 1.2],
        ['zoom'],
        6,
        0.4,
        7,
        0.65,
        8,
        0.95,
      ],
    },
  };
}

function countriesFillLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-countries-fill',
    type: 'fill',
    source,
    'source-layer': 'countries',
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    paint: {
      // No duplicate outline — `overview-country-boundaries` draws borders.
      'fill-color': '#e4e2dc',
      'fill-outline-color': 'rgba(0, 0, 0, 0)',
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.16,
        4,
        0.2,
        6.5,
        0.24,
        7,
        0.1,
        7.9,
        0,
      ],
    },
  };
}

function mmrAdmin1FillLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-mmr-admin1-fill',
    type: 'fill',
    source,
    'source-layer': 'mmr_admin1',
    minzoom: 4,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['%', ['to-number', ['coalesce', ['get', 'PCode_V'], 0]], 16],
        0,
        '#e8e8f0',
        8,
        '#dfe8e4',
        15,
        '#ece6ea',
      ],
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        0.26,
        5,
        0.34,
        6.5,
        0.38,
        7,
        0.12,
        7.9,
        0,
      ],
    },
  };
}

/**
 * Visual hierarchy: MIMU Admin 0 emphasizes Myanmar; Natural Earth country boundaries and
 * MIMU Admin 1 are medium context lines (matched strength, below admin0).
 */
const OVERVIEW_MEDIUM_BOUNDARY_COLOR = '#A79CB3';

const OVERVIEW_MEDIUM_BOUNDARY_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  0.62,
  6.5,
  0.62,
  7.5,
  0.28,
  8.5,
  0,
];

const OVERVIEW_ADMIN0_BOUNDARY_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1.0,
  6.5,
  1.0,
  7.5,
  0.45,
  8.5,
  0,
];

const OVERVIEW_COASTLINE_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  0.45,
  6.5,
  0.45,
  7.5,
  0.18,
  8.5,
  0,
];

const OVERVIEW_MEDIUM_BOUNDARY_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  0.55,
  4,
  0.75,
  6,
  0.9,
  8,
  0.65,
  9,
  0.4,
];

function coastlineLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-coastline',
    type: 'line',
    source,
    'source-layer': 'coastline',
    minzoom: 0,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#8BBFD0',
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 5, 0.5, 8, 0.35, 9, 0.2],
      'line-opacity': OVERVIEW_COASTLINE_OPACITY,
    },
  };
}

function countryBoundariesLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-country-boundaries',
    type: 'line',
    source,
    'source-layer': 'country_boundaries',
    minzoom: 0,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': OVERVIEW_MEDIUM_BOUNDARY_COLOR,
      'line-width': OVERVIEW_MEDIUM_BOUNDARY_WIDTH,
      'line-opacity': OVERVIEW_MEDIUM_BOUNDARY_OPACITY,
    },
  };
}

function mmrAdmin0OutlineLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-mmr-admin0-outline',
    type: 'line',
    source,
    'source-layer': 'mmr_admin0',
    minzoom: 2,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#665276',
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.45, 4, 1.8, 6, 2.1, 8, 1.45, 9, 0.85],
      'line-opacity': OVERVIEW_ADMIN0_BOUNDARY_OPACITY,
    },
  };
}

function mmrAdmin1BoundariesLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-mmr-admin1-boundaries',
    type: 'line',
    source,
    'source-layer': 'mmr_admin1',
    minzoom: 2,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': OVERVIEW_MEDIUM_BOUNDARY_COLOR,
      'line-width': OVERVIEW_MEDIUM_BOUNDARY_WIDTH,
      'line-opacity': OVERVIEW_MEDIUM_BOUNDARY_OPACITY,
    },
  };
}

function countryLabelsLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-country-labels',
    type: 'symbol',
    source,
    'source-layer': 'countries',
    minzoom: 0,
    maxzoom: LAYER_MAX_ZOOM,
    filter: OVERVIEW_COUNTRY_LABEL_FILTER as unknown as ExpressionSpecification,
    layout: {
      'text-field': OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 8.5, 3, 9.5, 5, 11, 7, 12.5, 8, 13],
      'text-max-width': 7,
      'text-padding': 36,
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#4a5568',
      'text-halo-color': '#f7f8f6',
      'text-halo-width': 1.8,
      'text-halo-blur': 0.4,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 4, 0.85, 8, 0.92],
    },
  };
}

function mmrAdmin1LabelsLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-mmr-admin1-labels',
    type: 'symbol',
    source,
    'source-layer': 'mmr_admin1',
    minzoom: 4,
    maxzoom: LAYER_MAX_ZOOM,
    layout: {
      'text-field': OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 5, 10, 7, 11.5, 8, 12],
      'text-max-width': 9,
      'text-padding': 40,
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#5c5670',
      'text-halo-color': '#f7f8f6',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.35,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 6, 0.75, 8, 0.85],
    },
  };
}

function populatedPlacesLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-populated-places',
    type: 'symbol',
    source,
    'source-layer': 'populated_places',
    minzoom: 5,
    maxzoom: LAYER_MAX_ZOOM,
    filter: OVERVIEW_POPULATED_PLACES_FILTER,
    layout: {
      'text-field': OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 10.5, 9],
        7,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 12, 10.5],
        8,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 13, 11.5],
      ],
      'text-max-width': 7,
      'text-padding': 44,
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#3d4a5c',
      'text-halo-color': '#f7f8f6',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.35,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 7, 0.82, 8, 0.9],
    },
  };
}

/** Validates overview layer definitions (fast, no MapLibre runtime). */
export function validateOverviewLayerDefinitions(layers: LayerSpecification[]): string[] {
  const issues: string[] = [];
  const ids = layers.map((l) => l.id);

  if (ids.join(',') !== OVERVIEW_LAYER_IDS.join(',')) {
    issues.push(`layer id order mismatch: expected ${OVERVIEW_LAYER_IDS.join(', ')}`);
  }

  let seenSymbol = false;
  for (const layer of layers) {
    if ('source' in layer && layer.source !== undefined && layer.source !== OVERVIEW_SOURCE_ID) {
      issues.push(`layer "${layer.id}" must use source "${OVERVIEW_SOURCE_ID}"`);
    }
    const sl = 'source-layer' in layer ? layer['source-layer'] : undefined;
    if (typeof sl === 'string') {
      if (!OVERVIEW_PMTILES_SOURCE_LAYERS.includes(sl as (typeof OVERVIEW_PMTILES_SOURCE_LAYERS)[number])) {
        issues.push(`layer "${layer.id}" unknown source-layer "${sl}"`);
      }
      if (FORBIDDEN_SOURCE_LAYER_SET.has(sl)) {
        issues.push(`layer "${layer.id}" uses forbidden source-layer "${sl}"`);
      }
      const slLower = sl.toLowerCase();
      for (const forbidden of FORBIDDEN_SOURCE_LAYER_SUBSTRINGS) {
        if (slLower.includes(forbidden)) {
          issues.push(
            `layer "${layer.id}" uses regional/OSM source-layer "${sl}" (matched "${forbidden}")`,
          );
          break;
        }
      }
    }
    if (layer.type === 'symbol') {
      seenSymbol = true;
    } else if (seenSymbol && (layer.type === 'fill' || layer.type === 'line')) {
      issues.push(`layer "${layer.id}" (${layer.type}) appears after symbol layers`);
    }
  }

  const paintTypes = layers.filter((l) => l.type === 'fill' || l.type === 'line' || l.type === 'symbol');
  const firstFill = paintTypes.findIndex((l) => l.type === 'fill');
  const firstLine = paintTypes.findIndex((l) => l.type === 'line');
  const firstSymbol = paintTypes.findIndex((l) => l.type === 'symbol');

  if (firstFill >= 0 && firstLine >= 0 && firstLine < firstFill) {
    issues.push('overview stack: first line layer must not appear before the first fill layer');
  }

  if (firstSymbol > 0) {
    const before = paintTypes.slice(0, firstSymbol);
    if (!before.some((l) => l.type === 'fill') || !before.some((l) => l.type === 'line')) {
      issues.push('overview stack must include fill and line layers before first symbol layer');
    }
  }

  return issues;
}
