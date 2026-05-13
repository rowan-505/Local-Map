"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import {
    ensureDashboardPreviewPlacesLayers,
    placesToPreviewGeoJSON,
    setDashboardPreviewPlacesGeoJSON,
} from "./dashboardPreviewPlacesLayers";
import { createPreviewBaseMap } from "./createPreviewBaseMap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import type { Place } from "@/src/lib/api";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    addPlaceLiveOverlay,
    clearLiveOverlay,
    LIVE_PLACE_SOURCE_ID,
    placeLatLngToLiveFeatureCollection,
    type PlaceLiveOverlayLabelProps,
} from "@/src/lib/map/liveOverlays";

type PlaceCreateMapPickerProps = {
    lat: number | null;
    lng: number | null;
    onChange: (coords: { lat: number; lng: number }) => void;
    /** Existing places from the API to show as context on the preview map */
    contextPlaces?: Place[];
    /** Draft names for the live overlay label while creating */
    draftOverlayNames?: PlaceLiveOverlayLabelProps | null;
};

const DEFAULT_ZOOM = 15;
const SELECTED_PLACE_ZOOM = 18;

const LIVE_PLACE_MARKER_COLOR = "#06b6d4";

function roundCoord(value: number) {
    return Number(value.toFixed(7));
}

function hasCoordinates(lat: number | null, lng: number | null): boolean {
    return (
        typeof lat === "number" &&
        Number.isFinite(lat) &&
        typeof lng === "number" &&
        Number.isFinite(lng)
    );
}

const NEARBY_KM = 8;

export default function PlaceCreateMapPicker({
    lat,
    lng,
    onChange,
    contextPlaces = [],
    draftOverlayNames = null,
}: PlaceCreateMapPickerProps) {
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
        let resizeTimeoutId: number | null = null;

        void (async () => {
            let map: maplibregl.Map;
            try {
                map = await createPreviewBaseMap(root, {
                    zoom: DEFAULT_ZOOM,
                    onLoad: (loadedMap) => {
                        ensureDashboardPreviewPlacesLayers(loadedMap);
                        loadedMap.resize();
                        resizeTimeoutId = window.setTimeout(() => {
                            loadedMap.resize();
                        }, 100);
                        setIsMapReady(true);
                    },
                });
            } catch (error) {
                console.error("PlaceCreateMapPicker constructor error:", error);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            const ensureMarker = () => {
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

                return markerRef.current;
            };

            map.on("click", (event) => {
                const nextLat = roundCoord(event.lngLat.lat);
                const nextLng = roundCoord(event.lngLat.lng);

                ensureMarker().setLngLat([nextLng, nextLat]).addTo(map);
                onChange({
                    lat: nextLat,
                    lng: nextLng,
                });
            });

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            if (resizeTimeoutId !== null) {
                window.clearTimeout(resizeTimeoutId);
            }
            setIsMapReady(false);
            markerRef.current?.remove();
            markerRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
            lastCameraKeyRef.current = null;
        };
    }, [clientMounted, onChange]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        const center = hasCoordinates(lat, lng)
            ? { lat: lat as number, lng: lng as number }
            : { lat: PLACE_MAP_DEFAULT_CENTER[1], lng: PLACE_MAP_DEFAULT_CENTER[0] };

        setDashboardPreviewPlacesGeoJSON(
            map,
            placesToPreviewGeoJSON(contextPlaces, {
                center,
                nearbyKm: NEARBY_KM,
            })
        );
    }, [isMapReady, lat, lng, contextPlaces]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        const applyLiveOverlay = () => {
            if (!map.isStyleLoaded()) {
                return;
            }

            if (!hasCoordinates(lat, lng) || lat === null || lng === null) {
                clearLiveOverlay(map, LIVE_PLACE_SOURCE_ID);
                lastCameraKeyRef.current = null;
                dashDevLog("place:picker:create:live-overlay-cleared-no-coords");
                return;
            }

            dashDevLog("place:picker:create:selected-place-coordinates", {
                sourceId: LIVE_PLACE_SOURCE_ID,
                coordinates: [lng, lat],
            });
            const geojson = placeLatLngToLiveFeatureCollection(lat, lng, draftOverlayNames ?? undefined);
            addPlaceLiveOverlay(map, geojson);
            dashDevLog("place:picker:create:live-overlay-updated", {
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
    }, [isMapReady, lat, lng, draftOverlayNames]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        if (!hasCoordinates(lat, lng)) {
            markerRef.current?.remove();
            markerRef.current = null;
            lastCameraKeyRef.current = null;
            map.easeTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 300,
            });
            return;
        }

        if (lat === null || lng === null) {
            return;
        }

        const nextLat = lat;
        const nextLng = lng;

        if (!markerRef.current) {
            markerRef.current = new maplibregl.Marker({
                color: LIVE_PLACE_MARKER_COLOR,
                draggable: true,
            });

            markerRef.current.on("dragend", () => {
                if (!markerRef.current) {
                    return;
                }

                const position = markerRef.current.getLngLat();
                onChange({
                    lat: roundCoord(position.lat),
                    lng: roundCoord(position.lng),
                });
            });
        }

        markerRef.current.setLngLat([nextLng, nextLat]).addTo(map);
        const cameraKey = `${nextLat}:${nextLng}`;
        if (lastCameraKeyRef.current !== cameraKey) {
            map.easeTo({
                center: [nextLng, nextLat],
                zoom: Math.max(map.getZoom(), SELECTED_PLACE_ZOOM),
                duration: 300,
            });
            lastCameraKeyRef.current = cameraKey;
            dashDevLog("place:picker:create:camera-moved-to-selected-place", {
                center: [nextLng, nextLat],
                zoom: Math.max(map.getZoom(), SELECTED_PLACE_ZOOM),
            });
        }
    }, [isMapReady, lat, lng, onChange]);

    return clientMounted ? (
        <div
            ref={containerRef}
            className={MAP_PREVIEW_VIEWPORT_FORM}
        />
    ) : (
        <div className={MAP_PREVIEW_VIEWPORT_FORM} aria-hidden />
    );
}
