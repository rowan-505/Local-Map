"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

import { apiFetch } from "@/src/lib/api";
import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { attachDashboardMapErrorHandler } from "@/src/components/map/mapErrorHandlers";
import { fetchDashboardPlaceMapStyle } from "@/src/components/map/dashboardBasemapStyle";
import {
    refreshBuildingTiles,
    refreshPlaceTiles,
    refreshRoadLabelTiles,
    refreshStreetTiles,
} from "./map/placeMapConfig";
import { useDashboardTileVersions } from "./map/BuildingTileVersionContext";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { logDashboardGlyphServingHealthInDev } from "@/src/lib/map/dashboardGlyphDevCheck";
import {
    dashboardComplexTextTransformRequest,
    ensureDashboardMaplibreComplexTextPlugin,
} from "@/src/lib/map/dashboardMaplibreComplexText";

type Poi = {
    id: number | string;
    name: string;
    lng: number;
    lat: number;
    category?: string;
    source?: string;
};

export default function MapView() {
    const { buildingTileVersion, streetTileVersion, placeTileVersion, roadLabelTileVersion } =
        useDashboardTileVersions();
    const mapContainer = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const clientMounted = useClientMounted();

    useEffect(() => {
        if (!clientMounted || !mapContainer.current) return;

        let cancelled = false;
        const container = mapContainer.current;
        let mapInstance: maplibregl.Map | null = null;

        void (async () => {
            await ensurePmtilesProtocol(maplibregl);
            await ensureDashboardMaplibreComplexTextPlugin();
            logDashboardGlyphServingHealthInDev();
            let style: maplibregl.StyleSpecification;
            try {
                style = await fetchDashboardPlaceMapStyle({ includeBusTransitLayers: true });
            } catch (err) {
                console.error("MapView basemap style failed:", err);
                return;
            }

            if (cancelled || !container) {
                return;
            }

            mapInstance = new maplibregl.Map({
                container,
                style,
                center: [96.3265, 16.633],
                zoom: 15,
                minZoom: 10,
                maxZoom: 18,
                transformRequest: dashboardComplexTextTransformRequest,
            });
            mapRef.current = mapInstance;

            if (cancelled) {
                mapInstance.remove();
                mapRef.current = null;
                return;
            }

            const map = mapInstance;

            map.addControl(new maplibregl.NavigationControl(), "top-right");

            attachDashboardMapErrorHandler(map, "MapView");

            map.on("load", async () => {
                attachMapLibreDevDebugMap(map);
                try {
                    // buildings
                    map.addSource("buildings", {
                        type: "geojson",
                        data: "/buildings.geojson",
                    });

                    map.addLayer({
                        id: "building-fill",
                        type: "fill",
                        source: "buildings",
                        paint: {
                            "fill-color": "#cbd5e1",
                            "fill-opacity": 0.7,
                        },
                    });

                    map.addLayer({
                        id: "building-outline",
                        type: "line",
                        source: "buildings",
                        paint: {
                            "line-color": "#64748b",
                            "line-width": 1,
                        },
                    });

                    // POIs
                    const pois = await apiFetch<Poi[]>("/api/pois");

                    const bounds = new maplibregl.LngLatBounds();

                    pois.forEach((poi) => {
                        new maplibregl.Marker()
                            .setLngLat([poi.lng, poi.lat])
                            .setPopup(
                                new maplibregl.Popup().setHTML(`
                                <div>
                                    <h3 style="font-weight:600;">${poi.name}</h3>
                                    <p style="margin:4px 0 0;">Category: ${poi.category ?? "N/A"}</p>
                                    <p style="margin:4px 0 0;">Source: ${poi.source ?? "N/A"}</p>
                                </div>
                            `)
                            )
                            .addTo(map);

                        bounds.extend([poi.lng, poi.lat]);
                    });

                    if (pois.length > 0) {
                        map.fitBounds(bounds, {
                            padding: 80,
                            maxZoom: 16,
                            duration: 0,
                        });
                    }
                } catch (error) {
                    console.error("Failed to load map data:", error);
                }
            });
        })();

        return () => {
            cancelled = true;
            mapInstance?.remove();
            mapRef.current = null;
        };
    }, [clientMounted]);

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

    const mapShellClassName = "w-full h-[600px] rounded-xl overflow-hidden";

    return clientMounted ? (
        <div ref={mapContainer} className={mapShellClassName} />
    ) : (
        <div className={mapShellClassName} aria-hidden />
    );
}