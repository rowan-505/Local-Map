"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Geometry, Point } from "geojson";

import { createPreviewBaseMap } from "@/src/components/map/createPreviewBaseMap";
import {
    applyDataReviewBasemapMode,
    ensureDataReviewSatelliteLayer,
    type DataReviewBasemapMode,
} from "@/src/components/map/dataReviewBasemap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "@/src/components/map/mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "@/src/components/map/placeMapConfig";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { pointGeometryToLatLng } from "@/src/components/core-review/geometry/coreGeometryUtils";

type AddressLocationMapPickerProps = {
    value: Geometry | null;
    onPick: (coords: { lat: number; lng: number; point: Point }) => void;
    disabled?: boolean;
    basemapMode?: DataReviewBasemapMode;
    className?: string;
};

const DEFAULT_ZOOM = 17;
const MARKER_COLOR = "#7c3aed";

function roundCoord(value: number) {
    return Number(value.toFixed(7));
}

function toPointGeometry(lat: number, lng: number): Point {
    return { type: "Point", coordinates: [lng, lat] };
}

export default function AddressLocationMapPicker({
    value,
    onPick,
    disabled = false,
    basemapMode = "map",
    className = MAP_PREVIEW_VIEWPORT_FORM,
}: AddressLocationMapPickerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const onPickRef = useRef(onPick);
    const disabledRef = useRef(disabled);
    const [isMapReady, setIsMapReady] = useState(false);
    const clientMounted = useClientMounted();

    useEffect(() => {
        onPickRef.current = onPick;
    }, [onPick]);

    useEffect(() => {
        disabledRef.current = disabled;
    }, [disabled]);

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
                        setIsMapReady(true);
                    },
                });
            } catch (err) {
                console.error("AddressLocationMapPicker init failed:", err);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            map.on("click", (event) => {
                if (disabledRef.current) {
                    return;
                }
                const lat = roundCoord(event.lngLat.lat);
                const lng = roundCoord(event.lngLat.lng);
                onPickRef.current({ lat, lng, point: toPointGeometry(lat, lng) });
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
        };
    }, [clientMounted, basemapMode]);

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

        const coords = pointGeometryToLatLng(value);
        if (!coords) {
            markerRef.current?.remove();
            markerRef.current = null;
            map.easeTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 300 });
            return;
        }

        const { lat, lng } = coords;
        if (!markerRef.current) {
            const marker = new maplibregl.Marker({ color: MARKER_COLOR, draggable: !disabled });
            marker.on("dragend", () => {
                if (disabledRef.current) {
                    return;
                }
                const position = marker.getLngLat();
                const rLat = roundCoord(position.lat);
                const rLng = roundCoord(position.lng);
                onPickRef.current({ lat: rLat, lng: rLng, point: toPointGeometry(rLat, rLng) });
            });
            markerRef.current = marker;
        }

        markerRef.current.setDraggable(!disabled);
        markerRef.current.setLngLat([lng, lat]).addTo(map);
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), DEFAULT_ZOOM), duration: 300 });
    }, [isMapReady, value, disabled]);

    return (
        <div className="space-y-1">
            <p className="text-xs text-gray-600">
                {disabled
                    ? "Map is read-only."
                    : "Click the map or drag the marker to set the address location."}
            </p>
            {clientMounted ? (
                <div ref={containerRef} className={className} />
            ) : (
                <div className={className} aria-hidden />
            )}
        </div>
    );
}
