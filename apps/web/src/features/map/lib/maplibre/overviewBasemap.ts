/**
 * Overview basemap source + layers for apps/web (Natural Earth + core admin0 outline + MIMU admin1, z0–z8).
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
  OVERVIEW_COUNTRY_LABEL_MAX_ZOOM,
  OVERVIEW_COUNTRY_LABEL_HALO_COLOR,
  OVERVIEW_COUNTRY_LABEL_HALO_WIDTH,
  OVERVIEW_COUNTRY_LABEL_MIN_ZOOM,
  OVERVIEW_COUNTRY_LABEL_TEXT_COLOR,
  OVERVIEW_COUNTRY_LABEL_TEXT_SIZE,
  OVERVIEW_EXCLUDE_MMR_COUNTRY_BOUNDARY_FILTER,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_COLOR,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_OPACITY,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_WIDTH,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_COLOR,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_OPACITY,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_WIDTH,
  OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS,
  OVERVIEW_MMR_ADMIN1_BOUNDARY_COLOR,
  OVERVIEW_MMR_ADMIN1_BOUNDARY_MAX_ZOOM,
  OVERVIEW_MMR_ADMIN1_BOUNDARY_MIN_ZOOM,
  OVERVIEW_MMR_ADMIN1_BOUNDARY_OPACITY,
  OVERVIEW_MMR_ADMIN1_BOUNDARY_WIDTH,
  OVERVIEW_MMR_INTERNAL_ADMIN_BOUNDARY_LAYER_ID,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_COLOR,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_LAYER_ID,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_OPACITY,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_WIDTH,
  OVERVIEW_LAKES_FILTER,
  OVERVIEW_MAJOR_CITY_FILTER,
  OVERVIEW_MAX_ZOOM,
  OVERVIEW_MMR_ADMIN1_LABEL_FILTER,
  OVERVIEW_MMR_ADMIN1_LABEL_HALO_COLOR,
  OVERVIEW_MMR_ADMIN1_LABEL_HALO_WIDTH,
  OVERVIEW_MMR_ADMIN1_LABEL_MIN_ZOOM,
  OVERVIEW_MMR_ADMIN1_LABEL_TEXT_COLOR,
  OVERVIEW_MMR_ADMIN1_LABEL_TEXT_OPACITY,
  OVERVIEW_MMR_ADMIN1_LABEL_TEXT_SIZE,
  OVERVIEW_PMTILES_SOURCE_LAYERS,
  OVERVIEW_POPULATED_PLACES_MIN_ZOOM,
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
  'neighbor-country-boundary-line',
  'myanmar-internal-admin-boundary-line',
  'myanmar-admin0-boundary-casing-z02',
  'myanmar-admin0-boundary-line-z02',
  'myanmar-admin0-boundary-casing-z34',
  'myanmar-admin0-boundary-line-z34',
  'myanmar-admin0-boundary-casing-z56',
  'myanmar-admin0-boundary-line-z56',
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
    ...mmrAdmin0BoundaryTierLayers(src),
    countryLabelsLayer(src),
    mmrAdmin1LabelsLayer(src),
    populatedPlacesLayer(src),
  ];
}

/** Logs active Myanmar admin0 boundary tier layers in dev (see overviewConstants). */
export function logOverviewMyanmarHighlightLayers(): void {
  if (import.meta.env?.DEV) {
    const tiers = OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS.map(
      (t) => `${t.lineLayerId}←${t.sourceLayer}(${t.zoomBand})`,
    ).join(', ');
    console.info('[map] Myanmar admin0 outer boundary tiers:', tiers);
  }
}

