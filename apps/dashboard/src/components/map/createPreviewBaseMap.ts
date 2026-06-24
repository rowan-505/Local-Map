"use client";

/**
 * PMTiles-only basemap for all read-only dashboard preview maps.
 *
 * Preview maps (BuildingPreviewMap, PlacePreviewMap, StreetPreviewMap, pickers, PlaceLinkedBuildingsPanel)
 * only need the stable regional basemap as context — not live Martin MVT overlays.
 * Editor maps (BuildingEditorMap, StreetEditorMap, MapView) continue to use
 * `createPlaceBaseMap` / `fetchDashboardPlaceMapStyle` for the merged PMTiles + Martin style.
 */
import type { StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";

import { createBasemapStyle } from "@local-map/map-style/basemapSource";
import { createOverviewStyle } from "@local-map/map-style/overviewSource";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import { getDashboardBasemapCurrentJsonUrl } from "@/src/lib/dashboardBasemapCurrentJsonUrl";
import {
  getDashboardLocalRegionPmtilesBaseUrl,
  isDashboardLoadAllRegionPmtilesEnabled,
  resolveDashboardBasemapPmtilesHttpUrl,
  resolveDashboardOverviewPmtilesHttpUrl,
} from "@/src/config/map";
import {
  composeAllRegionPreviewStyle,
  composeOverviewRegionalPreviewStyle,
} from "./composeDashboardPreviewStyle";
import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { attachDashboardMapErrorHandler } from "./mapErrorHandlers";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import {
  applyDashboardLocalGlyphs,
  logDashboardMapFontConfig,
} from "@/src/lib/map/dashboardMapFonts";
import { logDashboardGlyphServingHealthInDev } from "@/src/lib/map/dashboardGlyphDevCheck";
import {
  dashboardComplexTextTransformRequest,
  ensureDashboardMaplibreComplexTextPlugin,
} from "@/src/lib/map/dashboardMaplibreComplexText";

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Resolves the overview (whole-country) PMTiles style, or `null` when it is not configured /
 * reachable. Missing overview config is a graceful fallback to the regional-only basemap, with a
 * dev hint to set the required env var rather than hardcoding a URL.
 */
async function tryLoadOverviewStyle(
  signal?: AbortSignal,
): Promise<StyleSpecification | null> {
  try {
    const overviewUrl = await resolveDashboardOverviewPmtilesHttpUrl({ signal });
    return createOverviewStyle(overviewUrl) as StyleSpecification;
  } catch (err) {
    if (IS_DEV) {
      console.warn(
        "[dashboard] overview PMTiles unavailable — preview maps use the regional basemap only. " +
          "Set NEXT_PUBLIC_OVERVIEW_PMTILES_URL (or NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL) for whole-country coverage.",
        err,
      );
    }
    return null;
  }
}

type CreatePreviewBaseMapOptions = {
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  /** Override `current.json` URL (defaults to env / {@link getDashboardBasemapCurrentJsonUrl}). */
  currentJsonUrl?: string;
  /** Import-review style: zoom only, no compass or pitch ring. */
  navigationMode?: "default" | "compact";
  onLoad?: (map: maplibregl.Map) => void;
};

/**
 * Resolves the active `.pmtiles` HTTP(S) URL from `NEXT_PUBLIC_BASEMAP_PMTILES_URL` or `current.json`,
 * then builds a pure PMTiles vector style.
 * Glyphs are served from `/fonts/{fontstack}/{range}.pbf` (self-hosted Myanmar font).
 */
let cachedPmtilesOnlyStyle: Promise<StyleSpecification> | null = null;

export async function fetchDashboardPmtilesOnlyStyle(options?: {
  signal?: AbortSignal;
  currentJsonUrl?: string;
}): Promise<StyleSpecification> {
  if (!options?.signal && !options?.currentJsonUrl && cachedPmtilesOnlyStyle) {
    return cachedPmtilesOnlyStyle;
  }

  const load = async (): Promise<StyleSpecification> => {
    const currentJsonUrl = options?.currentJsonUrl ?? getDashboardBasemapCurrentJsonUrl();

    // Whole-country overview base (z0–z8). Optional: when unavailable we fall back to the
    // regional-only basemap (previous behavior) so nothing regresses.
    const overviewStyle = await tryLoadOverviewStyle(options?.signal);

    // DEV-ONLY: full nationwide detail by loading every regional archive locally.
    if (isDashboardLoadAllRegionPmtilesEnabled()) {
      const composed = composeAllRegionPreviewStyle({
        overviewStyle,
        regionBaseUrl: getDashboardLocalRegionPmtilesBaseUrl(),
      });
      if (IS_DEV) {
        console.info("[dashboard] PMTiles: overview + all local regions (dev QA mode)");
      }
      const style = applyDashboardLocalGlyphs(composed);
      logDashboardMapFontConfig("map:preview-style-fonts");
      return style;
    }

    const httpUrl = await resolveDashboardBasemapPmtilesHttpUrl({
      currentJsonUrl,
      signal: options?.signal,
    });

    if (IS_DEV) {
      console.info("[dashboard] active regional PMTiles URL:", httpUrl);
    }

    const regionalStyle = createBasemapStyle(httpUrl) as StyleSpecification;
    const composed = overviewStyle
      ? composeOverviewRegionalPreviewStyle(regionalStyle, overviewStyle)
      : regionalStyle;

    const style = applyDashboardLocalGlyphs(composed);
    logDashboardMapFontConfig("map:preview-style-fonts");

    return style;
  };

  if (!options?.signal && !options?.currentJsonUrl) {
    cachedPmtilesOnlyStyle = load();
    void cachedPmtilesOnlyStyle.catch(() => {
      cachedPmtilesOnlyStyle = null;
    });
    return cachedPmtilesOnlyStyle;
  }

  return load();
}

/**
 * Creates a MapLibre map backed by the pure PMTiles basemap (no Martin MVT overlay sources).
 * Use for all read-only preview maps in the dashboard.
 */
export async function createPreviewBaseMap(
  container: HTMLDivElement,
  options: CreatePreviewBaseMapOptions,
): Promise<maplibregl.Map> {
  await ensurePmtilesProtocol(maplibregl);
  await ensureDashboardMaplibreComplexTextPlugin();
  logDashboardGlyphServingHealthInDev();
  const style = await fetchDashboardPmtilesOnlyStyle({
    currentJsonUrl: options.currentJsonUrl,
  });

  const map = new maplibregl.Map({
    container,
    style,
    center: PLACE_MAP_DEFAULT_CENTER,
    zoom: options.zoom ?? 15,
    minZoom: options.minZoom ?? 0,
    maxZoom: options.maxZoom ?? 22,
    transformRequest: dashboardComplexTextTransformRequest,
  });

  const navMode = options.navigationMode ?? "default";
  if (navMode === "compact") {
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right",
    );
  } else {
    map.addControl(new maplibregl.NavigationControl(), "top-right");
  }
  attachDashboardMapErrorHandler(map, "createPreviewBaseMap");

  map.on("load", () => {
    attachMapLibreDevDebugMap(map);
    options.onLoad?.(map);
  });

  return map;
}
