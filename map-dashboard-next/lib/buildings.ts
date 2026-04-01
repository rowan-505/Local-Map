type OverpassGeometryPoint = {
    lat: number;
    lon: number;
};

type OverpassElement = {
    id: number;
    type: "way";
    geometry?: OverpassGeometryPoint[];
    tags?: Record<string, string>;
};

type OverpassResponse = {
    elements?: OverpassElement[];
};

export async function fetchKyauktanBuildings() {
    // smaller bbox near your current center
    const bbox = "16.438,96.188,16.452,96.204";

    const query = `
[out:json][timeout:25];
(
  way["building"](${bbox});
);
out geom;
`;

    const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
            "Content-Type": "text/plain",
        },
        body: query,
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Overpass failed: ${res.status} ${text}`);
    }

    const data: OverpassResponse = await res.json();

    if (!data.elements || !Array.isArray(data.elements)) {
        throw new Error("Invalid Overpass response");
    }

    const features = data.elements
        .map((el) => {
            if (!el.geometry || el.geometry.length < 3) return null;

            const coordinates = el.geometry.map((point) => [point.lon, point.lat]);

            if (coordinates.length < 3) return null;

            const first = coordinates[0];
            const last = coordinates[coordinates.length - 1];

            // close polygon if needed
            if (first[0] !== last[0] || first[1] !== last[1]) {
                coordinates.push([...first]);
            }

            return {
                type: "Feature",
                properties: {
                    id: el.id,
                    building: el.tags?.building ?? "yes",
                    name: el.tags?.name ?? null,
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [coordinates],
                },
            };
        })
        .filter(Boolean);

    return {
        type: "FeatureCollection",
        features,
    };
}