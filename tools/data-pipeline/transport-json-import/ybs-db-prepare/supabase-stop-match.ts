/**
 * Read-only Supabase stop matching for Phase 6 YBS stop resolution.
 *
 * SELECT queries only. No inserts, updates, or deletes.
 */

import pg from "pg";

import {
    areasAreCompatible,
    buildBoardingSideKey,
    buildBoardingSideKeyFromFields,
    buildSourceExternalId,
    buildStopPlaceKey,
    canSafelyReuseByIdentity,
    extractAreaFromNormalizedData,
    extractBoardingSideKeyFromNormalizedData,
    extractSideGroupFromNormalizedData,
    hasCleanMatchingName,
    hasStrongNameMatch,
    isAmbiguousGenericStop,
    isExplicitSharedTerminal,
    normalizeStopMatchingFields,
    resolveSideGroup,
    sideGroupsAreCompatible,
    type NormalizedStopMatchingFields,
    type SideGroup,
    type StopMatchConfidenceReason,
    YBS_STOP_SOURCE_KIND,
    YBS_STOP_SOURCE_NAME,
} from "./stop-normalize.js";
import { isProtectedReviewStatus } from "../ybs-supabase-import/supabase-schema-map.js";

export type StopMatchDecision =
    | "reuse_existing_stop"
    | "create_new_stop"
    | "merge_additional_data_to_existing"
    | "needs_manual_review"
    | "dashboard_review_required"
    | "blocked_conflict"
    | "blocked_missing_clean_name";

export type StopMatchMethod =
    | "exact_source_link"
    | "exact_boarding_side_key"
    | "exact_name_area_side"
    | "reviewed_stop_match"
    | "uncertain_created_separate_stop"
    | "legacy_place_key_source_link"
    | "exact_name_mm_en_with_compatible_area"
    | "exact_name_my_with_compatible_area"
    | "exact_name_en_with_compatible_area"
    | "name_only_match"
    | "opposite_direction_reuse_prevented";

export type ExistingStopNameRow = {
    stop_id: number;
    name: string;
    language_code: string;
    is_primary: boolean;
};

export type ExistingSourceLinkRow = {
    entity_id: number;
    source_name: string;
    source_kind: string;
    external_id: string;
    source_payload: Record<string, unknown> | null;
};

export type ExistingStopRecord = {
    id: number;
    public_id: string;
    stop_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    review_status: string;
    normalized_data: Record<string, unknown> | null;
    source_refs: Record<string, unknown> | null;
    normalized_fields: NormalizedStopMatchingFields;
    stop_place_key: string;
    boarding_side_key: string | null;
    side_group: SideGroup | null;
    lng: number | null;
    lat: number | null;
    has_geom: boolean;
};

export type StopCandidateForMatch = {
    candidate_id: string;
    candidate_key: string;
    stop_place_key?: string;
    boarding_stop_key?: string;
    boarding_side_key?: string;
    side_group?: SideGroup;
    direction_key?: string;
    primary_name_my: string | null;
    primary_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    normalized_fields: NormalizedStopMatchingFields;
    usage_count: number;
    shared_terminal?: boolean;
    source_external_ids?: string[];
};

export type StopMergeAction =
    | "add_source_link"
    | "fill_missing_name_mm"
    | "fill_missing_name_en"
    | "add_stop_name_row"
    | "append_normalized_data_ybs_go"
    | "reuse_without_content_changes"
    | "conflict_warning_only";

export type StopMatchResult = {
    decision: StopMatchDecision;
    match_method: StopMatchMethod | null;
    match_confidence_reason: StopMatchConfidenceReason | null;
    matched_stop_id: number | null;
    matched_public_id: string | null;
    matched_review_status: string | null;
    merge_actions: StopMergeAction[];
    warnings: string[];
    blocking_reasons: string[];
    possible_duplicate_stop_ids: number[];
};

export type ExistingStopCatalog = {
    loaded_at: string;
    database_url_host: string | null;
    stops: ExistingStopRecord[];
    stops_by_boarding_side_key: Map<string, ExistingStopRecord[]>;
    stops_by_stop_place_key: Map<string, ExistingStopRecord[]>;
    source_link_by_external_id: Map<string, ExistingSourceLinkRow>;
    source_link_by_stop_id: Map<number, ExistingSourceLinkRow[]>;
};