/** Full MapLibre style for overview mode — used by `overviewBasemapStyle.ts`. */
export function createOverviewBasemapStyle(pmtilesHttpUrl: string): StyleSpecification {
  logOverviewMyanmarHighlightLayers();
  return {
    version: 8,
    name: 'CoreMap Myanmar Overview',
    metadata: {
      'local-map:purpose':
        'Natural Earth + MIMU admin1 overview z0–z8. Myanmar admin0 high-precision land-aligned tiers (z0–z6).',
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
    paint: { 'fill-color': '#bfe8fa', 'fill-opacity': 1 },
  };
}

function landLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-land',
    type: 'fill',
    source,
    'source-layer': 'land',
    maxzoom: LAYER_MAX_ZOOM,
    paint: { 'fill-color': '#f5f8f1', 'fill-opacity': 1 },
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
      'fill-color': '#b9e2f4',
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
      'line-color': '#8fd3ec',
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
      // No duplicate outline — `neighbor-country-boundary-line` draws neighbor borders.
      'fill-color': '#edf1e9',
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
        '#e8f1f8',
        8,
        '#e1f1e6',
        15,
        '#f1eaf2',
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
      'line-color': '#77c7e4',
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 5, 0.5, 8, 0.35, 9, 0.2],
      'line-opacity': OVERVIEW_COASTLINE_OPACITY,
    },
  };
}

