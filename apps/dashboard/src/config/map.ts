import { fetchActiveBasemapPmtilesHttpUrl } from "@local-map/map-style/basemapSource";
import { fetchActiveOverviewPmtilesHttpUrl } from "@local-map/map-style/overviewSource";
import {
    getDashboardBasemapCurrentJsonUrl,
    getDashboardOverviewCurrentJsonUrl,
} from "@/src/lib/dashboardBasemapCurrentJsonUrl";
import {
    assertPublicBasemapUrl,
    DashboardBasemapNotConfiguredError,
} from "@/src/lib/basemaps/basemapEnv";

import "./env";

// Re-exported from the centralized basemap env module so existing importers keep working.
export {
    DASHBOARD_BASEMAP_NOT_CONFIGURED_MESSAGE,
    DashboardBasemapNotConfiguredError,
} from "@/src/lib/basemaps/basemapEnv";

const IS_DEV = process.env.NODE_ENV !== "production";

/** Default local tile-server base for regional `.pmtiles` archives (matches `npm run tiles:serve`). */
const DEFAULT_LOCAL_REGION_PMTILES_BASE_URL = "http://localhost:8080/regions";

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
    // Reject a localhost URL in production (allowed in local dev); never fetch localhost when deployed.
    return assertPublicBasemapUrl(v.trim(), "NEXT_PUBLIC_BASEMAP_PMTILES_URL");
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
    const currentJsonUrl = options?.currentJsonUrl ?? getDashboardBasemapCurrentJsonUrl();
    if (!currentJsonUrl) {
        // Production with no public basemap env var: do NOT fetch the localhost default.
        throw new DashboardBasemapNotConfiguredError();
    }
    return fetchActiveBasemapPmtilesHttpUrl({
        currentJsonUrl,
        signal: options?.signal,
    });
}

/**
 * Optional direct overview `.pmtiles` HTTP(S) URL (`NEXT_PUBLIC_OVERVIEW_PMTILES_URL`).
 * The overview archive provides whole-country context (z0–z8) layered under the regional basemap.
 */
export function getDashboardOverviewPmtilesUrlOverride(): string | undefined {
    const v = process.env.NEXT_PUBLIC_OVERVIEW_PMTILES_URL;
    if (typeof v === "string" && v.trim() !== "") {
        // Reject a localhost URL in production (allowed in local dev); never fetch localhost when deployed.
        return assertPublicBasemapUrl(v.trim(), "NEXT_PUBLIC_OVERVIEW_PMTILES_URL");
    }
    return undefined;
}

/**
 * Resolves the active overview `.pmtiles` HTTP(S) URL: env override, else overview `current.json`.
 * Throws when neither is reachable — callers should fall back to the regional-only basemap.
 */
export async function resolveDashboardOverviewPmtilesHttpUrl(options?: {
    signal?: AbortSignal;
    currentJsonUrl?: string;
}): Promise<string> {
    const override = getDashboardOverviewPmtilesUrlOverride();
    if (override) {
        return override;
    }
    const currentJsonUrl = options?.currentJsonUrl ?? getDashboardOverviewCurrentJsonUrl();
    if (!currentJsonUrl) {
        // Production with no public overview env var: do NOT fetch the localhost default.
        // The overview is optional — `tryLoadOverviewStyle` catches this and renders regional only.
        throw new DashboardBasemapNotConfiguredError();
    }
    return fetchActiveOverviewPmtilesHttpUrl({
        currentJsonUrl,
        signal: options?.signal,
    });
}

/**
 * DEV-ONLY: when `NEXT_PUBLIC_LOAD_ALL_LOCAL_REGION_PMTILES` is truthy, preview maps load every
 * regional archive from the local tile server for full nationwide detail. Ignored in production.
 */
export function isDashboardLoadAllRegionPmtilesEnabled(): boolean {
    if (!IS_DEV) {
        return false;
    }
    const v = process.env.NEXT_PUBLIC_LOAD_ALL_LOCAL_REGION_PMTILES;
    if (typeof v !== "string") {
        return false;
    }
    const normalized = v.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
}

/** Base URL for local region `.pmtiles` archives used by the dev all-regions mode. */
export function getDashboardLocalRegionPmtilesBaseUrl(): string {
    const v = process.env.NEXT_PUBLIC_LOCAL_REGION_PMTILES_BASE_URL;
    if (typeof v === "string" && v.trim() !== "") {
        return v.trim().replace(/\/+$/, "");
    }
    return DEFAULT_LOCAL_REGION_PMTILES_BASE_URL;
}
