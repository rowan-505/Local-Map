"use client";

/**
 * Whole-country basemap composition for dashboard preview maps.
 *
 * Mirrors the public web map's production strategy (`apps/web/.../composeWebMapStyle.ts`):
 *   overview PMTiles (z0–z8 Natural Earth + admin, nationwide) as the base, with the
 *   detailed regional PMTiles layered on top. This is what gives the public map
 *   whole-country coverage — the dashboard preview previously rendered the regional
 *   archive (Yangon) only, so anything outside it was blank.
 *
 * Reuses dashboard style builders from `@local-map/map-style`
 * (`createDashboardBasemapStyle`, `createBasemapVectorSource`) so no Vite-only `apps/web`
 * code is imported and public web keeps `base-map.json`.
 */
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import {
    DASHBOARD_BASEMAP_VECTOR_SOURCE_ID,
    createBasemapVectorSource,
    createDashboardBasemapStyle,
} from "@local-map/map-style/dashboardBasemapSource";

/** Region archives published by the local tile server (mirrors the web QA manifest list). */
export const DASHBOARD_LOCAL_REGION_PMTILES_ENTRIES = [
    { region: "yangon", version: "v2" },
    { region: "bago", version: "v1" },
    { region: "ayeyarwady", version: "v1" },
    { region: "mandalay", version: "v1" },
    { region: "magway", version: "v1" },
    { region: "sagaing", version: "v1" },
    { region: "tanintharyi", version: "v1" },
    { region: "naypyitaw", version: "v1" },
    { region: "kachin", version: "v1" },
    { region: "kayah", version: "v1" },
    { region: "kayin", version: "v1" },
    { region: "chin", version: "v1" },
    { region: "mon", version: "v1" },
    { region: "rakhine", version: "v1" },
    { region: "shan", version: "v1" },
] as const;

/** Local archive URL for a region package: `<base>/<region>/<region>-<version>.pmtiles`. */
export function regionPmtilesLocalHttpUrl(
    baseUrl: string,
    region: string,
    version: string,
): string {
    return `${baseUrl}/${region}/${region}-${version}.pmtiles`;
}

function cloneLayer(layer: LayerSpecification): LayerSpecification {
    if (typeof structuredClone === "function") {
        return structuredClone(layer);
    }
    return JSON.parse(JSON.stringify(layer)) as LayerSpecification;
}

function layerSource(layer: LayerSpecification): string | undefined {
    return "source" in layer ? (layer as { source?: string }).source : undefined;
}

function nonBackgroundLayers(style: StyleSpecification): LayerSpecification[] {
    return ((style.layers ?? []) as LayerSpecification[]).filter((l) => l.id !== "background");
}

function findBackground(style: StyleSpecification): LayerSpecification | undefined {
    return ((style.layers ?? []) as LayerSpecification[]).find((l) => l.id === "background");
}

/**
 * Overview (whole-country) base + a single detailed regional basemap on top.
 * Layer order (bottom → top): `background` → overview-* → regional layers.
 */
export function composeOverviewRegionalPreviewStyle(
    regionalStyle: StyleSpecification,
    overviewStyle: StyleSpecification,
): StyleSpecification {
    const background = findBackground(regionalStyle);
    const regionalRest = nonBackgroundLayers(regionalStyle);
    const overviewLayers = nonBackgroundLayers(overviewStyle);

    return {
        ...regionalStyle,
        name: "CoreMap Dashboard — overview + regional",
        sources: {
            ...overviewStyle.sources,
            ...regionalStyle.sources,
        },
        layers: [...(background ? [background] : []), ...overviewLayers, ...regionalRest],
    };
}

/**
 * DEV-ONLY: overview base (optional) + every regional archive from the local tile server.
 * Regional layer templates are cloned from `dashboard-map.json` and retargeted per region
 * source. Not for production — loads all packages at once (no viewport loading exists yet).
 */
export function composeAllRegionPreviewStyle(args: {
    overviewStyle: StyleSpecification | null;
    regionBaseUrl: string;
}): StyleSpecification {
    const { overviewStyle, regionBaseUrl } = args;
    const entries = DASHBOARD_LOCAL_REGION_PMTILES_ENTRIES;

    // Seed regional layer templates from the shared base style (URL only seeds the source).
    const seedUrl = regionPmtilesLocalHttpUrl(regionBaseUrl, entries[0].region, entries[0].version);
    const templateStyle = createDashboardBasemapStyle(seedUrl) as StyleSpecification;
    const background = findBackground(templateStyle);
    const regionalTemplate = ((templateStyle.layers ?? []) as LayerSpecification[]).filter(
        (l) => l.id !== "background" && layerSource(l) === DASHBOARD_BASEMAP_VECTOR_SOURCE_ID,
    );

    const sources: NonNullable<StyleSpecification["sources"]> = {};
    const regionalLayers: LayerSpecification[] = [];

    for (const { region, version } of entries) {
        const sourceId = `${DASHBOARD_BASEMAP_VECTOR_SOURCE_ID}-${region}-${version}`;
        sources[sourceId] = createBasemapVectorSource(
            regionPmtilesLocalHttpUrl(regionBaseUrl, region, version),
        ) as NonNullable<StyleSpecification["sources"]>[string];
        for (const layer of regionalTemplate) {
            regionalLayers.push({
                ...cloneLayer(layer),
                id: `${layer.id}-${region}-${version}`,
                source: sourceId,
            } as LayerSpecification);
        }
    }

    const overviewLayers = overviewStyle ? nonBackgroundLayers(overviewStyle) : [];
    const overviewSources = overviewStyle?.sources ?? {};

    return {
        ...templateStyle,
        name: "CoreMap Dashboard — overview + all local regions (dev QA)",
        sources: {
            ...overviewSources,
            ...sources,
        },
        layers: [...(background ? [background] : []), ...overviewLayers, ...regionalLayers],
    };
}
