"use client";

import maplibregl from "maplibre-gl";

import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { attachDashboardMapErrorHandler } from "./mapErrorHandlers";
import { fetchDashboardPlaceMapStyle } from "./dashboardBasemapStyle";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import { logDashboardGlyphServingHealthInDev } from "@/src/lib/map/dashboardGlyphDevCheck";
import {
  dashboardComplexTextTransformRequest,
  ensureDashboardMaplibreComplexTextPlugin,
} from "@/src/lib/map/dashboardMaplibreComplexText";

type CreatePlaceBaseMapOptions = {
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  /**
   * When false, omits Martin bus stop / bus route vector layers (use on Buildings admin maps).
   * Default true for place pickers and place preview.
   */
  includeBusTransitLayers?: boolean;
  onLoad?: (map: maplibregl.Map) => void;
};

export async function createPlaceBaseMap(
  container: HTMLDivElement,
  options: CreatePlaceBaseMapOptions,
): Promise<maplibregl.Map> {
  const includeBus =
    options.includeBusTransitLayers !== undefined ? options.includeBusTransitLayers : true;

  await ensurePmtilesProtocol(maplibregl);
  await ensureDashboardMaplibreComplexTextPlugin();
  logDashboardGlyphServingHealthInDev();
  const style = await fetchDashboardPlaceMapStyle({ includeBusTransitLayers: includeBus });

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
  attachDashboardMapErrorHandler(map, "createPlaceBaseMap");

  map.on("load", () => {
    attachMapLibreDevDebugMap(map);
    options.onLoad?.(map);
  });

  return map;
}
