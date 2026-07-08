"use client";

/**
 * PMTiles-only basemap for all read-only dashboard preview maps.
 *
 * Strategy mirrors the public web map: a whole-country overview PMTiles base (z0–z8) from the
 * shared basemap manifest, with detailed regional PMTiles layered on top **dynamically** by a
 * viewport loader (only the regions visible at z>=7 are loaded; max 4 at a time). This gives
 * nationwide coverage without loading all 15 regional archives at once and without hardcoding
 * Yangon.
 *
 * Preview maps (BuildingPreviewMap, PlacePreviewMap, StreetPreviewMap, pickers, TransportPreviewMap,
 * DataReviewCandidateMap) only need the stable basemap as context — not live Martin MVT overlays.
 * Editor maps continue to use `createPlaceBaseMap` / `fetchDashboardPlaceMapStyle`.
 */
import type { StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";

import { createDashboardBasemapStyle } from "@local-map/map-style/dashboardBasemapSource";
import { createDashboardOverviewStyle } from "@local-map/map-style/dashboardOverviewSource";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import { loadDashboardBasemapManifest } from "@/src/lib/basemaps/manifest";
import { validateDashboardBasemapEnv } from "@/src/lib/basemaps/basemapEnv";
import { resolveDashboardBasemapPmtilesHttpUrl } from "@/src/config/map";
import {
  startRegionalPmtilesLoader,
  type RegionalPmtilesLoaderHandle,
} from "@/src/lib/basemaps/regionLoader";
import { DATA_REVIEW_SATELLITE_LAYER_ID } from "./dataReviewBasemap";
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
  /** Import-review style: zoom only, no compass or pitch ring. */
  navigationMode?: "default" | "compact";
  onLoad?: (map: maplibregl.Map) => void;
};

/**
 * Builds the whole-country overview PMTiles style from the basemap manifest (same manifest
 * structure as the public web map). Regional detail is added on top at runtime by the viewport
 * loader — this style intentionally contains only the overview base.
 *
 * Preferred: overview PMTiles from the basemap manifest + regional layers via the viewport loader.
 * Fallback: single regional PMTiles from env / `current.json` when the manifest cannot be loaded
 * (mirrors the public web map's manifest → regional fallback strategy).
 * Glyphs are served from `/fonts/{fontstack}/{range}.pbf` (self-hosted Myanmar font).
 */
let cachedPmtilesOnlyStyle: Promise<StyleSpecification> | null = null;

export async function fetchDashboardPmtilesOnlyStyle(options?: {
  signal?: AbortSignal;
}): Promise<StyleSpecification> {
  if (!options?.signal && cachedPmtilesOnlyStyle) {
    return cachedPmtilesOnlyStyle;
  }

  const load = async (): Promise<StyleSpecification> => {
    // Config-creation validation: surface localhost-in-production basemap env issues. The actual
    // production guard (throwing a clear map error) lives in the URL resolvers; here we only warn
    // in development so misconfigured env vars are caught early without noisy production logs.
    if (IS_DEV) {
      const envCheck = validateDashboardBasemapEnv();
      if (!envCheck.ok) {
        console.warn("[dashboard] basemap env issues:", envCheck.issues);
      }
    }

    try {
      const manifest = await loadDashboardBasemapManifest(options?.signal);
      const overviewStyle = createDashboardOverviewStyle(manifest.overview.url) as StyleSpecification;
      const style = applyDashboardLocalGlyphs(overviewStyle);
      logDashboardMapFontConfig("map:preview-style-fonts");
      if (IS_DEV) {
        console.info(
          "[dashboard] overview PMTiles base loaded from manifest:",
          manifest.overview.url,
        );
      }
      return style;
    } catch (err) {
      if (IS_DEV) {
        console.warn(
          "[dashboard] basemap manifest unavailable; using regional PMTiles fallback:",
          err,
        );
      }
      const httpUrl = await resolveDashboardBasemapPmtilesHttpUrl({ signal: options?.signal });
      const regionalStyle = createDashboardBasemapStyle(httpUrl) as StyleSpecification;
      const style = applyDashboardLocalGlyphs(regionalStyle);
      logDashboardMapFontConfig("map:preview-style-fonts");
      if (IS_DEV) {
        console.info("[dashboard] regional PMTiles fallback active:", httpUrl);
      }
      return style;
    }
  };

  if (!options?.signal) {
    cachedPmtilesOnlyStyle = load();
    void cachedPmtilesOnlyStyle.catch(() => {
      cachedPmtilesOnlyStyle = null;
    });
    return cachedPmtilesOnlyStyle;
  }

  return load();
}

/**
 * Creates a MapLibre map backed by the manifest overview basemap, then starts the viewport-driven
 * regional PMTiles loader (no Martin MVT overlay sources). Use for all read-only preview maps.
 */
export async function createPreviewBaseMap(
  container: HTMLDivElement,
  options: CreatePreviewBaseMapOptions,
): Promise<maplibregl.Map> {
  await ensurePmtilesProtocol(maplibregl);
  await ensureDashboardMaplibreComplexTextPlugin();
  logDashboardGlyphServingHealthInDev();
  const style = await fetchDashboardPmtilesOnlyStyle();

  // Static base layer ids (overview vector layers + `background`) plus the optional satellite
  // raster. The viewport loader inserts regional layers directly above these and below any point
  // overlay so markers/selection stay visible.
  const baseLayerIds = [
    ...(style.layers ?? []).map((layer) => layer.id),
    DATA_REVIEW_SATELLITE_LAYER_ID,
  ];

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

  // Dynamic regional PMTiles (same manifest strategy as the public web map). Detached when the
  // component removes the map so a pending throttle timer cannot run against a destroyed map.
  let loaderHandle: RegionalPmtilesLoaderHandle | null = null;
  let mapRemoved = false;
  const originalRemove = map.remove.bind(map);
  map.remove = () => {
    mapRemoved = true;
    loaderHandle?.destroy();
    originalRemove();
  };
  void startRegionalPmtilesLoader(map, { baseLayerIds })
    .then((handle) => {
      if (mapRemoved) {
        handle.destroy();
        return;
      }
      loaderHandle = handle;
    })
    .catch((err) => {
      if (IS_DEV) console.warn("[dashboard:regions] loader failed to start:", err);
    });

  map.on("load", () => {
    attachMapLibreDevDebugMap(map);
    options.onLoad?.(map);
  });

  return map;
}
