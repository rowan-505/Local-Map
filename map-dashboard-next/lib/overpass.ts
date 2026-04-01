export type OsmPoi = {
    id: string;
    name: string;
    category: string;
    lat: number;
    lng: number;
    source: "osm";
};

type OverpassElement = {
    id: number;
    type: "node" | "way" | "relation";
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
};

type OverpassResponse = {
    elements: OverpassElement[];
};

function getCategory(tags: Record<string, string> = {}): string {
    if (tags.amenity === "hospital") return "hospital";
    if (tags.amenity === "clinic") return "clinic";
    if (tags.amenity === "pharmacy") return "pharmacy";
    if (tags.amenity === "school") return "school";
    if (tags.amenity === "bank") return "bank";
    if (tags.amenity === "atm") return "atm";
    if (tags.amenity === "restaurant") return "restaurant";
    if (tags.amenity === "cafe") return "cafe";
    if (tags.shop === "supermarket") return "supermarket";
    if (tags.shop === "convenience") return "convenience";
    if (tags.highway === "bus_stop") return "bus_stop";
    return "other";
}

export async function fetchKyauktanPois(): Promise<OsmPoi[]> {
    // Replace with your exact bbox later:
    // south,west,north,east
    const bbox = "16.41,96.12,16.50,96.22";

    const query = `
        [out:json][timeout:25];
        (
          node["amenity"~"^(hospital|clinic|pharmacy|school|bank|atm|restaurant|cafe)$"](${bbox});
          way["amenity"~"^(hospital|clinic|pharmacy|school|bank|atm|restaurant|cafe)$"](${bbox});
          relation["amenity"~"^(hospital|clinic|pharmacy|school|bank|atm|restaurant|cafe)$"](${bbox});

          node["shop"~"^(supermarket|convenience)$"](${bbox});
          way["shop"~"^(supermarket|convenience)$"](${bbox});
          relation["shop"~"^(supermarket|convenience)$"](${bbox});

          node["highway"="bus_stop"](${bbox});
        );
        out center tags;
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
        throw new Error(`Overpass request failed: ${res.status}`);
    }

    const data: OverpassResponse = await res.json();

    const pois: OsmPoi[] = data.elements
        .map((el) => {
            const lat = el.lat ?? el.center?.lat;
            const lng = el.lon ?? el.center?.lon;
            const tags = el.tags ?? {};

            if (!lat || !lng) return null;
            if (!tags.name) return null;

            return {
                id: `${el.type}-${el.id}`,
                name: tags.name,
                category: getCategory(tags),
                lat,
                lng,
                source: "osm" as const,
            };
        })
        .filter((x): x is OsmPoi => Boolean(x));

    return pois;
}