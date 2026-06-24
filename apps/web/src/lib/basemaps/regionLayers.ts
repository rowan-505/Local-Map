/**
 * Regional MapLibre layer factory for dynamic PMTiles regions.
 *
 * Clones the committed regional layer definitions from the shared `base-map.json` (the current
 * source of truth for basemap styling) once per region: each layer keeps its exact paint/layout
 * and `source-layer`, but gets a region-unique `id` and is repointed at the region's source.
 *
 * Scope: layers only. Sources are added/removed by the caller (the viewport controller, later).
 */
import type { LayerSpecification, Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '@local-map/map-style/base-map.json';
import { BASEMAP_VECTOR_SOURCE_ID } from '@local-map/map-style/basemapSource';

/** Subset of the MapLibre map used by this factory (keeps the surface small and testable). */
export type RegionLayerMap = Pick<MaplibreMap, 'getLayer' | 'addLayer' | 'removeLayer'>;

const BASE_STYLE = BaseMapStyle as unknown as StyleSpecification;

function cloneLayer(layer: LayerSpecification): LayerSpecification {
  return typeof structuredClone === 'function'
    ? structuredClone(layer)
    : (JSON.parse(JSON.stringify(layer)) as LayerSpecification);
}

/** Region-unique layer id, e.g. `water-polygons` + `ayeyarwady` → `water-polygons-ayeyarwady`. */
export function regionLayerId(baseLayerId: string, regionId: string): string {
  return `${baseLayerId}-${regionId}`;
}

/**
 * Committed regional layers from `base-map.json`, in their existing bottom→top paint order:
 * landuse → water polygons/lines → admin boundaries → roads → road labels → admin labels → buildings.
 * This proven order is preserved as-is so cloned regions render identically to the current style.
 */
function getRegionalTemplateLayers(): LayerSpecification[] {
  const layers = (BASE_STYLE.layers ?? []) as LayerSpecification[];
  return layers.filter(
    (layer) =>
      layer.id !== 'background' &&
      'source' in layer &&
      (layer as { source?: string }).source === BASEMAP_VECTOR_SOURCE_ID,
  );
}

/** Region-unique clones of the regional template layers, bound to `sourceId`. */
export function buildRegionLayers(regionId: string, sourceId: string): LayerSpecification[] {
  return getRegionalTemplateLayers().map((layer) => {
    const cloned = cloneLayer(layer);
    return {
      ...cloned,
      id: regionLayerId(cloned.id, regionId),
      source: sourceId,
    } as LayerSpecification;
  });
}

/** Deterministic list of layer ids this factory creates for a region (used by removal). */
export function regionLayerIds(regionId: string): string[] {
  return getRegionalTemplateLayers().map((layer) => regionLayerId(layer.id, regionId));
}

/**
 * Adds the region's layers (in stable paint order) on top of the current stack.
 * Idempotent: skips any layer id that already exists. Does NOT add the source.
 */
export function addRegionLayers(map: RegionLayerMap, regionId: string, sourceId: string): void {
  for (const layer of buildRegionLayers(regionId, sourceId)) {
    if (map.getLayer(layer.id)) continue;
    map.addLayer(layer);
  }
}

/** Removes only the layers belonging to `regionId`. Leaves the source untouched. */
export function removeRegionLayers(map: RegionLayerMap, regionId: string): void {
  for (const id of regionLayerIds(regionId)) {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    }
  }
}
