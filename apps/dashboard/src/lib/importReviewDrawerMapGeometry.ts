import type { Geometry, LineString, MultiLineString } from "geojson";

import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewBuildingListItem, ImportReviewGeoJson } from "@/src/lib/api";

function parseRawGeoJson(raw: unknown): Record<string, unknown> | null {
    if (raw === null || raw === undefined) {
        return null;
    }
    let value: unknown = raw;
    if (typeof value === "string") {
        const t = value.trim();
        if (!t) {
            return null;
        }
        try {
            value = JSON.parse(t) as unknown;
        } catch {
            return null;
        }
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

/** Unwrap Feature / FeatureCollection / GeometryCollection into a single GeoJSON geometry. */
export function normalizeImportReviewGeoJson(raw: unknown): Geometry | null {
    const o = parseRawGeoJson(raw);
    if (!o || typeof o.type !== "string") {
        return null;
    }

    const t = o.type;
    if (
        t === "Point" ||
        t === "MultiPoint" ||
        t === "LineString" ||
        t === "MultiLineString" ||
        t === "Polygon" ||
        t === "MultiPolygon"
    ) {
        return o as unknown as Geometry;
    }

    if (t === "Feature") {
        return normalizeImportReviewGeoJson(o.geometry);
    }

    if (t === "FeatureCollection" && Array.isArray(o.features)) {
        for (const feature of o.features) {
            const g = normalizeImportReviewGeoJson(feature);
            if (g) {
                return g;
            }
        }
        return null;
    }

    if (t === "GeometryCollection" && Array.isArray(o.geometries)) {
        for (const g of o.geometries) {
            const normalized = normalizeImportReviewGeoJson(g);
            if (normalized) {
                return normalized;
            }
        }
    }

    return null;
}

function extractLineGeometry(raw: unknown): LineString | MultiLineString | null {
    const o = parseRawGeoJson(raw);
    if (!o || typeof o.type !== "string") {
        return null;
    }
    if (o.type === "LineString" || o.type === "MultiLineString") {
        return o as unknown as LineString | MultiLineString;
    }
    if (o.type === "Feature") {
        return extractLineGeometry(o.geometry);
    }
    if (o.type === "FeatureCollection" && Array.isArray(o.features)) {
        const lines: number[][][] = [];
        for (const feature of o.features) {
            const line = extractLineGeometry(feature);
            if (line?.type === "LineString") {
                lines.push(line.coordinates);
            } else if (line?.type === "MultiLineString") {
                lines.push(...line.coordinates);
            }
        }
        if (lines.length === 1) {
            return { type: "LineString", coordinates: lines[0]! };
        }
        if (lines.length > 1) {
            return { type: "MultiLineString", coordinates: lines };
        }
        return null;
    }
    if (o.type === "GeometryCollection" && Array.isArray(o.geometries)) {
        return extractLineGeometry({ type: "GeometryCollection", geometries: o.geometries });
    }
    return null;
}

function pickReviewOverridesField(row: ImportReviewBuildingListItem, key: string): unknown {
    const ov = row.review_overrides;
    if (!ov || typeof ov !== "object" || Array.isArray(ov)) {
        return null;
    }
    return (ov as Record<string, unknown>)[key];
}

export function pickCentroidWktFromNormalized(data: unknown): string | null {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return null;
    }
    const o = data as Record<string, unknown>;
    const top = o.centroid_wkt;
    if (typeof top === "string" && top.trim()) {
        return top.trim();
    }
    const building = o.building;
    if (building && typeof building === "object" && !Array.isArray(building)) {
        const cw = (building as Record<string, unknown>).centroid_wkt;
        if (typeof cw === "string" && cw.trim()) {
            return cw.trim();
        }
    }
    return null;
}

export function wktPointToGeoJson(wkt: string): { type: "Point"; coordinates: [number, number] } | null {
    const m = /^POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)$/i.exec(wkt.trim());
    if (!m) {
        return null;
    }
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return { type: "Point", coordinates: [lng, lat] };
}

/** Building footprint from API GeoJSON, else centroid column, else centroid from normalized_data. */
export function buildingDrawerMapInput(row: ImportReviewBuildingListItem): {
    geometry: ImportReviewGeoJson | null;
    geometryKind: DataReviewGeometryKind;
    fallbackNote: string | null;
} {
    for (const candidate of [row.geometry, row.geom, pickReviewOverridesField(row, "geom")]) {
        const g = normalizeImportReviewGeoJson(candidate);
        if (g?.type === "Polygon" || g?.type === "MultiPolygon") {
            return { geometry: g as unknown as ImportReviewGeoJson, geometryKind: "polygon", fallbackNote: null };
        }
        if (g?.type === "Point" || g?.type === "MultiPoint") {
            return { geometry: g as unknown as ImportReviewGeoJson, geometryKind: "point", fallbackNote: null };
        }
    }
    const c = row.centroid as ImportReviewGeoJson | null | undefined;
    if (c && typeof c === "object" && !Array.isArray(c) && "type" in c) {
        const ct = (c as { type: string }).type;
        if (ct === "Point" || ct === "MultiPoint") {
            return {
                geometry: c,
                geometryKind: "point",
                fallbackNote: "Showing API centroid (no polygon GeoJSON on this row).",
            };
        }
    }
    const wkt = pickCentroidWktFromNormalized(row.normalized_data);
    if (wkt) {
        const pt = wktPointToGeoJson(wkt);
        if (pt) {
            return {
                geometry: pt,
                geometryKind: "point",
                fallbackNote:
                    "Showing centroid from normalized_data (footprint GeoJSON not on this row from the API).",
            };
        }
    }
    return { geometry: null, geometryKind: "polygon", fallbackNote: null };
}

/** Place point from API GeoJSON or centroid WKT in normalized_data. */
export function placeDrawerMapInput(row: ImportReviewBuildingListItem): {
    geometry: ImportReviewGeoJson | null;
    geometryKind: DataReviewGeometryKind;
    fallbackNote: string | null;
} {
    const g = normalizeImportReviewGeoJson(row.geometry);
    if (g?.type === "Point" || g?.type === "MultiPoint") {
        return { geometry: g as unknown as ImportReviewGeoJson, geometryKind: "point", fallbackNote: null };
    }
    const wkt = pickCentroidWktFromNormalized(row.normalized_data);
    if (wkt) {
        const pt = wktPointToGeoJson(wkt);
        if (pt) {
            return {
                geometry: pt,
                geometryKind: "point",
                fallbackNote:
                    "Showing centroid from normalized_data (point GeoJSON not on this row from the API).",
            };
        }
    }
    return { geometry: null, geometryKind: "point", fallbackNote: null };
}

/** Road centerline from API geometry, geom, or review_overrides. */
export function roadDrawerMapInput(row: ImportReviewBuildingListItem): {
    geometry: ImportReviewGeoJson | null;
    geometryKind: DataReviewGeometryKind;
    fallbackNote: string | null;
} {
    const sources = [row.geometry, row.geom, pickReviewOverridesField(row, "geom")];
    for (const raw of sources) {
        const line = extractLineGeometry(raw);
        if (line) {
            return {
                geometry: line as unknown as ImportReviewGeoJson,
                geometryKind: "line",
                fallbackNote: null,
            };
        }
    }
    return { geometry: null, geometryKind: "line", fallbackNote: null };
}
