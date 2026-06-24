/**
 * Production-safe validation for dashboard basemap environment variables.
 *
 * Centralizes the rule: in production a deployed dashboard must use public HTTPS tile/manifest
 * URLs and must NEVER fall back to (or be configured with) a `localhost` URL. In local dev a
 * localhost URL is allowed. No secrets are read or logged here — only public basemap URLs.
 */
import { isLocalDevHost } from "@/src/lib/isLocalDevHost";

const IS_DEV = process.env.NODE_ENV !== "production";

/** User-facing message shown when the deployed dashboard has no usable public basemap configured. */
export const DASHBOARD_BASEMAP_NOT_CONFIGURED_MESSAGE = "Dashboard basemap is not configured";

/**
 * Thrown when no public basemap source is configured in production (no `NEXT_PUBLIC_BASEMAP_*`
 * env var, or one points at localhost) and we are not on a local dev host — so we refuse to fall
 * back to a developer's `localhost` tile server.
 */
export class DashboardBasemapNotConfiguredError extends Error {
    constructor(message: string = DASHBOARD_BASEMAP_NOT_CONFIGURED_MESSAGE) {
        super(message);
        this.name = "DashboardBasemapNotConfiguredError";
    }
}

/**
 * True for `http(s)://localhost`, `127.0.0.1`, or IPv6 loopback origins.
 * Relative URLs (e.g. `/basemaps/manifest.json`) are same-origin, not localhost → returns false.
 */
export function isLocalhostUrl(url: string): boolean {
    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        return false;
    }
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * Guards a basemap tile/manifest URL for the current environment:
 * - Production (deployed host): a localhost URL throws {@link DashboardBasemapNotConfiguredError}
 *   with a clear, user-facing message — never silently fetched.
 * - Local dev: a localhost URL is allowed (returned) with a dev-only console warning.
 *
 * Non-localhost URLs are always returned unchanged.
 */
export function assertPublicBasemapUrl(url: string, varName: string): string {
    if (!isLocalhostUrl(url)) {
        return url;
    }
    if (isLocalDevHost()) {
        if (IS_DEV) {
            console.warn(
                `[dashboard] ${varName} uses a localhost URL (${url}) — allowed in local dev only.`,
            );
        }
        return url;
    }
    throw new DashboardBasemapNotConfiguredError(
        `${DASHBOARD_BASEMAP_NOT_CONFIGURED_MESSAGE}: ${varName} points to a localhost URL in production ` +
            `(${url}). Set a public HTTPS tile URL (e.g. https://tiles.coremapmm.com/...).`,
    );
}

export interface DashboardBasemapEnvValidation {
    ok: boolean;
    /** Human-readable issues (safe to log in dev / show in a map error). */
    issues: string[];
}

/**
 * Holistic check of the dashboard basemap env vars at config-creation time.
 *
 * Flags any `NEXT_PUBLIC_*` basemap URL that is a localhost URL while running in production.
 * Missing-but-required handling lives in the resolvers (they throw
 * {@link DashboardBasemapNotConfiguredError}); the manifest URL is optional and defaults to the
 * same-origin `/basemaps/manifest.json`, so its absence is never an error.
 */
export function validateDashboardBasemapEnv(): DashboardBasemapEnvValidation {
    const inProduction = !isLocalDevHost();
    const issues: string[] = [];

    const entries: Array<[string, string | undefined]> = [
        ["NEXT_PUBLIC_BASEMAP_MANIFEST_URL", process.env.NEXT_PUBLIC_BASEMAP_MANIFEST_URL],
        ["NEXT_PUBLIC_BASEMAP_PMTILES_URL", process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL],
        ["NEXT_PUBLIC_OVERVIEW_PMTILES_URL", process.env.NEXT_PUBLIC_OVERVIEW_PMTILES_URL],
        ["NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL", process.env.NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL],
        ["NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL", process.env.NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL],
    ];

    for (const [name, value] of entries) {
        if (inProduction && value && isLocalhostUrl(value)) {
            issues.push(`${name} is a localhost URL in production (${value})`);
        }
    }

    return { ok: issues.length === 0, issues };
}
