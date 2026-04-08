/**
 * Single adapter surface for the map feature: parents use `MapView` + `MapViewProps` only.
 * All MapLibre imports for the feature stay behind this barrel (plus `mapEngineTypes`).
 */
import 'maplibre-gl/dist/maplibre-gl.css';

export type { MapEngine, MapMouseEvent } from './mapEngineTypes';
export { createMapboxMap as createMapEngine, addNavigationControl } from './mapbox/mapInstance';
export {
  ensurePlacesLayer,
  setPlacesGeoJSON,
  setSelectedPoiHighlight,
} from './mapbox/placesOnMap';
export { bindPoiLayerInteractions } from './mapbox/poiMapInteractions';
export { applyMapOverlayStackOrder } from './mapbox/mapStackOrder';
export { syncCountryMinZoom } from './mapbox/mapCountryMinZoom';
