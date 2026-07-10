import assert from "node:assert/strict";

import { compareUnifiedSearchSortKeys, publicSearchCursorAfterFromRow } from "./public-search-cursor.js";
import { planPublicSearch } from "./public-map.service.js";
import type { ResolvedPublicSearchFilters } from "./public-search-filters.js";
import {
    explainUnifiedSearchScore,
    type UnifiedSearchRankingDocument,
    type UnifiedSearchRankingMode,
} from "./public-search-ranking.js";

/** One synthetic indexed row in a golden scenario. */
export type GoldenSearchCandidate = {
    /** Stable id for assertions (not the production entity id). */
    id: string;
    entityType: string;
    entityId: string;
    displayName: string;
    importanceScore?: number;
    stopType?: string | null;
    transportMode?: string | null;
    /** Simulates inactive / ghost rows removed by `is_active` / `is_public` SQL filters. */
    excludedFromResults?: boolean;
    doc: UnifiedSearchRankingDocument;
};

export type GoldenSearchExpectation = {
    /** Entity ids that must appear within the first `topN` ranks (1-based). */
    requiredInTop?: Array<{ id: string; topN?: number }>;
    /** Entity ids that must not appear anywhere in ranked results. */
    forbiddenIds?: string[];
    /** Winner must rank above loser. */
    outranks?: Array<{ winnerId: string; loserId: string }>;
    /** Minimum number of eligible ranked rows. */
    minEligible?: number;
    /** Maximum number of eligible ranked rows. */
    maxEligible?: number;
    /** Minimum final score for a specific candidate (use sparingly). */
    minFinalScore?: Array<{ id: string; min: number }>;
};

export type GoldenSearchQueryScenario = {
    name: string;
    query: string;
    mode?: UnifiedSearchRankingMode;
    candidates: readonly GoldenSearchCandidate[];
    expect: GoldenSearchExpectation;
    notes?: string;
};

export type RankedGoldenSearchResult = {
    id: string;
    entityType: string;
    entityId: string;
    displayName: string;
    finalScore: number;
    importanceScore: number;
};

function normalizeGoldenQuery(query: string): string {
    return query.trim().toLowerCase();
}

export function resolveGoldenSearchMode(
    query: string,
    override?: UnifiedSearchRankingMode,
): UnifiedSearchRankingMode {
    if (override) {
        return override;
    }
    const plan = planPublicSearch(query);
    assert.equal(plan.allowed, true, `query blocked by planPublicSearch: ${query}`);
    return plan.mode;
}

export function candidatePassesGoldenSearchFilters(
    candidate: GoldenSearchCandidate,
    filters: ResolvedPublicSearchFilters,
): boolean {
    const entityType = candidate.entityType.trim().toLowerCase();
    if (!filters.expandedEntityTypes.includes(entityType)) {
        return false;
    }

    if (filters.transportStopTypes && filters.transportStopTypes.length > 0) {
        const stopType = (candidate.stopType ?? "").trim().toLowerCase();
        if (
            (entityType === "transport_stop" || entityType === "bus_stop") &&
            !filters.transportStopTypes.includes(stopType)
        ) {
            return false;
        }
    }

    if (filters.transportModeFilter) {
        const mode = (candidate.transportMode ?? "").trim().toLowerCase();
        if (
            (entityType === "transport_route" ||
                entityType === "transport_route_variant" ||
                entityType === "bus_route" ||
                entityType === "bus_route_variant") &&
            mode.length > 0 &&
            mode !== filters.transportModeFilter
        ) {
            return false;
        }
    }

    return true;
}

