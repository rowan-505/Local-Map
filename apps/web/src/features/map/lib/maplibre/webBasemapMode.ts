/**
 * Satellite / hybrid basemap switching for the public web map.
 * Mirrors dashboard preview-map behavior (`dataReviewBasemap.ts`) without importing dashboard code.
 *
 * Dynamic regional PMTiles layers use suffixed ids (`road-major-fill-yangon`). Mode toggling walks
 * the live style and classifies basemap layers by source — not only the static id lists below.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { getSatelliteRasterConfig, type MapMode } from '../../config/mapModes';
import { OVERVIEW_LAYER_IDS, OVERVIEW_SOURCE_ID } from './overviewBasemap';
import type { MapEngine } from '../mapEngineTypes';

export const WEB_SATELLITE_SOURCE_ID = 'web-satellite';
export const WEB_SATELLITE_LAYER_ID = 'web-satellite';

const BASEMAP_VECTOR_SOURCE_ID = 'local-basemap';

const SATELLITE_RASTER_MAX_ZOOM = 19;

export type MapCameraSnapshot = {
  readonly center: [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
};

/** Solid fills hidden whenever satellite imagery is visible. */
export const WEB_IMAGERY_OFF_FILL_LAYERS = [
  'background',
  'overview-ocean',
  'overview-land',
  'overview-lakes',
  'overview-rivers',
  'overview-countries-fill',
  'overview-mmr-admin1-fill',
] as const;

