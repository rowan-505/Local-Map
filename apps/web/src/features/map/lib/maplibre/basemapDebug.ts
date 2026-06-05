/**
 * Optional basemap diagnostics (dev only). Not wired automatically — call from the console:
 * `window.__MAP_DEBUG_BASEMAP__?.()`
 */
import type { MapEngine } from '../mapEngineTypes';
import { LOCAL_BASEMAP_SOURCE_ID, getBasemapPmtilesUrlOverride } from '../../config/basemapStyle';
import { readOverviewPmtilesUrlFromEnv } from '../../config/overviewPmtilesUrl';
import { OVERVIEW_SOURCE_ID } from './overviewBasemap';

/** Log env URLs, composed sources, and current zoom/maxZoom (manual dev check). */
export function logBasemapDebugSnapshot(map: MapEngine): void {
  if (!import.meta.env.DEV) return;

  const regional = map.getStyle().sources?.[LOCAL_BASEMAP_SOURCE_ID] as
    | { url?: string; maxzoom?: number }
    | undefined;
  const overview = map.getStyle().sources?.[OVERVIEW_SOURCE_ID] as
    | { url?: string; maxzoom?: number }
    | undefined;

  console.info('[map:debug] zoom', map.getZoom().toFixed(2), 'maxZoom', map.getMaxZoom());
  console.info('[map:debug] VITE_BASEMAP_PMTILES_URL (env):', getBasemapPmtilesUrlOverride() ?? '(unset — current.json fallback)');
  console.info('[map:debug] VITE_OVERVIEW_PMTILES_URL (env):', readOverviewPmtilesUrlFromEnv() ?? '(unset)');
  console.info('[map:debug] local-basemap URL:', regional?.url ?? '(missing)', 'source maxzoom:', regional?.maxzoom);
  console.info('[map:debug] overview URL:', overview?.url ?? '(not composed)', 'source maxzoom:', overview?.maxzoom);
}
