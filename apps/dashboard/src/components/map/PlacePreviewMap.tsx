"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import {
    ensureDashboardPreviewPlacesLayers,
    placesToPreviewGeoJSON,
    setDashboardPreviewPlacesGeoJSON,
} from "./dashboardPreviewPlacesLayers";
import { createPlaceBaseMap } from "./createPlaceBaseMap";
import { MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import type { Place } from "@/src/lib/api";
import { placePreviewDisplayName } from "@/src/lib/placePreviewDisplayName";

type PlacePreviewMapProps = {
    selectedPlace: Place | null;
    contextPlaces: Place[];
};

const DEFAULT_ZOOM = 12;
const PLACE_ZOOM = 18;
const NEARBY_KM = 8;

export default function PlacePreviewMap({
    selectedPlace,
    contextPlaces,
}: PlacePreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const [mapReady, setMapReady] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        const map = createPlaceBaseMap(containerRef.current, {
            zoom: DEFAULT_ZOOM,
        });
        mapRef.current = map;

        const onLoad = () => {
            ensureDashboardPreviewPlacesLayers(map);
            setMapReady(true);
        };

        map.on("load", onLoad);

        return () => {
            map.off("load", onLoad);
            markerRef.current?.remove();
            map.remove();
            mapRef.current = null;
            markerRef.current = null;
            setMapReady(false);
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !mapReady) {
            return;
        }

        const center = selectedPlace
            ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
            : null;
        const nearbyKm = selectedPlace ? NEARBY_KM : null;

        setDashboardPreviewPlacesGeoJSON(
            map,
            placesToPreviewGeoJSON(contextPlaces, {
                excludePublicId: selectedPlace?.public_id ?? null,
                center,
                nearbyKm,
            })
        );
    }, [mapReady, selectedPlace, contextPlaces]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !mapReady) {
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

        const label = placePreviewDisplayName(selectedPlace);

        if (!markerRef.current) {
            markerRef.current = new maplibregl.Marker({ color: "#2563eb" });
        }

        markerRef.current
            .setLngLat([selectedPlace.lng, selectedPlace.lat])
            .setPopup(new maplibregl.Popup({ offset: 20 }).setText(label))
            .addTo(map);

        markerRef.current.togglePopup();

        map.easeTo({
            center: [selectedPlace.lng, selectedPlace.lat],
            zoom: PLACE_ZOOM,
            duration: 500,
        });
    }, [mapReady, selectedPlace]);

    return (
        <div
            ref={containerRef}
            className={MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR}
        />
    );
}
