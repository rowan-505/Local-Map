/**
 * Simple viewport-driven regional PMTiles loader for the public web map.
 *
 * Loads a region's PMTiles source + layers only when the map is zoomed in (z>=7) and the
 * region's bounds intersect the current viewport; unloads regions that scroll out of view.
 * The overview source is never touched. No caching beyond a Set of currently-loaded ids.
 */
import type { Map as MaplibreMap } from 'maplibre-gl';
import { loadBasemapManifest, type BasemapManifest } from './manifest';
import { bboxOverlapArea, mapBoundsToBbox } from './bbox';
import { addRegionLayers, removeRegionLayers } from './regionLayers';

/** Regional detail appears at or above this zoom (overview-only below). */
export const REGIONAL_MIN_ZOOM = 7;

/**
 * Hard cap on simultaneously-loaded regional PMTiles archives.
 *
 * Why 4: each region is a separate vector source with its own tile fetches, decode, and GPU
 * buffers. At z7+ the viewport spans at most a few Myanmar regions, so 4 covers normal panning
 * (including corners where regions meet) while bounding memory/network/CPU on low-end devices.
 * When more than 4 regions intersect, we keep the 4 with the largest viewport overlap.
 */
export const MAX_LOADED_REGIONS = 4;

/** Coalesce viewport bursts: run the sync at most once per this interval. */
const SYNC_THROTTLE_MS = 300;

const DEV = import.meta.env.DEV;

/** MapLibre surface the loader needs. `MapEngine` (maplibre `Map`) satisfies this. */
export type RegionLoaderMap = Pick<
  MaplibreMap,
  | 'getBounds'
  | 'getZoom'
  | 'getSource'
  | 'addSource'
  | 'removeSource'
  | 'getLayer'
  | 'addLayer'
  | 'removeLayer'
  | 'on'
  | 'off'
  | 'once'
  | 'loaded'
>;

export interface RegionalPmtilesLoaderHandle {
  destroy(): void;
}

/** Source id for a region's PMTiles vector source. */
export function regionSourceId(regionId: string): string {
  return `region-${regionId}`;
}

/**
 * Region ids to keep loaded for the current viewport, ranked by overlap and capped at
 * {@link MAX_LOADED_REGIONS}. Returns `[]` below {@link REGIONAL_MIN_ZOOM} so all regional
 * sources are unloaded and only the always-present overview remains.
 */
export function getVisibleRegionIds(
  map: Pick<MaplibreMap, 'getBounds' | 'getZoom'>,
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

function syncRegions(
  map: RegionLoaderMap,
  manifest: BasemapManifest,
  loaded: Set<string>,
  onAfterSync?: () => void,
): void {
  const visibleIds = getVisibleRegionIds(map, manifest);
  const visible = new Set(visibleIds);

  if (DEV) console.log('[regions] visible:', visibleIds);

  let changed = false;

  // Add regions newly in view. Already-loaded regions are skipped (no source reload), and a
  // region that stays visible across small movements stays loaded — it is neither removed nor
  // re-added, avoiding tile churn.
  for (const region of manifest.regions) {
    if (!visible.has(region.id) || loaded.has(region.id)) continue;
    const sourceId = regionSourceId(region.id);
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'vector', url: `pmtiles://${region.url}` });
    }
    addRegionLayers(map, region.id, sourceId);
    loaded.add(region.id);
    changed = true;
    if (DEV) console.log('[regions] loaded:', region.id);
  }

  // Unload regions that dropped out of view (or below z7). Only `region-*` sources are removed;
  // the overview source/layers are never managed here, so the low-zoom basemap stays continuously
  // loaded and the map never goes blank while regional detail streams in or out.
  for (const regionId of [...loaded]) {
    if (visible.has(regionId)) continue;
    removeRegionLayers(map, regionId);
    const sourceId = regionSourceId(regionId);
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    loaded.delete(regionId);
    changed = true;
    if (DEV) console.log('[regions] unloaded:', regionId);
  }

  if (changed) onAfterSync?.();
}

/**
 * Starts the viewport-driven regional loader. Loads the manifest, runs an initial sync on
 * map load, and re-syncs (throttled) on `moveend` / `zoomend`. Call `destroy()` to detach.
 *
 * @param onAfterSync optional callback invoked after sources/layers change (e.g. to keep
 *        POI/route overlays on top via the app's overlay stack-order helper).
 */
export async function startRegionalPmtilesLoader(
  map: RegionLoaderMap,
  onAfterSync?: () => void,
): Promise<RegionalPmtilesLoaderHandle> {
  const manifest = await loadBasemapManifest();
  const loaded = new Set<string>();
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const runSync = () => {
    if (destroyed) return;
    try {
      syncRegions(map, manifest, loaded, onAfterSync);
    } catch (err) {
      if (DEV) console.warn('[regions] sync failed:', err);
    }
  };

  /** Throttle: at most one run per SYNC_THROTTLE_MS; bursts collapse to a single trailing run. */
  const scheduleSync = () => {
    if (destroyed || throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      runSync();
    }, SYNC_THROTTLE_MS);
  };

  map.on('moveend', scheduleSync);
  map.on('zoomend', scheduleSync);

  if (map.loaded()) {
    runSync();
  } else {
    map.once('load', runSync);
  }

  return {
    destroy() {
      destroyed = true;
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      map.off('moveend', scheduleSync);
      map.off('zoomend', scheduleSync);
    },
  };
}
