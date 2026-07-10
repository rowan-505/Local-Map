/**
 * Route import policy and readiness helpers for YBS bulk import safety.
 */

import type { PlanBlocker, PlanWarning } from "./import-plan-types.js";
import {
    isMergeableReviewStatus,
    isProtectedReviewStatus,
} from "./supabase-schema-map.js";

export const MANUAL_REVIEW_CONFIDENCE_SCORE = 5;

export type RoutePolicy =
    | "insert_new_route"
    | "append_missing_sequences_only"
    | "comparison_only_protected"
    | "skip_protected_route";

export type ExistingRouteUpdateMode =
    | "insert_new"
    | "append_missing_sequences_only"
    | "replace_unreviewed_route_stops"
    | "comparison_only";

export type ImportRiskLevel = "low" | "medium" | "high";

export type RouteReadinessReport = {
    route_code: string;
    executable: boolean;
    route_policy: RoutePolicy;
    existing_route_update_mode: ExistingRouteUpdateMode;
    exists_in_supabase: boolean;
    existing_review_status: string | null;
    new_stops_count: number;
    reused_stops_count: number;
    manual_review_stops_count: number;
    held_for_review_count: number;
    placeholder_geometry_count: number;
    source_links_to_create: number;
    source_links_to_reuse: number;
    blockers_count: number;
    warnings_count: number;
    conflicts_count: number;
    risk_level: ImportRiskLevel;
    reasons: string[];
};

export type BulkImportReadiness = {
    generated_at: string;
    run_root: string;
    overall_status:
        | "READY_FOR_TEST_IMPORT"
        | "READY_FOR_SMALL_BATCH_IMPORT"
        | "NOT_READY_FOR_BULK_IMPORT";
    routes: RouteReadinessReport[];
    summary: {
        total_routes: number;
        executable_routes: number;
        high_risk_routes: number;
        held_for_review_stops: number;
        manual_review_stops: number;
    };
};

export function resolveRoutePolicy(
    existsInSupabase: boolean,
    reviewStatus: string | null,
    replaceExistingUnreviewedRouteStops: boolean,
): { route_policy: RoutePolicy; existing_route_update_mode: ExistingRouteUpdateMode } {
    if (!existsInSupabase) {
        return {
            route_policy: "insert_new_route",
            existing_route_update_mode: "insert_new",
        };
    }

    if (isProtectedReviewStatus(reviewStatus)) {
        return {
            route_policy: "comparison_only_protected",
            existing_route_update_mode: "comparison_only",
        };
    }

    if (isMergeableReviewStatus(reviewStatus)) {
        return {
            route_policy: replaceExistingUnreviewedRouteStops
                ? "append_missing_sequences_only"
                : "append_missing_sequences_only",
            existing_route_update_mode: replaceExistingUnreviewedRouteStops
                ? "replace_unreviewed_route_stops"
                : "append_missing_sequences_only",
        };
    }

    return {
        route_policy: "skip_protected_route",
        existing_route_update_mode: "comparison_only",
    };
}

export function computeRiskLevel(input: {
    blockers_count: number;
    manual_review_stops_count: number;
    held_for_review_count: number;
    placeholder_geometry_count: number;
    route_policy: RoutePolicy;
    conflicts_count: number;
}): ImportRiskLevel {
    if (input.blockers_count > 0 || input.route_policy === "comparison_only_protected") {
        return "high";
    }

    if (
        input.held_for_review_count > 0 ||
        input.manual_review_stops_count >= 10 ||
        input.placeholder_geometry_count >= 80
    ) {
        return "high";
    }

    if (
        input.manual_review_stops_count > 0 ||
        input.placeholder_geometry_count > 0 ||
        input.conflicts_count > 0
    ) {
        return "medium";
    }

    return "low";
}

export function computeBulkImportReadiness(
    runRoot: string,
    routes: RouteReadinessReport[],
): BulkImportReadiness {
    const executableRoutes = routes.filter((route) => route.executable);
    const highRiskRoutes = routes.filter((route) => route.risk_level === "high");
    const heldForReviewStops = routes.reduce((sum, route) => sum + route.held_for_review_count, 0);
    const manualReviewStops = routes.reduce(
        (sum, route) => sum + route.manual_review_stops_count,
        0,
    );

    const routesWithBlockers = routes.filter((route) => route.blockers_count > 0);

    let overall_status: BulkImportReadiness["overall_status"] = "NOT_READY_FOR_BULK_IMPORT";
    if (executableRoutes.length >= 1 && routesWithBlockers.length === 0 && routes.length <= 2) {
        overall_status = "READY_FOR_TEST_IMPORT";
    } else if (executableRoutes.length >= 1 && routesWithBlockers.length === 0) {
        overall_status = "READY_FOR_SMALL_BATCH_IMPORT";
    }

    return {
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        overall_status,
        routes,
        summary: {
            total_routes: routes.length,
            executable_routes: executableRoutes.length,
            high_risk_routes: highRiskRoutes.length,
            held_for_review_stops: heldForReviewStops,
            manual_review_stops: manualReviewStops,
        },
    };
}

export function filterRouteBlockers(
    blockers: PlanBlocker[],
    routeCode: string,
): PlanBlocker[] {
    return blockers.filter((blocker) => blocker.route_code === routeCode);
}

export function filterRouteWarnings(
    warnings: PlanWarning[],
    routeCode: string,
): PlanWarning[] {
    return warnings.filter((warning) => warning.route_code === routeCode);
}
