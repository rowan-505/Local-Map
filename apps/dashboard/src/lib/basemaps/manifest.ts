/**
 * Dashboard basemap manifest loader — same structure as the public web map
 * (`apps/web/public/basemaps/manifest.json`). Source file is served same-origin from
 * `apps/dashboard/public/basemaps/manifest.json` (or `NEXT_PUBLIC_BASEMAP_MANIFEST_URL`).
 *
 * The default URL is a same-origin relative path, so a deployed dashboard never fetches a
 * developer's `localhost` tile server. Minimal runtime validation only — no schema library.
 */
import type { BBox } from "./bbox";
import { assertPublicBasemapUrl } from "./basemapEnv";

export interface BasemapPackage {
    id: string;
    version: string;
    url: string;
    bounds: BBox;
    minZoom: number;
    maxZoom: number;
}

export interface BasemapManifest {
    overview: BasemapPackage;
    regions: BasemapPackage[];
}

const DEFAULT_MANIFEST_URL = "/basemaps/manifest.json";

/**
 * Same-origin manifest URL by default; overridable with a public HTTPS env var.
 * In production a localhost override is rejected (never fetched); the relative default is safe.
 */
export function getDashboardBasemapManifestUrl(): string {
    const configured = process.env.NEXT_PUBLIC_BASEMAP_MANIFEST_URL;
    if (typeof configured === "string" && configured.trim() !== "") {
        return assertPublicBasemapUrl(configured.trim(), "NEXT_PUBLIC_BASEMAP_MANIFEST_URL");
    }
    return DEFAULT_MANIFEST_URL;
}

function isBBox(value: unknown): value is BBox {
    return (
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((n) => typeof n === "number" && Number.isFinite(n))
    );
}

function assertPackageShape(value: unknown, label: string): asserts value is BasemapPackage {
    if (typeof value !== "object" || value === null) {
        throw new Error(`Basemap manifest: ${label} must be an object`);
    }
    const pkg = value as Record<string, unknown>;
    if (typeof pkg.id !== "string" || pkg.id.trim() === "") {
        throw new Error(`Basemap manifest: ${label} is missing a valid "id"`);
    }
    if (typeof pkg.url !== "string" || pkg.url.trim() === "") {
        throw new Error(`Basemap manifest: ${label} is missing a valid "url"`);
    }
    if (!isBBox(pkg.bounds)) {
        throw new Error(
            `Basemap manifest: ${label} is missing valid "bounds" [minLng, minLat, maxLng, maxLat]`,
        );
    }
}

/**
 * Fetches and minimally validates the dashboard basemap manifest.
 * On failure throws an error that includes the failed URL so preview maps can surface it.
 */
export async function loadDashboardBasemapManifest(signal?: AbortSignal): Promise<BasemapManifest> {
    const url = getDashboardBasemapManifestUrl();
    let res: Response;
    try {
        res = await fetch(url, { signal, cache: "no-store" });
    } catch (err) {
        throw new Error(
            `Basemap manifest fetch failed (network error) at ${url}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
    if (!res.ok) {
        throw new Error(`Basemap manifest fetch failed: ${res.status} ${res.statusText} (${url})`);
    }

    const data = (await res.json()) as unknown;
    if (typeof data !== "object" || data === null) {
        throw new Error(`Basemap manifest: root must be an object (${url})`);
    }

    const manifest = data as Record<string, unknown>;
    assertPackageShape(manifest.overview, "overview");

    if (!Array.isArray(manifest.regions)) {
        throw new Error(`Basemap manifest: "regions" must be an array (${url})`);
    }
    manifest.regions.forEach((region, i) => assertPackageShape(region, `regions[${i}]`));

    return data as BasemapManifest;
}
