/**
 * Dashboard overview basemap style builder.
 *
 * Clones `dashboard-overview-map.json` (fork of `overview-map.json`).
 * Public web production overview uses TypeScript layers in `apps/web/.../overviewBasemap.ts`;
 * dashboard preview maps use this JSON path via `createDashboardOverviewStyle`.
 */
import DashboardOverviewMapStyle from './dashboard-overview-map.json';
import { OVERVIEW_VECTOR_SOURCE_ID } from './overviewConstants';
import { createOverviewVectorSource } from './overviewSource';

export { OVERVIEW_VECTOR_SOURCE_ID };

type DashboardOverviewMapStyleJson = typeof DashboardOverviewMapStyle;

function cloneDashboardOverviewJson(
  style: DashboardOverviewMapStyleJson,
): DashboardOverviewMapStyleJson {
  if (typeof structuredClone === 'function') {
    return structuredClone(style) as DashboardOverviewMapStyleJson;
  }
  return JSON.parse(JSON.stringify(style)) as DashboardOverviewMapStyleJson;
}

/**
 * Full dashboard overview style from `dashboard-overview-map.json` with PMTiles at `pmtilesHttpUrl`.
 */
export function createDashboardOverviewStyle(
  pmtilesHttpUrl: string,
): DashboardOverviewMapStyleJson {
  const style = cloneDashboardOverviewJson(DashboardOverviewMapStyle);
  style.sources = {
    [OVERVIEW_VECTOR_SOURCE_ID]: createOverviewVectorSource(pmtilesHttpUrl),
  } as DashboardOverviewMapStyleJson['sources'];
  return style;
}
