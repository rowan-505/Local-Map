"use client";

import { useEffect, useRef, useState } from "react";
import type { LineString, MultiLineString } from "geojson";
import maplibregl from "maplibre-gl";

import type { StreetGeometry } from "@/src/lib/api";
import { MAP_PREVIEW_VIEWPORT_STREET } from "./mapPreviewUi";
import { attachDashboardMapErrorHandler } from "./mapErrorHandlers";
import { createPreviewBaseMap } from "./createPreviewBaseMap";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    addStreetLiveOverlay,
    clearLiveOverlay,
    LIVE_STREET_SOURCE_ID,
    streetLineToLiveFeatureCollection,
} from "@/src/lib/map/liveOverlays";

type StreetPreviewMapProps = {
    selectedStreet: {
        canonical_name: string;
        myanmarName: string | null;
        englishName: string | null;
        geometry: StreetGeometry;
    } | null;
};

const DEFAULT_ZOOM = 12;

function getGeometryBounds(geometry: StreetGeometry): maplibregl.LngLatBounds | null {
    if (!geometry) {
        return null;
    }

    const bounds = new maplibregl.LngLatBounds();
    const lines =
        geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;

    for (const line of lines) {
        for (const coordinate of line) {
            bounds.extend([coordinate[0], coordinate[1]]);
        }
    }

    return bounds.isEmpty() ? null : bounds;
}

export default function StreetPreviewMap({ selectedStreet }: StreetPreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const clientMounted = useClientMounted();

    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;
        const root = containerRef.current;
        let mapInstance: maplibregl.Map | null = null;

        void (async () => {
            try {
                mapInstance = await createPreviewBaseMap(root, {
                    zoom: DEFAULT_ZOOM,
                    onLoad: (map) => {
                        attachMapLibreDevDebugMap(map);
                        setIsMapReady(true);
                    },
                });
            } catch (err) {
                console.error("StreetPreviewMap basemap style failed:", err);
                return;
            }

            if (cancelled) {
                mapInstance?.remove();
                mapInstance = null;
                return;
            }

            attachDashboardMapErrorHandler(mapInstance, "StreetPreviewMap");
            mapRef.current = mapInstance;
        })();

        return () => {
            cancelled = true;
            setIsMapReady(false);
            mapInstance?.remove();
            mapRef.current = null;
        };
    }, [clientMounted]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady || !map.isStyleLoaded()) {
            return;
        }

        const geometry = selectedStreet?.geometry ?? null;

        if (!geometry) {
            clearLiveOverlay(map, LIVE_STREET_SOURCE_ID);
            dashDevLog("street:preview:live-overlay-cleared-no-selection");
            map.easeTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 500,
            });
            return;
        }

        dashDevLog("street:preview:loaded-api-geometry", geometry);
        addStreetLiveOverlay(
            map,
            streetLineToLiveFeatureCollection(geometry as LineString | MultiLineString),
        );
        dashDevLog("street:preview:live-overlay-updated");

        const bounds = getGeometryBounds(geometry);

        if (!bounds) {
            return;
        }

        map.fitBounds(bounds, {
            padding: 40,
            maxZoom: 16,
            duration: 500,
        });
    }, [isMapReady, selectedStreet]);

    return (
        <div className="relative">
            {clientMounted ? (
                <div
                    ref={containerRef}
                    className={MAP_PREVIEW_VIEWPORT_STREET}
                />
            ) : (
                <div className={MAP_PREVIEW_VIEWPORT_STREET} aria-hidden />
            )}
            {!selectedStreet?.geometry ? (
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded bg-white/90 px-3 py-2 text-sm text-gray-700 shadow">
                    No geometry available.
                </div>
            ) : null}
        </div>
    );
}
