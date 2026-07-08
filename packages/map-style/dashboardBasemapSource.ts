/**
 * Dashboard regional basemap style builder.
 *
 * Clones `dashboard-map.json` (fork of `base-map.json` for admin/editor maps).
 * Public web continues to use `basemapSource.ts` + `base-map.json`.
 */
import DashboardMapStyle from './dashboard-map.json';
import {
  BASEMAP_VECTOR_SOURCE_ID,
  createBasemapVectorSource,
  type BasemapCurrentJson,
} from './basemapSource';

export {
  BASEMAP_VECTOR_SOURCE_ID,
  /** Same MapLibre source id as public basemap — only the style JSON differs. */
  BASEMAP_VECTOR_SOURCE_ID as DASHBOARD_BASEMAP_VECTOR_SOURCE_ID,
};
export type { BasemapCurrentJson };
export { createBasemapVectorSource };

type DashboardMapStyleJson = typeof DashboardMapStyle;

function cloneDashboardBasemapJson(style: DashboardMapStyleJson): DashboardMapStyleJson {
  if (typeof structuredClone === 'function') {
    return structuredClone(style) as DashboardMapStyleJson;
  }
  return JSON.parse(JSON.stringify(style)) as DashboardMapStyleJson;
}

/**
 * Full dashboard regional style from `dashboard-map.json` with PMTiles at `pmtilesHttpUrl`.
 * Source id and source-layer names match the public basemap for the same tile archives.
 */
export function createDashboardBasemapStyle(pmtilesHttpUrl: string): DashboardMapStyleJson {
  const style = cloneDashboardBasemapJson(DashboardMapStyle);
  style.sources = {
    [BASEMAP_VECTOR_SOURCE_ID]: createBasemapVectorSource(pmtilesHttpUrl),
  } as DashboardMapStyleJson['sources'];
  return style;
}
