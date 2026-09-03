"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { createPreviewBaseMap } from "@/src/components/map/createPreviewBaseMap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "@/src/components/map/mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "@/src/components/map/placeMapConfig";
import { useClientMounted } from "@/src/hooks/useClientMounted";

type Point = { latitude: number; longitude: number };

type ReportLocationCompareMapProps = {
    observed: Point | null;
    canonical: Point | null;
    distanceM: number | null;
};

const OBSERVED_COLOR = "#ea580c";
const CANONICAL_COLOR = "#2563eb";

function formatDistance(distanceM: number | null): string {
    if (distanceM === null || !Number.isFinite(distanceM)) {
        return "Distance unavailable";
    }
    if (distanceM < 10) {
        return `${distanceM.toFixed(1)} m apart`;
    }
    return `${Math.round(distanceM)} m apart`;
}

export default function ReportLocationCompareMap({
    observed,
    canonical,
    distanceM,
}: ReportLocationCompareMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<maplibregl.Marker[]>([]);
    const [mapReady, setMapReady] = useState(false);
    const clientMounted = useClientMounted();

    const hasObserved = observed !== null;
    const hasCanonical = canonical !== null;

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
                    zoom: 16,
                    onLoad: () => setMapReady(true),
                });
            } catch (err) {
                console.error("ReportLocationCompareMap init failed:", err);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            for (const marker of markersRef.current) {
                marker.remove();
            }
            markersRef.current = [];
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, [clientMounted]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        for (const marker of markersRef.current) {
            marker.remove();
        }
        markersRef.current = [];

        const points: { lng: number; lat: number; color: string }[] = [];
        if (canonical) {
            points.push({ lng: canonical.longitude, lat: canonical.latitude, color: CANONICAL_COLOR });
        }
        if (observed) {
            points.push({ lng: observed.longitude, lat: observed.latitude, color: OBSERVED_COLOR });
        }

        for (const point of points) {
            const marker = new maplibregl.Marker({ color: point.color, scale: 0.9 })
                .setLngLat([point.lng, point.lat])
                .addTo(map);
            markersRef.current.push(marker);
        }

        if (points.length === 0) {
            map.jumpTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: 12 });
            return;
        }
        if (points.length === 1) {
            const only = points[0]!;
            map.easeTo({ center: [only.lng, only.lat], zoom: 17, duration: 400 });
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        for (const point of points) {
            bounds.extend([point.lng, point.lat]);
        }
        map.fitBounds(bounds, { padding: 56, maxZoom: 18, duration: 400 });
    }, [mapReady, observed, canonical]);

    if (!hasObserved && !hasCanonical) {
        return <p className="text-sm text-gray-500">No coordinates to compare.</p>;
    }

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <div className="flex flex-wrap gap-3">
                    {hasCanonical ? (
                        <span className="inline-flex items-center gap-1.5">
                            <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: CANONICAL_COLOR }}
                            />
                            Current canonical
                        </span>
                    ) : null}
                    {hasObserved ? (
                        <span className="inline-flex items-center gap-1.5">
                            <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: OBSERVED_COLOR }}
                            />
                            Observed report
                        </span>
                    ) : null}
                </div>
                {hasCanonical && hasObserved ? (
                    <span className="font-medium text-gray-800">{formatDistance(distanceM)}</span>
                ) : null}
            </div>
            <div ref={containerRef} className={MAP_PREVIEW_VIEWPORT_FORM} />
        </div>
    );
}
