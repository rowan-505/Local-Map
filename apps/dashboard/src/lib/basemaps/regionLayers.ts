/**
 * Regional MapLibre layer factory for dynamic PMTiles regions in dashboard preview maps.
 *
 * Ported from the public web map (`apps/web/.../regionLayers.ts`): clones the committed regional
 * layer definitions from the shared `base-map.json` once per region, keeping each layer's paint /
 * layout / `source-layer`, with a region-unique id repointed at the region's source.
 *
 * Dashboard difference: symbol layers are remapped to the dashboard's self-hosted Myanmar glyph
 * stack (`remapDashboardSymbolLayerFonts`) so labels render with the bundled fonts.
 *
 * Scope: layers only. Sources are added/removed by the caller (the viewport loader).
 */
import type { LayerSpecification, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import BaseMapStyle from "@local-map/map-style/base-map.json";
import { BASEMAP_VECTOR_SOURCE_ID } from "@local-map/map-style/basemapSource";

import { remapDashboardSymbolLayerFonts } from "@/src/lib/map/dashboardMapFonts";

/** Subset of the MapLibre map used by this factory. */
export type RegionLayerMap = Pick<MaplibreMap, "getLayer" | "addLayer" | "removeLayer">;

const BASE_STYLE = BaseMapStyle as unknown as StyleSpecification;

function cloneLayer(layer: LayerSpecification): LayerSpecification {
    return typeof structuredClone === "function"
        ? structuredClone(layer)
        : (JSON.parse(JSON.stringify(layer)) as LayerSpecification);
}

/** Region-unique layer id, e.g. `water-polygons` + `ayeyarwady` → `water-polygons-ayeyarwady`. */
export function regionLayerId(baseLayerId: string, regionId: string): string {
    return `${baseLayerId}-${regionId}`;
}

/**
 * Committed regional layers from `base-map.json`, in their existing bottom→top paint order.
 * Preserved as-is so cloned regions render identically to the production basemap.
 */
function getRegionalTemplateLayers(): LayerSpecification[] {
    const layers = (BASE_STYLE.layers ?? []) as LayerSpecification[];
    return layers.filter(
        (layer) =>
            layer.id !== "background" &&
            "source" in layer &&
            (layer as { source?: string }).source === BASEMAP_VECTOR_SOURCE_ID,
    );
}

/** Region-unique clones of the template layers, bound to `sourceId`, with dashboard fonts. */
export function buildRegionLayers(regionId: string, sourceId: string): LayerSpecification[] {
    const cloned = getRegionalTemplateLayers().map((layer) => {
        const copy = cloneLayer(layer);
        return {
            ...copy,
            id: regionLayerId(copy.id, regionId),
            source: sourceId,
        } as LayerSpecification;
    });
    return remapDashboardSymbolLayerFonts(cloned);
}

/** Deterministic list of layer ids this factory creates for a region (used by removal/anchoring). */
export function regionLayerIds(regionId: string): string[] {
    return getRegionalTemplateLayers().map((layer) => regionLayerId(layer.id, regionId));
}

/**
 * Adds the region's layers (in stable paint order). When `beforeId` is given, layers are inserted
 * beneath that layer (used to keep point overlays / satellite raster above the regional basemap).
 * Idempotent: skips any layer id that already exists. Does NOT add the source.
 */
export function addRegionLayers(
    map: RegionLayerMap,
    regionId: string,
    sourceId: string,
    beforeId?: string,
): void {
    for (const layer of buildRegionLayers(regionId, sourceId)) {
        if (map.getLayer(layer.id)) continue;
        map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
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
