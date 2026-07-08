/**
 * Match a visible route list card to a route index item.
 */

import {
    isTruncatedBadge,
    normalizePublicRouteTitle,
    type RouteIdentityRecord,
} from "./route-identity.js";
import type { ParsedRouteIndexRow } from "./parse-ui-xml.js";

export const MIN_ROUTE_CARD_MATCH_SCORE = 40;

export type RouteCardMatchResult = {
    row: ParsedRouteIndexRow;
    score: number;
    breakdown: {
        display_code: number;
        title: number;
        operator: number;
        raw_text: number;
    };
};

function normalizeText(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

function scoreDisplayCode(
    target: RouteIdentityRecord,
    candidate: ParsedRouteIndexRow,
): number {
    const targetCode = target.route_display_code?.trim() ?? "";
    const candidateCode = candidate.route_display_code?.trim() ?? "";

    if (!targetCode || !candidateCode) {
        return 0;
    }

    if (isTruncatedBadge(targetCode)) {
        const targetPrefix = targetCode.replace(/\.{3}|…$/u, "").trim().toLowerCase();
        if (targetPrefix && candidateCode.toLowerCase().startsWith(targetPrefix)) {
            return 18;
        }
        return 0;
    }

    if (targetCode.toLowerCase() === candidateCode.toLowerCase()) {
        return 40;
    }

    if (candidateCode.toLowerCase().startsWith(targetCode.toLowerCase())) {
        return 28;
    }

    return 0;
}

function scoreTitle(target: RouteIdentityRecord, candidate: ParsedRouteIndexRow): number {
    const targetTitle = target.route_title_my ?? target.route_title_en;
    const candidateTitle = candidate.route_title_my ?? candidate.route_title_en;

    if (!targetTitle || !candidateTitle) {
        return 0;
    }

    const targetNorm = normalizePublicRouteTitle(targetTitle);
    const candidateNorm = normalizePublicRouteTitle(candidateTitle);

    if (targetNorm && candidateNorm && targetNorm === candidateNorm) {
        return 30;
    }

    const targetLower = targetTitle.toLowerCase();
    const candidateLower = candidateTitle.toLowerCase();

    if (targetLower === candidateLower) {
        return 30;
    }

    if (targetLower.includes(candidateLower) || candidateLower.includes(targetLower)) {
        return 22;
    }

    if (targetNorm && candidateNorm) {
        if (targetNorm.includes(candidateNorm) || candidateNorm.includes(targetNorm)) {
            return 20;
        }
    }

    return 0;
}

function scoreOperator(target: RouteIdentityRecord, candidate: ParsedRouteIndexRow): number {
    const targetOperator = normalizeText(target.operator_name);
    const candidateOperator = normalizeText(candidate.operator_name);

    if (!targetOperator || !candidateOperator) {
        return 0;
    }

    return targetOperator === candidateOperator ? 15 : 0;
}

function scoreRawText(target: RouteIdentityRecord, candidate: ParsedRouteIndexRow): number {
    const targetParts = new Set(
        target.raw_card_text.map((part) => part.trim().toLowerCase()).filter(Boolean),
    );
    const candidateParts = new Set(
        candidate.raw_card_text.map((part) => part.trim().toLowerCase()).filter(Boolean),
    );

    if (targetParts.size === 0 || candidateParts.size === 0) {
        return 0;
    }

    let overlap = 0;
    for (const part of targetParts) {
        if (candidateParts.has(part)) {
            overlap++;
        }
    }

    const ratio = overlap / Math.max(targetParts.size, candidateParts.size);
    return Math.round(ratio * 15);
}

/** Score how well one visible card matches a route index item. */
export function scoreRouteCardMatch(
    target: RouteIdentityRecord,
    candidate: ParsedRouteIndexRow,
): RouteCardMatchResult {
    const breakdown = {
        display_code: scoreDisplayCode(target, candidate),
        title: scoreTitle(target, candidate),
        operator: scoreOperator(target, candidate),
        raw_text: scoreRawText(target, candidate),
    };

    return {
        row: candidate,
        score: breakdown.display_code + breakdown.title + breakdown.operator + breakdown.raw_text,
        breakdown,
    };
}

/** Pick the best visible card for a route index item, if any. */
export function findBestRouteCardMatch(
    target: RouteIdentityRecord,
    candidates: ParsedRouteIndexRow[],
    minScore = MIN_ROUTE_CARD_MATCH_SCORE,
): RouteCardMatchResult | null {
    let best: RouteCardMatchResult | null = null;

    for (const candidate of candidates) {
        const result = scoreRouteCardMatch(target, candidate);

        if (result.score < minScore) {
            continue;
        }

        if (!best || result.score > best.score) {
            best = result;
        }
    }

    return best;
}

/** True when a card match is strong enough to stop route-list scrolling. */
export function isConfidentRouteCardMatch(
    result: RouteCardMatchResult,
    minScore = MIN_ROUTE_CARD_MATCH_SCORE,
): boolean {
    if (result.score < minScore) {
        return false;
    }

    if (result.score >= minScore + 10) {
        return true;
    }

    // Exact badge match (APS, 109, descriptive badge text, etc.).
    if (result.breakdown.display_code >= 40) {
        return true;
    }

    if (result.breakdown.title >= 20 && result.breakdown.display_code >= 18) {
        return true;
    }

    return false;
}

/** Pick the best visible card across duplicate index rows for one route code. */
export function findBestRouteCardMatchAmongTargets(
    targets: RouteIdentityRecord[],
    candidates: ParsedRouteIndexRow[],
    minScore = MIN_ROUTE_CARD_MATCH_SCORE,
): RouteCardMatchResult | null {
    let best: RouteCardMatchResult | null = null;

    for (const target of targets) {
        const match = findBestRouteCardMatch(target, candidates, minScore);
        if (match && (!best || match.score > best.score)) {
            best = match;
        }
    }

    return best;
}
