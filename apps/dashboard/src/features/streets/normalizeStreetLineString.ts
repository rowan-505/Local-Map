import type { StreetGeometry, StreetLineStringGeoJson } from "@/src/lib/api";

export type NormalizeLineStringResult = {
    line: StreetLineStringGeoJson | null;
    /** Set when API returned MultiLineString — only the first path is editable. */
    multiLineWarning?: string;
    /** Non-line geometry from API (unexpected for streets). */
    unsupportedReason?: string;
    /** Coordinate values could not be parsed as finite lng/lat. */
    parseError?: string;
};

/** Coerce each vertex to finite numbers (PostGIS/JSON sometimes yields strings). */
export function coerceLineStringCoordinates(line: StreetLineStringGeoJson): StreetLineStringGeoJson | null {
    const coords = line.coordinates.map((pair) => {
        if (!Array.isArray(pair) || pair.length < 2) {
            return null;
        }
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        return [lng, lat] as [number, number];
    });

    if (coords.some((c) => c === null)) {
        return null;
    }

    return { type: "LineString", coordinates: coords as number[][] };
}

/**
 * Editor + API writes LineString only. Normalize MultiLineString (first line) for Terra Draw.
 */
export function normalizeLineStringForEditor(geometry: StreetGeometry | null | undefined): NormalizeLineStringResult {
    if (!geometry) {
        return { line: null };
    }

    if (geometry.type === "LineString") {
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
            return { line: null };
        }
        const coerced = coerceLineStringCoordinates({ type: "LineString", coordinates: geometry.coordinates });
        if (!coerced) {
            return { line: null, parseError: "Street LineString has invalid or non-finite coordinates." };
        }
        return { line: coerced };
    }

    if (geometry.type === "MultiLineString") {
        const first = geometry.coordinates[0];
        if (!first || first.length < 2) {
            return {
                line: null,
                multiLineWarning: "MultiLineString geometry is empty; draw a new centerline.",
            };
        }
        const coerced = coerceLineStringCoordinates({ type: "LineString", coordinates: first });
        if (!coerced) {
            return {
                line: null,
                multiLineWarning:
                    "MultiLineString first path has invalid coordinates; draw a new centerline on the map.",
            };
        }
        return {
            line: coerced,
            multiLineWarning:
                "This street was stored as MultiLineString. Only the first line is loaded; saving writes a single LineString.",
        };
    }

    return {
        line: null,
        unsupportedReason: `Geometry type "${(geometry as { type?: string }).type}" is not editable on the map — only LineString (or legacy MultiLineString) is supported.`,
    };
}

export function lineStringLengthValidMinVertices(line: StreetLineStringGeoJson | null): boolean {
    return Boolean(line && line.coordinates.length >= 2);
}
