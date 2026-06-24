/**
 * Map feature configuration — basemap style, interaction defaults.
 * Public overview viewport: `publicMapViewport.ts`. Operational helpers: `../mapDefaults.ts`.
 */
export {
  ENABLE_OVERVIEW_VIEWPORT_LOCK,
  OVERVIEW_BOUNDS,
  OVERVIEW_FALLBACK_CENTER,
  OVERVIEW_FALLBACK_MIN_ZOOM,
  OVERVIEW_FALLBACK_ZOOM,
  OVERVIEW_FIT_BOUNDS,
  OVERVIEW_STARTUP_PADDING_COLLAPSED,
  OVERVIEW_STARTUP_PADDING_EXPANDED,
  PUBLIC_MAP_OVERVIEW_BOUNDS,
  PUBLIC_MAP_OVERVIEW_CENTER,
  PUBLIC_MAP_OVERVIEW_FIT_PADDING_SIDEBAR_COLLAPSED,
  PUBLIC_MAP_OVERVIEW_FIT_PADDING_SIDEBAR_OPEN,
  PUBLIC_MAP_OVERVIEW_INITIAL_ZOOM,
  PUBLIC_MAP_OVERVIEW_MAX_BOUNDS,
  PUBLIC_MAP_OVERVIEW_MIN_ZOOM,
  clampPublicMapFlyToTarget,
  fitPublicMapOverviewViewport,
  getEffectivePublicMapMinZoom,
  getPublicMapInitialCamera,
  getPublicMapMapLibreInitOptions,
  getPublicMapOverviewFitPadding,
  getPublicMapOverviewStartupFitPadding,
  isPublicMapOverviewViewportLockEnabled,
  persistPublicMapViewport,
  shouldFitPublicMapOverviewOnLoad,
} from './publicMapViewport';
export {
  BASEMAP_STYLE,
  getActiveBasemapStyle,
  getActiveWebMapStyle,
  getBasemapPmtilesUrlOverride,
  LOCAL_BASEMAP_SOURCE_ID,
  MAP_SYMBOL_TEXT_FONT,
  resolveBasemapPmtilesHttpUrl,
} from './basemapStyle';
export { composeWebMapStyle, REGIONAL_DETAIL_MIN_ZOOM } from '../lib/maplibre/composeWebMapStyle';
export {
  BASEMAP_ZOOM_VISIBILITY_RULES,
  OVERVIEW_BOUNDARY_MAX_ZOOM,
  OVERVIEW_LABELS_END_ZOOM,
  OVERVIEW_ONLY_MAX_ZOOM,
  OVERVIEW_TILE_MAX_ZOOM,
  REGIONAL_BASE_APPEAR_ZOOM,
  patchOverviewLayersForProgressiveDetail,
  patchRegionalLayersForProgressiveDetail,
} from '../lib/maplibre/basemapZoomVisibility';
export {
  getActiveOverviewBasemapStyle,
  getOverviewPmtilesUrlOverride,
  isOverviewBasemapEnabled,
} from './overviewBasemapStyle';
export {
  OverviewPmtilesConfigError,
  getOverviewPmtilesUrlForWebMap,
  readOverviewPmtilesUrlFromEnv,
  resolveOverviewPmtilesUrlForWebMap,
  validateOverviewPmtilesHttpUrl,
} from './overviewPmtilesUrl';
export {
  MartinTileUrlConfigError,
  getMartinTileUrl,
  martinTileTemplate,
  readMartinTileUrlFromEnv,
  resolveMartinTileUrl,
  validateMartinTileHttpUrl,
} from './martinTileUrl';
export {
  EXPECTED_OVERVIEW_SOURCE_LAYERS,
  OVERVIEW_LAYER_IDS,
  OVERVIEW_SOURCE_ID,
  createOverviewBasemapStyle,
  createOverviewLayers,
  createOverviewSource,
  validateOverviewLayerDefinitions,
} from '../lib/maplibre/overviewBasemap';
export { MAP_LIBRE_INTERACTION_DEFAULTS } from './mapLibreInteraction';
export {
  getSatelliteRasterConfig,
  isMapModeAvailable,
  type MapMode,
  type SatelliteRasterConfig,
} from './mapModes';
export {
  MAP_MODE_STORAGE_KEY,
  normalizeMapMode,
  persistMapMode,
  readPersistedMapMode,
} from './mapModeStorage';
export {
  WEB_HYBRID_ON_LAYERS,
  WEB_IMAGERY_OFF_FILL_LAYERS,
  WEB_SATELLITE_LAYER_ID,
  WEB_SATELLITE_SOURCE_ID,
  WEB_TOGGLE_VECTOR_LAYERS,
  applyWebBasemapMode,
  applyWebBasemapModePreservingCamera,
  bindWebSatelliteTileErrorHandler,
  ensureWebSatelliteLayer,
  getWebImageryAttributionHtml,
  restoreMapCamera,
  snapshotMapCamera,
  validateWebBasemapLayerCoverage,
  waitForBasemapModeSettled,
  type MapCameraSnapshot,
} from '../lib/maplibre/webBasemapMode';
