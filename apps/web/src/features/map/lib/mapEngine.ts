/**
 * Single adapter surface for the map feature: parents use `MapView` + `MapViewProps` only.
 * All MapLibre imports for the feature stay behind this barrel (plus `mapEngineTypes`).
 */
import 'maplibre-gl/dist/maplibre-gl.css';

export type { MapEngine, MapMouseEvent } from './mapEngineTypes';
export { createMaplibreMap as createMapEngine, addNavigationControl } from './maplibre/mapInstance';
export {
  ensurePlacesLayer,
  setPlacesGeoJSON,
  setSelectedPoiHighlight,
} from './maplibre/placesOnMap';
export {
  ensureClickedLocationLayer,
  setClickedLocation,
} from './maplibre/clickedLocationOnMap';
export {
  bboxFromDirectionsOverlay,
  ensureDirectionsRouteLayer,
  ensureDirectionsRouteLayers,
  positionActiveRouteLayers,
  setDirectionsRouteOverlay,
  ROUTE_ACTIVE_CASING_LAYER_ID,
  ROUTE_ACTIVE_LINE_LAYER_ID,
  ROUTE_ACTIVE_SOURCE_ID,
  ROUTE_END_POINT_LAYER_ID,
  ROUTE_START_POINT_LAYER_ID,
  type DirectionsMapOverlay,
} from './maplibre/directionsRouteOnMap';
export { bindPoiLayerInteractions } from './maplibre/poiMapInteractions';
export { applyMapOverlayStackOrder } from './maplibre/mapStackOrder';
export { syncCountryMinZoom } from './maplibre/mapCountryMinZoom';
