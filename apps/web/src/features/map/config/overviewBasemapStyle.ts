import type { StyleSpecification } from 'maplibre-gl';
import { createOverviewBasemapStyle } from '../lib/maplibre/overviewBasemap';
import {
  getOverviewPmtilesUrlForWebMap,
  requireOverviewPmtilesUrlForOverviewMode,
} from './overviewPmtilesUrl';

/**
 * Set `VITE_MAP_BASEMAP=overview` in `apps/web/.env.local` for overview-only local testing.
 * Requires `VITE_OVERVIEW_PMTILES_URL` (direct `.pmtiles` HTTP(S) URL).
 */
export function isOverviewBasemapEnabled(): boolean {
  const mode = import.meta.env.VITE_MAP_BASEMAP;
  return typeof mode === 'string' && mode.trim().toLowerCase() === 'overview';
}

/** @deprecated Use {@link getOverviewPmtilesUrlForWebMap} — env-only, no current.json. */
export function getOverviewPmtilesUrlOverride(): string | undefined {
  return getOverviewPmtilesUrlForWebMap();
}

/** Overview-only MapLibre style (`VITE_MAP_BASEMAP=overview`). */
export async function getActiveOverviewBasemapStyle(): Promise<StyleSpecification> {
  const httpUrl = requireOverviewPmtilesUrlForOverviewMode();
  const style = createOverviewBasemapStyle(httpUrl);

  if (import.meta.env.DEV) {
    const source = style.sources?.overview;
    const url =
      source && typeof source === 'object' && 'url' in source
        ? String((source as { url?: string }).url ?? '')
        : '';
    console.info('[map] overview-only basemap active (pmtiles source url set)');
    if (url.startsWith('pmtiles://')) {
      console.info('[map] overview archive host:', url.slice('pmtiles://'.length).split('/')[0]);
    }
  }

  return style;
}
