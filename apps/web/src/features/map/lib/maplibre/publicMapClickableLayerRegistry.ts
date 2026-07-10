/**
 * Central registry for public-map pointer hit-testing.
 *
 * Layer id strings live in {@link publicMapMarkerLayerIds.ts}; this module composes
 * clickable layer groups and shared query helpers so click handlers stay in sync.
 *
 * Click priority is resolved in {@link publicMapClickResolver.ts}.
 */
import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { MapEngine, MapMouseEvent } from '../mapEngineTypes';
import {
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_SELECTED_CIRCLE_LAYER_ID,
  TRANSPORT_SELECTED_HALO_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds';

/** POI circles and selected pin — same priority order as legacy POI click handling. */
export const PUBLIC_MAP_POI_CLICK_LAYER_IDS = [
  PLACES_SELECTED_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
] as const;

/** Invisible transport hitboxes (primary click target for stops and terminals). */
export const PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS = [
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
] as const;

/** Bus stop + station-class stop labels (same MVT features as hitboxes). */
export const PUBLIC_MAP_TRANSPORT_STOP_CLICK_LAYER_IDS = [
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
] as const;

/** Terminal, interchange, and ferry landing click targets. */
export const PUBLIC_MAP_TRANSPORT_TERMINAL_CLICK_LAYER_IDS = [
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
] as const;

/** Selected transport pin overlay — re-click keeps the open detail panel. */
export const PUBLIC_MAP_TRANSPORT_SELECTED_CLICK_LAYER_IDS = [
  TRANSPORT_SELECTED_HALO_LAYER_ID,
  TRANSPORT_SELECTED_CIRCLE_LAYER_ID,
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
] as const;

/** All transport point click + hover-intercept layers (deduped). */
export const PUBLIC_MAP_TRANSPORT_CLICK_LAYER_IDS = [
  ...PUBLIC_MAP_TRANSPORT_STOP_CLICK_LAYER_IDS,
  ...PUBLIC_MAP_TRANSPORT_TERMINAL_CLICK_LAYER_IDS,
  ...PUBLIC_MAP_TRANSPORT_SELECTED_CLICK_LAYER_IDS,
] as const;

/** Layers that show pointer cursor on transport hover (hitboxes only). */
export const PUBLIC_MAP_TRANSPORT_HOVER_LAYER_IDS = PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS;

/** Back-compat aliases — prefer PUBLIC_MAP_* names in new code. */
export const TRANSPORT_POINT_HITBOX_LAYER_IDS = PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS;
export const TRANSPORT_SELECTED_POINT_CLICK_LAYER_IDS =
  PUBLIC_MAP_TRANSPORT_SELECTED_CLICK_LAYER_IDS;
export const TRANSPORT_POINT_HIT_LAYER_IDS = PUBLIC_MAP_TRANSPORT_CLICK_LAYER_IDS;

export function filterPresentMapLayers(
  map: MapEngine,
  layerIds: readonly string[],
): string[] {
  return layerIds.filter((id) => map.getLayer(id));
}

export function isAnyMapLayerVisible(
  map: MapEngine,
  layerIds: readonly string[],
): boolean {
  return layerIds.some(
    (id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none',
  );
}

export function queryTopRenderedMapFeature(
  map: MapEngine,
  point: MapMouseEvent['point'],
  layerIds: readonly string[],
): MapGeoJSONFeature | null {
  const presentLayers = filterPresentMapLayers(map, layerIds);
  if (presentLayers.length === 0) return null;
  const hits = map.queryRenderedFeatures(point, { layers: presentLayers });
  return hits[0] ?? null;
}

/** True when a transport stop/terminal hitbox is under the cursor (labels excluded). */
export function isTransportClickTargetUnderCursor(
  map: MapEngine,
  point: MapMouseEvent['point'],
): boolean {
  if (!isAnyMapLayerVisible(map, PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS)) {
    return false;
  }
  const stopHit = queryTopRenderedMapFeature(map, point, [TRANSPORT_STOPS_HITBOX_LAYER_ID]);
  if (stopHit) return true;
  return (
    queryTopRenderedMapFeature(map, point, [
      TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
      TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
    ]) !== null
  );
}

export function isSelectedTransportClickLayer(layerId: string | undefined): boolean {
  return (
    layerId !== undefined &&
    (PUBLIC_MAP_TRANSPORT_SELECTED_CLICK_LAYER_IDS as readonly string[]).includes(layerId)
  );
}
