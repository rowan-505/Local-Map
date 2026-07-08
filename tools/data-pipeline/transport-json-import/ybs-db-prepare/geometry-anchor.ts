/**
 * Phase 6 geometry anchor fields for Phase 7 interpolation.
 */

import type { GeoJsonPoint } from "./geometry-rules.js";
import { isValidLngLat, toGeoJsonPoint } from "./geometry-rules.js";
import type {
    ExistingStopCatalog,
    ExistingStopRecord,
    StopMatchDecision,
    StopMatchResult,
} from "./supabase-stop-match.js";

export type StopGeometryAnchorFields = {
    existing_stop_id: number | null;
    existing_stop_public_id: string | null;
    existing_lng: number | null;
    existing_lat: number | null;
    existing_geom_geojson: GeoJsonPoint | null;
    existing_review_status: string | null;
    existing_match_reason: string | null;
    can_use_as_geometry_anchor: boolean;
};

function findExistingStop(
    catalog: ExistingStopCatalog,
    stopId: number | null,
): ExistingStopRecord | null {
    if (stopId === null) {
        return null;
    }

    return catalog.stops.find((stop) => stop.id === stopId) ?? null;
}

export function computeCanUseAsGeometryAnchor(
    decision: StopMatchDecision,
    existingStopId: number | null,
    hasGeometry: boolean,
): boolean {
    if (existingStopId === null || !hasGeometry) {
        return false;
    }

    if (decision === "blocked_conflict" || decision === "needs_manual_review" || decision === "dashboard_review_required") {
        return false;
    }

    return decision === "reuse_existing_stop" || decision === "merge_additional_data_to_existing";
}

export function buildGeometryAnchorFields(
    match: StopMatchResult,
    catalog: ExistingStopCatalog,
): StopGeometryAnchorFields {
    const existing_stop_id = match.matched_stop_id;
    const existing_stop_public_id = match.matched_public_id;
    const existing_review_status = match.matched_review_status;
    const existing_match_reason = match.match_method;

    const existingStop = findExistingStop(catalog, existing_stop_id);
    const point =
        existingStop?.has_geom &&
        existingStop.lng !== null &&
        existingStop.lat !== null &&
        isValidLngLat({ lng: existingStop.lng, lat: existingStop.lat })
            ? { lng: existingStop.lng, lat: existingStop.lat }
            : null;

    const existing_lng = point?.lng ?? null;
    const existing_lat = point?.lat ?? null;
    const existing_geom_geojson = point ? toGeoJsonPoint(point) : null;

    const can_use_as_geometry_anchor = computeCanUseAsGeometryAnchor(
        match.decision,
        existing_stop_id,
        existing_geom_geojson !== null,
    );

    return {
        existing_stop_id,
        existing_stop_public_id,
        existing_lng,
        existing_lat,
        existing_geom_geojson,
        existing_review_status,
        existing_match_reason,
        can_use_as_geometry_anchor,
    };
}
