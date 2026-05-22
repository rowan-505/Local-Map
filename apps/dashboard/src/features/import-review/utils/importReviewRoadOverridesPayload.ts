import type { ImportReviewGeoJson } from "@/src/lib/api";

export type BuildRoadReviewOverridesPatchInput = {
    nameMm: string;
    nameEn: string;
    roadClassId: string;
    adminAreaId: string | null;
    surface: string;
    isOneway: boolean;
    confidenceScore?: number | null;
    geom?: ImportReviewGeoJson | null;
    includeGeom: boolean;
};

function parsePositiveIntOrNull(raw: string, fieldLabel: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") {
        return null;
    }
    if (!/^\d+$/.test(trimmed)) {
        throw new Error(`${fieldLabel} must be a positive integer or empty.`);
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${fieldLabel} must be a positive integer or empty.`);
    }
    return value;
}

/** Normalize road override PATCH payload before sending to the API. */
export function buildRoadReviewOverridesPatch(
    input: BuildRoadReviewOverridesPatchInput,
): Record<string, unknown> {
    const review_overrides: Record<string, unknown> = {
        name_mm: input.nameMm.trim() || null,
        name_en: input.nameEn.trim() || null,
        is_oneway: input.isOneway,
        surface: input.surface.trim() || null,
        road_class_id: parsePositiveIntOrNull(input.roadClassId, "Road class"),
        admin_area_id:
            input.adminAreaId && input.adminAreaId.trim() !== ""
                ? parsePositiveIntOrNull(input.adminAreaId, "Admin area")
                : null,
    };

    if (
        input.confidenceScore !== null &&
        input.confidenceScore !== undefined &&
        Number.isFinite(input.confidenceScore)
    ) {
        review_overrides.confidence_score = input.confidenceScore;
    }

    if (input.includeGeom && input.geom) {
        review_overrides.geom = input.geom;
    }

    return review_overrides;
}
