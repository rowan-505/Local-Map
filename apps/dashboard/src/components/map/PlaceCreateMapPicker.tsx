"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import {
    ensureDashboardPreviewPlacesLayers,
    placesToPreviewGeoJSON,
    setDashboardPreviewPlacesGeoJSON,
} from "./dashboardPreviewPlacesLayers";
import { createPlaceBaseMap } from "./createPlaceBaseMap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import type { Place } from "@/src/lib/api";

type PlaceCreateMapPickerProps = {
    lat: number | null;
    lng: number | null;
    onChange: (coords: { lat: number; lng: number }) => void;
    /** Existing places from the API to show as context on the preview map */
    contextPlaces?: Place[];
};

const DEFAULT_ZOOM = 15;

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
}: PlaceCreateMapPickerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        let map: maplibregl.Map;
        let resizeTimeoutId: number | null = null;

        try {
            map = createPlaceBaseMap(containerRef.current, {
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

        const ensureMarker = () => {
            if (!markerRef.current) {
                const marker = new maplibregl.Marker({
                    color: "#2563eb",
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

        return () => {
            if (resizeTimeoutId !== null) {
                window.clearTimeout(resizeTimeoutId);
            }
            setIsMapReady(false);
            markerRef.current?.remove();
            markerRef.current = null;
            map.remove();
            mapRef.current = null;
        };
    }, [onChange]);

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

        if (!hasCoordinates(lat, lng)) {
            markerRef.current?.remove();
            markerRef.current = null;
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
                color: "#2563eb",
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
        map.easeTo({
            center: [nextLng, nextLat],
            duration: 300,
        });
    }, [isMapReady, lat, lng, onChange]);

    return (
        <div
            ref={containerRef}
            className={MAP_PREVIEW_VIEWPORT_FORM}
        />
    );
}
