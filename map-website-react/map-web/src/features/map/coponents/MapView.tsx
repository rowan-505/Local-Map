import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createMap, addPlacesSource, addPlacesLayer } from '../lib/mapAdapter';


export default function MapView() {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        const map = createMap(mapContainerRef.current);

        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.on('load', async () => {
            const res = await fetch('http://localhost:8000/api/places');
            const geojson = await res.json();

            addPlacesSource(map, geojson);
            addPlacesLayer(map);
        });

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, []);

    return <div ref={mapContainerRef} className="w-full h-full" />;
}