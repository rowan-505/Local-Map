/**
 * Merges overview PMTiles (z0–z8) under the existing regional basemap style.
 * GeoJSON overlays (POI, routes, search labels) are added in MapView above this stack.
 *
 * Progressive detail: see `basemapZoomVisibility.ts` (overview-only → regional handoff → labels).
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import {
  BASEMAP_ZOOM_VISIBILITY_RULES,
  REGIONAL_BASE_APPEAR_ZOOM,
  patchOverviewLayersForProgressiveDetail,
  patchRegionalLayersForProgressiveDetail,
} from './basemapZoomVisibility';
import {
  OVERVIEW_LAYER_IDS,
  OVERVIEW_SOURCE_ID,
  createOverviewLayers,
  createOverviewSource,
} from './overviewBasemap';

/** @deprecated Use {@link REGIONAL_BASE_APPEAR_ZOOM} */
export const REGIONAL_DETAIL_MIN_ZOOM = REGIONAL_BASE_APPEAR_ZOOM;

/**
 * Composes the public web map style: overview base + regional Yangon/OSM PMTiles on top.
 * Layer order (bottom → top): `background` → overview-* → regional `local-basemap` layers.
 * Only one regional `.pmtiles` URL is wired (existing `VITE_BASEMAP_PMTILES_URL` flow).
 */
export function composeWebMapStyle(
  regionalStyle: StyleSpecification,
  overviewPmtilesHttpUrl: string,
): StyleSpecification {
  const regionalLayers = [...(regionalStyle.layers ?? [])] as LayerSpecification[];
  const background = regionalLayers.find((l) => l.id === 'background');
  const regionalWithoutBackground = regionalLayers.filter((l) => l.id !== 'background');
  const patchedRegional = patchRegionalLayersForProgressiveDetail(regionalWithoutBackground);
  const overviewLayers = patchOverviewLayersForProgressiveDetail(createOverviewLayers());

  return {
    ...regionalStyle,
    name: 'CoreMap Web — overview + regional',
    metadata: {
      ...(typeof regionalStyle.metadata === 'object' && regionalStyle.metadata !== null
        ? regionalStyle.metadata
        : {}),
      'local-map:overview-source': OVERVIEW_SOURCE_ID,
      'local-map:progressive-detail': 'overview-base-regional-handoff',
      'local-map:zoom-rules': JSON.stringify(BASEMAP_ZOOM_VISIBILITY_RULES),
    },
    sources: {
      ...regionalStyle.sources,
      [OVERVIEW_SOURCE_ID]: createOverviewSource(overviewPmtilesHttpUrl),
    },
    layers: [
      ...(background ? [background] : []),
      ...overviewLayers,
      ...patchedRegional,
    ],
  };
}

/** Ordered layer ids after composition (excludes runtime GeoJSON overlays). */
export function getComposedWebMapLayerIds(regionalLayerIds: readonly string[]): string[] {
  const background = regionalLayerIds.includes('background') ? ['background'] : [];
  const regionalRest = regionalLayerIds.filter((id) => id !== 'background');
  return [...background, ...OVERVIEW_LAYER_IDS, ...regionalRest];
}
