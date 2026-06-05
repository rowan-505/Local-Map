import type { LayerSpecification } from 'maplibre-gl';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import {
  REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
  REGIONAL_OVERZOOM_SOURCE_LAYERS,
} from './basemapZoomVisibility';

const REGIONAL_OVERZOOM_SOURCE_LAYER_SET = new Set<string>(REGIONAL_OVERZOOM_SOURCE_LAYERS);

/** Source-layers that must exist in regional PMTiles archives. */
export const REQUIRED_REGIONAL_PMTILES_SOURCE_LAYERS = [
  ...REGIONAL_OVERZOOM_SOURCE_LAYERS,
  'admin_areas',
  'admin_area_label_points',
] as const;

/** Source-layers referenced by committed base-map.json (subset of archive). */
export const REQUIRED_REGIONAL_STYLE_SOURCE_LAYERS = [
  ...REGIONAL_OVERZOOM_SOURCE_LAYERS,
  'admin_area_label_points',
] as const;

/** Source-layers referenced by committed base-map.json regional layers. */
export function getBasemapJsonRegionalSourceLayers(): string[] {
  const layers = BaseMapStyle.layers as Array<{
    source?: string;
    'source-layer'?: string;
  }>;
  const names = new Set<string>();
  for (const layer of layers) {
    if (layer.source === 'local-basemap' && layer['source-layer']) {
      names.add(layer['source-layer']);
    }
  }
  return [...names].sort();
}

/** Returns missing required source-layers not referenced in base-map.json (style drift). */
export function findMissingRequiredRegionalStyleSourceLayers(): string[] {
  const referenced = new Set(getBasemapJsonRegionalSourceLayers());
  return REQUIRED_REGIONAL_STYLE_SOURCE_LAYERS.filter((name) => !referenced.has(name));
}

/** Ensures composed regional layers are not capped below public max zoom (native tiles z20). */
export function validateRegionalOverzoomLayerMaxZoom(layers: LayerSpecification[]): string[] {
  const issues: string[] = [];
  for (const layer of layers) {
    if (!('source' in layer) || layer.source !== 'local-basemap') continue;
    const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'];
    if (!sourceLayer || !REGIONAL_OVERZOOM_SOURCE_LAYER_SET.has(sourceLayer)) {
      continue;
    }
    if (
      layer.maxzoom !== undefined &&
      layer.maxzoom < REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM
    ) {
      issues.push(
        `${layer.id}: maxzoom ${layer.maxzoom} < ${REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM} (source-layer ${sourceLayer})`,
      );
    }
  }
  return issues;
}
