type CoordPair = [number, number];

function isCoordPair(value: unknown): value is CoordPair {
    return (
        Array.isArray(value) &&
        value.length >= 2 &&
        Number.isFinite(Number(value[0])) &&
        Number.isFinite(Number(value[1]))
    );
}

function closeRing(ring: unknown[]): CoordPair[] {
    const out: CoordPair[] = [];
    for (const pair of ring) {
        if (isCoordPair(pair)) {
            out.push([Number(pair[0]), Number(pair[1])]);
        }
    }
    if (out.length === 0) {
        return out;
    }
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
        out.push([first[0], first[1]]);
    }
    return out;
}

/** Ensure polygon rings are closed before PostGIS ingest (accepts 3-vertex triangles). */
export function normalizePolygonGeoJsonForSave(geojson: unknown): unknown {
    if (!geojson || typeof geojson !== "object") {
        return geojson;
    }

    const typed = geojson as { type?: string; coordinates?: unknown };

    if (typed.type === "Polygon" && Array.isArray(typed.coordinates)) {
        return {
            type: "Polygon",
            coordinates: typed.coordinates.map((ring) => closeRing(Array.isArray(ring) ? ring : [])),
        };
    }

    if (typed.type === "MultiPolygon" && Array.isArray(typed.coordinates)) {
        return {
            type: "MultiPolygon",
            coordinates: typed.coordinates.map((poly) =>
                Array.isArray(poly)
                    ? poly.map((ring) => closeRing(Array.isArray(ring) ? ring : []))
                    : [],
            ),
        };
    }

    return geojson;
}
