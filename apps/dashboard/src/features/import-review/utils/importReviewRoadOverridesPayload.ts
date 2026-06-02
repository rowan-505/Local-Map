import type { ImportReviewGeoJson } from "@/src/lib/api";

import {
    normalizeNullableNumber,
    resolveRoadLayerOverride,
} from "./normalizeNullableNumber";

export type BuildRoadReviewOverridesPatchInput = {
    nameMm: string;
    nameEn: string;
    roadClassId: string;
    /** When road_class_id is unset, optional OSM/highway code for server-side ref lookup. */
    roadClassCode?: string | null;
    adminAreaId: string | null;
    surface: string;
    isOneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    layer: string;
    access: string;
    speedKph: string;
    confidenceScore?: number | null;
    geom?: ImportReviewGeoJson | null;
    includeGeom: boolean;
};

function parsePositiveIntOrNull(raw: string, fieldLabel: string): number | null {
    const value = normalizeNullableNumber(raw);
    if (value === null) {
        return null;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${fieldLabel} must be a positive integer or empty.`);
    }
    return value;
}

function parsePositiveIntIdOrNull(raw: string, fieldLabel: string): number | null {
    return parsePositiveIntOrNull(raw, fieldLabel);
}

/** Normalize road override PATCH payload before sending to the API. */
export function buildRoadReviewOverridesPatch(
    input: BuildRoadReviewOverridesPatchInput,
): Record<string, unknown> {
    const fields: Record<string, unknown> = {
        name_mm: input.nameMm.trim() || null,
        name_en: input.nameEn.trim() || null,
        is_oneway: input.isOneway,
        surface: input.surface.trim() || null,
        bridge: input.bridge,
        tunnel: input.tunnel,
        access: input.access.trim() || null,
        layer: resolveRoadLayerOverride({
            layer: input.layer,
            bridge: input.bridge,
            tunnel: input.tunnel,
        }),
        speed_kph: parsePositiveIntOrNull(input.speedKph, "Speed (kph)"),
    };

    const roadClassIdNum = parsePositiveIntIdOrNull(input.roadClassId, "Road class");
    if (roadClassIdNum !== null) {
        fields.road_class_id = roadClassIdNum;
    } else {
        const code = input.roadClassCode?.trim() ?? "";
        if (code) {
            fields.road_class_code = code;
        }
    }

    if (input.adminAreaId && input.adminAreaId.trim() !== "") {
        fields.admin_area_id = parsePositiveIntIdOrNull(input.adminAreaId, "Admin area");
    }

    if (
        input.confidenceScore !== null &&
        input.confidenceScore !== undefined &&
        Number.isFinite(input.confidenceScore)
    ) {
        fields.confidence_score = input.confidenceScore;
    }

    if (input.includeGeom && input.geom) {
        fields.geom = input.geom;
    }

    return fields;
}
