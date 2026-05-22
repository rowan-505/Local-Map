export type StreetMatchCandidate = {
    id: bigint;
    canonical_name: string;
    name_en: string | null;
    name_my: string | null;
    name_und: string | null;
    admin_area_id: bigint | null;
    distance_m: number;
};

export function normalizeStreetMatchText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function streetNameSimilarity(a: string, b: string): number {
    const left = normalizeStreetMatchText(a);
    const right = normalizeStreetMatchText(b);
    if (left === "" || right === "") {
        return 0;
    }
    if (left === right) {
        return 1;
    }
    if (left.includes(right) || right.includes(left)) {
        return 0.88;
    }

    const leftTokens = new Set(left.split(/\s+/).filter((t) => t.length > 0));
    const rightTokens = new Set(right.split(/\s+/).filter((t) => t.length > 0));
    let intersection = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) {
            intersection += 1;
        }
    }
    const union = leftTokens.size + rightTokens.size - intersection;
    return union > 0 ? intersection / union : 0;
}

export function bestStreetNameSimilarity(
    sourceTexts: readonly string[],
    street: Pick<StreetMatchCandidate, "canonical_name" | "name_en" | "name_my" | "name_und">
): number {
    const targets = [
        street.canonical_name,
        street.name_en,
        street.name_my,
        street.name_und,
    ].filter((v): v is string => typeof v === "string" && v.trim() !== "");

    let best = 0;
    for (const source of sourceTexts) {
        for (const target of targets) {
            best = Math.max(best, streetNameSimilarity(source, target));
        }
    }
    return best;
}

export function computeStreetMatchScore(args: {
    nameSimilarity: number;
    distanceM: number;
    searchRadiusM: number;
    sameAdminArea: boolean;
}): { match_score: number; match_method: string } {
    const distScore = Math.max(0, 1 - args.distanceM / Math.max(args.searchRadiusM, 1));
    const name = args.nameSimilarity;

    let score: number;
    let method: string;

    if (name >= 0.85 && distScore >= 0.5) {
        score = Math.round(85 + Math.min(10, name * 6 + distScore * 4));
        method = "name_and_distance";
    } else if (name >= 0.5 && distScore >= 0.35) {
        score = Math.round(60 + distScore * 12 + name * 10);
        method = "name_and_distance";
    } else if (distScore >= 0.25) {
        score = Math.round(55 + distScore * 20);
        method = "distance_only";
    } else {
        score = Math.round(25 + name * 30 + distScore * 15);
        method = name >= 0.4 ? "name_similarity" : "distance_only";
    }

    if (args.sameAdminArea) {
        score = Math.min(100, score + 5);
        if (!method.endsWith("_admin_match")) {
            method = `${method}_admin_match`;
        }
    }

    return {
        match_score: Math.min(100, Math.max(0, score)),
        match_method: method,
    };
}

export function rankStreetMatches(
    streets: readonly StreetMatchCandidate[],
    sourceTexts: readonly string[],
    matchedAdminAreaId: bigint | null,
    searchRadiusM: number,
    limit = 10
): Array<StreetMatchCandidate & { match_score: number; match_method: string }> {
    const ranked = streets.map((street) => {
        const nameSimilarity = bestStreetNameSimilarity(sourceTexts, street);
        const sameAdminArea =
            matchedAdminAreaId !== null &&
            street.admin_area_id !== null &&
            street.admin_area_id === matchedAdminAreaId;
        const scored = computeStreetMatchScore({
            nameSimilarity,
            distanceM: street.distance_m,
            searchRadiusM,
            sameAdminArea,
        });
        return {
            ...street,
            match_score: scored.match_score,
            match_method: scored.match_method,
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
