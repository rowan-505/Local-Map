/**
 * Viewport-driven regional PMTiles loader for dashboard preview maps.
 *
 * Ported from the public web map (`apps/web/.../regionLoader.ts`): loads a region's PMTiles source
 * + layers only when zoomed in (z>=7) and the region's bounds intersect the viewport; unloads
 * regions that scroll out of view. The overview source is never touched.
 *
 * Dashboard differences:
 *  - logging is DEV-only (no noisy production console output);
 *  - regional layers are inserted beneath the first overlay (point markers / satellite raster) so
 *    preview overlays stay on top, using `baseLayerIds` (overview + background + satellite) plus the
 *    manifest's known region layer ids to find the anchor.
 */
import type { Map as MaplibreMap } from "maplibre-gl";

import { loadDashboardBasemapManifest, type BasemapManifest } from "./manifest";
import { bboxOverlapArea, mapBoundsToBbox } from "./bbox";
import { addRegionLayers, regionLayerIds, removeRegionLayers } from "./regionLayers";

/** Regional detail appears at or above this zoom (overview-only below). */
export const REGIONAL_MIN_ZOOM = 7;

/**
 * Hard cap on simultaneously-loaded regional PMTiles archives. Each region is a separate vector
 * source (own fetches/decode/GPU buffers); at z7+ the viewport spans only a few regions, so 4
 * covers normal panning and corners while bounding memory/network. When more than 4 intersect,
 * the 4 with the largest viewport overlap are kept.
 */
export const MAX_LOADED_REGIONS = 4;

/** Coalesce viewport bursts: run the sync at most once per this interval. */
const SYNC_THROTTLE_MS = 300;

const DEV = process.env.NODE_ENV !== "production";

function devLog(...args: unknown[]): void {
    if (DEV) console.info(...args);
}

/** MapLibre surface the loader needs. The full maplibre `Map` satisfies this. */
export type RegionLoaderMap = Pick<
    MaplibreMap,
    | "getBounds"
    | "getZoom"
    | "getSource"
    | "addSource"
    | "removeSource"
    | "getLayer"
    | "addLayer"
    | "removeLayer"
    | "getStyle"
    | "on"
    | "off"
    | "once"
    | "loaded"
>;

export interface RegionalPmtilesLoaderHandle {
    destroy(): void;
}

export interface StartRegionalPmtilesLoaderOptions {
    /**
     * Layer ids that form the static base (overview vector layers + `background` + satellite raster).
     * Regional layers are inserted directly above these and below any other (overlay) layer.
     */
    baseLayerIds?: readonly string[];
}

/** Source id for a region's PMTiles vector source. */
export function regionSourceId(regionId: string): string {
    return `region-${regionId}`;
}

/**
 * Region ids to keep loaded for the current viewport, ranked by overlap and capped at
 * {@link MAX_LOADED_REGIONS}. Returns `[]` below {@link REGIONAL_MIN_ZOOM}.
 */
export function getVisibleRegionIds(
    map: Pick<MaplibreMap, "getBounds" | "getZoom">,
    manifest: BasemapManifest,
): string[] {
    if (map.getZoom() < REGIONAL_MIN_ZOOM) {
        return [];
    }
    const viewport = mapBoundsToBbox(map.getBounds());
    return manifest.regions
        .map((region) => ({ id: region.id, overlap: bboxOverlapArea(viewport, region.bounds) }))
        .filter((entry) => entry.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, MAX_LOADED_REGIONS)
        .map((entry) => entry.id);
}

/**
 * First layer that is neither a base layer (overview/background/satellite) nor a managed region
 * layer — i.e. the bottom-most preview overlay. New regional layers are inserted before it so
 * markers/selection overlays stay on top. Returns `undefined` when there is no overlay yet
 * (regional layers then go on top, and overlays added later by the component sit above them).
 */
