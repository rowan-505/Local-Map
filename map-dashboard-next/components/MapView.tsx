"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

type Poi = {
    id: number | string;
    name: string;
    lng: number;
    lat: number;
    category?: string;
    source?: string;
};

export default function MapView() {
    const mapContainer = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!mapContainer.current) return;

        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: "https://demotiles.maplibre.org/style.json",
            center: [96.3265, 16.633],
            zoom: 15,
            minZoom: 10,
            maxZoom: 18,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");

        map.on("load", async () => {
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
                const res = await fetch("/api/pois");
                const pois: Poi[] = await res.json();

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

        return () => {
            map.remove();
        };
    }, []);

    return <div ref={mapContainer} className="w-full h-[600px] rounded-xl overflow-hidden" />;
}