function countryBoundariesLayer(source: string): LineLayerSpecification {
  return {
    id: OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_LAYER_ID,
    type: 'line',
    source,
    'source-layer': 'country_boundaries',
    minzoom: 0,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    filter: OVERVIEW_EXCLUDE_MMR_COUNTRY_BOUNDARY_FILTER as unknown as ExpressionSpecification,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    metadata: {
      'local-map:role': 'neighbor-country-boundaries',
      'local-map:note':
        'Natural Earth land boundaries for neighbors only. Segments touching Myanmar are filtered out so mmr_admin0_z* tiers draw the outer ring through z6.',
    },
    paint: {
      'line-color': OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_COLOR,
      'line-width': OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_WIDTH as unknown as ExpressionSpecification,
      'line-opacity':
        OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function mmrAdmin0BoundaryTierLayers(source: string): LayerSpecification[] {
  const layers: LayerSpecification[] = [];
  for (const tier of OVERVIEW_MMR_ADMIN0_BOUNDARY_TIERS) {
    layers.push({
      id: tier.casingLayerId,
      type: 'line',
      source,
      'source-layer': tier.sourceLayer,
      minzoom: tier.minZoom,
      maxzoom: tier.maxZoom,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      metadata: {
        'local-map:role': 'myanmar-admin0-boundary-casing',
        'local-map:note': `Subtle land-tone halo under ${tier.lineLayerId}. ${tier.zoomBand}; hidden z${tier.maxZoom}+.`,
      },
      paint: {
        'line-color': OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_COLOR,
        'line-opacity':
          OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_OPACITY as unknown as ExpressionSpecification,
        'line-width': OVERVIEW_MMR_ADMIN0_BOUNDARY_CASING_WIDTH as unknown as ExpressionSpecification,
      },
    });
    layers.push({
      id: tier.lineLayerId,
      type: 'line',
      source,
      'source-layer': tier.sourceLayer,
      minzoom: tier.minZoom,
      maxzoom: tier.maxZoom,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      metadata: {
        'local-map:role': 'myanmar-admin0-boundary-line',
        'local-map:note': `Myanmar admin0 ${tier.zoomBand}. source-layer ${tier.sourceLayer} (land-aligned NE).`,
      },
      paint: {
        'line-color': OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_COLOR,
        'line-opacity': OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_OPACITY as unknown as ExpressionSpecification,
        'line-width': OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_WIDTH as unknown as ExpressionSpecification,
      },
    });
  }
  return layers;
}

function mmrAdmin1BoundariesLayer(source: string): LineLayerSpecification {
  return {
    id: OVERVIEW_MMR_INTERNAL_ADMIN_BOUNDARY_LAYER_ID,
    type: 'line',
    source,
    'source-layer': 'mmr_admin1',
    minzoom: OVERVIEW_MMR_ADMIN1_BOUNDARY_MIN_ZOOM,
    maxzoom: OVERVIEW_MMR_ADMIN1_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    metadata: {
      'local-map:role': 'myanmar-internal-admin-boundaries',
      'local-map:note':
        'MIMU state/region internal boundaries z3–z10; regional admin_boundaries state_region from z7.',
    },
    paint: {
      'line-color': OVERVIEW_MMR_ADMIN1_BOUNDARY_COLOR,
      'line-width': OVERVIEW_MMR_ADMIN1_BOUNDARY_WIDTH as unknown as ExpressionSpecification,
      'line-opacity': OVERVIEW_MMR_ADMIN1_BOUNDARY_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function countryLabelsLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-country-labels',
    type: 'symbol',
    source,
    'source-layer': 'countries',
    minzoom: OVERVIEW_COUNTRY_LABEL_MIN_ZOOM,
    maxzoom: OVERVIEW_COUNTRY_LABEL_MAX_ZOOM,
    filter: OVERVIEW_COUNTRY_LABEL_FILTER as unknown as ExpressionSpecification,
    layout: {
      'symbol-placement': 'point',
      'text-field': OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': OVERVIEW_COUNTRY_LABEL_TEXT_SIZE as unknown as ExpressionSpecification,
      'text-max-width': 7,
      'text-padding': 52,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': ['-', ['coalesce', ['get', 'LABELRANK'], 10]],
    },
    paint: {
      'text-color': OVERVIEW_COUNTRY_LABEL_TEXT_COLOR,
      'text-halo-color': OVERVIEW_COUNTRY_LABEL_HALO_COLOR,
      'text-halo-width': OVERVIEW_COUNTRY_LABEL_HALO_WIDTH,
      'text-halo-blur': 0.25,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.72, 5, 0.88, 6, 0.8, 6.5, 0.2],
    },
  };
}

function mmrAdmin1LabelsLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-mmr-admin1-labels',
    type: 'symbol',
    source,
    'source-layer': 'mmr_admin1',
    minzoom: OVERVIEW_MMR_ADMIN1_LABEL_MIN_ZOOM,
    maxzoom: LAYER_MAX_ZOOM,
    filter: OVERVIEW_MMR_ADMIN1_LABEL_FILTER as unknown as ExpressionSpecification,
    layout: {
      'symbol-placement': 'point',
      'text-field': OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': OVERVIEW_MMR_ADMIN1_LABEL_TEXT_SIZE as unknown as ExpressionSpecification,
      'text-max-width': 9,
      'text-padding': 56,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': ['coalesce', ['to-number', ['get', 'PCode_V']], 99],
    },
    paint: {
      'text-color': OVERVIEW_MMR_ADMIN1_LABEL_TEXT_COLOR,
      'text-halo-color': OVERVIEW_MMR_ADMIN1_LABEL_HALO_COLOR,
      'text-halo-width': OVERVIEW_MMR_ADMIN1_LABEL_HALO_WIDTH,
      'text-halo-blur': 0.2,
      'text-opacity':
        OVERVIEW_MMR_ADMIN1_LABEL_TEXT_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function populatedPlacesLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-populated-places',
    type: 'symbol',
    source,
    'source-layer': 'populated_places',
    minzoom: OVERVIEW_POPULATED_PLACES_MIN_ZOOM,
    maxzoom: LAYER_MAX_ZOOM,
    filter: OVERVIEW_POPULATED_PLACES_FILTER,
    layout: {
      'symbol-placement': 'point',
      'text-field': OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 10.5, 9.5],
        8,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 12, 10.5],
      ],
      'text-max-width': 7,
      'text-padding': 48,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': ['coalesce', ['to-number', ['get', 'SCALERANK'], ['get', 'scalerank']], 99],
    },
    paint: {
      'text-color': '#3d4a5c',
      'text-halo-color': '#f7f8f6',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.35,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.62, 8, 0.88],
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
