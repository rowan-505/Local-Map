import type { Point } from "geojson";

import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type {
    BuildingGeometry,
    ImportReviewGeoJson,
    StreetGeometry,
} from "@/src/lib/api";

/** Label for the fit control — matches import-review / building-editor wording per kind. */
export function coreReviewFitButtonLabel(geometryKind: DataReviewGeometryKind): string {
    if (geometryKind === "polygon") {
        return "Fit to polygon";
    }
    if (geometryKind === "line") {
        return "Fit to line";
    }
    return "Fit";
}

export function placeCoordinatesToGeoJson(
    lat: number | null | undefined,
    lng: number | null | undefined,
): Point | null {
    if (
        lat === null ||
        lat === undefined ||
        lng === null ||
        lng === undefined ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return null;
    }

    return {
        type: "Point",
        coordinates: [lng, lat],
    };
}

export function buildingGeometryToGeoJson(
    geometry: BuildingGeometry | null | undefined,
): ImportReviewGeoJson | null {
    if (!geometry) {
        return null;
    }
    return geometry as ImportReviewGeoJson;
}

export function streetGeometryToGeoJson(
    geometry: StreetGeometry | null | undefined,
): ImportReviewGeoJson | null {
    if (!geometry) {
        return null;
    }
    return geometry as ImportReviewGeoJson;
}
