import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";

import type { ImportTransportDetailItem, ImportTransportGeometryType } from "../config/types";

function parseRawGeoJson(raw: unknown): Record<string, unknown> | null {
    if (raw === null || raw === undefined) {
        return null;
    }
    let value: unknown = raw;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        try {
            value = JSON.parse(trimmed) as unknown;
        } catch {
            return null;
        }
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function normalizeGeometry(raw: unknown): Record<string, unknown> | null {
    const object = parseRawGeoJson(raw);
    if (!object || typeof object.type !== "string") {
        return null;
    }
    const type = object.type;
    if (
        type === "Point" ||
        type === "MultiPoint" ||
        type === "LineString" ||
        type === "MultiLineString" ||
        type === "Polygon" ||
        type === "MultiPolygon"
    ) {
        return object;
    }
    if (type === "Feature") {
        return normalizeGeometry(object.geometry);
    }
    if (type === "FeatureCollection" && Array.isArray(object.features)) {
        for (const feature of object.features) {
            const geometry = normalizeGeometry(feature);
            if (geometry) {
                return geometry;
            }
        }
    }
    return null;
}

export function toDataReviewGeometryKind(
    geometryType: ImportTransportGeometryType
): DataReviewGeometryKind {
    if (geometryType === "line") {
        return "line";
    }
    if (geometryType === "point") {
        return "point";
    }
    return "point";
}

export function importTransportDrawerMapInput(
    row: ImportTransportDetailItem,
    geometryType: ImportTransportGeometryType
): {
    geometry: Record<string, unknown> | null;
    geometryKind: DataReviewGeometryKind;
} {
    const geometry =
        normalizeGeometry(row.geometry) ??
        normalizeGeometry(row.geom) ??
        normalizeGeometry((row.normalized_data as { geometry?: unknown } | null)?.geometry);
    return {
        geometry,
        geometryKind: toDataReviewGeometryKind(geometryType),
    };
}
