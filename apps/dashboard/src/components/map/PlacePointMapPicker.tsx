"use client";

import { type MutableRefObject, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MaplibreMap } from "maplibre-gl";

import { createPreviewBaseMap } from "./createPreviewBaseMap";
import {
    applyDataReviewBasemapMode,
    ensureDataReviewSatelliteLayer,
    type DataReviewBasemapMode,
} from "./dataReviewBasemap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    addPlaceLiveOverlay,
    clearLiveOverlay,
    LIVE_PLACE_SOURCE_ID,
    placeLatLngToLiveFeatureCollection,
    type PlaceLiveOverlayLabelProps,
} from "@/src/lib/map/liveOverlays";

type PlacePointMapPickerProps = {
    lat: number | null;
    lng: number | null;
    onChange: (coords: { lat: number; lng: number }) => void;
    /** Optional labels for the API-backed `place-live-overlay` symbol layer */
    overlayNames?: PlaceLiveOverlayLabelProps | null;
    basemapMode?: DataReviewBasemapMode;
    onMapReady?: (map: MaplibreMap | null) => void;
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
    viewportClassName?: string;
};

const DEFAULT_ZOOM = 18;

/** Matches live overlay dot — high-contrast handle above PMTiles */
const LIVE_PLACE_MARKER_COLOR = "#06b6d4";

function roundCoord(value: number) {
    return Number(value.toFixed(7));
}

function hasCoordinates(lat: number | null, lng: number | null): lat is number {
    return (
        typeof lat === "number" &&
        Number.isFinite(lat) &&
        typeof lng === "number" &&
        Number.isFinite(lng)
    );
}

export default function PlacePointMapPicker({
    lat,
    lng,
    onChange,
    overlayNames = null,
    basemapMode = "map",
    onMapReady,
    mapSurfaceRef,
    viewportClassName = MAP_PREVIEW_VIEWPORT_FORM,
}: PlacePointMapPickerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const lastCameraKeyRef = useRef<string | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const clientMounted = useClientMounted();

    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;
        const root = containerRef.current;

        void (async () => {
            let map: maplibregl.Map;
            try {
                map = await createPreviewBaseMap(root, {
                    zoom: DEFAULT_ZOOM,
                    onLoad: (loadedMap) => {
                        ensureDataReviewSatelliteLayer(loadedMap);
                        applyDataReviewBasemapMode(loadedMap, basemapMode);
                        loadedMap.resize();
                        if (mapSurfaceRef) {
                            mapSurfaceRef.current = loadedMap;
                        }
                        onMapReady?.(loadedMap);
                        setIsMapReady(true);
                    },
                });
            } catch (err) {
                console.error("PlacePointMapPicker map init failed:", err);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            map.on("click", (event) => {
                onChange({
                    lat: roundCoord(event.lngLat.lat),
                    lng: roundCoord(event.lngLat.lng),
                });
            });

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            setIsMapReady(false);
            markerRef.current?.remove();
            markerRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
            if (mapSurfaceRef) {
                mapSurfaceRef.current = null;
            }
            onMapReady?.(null);
            lastCameraKeyRef.current = null;
        };
    }, [clientMounted, onChange, mapSurfaceRef, onMapReady]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !isMapReady) {
            return;
        }
        applyDataReviewBasemapMode(map, basemapMode);
    }, [basemapMode, isMapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        const applyLiveOverlay = () => {
            if (!map.isStyleLoaded()) {
                return;
            }

            if (!hasCoordinates(lat, lng) || lng === null) {
                clearLiveOverlay(map, LIVE_PLACE_SOURCE_ID);
                lastCameraKeyRef.current = null;
                dashDevLog("place:picker:edit:live-overlay-cleared-no-coords");
                return;
            }

            dashDevLog("place:picker:edit:selected-place-coordinates", {
                sourceId: LIVE_PLACE_SOURCE_ID,
                coordinates: [lng, lat],
            });
            const geojson = placeLatLngToLiveFeatureCollection(lat, lng, overlayNames ?? undefined);
            addPlaceLiveOverlay(map, geojson);
            dashDevLog("place:picker:edit:live-overlay-updated", {
                sourceId: LIVE_PLACE_SOURCE_ID,
                lat,
                lng,
            });
        };

        applyLiveOverlay();

        if (!map.isStyleLoaded()) {
            map.once("style.load", applyLiveOverlay);
            return () => {
                map.off("style.load", applyLiveOverlay);
            };
        }

        return undefined;
    }, [isMapReady, lat, lng, overlayNames]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        if (!hasCoordinates(lat, lng) || lng === null) {
            markerRef.current?.remove();
            markerRef.current = null;
            lastCameraKeyRef.current = null;
            map.easeTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 300 });
            return;
        }

        if (!markerRef.current) {
            const marker = new maplibregl.Marker({
                color: LIVE_PLACE_MARKER_COLOR,
                draggable: true,
            });
            marker.on("dragend", () => {
                const position = marker.getLngLat();
                onChange({
                    lat: roundCoord(position.lat),
                    lng: roundCoord(position.lng),
                });
            });
            markerRef.current = marker;
        }

        markerRef.current.setLngLat([lng, lat]).addTo(map);
        const cameraKey = `${lat}:${lng}`;
        if (lastCameraKeyRef.current !== cameraKey) {
            map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), DEFAULT_ZOOM), duration: 300 });
            lastCameraKeyRef.current = cameraKey;
            dashDevLog("place:picker:edit:camera-moved-to-selected-place", {
                center: [lng, lat],
                zoom: Math.max(map.getZoom(), DEFAULT_ZOOM),
            });
        }
    }, [isMapReady, lat, lng, onChange]);

    return clientMounted ? (
        <div ref={containerRef} className={viewportClassName} />
    ) : (
        <div className={viewportClassName} aria-hidden />
    );
}
