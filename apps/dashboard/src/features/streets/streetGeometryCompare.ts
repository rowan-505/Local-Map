import type { Geometry } from "geojson";

import type { StreetGeometry, StreetLineStringGeoJson } from "@/src/lib/api";

import { coerceLineStringCoordinates, normalizeLineStringForEditor } from "./normalizeStreetLineString";

/** ~1 cm at equator; tolerates map/editor float noise without treating edits as unchanged. */
const COORD_EPSILON = 1e-7;

export function streetLineStringFromRecordGeometry(
    geometry: StreetGeometry | Geometry | null | undefined,
): StreetLineStringGeoJson | null {
    if (!geometry) {
        return null;
    }
    return normalizeLineStringForEditor(geometry as StreetGeometry).line;
}

export function streetLineStringFromDetail(detail: unknown): StreetLineStringGeoJson | null {
    if (!detail || typeof detail !== "object") {
        return null;
    }
    const geometry = (detail as { geometry?: StreetGeometry | null }).geometry;
    return streetLineStringFromRecordGeometry(geometry);
}

function normalizeLineForCompare(
    geometry: StreetLineStringGeoJson | Geometry | null | undefined,
): StreetLineStringGeoJson | null {
    if (!geometry || typeof geometry !== "object") {
        return null;
    }
    if ("type" in geometry && geometry.type === "LineString") {
        return coerceLineStringCoordinates(geometry as StreetLineStringGeoJson);
    }
    return streetLineStringFromRecordGeometry(geometry as StreetGeometry);
}

function coordinatesEqual(a: number[][], b: number[][]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        const left = a[i];
        const right = b[i];
        if (!left || !right || left.length < 2 || right.length < 2) {
            return false;
        }
        if (Math.abs(left[0]! - right[0]!) > COORD_EPSILON || Math.abs(left[1]! - right[1]!) > COORD_EPSILON) {
            return false;
        }
    }
    return true;
}

/** True when normalized centerlines match (metadata-only save should skip API geometry validation). */
export function isStreetLineStringGeometryUnchanged(
    baseline: StreetLineStringGeoJson | Geometry | null | undefined,
    current: StreetLineStringGeoJson | Geometry | null | undefined,
): boolean {
    const base = normalizeLineForCompare(baseline);
    const cur = normalizeLineForCompare(current);

    if (!base && !cur) {
        return true;
    }
    if (!base || !cur) {
        return false;
    }
    return coordinatesEqual(base.coordinates, cur.coordinates);
}
