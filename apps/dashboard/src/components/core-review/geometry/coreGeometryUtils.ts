import area from "@turf/area";
import type { Geometry, LineString, MultiPolygon, Polygon, Position } from "geojson";

import {
    exteriorVertexCount,
    parsePolygonOrMultiPolygon,
} from "@/src/components/buildings/BuildingEditorMap";
import {
    coerceLineStringCoordinates,
    lineStringLengthValidMinVertices,
} from "@/src/features/streets/normalizeStreetLineString";
import type { StreetLineStringGeoJson } from "@/src/lib/api";

export type CoreGeometryType = "point" | "line" | "polygon" | "multiPolygon";

export type CoreGeometryValidationResult = {
    valid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
        vertexCount: number;
        areaSqM: number | null;
        lengthM: number | null;
        coordinates: { lat: number; lng: number } | null;
    };
};

const EARTH_RADIUS_M = 6_371_000;

function isFiniteCoordPair(pair: Position): pair is [number, number] {
    return (
        Array.isArray(pair) &&
        pair.length >= 2 &&
        Number.isFinite(Number(pair[0])) &&
        Number.isFinite(Number(pair[1]))
    );
}

function roundCoord(value: number): number {
    return Number(value.toFixed(7));
}

/** Infer editor geometry kind from GeoJSON (or null when empty / unsupported). */
export function getGeometryType(geometry: Geometry | null | undefined): CoreGeometryType | null {
    if (!geometry) {
        return null;
    }

    switch (geometry.type) {
        case "Point":
            return "point";
        case "LineString":
            return "line";
        case "Polygon":
            return "polygon";
        case "MultiPolygon":
            return "multiPolygon";
        default:
            return null;
    }
}

/** Map editor config type to preview fit kind. */
export function coreGeometryTypeToPreviewKind(
    geometryType: CoreGeometryType,
): "point" | "line" | "polygon" {
    if (geometryType === "point") {
        return "point";
    }
    if (geometryType === "line") {
        return "line";
    }
    return "polygon";
}

/** Normalize API / form GeoJSON into a shape each editor can consume. */
export function normalizeGeometryForEditor(
    geometryType: CoreGeometryType,
    geometry: Geometry | null | undefined,
): Geometry | null {
    if (!geometry) {
        return null;
    }

    if (geometryType === "point") {
        if (geometry.type !== "Point" || !isFiniteCoordPair(geometry.coordinates)) {
            return null;
        }
        const lng = Number(geometry.coordinates[0]);
        const lat = Number(geometry.coordinates[1]);
        return { type: "Point", coordinates: [roundCoord(lng), roundCoord(lat)] };
    }

    if (geometryType === "line") {
        if (geometry.type === "LineString") {
            const coerced = coerceLineStringCoordinates({
                type: "LineString",
                coordinates: geometry.coordinates,
            });
            return coerced;
        }
        if (geometry.type === "MultiLineString" && geometry.coordinates[0]) {
            const coerced = coerceLineStringCoordinates({
                type: "LineString",
                coordinates: geometry.coordinates[0],
            });
            return coerced;
        }
        return null;
    }

    if (geometryType === "polygon" || geometryType === "multiPolygon") {
        const parsed = parsePolygonOrMultiPolygon(JSON.stringify(geometry));
        return parsed;
    }

    return null;
}

/** Axis-aligned bounds as [[west, south], [east, north]] in WGS84. */
export function getGeometryBounds(
    geometry: Geometry | null | undefined,
): [[number, number], [number, number]] | null {
    if (!geometry) {
        return null;
    }

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    const extend = (lng: number, lat: number) => {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return;
        }
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
    };

    const walkRing = (ring: Position[]) => {
        for (const coord of ring) {
            if (isFiniteCoordPair(coord)) {
                extend(Number(coord[0]), Number(coord[1]));
            }
        }
    };

    switch (geometry.type) {
        case "Point":
            if (isFiniteCoordPair(geometry.coordinates)) {
                extend(Number(geometry.coordinates[0]), Number(geometry.coordinates[1]));
            }
            break;
        case "LineString":
            for (const coord of geometry.coordinates) {
                if (isFiniteCoordPair(coord)) {
                    extend(Number(coord[0]), Number(coord[1]));
                }
            }
            break;
        case "Polygon":
            for (const ring of geometry.coordinates) {
                walkRing(ring);
            }
            break;
        case "MultiPolygon":
            for (const poly of geometry.coordinates) {
                for (const ring of poly) {
                    walkRing(ring);
                }
            }
            break;
        default:
            return null;
    }

    if (!Number.isFinite(west + south + east + north)) {
        return null;
    }

    return [
        [west, south],
        [east, north],
    ];
}

