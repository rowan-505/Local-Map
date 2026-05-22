import type { Geometry, Polygon, MultiPolygon } from "geojson";

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

/** Close polygon rings before POST (triangles with 3 vertices + closing point are valid). */
export function preparePolygonGeometryForSave(geometry: Geometry): Polygon | MultiPolygon {
    if (geometry.type === "Polygon") {
        return {
            type: "Polygon",
            coordinates: geometry.coordinates.map((ring) => closeRing(ring)),
        };
    }
    if (geometry.type === "MultiPolygon") {
        return {
            type: "MultiPolygon",
            coordinates: geometry.coordinates.map((poly) => poly.map((ring) => closeRing(ring))),
        };
    }
    throw new Error("Geometry must be Polygon or MultiPolygon.");
}

/** Dev-only summary of outgoing create/update payloads (no secrets or full geometry). */
export function summarizeCoreReviewSavePayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { kind: typeof payload };
    }
    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record);
    const geom =
        record.geom ??
        record.geometry ??
        record.point_geom ??
        record.pointGeom ??
        record.entrance_geom ??
        record.entranceGeom;
    let geometryType: string | null = null;
    if (geom && typeof geom === "object" && "type" in geom && typeof (geom as { type: unknown }).type === "string") {
        geometryType = (geom as { type: string }).type;
    }
    return {
        keys,
        geometryType,
    };
}
