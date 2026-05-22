import type { PrismaClient } from "@prisma/client";

import {
    ImportReviewCandidateNotFoundError,
    ImportReviewDecisionRuleError,
} from "./import-review-errors.js";
import { ImportReviewAddressMatchesRepository } from "./import-review-address-matches.repo.js";
import type { PatchImportReviewAddressMatchesBody } from "./import-review-address-matches.schema.js";
import {
    rankBuildingMatches,
    rankPlaceMatches,
} from "./import-review-address-place-match.js";
import {
    deriveAddressSourceContextFromCandidate,
    sourceContextNameTexts,
} from "./import-review-address-source-context.js";
import { rankStreetMatches } from "./import-review-address-street-match.js";

const NEAR_RADIUS_M = 300;
const FALLBACK_RADIUS_M = 1000;
const STREET_CANDIDATE_LIMIT = 50;
const PLACE_RADIUS_M = 100;
const PLACE_CANDIDATE_LIMIT = 50;

export type ImportReviewAddressOptionsResponse = {
    address_candidate_id: string;
    streets: Array<{
        id: string;
        canonical_name: string;
        name_en: string | null;
        name_my: string | null;
        name_und: string | null;
        distance_m: number;
        match_score: number;
        match_method: string;
    }>;
    adminAreas: Array<{
        id: string;
        canonical_name: string;
        name_en: string | null;
        name_my: string | null;
        admin_level_code: string;
        boundary_status: string | null;
        address_usage: string | null;
        distance_m: number | null;
        match_score: number;
        match_method: string;
    }>;
    postcodes: Array<{
        value: string;
        language_code: string | null;
        source: string;
    }>;
    buildings: Array<{
        id: string;
        label: string;
        building_type: string | null;
        distance_m: number;
        match_score: number;
        match_method: string;
    }>;
    places: Array<{
        id: string;
        display_name: string;
        name_en: string | null;
        name_my: string | null;
        category: string | null;
        distance_m: number;
        match_score: number;
        match_method: string;
    }>;
};

export type ImportReviewAddressMatchesPatchResponse = {
    address_candidate_id: string;
    matched_street_id: string | null;
    matched_admin_area_id: string | null;
    matched_building_id: string | null;
    matched_place_id: string | null;
    street_match_type: string | null;
    street_match_confidence: number | null;
    street_components_synced: Array<{
        language_code: string;
        action: "inserted" | "updated" | "skipped";
    }>;
};

function bigStr(value: bigint): string {
    return value.toString();
}

function logOptionsStepFailure(candidateId: bigint, step: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
        `[import-review address options] candidate_id=${candidateId.toString()} step=${step} failed: ${message}`
    );
}

