"use client";

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import { dashDevLog } from "@/src/lib/dashDevLog";

/** Local glyph endpoint served by Next.js from `apps/dashboard/public/fonts`. */
export const DASHBOARD_GLYPH_URL = "/fonts/{fontstack}/{range}.pbf";

/** Exact fontstack folder available in `apps/dashboard/public/fonts/fonts.json`. */
export const DASHBOARD_MYANMAR_FONT_STACK = ["NotoSansMyanmar-Regular"] as const;

export function dashboardMyanmarTextFont(): string[] {
    return [...DASHBOARD_MYANMAR_FONT_STACK];
}

export function remapDashboardSymbolLayerFonts(layers: LayerSpecification[]): LayerSpecification[] {
    return layers.map((layer) => {
        if (layer.type !== "symbol") {
            return layer;
        }

        const layout = layer.layout as Record<string, unknown> | undefined;
        if (!layout?.["text-font"]) {
            return layer;
        }

        return {
            ...layer,
            layout: {
                ...layout,
                "text-font": dashboardMyanmarTextFont(),
            },
        } as LayerSpecification;
    });
}

export function applyDashboardLocalGlyphs(style: StyleSpecification): StyleSpecification {
    return {
        ...style,
        glyphs: DASHBOARD_GLYPH_URL,
        layers: remapDashboardSymbolLayerFonts([...(style.layers ?? [])]),
    };
}

export function logDashboardMapFontConfig(scope: string): void {
    dashDevLog(scope, {
        glyphsUrl: DASHBOARD_GLYPH_URL,
        fontstack: dashboardMyanmarTextFont(),
    });
}
