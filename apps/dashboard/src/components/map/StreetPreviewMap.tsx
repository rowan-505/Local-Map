"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { GeoJSONSource } from "maplibre-gl";

import type { StreetGeometry } from "@/src/lib/api";
import { MAP_PREVIEW_VIEWPORT_STREET } from "./mapPreviewUi";
import { attachDashboardMapErrorHandler } from "./mapErrorHandlers";
import { PLACE_MAP_DEFAULT_CENTER, PLACE_MAP_STYLE } from "./placeMapConfig";

type StreetPreviewMapProps = {
    selectedStreet: {
        canonical_name: string;
        geometry: StreetGeometry;
    } | null;
};

const DEFAULT_ZOOM = 12;
const STREET_SOURCE_ID = "selected-street";
const STREET_LAYER_ID = "selected-street-line";

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

function emptyStreetFeature() {
    return {
        type: "FeatureCollection" as const,
        features: [],
    };
}

function streetFeature(geometry: StreetGeometry, name: string) {
    if (!geometry) {
        return emptyStreetFeature();
    }

    return {
        type: "FeatureCollection" as const,
        features: [
            {
                type: "Feature" as const,
                properties: {
                    name,
                },
                geometry,
            },
        ],
    };
}

export default function StreetPreviewMap({ selectedStreet }: StreetPreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: PLACE_MAP_STYLE,
            center: PLACE_MAP_DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");
        attachDashboardMapErrorHandler(map, "StreetPreviewMap");

        map.on("load", () => {
            map.addSource(STREET_SOURCE_ID, {
                type: "geojson",
                data: emptyStreetFeature(),
            });

            map.addLayer({
                id: STREET_LAYER_ID,
                type: "line",
                source: STREET_SOURCE_ID,
                paint: {
                    "line-color": "#2563eb",
                    "line-width": 5,
                    "line-opacity": 0.95,
                },
                layout: {
                    "line-cap": "round",
                    "line-join": "round",
                },
            });

            setIsMapReady(true);
        });

        mapRef.current = map;

        return () => {
            setIsMapReady(false);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        const source = map.getSource(STREET_SOURCE_ID) as GeoJSONSource | undefined;

        if (!source) {
            return;
        }

        const geometry = selectedStreet?.geometry ?? null;

        source.setData(
            streetFeature(geometry, selectedStreet?.canonical_name ?? "Selected street")
        );

        if (!geometry) {
            map.easeTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 500,
            });
            return;
        }

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
            <div
                ref={containerRef}
                className={MAP_PREVIEW_VIEWPORT_STREET}
            />
            {!selectedStreet?.geometry ? (
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded bg-white/90 px-3 py-2 text-sm text-gray-700 shadow">
                    No geometry available.
                </div>
            ) : null}
        </div>
    );
}
