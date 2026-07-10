/**
 * Phase 6: build YBS stop resolution artifacts before Supabase import.
 *
 * Read-only against Supabase. No inserts, updates, or deletes.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import {
    buildBoardingSideKeyFromFields,
    buildBoardingStopKey,
    buildCandidateId,
    buildDirectionAwareStopExternalId,
    buildStopIdentityMetadata,
    buildStopPlaceKey,
    buildVariantCode,
    combineRawText,
    isExplicitSharedTerminal,
    normalizeStopMatchingFields,
    resolveDirectionFamily,
    resolveSideGroup,
    type NormalizedStopMatchingFields,
    type SideGroup,
    type StopMatchConfidenceReason,
} from "./stop-normalize.js";
import {
    buildGeometryAnchorFields,
    type StopGeometryAnchorFields,
} from "./geometry-anchor.js";
import {
    createEmptyStopCatalog,
    loadExistingStopCatalog,
    matchStopCandidate,
    type ExistingStopCatalog,
    type StopCandidateForMatch,
    type StopMatchDecision,
    type StopMatchResult,
} from "./supabase-stop-match.js";
import { MANUAL_REVIEW_CONFIDENCE_SCORE } from "../ybs-supabase-import/lib/route-import-policy.js";

export const PHASE6_SCHEMA_VERSION = 5;

export type StopUsage = {
    route_code: string;
    variant_code: string;
    direction_key: string;
    direction_name: string;
    sequence: number;
    stop_name_my: string | null;
    stop_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    raw_text: string | null;
    source_route_file: string;
    normalized_name_my: string | null;
    normalized_name_en: string | null;
    normalized_area_my: string | null;
    normalized_area_en: string | null;
    stop_place_key: string;
    boarding_stop_key: string;
    boarding_side_key: string;
    side_group: SideGroup;
    direction_family: ReturnType<typeof resolveDirectionFamily>;
    candidate_key: string;
    candidate_id: string;
    source_external_id: string;
    shared_terminal: boolean;
};

export type StopCandidate = {
    candidate_id: string;
    candidate_key: string;
    stop_place_key: string;
    boarding_stop_key: string;
    boarding_side_key: string;
    side_group: SideGroup;
    direction_family: ReturnType<typeof resolveDirectionFamily>;
    direction_key: string;
    primary_name_my: string | null;
    primary_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    normalized_fields: NormalizedStopMatchingFields;
    usages: StopUsage[];
    routes_seen: string[];
    usage_count: number;
    shared_terminal: boolean;
};

export type StopResolutionPlanEntry = StopCandidate &
    StopMatchResult &
    StopGeometryAnchorFields & {
        source_external_id: string;
        duplicate_review_required: boolean;
        import_confidence_score: number;
        manual_review_reason: string | null;
        stop_identity: ReturnType<typeof buildStopIdentityMetadata>;
    };

export type StopIdentityMetrics = {
    cross_route_shared_stop_count: number;
    route_internal_duplicate_stop_id_count: number;
    inbound_outbound_shared_stop_count: number;
    uncertain_created_separate_stop_count: number;
    possible_duplicate_stop_count: number;
    under_merge_candidate_count: number;
    over_merge_risk_count: number;
    shared_terminal_stop_count: number;
    protected_stop_reuse_count: number;
    protected_stop_not_modified_count: number;
    cross_route_shared_stops: Array<{
        shared_stop_id: number | null;
        candidate_id: string;
        routes: string[];
        directions: string[];
        sequences: number[];
        names: {
            my: string | null;
            en: string | null;
        };
        side_group: SideGroup;
        confidence: StopMatchConfidenceReason | null;
    }>;
    possible_duplicate_stops: Array<{
        stop_place_key: string;
        side_group: SideGroup;
        stop_ids: number[];
        candidate_ids: string[];
    }>;
    under_merge_candidates: Array<{
        boarding_side_key: string;
        candidate_id: string;
        existing_stop_ids: number[];
        routes_seen: string[];
    }>;
};

export type ManualReviewStopsByRoute = Record<
    string,
    Array<{
        candidate_id: string;
        candidate_key: string;
        decision: StopMatchDecision;
        reason: string;
    }>
>;

export type ManualReviewStopsByReason = Record<string, number>;

export type SameNameDifferentAreaGroup = {
    name_key: string;
    primary_name_my: string | null;
    primary_name_en: string | null;
    area_variants: Array<{
        candidate_key: string;
        candidate_id: string;
        normalized_area_my: string | null;
        normalized_area_en: string | null;
        usage_count: number;
        routes_seen: string[];
    }>;
};

export type Phase6StopResolutionReport = {
    generated_at: string;
    run_root: string;
    input_dir: string;
    input_source: "normalized" | "merged";
    db_prep_dir: string;
    supabase_catalog: {
        loaded_at: string | null;
        database_url_host: string | null;
        existing_stop_count: number;
        existing_source_link_count: number;
        skipped_supabase: boolean;
    };
    summary: {
        route_files_processed: number;
        total_stop_usages: number;
        unique_stop_candidates: number;
        reuse_existing_stop: number;
        create_new_stop: number;
        merge_additional_data_to_existing: number;
        needs_manual_review: number;
        dashboard_review_required: number;
        held_for_review_count: number;
        would_create_placeholder_stop_count: number;
        manual_review_stops_by_route: ManualReviewStopsByRoute;
        manual_review_stops_by_reason: ManualReviewStopsByReason;
        blocked_conflict: number;
        blocked_missing_clean_name: number;
        geometry_anchors_available: number;
        geometry_anchors_from_reuse: number;
        geometry_anchors_from_merge: number;
        matched_stops_without_geometry: number;
        top_shared_stops: Array<{
            candidate_id: string;
            primary_name_my: string | null;
            primary_name_en: string | null;
            usage_count: number;
            routes_seen: string[];
            decision: StopMatchDecision;
        }>;
        same_name_different_area_groups: SameNameDifferentAreaGroup[];
        direction_split_stop_count: number;
        opposite_direction_reuse_prevented_count: number;
        possible_shared_terminal_count: number;
        still_shared_stop_count: number;
        opposite_direction_shared_stops: Array<{
            route_code: string;
            shared_stop_id: number | null;
            stop_name: string | null;
            inbound_sequence: number | null;
            outbound_sequence: number | null;
            allowed_shared_terminal: boolean;
        }>;
    } & StopIdentityMetrics;
};

export type BuildStopResolutionOptions = {
    runRoot: string;
    databaseUrl?: string;
    skipSupabase?: boolean;
};

type RouteStopRow = {
    sequence?: number;
    stop_name_my?: string | null;
    stop_name_en?: string | null;
    area_text_my?: string | null;
    area_text_en?: string | null;
    raw_text?: string | null;
    raw_text_my?: string | null;
    raw_text_en?: string | null;
    shared_terminal?: boolean;
    normalized_data?: Record<string, unknown> | null;
};

type RouteVariantRow = {
    direction_key?: string;
    direction_name?: string;
    stops?: RouteStopRow[];
};

type RouteInputFile = {
    normalization_status?: string;
    route?: {
        route_code?: string | null;
        route_code_candidate?: string | null;
    };
    variants?: RouteVariantRow[];
};

function repoRoot(): string {
    return process.cwd();
}

function loadDatabaseEnv(): void {
    const candidates = [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ];

    for (const envPath of candidates) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function resolveDatabaseUrl(explicit?: string): string | undefined {
    return (
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL
    );
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

function listJsonFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(dir, name))
        .sort((left, right) => left.localeCompare(right));
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function resolveInputDir(runRoot: string): { inputDir: string; inputSource: "normalized" | "merged" } {
    const normalizedDir = path.join(runRoot, "normalized", "routes");
    if (fs.existsSync(normalizedDir) && listJsonFiles(normalizedDir).length > 0) {
        return { inputDir: normalizedDir, inputSource: "normalized" };
    }

    return {
        inputDir: path.join(runRoot, "merged", "routes"),
        inputSource: "merged",
    };
}

function routeCodeFromFile(file: RouteInputFile, filePath: string): string {
    const fromRoute =
        (typeof file.route?.route_code === "string" && file.route.route_code.trim()) ||
        (typeof file.route?.route_code_candidate === "string" &&
            file.route.route_code_candidate.trim());
    return fromRoute || path.basename(filePath, ".json");
}

function buildStopUsagesFromRoute(filePath: string, file: RouteInputFile): StopUsage[] {
    const routeCode = routeCodeFromFile(file, filePath);
    const usages: StopUsage[] = [];

    for (const variant of file.variants ?? []) {
        const directionKey = variant.direction_key?.trim().toLowerCase();
        if (!directionKey) {
            continue;
        }

        const variantCode = buildVariantCode(routeCode, directionKey);
        const directionName =
            (typeof variant.direction_name === "string" && variant.direction_name.trim()) ||
            directionKey;

        for (const stop of variant.stops ?? []) {
            const normalized = normalizeStopMatchingFields({
                stop_name_my: stop.stop_name_my ?? null,
                stop_name_en: stop.stop_name_en ?? null,
                area_text_my: stop.area_text_my ?? null,
                area_text_en: stop.area_text_en ?? null,
            });
            const stopPlaceKey = buildStopPlaceKey(normalized);
            const sequence = typeof stop.sequence === "number" ? stop.sequence : 0;
            const sharedTerminal =
                stop.shared_terminal === true ||
                isExplicitSharedTerminal(stop.normalized_data ?? null);
            const boardingStopKey = buildBoardingStopKey(normalized, directionKey);
            const sideGroup = resolveSideGroup(directionKey, sharedTerminal);
            const boardingSideKey = buildBoardingSideKeyFromFields(
                normalized,
                directionKey,
                sharedTerminal,
            );
            const candidateKey = boardingStopKey;
            const candidateId = buildCandidateId(candidateKey);

            usages.push({
                route_code: routeCode,
                variant_code: variantCode,
                direction_key: directionKey,
                direction_name: directionName,
                sequence,
                stop_name_my: stop.stop_name_my ?? null,
                stop_name_en: stop.stop_name_en ?? null,
                area_text_my: stop.area_text_my ?? null,
                area_text_en: stop.area_text_en ?? null,
                raw_text: combineRawText([stop.raw_text, stop.raw_text_my, stop.raw_text_en]),
                source_route_file: filePath,
                normalized_name_my: normalized.normalized_name_my,
                normalized_name_en: normalized.normalized_name_en,
                normalized_area_my: normalized.normalized_area_my,
                normalized_area_en: normalized.normalized_area_en,
                stop_place_key: stopPlaceKey,
                boarding_stop_key: boardingStopKey,
                boarding_side_key: boardingSideKey,
                side_group: sideGroup,
                direction_family: resolveDirectionFamily(directionKey),
                candidate_key: candidateKey,
                candidate_id: candidateId,
                source_external_id: buildDirectionAwareStopExternalId(
                    routeCode,
                    directionKey,
                    sequence,
                ),
                shared_terminal: sharedTerminal,
            });
        }
    }

    return usages;
}

function groupStopCandidates(usages: StopUsage[]): StopCandidate[] {
    const groups = new Map<string, StopUsage[]>();
    const routeBoardingSeen = new Map<string, number>();

    const sortedUsages = [...usages].sort((left, right) => {
        const routeCompare = left.route_code.localeCompare(right.route_code);
        if (routeCompare !== 0) {
            return routeCompare;
        }
        const directionCompare = left.direction_key.localeCompare(right.direction_key);
        if (directionCompare !== 0) {
            return directionCompare;
        }
        return left.sequence - right.sequence;
    });

    for (const usage of sortedUsages) {
        const routeBoardingKey = `${usage.route_code}|${usage.boarding_side_key}`;
        const seenCount = routeBoardingSeen.get(routeBoardingKey) ?? 0;
        let groupKey = usage.candidate_key;
        if (seenCount > 0 && !usage.shared_terminal) {
            groupKey = `${usage.candidate_key}|route-dup:${usage.route_code}:seq:${usage.sequence}`;
        }
        routeBoardingSeen.set(routeBoardingKey, seenCount + 1);

        const bucket = groups.get(groupKey) ?? [];
        bucket.push(usage);
        groups.set(groupKey, bucket);
    }

    const candidates: StopCandidate[] = [];

    for (const [candidateKey, groupUsages] of groups.entries()) {
        const first = groupUsages[0];
        const candidateId = buildCandidateId(candidateKey);
        const normalized_fields = normalizeStopMatchingFields({
            stop_name_my: first.stop_name_my,
            stop_name_en: first.stop_name_en,
            area_text_my: first.area_text_my,
            area_text_en: first.area_text_en,
        });

        const routesSeen = [...new Set(groupUsages.map((usage) => usage.route_code))].sort();

        candidates.push({
            candidate_id: candidateId,
            candidate_key: candidateKey,
            stop_place_key: first.stop_place_key,
            boarding_stop_key: first.boarding_stop_key,
            boarding_side_key: first.boarding_side_key,
            side_group: first.side_group,
            direction_family: first.direction_family,
            direction_key: first.direction_key,
            primary_name_my: first.stop_name_my,
            primary_name_en: first.stop_name_en,
            area_text_my: first.area_text_my,
            area_text_en: first.area_text_en,
            normalized_fields,
            usages: groupUsages.sort((left, right) => {
                const routeCompare = left.route_code.localeCompare(right.route_code);
                if (routeCompare !== 0) {
                    return routeCompare;
                }
                const directionCompare = left.direction_key.localeCompare(right.direction_key);
                if (directionCompare !== 0) {
                    return directionCompare;
                }
                return left.sequence - right.sequence;
            }),
            routes_seen: routesSeen,
            usage_count: groupUsages.length,
            shared_terminal: groupUsages.some((usage) => usage.shared_terminal),
        });
    }

    return candidates.sort((left, right) => right.usage_count - left.usage_count);
}

function buildSameNameDifferentAreaGroups(candidates: StopCandidate[]): SameNameDifferentAreaGroup[] {
    const byName = new Map<string, StopCandidate[]>();

    for (const candidate of candidates) {
        const nameKey = [
            candidate.normalized_fields.normalized_name_my ?? "",
            candidate.normalized_fields.normalized_name_en ?? "",
        ].join("|");

        if (!nameKey.replace(/\|/gu, "").trim()) {
            continue;
        }

        const bucket = byName.get(nameKey) ?? [];
        bucket.push(candidate);
        byName.set(nameKey, bucket);
    }

    const groups: SameNameDifferentAreaGroup[] = [];

    for (const [nameKey, group] of byName.entries()) {
        const areaKeys = new Set(
            group.map((candidate) =>
                [
                    candidate.normalized_fields.normalized_area_my ?? "",
                    candidate.normalized_fields.normalized_area_en ?? "",
                ].join("|"),
            ),
        );

        if (areaKeys.size <= 1) {
            continue;
        }

        groups.push({
            name_key: nameKey,
            primary_name_my: group[0].primary_name_my,
            primary_name_en: group[0].primary_name_en,
            area_variants: group.map((candidate) => ({
                candidate_key: candidate.candidate_key,
                candidate_id: candidate.candidate_id,
                normalized_area_my: candidate.normalized_fields.normalized_area_my,
                normalized_area_en: candidate.normalized_fields.normalized_area_en,
                usage_count: candidate.usage_count,
                routes_seen: candidate.routes_seen,
            })),
        });
    }

    return groups.sort(
        (left, right) => right.area_variants.length - left.area_variants.length,
    );
}

function countDecision(
    plans: StopResolutionPlanEntry[],
    decision: StopMatchDecision,
): number {
    return plans.filter((plan) => plan.decision === decision).length;
}

function isManualReviewPlan(plan: StopResolutionPlanEntry): boolean {
    return (
        plan.decision === "dashboard_review_required" ||
        plan.decision === "needs_manual_review" ||
        (plan.decision === "create_new_stop" &&
            plan.warnings.some((warning) => warning.includes("STOP_NEEDS_MANUAL_REVIEW")))
    );
}

function manualReviewReason(plan: StopResolutionPlanEntry): string {
    const explicit = plan.warnings.find(
        (warning) =>
            warning !== "STOP_NEEDS_MANUAL_REVIEW" &&
            !warning.startsWith("STOP_NEEDS_MANUAL_REVIEW"),
    );
    if (explicit) {
        return explicit;
    }
    if (plan.decision === "dashboard_review_required") {
        return "Held for dashboard review before linking to route.";
    }
    return "Stop requires manual duplicate review before public release.";
}

function enrichStopResolutionPlan(
    candidate: StopCandidate,
    match: StopMatchResult,
    geometryAnchor: StopGeometryAnchorFields,
    primaryUsage: StopUsage,
): StopResolutionPlanEntry {
    const manualReview =
        match.decision === "dashboard_review_required" ||
        match.decision === "needs_manual_review" ||
        match.match_confidence_reason === "uncertain_created_separate_stop" ||
        match.possible_duplicate_stop_ids.length > 0 ||
        (match.decision === "create_new_stop" &&
            match.warnings.some((warning) => warning.includes("STOP_NEEDS_MANUAL_REVIEW")));

    const matchConfidenceReason = match.match_confidence_reason;
    const stopIdentity = buildStopIdentityMetadata({
        fields: candidate.normalized_fields,
        directionKey: candidate.direction_key,
        sharedTerminal: candidate.shared_terminal,
        duplicateReviewRequired: manualReview,
        possibleDuplicateStopIds: match.possible_duplicate_stop_ids,
        matchedFromExistingStopId: match.matched_stop_id,
        matchConfidenceReason,
    });

    return {
        ...candidate,
        ...match,
        ...geometryAnchor,
        source_external_id: primaryUsage.source_external_id,
        duplicate_review_required: manualReview,
        import_confidence_score: manualReview
            ? MANUAL_REVIEW_CONFIDENCE_SCORE
            : match.decision === "reuse_existing_stop"
              ? 80
              : 40,
        manual_review_reason: manualReview ? manualReviewReason({ ...candidate, ...match } as StopResolutionPlanEntry) : null,
        stop_identity: stopIdentity,
    };
}

type OppositeDirectionReuseReport = {
    opposite_direction_reuse_prevented_count: number;
    possible_shared_terminal_count: number;
    still_shared_stop_count: number;
    opposite_direction_shared_stops: Phase6StopResolutionReport["summary"]["opposite_direction_shared_stops"];
};

function applyOppositeDirectionStopReusePolicy(
    plans: StopResolutionPlanEntry[],
    allUsages: StopUsage[],
): OppositeDirectionReuseReport {
    const planByCandidateId = new Map(plans.map((plan) => [plan.candidate_id, plan]));
    const usagesByRoute = new Map<string, StopUsage[]>();

    for (const usage of allUsages) {
        const bucket = usagesByRoute.get(usage.route_code) ?? [];
        bucket.push(usage);
        usagesByRoute.set(usage.route_code, bucket);
    }

    let opposite_direction_reuse_prevented_count = 0;
    let possible_shared_terminal_count = 0;
    let still_shared_stop_count = 0;
    const opposite_direction_shared_stops: OppositeDirectionReuseReport["opposite_direction_shared_stops"] =
        [];

    for (const [routeCode, routeUsages] of usagesByRoute.entries()) {
        const inboundUsages = routeUsages.filter((usage) => usage.direction_key === "inbound");
        const outboundUsages = routeUsages.filter((usage) => usage.direction_key === "outbound");
        if (inboundUsages.length === 0 || outboundUsages.length === 0) {
            continue;
        }

        const matchedStopIdsByDirection = {
            inbound: new Map<number, StopUsage[]>(),
            outbound: new Map<number, StopUsage[]>(),
        };

        for (const usage of inboundUsages) {
            const plan = planByCandidateId.get(usage.candidate_id);
            const stopId = plan?.matched_stop_id;
            if (!stopId) {
                continue;
            }
            const bucket = matchedStopIdsByDirection.inbound.get(stopId) ?? [];
            bucket.push(usage);
            matchedStopIdsByDirection.inbound.set(stopId, bucket);
        }

        for (const usage of outboundUsages) {
            const plan = planByCandidateId.get(usage.candidate_id);
            const stopId = plan?.matched_stop_id;
            if (!stopId) {
                continue;
            }
            const bucket = matchedStopIdsByDirection.outbound.get(stopId) ?? [];
            bucket.push(usage);
            matchedStopIdsByDirection.outbound.set(stopId, bucket);
        }

        for (const [sharedStopId, inboundList] of matchedStopIdsByDirection.inbound.entries()) {
            const outboundList = matchedStopIdsByDirection.outbound.get(sharedStopId);
            if (!outboundList || outboundList.length === 0) {
                continue;
            }

            const inboundUsage = inboundList[0];
            const outboundUsage = outboundList[0];
            const inboundPlan = planByCandidateId.get(inboundUsage.candidate_id);
            const outboundPlan = planByCandidateId.get(outboundUsage.candidate_id);
            if (!inboundPlan || !outboundPlan) {
                continue;
            }

            const allowedSharedTerminal =
                inboundUsage.shared_terminal &&
                outboundUsage.shared_terminal &&
                inboundPlan.shared_terminal &&
                outboundPlan.shared_terminal;

            const stopName =
                inboundPlan.primary_name_my ??
                inboundPlan.primary_name_en ??
                outboundPlan.primary_name_my ??
                outboundPlan.primary_name_en;

            opposite_direction_shared_stops.push({
                route_code: routeCode,
                shared_stop_id: sharedStopId,
                stop_name: stopName,
                inbound_sequence: inboundUsage.sequence,
                outbound_sequence: outboundUsage.sequence,
                allowed_shared_terminal: allowedSharedTerminal,
            });

            if (allowedSharedTerminal) {
                still_shared_stop_count++;
                continue;
            }

            if (!inboundPlan.shared_terminal && !outboundPlan.shared_terminal) {
                possible_shared_terminal_count++;
            }

            const targetPlan = outboundPlan;
            if (
                targetPlan.decision === "reuse_existing_stop" ||
                targetPlan.decision === "merge_additional_data_to_existing"
            ) {
                targetPlan.decision = "create_new_stop";
                targetPlan.matched_stop_id = null;
                targetPlan.matched_public_id = null;
                targetPlan.matched_review_status = null;
                targetPlan.match_method = "opposite_direction_reuse_prevented";
                targetPlan.merge_actions = [
                    "add_source_link",
                    "append_normalized_data_ybs_go",
                    "add_stop_name_row",
                ];
                targetPlan.warnings = [
                    ...targetPlan.warnings.filter((warning) => warning !== "OPPOSITE_DIRECTION_STOP_REUSE"),
                    "OPPOSITE_DIRECTION_STOP_REUSE",
                    "STOP_NEEDS_MANUAL_REVIEW",
                ];
                targetPlan.duplicate_review_required = true;
                targetPlan.import_confidence_score = MANUAL_REVIEW_CONFIDENCE_SCORE;
                targetPlan.manual_review_reason =
                    "Opposite-direction stop reuse prevented; separate boarding stop required.";
                opposite_direction_reuse_prevented_count++;
            }
        }
    }

    return {
        opposite_direction_reuse_prevented_count,
        possible_shared_terminal_count,
        still_shared_stop_count,
        opposite_direction_shared_stops,
    };
}

function buildManualReviewReports(
    plans: StopResolutionPlanEntry[],
    usages: StopUsage[],
): {
    manual_review_stops_by_route: ManualReviewStopsByRoute;
    manual_review_stops_by_reason: ManualReviewStopsByReason;
    held_for_review_count: number;
    would_create_placeholder_stop_count: number;
} {
    const manual_review_stops_by_route: ManualReviewStopsByRoute = {};
    const manual_review_stops_by_reason: ManualReviewStopsByReason = {};
    let held_for_review_count = 0;
    let would_create_placeholder_stop_count = 0;

    for (const plan of plans) {
        if (plan.decision === "dashboard_review_required") {
            held_for_review_count++;
        }

        if (
            !plan.can_use_as_geometry_anchor &&
            (plan.decision === "create_new_stop" ||
                plan.decision === "dashboard_review_required" ||
                plan.decision === "needs_manual_review")
        ) {
            would_create_placeholder_stop_count++;
        }

        if (!isManualReviewPlan(plan)) {
            continue;
        }

        const reason = plan.manual_review_reason ?? manualReviewReason(plan);
        manual_review_stops_by_reason[reason] = (manual_review_stops_by_reason[reason] ?? 0) + 1;

        for (const routeCode of plan.routes_seen) {
            const bucket = manual_review_stops_by_route[routeCode] ?? [];
            bucket.push({
                candidate_id: plan.candidate_id,
                candidate_key: plan.candidate_key,
                decision: plan.decision,
                reason,
            });
            manual_review_stops_by_route[routeCode] = bucket;
        }
    }

    for (const usage of usages) {
        const plan = plans.find((entry) => entry.candidate_id === usage.candidate_id);
        if (!plan || !isManualReviewPlan(plan)) {
            continue;
        }
        const bucket = manual_review_stops_by_route[usage.route_code] ?? [];
        if (!bucket.some((entry) => entry.candidate_id === plan.candidate_id)) {
            bucket.push({
                candidate_id: plan.candidate_id,
                candidate_key: plan.candidate_key,
                decision: plan.decision,
                reason: plan.manual_review_reason ?? manualReviewReason(plan),
            });
            manual_review_stops_by_route[usage.route_code] = bucket;
        }
    }

    return {
        manual_review_stops_by_route,
        manual_review_stops_by_reason,
        held_for_review_count,
        would_create_placeholder_stop_count,
    };
}

const PROTECTED_STOP_REVIEW_STATUSES = new Set(["reviewed", "verified", "manual_protected"]);

function computeStopIdentityMetrics(
    plans: StopResolutionPlanEntry[],
    allUsages: StopUsage[],
    catalog: ExistingStopCatalog,
): StopIdentityMetrics {
    const planByCandidateId = new Map(plans.map((plan) => [plan.candidate_id, plan]));
    const cross_route_shared_stops: StopIdentityMetrics["cross_route_shared_stops"] = [];
    const possible_duplicate_stops: StopIdentityMetrics["possible_duplicate_stops"] = [];
    const under_merge_candidates: StopIdentityMetrics["under_merge_candidates"] = [];

    let cross_route_shared_stop_count = 0;
    let route_internal_duplicate_stop_id_count = 0;
    let inbound_outbound_shared_stop_count = 0;
    let shared_terminal_stop_count = 0;
    let uncertain_created_separate_stop_count = 0;
    let possible_duplicate_stop_count = 0;
    let under_merge_candidate_count = 0;
    let over_merge_risk_count = 0;
    let protected_stop_reuse_count = 0;
    let protected_stop_not_modified_count = 0;

    for (const plan of plans) {
        if (plan.routes_seen.length > 1 && plan.matched_stop_id && plan.decision === "reuse_existing_stop") {
            cross_route_shared_stop_count++;
        }

        if (plan.side_group === "shared_terminal" || plan.shared_terminal) {
            shared_terminal_stop_count++;
        }

        if (
            plan.match_confidence_reason === "uncertain_created_separate_stop" ||
            (plan.decision === "create_new_stop" &&
                (plan.duplicate_review_required || plan.possible_duplicate_stop_ids.length > 0))
        ) {
            uncertain_created_separate_stop_count++;
        }

        if (
            plan.matched_stop_id &&
            PROTECTED_STOP_REVIEW_STATUSES.has(plan.matched_review_status ?? "")
        ) {
            protected_stop_reuse_count++;
            protected_stop_not_modified_count++;
        }

        if (plan.warnings.some((warning) => warning.includes("SOURCE_LINK_SIDE_MISMATCH"))) {
            over_merge_risk_count++;
        }

        if (
            plan.decision === "create_new_stop" &&
            catalog.stops_by_boarding_side_key.has(plan.boarding_side_key)
        ) {
            const existingIds = (catalog.stops_by_boarding_side_key.get(plan.boarding_side_key) ?? []).map(
                (stop) => stop.id,
            );
            if (existingIds.length > 0) {
                under_merge_candidate_count++;
                under_merge_candidates.push({
                    boarding_side_key: plan.boarding_side_key,
                    candidate_id: plan.candidate_id,
                    existing_stop_ids: existingIds,
                    routes_seen: plan.routes_seen,
                });
            }
        }

        if (plan.routes_seen.length > 1) {
            cross_route_shared_stops.push({
                shared_stop_id: plan.matched_stop_id,
                candidate_id: plan.candidate_id,
                routes: plan.routes_seen,
                directions: [...new Set(plan.usages.map((usage) => usage.direction_key))],
                sequences: plan.usages.map((usage) => usage.sequence),
                names: {
                    my: plan.primary_name_my,
                    en: plan.primary_name_en,
                },
                side_group: plan.side_group,
                confidence: plan.match_confidence_reason,
            });
        }
    }

    const duplicateByPlaceSide = new Map<
        string,
        { stop_place_key: string; side_group: SideGroup; stop_ids: Set<number>; candidate_ids: Set<string> }
    >();
    for (const plan of plans) {
        if (plan.matched_stop_id) {
            const key = `${plan.stop_place_key}|${plan.side_group}`;
            const bucket = duplicateByPlaceSide.get(key) ?? {
                stop_place_key: plan.stop_place_key,
                side_group: plan.side_group,
                stop_ids: new Set<number>(),
                candidate_ids: new Set<string>(),
            };
            bucket.stop_ids.add(plan.matched_stop_id);
            bucket.candidate_ids.add(plan.candidate_id);
            duplicateByPlaceSide.set(key, bucket);
        }
    }

    for (const bucket of duplicateByPlaceSide.values()) {
        if (bucket.stop_ids.size > 1) {
            possible_duplicate_stop_count++;
            possible_duplicate_stops.push({
                stop_place_key: bucket.stop_place_key,
                side_group: bucket.side_group,
                stop_ids: [...bucket.stop_ids],
                candidate_ids: [...bucket.candidate_ids],
            });
        }
    }

    const usagesByRoute = new Map<string, StopUsage[]>();
    for (const usage of allUsages) {
        const bucket = usagesByRoute.get(usage.route_code) ?? [];
        bucket.push(usage);
        usagesByRoute.set(usage.route_code, bucket);
    }

    for (const [routeCode, routeUsages] of usagesByRoute.entries()) {
        const stopIdsByDirection = new Map<string, Map<number, number[]>>();
        for (const usage of routeUsages) {
            const plan = planByCandidateId.get(usage.candidate_id);
            const stopId = plan?.matched_stop_id;
            if (!stopId) {
                continue;
            }
            const directionBucket =
                stopIdsByDirection.get(usage.direction_key) ?? new Map<number, number[]>();
            const sequences = directionBucket.get(stopId) ?? [];
            sequences.push(usage.sequence);
            directionBucket.set(stopId, sequences);
            stopIdsByDirection.set(usage.direction_key, directionBucket);
        }

        for (const directionBucket of stopIdsByDirection.values()) {
            for (const sequences of directionBucket.values()) {
                if (sequences.length > 1) {
                    route_internal_duplicate_stop_id_count++;
                }
            }
        }

        const inboundIds = stopIdsByDirection.get("inbound") ?? new Map<number, number[]>();
        const outboundIds = stopIdsByDirection.get("outbound") ?? new Map<number, number[]>();
        for (const stopId of inboundIds.keys()) {
            if (outboundIds.has(stopId)) {
                inbound_outbound_shared_stop_count++;
            }
        }
    }

    return {
        cross_route_shared_stop_count,
        route_internal_duplicate_stop_id_count,
        inbound_outbound_shared_stop_count,
        uncertain_created_separate_stop_count,
        possible_duplicate_stop_count,
        under_merge_candidate_count,
        over_merge_risk_count,
        shared_terminal_stop_count,
        protected_stop_reuse_count,
        protected_stop_not_modified_count,
        cross_route_shared_stops,
        possible_duplicate_stops,
        under_merge_candidates,
    };
}

function renderReportMarkdown(report: Phase6StopResolutionReport): string {
    const sharedLines =
        report.summary.top_shared_stops.length > 0
            ? report.summary.top_shared_stops
                  .map(
                      (item) =>
                          `- ${item.candidate_id}: ${item.primary_name_my ?? item.primary_name_en ?? "unknown"} (${item.usage_count} usages, ${item.decision})`,
                  )
                  .join("\n")
            : "- None";

    const sameNameLines =
        report.summary.same_name_different_area_groups.length > 0
            ? report.summary.same_name_different_area_groups
                  .slice(0, 20)
                  .map(
                      (group) =>
                          `- ${group.primary_name_my ?? group.primary_name_en ?? group.name_key}: ${group.area_variants.length} area variants`,
                  )
                  .join("\n")
            : "- None";

    return [
        "# Phase 6 YBS Stop Resolution Report",
        "",
        `Generated at: ${report.generated_at}`,
        `Run root: ${report.run_root}`,
        `Input: ${report.input_dir} (${report.input_source})`,
        `DB prep: ${report.db_prep_dir}`,
        "",
        "## Summary",
        "",
        `- Route files processed: ${report.summary.route_files_processed}`,
        `- Total stop usages: ${report.summary.total_stop_usages}`,
        `- Unique stop candidates: ${report.summary.unique_stop_candidates}`,
        `- reuse_existing_stop: ${report.summary.reuse_existing_stop}`,
        `- create_new_stop: ${report.summary.create_new_stop}`,
        `- merge_additional_data_to_existing: ${report.summary.merge_additional_data_to_existing}`,
        `- needs_manual_review: ${report.summary.needs_manual_review}`,
        `- dashboard_review_required: ${report.summary.dashboard_review_required}`,
        `- held_for_review_count: ${report.summary.held_for_review_count}`,
        `- would_create_placeholder_stop_count: ${report.summary.would_create_placeholder_stop_count}`,
        `- blocked_conflict: ${report.summary.blocked_conflict}`,
        `- blocked_missing_clean_name: ${report.summary.blocked_missing_clean_name}`,
        `- geometry_anchors_available: ${report.summary.geometry_anchors_available}`,
        `- geometry_anchors_from_reuse: ${report.summary.geometry_anchors_from_reuse}`,
        `- geometry_anchors_from_merge: ${report.summary.geometry_anchors_from_merge}`,
        `- matched_stops_without_geometry: ${report.summary.matched_stops_without_geometry}`,
        `- direction_split_stop_count: ${report.summary.direction_split_stop_count}`,
        `- opposite_direction_reuse_prevented_count: ${report.summary.opposite_direction_reuse_prevented_count}`,
        `- possible_shared_terminal_count: ${report.summary.possible_shared_terminal_count}`,
        `- still_shared_stop_count: ${report.summary.still_shared_stop_count}`,
        `- reused_cross_route_stop_count: ${report.summary.cross_route_shared_stop_count}`,
        `- route_internal_duplicate_stop_id_count: ${report.summary.route_internal_duplicate_stop_id_count}`,
        `- inbound_outbound_shared_stop_count: ${report.summary.inbound_outbound_shared_stop_count}`,
        `- uncertain_created_separate_stop_count: ${report.summary.uncertain_created_separate_stop_count}`,
        `- possible_duplicate_stop_count: ${report.summary.possible_duplicate_stop_count}`,
        `- under_merge_candidate_count: ${report.summary.under_merge_candidate_count}`,
        `- over_merge_risk_count: ${report.summary.over_merge_risk_count}`,
        `- shared_terminal_stop_count: ${report.summary.shared_terminal_stop_count}`,
        "",
        "## Supabase catalog",
        "",
        `- Loaded at: ${report.supabase_catalog.loaded_at ?? "n/a"}`,
        `- Database host: ${report.supabase_catalog.database_url_host ?? "n/a"}`,
        `- Existing stops: ${report.supabase_catalog.existing_stop_count}`,
        `- Existing stop source links: ${report.supabase_catalog.existing_source_link_count}`,
        `- Skipped Supabase: ${report.supabase_catalog.skipped_supabase}`,
        "",
        "## Top shared stops",
        "",
        sharedLines,
        "",
        "## Same-name different-area groups",
        "",
        sameNameLines,
        "",
    ].join("\n");
}

export async function buildStopResolution(
    options: BuildStopResolutionOptions,
): Promise<Phase6StopResolutionReport> {
    const runRoot = resolveFromRepo(options.runRoot);
    const { inputDir, inputSource } = resolveInputDir(runRoot);
    const dbPrepDir = path.join(runRoot, "db-prep");
    const reportsDir = path.join(runRoot, "reports");

    fs.mkdirSync(dbPrepDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    const routeFiles = listJsonFiles(inputDir);
    const allUsages: StopUsage[] = [];

    for (const filePath of routeFiles) {
        const file = readJsonFile<RouteInputFile>(filePath);
        if (
            file.normalization_status === "blocked_invalid_structure" ||
            file.normalization_status === "blocked_dirty_stop_data"
        ) {
            continue;
        }
        allUsages.push(...buildStopUsagesFromRoute(filePath, file));
    }

    const candidates = groupStopCandidates(allUsages);
    const sameNameDifferentAreaGroups = buildSameNameDifferentAreaGroups(candidates);
    const direction_split_stop_count = candidates.length;

    let catalog: ExistingStopCatalog = createEmptyStopCatalog();
    let skippedSupabase = Boolean(options.skipSupabase);

    const databaseUrl =
        resolveDatabaseUrl(options.databaseUrl);

    if (!skippedSupabase && databaseUrl) {
        catalog = await loadExistingStopCatalog(databaseUrl);
    } else if (!skippedSupabase && !databaseUrl) {
        skippedSupabase = true;
    }

    const plans: StopResolutionPlanEntry[] = candidates.map((candidate) => {
        const primaryUsage = candidate.usages[0];
        const matchInput: StopCandidateForMatch = {
            candidate_id: candidate.candidate_id,
            candidate_key: candidate.candidate_key,
            stop_place_key: candidate.stop_place_key,
            boarding_stop_key: candidate.boarding_stop_key,
            boarding_side_key: candidate.boarding_side_key,
            side_group: candidate.side_group,
            direction_key: candidate.direction_key,
            primary_name_my: candidate.primary_name_my,
            primary_name_en: candidate.primary_name_en,
            area_text_my: candidate.area_text_my,
            area_text_en: candidate.area_text_en,
            normalized_fields: candidate.normalized_fields,
            usage_count: candidate.usage_count,
            shared_terminal: candidate.shared_terminal,
            source_external_ids: candidate.usages.map((usage) => usage.source_external_id),
        };

        const match = matchStopCandidate(matchInput, catalog);
        const geometryAnchor = buildGeometryAnchorFields(match, catalog);

        return enrichStopResolutionPlan(candidate, match, geometryAnchor, primaryUsage);
    });

    const oppositeDirectionReport = applyOppositeDirectionStopReusePolicy(plans, allUsages);
    const stopIdentityMetrics = computeStopIdentityMetrics(plans, allUsages, catalog);

    const manualReviewReports = buildManualReviewReports(plans, allUsages);

    const stopUsagesPath = path.join(dbPrepDir, "stop-usages.json");
    const stopCandidatesPath = path.join(dbPrepDir, "stop-candidates.json");
    const stopResolutionPlanPath = path.join(dbPrepDir, "stop-resolution-plan.json");
    const reportJsonPath = path.join(reportsDir, "phase6-stop-resolution-report.json");
    const reportMarkdownPath = path.join(reportsDir, "phase6-stop-resolution-report.md");

    fs.writeFileSync(
        stopUsagesPath,
        `${JSON.stringify(
            {
                schema_version: PHASE6_SCHEMA_VERSION,
                generated_at: new Date().toISOString(),
                run_root: runRoot,
                input_dir: inputDir,
                total_stop_usages: allUsages.length,
                usages: allUsages,
            },
            null,
            2,
        )}\n`,
        "utf8",
    );

    fs.writeFileSync(
        stopCandidatesPath,
        `${JSON.stringify(
            {
                schema_version: PHASE6_SCHEMA_VERSION,
                generated_at: new Date().toISOString(),
                run_root: runRoot,
                unique_stop_candidates: candidates.length,
                candidates,
            },
            null,
            2,
        )}\n`,
        "utf8",
    );

    fs.writeFileSync(
        stopResolutionPlanPath,
        `${JSON.stringify(
            {
                schema_version: PHASE6_SCHEMA_VERSION,
                generated_at: new Date().toISOString(),
                run_root: runRoot,
                input_dir: inputDir,
                supabase_catalog: {
                    loaded_at: catalog.loaded_at,
                    database_url_host: catalog.database_url_host,
                    existing_stop_count: catalog.stops.length,
                    skipped_supabase: skippedSupabase,
                },
                same_name_different_area_groups: sameNameDifferentAreaGroups,
                plans,
            },
            null,
            2,
        )}\n`,
        "utf8",
    );

    const report: Phase6StopResolutionReport = {
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        input_dir: inputDir,
        input_source: inputSource,
        db_prep_dir: dbPrepDir,
        supabase_catalog: {
            loaded_at: skippedSupabase ? null : catalog.loaded_at,
            database_url_host: catalog.database_url_host,
            existing_stop_count: catalog.stops.length,
            existing_source_link_count: catalog.source_link_by_external_id.size,
            skipped_supabase: skippedSupabase,
        },
        summary: {
            route_files_processed: routeFiles.length,
            total_stop_usages: allUsages.length,
            unique_stop_candidates: candidates.length,
            reuse_existing_stop: countDecision(plans, "reuse_existing_stop"),
            create_new_stop: countDecision(plans, "create_new_stop"),
            merge_additional_data_to_existing: countDecision(
                plans,
                "merge_additional_data_to_existing",
            ),
            needs_manual_review: countDecision(plans, "needs_manual_review"),
            dashboard_review_required: countDecision(plans, "dashboard_review_required"),
            held_for_review_count: manualReviewReports.held_for_review_count,
            would_create_placeholder_stop_count:
                manualReviewReports.would_create_placeholder_stop_count,
            manual_review_stops_by_route: manualReviewReports.manual_review_stops_by_route,
            manual_review_stops_by_reason: manualReviewReports.manual_review_stops_by_reason,
            blocked_conflict: countDecision(plans, "blocked_conflict"),
            blocked_missing_clean_name: countDecision(plans, "blocked_missing_clean_name"),
            geometry_anchors_available: plans.filter((plan) => plan.can_use_as_geometry_anchor).length,
            geometry_anchors_from_reuse: plans.filter(
                (plan) =>
                    plan.can_use_as_geometry_anchor && plan.decision === "reuse_existing_stop",
            ).length,
            geometry_anchors_from_merge: plans.filter(
                (plan) =>
                    plan.can_use_as_geometry_anchor &&
                    plan.decision === "merge_additional_data_to_existing",
            ).length,
            matched_stops_without_geometry: plans.filter(
                (plan) =>
                    plan.existing_stop_id !== null &&
                    !plan.can_use_as_geometry_anchor &&
                    (plan.decision === "reuse_existing_stop" ||
                        plan.decision === "merge_additional_data_to_existing"),
            ).length,
            top_shared_stops: plans
                .slice()
                .sort((left, right) => right.usage_count - left.usage_count)
                .slice(0, 20)
                .map((plan) => ({
                    candidate_id: plan.candidate_id,
                    primary_name_my: plan.primary_name_my,
                    primary_name_en: plan.primary_name_en,
                    usage_count: plan.usage_count,
                    routes_seen: plan.routes_seen,
                    decision: plan.decision,
                })),
            same_name_different_area_groups: sameNameDifferentAreaGroups,
            direction_split_stop_count,
            opposite_direction_reuse_prevented_count:
                oppositeDirectionReport.opposite_direction_reuse_prevented_count,
            possible_shared_terminal_count: oppositeDirectionReport.possible_shared_terminal_count,
            still_shared_stop_count: oppositeDirectionReport.still_shared_stop_count,
            opposite_direction_shared_stops: oppositeDirectionReport.opposite_direction_shared_stops,
            ...stopIdentityMetrics,
        },
    };

    fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportMarkdownPath, `${renderReportMarkdown(report)}\n`, "utf8");

    return report;
}

function parseCliArgs(argv: string[]): BuildStopResolutionOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let databaseUrl: string | undefined;
    let skipSupabase = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--skip-supabase") {
            skipSupabase = true;
        }
    }

    return { runRoot, databaseUrl, skipSupabase };
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const report = await buildStopResolution(parseCliArgs(process.argv.slice(2)));

    console.log("Phase 6 stop resolution complete.");
    console.log(`Route files processed: ${report.summary.route_files_processed}`);
    console.log(`Total stop usages: ${report.summary.total_stop_usages}`);
    console.log(`Unique stop candidates: ${report.summary.unique_stop_candidates}`);
    console.log(`reuse_existing_stop: ${report.summary.reuse_existing_stop}`);
    console.log(`create_new_stop: ${report.summary.create_new_stop}`);
    console.log(
        `merge_additional_data_to_existing: ${report.summary.merge_additional_data_to_existing}`,
    );
    console.log(`needs_manual_review: ${report.summary.needs_manual_review}`);
    console.log(`dashboard_review_required: ${report.summary.dashboard_review_required}`);
    console.log(`held_for_review_count: ${report.summary.held_for_review_count}`);
    console.log(
        `would_create_placeholder_stop_count: ${report.summary.would_create_placeholder_stop_count}`,
    );
    console.log(`blocked_conflict: ${report.summary.blocked_conflict}`);
    console.log(`blocked_missing_clean_name: ${report.summary.blocked_missing_clean_name}`);
    console.log(`geometry_anchors_available: ${report.summary.geometry_anchors_available}`);
    console.log(`geometry_anchors_from_reuse: ${report.summary.geometry_anchors_from_reuse}`);
    console.log(`geometry_anchors_from_merge: ${report.summary.geometry_anchors_from_merge}`);
    console.log(`matched_stops_without_geometry: ${report.summary.matched_stops_without_geometry}`);

    if (report.supabase_catalog.skipped_supabase) {
        console.log("Supabase matching was skipped (no database URL or --skip-supabase).");
    } else {
        console.log(
            `Supabase catalog: ${report.supabase_catalog.existing_stop_count} stops, ${report.supabase_catalog.existing_source_link_count} source links`,
        );
    }

    if (report.summary.same_name_different_area_groups.length > 0) {
        console.log(
            `Same-name different-area groups: ${report.summary.same_name_different_area_groups.length}`,
        );
    }
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
