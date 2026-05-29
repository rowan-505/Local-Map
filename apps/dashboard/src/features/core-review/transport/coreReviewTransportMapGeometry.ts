import type { LineString, MultiLineString, Position } from "geojson";

import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewGeoJson } from "@/src/lib/api";
import { normalizeImportReviewGeoJson } from "@/src/lib/importReviewDrawerMapGeometry";

export type CoreReviewTransportRoutePathRow = {
    id?: string;
    pathKind?: string | null;
    distanceM?: number | null;
    isActive?: boolean;
    geometry?: unknown;
};

function asLineCoordinateSets(geom: unknown): Position[][] {
    const normalized = normalizeImportReviewGeoJson(geom);
    if (!normalized) {
        return [];
    }
    if (normalized.type === "LineString") {
        return [(normalized as LineString).coordinates];
    }
    if (normalized.type === "MultiLineString") {
        return [...(normalized as MultiLineString).coordinates];
    }
    return [];
}

/** Extract renderable line geometries from variant detail `routePaths`. */
export function extractRoutePathGeometries(routePaths: unknown): ImportReviewGeoJson[] {
    if (!Array.isArray(routePaths)) {
        return [];
    }

    const out: ImportReviewGeoJson[] = [];
    for (const row of routePaths) {
        if (!row || typeof row !== "object") {
            continue;
        }
        const geometry = (row as CoreReviewTransportRoutePathRow).geometry;
        const normalized = normalizeImportReviewGeoJson(geometry);
        if (normalized?.type === "LineString" || normalized?.type === "MultiLineString") {
            out.push(normalized as unknown as ImportReviewGeoJson);
        }
    }
    return out;
}

/** Merge multiple line geometries into one preview geometry for MapLibre. */
export function combineLineGeometriesForPreview(
    primary: ImportReviewGeoJson | null | undefined,
    additional: ImportReviewGeoJson[],
): ImportReviewGeoJson | null {
    const coordinateSets: Position[][] = [
        ...asLineCoordinateSets(primary),
        ...additional.flatMap((geom) => asLineCoordinateSets(geom)),
    ].filter((coords) => coords.length >= 2);

    if (coordinateSets.length === 0) {
        return null;
    }
    if (coordinateSets.length === 1) {
        return { type: "LineString", coordinates: coordinateSets[0]! };
    }
    return { type: "MultiLineString", coordinates: coordinateSets };
}

export type TransportMapPreviewGeometry = {
    /** Primary entity geometry (stop point or variant line). */
    primary: ImportReviewGeoJson | null;
    /** Reference paths from core_transport.route_paths only. */
    routePathsOnly: ImportReviewGeoJson | null;
    /** Primary + route paths combined for a single map preview. */
    combined: ImportReviewGeoJson | null;
    routePathCount: number;
};

export function resolveTransportMapPreviewGeometry(
    geometryKind: DataReviewGeometryKind | "none",
    listGeometry: ImportReviewGeoJson | null,
    detail: Record<string, unknown> | null | undefined,
    options?: { includeRoutePaths?: boolean },
): TransportMapPreviewGeometry {
    const fromDetail = detail?.geometry;
    const primaryRaw =
        fromDetail && typeof fromDetail === "object" && "type" in fromDetail
            ? (fromDetail as ImportReviewGeoJson)
            : listGeometry;
    const primary = normalizeImportReviewGeoJson(primaryRaw) as ImportReviewGeoJson | null;

    if (geometryKind !== "line" || !options?.includeRoutePaths) {
        return {
            primary,
            routePathsOnly: null,
            combined: primary,
            routePathCount: 0,
        };
    }

    const pathGeometries = extractRoutePathGeometries(detail?.routePaths);
    const routePathsOnly = combineLineGeometriesForPreview(null, pathGeometries);
    const combined = combineLineGeometriesForPreview(primary, pathGeometries);

    return {
        primary,
        routePathsOnly,
        combined,
        routePathCount: pathGeometries.length,
    };
}