export function createImportReviewAddressMatchesService(prisma: PrismaClient) {
    const repo = new ImportReviewAddressMatchesRepository(prisma);

    return {
        async getOptions(candidateId: bigint): Promise<ImportReviewAddressOptionsResponse> {
            const ctx = await repo.getCandidateContext(candidateId);
            if (ctx === null) {
                throw new ImportReviewCandidateNotFoundError(
                    "addresses",
                    candidateId.toString(),
                    "id"
                );
            }

            let sourceTexts: string[] = [];
            try {
                sourceTexts = await repo.listStreetSourceTexts(candidateId);
            } catch (error) {
                logOptionsStepFailure(candidateId, "street_source_texts", error);
            }

            let postcodes: ImportReviewAddressOptionsResponse["postcodes"] = [];
            try {
                const rows = await repo.listPostcodeOptions(candidateId);
                postcodes = rows.map((p) => ({
                    value: p.value,
                    language_code: p.language_code,
                    source: p.source,
                }));
            } catch (error) {
                logOptionsStepFailure(candidateId, "postcodes", error);
            }

            let streets: ImportReviewAddressOptionsResponse["streets"] = [];
            let searchRadiusM = NEAR_RADIUS_M;

            if (ctx.has_point_geom) {
                try {
                    let nearby = await repo.listNearbyStreets({
                        candidateId,
                        radiusM: NEAR_RADIUS_M,
                        limit: STREET_CANDIDATE_LIMIT,
                    });
                    if (nearby.length === 0) {
                        nearby = await repo.listNearbyStreets({
                            candidateId,
                            radiusM: FALLBACK_RADIUS_M,
                            limit: STREET_CANDIDATE_LIMIT,
                        });
                        searchRadiusM = FALLBACK_RADIUS_M;
                    }

                    const ranked = rankStreetMatches(
                        nearby.map((s) => ({
                            id: s.id,
                            canonical_name: s.canonical_name,
                            name_en: s.name_en,
                            name_my: s.name_my,
                            name_und: s.name_und,
                            admin_area_id: s.admin_area_id,
                            distance_m: Number(s.distance_m),
                        })),
                        sourceTexts,
                        ctx.matched_admin_area_id,
                        searchRadiusM,
                        10
                    );

                    streets = ranked.map((s) => ({
                        id: bigStr(s.id),
                        canonical_name: s.canonical_name,
                        name_en: s.name_en,
                        name_my: s.name_my,
                        name_und: s.name_und,
                        distance_m: Math.round(s.distance_m * 10) / 10,
                        match_score: s.match_score,
                        match_method:
                            ctx.matched_street_id !== null && s.id === ctx.matched_street_id
                                ? "matched_current"
                                : s.match_method,
                    }));
                } catch (error) {
                    logOptionsStepFailure(candidateId, "streets", error);
                }
            }

            let adminAreas: ImportReviewAddressOptionsResponse["adminAreas"] = [];
            if (ctx.has_point_geom) {
                try {
                    const adminRows = await repo.listAdminAreaOptions({
                        candidateId,
                        matchedAdminAreaId: ctx.matched_admin_area_id,
                        limit: 15,
                    });
                    adminAreas = adminRows.map((a) => ({
                        id: bigStr(a.id),
                        canonical_name: a.canonical_name,
                        name_en: a.name_en,
                        name_my: a.name_my,
                        admin_level_code: a.admin_level_code,
                        boundary_status: a.boundary_status,
                        address_usage: a.address_usage,
                        distance_m: a.distance_m,
                        match_score: Number(a.match_score),
                        match_method: a.match_method,
                    }));
                } catch (error) {
                    logOptionsStepFailure(candidateId, "adminAreas", error);
                }
            }

            let buildings: ImportReviewAddressOptionsResponse["buildings"] = [];
            let places: ImportReviewAddressOptionsResponse["places"] = [];

            if (ctx.has_point_geom) {
                const sourceCtx = deriveAddressSourceContextFromCandidate({
                    source_tags: ctx.source_tags,
                    normalized_data: ctx.normalized_data,
                    source_refs: ctx.source_refs,
                });
                const placeNameTexts = sourceContextNameTexts(sourceCtx);

                try {
                    const buildingRows = await repo.listBuildingOptions(candidateId);
                    const rankedBuildings = rankBuildingMatches(
                        buildingRows.map((b) => ({
                            id: b.id,
                            label: b.label,
                            building_type: b.building_type,
                            distance_m: Number(b.distance_m),
                            match_method: b.match_method,
                        })),
                        ctx.matched_building_id
                    );
                    buildings = rankedBuildings.map((b) => ({
                        id: bigStr(b.id),
                        label: b.label,
                        building_type: b.building_type,
                        distance_m: Math.round(b.distance_m * 10) / 10,
                        match_score: b.match_score,
                        match_method:
                            ctx.matched_building_id !== null && b.id === ctx.matched_building_id
                                ? "matched_current"
                                : b.match_method,
                    }));
                } catch (error) {
                    logOptionsStepFailure(candidateId, "buildings", error);
                }

                try {
                    const placeRows = await repo.listPlaceOptions(
                        candidateId,
                        PLACE_RADIUS_M,
                        PLACE_CANDIDATE_LIMIT
                    );
                    const rankedPlaces = rankPlaceMatches(
                        placeRows.map((p) => ({
                            id: p.id,
                            display_name: p.display_name,
                            name_en: p.name_en,
                            name_my: p.name_my,
                            category: p.category,
                            distance_m: Number(p.distance_m),
                        })),
                        placeNameTexts,
                        PLACE_RADIUS_M
                    );
                    places = rankedPlaces.map((p) => ({
                        id: bigStr(p.id),
                        display_name: p.display_name,
                        name_en: p.name_en,
                        name_my: p.name_my,
                        category: p.category,
                        distance_m: Math.round(p.distance_m * 10) / 10,
                        match_score: p.match_score,
                        match_method:
                            ctx.matched_place_id !== null && p.id === ctx.matched_place_id
                                ? "matched_current"
                                : p.match_method,
                    }));
                } catch (error) {
                    logOptionsStepFailure(candidateId, "places", error);
                }
            }

            return {
                address_candidate_id: bigStr(candidateId),
                streets,
                adminAreas,
                postcodes,
                buildings,
                places,
            };
        },

        async patchMatches(
            candidateId: bigint,
            body: PatchImportReviewAddressMatchesBody
        ): Promise<ImportReviewAddressMatchesPatchResponse> {
            const ctx = await repo.getCandidateContext(candidateId);
            if (ctx === null) {
                throw new ImportReviewCandidateNotFoundError(
                    "addresses",
                    candidateId.toString(),
                    "id"
                );
            }

            const hasAnyField =
                body.matched_street_id !== undefined ||
                body.matched_admin_area_id !== undefined ||
                body.matched_building_id !== undefined ||
                body.matched_place_id !== undefined;

            if (!hasAnyField) {
                throw new ImportReviewDecisionRuleError(
                    "Provide at least one of matched_street_id, matched_admin_area_id, matched_building_id, matched_place_id"
                );
            }

            if (body.matched_street_id !== undefined && body.matched_street_id !== null) {
                const street = await repo.getActiveStreetById(body.matched_street_id);
                if (street === null) {
                    throw new ImportReviewDecisionRuleError(
                        `Unknown or inactive matched_street_id=${body.matched_street_id.toString()}`
                    );
                }
            }

            if (body.matched_admin_area_id !== undefined && body.matched_admin_area_id !== null) {
                const admin = await repo.getActiveAdminAreaById(body.matched_admin_area_id);
                if (admin === null) {
                    throw new ImportReviewDecisionRuleError(
                        `Unknown or inactive matched_admin_area_id=${body.matched_admin_area_id.toString()}`
                    );
                }
            }

            if (body.matched_building_id !== undefined && body.matched_building_id !== null) {
                const building = await repo.getActiveBuildingById(body.matched_building_id);
                if (building === null) {
                    throw new ImportReviewDecisionRuleError(
                        `Unknown or inactive matched_building_id=${body.matched_building_id.toString()}`
                    );
                }
            }

            if (body.matched_place_id !== undefined && body.matched_place_id !== null) {
                const place = await repo.getActivePlaceById(body.matched_place_id);
                if (place === null) {
                    throw new ImportReviewDecisionRuleError(
                        `Unknown or inactive matched_place_id=${body.matched_place_id.toString()}`
                    );
                }
            }

            let streetMatchType: string | null | undefined;
            let streetMatchConfidence: number | null | undefined;

            if (body.matched_street_id !== undefined) {
                if (body.matched_street_id === null) {
                    streetMatchType = null;
                    streetMatchConfidence = null;
                } else {
                    streetMatchType = "selected_street_match";
                    streetMatchConfidence = body.street_match_confidence ?? 90;
                }
            } else if (body.street_match_confidence !== undefined) {
                streetMatchConfidence = body.street_match_confidence;
            }

            await repo.updateCandidateMatches(candidateId, {
                ...(body.matched_street_id !== undefined
                    ? { matched_street_id: body.matched_street_id }
                    : {}),
                ...(body.matched_admin_area_id !== undefined
                    ? { matched_admin_area_id: body.matched_admin_area_id }
                    : {}),
                ...(body.matched_building_id !== undefined
                    ? { matched_building_id: body.matched_building_id }
                    : {}),
                ...(body.matched_place_id !== undefined
                    ? { matched_place_id: body.matched_place_id }
                    : {}),
                ...(streetMatchType !== undefined ? { street_match_type: streetMatchType } : {}),
                ...(streetMatchConfidence !== undefined
                    ? { street_match_confidence: streetMatchConfidence }
                    : {}),
            });

            const streetComponentsSynced: ImportReviewAddressMatchesPatchResponse["street_components_synced"] =
                [];

            if (body.matched_street_id !== undefined && body.matched_street_id !== null) {
                const names = await repo.listStreetNamesForSync(body.matched_street_id);
                if (names !== null) {
                    const confidence = body.street_match_confidence ?? 90;
                    const replaceReviewed = body.replace_reviewed_street_components === true;
                    const matchType = "selected_street_match";

                    const lines: Array<{ language_code: string; value: string | null }> = [
                        { language_code: "en", value: names.name_en },
                        { language_code: "my", value: names.name_my },
                        {
                            language_code: "und",
                            value:
                                names.name_und ??
                                (names.name_en === null && names.name_my === null
                                    ? names.canonical_name
                                    : null),
                        },
                    ];

                    for (const line of lines) {
                        if (line.value === null || line.value.trim() === "") {
                            continue;
                        }
                        const action = await repo.upsertInferredStreetComponent({
                            candidateId,
                            languageCode: line.language_code,
                            componentValue: line.value.trim(),
                            matchType,
                            confidenceScore: confidence,
                            streetId: body.matched_street_id,
                            replaceReviewed,
                        });
                        streetComponentsSynced.push({
                            language_code: line.language_code,
                            action,
                        });
                    }
                }
            }

            const updated = await repo.getCandidateContext(candidateId);
            const meta = await repo.getCandidateMatchMeta(candidateId);

            return {
                address_candidate_id: bigStr(candidateId),
                matched_street_id:
                    updated?.matched_street_id != null
                        ? bigStr(updated.matched_street_id)
                        : null,
                matched_admin_area_id:
                    updated?.matched_admin_area_id != null
                        ? bigStr(updated.matched_admin_area_id)
                        : null,
                matched_building_id:
                    updated?.matched_building_id != null
                        ? bigStr(updated.matched_building_id)
                        : null,
                matched_place_id:
                    updated?.matched_place_id != null ? bigStr(updated.matched_place_id) : null,
                street_match_type: meta?.street_match_type ?? null,
                street_match_confidence: meta?.street_match_confidence ?? null,
                street_components_synced: streetComponentsSynced,
            };
        },
    };
}
