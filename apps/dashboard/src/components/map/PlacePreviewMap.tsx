"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import {
    ensureDashboardPreviewPlacesLayers,
    placesToPreviewGeoJSON,
    setDashboardPreviewPlacesGeoJSON,
} from "./dashboardPreviewPlacesLayers";
import { createPreviewBaseMap } from "./createPreviewBaseMap";
import { MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import type { Place } from "@/src/lib/api";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    addSelectedPlaceOverlay,
    clearSelectedPlaceOverlay,
    SELECTED_PLACE_OVERLAY_CIRCLE_LAYER,
    SELECTED_PLACE_OVERLAY_LABEL_LAYER,
    SELECTED_PLACE_OVERLAY_SOURCE_ID,
} from "@/src/lib/map/liveOverlays";

type PlacePreviewMapProps = {
    selectedPlace: Place | null;
    contextPlaces: Place[];
};

const DEFAULT_ZOOM = 12;
/** Zoom applied when a place row is selected — matches the precision needed for a POI. */
const SELECTED_PLACE_ZOOM = 17;
const NEARBY_KM = 8;

export default function PlacePreviewMap({
    selectedPlace,
    contextPlaces,
}: PlacePreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const lastFocusedPlaceIdRef = useRef<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [styleLoaded, setStyleLoaded] = useState(false);
    const clientMounted = useClientMounted();
    const selectedPlaceId = selectedPlace?.id ?? null;
    const selectedPlacePublicId = selectedPlace?.public_id ?? null;
    const selectedPlaceLat = selectedPlace?.lat ?? null;
    const selectedPlaceLng = selectedPlace?.lng ?? null;
    const selectedPlaceDisplayName = selectedPlace?.display_name ?? null;

    // ── Map initialisation (same pattern as StreetPreviewMap) ─────────────────
    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;
        const root = containerRef.current;
        let mapInstance: maplibregl.Map | null = null;
        let markStyleLoaded: (() => void) | null = null;

        void (async () => {
            try {
                mapInstance = await createPreviewBaseMap(root, {
                    zoom: DEFAULT_ZOOM,
                    onLoad: (map) => {
                        ensureDashboardPreviewPlacesLayers(map);
                        setMapReady(true);
                    },
                });
            } catch (err) {
                console.error("PlacePreviewMap map init failed:", err);
                return;
            }

            if (cancelled) {
                mapInstance?.remove();
                mapInstance = null;
                return;
            }

            markStyleLoaded = () => {
                if (!mapInstance?.isStyleLoaded()) {
                    return;
                }

                dashDevLog("[places-preview] style loaded true");
                setStyleLoaded(true);
            };

            mapInstance.on("load", markStyleLoaded);
            mapInstance.on("styledata", markStyleLoaded);
            mapInstance.on("idle", markStyleLoaded);

            if (mapInstance.isStyleLoaded()) {
                markStyleLoaded();
            }

            mapRef.current = mapInstance;
        })();

        return () => {
            cancelled = true;
            setMapReady(false);
            setStyleLoaded(false);
            lastFocusedPlaceIdRef.current = null;
            if (mapInstance && markStyleLoaded) {
                mapInstance.off("load", markStyleLoaded);
                mapInstance.off("styledata", markStyleLoaded);
                mapInstance.off("idle", markStyleLoaded);
            }
            mapInstance?.remove();
            mapRef.current = null;
        };
    }, [clientMounted]);

    // ── Context places layer (nearby grey dots, excludes selected) ────────────
    useEffect(() => {
        const map = mapRef.current;

        if (!map || !mapReady || !styleLoaded || !map.isStyleLoaded()) {
            return;
        }

        const center = selectedPlace
            ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
            : null;

        setDashboardPreviewPlacesGeoJSON(
            map,
            placesToPreviewGeoJSON(contextPlaces, {
                excludePublicId: selectedPlace?.public_id ?? null,
                center,
                nearbyKm: selectedPlace ? NEARBY_KM : null,
            }),
        );
    }, [mapReady, styleLoaded, selectedPlace, contextPlaces]);

    // ── Selected place overlay + camera (mirrors StreetPreviewMap pattern) ─────
    useEffect(() => {
        const map = mapRef.current;

        dashDevLog("[places-preview-debug] selected effect entered", {
            selectedPlace,
            selectedPlaceId: selectedPlace?.id ?? null,
            selectedPlacePublicId: selectedPlace?.public_id ?? null,
            selectedPlaceLat: selectedPlace?.lat ?? null,
            selectedPlaceLng: selectedPlace?.lng ?? null,
            parsedLat: selectedPlace ? Number(selectedPlace.lat) : null,
            parsedLng: selectedPlace ? Number(selectedPlace.lng) : null,
            hasMapRef: Boolean(map),
            mapLoaded: Boolean(map?.loaded()),
            mapIsStyleLoaded: Boolean(map?.isStyleLoaded()),
            styleLoadedState: styleLoaded,
            selectedOverlaySourceExists: Boolean(map?.getSource(SELECTED_PLACE_OVERLAY_SOURCE_ID)),
            selectedOverlayCircleLayerExists: Boolean(
                map?.getLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER),
            ),
            selectedOverlayLabelLayerExists: Boolean(
                map?.getLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER),
            ),
            mapReady,
        });

        if (!map || !mapReady || !styleLoaded) {
            dashDevLog("[places-preview-debug] selected effect skipped before camera", {
                reason: !map
                    ? "missing-map-ref"
                    : !mapReady
                      ? "mapReady-false"
                      : "styleLoaded-false",
                easeToCalled: false,
            });
            return;
        }

        if (!selectedPlacePublicId) {
            clearSelectedPlaceOverlay(map);
            lastFocusedPlaceIdRef.current = null;
            dashDevLog("[places-preview] selected place changed", { selectedPlace: null });
            dashDevLog("[places-preview-debug] calling easeTo for empty selection", {
                easeToCalled: true,
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
            });
            map.easeTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 500,
            });
            return;
        }

        const rawLat = selectedPlaceLat;
        const rawLng = selectedPlaceLng;
        const lat = Number(rawLat);
        const lng = Number(rawLng);

        dashDevLog("[places-preview] retrying focus after style load", {
            id: selectedPlaceId,
            public_id: selectedPlacePublicId,
            styleLoaded,
            mapStyleLoaded: map.isStyleLoaded(),
        });
        dashDevLog("[places-preview] selected place changed", {
            id: selectedPlaceId,
            public_id: selectedPlacePublicId,
            display_name: selectedPlaceDisplayName,
        });
        dashDevLog("[places-preview] coords", { lat: rawLat, lng: rawLng });
        dashDevLog("[places-preview-debug] parsed coords", {
            id: selectedPlaceId,
            public_id: selectedPlacePublicId,
            lat: rawLat,
            lng: rawLng,
            latType: typeof rawLat,
            lngType: typeof rawLng,
            parsedLat: lat,
            parsedLng: lng,
            parsedLatIsFinite: Number.isFinite(lat),
            parsedLngIsFinite: Number.isFinite(lng),
        });

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            clearSelectedPlaceOverlay(map);
            lastFocusedPlaceIdRef.current = null;
            console.warn("[places-preview] invalid coords for", selectedPlacePublicId, {
                lat: rawLat,
                lng: rawLng,
            });
            dashDevLog("[places-preview-debug] selected effect skipped invalid coords", {
                easeToCalled: false,
                overlaySourceExistsAfterClear: Boolean(map.getSource(SELECTED_PLACE_OVERLAY_SOURCE_ID)),
                overlayCircleLayerExistsAfterClear: Boolean(
                    map.getLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER),
                ),
                overlayLabelLayerExistsAfterClear: Boolean(
                    map.getLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER),
                ),
            });
            return;
        }

        addSelectedPlaceOverlay(map, lat, lng, {
            name: selectedPlace?.primary_name ?? null,
            display_name: selectedPlaceDisplayName,
        });
        dashDevLog("[places-preview] overlay updated", {
            source: "selected-place-overlay",
            layer: "selected-place-overlay-circle",
            coords: [lng, lat],
        });
        dashDevLog("[places-preview-debug] selected overlay exists after update", {
            selectedOverlaySourceExists: Boolean(map.getSource(SELECTED_PLACE_OVERLAY_SOURCE_ID)),
            selectedOverlayCircleLayerExists: Boolean(
                map.getLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER),
            ),
            selectedOverlayLabelLayerExists: Boolean(
                map.getLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER),
            ),
        });

        // Prevent duplicate camera movement for the same place.
        if (lastFocusedPlaceIdRef.current !== selectedPlacePublicId) {
            dashDevLog("[places-preview-debug] calling easeTo for selected place", {
                easeToCalled: true,
                public_id: selectedPlacePublicId,
                center: [lng, lat],
                zoom: SELECTED_PLACE_ZOOM,
            });
            console.log("[places-preview] calling easeTo");
            map.easeTo({
                center: [lng, lat],
                zoom: SELECTED_PLACE_ZOOM,
                duration: 700,
            });
            lastFocusedPlaceIdRef.current = selectedPlacePublicId;
            dashDevLog("[places-preview] focus executed", {
                public_id: selectedPlacePublicId,
                center: [lng, lat],
                zoom: SELECTED_PLACE_ZOOM,
            });
        } else {
            dashDevLog("[places-preview-debug] easeTo not called because place already focused", {
                easeToCalled: false,
                public_id: selectedPlacePublicId,
                lastFocusedPlaceId: lastFocusedPlaceIdRef.current,
            });
        }
    }, [
        mapReady,
        styleLoaded,
        selectedPlaceId,
        selectedPlacePublicId,
        selectedPlaceLat,
        selectedPlaceLng,
        selectedPlace,
        selectedPlaceDisplayName,
    ]);

    return clientMounted ? (
        <div
            ref={containerRef}
            className={MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR}
        />
    ) : (
        <div className={MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR} aria-hidden />
    );
}
