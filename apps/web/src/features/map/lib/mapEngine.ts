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
export { bindPoiLayerInteractions } from './maplibre/poiMapInteractions';
export { applyMapOverlayStackOrder } from './maplibre/mapStackOrder';
export { syncCountryMinZoom } from './maplibre/mapCountryMinZoom';