function haversineMeters(a: [number, number], b: [number, number]): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineStringLengthMeters(line: LineString | StreetLineStringGeoJson | null): number | null {
    if (!line || line.coordinates.length < 2) {
        return null;
    }

    let total = 0;
    for (let i = 1; i < line.coordinates.length; i++) {
        const prev = line.coordinates[i - 1];
        const cur = line.coordinates[i];
        if (!isFiniteCoordPair(prev) || !isFiniteCoordPair(cur)) {
            return null;
        }
        total += haversineMeters([Number(prev[0]), Number(prev[1])], [Number(cur[0]), Number(cur[1])]);
    }

    return total;
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
    const val = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    if (Math.abs(val) < 1e-12) {
        return 0;
    }
    return val > 0 ? 1 : 2;
}

function onSegment(a: [number, number], b: [number, number], c: [number, number]): boolean {
    return (
        Math.min(a[0], c[0]) - 1e-12 <= b[0] &&
        b[0] <= Math.max(a[0], c[0]) + 1e-12 &&
        Math.min(a[1], c[1]) - 1e-12 <= b[1] &&
        b[1] <= Math.max(a[1], c[1]) + 1e-12
    );
}

function segmentsIntersect(
    p1: [number, number],
    q1: [number, number],
    p2: [number, number],
    q2: [number, number],
): boolean {
    const o1 = orientation(p1, q1, p2);
    const o2 = orientation(p1, q1, q2);
    const o3 = orientation(p2, q2, p1);
    const o4 = orientation(p2, q2, q1);

    if (o1 !== o2 && o3 !== o4) {
        return true;
    }

    if (o1 === 0 && onSegment(p1, p2, q1)) {
        return true;
    }
    if (o2 === 0 && onSegment(p1, q2, q1)) {
        return true;
    }
    if (o3 === 0 && onSegment(p2, p1, q2)) {
        return true;
    }
    if (o4 === 0 && onSegment(p2, q1, q2)) {
        return true;
    }

    return false;
}

function openRingFromPolygonRing(ring: Position[]): [number, number][] {
    if (ring.length < 3) {
        return [];
    }

    const coords = ring
        .filter(isFiniteCoordPair)
        .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);

    if (coords.length < 3) {
        return [];
    }

    const first = coords[0];
    const last = coords[coords.length - 1];
    const closed =
        coords.length > 3 && first[0] === last[0] && first[1] === last[1];

    return closed ? coords.slice(0, -1) : coords;
}

/** Simple segment-intersection test on the exterior ring (non-adjacent edges). */
export function polygonRingSelfIntersects(openRing: [number, number][]): boolean {
    const n = openRing.length;
    if (n < 4) {
        return false;
    }

    for (let i = 0; i < n; i++) {
        const a1 = openRing[i];
        const a2 = openRing[(i + 1) % n];

        for (let j = i + 1; j < n; j++) {
            if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) {
                continue;
            }

            const b1 = openRing[j];
            const b2 = openRing[(j + 1) % n];

            if (segmentsIntersect(a1, a2, b1, b2)) {
                return true;
            }
        }
    }

    return false;
}

export function validatePointGeometry(geometry: Geometry | null | undefined): CoreGeometryValidationResult {
    const emptyStats = {
        vertexCount: 0,
        areaSqM: null,
        lengthM: null,
        coordinates: null,
    };

    if (!geometry) {
        return {
            valid: false,
            errors: ["Click the map to place a point."],
            warnings: [],
            stats: emptyStats,
        };
    }

    if (geometry.type !== "Point" || !isFiniteCoordPair(geometry.coordinates)) {
        return {
            valid: false,
            errors: ["Geometry must be a valid GeoJSON Point."],
            warnings: [],
            stats: emptyStats,
        };
    }

    const lng = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return {
            valid: false,
            errors: ["Coordinates are out of WGS84 bounds."],
            warnings: [],
            stats: emptyStats,
        };
    }

    return {
        valid: true,
        errors: [],
        warnings: [],
        stats: {
            vertexCount: 1,
            areaSqM: null,
            lengthM: null,
            coordinates: { lat, lng },
        },
    };
}

export function validateLineGeometry(geometry: Geometry | null | undefined): CoreGeometryValidationResult {
    const emptyStats = {
        vertexCount: 0,
        areaSqM: null,
        lengthM: null,
        coordinates: null,
    };

    if (!geometry) {
        return {
            valid: false,
            errors: ["Draw a line on the map (at least two vertices)."],
            warnings: [],
            stats: emptyStats,
        };
    }

    const normalized = normalizeGeometryForEditor("line", geometry) as StreetLineStringGeoJson | null;

    if (!normalized || normalized.type !== "LineString") {
        return {
            valid: false,
            errors: ["Geometry must be a GeoJSON LineString."],
            warnings: [],
            stats: emptyStats,
        };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!lineStringLengthValidMinVertices(normalized)) {
        errors.push("Line must have at least two vertices.");
    }

    const lengthM = lineStringLengthMeters(normalized);

    if (geometry.type === "MultiLineString") {
        warnings.push("MultiLineString was normalized to the first line for editing.");
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            vertexCount: normalized.coordinates.length,
            areaSqM: null,
            lengthM,
            coordinates: null,
        },
    };
}

