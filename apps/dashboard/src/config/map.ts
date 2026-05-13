import { fetchActiveBasemapPmtilesHttpUrl } from "@local-map/map-style/basemapSource";
import { getDashboardBasemapCurrentJsonUrl } from "@/src/lib/dashboardBasemapCurrentJsonUrl";

import "./env";

/**
 * Optional direct PMTiles archive URL from the Next.js client bundle.
 * When set, dashboard maps skip `current.json` and use this URL for the `local-basemap` vector source.
 *
 * MapLibre still needs `ensurePmtilesProtocol` from `@local-map/map-style/registerPmtilesProtocol`
 * once per map boot — it is idempotent and safe across React rerenders.
 */
export function getDashboardBasemapPmtilesUrlOverride(): string | undefined {
  const v = process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL;
  if (typeof v === "string" && v.trim() !== "") {
    return v.trim();
  }
  return undefined;
}

/**
 * Resolves the HTTP(S) URL of the active `.pmtiles` file: env override, else `current.json`
 * (defaults to local tile server — see {@link getDashboardBasemapCurrentJsonUrl}).
 */
export async function resolveDashboardBasemapPmtilesHttpUrl(options?: {
  signal?: AbortSignal;
  currentJsonUrl?: string;
}): Promise<string> {
  const override = getDashboardBasemapPmtilesUrlOverride();
  if (override) {
    return override;
  }
  return fetchActiveBasemapPmtilesHttpUrl({
    currentJsonUrl: options?.currentJsonUrl ?? getDashboardBasemapCurrentJsonUrl(),
    signal: options?.signal,
  });
}
