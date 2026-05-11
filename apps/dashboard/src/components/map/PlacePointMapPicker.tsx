"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { useDashboardTileVersions } from "./BuildingTileVersionContext";
import { createPlaceBaseMap } from "./createPlaceBaseMap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "./mapPreviewUi";
import {
    PLACE_MAP_DEFAULT_CENTER,
    refreshBuildingTiles,
    refreshPlaceTiles,
    refreshRoadLabelTiles,
    refreshStreetTiles,
} from "./placeMapConfig";

type PlacePointMapPickerProps = {
    lat: number | null;
    lng: number | null;
    onChange: (coords: { lat: number; lng: number }) => void;
};

const DEFAULT_ZOOM = 16;

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

export default function PlacePointMapPicker({ lat, lng, onChange }: PlacePointMapPickerProps) {
    const { buildingTileVersion, streetTileVersion, placeTileVersion, roadLabelTileVersion } =
        useDashboardTileVersions();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        const map = createPlaceBaseMap(containerRef.current, {
            zoom: DEFAULT_ZOOM,
            onLoad: (loadedMap) => {
                loadedMap.resize();
                setIsMapReady(true);
            },
        });

        map.on("click", (event) => {
            onChange({
                lat: roundCoord(event.lngLat.lat),
                lng: roundCoord(event.lngLat.lng),
            });
        });

        mapRef.current = map;

        return () => {
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

        if (!hasCoordinates(lat, lng) || lng === null) {
            markerRef.current?.remove();
            markerRef.current = null;
            map.easeTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 300 });
            return;
        }

        if (!markerRef.current) {
            const marker = new maplibregl.Marker({ color: "#2563eb", draggable: true });
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
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), DEFAULT_ZOOM), duration: 300 });
    }, [isMapReady, lat, lng, onChange]);

    useEffect(() => {
        refreshBuildingTiles(mapRef.current, buildingTileVersion);
    }, [buildingTileVersion]);

    useEffect(() => {
        refreshStreetTiles(mapRef.current, streetTileVersion);
    }, [streetTileVersion]);

    useEffect(() => {
        refreshPlaceTiles(mapRef.current, placeTileVersion);
    }, [placeTileVersion]);

    useEffect(() => {
        refreshRoadLabelTiles(mapRef.current, roadLabelTileVersion);
    }, [roadLabelTileVersion]);

    return <div ref={containerRef} className={MAP_PREVIEW_VIEWPORT_FORM} />;
}
