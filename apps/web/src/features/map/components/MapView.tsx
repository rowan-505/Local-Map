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
import type { FeatureCollection } from 'geojson';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { usePublicMapGeoLabelQueries } from '@/features/poi/api/usePublicMapData';
import type { MapViewProps } from '../types';
import { MAP_KYAUKTAN_STARTUP_BOUNDS } from '../mapDefaults';
import {
  DEFAULT_MAP_CAMERA_LAYOUT,
  visibleMapCameraPadding,
} from '../lib/mapCameraPadding';
import { poisToFeatureCollection } from '../lib/poisToGeoJSON';
import {
  applyMapOverlayStackOrder,
  bindPoiLayerInteractions,
  createMapEngine,
  ensureClickedLocationLayer,
  ensurePlacesLayer,
  setClickedLocation,
  setPlacesGeoJSON,
  setSelectedPoiHighlight,
  syncCountryMinZoom,
  type MapEngine,
} from '../lib/mapEngine';
import {
  logAdminLabelLayersInDev,
  logAdminSourceFeaturesInDev,
} from '../lib/maplibre/adminLabelLayerDebug';
import { applyAllLocalizedMapLabels } from '../lib/maplibre/localizedBasemapLabels';
import {
  BUS_ROUTE_LABEL_SOURCE_ID,
  BUS_STOP_LABEL_SOURCE_ID,
  ensurePublicMapGeoJsonLabelLayers,
  PUBLIC_MAP_EMPTY_FC,
  setPublicMapGeoJsonSourceData,
  STREET_LABEL_SOURCE_ID,
} from '../lib/maplibre/publicMapGeoLayers';

const KYAUKTAN_CENTER: [number, number] = [96.3168, 16.6590];
const KYAUKTAN_CENTER_ZOOM = 14.5;

function featureCollectionOrEmpty(data: FeatureCollection | undefined): FeatureCollection {
  if (data && data.type === 'FeatureCollection') return data;
  return { ...PUBLIC_MAP_EMPTY_FC };
}

function MapViewInner({
  pois,
  selectedPoiId,
  selectedPoi,
  cameraTarget,
  cameraLayout,
  clickedLocation,
  onSelectPoiId,
  onEmptyMapClick,
  onViewportChange,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapEngine | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const languageMode = useMapUiStore((s) => s.languageMode);
  const utilityCommand = useMapUiStore((s) => s.utilityCommand);
  const languageModeRef = useRef(languageMode);
  const cameraLayoutRef = useRef(cameraLayout ?? DEFAULT_MAP_CAMERA_LAYOUT);

  useEffect(() => {
    languageModeRef.current = languageMode;
  }, [languageMode]);
  useEffect(() => {
    cameraLayoutRef.current = cameraLayout;
  }, [cameraLayout]);

  const geoLayerResults = usePublicMapGeoLabelQueries();
  const [streetsGeo, , busStopsGeo, busRoutesGeo] = geoLayerResults;

  const geojson = useMemo(() => poisToFeatureCollection(pois), [pois]);

  /** Latest POI snapshot for the async `load` event (avoids stale mount closure). */
  const geojsonRef = useRef(geojson);
  const selectedRef = useRef(selectedPoiId);
  const clickedLocationRef = useRef(clickedLocation ?? null);

  useEffect(() => {
    geojsonRef.current = geojson;
    selectedRef.current = selectedPoiId;
  }, [geojson, selectedPoiId]);
  useEffect(() => {
    clickedLocationRef.current = clickedLocation ?? null;
  }, [clickedLocation]);

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
          ensurePublicMapGeoJsonLabelLayers(map);
          ensurePlacesLayer(map, geojsonRef.current, selectedRef.current, languageModeRef.current);
          ensureClickedLocationLayer(map, clickedLocationRef.current);
          applyMapOverlayStackOrder(map);
          applyAllLocalizedMapLabels(map, languageModeRef.current);
          logAdminLabelLayersInDev(map);
          logAdminSourceFeaturesInDev(map);
          fitKyauktanStartup(map, containerRef.current, cameraLayoutRef.current);
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

  /** API-driven overlays — updating source data does not change camera. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    setPublicMapGeoJsonSourceData(
      map,
      STREET_LABEL_SOURCE_ID,
      streetsGeo.status === 'success'
        ? featureCollectionOrEmpty(streetsGeo.data)
        : { ...PUBLIC_MAP_EMPTY_FC },
    );
    setPublicMapGeoJsonSourceData(
      map,
      BUS_STOP_LABEL_SOURCE_ID,
      busStopsGeo.status === 'success'
        ? featureCollectionOrEmpty(busStopsGeo.data)
        : { ...PUBLIC_MAP_EMPTY_FC },
    );
    setPublicMapGeoJsonSourceData(
      map,
      BUS_ROUTE_LABEL_SOURCE_ID,
      busRoutesGeo.status === 'success'
        ? featureCollectionOrEmpty(busRoutesGeo.data)
        : { ...PUBLIC_MAP_EMPTY_FC },
    );
  }, [
    mapReady,
    streetsGeo.status,
    streetsGeo.data,
    busStopsGeo.status,
    busStopsGeo.data,
    busRoutesGeo.status,
    busRoutesGeo.data,
  ]);

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
    if (cameraTarget) return;
    if (!mapReady || !selectedPoi) return;
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [selectedPoi.longitude, selectedPoi.latitude],
      zoom: 16,
      padding: visibleMapCameraPadding(cameraLayoutRef.current, containerRef.current),
      essential: true,
    });
  }, [cameraTarget, mapReady, selectedPoi]);

  useEffect(() => {
    if (!mapReady || !cameraTarget) return;
    const map = mapRef.current;
    if (!map) return;

    if (cameraTarget.type === 'point') {
      map.flyTo({
        center: [cameraTarget.center[0], cameraTarget.center[1]],
        zoom: cameraTarget.zoom ?? 16,
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

    map.easeTo({
      center: map.getCenter(),
      padding: visibleMapCameraPadding(cameraLayout, containerRef.current),
      duration: 280,
      essential: true,
    });
  }, [cameraLayout, mapReady]);

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
    );
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const onViewportSettled = () => emitViewportChange(map, onViewportChangeRef.current);
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
      syncCountryMinZoom(map);
    });
    ro.observe(el);
    syncCountryMinZoom(map);
    return () => ro.disconnect();
  }, [mapReady]);

  return <div ref={containerRef} className={className ?? 'h-full w-full'} />;
}

export const MapView = memo(MapViewInner);

export default MapView;

function fitKyauktanStartup(
  map: MapEngine,
  container: HTMLElement | null,
  cameraLayout: MapViewProps['cameraLayout'],
): void {
  map.fitBounds(MAP_KYAUKTAN_STARTUP_BOUNDS, {
    padding: visibleMapCameraPadding(cameraLayout, container),
    duration: 0,
    essential: true,
  });
}

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
