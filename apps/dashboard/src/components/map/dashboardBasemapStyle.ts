"use client";

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { createDashboardBasemapStyle } from "@local-map/map-style/dashboardBasemapSource";
import { getDashboardBasemapCurrentJsonUrl } from "@/src/lib/dashboardBasemapCurrentJsonUrl";
import { resolveDashboardBasemapPmtilesHttpUrl } from "@/src/config/map";
import { PLACE_MAP_STYLE } from "./placeMapConfig";
import {
  DASHBOARD_GLYPH_URL,
  logDashboardMapFontConfig,
  remapDashboardSymbolLayerFonts,
} from "@/src/lib/map/dashboardMapFonts";

/**
 * Martin overlay layer ids to lift from PLACE_MAP_STYLE into the merged dashboard basemap.
 * Line / fill / circle layers retain their paint intact.
 * Symbol layers have their text-font rewritten to use the self-hosted Myanmar fontstack.
 */
const MARTIN_OVERLAY_LAYER_IDS = new Set([
  "streets-casing",
  "streets-line",
  "buildings",
  "places-poi",
  "bus-stops",
  "bus-routes",
  "road-labels",
  "place-labels",
]);

/**
 * Layers from dashboard-map.json that become redundant in the dashboard merged style because
 * Martin vector overlays already provide the same data at a higher quality.
 * These basemap layers get `visibility: none` even when dashboard-map.json makes them visible.
 */
const BASEMAP_LAYERS_HIDDEN_IN_DASHBOARD = new Set([
  "basemap-road-labels-major",
  "basemap-road-labels-medium",
  "basemap-road-labels-local",
]);

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value) as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getDashboardPlaceMapStyleCacheKey(options: {
  includeBusTransitLayers: boolean;
  includeMartinOverlays?: boolean;
}): string {
  const includeMartinOverlays = options.includeMartinOverlays !== false;
  return `bus:${options.includeBusTransitLayers ? 1 : 0}|martin:${includeMartinOverlays ? 1 : 0}`;
}

const dashboardPlaceMapStyleCache = new Map<string, Promise<StyleSpecification>>();

/**
 * Session-cached dashboard style — reuses the same StyleSpecification object (and resolved PMTiles URL)
 * across editor map mounts so form re-renders do not refetch `current.json` or rebuild layers.
 */
export function fetchDashboardPlaceMapStyleCached(options: {
  includeBusTransitLayers: boolean;
  includeMartinOverlays?: boolean;
  signal?: AbortSignal;
  currentJsonUrl?: string;
}): Promise<StyleSpecification> {
  const key = getDashboardPlaceMapStyleCacheKey(options);
  const cached = dashboardPlaceMapStyleCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = fetchDashboardPlaceMapStyle(options);
  dashboardPlaceMapStyleCache.set(key, promise);
  void promise.catch(() => {
    dashboardPlaceMapStyleCache.delete(key);
  });
  return promise;
}

/** Test-only reset. */
export function resetDashboardPlaceMapStyleCacheForTests(): void {
  dashboardPlaceMapStyleCache.clear();
}

function collectSourceIds(layers: readonly LayerSpecification[]): Set<string> {
  const ids = new Set<string>();
  for (const layer of layers) {
    if (typeof layer === "object" && layer !== null && "source" in layer) {
      const s = (layer as { source?: unknown }).source;
      if (typeof s === "string") {
        ids.add(s);
      }
    }
  }
  return ids;
}

/**
 * Merged dashboard map style: PMTiles basemap (dashboard-map.json layers, `basemap-` prefixed) plus
 * Martin vector overlays for live streets, buildings, places, road labels, and optionally bus.
 *
 * All symbol layers resolve glyphs from the self-hosted `/fonts/NotoSansMyanmar-Regular/` served
 * by Next.js from `apps/dashboard/public/fonts/`.
 */
export async function fetchDashboardPlaceMapStyle(options: {
  includeBusTransitLayers: boolean;
  /** When false, style uses PMTiles basemap only (no Martin vector overlay sources/layers). */
  includeMartinOverlays?: boolean;
  signal?: AbortSignal;
  /** Override `current.json` URL (defaults to {@link getDashboardBasemapCurrentJsonUrl}). */
  currentJsonUrl?: string;
}): Promise<StyleSpecification> {
  const includeMartinOverlays = options.includeMartinOverlays !== false;
  const currentJsonUrl = options.currentJsonUrl ?? getDashboardBasemapCurrentJsonUrl();
  const httpUrl = await resolveDashboardBasemapPmtilesHttpUrl({
    currentJsonUrl,
    signal: options.signal,
  });

  // --- PMTiles basemap layers (dashboard-map.json via createDashboardBasemapStyle) ---
  const basemapStyle = createDashboardBasemapStyle(httpUrl) as StyleSpecification;

  // Prefix all basemap layer ids so they never collide with Martin overlay ids.
  // Also hide any basemap layers superseded by Martin overlays.
  const basemapLayers = remapDashboardSymbolLayerFonts((basemapStyle.layers ?? []).map((layer) => {
    const raw = layer as { id?: string; layout?: Record<string, unknown> };
    const newId = `basemap-${raw.id ?? ""}`;
    const overrideVisibility =
      includeMartinOverlays && BASEMAP_LAYERS_HIDDEN_IN_DASHBOARD.has(newId)
        ? { visibility: "none" as const }
        : {};
    return {
      ...layer,
      id: newId,
      layout: { ...(raw.layout ?? {}), ...overrideVisibility },
    } as LayerSpecification;
  }));

  // --- Martin overlay layers --------------------------------------------------
  const basePlace = cloneJson(PLACE_MAP_STYLE);
  const martinLayersRaw = includeMartinOverlays
    ? ((basePlace.layers ?? []).filter((layer) => {
        if (!layer || typeof layer !== "object" || !("id" in layer)) return false;
        const id = (layer as { id: string }).id;
        if (!MARTIN_OVERLAY_LAYER_IDS.has(id)) return false;
        if (!options.includeBusTransitLayers && (id === "bus-routes" || id === "bus-stops")) {
          return false;
        }
        return true;
      }) as LayerSpecification[])
    : [];

  // Remap symbol layer fonts to self-hosted Myanmar fontstack.
  const martinLayers = remapDashboardSymbolLayerFonts(martinLayersRaw);

  // Collect Martin sources that are actually referenced by the chosen layers.
  const neededSourceIds = collectSourceIds(martinLayers);
  const martinSources: StyleSpecification["sources"] = {};
  for (const sid of neededSourceIds) {
    const src = (basePlace.sources as StyleSpecification["sources"])?.[sid];
    if (src) {
      martinSources[sid] = src;
    }
  }

  logDashboardMapFontConfig("map:dashboard-style-fonts");

  return {
    version: 8,
    name: includeMartinOverlays
      ? options.includeBusTransitLayers
        ? "Local Map Dashboard (PMTiles + Martin overlays)"
        : "Local Map Dashboard (PMTiles + Martin overlays, no bus)"
      : "Local Map Dashboard (PMTiles only)",
    // Self-hosted Myanmar fonts — served by Next.js from apps/dashboard/public/fonts/
    glyphs: DASHBOARD_GLYPH_URL,
    sources: {
      ...martinSources,
      ...(basemapStyle.sources as StyleSpecification["sources"]),
    },
    layers: [...basemapLayers, ...martinLayers],
  };
}