export function validatePolygonGeometry(
    geometry: Geometry | null | undefined,
    geometryType: "polygon" | "multiPolygon" = "polygon",
): CoreGeometryValidationResult {
    const emptyStats = {
        vertexCount: 0,
        areaSqM: null,
        lengthM: null,
        coordinates: null,
    };

    if (!geometry) {
        return {
            valid: false,
            errors: ["Draw a polygon on the map (at least three vertices)."],
            warnings: [],
            stats: emptyStats,
        };
    }

    const parsed = normalizeGeometryForEditor(geometryType, geometry) as Polygon | MultiPolygon | null;

    if (!parsed) {
        return {
            valid: false,
            errors: ["Geometry must be a GeoJSON Polygon or MultiPolygon."],
            warnings: [],
            stats: emptyStats,
        };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const vertexCount = exteriorVertexCount(parsed);

    if (vertexCount < 3) {
        errors.push("Polygon must have at least three usable vertices.");
    }

    let areaSqM: number | null = null;
    try {
        areaSqM = area({ type: "Feature", properties: {}, geometry: parsed });
    } catch {
        warnings.push("Could not compute polygon area.");
    }

    const rings: [number, number][][] = [];
    if (parsed.type === "Polygon") {
        rings.push(openRingFromPolygonRing(parsed.coordinates[0] ?? []));
    } else {
        for (const poly of parsed.coordinates) {
            rings.push(openRingFromPolygonRing(poly[0] ?? []));
        }
        if (parsed.coordinates.length > 1) {
            warnings.push("Only the first polygon ring is fully validated for self-intersection.");
        }
    }

    for (const ring of rings) {
        if (ring.length >= 4 && polygonRingSelfIntersects(ring)) {
            warnings.push("Polygon ring may self-intersect — review the footprint before saving.");
            break;
        }
    }

    if (geometryType === "multiPolygon" && parsed.type === "Polygon") {
        warnings.push("Expected MultiPolygon but received a single Polygon.");
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            vertexCount,
            areaSqM,
            lengthM: null,
            coordinates: null,
        },
    };
}

export function validateGeometryForEditor(
    geometryType: CoreGeometryType,
    geometry: Geometry | null | undefined,
): CoreGeometryValidationResult {
    switch (geometryType) {
        case "point":
            return validatePointGeometry(geometry);
        case "line":
            return validateLineGeometry(geometry);
        case "polygon":
            return validatePolygonGeometry(geometry, "polygon");
        case "multiPolygon":
            return validatePolygonGeometry(geometry, "multiPolygon");
        default:
            return {
                valid: false,
                errors: ["Unsupported geometry type."],
                warnings: [],
                stats: {
                    vertexCount: 0,
                    areaSqM: null,
                    lengthM: null,
                    coordinates: null,
                },
            };
    }
}

export function geometryToEditorJson(geometry: Geometry | null | undefined): string {
    if (!geometry) {
        return "";
    }
    return JSON.stringify(geometry, null, 2);
}

export function pointGeometryToLatLng(
    geometry: Geometry | null | undefined,
): { lat: number; lng: number } | null {
    if (!geometry || geometry.type !== "Point" || !isFiniteCoordPair(geometry.coordinates)) {
        return null;
    }
    return {
        lat: Number(geometry.coordinates[1]),
        lng: Number(geometry.coordinates[0]),
    };
}

export function formatAreaSqM(areaSqM: number | null): string | null {
    if (areaSqM === null || !Number.isFinite(areaSqM)) {
        return null;
    }
    if (areaSqM >= 10_000) {
        return `${(areaSqM / 10_000).toFixed(2)} ha`;
    }
    return `${Math.round(areaSqM)} m²`;
}

export function formatLengthM(lengthM: number | null): string | null {
    if (lengthM === null || !Number.isFinite(lengthM)) {
        return null;
    }
    if (lengthM >= 1000) {
        return `${(lengthM / 1000).toFixed(2)} km`;
    }
    return `${Math.round(lengthM)} m`;
}

export function defaultCoreGeometryEditorTitle(geometryType: CoreGeometryType): string {
    switch (geometryType) {
        case "point":
            return "Point location";
        case "line":
            return "Line geometry";
        case "polygon":
            return "Polygon footprint";
        case "multiPolygon":
            return "Multi-polygon footprint";
        default:
            return "Geometry";
    }
}
