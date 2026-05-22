import type { Feature, FeatureCollection, Geometry } from "geojson";

import type {
    ImportReviewAddressMapPreviewLayers,
    ImportReviewGeoJson,
} from "@/src/lib/api";
import { normalizeImportReviewGeoJson } from "@/src/lib/importReviewDrawerMapGeometry";

function featureFromGeoJson(
    raw: ImportReviewGeoJson | null | undefined,
    properties: Record<string, string>
): Feature<Geometry> | null {
    const geometry = normalizeImportReviewGeoJson(raw ?? null);
    if (!geometry) {
        return null;
    }
    return { type: "Feature", properties, geometry };
}

/** Combines address preview layers into one FeatureCollection for the shared map. */
export function buildAddressPreviewFeatureCollection(
    layers: ImportReviewAddressMapPreviewLayers | null | undefined
): FeatureCollection<Geometry> | null {
    if (!layers) {
        return null;
    }

    const features: Feature<Geometry>[] = [];

    const candidate = featureFromGeoJson(layers.candidate_point, { layer: "candidate_point" });
    if (candidate) {
        features.push(candidate);
    }

    const entrance = featureFromGeoJson(layers.entrance_point, { layer: "entrance_point" });
    if (entrance) {
        features.push(entrance);
    }

    const building = featureFromGeoJson(layers.matched_building, { layer: "matched_building" });
    if (building) {
        features.push(building);
    }

    const street = featureFromGeoJson(layers.matched_street, { layer: "matched_street" });
    if (street) {
        features.push(street);
    }

    const admin = featureFromGeoJson(layers.matched_admin_area, { layer: "matched_admin_area" });
    if (admin) {
        features.push(admin);
    }

    if (features.length === 0) {
        return null;
    }

    return { type: "FeatureCollection", features };
}
