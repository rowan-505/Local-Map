import type { Geometry } from "geojson";

import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewGeoJson } from "@/src/lib/api";
import { normalizeImportReviewGeoJson } from "@/src/lib/importReviewDrawerMapGeometry";

export type ImportReviewMapPreviewStatus =
    | "loading_geometry"
    | "no_geometry"
    | "invalid_geometry"
    | "ready";

export function parseImportReviewMapGeometry(
    raw: ImportReviewGeoJson | null | undefined
): Geometry | null {
    return normalizeImportReviewGeoJson(raw ?? null);
}

export function inferGeometryKindFromGeometry(g: Geometry): DataReviewGeometryKind | null {
    if (g.type === "Point" || g.type === "MultiPoint") {
        return "point";
    }
    if (g.type === "LineString" || g.type === "MultiLineString") {
        return "line";
    }
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
        return "polygon";
    }
    return null;
}

export function resolveEffectiveGeometryKind(
    parsed: Geometry | null,
    expected: DataReviewGeometryKind
): DataReviewGeometryKind {
    if (!parsed) {
        return expected;
    }
    return inferGeometryKindFromGeometry(parsed) ?? expected;
}

export function isRenderableMapGeometry(
    parsed: Geometry | null,
    kind: DataReviewGeometryKind
): boolean {
    if (!parsed) {
        return false;
    }
    if (kind === "point") {
        return parsed.type === "Point" || parsed.type === "MultiPoint";
    }
    if (kind === "line") {
        return parsed.type === "LineString" || parsed.type === "MultiLineString";
    }
    return parsed.type === "Polygon" || parsed.type === "MultiPolygon";
}

export function getImportReviewMapPreviewStatus({
    enabled,
    isLoadingDetail,
    isLoadingGeometry,
    rawGeometry,
    parsedGeometry,
    effectiveKind,
    fallbackNote,
}: {
    enabled: boolean;
    isLoadingDetail?: boolean;
    isLoadingGeometry?: boolean;
    rawGeometry: ImportReviewGeoJson | null | undefined;
    parsedGeometry: Geometry | null;
    effectiveKind: DataReviewGeometryKind;
    fallbackNote?: string | null;
}): ImportReviewMapPreviewStatus | "disabled" {
    if (!enabled) {
        return "disabled";
    }
    if (isLoadingDetail || isLoadingGeometry) {
        return "loading_geometry";
    }
    const hasRaw = rawGeometry !== null && rawGeometry !== undefined;
    if (!hasRaw && !fallbackNote?.trim()) {
        return "no_geometry";
    }
    if (hasRaw && !parsedGeometry) {
        return "invalid_geometry";
    }
    if (parsedGeometry && !isRenderableMapGeometry(parsedGeometry, effectiveKind)) {
        return "invalid_geometry";
    }
    if (!parsedGeometry && !fallbackNote?.trim()) {
        return "no_geometry";
    }
    return "ready";
}