export function rankGoldenSearchCandidates(
    query: string,
    candidates: readonly GoldenSearchCandidate[],
    options: {
        mode?: UnifiedSearchRankingMode;
        filters?: ResolvedPublicSearchFilters;
    } = {},
): RankedGoldenSearchResult[] {
    const qNorm = normalizeGoldenQuery(query);
    const mode = resolveGoldenSearchMode(query, options.mode);
    const filters = options.filters;

    const ranked: RankedGoldenSearchResult[] = [];

    for (const candidate of candidates) {
        if (candidate.excludedFromResults) {
            continue;
        }
        if (filters && !candidatePassesGoldenSearchFilters(candidate, filters)) {
            continue;
        }

        const explanation = explainUnifiedSearchScore(qNorm, mode, candidate.doc);
        if (!explanation) {
            continue;
        }

        ranked.push({
            id: candidate.id,
            entityType: candidate.entityType,
            entityId: candidate.entityId,
            displayName: candidate.displayName,
            finalScore: explanation.finalScore,
            importanceScore: candidate.importanceScore ?? candidate.doc.importanceScore ?? 0,
        });
    }

    const bestByEntityKey = new Map<string, RankedGoldenSearchResult>();
    for (const row of ranked) {
        const key = `${row.entityType}:${row.entityId}`;
        const existing = bestByEntityKey.get(key);
        if (!existing || row.finalScore > existing.finalScore) {
            bestByEntityKey.set(key, row);
        }
    }

    const deduped = [...bestByEntityKey.values()];

    deduped.sort((left, right) => {
        const cmp = compareUnifiedSearchSortKeys(
            publicSearchCursorAfterFromRow({
                score: left.finalScore,
                importance_score: left.importanceScore,
                display_name: left.displayName,
                entity_type: left.entityType,
                entity_id: left.entityId,
            }),
            publicSearchCursorAfterFromRow({
                score: right.finalScore,
                importance_score: right.importanceScore,
                display_name: right.displayName,
                entity_type: right.entityType,
                entity_id: right.entityId,
            }),
        );
        return cmp;
    });

    return deduped;
}

export function assertNoDuplicateGoldenResultIds(results: readonly RankedGoldenSearchResult[]): void {
    const seen = new Set<string>();
    for (const row of results) {
        const key = `${row.entityType}:${row.entityId}`;
        assert.equal(seen.has(key), false, `duplicate result id ${key}`);
        seen.add(key);
    }
}

export function assertGoldenSearchScenario(scenario: GoldenSearchQueryScenario): RankedGoldenSearchResult[] {
    const results = rankGoldenSearchCandidates(scenario.query, scenario.candidates, {
        mode: scenario.mode,
    });

    assertNoDuplicateGoldenResultIds(results);

    for (const rule of scenario.expect.requiredInTop ?? []) {
        const topN = rule.topN ?? 3;
        const index = results.findIndex((row) => row.id === rule.id);
        assert.ok(
            index >= 0 && index < topN,
            `${scenario.name}: expected ${rule.id} in top ${topN}, got rank ${index < 0 ? "absent" : index + 1}`,
        );
    }

    for (const forbiddenId of scenario.expect.forbiddenIds ?? []) {
        assert.equal(
            results.some((row) => row.id === forbiddenId),
            false,
            `${scenario.name}: forbidden id present: ${forbiddenId}`,
        );
    }

    for (const pair of scenario.expect.outranks ?? []) {
        const winnerIndex = results.findIndex((row) => row.id === pair.winnerId);
        const loserIndex = results.findIndex((row) => row.id === pair.loserId);
        assert.ok(winnerIndex >= 0, `${scenario.name}: winner missing: ${pair.winnerId}`);
        assert.ok(loserIndex >= 0, `${scenario.name}: loser missing: ${pair.loserId}`);
        assert.ok(
            winnerIndex < loserIndex,
            `${scenario.name}: expected ${pair.winnerId} above ${pair.loserId}`,
        );
    }

    if (scenario.expect.minEligible != null) {
        assert.ok(
            results.length >= scenario.expect.minEligible,
            `${scenario.name}: expected at least ${scenario.expect.minEligible} eligible results`,
        );
    }

    if (scenario.expect.maxEligible != null) {
        assert.ok(
            results.length <= scenario.expect.maxEligible,
            `${scenario.name}: expected at most ${scenario.expect.maxEligible} eligible results`,
        );
    }

    for (const minRule of scenario.expect.minFinalScore ?? []) {
        const row = results.find((candidate) => candidate.id === minRule.id);
        assert.ok(row, `${scenario.name}: min score target missing: ${minRule.id}`);
        assert.ok(
            (row?.finalScore ?? 0) >= minRule.min,
            `${scenario.name}: ${minRule.id} score ${row?.finalScore} < ${minRule.min}`,
        );
    }

    return results;
}
