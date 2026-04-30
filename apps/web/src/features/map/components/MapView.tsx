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
import type { MapViewProps } from '../types';
import { poisToFeatureCollection } from '../lib/poisToGeoJSON';
import {
  addNavigationControl,
  applyMapOverlayStackOrder,
  bindPoiLayerInteractions,
  createMapEngine,
  ensurePlacesLayer,
  setPlacesGeoJSON,
  setSelectedPoiHighlight,
  syncCountryMinZoom,
  type MapEngine,
} from '../lib/mapEngine';

function MapViewInner({
  pois,
  selectedPoiId,
  selectedPoi,
  cameraTarget,
  onSelectPoiId,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapEngine | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const geojson = useMemo(() => poisToFeatureCollection(pois), [pois]);

  /** Latest POI snapshot for the async `load` event (avoids stale mount closure). */
  const geojsonRef = useRef(geojson);
  const selectedRef = useRef(selectedPoiId);

  useEffect(() => {
    geojsonRef.current = geojson;
    selectedRef.current = selectedPoiId;
  }, [geojson, selectedPoiId]);

  const onSelectRef = useRef(onSelectPoiId);
  useEffect(() => {
    onSelectRef.current = onSelectPoiId;
  }, [onSelectPoiId]);

  /** One-time map engine; teardown on unmount (StrictMode-safe). */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = createMapEngine(containerRef.current);
    addNavigationControl(map);
    mapRef.current = map;

    const onLoad = () => {
      ensurePlacesLayer(map, geojsonRef.current, selectedRef.current);
      applyMapOverlayStackOrder(map);
      setMapReady(true);
    };
    map.on('load', onLoad);

    return () => {
      map.off('load', onLoad);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

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
    if (cameraTarget) return;
    if (!mapReady || !selectedPoi) return;
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [selectedPoi.longitude, selectedPoi.latitude],
      zoom: 16,
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
          padding: cameraTarget.padding ?? 80,
          maxZoom: 17,
          duration: 900,
          essential: true,
        },
      );
    }
  }, [cameraTarget, mapReady]);

  /** Clicks / hover — stable subscription (handler reads latest callback via ref). */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    return bindPoiLayerInteractions(map, (id) => {
      onSelectRef.current(id);
    });
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
