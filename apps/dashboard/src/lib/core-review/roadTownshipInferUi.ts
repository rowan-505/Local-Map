import type {
    RoadAdminAreaInferStatus,
    RoadInferCommonParentAdminArea,
    RoadInferCurrentAdminArea,
    RoadInferIntersectingTownship,
    RoadInferRecommendedTownship,
    RoadTownshipDebugReason,
    RoadTownshipRecommendationMode,
} from "@/src/lib/api";

function isNonTownshipLevel(levelCode: string | null | undefined): boolean {
    if (!levelCode?.trim()) {
        return false;
    }
    const code = levelCode.trim().toLowerCase();
    return code !== "township" && code !== "town";
}

function formatDistanceM(distanceM: number): string {
    if (distanceM < 1000) {
        return `${Math.round(distanceM)}m`;
    }
    return `${(distanceM / 1000).toFixed(1)}km`;
}

function formatOverlapPct(pct: number | null | undefined): string | null {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) {
        return null;
    }
    return `${Math.round(pct * 1000) / 10}%`;
}

/** Banner headline for road township audit panel. */
export function roadTownshipInferBannerLabel(args: {
    status: RoadAdminAreaInferStatus | null;
    currentAdminArea: RoadInferCurrentAdminArea | null;
    recommendationMode?: RoadTownshipRecommendationMode | null;
    debugReason?: RoadTownshipDebugReason | null;
    message?: string | null;
}): string | null {
    if (!args.status) {
        return null;
    }

    if (args.status === "invalid_geometry") {
        return args.debugReason === "invalid_geometry"
            ? "Cannot infer township because geometry is invalid."
            : "Cannot infer township because geometry is invalid.";
    }

    if (args.status === "no_match") {
        if (args.debugReason === "no_township_polygons") {
            return "No active township polygons near this road (no_township_polygons).";
        }
        if (args.debugReason === "outside_all_townships") {
            return "No township within distance threshold (outside_all_townships).";
        }
        if (args.debugReason === "query_error") {
            return "Township recommendation failed (query_error).";
        }
        return args.message?.trim() || "No township match found. Review manually.";
    }

    if (args.status === "valid_existing") {
        return "Current township assignment is valid";
    }

    if (args.status === "recommendation_found") {
        if (
            args.currentAdminArea?.id &&
            !isNonTownshipLevel(args.currentAdminArea.level_code)
        ) {
            return "Stored township does not match geometry — recommended township found";
        }
        if (
            args.currentAdminArea?.id &&
            isNonTownshipLevel(args.currentAdminArea.level_code)
        ) {
            const level = args.currentAdminArea.level_code?.trim() || "non-township";
            return `Current assignment is ${level}-level, not township — recommended township found`;
        }
        if (args.recommendationMode === "multi_overlap") {
            return "Road intersects multiple townships — recommended best overlap";
        }
        if (args.recommendationMode === "nearest") {
            return "Nearest township fallback recommendation";
        }
        if (args.recommendationMode === "point_fallback") {
            return "Township recommended from road centerline";
        }
        return "Recommended township found";
    }

    return args.message?.trim() || null;
}

/** Hide geometry recommendation when stored township is already valid. */
export function shouldShowRoadRecommendedTownship(
    status: RoadAdminAreaInferStatus | null,
    recommended: RoadInferRecommendedTownship | null | undefined,
): boolean {
    if (!status || !recommended) {
        return false;
    }
    return status !== "valid_existing";
}

export function shouldShowIntersectingTownshipList(
    status: RoadAdminAreaInferStatus | null,
    intersectingTownships: RoadInferIntersectingTownship[] | null | undefined,
): boolean {
    if (!intersectingTownships?.length) {
        return false;
    }
    return status === "recommendation_found" && intersectingTownships.length > 1;
}

export function formatIntersectingTownshipLine(match: RoadInferIntersectingTownship): string {
    const pct = formatOverlapPct(match.overlap_pct);
    const overlapM = Number.isFinite(match.overlap_m) ? `${Math.round(match.overlap_m)}m` : null;
    const parts = [match.canonical_name];
    if (overlapM) {
        parts.push(`${overlapM} overlap`);
    }
    if (pct) {
        parts.push(`${pct} of road`);
    }
    return parts.join(" · ");
}

export function formatCommonParentContextLine(
    parent: RoadInferCommonParentAdminArea | null | undefined,
): string | null {
    if (!parent?.canonical_name?.trim()) {
        return null;
    }
    const level = parent.admin_level_code?.trim() || "admin area";
    return `Broader area: ${parent.canonical_name} (${level}) — context only, not saved to road`;
}

export function formatNearestFallbackLine(distanceM: number | null | undefined): string | null {
    if (distanceM === null || distanceM === undefined || !Number.isFinite(distanceM)) {
        return null;
    }
    return `Nearest township fallback · ${formatDistanceM(distanceM)} from road`;
}
