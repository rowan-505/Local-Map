/**
 * Map shell: React owns the container and props; imperative map work goes through `lib/mapEngine`
 * only — parents depend on `MapViewProps`, not MapLibre.
 * Effects are split so POI data updates and selection highlights do not recreate the map.
 * Wrapped in `memo` so parents re-rendering without prop changes do not re-run this tree.
 *
 * Performance: `onSelectPoiId` is read from a ref inside map handlers so we do not
 * re-bind map listeners when the parent passes a new function identity.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { resolveMartinTileUrl } from '../config';
import {
  addTransportSources,
  bindTransportTileErrorHandler,
} from '../lib/maplibre/transportSources';
import { addTransportLayers, setTransportOverlayVisible } from '../lib/maplibre/transportLayers';
import { bindTransportDebugPopups } from '../lib/maplibre/transportDebugPopup';
import type { MapViewProps } from '../types';
import {
  clampPublicMapFlyToTarget,
  fitPublicMapOverviewViewport,
  getPublicMapOverviewStartupFitPadding,
  persistPublicMapViewport,
  shouldFitPublicMapOverviewOnLoad,
} from '../config/publicMapViewport';
import {
  DEFAULT_MAP_CAMERA_LAYOUT,
  visibleMapCameraPadding,
} from '../lib/mapCameraPadding';
import { poisToFeatureCollection } from '../lib/poisToGeoJSON';
import {
  applyMapOverlayStackOrder,
  bindPoiLayerInteractions,
  clearSearchHighlight,
  createMapEngine,
  ensureClickedLocationLayer,
  ensureDirectionsRouteLayers,
  ensurePlacesLayer,
  ensureSearchHighlightLayers,
  fitSearchResult,
  setClickedLocation,
  setDirectionsRouteOverlay,
  setPlacesGeoJSON,
  setSelectedPoiHighlight,
  type MapEngine,
} from '../lib/mapEngine';
import {
  logAdminLabelLayersInDev,
  logAdminSourceFeaturesInDev,
} from '../lib/maplibre/adminLabelLayerDebug';
import {
  logRoadLabelLayersInDev,
  logRoadLabelSourceFeaturesInDev,
} from '../lib/maplibre/roadLabelLayerDebug';
import { applyAllLocalizedMapLabels } from '../lib/maplibre/localizedBasemapLabels';
import {
  applyWebBasemapModePreservingCamera,
  bindWebSatelliteTileErrorHandler,
  ensureWebSatelliteLayer,
  getWebImageryAttributionHtml,
  snapshotMapCamera,
} from '../lib/maplibre/webBasemapMode';
import {
  startRegionalPmtilesLoader,
  type RegionalPmtilesLoaderHandle,
} from '@/lib/basemaps/regionLoader';
const KYAUKTAN_CENTER: [number, number] = [96.3168, 16.6590];
const KYAUKTAN_CENTER_ZOOM = 14.5;

function MapViewInner({
  pois,
  selectedPoiId,
  selectedPoi,
  cameraTarget,
  searchHighlight = null,
  onSearchHighlightLoadingChange,
  cameraLayout,
  clickedLocation,
  directionsOverlay = null,
  routePickMode = null,
  onSelectPoiId,
  onEmptyMapClick,
  onViewportChange,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapEngine | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const languageMode = useMapUiStore((s) => s.languageMode);
  const mapMode = useMapUiStore((s) => s.mapMode);
  const setMapMode = useMapUiStore((s) => s.setMapMode);
  const basemapModeError = useMapUiStore((s) => s.basemapModeError);
  const setBasemapModeError = useMapUiStore((s) => s.setBasemapModeError);
  const utilityCommand = useMapUiStore((s) => s.utilityCommand);
  const transportOverlayVisible = useMapUiStore((s) => s.transportOverlayVisible);
  const transportOverlayVisibleRef = useRef(transportOverlayVisible);
  const languageModeRef = useRef(languageMode);
  const mapModeRef = useRef(mapMode);
  const cameraLayoutRef = useRef(cameraLayout ?? DEFAULT_MAP_CAMERA_LAYOUT);
  const searchHighlightLoadingRef = useRef(onSearchHighlightLoadingChange);
  /** After manual pan/zoom, startup/sidebar auto-fit must not recenter the camera. */
  const hasUserInteractedRef = useRef(false);

  useEffect(() => {
    searchHighlightLoadingRef.current = onSearchHighlightLoadingChange;
  }, [onSearchHighlightLoadingChange]);

  useEffect(() => {
    languageModeRef.current = languageMode;
  }, [languageMode]);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);
  useEffect(() => {
    transportOverlayVisibleRef.current = transportOverlayVisible;
  }, [transportOverlayVisible]);
  useEffect(() => {
    cameraLayoutRef.current = cameraLayout;
  }, [cameraLayout]);

  const geojson = useMemo(() => poisToFeatureCollection(pois), [pois]);

  /** Latest POI snapshot for the async `load` event (avoids stale mount closure). */
  const geojsonRef = useRef(geojson);
  const selectedRef = useRef(selectedPoiId);
  const clickedLocationRef = useRef(clickedLocation ?? null);
  const directionsOverlayRef = useRef(directionsOverlay ?? null);
  const routePickModeRef = useRef(routePickMode);

  useEffect(() => {
    geojsonRef.current = geojson;
    selectedRef.current = selectedPoiId;
  }, [geojson, selectedPoiId]);
  useEffect(() => {
    clickedLocationRef.current = clickedLocation ?? null;
  }, [clickedLocation]);
  useEffect(() => {
    directionsOverlayRef.current = directionsOverlay ?? null;
  }, [directionsOverlay]);
  useEffect(() => {
    routePickModeRef.current = routePickMode;
  }, [routePickMode]);

  const onSelectRef = useRef(onSelectPoiId);
  const onEmptyMapClickRef = useRef(onEmptyMapClick);
  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => {
    onSelectRef.current = onSelectPoiId;
  }, [onSelectPoiId]);
  useEffect(() => {
    onEmptyMapClickRef.current = onEmptyMapClick;
  }, [onEmptyMapClick]);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  /** Startup overview fit — container must have size and style must be loaded. */
  const applyStartupOverviewFit = () => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el || !map.isStyleLoaded()) return;
    if (hasUserInteractedRef.current || !shouldFitPublicMapOverviewOnLoad()) return;
    if (el.clientWidth < 1 || el.clientHeight < 1) return;

    fitPublicMapOverviewViewport(
      map,
      getPublicMapOverviewStartupFitPadding(cameraLayoutRef.current.isSidebarOpen),
    );
  };

  /** One-time map engine; teardown on unmount (StrictMode-safe). */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;

    void (async () => {
      try {
        const map = await createMapEngine(el);
        if (cancelled) {
          map.remove();
          return;
        }
        mapRef.current = map;

        const onLoad = () => {
          ensureWebSatelliteLayer(map);
          const camera = snapshotMapCamera(map);
          applyWebBasemapModePreservingCamera(map, mapModeRef.current, camera);
          // Production is PMTiles-only: Martin is an optional transport overlay. Resolve it
          // without throwing so a missing/invalid VITE_MARTIN_TILE_URL just disables the overlay
          // instead of aborting `onLoad` (which would leave `mapReady` false and stop the
          // regional PMTiles loader from ever starting).
          const martin = resolveMartinTileUrl();
          if (martin.status === 'configured') {
            addTransportSources(map, martin.baseUrl);
            addTransportLayers(map);
            setTransportOverlayVisible(map, transportOverlayVisibleRef.current);
          } else if (import.meta.env.DEV) {
            console.warn('[map] Martin transport overlay disabled:', martin.status);
          }
          ensurePlacesLayer(map, geojsonRef.current, selectedRef.current, languageModeRef.current);
          ensureDirectionsRouteLayers(map);
          setDirectionsRouteOverlay(map, directionsOverlayRef.current ?? null);
          ensureSearchHighlightLayers(map);
          ensureClickedLocationLayer(map, clickedLocationRef.current);
          applyMapOverlayStackOrder(map);
          applyAllLocalizedMapLabels(map, languageModeRef.current);
          logAdminLabelLayersInDev(map);
          logAdminSourceFeaturesInDev(map);
          logRoadLabelLayersInDev(map);
          logRoadLabelSourceFeaturesInDev(map);
          applyStartupOverviewFit();
          requestAnimationFrame(() => {
            applyStartupOverviewFit();
          });
          setMapReady(true);
          emitViewportChange(map, onViewportChangeRef.current);
        };
        map.once('load', onLoad);
      } catch (e) {
        console.error('[map] Failed to initialize MapLibre', e);
      }
    })();

    return () => {
      cancelled = true;
      const map = mapRef.current;
      mapRef.current = null;
      setMapReady(false);
      map?.remove();
    };
  }, []);

  /** Basemap + GeoJSON overlay symbol layers follow UI language mode without reload. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    applyAllLocalizedMapLabels(map, languageMode);
  }, [mapReady, languageMode]);

  /** Satellite / hybrid basemap — visibility only; camera preserved across switches. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const switchMode = () => {
      const run = () => {
        const camera = snapshotMapCamera(map);
        applyWebBasemapModePreservingCamera(map, mapMode, camera);
      };

      if (map.isStyleLoaded()) {
        run();
        return;
      }

      map.once('load', () => {
        if (!cancelled) run();
      });
    };

    switchMode();

    return () => {
      cancelled = true;
    };
  }, [mapReady, mapMode]);

  useEffect(() => {
    if (!basemapModeError) return;
    const timer = window.setTimeout(() => setBasemapModeError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [basemapModeError, setBasemapModeError]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    return bindWebSatelliteTileErrorHandler(map, (message) => {
      setBasemapModeError(message);
      if (mapModeRef.current !== 'normal') {
        setMapMode('normal');
      }
    });
  }, [mapReady, setBasemapModeError, setMapMode]);

  /** Transport overlay visibility — layout-only; basemap/POI layers untouched. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    setTransportOverlayVisible(map, transportOverlayVisible);
    // Re-stack when enabling: regional PMTiles may have loaded (above the overlay) while it was
    // hidden, so lift transport back above the basemap whenever it is shown.
    if (transportOverlayVisible) applyMapOverlayStackOrder(map);
  }, [mapReady, transportOverlayVisible]);

  /** Dev-only: log Martin transport tile errors (no-op in production). */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    return bindTransportTileErrorHandler(map);
  }, [mapReady]);

  /** Debug-only inspection popups for transport features (separate from POI selection). */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    return bindTransportDebugPopups(map);
  }, [mapReady]);

  /**
   * Dynamic regional PMTiles: load only the regions visible in the viewport at z>=7,
   * unload them when out of view. Overlays are re-stacked on top after each change.
   */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    let handle: RegionalPmtilesLoaderHandle | null = null;

    void startRegionalPmtilesLoader(map, () => applyMapOverlayStackOrder(map))
      .then((started) => {
        if (cancelled) {
          started.destroy();
          return;
        }
        handle = started;
      })
      .catch((err) => {
        console.warn('[regions] loader failed to start:', err);
      });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [mapReady]);

  /** Keep latest POI GeoJSON in sync when `pois` changes after the map exists. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    setPlacesGeoJSON(map, geojson);
  }, [mapReady, geojson]);

  /** Selection is paint-only — avoids touching GeoJSON or rebuilding the layer. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    setSelectedPoiHighlight(map, selectedPoiId);
  }, [mapReady, selectedPoiId]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    ensureClickedLocationLayer(map, clickedLocation ?? null);
    setClickedLocation(map, clickedLocation ?? null);
    applyMapOverlayStackOrder(map);
  }, [clickedLocation, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const syncRoute = () => {
      setDirectionsRouteOverlay(map, directionsOverlayRef.current ?? null);
      applyMapOverlayStackOrder(map);
    };

    if (map.isStyleLoaded()) {
      syncRoute();
      return;
    }

    map.once('load', syncRoute);
    return () => {
      map.off('load', syncRoute);
    };
  }, [directionsOverlay, mapReady]);

  /** Search highlight owns the camera while a result is selected. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    if (!searchHighlight) {
      clearSearchHighlight(map);
      searchHighlightLoadingRef.current?.(false);
      return;
    }

    const controller = new AbortController();
    void fitSearchResult(map, searchHighlight, {
      padding: visibleMapCameraPadding(cameraLayoutRef.current, containerRef.current),
      signal: controller.signal,
      onGeometryLoadingChange: (loading) => searchHighlightLoadingRef.current?.(loading),
    }).finally(() => {
      applyMapOverlayStackOrder(map);
    });

    return () => {
      controller.abort();
      // A superseded/aborted fetch must not leave the overlay stuck "loading".
      searchHighlightLoadingRef.current?.(false);
    };
  }, [mapReady, searchHighlight]);

  useEffect(() => {
    if (cameraTarget) return;
    if (searchHighlight) return;
    if (!mapReady || !selectedPoi) return;
    const map = mapRef.current;
    if (!map) return;

    const fly = clampPublicMapFlyToTarget(
      [selectedPoi.longitude, selectedPoi.latitude],
      16,
    );
    map.flyTo({
      center: fly.center,
      zoom: fly.zoom,
      padding: visibleMapCameraPadding(cameraLayoutRef.current, containerRef.current),
      essential: true,
    });
  }, [cameraTarget, mapReady, selectedPoi, searchHighlight]);

  useEffect(() => {
    if (!mapReady || !cameraTarget) return;
    const map = mapRef.current;
    if (!map) return;

    if (cameraTarget.type === 'point') {
      const fly = clampPublicMapFlyToTarget(cameraTarget.center, cameraTarget.zoom ?? 16);
      map.flyTo({
        center: fly.center,
        zoom: fly.zoom,
        duration: 900,
        padding: visibleMapCameraPadding(cameraLayoutRef.current, containerRef.current),
        essential: true,
      });
      return;
    }

    if (cameraTarget.bbox) {
      const [minLng, minLat, maxLng, maxLat] = cameraTarget.bbox;
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: visibleMapCameraPadding(cameraLayoutRef.current, containerRef.current),
          maxZoom: 17,
          duration: 900,
          essential: true,
        },
      );
    }
  }, [cameraTarget, mapReady]);

  useEffect(() => {
    if (!mapReady || !utilityCommand) return;
    const map = mapRef.current;
    if (!map) return;

    if (utilityCommand.action === 'zoomIn') {
      map.zoomIn({ duration: 220 });
      return;
    }

    if (utilityCommand.action === 'zoomOut') {
      map.zoomOut({ duration: 220 });
      return;
    }

    // TODO: Later replace this with browser geolocation using navigator.geolocation.
    if (utilityCommand.action === 'centerKyauktan') {
      map.flyTo({
        center: KYAUKTAN_CENTER,
        zoom: KYAUKTAN_CENTER_ZOOM,
        duration: 900,
        padding: visibleMapCameraPadding(cameraLayoutRef.current, containerRef.current),
        essential: true,
      });
    }
  }, [mapReady, utilityCommand]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    map.resize();
    if (!hasUserInteractedRef.current && shouldFitPublicMapOverviewOnLoad()) {
      const layout = cameraLayout ?? DEFAULT_MAP_CAMERA_LAYOUT;
      fitPublicMapOverviewViewport(
        map,
        getPublicMapOverviewStartupFitPadding(layout.isSidebarOpen),
      );
    }
  }, [cameraLayout, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const markUserInteracted = () => {
      hasUserInteractedRef.current = true;
    };
    const onGestureStart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) markUserInteracted();
    };

    map.on('dragstart', markUserInteracted);
    map.on('movestart', onGestureStart);
    map.on('zoomstart', onGestureStart);
    map.on('wheel', onGestureStart);
    map.on('touchstart', onGestureStart);

    return () => {
      map.off('dragstart', markUserInteracted);
      map.off('movestart', onGestureStart);
      map.off('zoomstart', onGestureStart);
      map.off('wheel', onGestureStart);
      map.off('touchstart', onGestureStart);
    };
  }, [mapReady]);

  /** Crosshair while choosing a route endpoint on the map. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    const canvas = map?.getCanvas();
    if (!canvas?.style) return;
    canvas.style.cursor = routePickMode ? 'crosshair' : '';
    return () => {
      canvas.style.cursor = '';
    };
  }, [mapReady, routePickMode]);

  /** Clicks / hover — stable subscription (handler reads latest callback via ref). */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    return bindPoiLayerInteractions(
      map,
      (id) => {
        onSelectRef.current(id);
      },
      (location) => {
        onEmptyMapClickRef.current?.(location);
      },
      {
        getRoutePickMode: () => routePickModeRef.current,
      },
    );
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const onViewportSettled = () => {
      emitViewportChange(map, onViewportChangeRef.current);
      const c = map.getCenter();
      persistPublicMapViewport({ center: [c.lng, c.lat], zoom: map.getZoom() });
    };
    onViewportSettled();
    map.on('moveend', onViewportSettled);
    map.on('zoomend', onViewportSettled);

    return () => {
      map.off('moveend', onViewportSettled);
      map.off('zoomend', onViewportSettled);
    };
  }, [mapReady]);

  /**
   * MapLibre canvas size follows the container; in flex + `absolute inset-0` layouts the size can
   * settle after first paint — `resize()` syncs the WebGL viewport without changing layout/CSS.
   */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;
    const ro = new ResizeObserver(() => {
      map.resize();
      if (!hasUserInteractedRef.current) {
        applyStartupOverviewFit();
      }
    });
    ro.observe(el);
    map.resize();
    applyStartupOverviewFit();
    return () => ro.disconnect();
  }, [mapReady]);

  const imageryAttribution =
    mapMode !== 'normal' ? getWebImageryAttributionHtml() : null;

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />
      {basemapModeError ? (
        <p
          className="pointer-events-none absolute left-1/2 top-16 z-20 w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl bg-amber-50 px-3 py-2 text-center text-xs leading-5 text-amber-950 ring-1 ring-amber-200 shadow-lg shadow-neutral-900/10"
          role="alert"
        >
          {basemapModeError}
        </p>
      ) : null}
      {imageryAttribution ? (
        <div
          className="pointer-events-none absolute bottom-1 left-1 z-10 max-w-[min(18rem,calc(100%-5rem))] rounded bg-white/80 px-1.5 py-0.5 text-[10px] leading-snug text-neutral-600 shadow-sm backdrop-blur-sm [&_a]:text-sky-700 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: imageryAttribution }}
        />
      ) : null}
    </div>
  );
}

export const MapView = memo(MapViewInner);

export default MapView;

function emitViewportChange(
  map: MapEngine,
  onViewportChange: MapViewProps['onViewportChange'],
): void {
  if (!onViewportChange) return;

  const bounds = map.getBounds();
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();

  onViewportChange({
    bbox: [west, south, east, north],
    zoom: map.getZoom(),
  });
}