/** Regional + overview vector layers toggled per map mode (excludes runtime GeoJSON overlays). */
export const WEB_TOGGLE_VECTOR_LAYERS = [
  'landuse',
  'water-polygons',
  'water-lines',
  'admin-boundaries',
  'road-minor-casing',
  'road-minor-fill',
  'road-local-casing',
  'road-local-fill',
  'road-medium-casing',
  'road-medium-fill',
  'road-major-casing',
  'road-major-fill',
  'road-labels-major',
  'road-labels-medium',
  'road-labels-local',
  'yangon-road-labels-major',
  'yangon-road-labels-medium',
  'yangon-road-labels-local',
  'admin-labels-township',
  'admin-labels-ward-village-tract',
  'admin-labels-village-local',
  'buildings',
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

/** Longest base ids first so `yangon-road-labels-major` wins over shorter prefixes. */
const BASEMAP_TOGGLE_KEYS = [...WEB_TOGGLE_VECTOR_LAYERS].sort((a, b) => b.length - a.length);

const WEB_IMAGERY_OFF_FILL_LAYER_SET = new Set<string>(WEB_IMAGERY_OFF_FILL_LAYERS);

/**
 * Hybrid overlays kept above imagery — admin boundaries, major roads/labels, place/admin labels.
 * All other vector layers stay hidden in hybrid mode.
 */
export const WEB_HYBRID_ON_LAYERS = new Set<string>([
  'admin-boundaries',
  'road-major-casing',
  'road-major-fill',
  'road-labels-major',
  'yangon-road-labels-major',
  'admin-labels-township',
  'admin-labels-ward-village-tract',
  'admin-labels-village-local',
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
]);

const SATELLITE_INSERT_BEFORE_CANDIDATES = [
  'overview-ocean',
  'landuse',
  'background',
] as const;

type StyleLayerRef = {
  readonly id: string;
  readonly type: string;
  readonly source?: string;
};

function setLayerVisibility(map: MapLibreMap, layerId: string, visible: boolean): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function safeStyleLayers(map: MapLibreMap): StyleLayerRef[] {
  try {
    return (map.getStyle().layers ?? []) as StyleLayerRef[];
  } catch {
    return [];
  }
}

function isManagedBasemapLayer(layer: StyleLayerRef): boolean {
  if (layer.id === 'background') return true;
  const source = layer.source;
  if (!source) return false;
  if (source === OVERVIEW_SOURCE_ID || source === BASEMAP_VECTOR_SOURCE_ID) return true;
  return source.startsWith('region-');
}

/**
 * Maps a style layer id to the static toggle key used by hybrid allowlists.
 * Regional clones use `{baseId}-{regionId}` (e.g. `road-major-fill-yangon` → `road-major-fill`).
 */
export function resolveBasemapToggleKey(layerId: string): string {
  if (WEB_IMAGERY_OFF_FILL_LAYER_SET.has(layerId)) return layerId;

  for (const baseId of BASEMAP_TOGGLE_KEYS) {
    if (layerId === baseId) return baseId;
    if (layerId.startsWith(`${baseId}-`)) return baseId;
  }

  return layerId;
}

function basemapLayerVisible(mode: MapMode, layerId: string): boolean {
  if (mode === 'normal') return true;

  if (WEB_IMAGERY_OFF_FILL_LAYER_SET.has(layerId)) return false;

  if (mode === 'satellite') return false;

  return WEB_HYBRID_ON_LAYERS.has(resolveBasemapToggleKey(layerId));
}

function satelliteInsertBeforeId(map: MapLibreMap): string | undefined {
  for (const id of SATELLITE_INSERT_BEFORE_CANDIDATES) {
    if (map.getLayer(id)) return id;
  }
  return undefined;
}

export function snapshotMapCamera(map: MapEngine): MapCameraSnapshot {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

export function restoreMapCamera(map: MapEngine, camera: MapCameraSnapshot): void {
  map.jumpTo({
    center: camera.center,
    zoom: camera.zoom,
    bearing: camera.bearing,
    pitch: camera.pitch,
  });
}

/** HTML attribution for the active imagery provider (shown only when imagery is visible). */
export function getWebImageryAttributionHtml(): string | null {
  return getSatelliteRasterConfig()?.attribution ?? null;
}

/** Adds Esri (or env-configured) raster imagery below vector basemap layers. Idempotent. */
export function ensureWebSatelliteLayer(map: MapEngine): boolean {
  const config = getSatelliteRasterConfig();
  if (!config) return false;

  if (!map.getSource(WEB_SATELLITE_SOURCE_ID)) {
    map.addSource(WEB_SATELLITE_SOURCE_ID, {
      type: 'raster',
      tiles: [config.tilesUrl],
      tileSize: config.tileSize,
      maxzoom: SATELLITE_RASTER_MAX_ZOOM,
    });
  }

  if (!map.getLayer(WEB_SATELLITE_LAYER_ID)) {
    const beforeId = satelliteInsertBeforeId(map);
    map.addLayer(
      {
        id: WEB_SATELLITE_LAYER_ID,
        type: 'raster',
        source: WEB_SATELLITE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 1,
          'raster-resampling': 'linear',
        },
      },
      beforeId,
    );
  }

  return true;
}

/** Toggle satellite imagery and vector basemap layers without changing camera. */
export function applyWebBasemapMode(map: MapEngine, mode: MapMode): void {
  if (!map.getLayer(WEB_SATELLITE_LAYER_ID)) return;

  const imageryOn = mode !== 'normal';
  setLayerVisibility(map, WEB_SATELLITE_LAYER_ID, imageryOn);

  for (const layer of safeStyleLayers(map)) {
    if (layer.id === WEB_SATELLITE_LAYER_ID) continue;
    if (!isManagedBasemapLayer(layer)) continue;
    setLayerVisibility(map, layer.id, basemapLayerVisible(mode, layer.id));
  }
}

/** Applies basemap mode and restores the camera snapshot taken before the switch. */
export function applyWebBasemapModePreservingCamera(
  map: MapEngine,
  mode: MapMode,
  camera: MapCameraSnapshot,
): void {
  applyWebBasemapMode(map, mode);
  restoreMapCamera(map, camera);
}

/** Resolves after raster/vector tiles settle following a basemap mode change. */
export function waitForBasemapModeSettled(map: MapEngine): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => resolve();
    if (typeof map.loaded === 'function' && map.loaded()) {
      map.once('idle', finish);
      return;
    }
    map.once('idle', finish);
  });
}

/** Fallback to vector map when satellite tiles fail. Returns an unsubscribe function. */
export function bindWebSatelliteTileErrorHandler(
  map: MapEngine,
  onFailure: (message: string) => void,
): () => void {
  const handler = (event: { sourceId?: string; error?: Error }) => {
    if (event.sourceId !== WEB_SATELLITE_SOURCE_ID) return;
    console.warn('[map] Satellite imagery failed to load; reverting to map mode.', event.error);
    const camera = snapshotMapCamera(map);
    applyWebBasemapModePreservingCamera(map, 'normal', camera);
    onFailure('Satellite imagery is unavailable. Switched back to the map view.');
  };

  map.on('error', handler);
  return () => {
    map.off('error', handler);
  };
}

/** Guard: every overview layer id is either a fill (imagery-off) or in the toggle list. */
export function validateWebBasemapLayerCoverage(): void {
  const covered = new Set<string>([
    ...WEB_IMAGERY_OFF_FILL_LAYERS,
    ...WEB_TOGGLE_VECTOR_LAYERS,
  ]);
  for (const id of OVERVIEW_LAYER_IDS) {
    if (!covered.has(id)) {
      throw new Error(`Overview layer "${id}" is missing from web basemap mode layer lists`);
    }
  }
}
