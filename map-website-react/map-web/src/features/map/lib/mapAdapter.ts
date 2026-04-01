import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;

export function createMap(container: HTMLDivElement) {
    return new mapboxgl.Map({
        container,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [96.3272, 16.6339],
        zoom: 14,
    });
}

export function addPlacesSource(map: mapboxgl.Map, geojson: GeoJSON.FeatureCollection) {
    if (map.getSource('places')) return;

    map.addSource('places', {
        type: 'geojson',
        data: geojson,
    });
}

export function addPlacesLayer(map: mapboxgl.Map) {
    if (map.getLayer('places-circle')) return;

    map.addLayer({
        id: 'places-circle',
        type: 'circle',
        source: 'places',
        paint: {
            'circle-radius': 6,
            'circle-color': '#2563eb',
        },
    });
}