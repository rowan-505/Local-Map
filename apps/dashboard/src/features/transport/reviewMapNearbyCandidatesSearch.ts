export type ReviewMapCandidateSearchPoint = {
    readonly lng: number;
    readonly lat: number;
};

export type ReviewMapNearbyCandidatesSearchStatus =
    | "idle"
    | "loading"
    | "success"
    | "empty"
    | "error";

export type ReviewMapNearbyCandidateSearchCenterSource = "map-click" | "saved";

const COORD_EPSILON = 1e-7;

export function coordsNearlyEqual(
    a: ReviewMapCandidateSearchPoint | null | undefined,
    b: ReviewMapCandidateSearchPoint | null | undefined,
): boolean {
    if (!a || !b) {
        return false;
    }
    return (
        Math.abs(a.lng - b.lng) < COORD_EPSILON && Math.abs(a.lat - b.lat) < COORD_EPSILON
    );
}

/** Search center priority: manual map click → saved DB geom. */
export function resolveReviewMapNearbySearchCenter(input: {
    readonly manualClickCoords: ReviewMapCandidateSearchPoint | null;
    readonly savedCoords: ReviewMapCandidateSearchPoint | null;
}): {
    center: ReviewMapCandidateSearchPoint | null;
    source: ReviewMapNearbyCandidateSearchCenterSource | null;
} {
    if (input.manualClickCoords) {
        return { center: input.manualClickCoords, source: "map-click" };
    }
    if (input.savedCoords) {
        return { center: input.savedCoords, source: "saved" };
    }
    return { center: null, source: null };
}
