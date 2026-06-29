/**
 * MapLibre source/layer helpers for rendering the own-user location: a blue dot
 * plus a subtle accuracy circle (fill + outline) beneath it.
 *
 * Two GeoJSON sources keep the dot and the accuracy ring independent. Layers are
 * idempotent: `ensure` adds them once, `update` only sets data, `remove` tears them
 * down cleanly. No API, no Supabase, no PMTiles/Martin involvement — this only adds
 * GeoJSON overlays on top of the existing style.
 */
import type { GeoJSONSource } from 'maplibre-gl';
import type { MapEngine } from '@/features/map/lib/mapEngineTypes';
import {
  createAccuracyCircleFeature,
  createUserLocationPointFeature,
} from './userLocationGeoJson';
import type { UserLocationFix } from './userLocationTypes';

export const USER_LOCATION_SOURCE_ID = 'user-location' as const;
export const USER_LOCATION_ACCURACY_SOURCE_ID = 'user-location-accuracy' as const;
export const USER_LOCATION_DOT_LAYER_ID = 'user-location-dot' as const;
export const USER_LOCATION_ACCURACY_FILL_LAYER_ID = 'user-location-accuracy-fill' as const;
export const USER_LOCATION_ACCURACY_OUTLINE_LAYER_ID =
  'user-location-accuracy-outline' as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Idempotently add the user-location sources and layers. Accuracy fill/outline are
 * added before the dot so the dot renders on top; added last, they sit above the
 * existing style layers.
 */
export function ensureUserLocationLayers(map: MapEngine): void {
  if (!map.getSource(USER_LOCATION_ACCURACY_SOURCE_ID)) {
    map.addSource(USER_LOCATION_ACCURACY_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }
  if (!map.getSource(USER_LOCATION_SOURCE_ID)) {
    map.addSource(USER_LOCATION_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }

  if (!map.getLayer(USER_LOCATION_ACCURACY_FILL_LAYER_ID)) {
    map.addLayer({
      id: USER_LOCATION_ACCURACY_FILL_LAYER_ID,
      type: 'fill',
      source: USER_LOCATION_ACCURACY_SOURCE_ID,
      paint: {
        'fill-color': '#2563eb',
        'fill-opacity': 0.12,
      },
    });
  }

  if (!map.getLayer(USER_LOCATION_ACCURACY_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: USER_LOCATION_ACCURACY_OUTLINE_LAYER_ID,
      type: 'line',
      source: USER_LOCATION_ACCURACY_SOURCE_ID,
      paint: {
        'line-color': '#2563eb',
        'line-opacity': 0.35,
        'line-width': 1,
      },
    });
  }

  if (!map.getLayer(USER_LOCATION_DOT_LAYER_ID)) {
    map.addLayer({
      id: USER_LOCATION_DOT_LAYER_ID,
      type: 'circle',
      source: USER_LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 6.5, 18, 8],
        'circle-color': '#2563eb',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
        'circle-pitch-alignment': 'map',
      },
    });
  }
}

/**
 * Update the rendered location. Pass `null` to clear both overlays. The accuracy
 * source clears when the fix has no usable accuracy (circle feature is `null`).
 */
export function updateUserLocationLayers(
  map: MapEngine,
  fix: UserLocationFix | null,
): void {
  ensureUserLocationLayers(map);

  const dotSource = map.getSource(USER_LOCATION_SOURCE_ID) as GeoJSONSource | undefined;
  const accuracySource = map.getSource(USER_LOCATION_ACCURACY_SOURCE_ID) as
    | GeoJSONSource
    | undefined;

  if (!fix) {
    dotSource?.setData(EMPTY_FC);
    accuracySource?.setData(EMPTY_FC);
    return;
  }

  dotSource?.setData({
    type: 'FeatureCollection',
    features: [createUserLocationPointFeature(fix)],
  });

  const circle = createAccuracyCircleFeature(fix);
  accuracySource?.setData(
    circle ? { type: 'FeatureCollection', features: [circle] } : EMPTY_FC,
  );
}

/**
 * Lift the user-location layers to the top of the stack (accuracy below, dot on
 * top). Called from the central overlay stack-order pass so dynamically loaded
 * regional PMTiles layers never bury the blue dot.
 */
export function moveUserLocationLayersToTop(map: MapEngine): void {
  for (const layerId of [
    USER_LOCATION_ACCURACY_FILL_LAYER_ID,
    USER_LOCATION_ACCURACY_OUTLINE_LAYER_ID,
    USER_LOCATION_DOT_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

/** Remove all user-location layers and sources (safe if absent). */
export function removeUserLocationLayers(map: MapEngine): void {
  for (const layerId of [
    USER_LOCATION_DOT_LAYER_ID,
    USER_LOCATION_ACCURACY_OUTLINE_LAYER_ID,
    USER_LOCATION_ACCURACY_FILL_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const sourceId of [USER_LOCATION_SOURCE_ID, USER_LOCATION_ACCURACY_SOURCE_ID]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}
