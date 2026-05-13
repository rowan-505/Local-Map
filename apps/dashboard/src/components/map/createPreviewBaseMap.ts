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
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import { getDashboardBasemapCurrentJsonUrl } from "@/src/lib/dashboardBasemapCurrentJsonUrl";
import { resolveDashboardBasemapPmtilesHttpUrl } from "@/src/config/map";
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

type CreatePreviewBaseMapOptions = {
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  /** Override `current.json` URL (defaults to env / {@link getDashboardBasemapCurrentJsonUrl}). */
  currentJsonUrl?: string;
  onLoad?: (map: maplibregl.Map) => void;
};

/**
 * Resolves the active `.pmtiles` HTTP(S) URL from `NEXT_PUBLIC_BASEMAP_PMTILES_URL` or `current.json`,
 * then builds a pure PMTiles vector style.
 * Glyphs are served from `/fonts/{fontstack}/{range}.pbf` (self-hosted Myanmar font).
 */
export async function fetchDashboardPmtilesOnlyStyle(options?: {
  signal?: AbortSignal;
  currentJsonUrl?: string;
}): Promise<StyleSpecification> {
  const currentJsonUrl = options?.currentJsonUrl ?? getDashboardBasemapCurrentJsonUrl();
  const httpUrl = await resolveDashboardBasemapPmtilesHttpUrl({
    currentJsonUrl,
    signal: options?.signal,
  });

  if (IS_DEV) {
    console.info("[dashboard] active PMTiles URL:", httpUrl);
  }

  const style = applyDashboardLocalGlyphs(createBasemapStyle(httpUrl) as StyleSpecification);
  logDashboardMapFontConfig("map:preview-style-fonts");

  return style;
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

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  attachDashboardMapErrorHandler(map, "createPreviewBaseMap");

  map.on("load", () => {
    attachMapLibreDevDebugMap(map);
    options.onLoad?.(map);
  });

  return map;
}
