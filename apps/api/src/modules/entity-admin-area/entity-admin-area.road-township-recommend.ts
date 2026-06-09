export type RoadTownshipDebugReason =
    | "invalid_geometry"
    | "no_township_polygons"
    | "outside_all_townships"
    | "query_error";

export type RoadTownshipFallbackReason = "point_fallback" | "nearest_township";

export type RoadTownshipMatchRow = {
    id: bigint;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_code: string;
    overlap_m: number;
    overlap_pct: number | null;
};

export type RoadTownshipCommonParentRow = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    name_mm: string | null;
    name_en: string | null;
};

export type RoadTownshipRecommendationResult = {
    recommended: RoadTownshipMatchRow | null;
    matches: RoadTownshipMatchRow[];
    commonParent: RoadTownshipCommonParentRow | null;
    fallback_reason: RoadTownshipFallbackReason | null;
    distance_m: number | null;
    nearest_unfiltered_distance_m: number | null;
    debugReason: RoadTownshipDebugReason | null;
    road_length_m: number | null;
    geometry_intersects: boolean;
};

export const ROAD_TOWNSHIP_NEAREST_MAX_M_DEFAULT = 1000;

export function getRoadTownshipNearestMaxM(): number {
    const raw = process.env.ROAD_TOWNSHIP_NEAREST_MAX_M?.trim();
    if (!raw) {
        return ROAD_TOWNSHIP_NEAREST_MAX_M_DEFAULT;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return ROAD_TOWNSHIP_NEAREST_MAX_M_DEFAULT;
    }
    return parsed;
}

export function emptyRoadTownshipRecommendation(
    debugReason: RoadTownshipDebugReason,
    args?: Partial<Pick<RoadTownshipRecommendationResult, "nearest_unfiltered_distance_m" | "road_length_m">>,
): RoadTownshipRecommendationResult {
    return {
        recommended: null,
        matches: [],
        commonParent: null,
        fallback_reason: null,
        distance_m: null,
        nearest_unfiltered_distance_m: args?.nearest_unfiltered_distance_m ?? null,
        debugReason,
        road_length_m: args?.road_length_m ?? null,
        geometry_intersects: false,
    };
}
