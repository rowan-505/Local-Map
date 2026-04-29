"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

import { createPlaceBaseMap } from "./createPlaceBaseMap";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";

type PlacePreview = {
    public_id: string;
    primary_name: string;
    display_name: string;
    lat: number;
    lng: number;
};

type PlacePreviewMapProps = {
    selectedPlace: PlacePreview | null;
};
const DEFAULT_ZOOM = 12;
const PLACE_ZOOM = 16;

export default function PlacePreviewMap({ selectedPlace }: PlacePreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        const map = createPlaceBaseMap(containerRef.current, {
            zoom: DEFAULT_ZOOM,
        });
        mapRef.current = map;

        return () => {
            markerRef.current?.remove();
            map.remove();
            mapRef.current = null;
            markerRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;

        if (!map) {
            return;
        }

        if (!selectedPlace) {
            markerRef.current?.remove();
            markerRef.current = null;
            map.easeTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 500,
            });
            return;
        }

        if (!markerRef.current) {
            markerRef.current = new maplibregl.Marker({ color: "#2563eb" });
        }

        markerRef.current
            .setLngLat([selectedPlace.lng, selectedPlace.lat])
            .setPopup(
                new maplibregl.Popup({ offset: 20 }).setText(
                    selectedPlace.primary_name || selectedPlace.display_name
                )
            )
            .addTo(map);

        map.easeTo({
            center: [selectedPlace.lng, selectedPlace.lat],
            zoom: PLACE_ZOOM,
            duration: 500,
        });
    }, [selectedPlace]);

    return (
        <div
            ref={containerRef}
            className="h-[60vh] min-h-[320px] w-full overflow-hidden rounded-lg lg:min-h-[500px]"
        />
    );
}
