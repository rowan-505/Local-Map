import { bestStreetNameSimilarity, computeStreetMatchScore } from "./import-review-address-street-match.js";

export type BuildingMatchCandidate = {
    id: bigint;
    label: string;
    building_type: string | null;
    distance_m: number;
    match_method: string;
};

export type PlaceMatchCandidate = {
    id: bigint;
    display_name: string;
    name_en: string | null;
    name_my: string | null;
    category: string | null;
    distance_m: number;
};

export function rankPlaceMatches(
    places: readonly PlaceMatchCandidate[],
    sourceNameTexts: readonly string[],
    searchRadiusM: number,
    limit = 15
): Array<PlaceMatchCandidate & { match_score: number; match_method: string }> {
    const ranked = places.map((place) => {
        const nameSimilarity = bestStreetNameSimilarity(sourceNameTexts, {
            canonical_name: place.display_name,
            name_en: place.name_en,
            name_my: place.name_my,
            name_und: place.display_name,
        });
        const scored = computeStreetMatchScore({
            nameSimilarity,
            distanceM: place.distance_m,
            searchRadiusM,
            sameAdminArea: false,
        });
        let match_method = scored.match_method;
        let match_score = scored.match_score;

        if (place.distance_m <= 1) {
            match_score = Math.min(100, match_score + 8);
            if (!match_method.includes("contains")) {
                match_method = place.distance_m < 0.5 ? "point_contains" : match_method;
            }
        }

        return {
            ...place,
            match_score,
            match_method,
        };
    });

    ranked.sort((a, b) => {
        if (b.match_score !== a.match_score) {
            return b.match_score - a.match_score;
        }
        return a.distance_m - b.distance_m;
    });

    return ranked.slice(0, limit);
}

export function rankBuildingMatches(
    buildings: readonly BuildingMatchCandidate[],
    matchedBuildingId: bigint | null,
    limit = 15
): Array<BuildingMatchCandidate & { match_score: number; match_method: string }> {
    const ranked = buildings.map((b) => {
        let match_score: number;
        let match_method = b.match_method;
        if (b.distance_m <= 0.5) {
            match_score = 98;
            match_method = "point_contains";
        } else {
            match_score = Math.max(40, Math.round(85 - b.distance_m));
            match_method = "distance_50m";
        }
        if (matchedBuildingId !== null && b.id === matchedBuildingId) {
            match_method = "matched_current";
        }
        return { ...b, match_score, match_method };
    });

    ranked.sort((a, b) => {
        if (b.match_score !== a.match_score) {
            return b.match_score - a.match_score;
        }
        return a.distance_m - b.distance_m;
    });

    return ranked.slice(0, limit);
}