const PROTECTED_REVIEW_STATUSES = new Set(["reviewed", "verified", "manual_protected"]);
const MERGEABLE_REVIEW_STATUSES = new Set(["imported_unreviewed", "needs_review"]);

function trimToNull(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function isRejectedReviewStatus(reviewStatus: string): boolean {
    return reviewStatus === "rejected";
}

function stopNameRowsToFields(
    stop: {
        name_mm: string | null;
        name_en: string | null;
        normalized_data: Record<string, unknown> | null;
    },
    names: ExistingStopNameRow[],
): NormalizedStopMatchingFields {
    const myFromNames = names.find((row) => row.language_code.toLowerCase() === "my")?.name ?? null;
    const enFromNames = names.find((row) => row.language_code.toLowerCase() === "en")?.name ?? null;
    const area = extractAreaFromNormalizedData(stop.normalized_data);

    return normalizeStopMatchingFields({
        stop_name_my: trimToNull(stop.name_mm) ?? trimToNull(myFromNames),
        stop_name_en: trimToNull(stop.name_en) ?? trimToNull(enFromNames),
        area_text_my: area.area_text_my,
        area_text_en: area.area_text_en,
    });
}

function enrichExistingStopRecord(
    row: {
        id: number;
        public_id: string;
        stop_code: string | null;
        name: string;
        name_mm: string | null;
        name_en: string | null;
        review_status: string;
        normalized_data: Record<string, unknown> | null;
        source_refs: Record<string, unknown> | null;
        lng: number | null;
        lat: number | null;
        has_geom: boolean;
    },
    names: ExistingStopNameRow[],
): ExistingStopRecord {
    const normalized_fields = stopNameRowsToFields(row, names);
    const stop_place_key =
        (typeof row.normalized_data?.stop_place_key === "string" && row.normalized_data.stop_place_key) ||
        buildStopPlaceKey(normalized_fields);
    const side_group = extractSideGroupFromNormalizedData(row.normalized_data);
    const boarding_side_key = extractBoardingSideKeyFromNormalizedData(
        row.normalized_data,
        normalized_fields,
    );

    return {
        ...row,
        normalized_fields,
        stop_place_key,
        boarding_side_key,
        side_group,
    };
}

function candidateSideGroup(candidate: StopCandidateForMatch): SideGroup {
    if (candidate.side_group) {
        return candidate.side_group;
    }
    return resolveSideGroup(candidate.direction_key ?? "unknown", candidate.shared_terminal === true);
}

function candidateBoardingSideKey(candidate: StopCandidateForMatch): string {
    if (candidate.boarding_side_key) {
        return candidate.boarding_side_key;
    }
    return buildBoardingSideKeyFromFields(
        candidate.normalized_fields,
        candidate.direction_key ?? "unknown",
        candidate.shared_terminal === true,
    );
}

function candidateStopPlaceKey(candidate: StopCandidateForMatch): string {
    return candidate.stop_place_key ?? buildStopPlaceKey(candidate.normalized_fields);
}

function stopSideGroup(existing: ExistingStopRecord): SideGroup {
    if (existing.side_group) {
        return existing.side_group;
    }
    return "unknown";
}

function sidesAreCompatible(
    candidate: StopCandidateForMatch,
    existing: ExistingStopRecord,
): boolean {
    const left = candidateSideGroup(candidate);
    const right = stopSideGroup(existing);
    return sideGroupsAreCompatible(left, right, {
        allowSharedTerminal:
            candidate.shared_terminal === true ||
            isExplicitSharedTerminal(existing.normalized_data),
    });
}

function isEligibleExistingStop(existing: ExistingStopRecord): boolean {
    return !isRejectedReviewStatus(existing.review_status);
}

function passesStrictReuseGate(
    candidate: StopCandidateForMatch,
    existing: ExistingStopRecord,
): boolean {
    return canSafelyReuseByIdentity({
        candidateFields: candidate.normalized_fields,
        existingFields: existing.normalized_fields,
        candidateSideGroup: candidateSideGroup(candidate),
        existingSideGroup: stopSideGroup(existing),
        allowSharedTerminal:
            candidate.shared_terminal === true ||
            isExplicitSharedTerminal(existing.normalized_data),
        existingReviewStatus: existing.review_status,
    }).ok;
}

function filterSafeReuseMatches(
    candidate: StopCandidateForMatch,
    matches: ExistingStopRecord[],
): ExistingStopRecord[] {
    return matches.filter(
        (stop) => isEligibleExistingStop(stop) && passesStrictReuseGate(candidate, stop),
    );
}

function buildMergePlan(
    candidate: StopCandidateForMatch,
    existing: ExistingStopRecord,
    hasContentDifference: boolean,
    matchMethod: StopMatchMethod,
): { merge_actions: StopMergeAction[]; warnings: string[]; decision: StopMatchDecision } {
    const merge_actions: StopMergeAction[] = [];
    const warnings: string[] = [];

    if (PROTECTED_REVIEW_STATUSES.has(existing.review_status)) {
        merge_actions.push("reuse_without_content_changes");
        merge_actions.push("add_source_link");

        if (hasContentDifference) {
            warnings.push(
                `Existing stop ${existing.public_id} is ${existing.review_status}; extracted data differs and will not overwrite.`,
            );
        }

        return {
            merge_actions,
            warnings,
            decision: "reuse_existing_stop",
        };
    }

    if (MERGEABLE_REVIEW_STATUSES.has(existing.review_status)) {
        merge_actions.push("add_source_link");
        merge_actions.push("append_normalized_data_ybs_go");

        if (!existing.name_mm && candidate.primary_name_my) {
            merge_actions.push("fill_missing_name_mm");
        }
        if (!existing.name_en && candidate.primary_name_en) {
            merge_actions.push("fill_missing_name_en");
        }
        if (candidate.primary_name_my) {
            merge_actions.push("add_stop_name_row");
        }
        if (candidate.primary_name_en) {
            merge_actions.push("add_stop_name_row");
        }

        const hasFillActions = merge_actions.some(
            (action) =>
                action === "fill_missing_name_mm" ||
                action === "fill_missing_name_en" ||
                action === "add_stop_name_row",
        );

        return {
            merge_actions,
            warnings,
            decision: hasFillActions ? "merge_additional_data_to_existing" : "reuse_existing_stop",
        };
    }

    merge_actions.push("add_source_link");
    warnings.push(`Existing stop ${existing.public_id} has review_status=${existing.review_status}.`);
    return {
        merge_actions,
        warnings,
        decision: matchMethod === "reviewed_stop_match" ? "reuse_existing_stop" : "needs_manual_review",
    };
}

function hasCandidateContentDifference(
    candidate: StopCandidateForMatch,
    existing: ExistingStopRecord,
): boolean {
    const candidateMy = candidate.normalized_fields.normalized_name_my;
    const candidateEn = candidate.normalized_fields.normalized_name_en;
    const existingMy = existing.normalized_fields.normalized_name_my;
    const existingEn = existing.normalized_fields.normalized_name_en;

    if (candidateMy && existingMy && candidateMy !== existingMy) {
        return true;
    }
    if (candidateEn && existingEn && candidateEn !== existingEn) {
        return true;
    }

    const candidateAreaMy = candidate.normalized_fields.normalized_area_my;
    const candidateAreaEn = candidate.normalized_fields.normalized_area_en;
    const existingAreaMy = existing.normalized_fields.normalized_area_my;
    const existingAreaEn = existing.normalized_fields.normalized_area_en;

    if (candidateAreaMy && existingAreaMy && candidateAreaMy !== existingAreaMy) {
        return true;
    }
    if (candidateAreaEn && existingAreaEn && candidateAreaEn !== existingAreaEn) {
        return true;
    }

    return false;
}

function toMatchResult(
    candidate: StopCandidateForMatch,
    existing: ExistingStopRecord,
    matchMethod: StopMatchMethod,
    matchConfidenceReason: StopMatchConfidenceReason,
    warnings: string[],
    blocking_reasons: string[] = [],
    possible_duplicate_stop_ids: number[] = [],
): StopMatchResult {
    const plan = buildMergePlan(
        candidate,
        existing,
        hasCandidateContentDifference(candidate, existing),
        matchMethod,
    );

    return {
        decision: plan.decision,
        match_method: matchMethod,
        match_confidence_reason: matchConfidenceReason,
        matched_stop_id: existing.id,
        matched_public_id: existing.public_id,
        matched_review_status: existing.review_status,
        merge_actions: plan.merge_actions,
        warnings: [...warnings, ...plan.warnings],
        blocking_reasons,
        possible_duplicate_stop_ids,
    };
}

function buildSourceLinkReuseResult(
    candidate: StopCandidateForMatch,
    existing: ExistingStopRecord,
    warnings: string[],
): StopMatchResult {
    if (isProtectedReviewStatus(existing.review_status)) {
        return {
            decision: "reuse_existing_stop",
            match_method: "exact_source_link",
            match_confidence_reason: "exact_source_link",
            matched_stop_id: existing.id,
            matched_public_id: existing.public_id,
            matched_review_status: existing.review_status,
            merge_actions: ["add_source_link", "reuse_without_content_changes"],
            warnings: [
                ...warnings,
                `Protected stop ${existing.public_id} linked by exact source_link; geometry and primary fields will not change.`,
            ],
            blocking_reasons: [],
            possible_duplicate_stop_ids: [],
        };
    }

    return toMatchResult(candidate, existing, "exact_source_link", "exact_source_link", warnings);
}

function buildManualReviewHoldResult(
    match_method: StopMatchMethod,
    warnings: string[],
    reason: string,
    possible_duplicate_stop_ids: number[] = [],
): StopMatchResult {
    return {
        decision: "dashboard_review_required",
        match_method,
        match_confidence_reason: "uncertain_created_separate_stop",
        matched_stop_id: null,
        matched_public_id: null,
        matched_review_status: null,
        merge_actions: [],
        warnings: [...warnings, "STOP_NEEDS_MANUAL_REVIEW", reason],
        blocking_reasons: [],
        possible_duplicate_stop_ids,
    };
}

function buildUncertainCreateNewResult(
    warnings: string[],
    reason: string,
    possible_duplicate_stop_ids: number[],
): StopMatchResult {
    return {
        decision: "create_new_stop",
        match_method: "uncertain_created_separate_stop",
        match_confidence_reason: "uncertain_created_separate_stop",
        matched_stop_id: null,
        matched_public_id: null,
        matched_review_status: null,
        merge_actions: ["add_source_link", "append_normalized_data_ybs_go", "add_stop_name_row"],
        warnings: [...warnings, "STOP_NEEDS_MANUAL_REVIEW", reason],
        blocking_reasons: [],
        possible_duplicate_stop_ids,
    };
}

function filterSideCompatible(
    candidate: StopCandidateForMatch,
    matches: ExistingStopRecord[],
): ExistingStopRecord[] {
    return filterSafeReuseMatches(candidate, matches);
}

function findBoardingSideKeyMatches(
    candidate: StopCandidateForMatch,
    catalog: ExistingStopCatalog,
): ExistingStopRecord[] {
    const key = candidateBoardingSideKey(candidate);
    const indexed = catalog.stops_by_boarding_side_key.get(key) ?? [];
    return filterSafeReuseMatches(candidate, indexed);
}

function findExactNameAreaSideMatches(
    candidate: StopCandidateForMatch,
    catalog: ExistingStopCatalog,
): ExistingStopRecord[] {
    return catalog.stops.filter(
        (stop) =>
            isEligibleExistingStop(stop) &&
            hasStrongNameMatch(candidate.normalized_fields, stop.normalized_fields) &&
            areasAreCompatible(candidate.normalized_fields, stop.normalized_fields) &&
            passesStrictReuseGate(candidate, stop),
    );
}

function findReviewedStopMatches(
    candidate: StopCandidateForMatch,
    catalog: ExistingStopCatalog,
): ExistingStopRecord[] {
    return catalog.stops.filter(
        (stop) =>
            isEligibleExistingStop(stop) &&
            PROTECTED_REVIEW_STATUSES.has(stop.review_status) &&
            hasStrongNameMatch(candidate.normalized_fields, stop.normalized_fields) &&
            areasAreCompatible(candidate.normalized_fields, stop.normalized_fields) &&
            passesStrictReuseGate(candidate, stop),
    );
}

function findPossibleDuplicateStops(
    candidate: StopCandidateForMatch,
    catalog: ExistingStopCatalog,
): ExistingStopRecord[] {
    const placeKey = candidateStopPlaceKey(candidate);
    const indexed = catalog.stops_by_stop_place_key.get(placeKey) ?? [];
    const merged = new Map<number, ExistingStopRecord>();
    for (const stop of indexed) {
        if (
            hasStrongNameMatch(candidate.normalized_fields, stop.normalized_fields) ||
            stop.stop_place_key === placeKey
        ) {
            merged.set(stop.id, stop);
        }
    }
    return [...merged.values()].filter((stop) => isEligibleExistingStop(stop));
}

export function matchStopCandidate(
    candidate: StopCandidateForMatch,
    catalog: ExistingStopCatalog,
): StopMatchResult {
    const blocking_reasons: string[] = [];
    const warnings: string[] = [];

    if (!hasCleanMatchingName(candidate.normalized_fields)) {
        return {
            decision: "blocked_missing_clean_name",
            match_method: null,
            match_confidence_reason: null,
            matched_stop_id: null,
            matched_public_id: null,
            matched_review_status: null,
            merge_actions: [],
            warnings,
            blocking_reasons: ["Missing clean Myanmar stop name after normalization."],
            possible_duplicate_stop_ids: [],
        };
    }

    if (isAmbiguousGenericStop(candidate.normalized_fields)) {
        warnings.push("AMBIGUOUS_GENERIC_STOP_NAME");
    }

    const directionAwareExternalIds = [...new Set(candidate.source_external_ids ?? [])];
    for (const externalId of directionAwareExternalIds) {
        const sourceLink = catalog.source_link_by_external_id.get(externalId);
        if (!sourceLink) {
            continue;
        }

        const existing = catalog.stops.find((stop) => stop.id === sourceLink.entity_id);
        if (!existing || !isEligibleExistingStop(existing)) {
            continue;
        }

        if (
            candidate.shared_terminal !== true &&
            !isExplicitSharedTerminal(existing.normalized_data) &&
            !sidesAreCompatible(candidate, existing)
        ) {
            warnings.push("SOURCE_LINK_SIDE_MISMATCH");
            continue;
        }

        return buildSourceLinkReuseResult(candidate, existing, warnings);
    }

    const legacyExternalId = buildSourceExternalId(candidateStopPlaceKey(candidate));
    const legacySourceLink = catalog.source_link_by_external_id.get(legacyExternalId);
    if (legacySourceLink && candidate.direction_key) {
        const existing = catalog.stops.find((stop) => stop.id === legacySourceLink.entity_id);
        if (existing && candidate.shared_terminal !== true) {
            return buildUncertainCreateNewResult(
                warnings,
                "Legacy place-key source link matched without direction-safe identity; creating separate stop.",
                [existing.id],
            );
        }
    }

    const boardingSideMatches = findBoardingSideKeyMatches(candidate, catalog);
    if (boardingSideMatches.length === 1) {
        const existing = boardingSideMatches[0];
        const matchMethod: StopMatchMethod = PROTECTED_REVIEW_STATUSES.has(existing.review_status)
            ? "reviewed_stop_match"
            : "exact_boarding_side_key";
        const confidence: StopMatchConfidenceReason =
            matchMethod === "reviewed_stop_match" ? "reviewed_stop_match" : "exact_boarding_side_key";
        return toMatchResult(candidate, existing, matchMethod, confidence, warnings);
    }
    if (boardingSideMatches.length > 1) {
        return buildUncertainCreateNewResult(
            warnings,
            "Multiple existing stops matched boarding_side_key; creating separate stop for duplicate review.",
            boardingSideMatches.map((stop) => stop.id),
        );
    }

    const exactNameAreaSideMatches = findExactNameAreaSideMatches(candidate, catalog);
    if (exactNameAreaSideMatches.length === 1) {
        const existing = exactNameAreaSideMatches[0];
        const matchMethod: StopMatchMethod = PROTECTED_REVIEW_STATUSES.has(existing.review_status)
            ? "reviewed_stop_match"
            : "exact_name_area_side";
        const confidence: StopMatchConfidenceReason =
            matchMethod === "reviewed_stop_match" ? "reviewed_stop_match" : "exact_name_area_side";
        return toMatchResult(candidate, existing, matchMethod, confidence, warnings);
    }
    if (exactNameAreaSideMatches.length > 1) {
        return buildUncertainCreateNewResult(
            warnings,
            "Multiple existing stops matched exact name + area + side; creating separate stop for duplicate review.",
            exactNameAreaSideMatches.map((stop) => stop.id),
        );
    }

    const reviewedMatches = findReviewedStopMatches(candidate, catalog);
    if (reviewedMatches.length === 1) {
        return toMatchResult(
            candidate,
            reviewedMatches[0],
            "reviewed_stop_match",
            "reviewed_stop_match",
            warnings,
        );
    }
    if (reviewedMatches.length > 1) {
        return buildUncertainCreateNewResult(
            warnings,
            "Multiple protected stops matched name + area + side; creating separate stop for duplicate review.",
            reviewedMatches.map((stop) => stop.id),
        );
    }

    const possibleDuplicates = findPossibleDuplicateStops(candidate, catalog);
    if (possibleDuplicates.length > 0 || isAmbiguousGenericStop(candidate.normalized_fields)) {
        const reason = isAmbiguousGenericStop(candidate.normalized_fields)
            ? "Ambiguous generic stop name without area context; creating separate stop."
            : "Possible same-place duplicate stops found; creating separate stop for duplicate review.";

        return buildUncertainCreateNewResult(
            warnings,
            reason,
            possibleDuplicates.map((stop) => stop.id),
        );
    }

    return {
        decision: "create_new_stop",
        match_method: null,
        match_confidence_reason: null,
        matched_stop_id: null,
        matched_public_id: null,
        matched_review_status: null,
        merge_actions: ["add_source_link", "append_normalized_data_ybs_go", "add_stop_name_row"],
        warnings,
        blocking_reasons,
        possible_duplicate_stop_ids: [],
    };
}

function indexStops(stops: ExistingStopRecord[]): {
    stops_by_boarding_side_key: Map<string, ExistingStopRecord[]>;
    stops_by_stop_place_key: Map<string, ExistingStopRecord[]>;
} {
    const stops_by_boarding_side_key = new Map<string, ExistingStopRecord[]>();
    const stops_by_stop_place_key = new Map<string, ExistingStopRecord[]>();

    for (const stop of stops) {
        if (stop.boarding_side_key) {
            const bucket = stops_by_boarding_side_key.get(stop.boarding_side_key) ?? [];
            bucket.push(stop);
            stops_by_boarding_side_key.set(stop.boarding_side_key, bucket);
        }

        const placeBucket = stops_by_stop_place_key.get(stop.stop_place_key) ?? [];
        placeBucket.push(stop);
        stops_by_stop_place_key.set(stop.stop_place_key, placeBucket);
    }

    return { stops_by_boarding_side_key, stops_by_stop_place_key };
}

export async function loadExistingStopCatalog(databaseUrl: string): Promise<ExistingStopCatalog> {
    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 120_000,
    });

    try {
        const client = await pool.connect();
        try {
            await client.query("BEGIN READ ONLY");
            await client.query("SET TRANSACTION READ ONLY");

            const stopRows = await client.query<{
                id: string;
                public_id: string;
                stop_code: string | null;
                name: string;
                name_mm: string | null;
                name_en: string | null;
                review_status: string;
                normalized_data: Record<string, unknown> | null;
                source_refs: Record<string, unknown> | null;
                lng: string | null;
                lat: string | null;
                has_geom: boolean;
            }>(`
                SELECT
                    s.id::text,
                    s.public_id::text,
                    s.stop_code,
                    s.name,
                    s.name_mm,
                    s.name_en,
                    s.review_status,
                    s.normalized_data,
                    s.source_refs,
                    CASE WHEN s.geom IS NOT NULL THEN ST_X(s.geom)::text END AS lng,
                    CASE WHEN s.geom IS NOT NULL THEN ST_Y(s.geom)::text END AS lat,
                    (s.geom IS NOT NULL) AS has_geom
                FROM transport.stops s
                WHERE s.deleted_at IS NULL
                  AND s.mode = 'bus'
            `);

            const nameRows = await client.query<{
                stop_id: string;
                name: string;
                language_code: string;
                is_primary: boolean;
            }>(`
                SELECT
                    sn.stop_id::text,
                    sn.name,
                    sn.language_code,
                    sn.is_primary
                FROM transport.stop_names sn
                JOIN transport.stops s ON s.id = sn.stop_id
                WHERE s.deleted_at IS NULL
                  AND s.mode = 'bus'
            `);

            const sourceRows = await client.query<{
                entity_id: string;
                source_name: string;
                source_kind: string;
                external_id: string;
                source_payload: Record<string, unknown> | null;
            }>(`
                SELECT
                    sl.entity_id::text,
                    sl.source_name,
                    sl.source_kind,
                    sl.external_id,
                    sl.source_payload
                FROM transport.source_links sl
                WHERE sl.entity_type = 'stop'
            `);

            await client.query("COMMIT");

            const namesByStopId = new Map<number, ExistingStopNameRow[]>();
            for (const row of nameRows.rows) {
                const stopId = Number(row.stop_id);
                const bucket = namesByStopId.get(stopId) ?? [];
                bucket.push({
                    stop_id: stopId,
                    name: row.name,
                    language_code: row.language_code,
                    is_primary: row.is_primary,
                });
                namesByStopId.set(stopId, bucket);
            }

            const stops: ExistingStopRecord[] = stopRows.rows.map((row) => {
                const id = Number(row.id);
                const names = namesByStopId.get(id) ?? [];
                const lng =
                    row.lng !== null && row.lng !== undefined && Number.isFinite(Number(row.lng))
                        ? Number(row.lng)
                        : null;
                const lat =
                    row.lat !== null && row.lat !== undefined && Number.isFinite(Number(row.lat))
                        ? Number(row.lat)
                        : null;
                const has_geom = Boolean(row.has_geom) && lng !== null && lat !== null;

                return enrichExistingStopRecord(
                    {
                        id,
                        public_id: row.public_id,
                        stop_code: row.stop_code,
                        name: row.name,
                        name_mm: row.name_mm,
                        name_en: row.name_en,
                        review_status: row.review_status,
                        normalized_data: row.normalized_data,
                        source_refs: row.source_refs,
                        lng: has_geom ? lng : null,
                        lat: has_geom ? lat : null,
                        has_geom,
                    },
                    names,
                );
            });

            const { stops_by_boarding_side_key, stops_by_stop_place_key } = indexStops(stops);

            const source_link_by_external_id = new Map<string, ExistingSourceLinkRow>();
            const source_link_by_stop_id = new Map<number, ExistingSourceLinkRow[]>();

            for (const row of sourceRows.rows) {
                const entityId = Number(row.entity_id);
                const link: ExistingSourceLinkRow = {
                    entity_id: entityId,
                    source_name: row.source_name,
                    source_kind: row.source_kind,
                    external_id: row.external_id,
                    source_payload: row.source_payload,
                };

                const externalKey = `${row.source_name}::${row.source_kind}::${row.external_id}`;
                source_link_by_external_id.set(externalKey, link);

                if (
                    row.source_name === YBS_STOP_SOURCE_NAME &&
                    row.source_kind === YBS_STOP_SOURCE_KIND
                ) {
                    source_link_by_external_id.set(row.external_id, link);
                }

                const bucket = source_link_by_stop_id.get(entityId) ?? [];
                bucket.push(link);
                source_link_by_stop_id.set(entityId, bucket);
            }

            let database_url_host: string | null = null;
            try {
                database_url_host = new URL(databaseUrl).host;
            } catch {
                database_url_host = null;
            }

            return {
                loaded_at: new Date().toISOString(),
                database_url_host,
                stops,
                stops_by_boarding_side_key,
                stops_by_stop_place_key,
                source_link_by_external_id,
                source_link_by_stop_id,
            };
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

export function createEmptyStopCatalog(): ExistingStopCatalog {
    return {
        loaded_at: new Date().toISOString(),
        database_url_host: null,
        stops: [],
        stops_by_boarding_side_key: new Map(),
        stops_by_stop_place_key: new Map(),
        source_link_by_external_id: new Map(),
        source_link_by_stop_id: new Map(),
    };
}