function firstOverlayLayerId(
    map: RegionLoaderMap,
    baseLayerIds: Set<string>,
    managedRegionLayerIds: Set<string>,
): string | undefined {
    let layers: { id: string }[] = [];
    try {
        layers = (map.getStyle().layers ?? []) as { id: string }[];
    } catch {
        return undefined;
    }
    for (const layer of layers) {
        if (baseLayerIds.has(layer.id)) continue;
        if (managedRegionLayerIds.has(layer.id)) continue;
        return layer.id;
    }
    return undefined;
}

function syncRegions(
    map: RegionLoaderMap,
    manifest: BasemapManifest,
    loaded: Set<string>,
    baseLayerIds: Set<string>,
    managedRegionLayerIds: Set<string>,
): void {
    const zoom = map.getZoom();
    const visibleIds = getVisibleRegionIds(map, manifest);
    const visible = new Set(visibleIds);

    const added: string[] = [];
    const removed: string[] = [];

    const beforeId = firstOverlayLayerId(map, baseLayerIds, managedRegionLayerIds);

    // Add regions newly in view. Already-loaded regions are skipped (no source reload); a region
    // that stays visible across small movements stays loaded (no churn).
    for (const region of manifest.regions) {
        if (!visible.has(region.id) || loaded.has(region.id)) continue;
        const sourceId = regionSourceId(region.id);
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: "vector", url: `pmtiles://${region.url}` });
        }
        addRegionLayers(map, region.id, sourceId, beforeId);
        loaded.add(region.id);
        added.push(region.id);
        devLog(`[dashboard:regions] + ${region.id} pmtiles://${region.url}`);
    }

    // Unload regions out of view (or below z7). Only `region-*` sources/layers are touched; the
    // overview base is never managed here, so the map never goes blank.
    for (const regionId of [...loaded]) {
        if (visible.has(regionId)) continue;
        removeRegionLayers(map, regionId);
        const sourceId = regionSourceId(regionId);
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
        loaded.delete(regionId);
        removed.push(regionId);
        devLog(`[dashboard:regions] - ${regionId}`);
    }

    devLog(
        `[dashboard:regions] z=${zoom.toFixed(1)} visible=[${visibleIds.join(",")}] loaded=[${[
            ...loaded,
        ].join(",")}]` +
            (added.length ? ` added=[${added.join(",")}]` : "") +
            (removed.length ? ` removed=[${removed.join(",")}]` : ""),
    );
}

/**
 * Starts the viewport-driven regional loader. Loads the manifest, runs an initial sync on map
 * load, and re-syncs (throttled) on `moveend` / `zoomend`. Call `destroy()` to detach.
 */
export async function startRegionalPmtilesLoader(
    map: RegionLoaderMap,
    options?: StartRegionalPmtilesLoaderOptions,
): Promise<RegionalPmtilesLoaderHandle> {
    const manifest = await loadDashboardBasemapManifest();
    const loaded = new Set<string>();
    const baseLayerIds = new Set<string>(options?.baseLayerIds ?? []);
    const managedRegionLayerIds = new Set<string>(
        manifest.regions.flatMap((region) => regionLayerIds(region.id)),
    );
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const runSync = () => {
        if (destroyed) return;
        try {
            syncRegions(map, manifest, loaded, baseLayerIds, managedRegionLayerIds);
        } catch (err) {
            if (DEV) console.warn("[dashboard:regions] sync failed:", err);
        }
    };

    const scheduleSync = () => {
        if (destroyed || throttleTimer) return;
        throttleTimer = setTimeout(() => {
            throttleTimer = null;
            runSync();
        }, SYNC_THROTTLE_MS);
    };

    map.on("moveend", scheduleSync);
    map.on("zoomend", scheduleSync);

    if (map.loaded()) {
        runSync();
    } else {
        map.once("load", runSync);
    }

    return {
        destroy() {
            destroyed = true;
            if (throttleTimer) {
                clearTimeout(throttleTimer);
                throttleTimer = null;
            }
            map.off("moveend", scheduleSync);
            map.off("zoomend", scheduleSync);
        },
    };
}
