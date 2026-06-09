import type {
    RoadTownshipCommonParentRow,
    RoadTownshipDebugReason,
    RoadTownshipFallbackReason,
    RoadTownshipMatchRow,
    RoadTownshipRecommendationResult,
} from "./entity-admin-area.road-township-recommend.js";
type RoadInferCurrentAdminArea = {
    id: string | null;
    name: string | null;
    level_code: string | null;
    is_active: boolean | null;
};

export type RoadTownshipRecommendationMode =
    | "single_overlap"
    | "multi_overlap"
    | "point_fallback"
    | "nearest";

export function formatTownshipLabel(match: Pick<RoadTownshipMatchRow, "canonical_name" | "name_mm" | "name_en">): string {
    const mm = match.name_mm?.trim();
    const en = match.name_en?.trim();
    if (mm && en) {
        return `${mm} — ${en}`;
    }
    return mm || en || match.canonical_name?.trim() || "Township";
}

export function resolveRoadTownshipRecommendationMode(
    recommendation: RoadTownshipRecommendationResult,
): RoadTownshipRecommendationMode | null {
    if (!recommendation.recommended) {
        return null;
    }
    if (recommendation.fallback_reason === "nearest_township") {
        return "nearest";
    }
    if (recommendation.fallback_reason === "point_fallback") {
        return "point_fallback";
    }
    if (recommendation.matches.length > 1) {
        return "multi_overlap";
    }
    return "single_overlap";
}

function formatDistanceM(distanceM: number): string {
    if (distanceM < 1000) {
        return `${Math.round(distanceM)}m`;
    }
    return `${(distanceM / 1000).toFixed(1)}km`;
}

export function buildRoadTownshipInferMessage(args: {
    recommendation: RoadTownshipRecommendationResult;
    mode: RoadTownshipRecommendationMode | null;
    current: RoadInferCurrentAdminArea;
    debugReason: RoadTownshipDebugReason | null;
}): string {
    const { recommendation, mode, current, debugReason } = args;

    if (debugReason === "invalid_geometry") {
        return "Road geometry is missing or invalid. Draw a centerline to infer township.";
    }
    if (debugReason === "no_township_polygons") {
        return "No active township polygons overlap this road area (no_township_polygons).";
    }
    if (debugReason === "query_error") {
        return "Township recommendation failed due to a query error (query_error).";
    }
    if (debugReason === "outside_all_townships") {
        const nearest = recommendation.nearest_unfiltered_distance_m;
        if (nearest !== null && Number.isFinite(nearest)) {
            return `No township match within threshold (outside_all_townships). Nearest township is ${formatDistanceM(nearest)} away.`;
        }
        return "No township match within threshold (outside_all_townships).";
    }

    const recommended = recommendation.recommended;
    if (!recommended || !mode) {
        return "No township match found for this road geometry (no_match).";
    }

    const recommendedLabel = formatTownshipLabel(recommended);
    const parentLabel = recommendation.commonParent
        ? formatTownshipLabel(recommendation.commonParent)
        : null;

    if (mode === "multi_overlap") {
        const parts = [
            `Road intersects multiple townships. Recommended best overlap: ${recommendedLabel}.`,
        ];
        if (parentLabel) {
            parts.push(`Broader area: ${parentLabel}.`);
        }
        return parts.join(" ");
    }

    if (mode === "nearest") {
        const distance =
            recommendation.distance_m !== null
                ? formatDistanceM(recommendation.distance_m)
                : "unknown distance";
        return `No intersecting township; nearest active township within ${distance}: ${recommendedLabel}.`;
    }

    if (mode === "point_fallback") {
        if (current.id && current.level_code && current.level_code !== "township" && current.level_code !== "town") {
            return `Current assignment is ${current.level_code}-level; recommended township from road centerline: ${recommendedLabel}.`;
        }
        return `Recommended township from road centerline: ${recommendedLabel}.`;
    }

    const currentTownshipId = current.id?.trim() ?? "";
    const recommendedTownshipId = recommended.id.toString();
    const currentIsTownship =
        current.level_code === "township" || current.level_code === "town";

    if (currentIsTownship && currentTownshipId && currentTownshipId === recommendedTownshipId) {
        return current.name
            ? `Current township is valid: ${current.name}.`
            : "Current township is valid.";
    }

    if (currentIsTownship && currentTownshipId && currentTownshipId !== recommendedTownshipId) {
        const storedLabel = current.name?.trim() || `township id ${currentTownshipId}`;
        return `Stored township (${storedLabel}) does not match road geometry. Recommended township: ${recommendedLabel}.`;
    }

    return `Recommended township from geometry: ${recommendedLabel}.`;
}

export function mapCommonParentResponse(
    parent: RoadTownshipCommonParentRow | null,
): {
    id: string;
    canonical_name: string;
    admin_level_code: string;
    name_mm: string | null;
    name_en: string | null;
} | null {
    if (!parent) {
        return null;
    }
    return {
        id: parent.id.toString(),
        canonical_name: parent.canonical_name,
        admin_level_code: parent.admin_level_code,
        name_mm: parent.name_mm,
        name_en: parent.name_en,
    };
}

export function mapIntersectingTownshipsResponse(
    matches: RoadTownshipMatchRow[],
): Array<{
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_code: string;
    overlap_m: number;
    overlap_pct: number | null;
}> {
    return matches.map((match) => ({
        id: match.id.toString(),
        canonical_name: match.canonical_name,
        name_mm: match.name_mm,
        name_en: match.name_en,
        admin_level_code: match.admin_level_code,
        overlap_m: match.overlap_m,
        overlap_pct: match.overlap_pct,
    }));
}

export function mapRecommendedTownshipResponse(
    match: RoadTownshipMatchRow | null,
): {
    id: string;
    name_mm: string | null;
    name_en: string | null;
    canonical_name: string | null;
} | null {
    if (!match) {
        return null;
    }
    return {
        id: match.id.toString(),
        name_mm: match.name_mm,
        name_en: match.name_en,
        canonical_name: match.canonical_name,
    };
}

export function mapFallbackReason(
    reason: RoadTownshipFallbackReason | null,
): RoadTownshipFallbackReason | null {
    return reason;
}
