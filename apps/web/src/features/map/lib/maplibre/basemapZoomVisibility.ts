/**
 * Progressive basemap detail for apps/web — overview PMTiles (national z0–z8 archive)
 * plus **one** regional PMTiles source at a time (Yangon today; not all 15 regions).
 *
 * Zoom bands (MapLibre zoom levels):
 * - z4.3–z6.9: overview only — regional vector layers stay off (minzoom gates).
 * - z7–z7.9: regional OSM/admin boundaries take over; overview line work fades out (maxzoom 8).
 * - z8+: overview boundary/coastline/MIMU lines hidden; regional PMTiles dominates.
 * - z10+: overview labels off; regional roads, labels, and buildings dominate.
 *
 * Natural Earth / MIMU overview boundaries are low-zoom context only — not drawn on top of
 * regional `admin_boundaries` at detail zoom.
 *
 * Tile URLs are unchanged; only layer minzoom/maxzoom/opacity are adjusted at compose time.
 */
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { PUBLIC_MAP_OVERVIEW_MIN_ZOOM } from '../../config/publicMapViewport';

/** Lowest zoom the public map allows — overview framing. */
export const OVERVIEW_ONLY_MAX_ZOOM = 6.9;

/** Regional `local-basemap` layers begin appearing (single active region archive). */
export const REGIONAL_BASE_APPEAR_ZOOM = 7;

/** Overview symbol layers turn off so regional street/admin labels are not doubled. */
export const OVERVIEW_LABELS_END_ZOOM = 10;

/** Matches overview PMTiles archive max zoom; regional detail intended from z7+. */
export const OVERVIEW_TILE_MAX_ZOOM = 8;

/** Overview boundary lines hidden at z9+; opacity fades from z7.5. */
export const OVERVIEW_BOUNDARY_MAX_ZOOM = 9;

const OVERVIEW_BOUNDARY_LAYER_IDS = new Set([
  'overview-country-boundaries',
  'overview-coastline',
  'overview-mmr-admin0-outline',
  'overview-mmr-admin1-boundaries',
]);

/** Overview admin1 fill — hide with boundaries so regional admin is not doubled. */
const OVERVIEW_ADMIN_FILL_LAYER_IDS = new Set(['overview-mmr-admin1-fill', 'overview-countries-fill']);

/**
 * Regional layer ids from `base-map.json` — raise minzoom so nothing draws below z7.
 * Roads (z10+) and building/label layers already start late; left as-is to avoid duplicate OSM detail.
 */
const REGIONAL_LAYER_MIN_ZOOM_FLOOR: Readonly<Record<string, number>> = {
  landuse: REGIONAL_BASE_APPEAR_ZOOM,
  'water-polygons': REGIONAL_BASE_APPEAR_ZOOM,
  'water-lines': REGIONAL_BASE_APPEAR_ZOOM,
  'admin-boundaries': REGIONAL_BASE_APPEAR_ZOOM,
};

const OVERVIEW_LABEL_LAYER_IDS = new Set([
  'overview-country-labels',
  'overview-mmr-admin1-labels',
  'overview-populated-places',
]);

/** Fade overview place names out before regional street/POI labels (z10+). */
const OVERVIEW_PLACES_LABEL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  0.65,
  8,
  0.82,
  9,
  0.45,
  OVERVIEW_LABELS_END_ZOOM,
  0,
];

/** Country / state labels — visible through z9, off by z10. */
const OVERVIEW_ADMIN_LABEL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.85,
  8,
  0.92,
  9,
  0.55,
  OVERVIEW_LABELS_END_ZOOM,
  0,
];

export function patchRegionalLayersForProgressiveDetail(
  layers: LayerSpecification[],
): LayerSpecification[] {
  return layers.map(patchRegionalLayerMinZoom);
}

export function patchOverviewLayersForProgressiveDetail(
  layers: LayerSpecification[],
): LayerSpecification[] {
  return layers.map(patchOverviewLayerVisibility);
}

function patchRegionalLayerMinZoom(layer: LayerSpecification): LayerSpecification {
  const appearAt = REGIONAL_LAYER_MIN_ZOOM_FLOOR[layer.id];
  if (appearAt === undefined) {
    return layer;
  }
  // Listed layers are regional *base* only — snap to z7 (e.g. water-lines 9→7, landuse 8→7).
  return { ...layer, minzoom: appearAt };
}

function patchOverviewLayerVisibility(layer: LayerSpecification): LayerSpecification {
  if (OVERVIEW_BOUNDARY_LAYER_IDS.has(layer.id)) {
    return { ...layer, maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM };
  }

  if (OVERVIEW_ADMIN_FILL_LAYER_IDS.has(layer.id) && layer.type === 'fill') {
    return {
      ...layer,
      maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
      paint: {
        ...layer.paint,
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          0.2,
          6,
          0.34,
          6.9,
          0.38,
          7,
          0.12,
          7.9,
          0,
        ] as ExpressionSpecification,
      },
    };
  }

  if (!OVERVIEW_LABEL_LAYER_IDS.has(layer.id)) {
    return layer;
  }

  if (layer.type !== 'symbol') {
    return { ...layer, maxzoom: OVERVIEW_LABELS_END_ZOOM };
  }

  const textOpacity =
    layer.id === 'overview-populated-places'
      ? OVERVIEW_PLACES_LABEL_OPACITY
      : OVERVIEW_ADMIN_LABEL_OPACITY;

  return {
    ...layer,
    maxzoom: OVERVIEW_LABELS_END_ZOOM,
    paint: {
      ...layer.paint,
      'text-opacity': textOpacity,
    },
  };
}

/** Human-readable rules for docs/tests. */
export const BASEMAP_ZOOM_VISIBILITY_RULES = {
  overviewOnly: `z${PUBLIC_MAP_OVERVIEW_MIN_ZOOM}–z${OVERVIEW_ONLY_MAX_ZOOM}`,
  overviewBoundaries: `line opacity fades z7.5–8.5; layer maxzoom ${OVERVIEW_BOUNDARY_MAX_ZOOM}`,
  regionalBase: `z${REGIONAL_BASE_APPEAR_ZOOM}+ (admin-boundaries from regional PMTiles)`,
  overviewLabels: `visible z${PUBLIC_MAP_OVERVIEW_MIN_ZOOM}–z${OVERVIEW_LABELS_END_ZOOM - 0.1}, faded/hidden z${OVERVIEW_LABELS_END_ZOOM}+`,
  regionalDominant: `z${OVERVIEW_LABELS_END_ZOOM}+ (roads z10+, labels z12+ per base-map.json)`,
} as const;
