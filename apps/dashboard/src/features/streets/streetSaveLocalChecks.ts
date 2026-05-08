import type { StreetLineStringGeoJson } from "@/src/lib/api";

import { coerceLineStringCoordinates, lineStringLengthValidMinVertices } from "./normalizeStreetLineString";

/** Returns trimmed road class id when present. */
export function ensureRoadClassSelected(roadClassId: string | undefined): string | null {
    const trimmed = roadClassId?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Client-side checks before save / validate-geometry.
 * Server still enforces length, SRID, and topology rules.
 */
export function prepareLocalStreetGeometryForSave(
    line: StreetLineStringGeoJson | null,
): { ok: true; sanitized: StreetLineStringGeoJson } | { ok: false; message: string } {
    if (!line) {
        return { ok: false, message: "Draw a street centerline on the map." };
    }

    if (line.type !== "LineString") {
        return { ok: false, message: "Geometry must be a LineString." };
    }

    if (!lineStringLengthValidMinVertices(line)) {
        return { ok: false, message: "Centerline must have at least two coordinates." };
    }

    const sanitized = coerceLineStringCoordinates(line);
    if (!sanitized) {
        return { ok: false, message: "Centerline coordinates must be valid numbers (longitude, latitude)." };
    }

    return { ok: true, sanitized };
}
