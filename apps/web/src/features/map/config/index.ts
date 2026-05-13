/**
 * Map feature configuration — basemap style, interaction defaults.
 * Viewport / bounds / fit padding remain in `../mapDefaults.ts` (region-derived).
 */
export {
  BASEMAP_STYLE,
  getActiveBasemapStyle,
  getBasemapPmtilesUrlOverride,
  LOCAL_BASEMAP_SOURCE_ID,
  MAP_SYMBOL_TEXT_FONT,
  resolveBasemapPmtilesHttpUrl,
} from './basemapStyle';
export { MAP_LIBRE_INTERACTION_DEFAULTS } from './mapLibreInteraction';
