"use client";

/**
 * Myanmar complex-text shaping for dashboard maps.
 *
 * Mirrors the exact setup in apps/web (maplibreComplexText.ts):
 *  1. Load the HarfBuzz plugin via setRTLTextPlugin before any new Map().
 *  2. Redirect PGF-encoded glyph ranges to wipfli's multiscript CDN via transformRequest.
 *     Without transformRequest, Myanmar character ranges (57600-65535 etc.) 404 on the
 *     local /fonts/ server and labels render as tofu boxes.
 *
 * Next.js/webpack does not support Vite's `?url` import suffix, so the plugin is
 * served from apps/dashboard/public/ as a static file.
 */

import maplibregl, {
    type RequestParameters,
    type RequestTransformFunction,
} from "maplibre-gl";

import { dashDevLog } from "@/src/lib/dashDevLog";

/** Served from apps/dashboard/public/maplibre-gl-complex-text.js */
const COMPLEX_TEXT_PLUGIN_URL = "/maplibre-gl-complex-text.js";

/**
 * PGF-encoded glyph range starts that must be redirected to the multiscript CDN.
 * Identical to the list in apps/web/src/features/map/lib/maplibre/maplibreComplexText.ts.
 */
const ENCODED_GLYPH_RANGE_STARTS = new Set([
    63488, 63232, 62976, 62720, 62464, 62208, 61952, 61696, 61440, 61184, 60928, 60672, 60416,
    60160, 59904, 59648, 59392, 59136, 58880, 58624, 58368, 58112, 57856, 57600, 3072, 2816,
    2560, 2304, 10240, 10752,
]);

const DEFAULT_MULTISCRIPT_GLYPH_BASE =
    "https://wipfli.github.io/pgf-glyph-ranges/font/NotoSansMultiscript-Regular-v1";

function multiscriptGlyphUrl(start: number, end: number): string {
    return `${DEFAULT_MULTISCRIPT_GLYPH_BASE}/${start}-${end}.pbf`;
}

function transformGlyphUrlForComplexText(url: string): RequestParameters | undefined {
    const match = url.match(/(\d+)-(\d+)\.pbf(?:\?.*)?$/);
    if (!match) return undefined;
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
    if (!ENCODED_GLYPH_RANGE_STARTS.has(start)) return undefined;
    return { url: multiscriptGlyphUrl(start, end) };
}

/**
 * Pass this as `transformRequest` to every `new maplibregl.Map({ transformRequest })`.
 * Redirects Myanmar complex-script PGF glyph ranges to the multiscript CDN so that
 * HarfBuzz-shaped labels can resolve the correct glyph PBFs.
 */
export const dashboardComplexTextTransformRequest: RequestTransformFunction = (
    url: string,
    resourceType?: Parameters<RequestTransformFunction>[1],
) => {
    if (resourceType === "Glyphs") {
        const override = transformGlyphUrlForComplexText(url);
        if (override) return override;
    }
    return undefined;
};

let pluginLoadPromise: Promise<void> | null = null;

/**
 * Must be called (and awaited) before every `new maplibregl.Map()`.
 * Safe to call multiple times — the shared Promise is reused.
 */
export function ensureDashboardMaplibreComplexTextPlugin(): Promise<void> {
    if (typeof window === "undefined") {
        return Promise.resolve();
    }

    pluginLoadPromise ??= maplibregl
        .setRTLTextPlugin(COMPLEX_TEXT_PLUGIN_URL, false)
        .then(() => {
            dashDevLog("map:complex-text-plugin-loaded", {
                url: COMPLEX_TEXT_PLUGIN_URL,
            });
        })
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message.toLowerCase().includes("rtl text plugin is already set")) {
                return;
            }
            console.warn(
                "[dashboard:map] maplibre-gl-complex-text failed to load; Myanmar shaping may be wrong.",
                error,
            );
        });

    return pluginLoadPromise;
}
