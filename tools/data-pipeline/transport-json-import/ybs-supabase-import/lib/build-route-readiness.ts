/**
 * Build per-route readiness reports from a Phase 8 dry-run plan.
 */

import type { RoutesWithGeometryOutput } from "../../ybs-db-prepare/prepare-geometry.js";
import type { StopResolutionPlanEntry } from "../../ybs-db-prepare/build-stop-resolution.js";
import type { DryRunPlan, PlanAction, PlanBlocker, PlanConflict, PlanWarning } from "./import-plan-types.js";
import {
    computeBulkImportReadiness,
    computeRiskLevel,
    filterRouteBlockers,
    filterRouteWarnings,
    resolveRoutePolicy,
    type RouteReadinessReport,
} from "./route-import-policy.js";
import type { SupabaseCatalog } from "./supabase-schema-map.js";
import { isMergeableReviewStatus } from "./supabase-schema-map.js";

export type BuildRouteReadinessInput = {
    runRoot: string;
    plan: DryRunPlan;
    geometry: RoutesWithGeometryOutput;
    resolutionPlans: StopResolutionPlanEntry[];
    catalog: SupabaseCatalog;
    replaceExistingUnreviewedRouteStops: boolean;
};

function routeActions(plan: DryRunPlan, routeCode: string): PlanAction[] {
    const token = `:${routeCode}`;
    return plan.actions.filter((action) => {
        const external = action.external_id ?? "";
        const ref = action.entity_ref ?? "";
        const payloadRouteCode = action.payload?.route_code;
        return (
            external.includes(token) ||
            ref.includes(token) ||
            payloadRouteCode === routeCode
        );
    });
}

function countAction(actions: PlanAction[], actionType: string): number {
    return actions.filter((action) => action.action === actionType).length;
}

function routeConflicts(conflicts: PlanConflict[], routeCode: string): PlanConflict[] {
    return conflicts.filter((conflict) => conflict.route_code === routeCode);
}

function candidateIdsForRoute(
    geometry: RoutesWithGeometryOutput,
    routeCode: string,
): Set<string> {
    return new Set(
        geometry.route_stops
            .filter((item) => item.route_code === routeCode)
            .map((item) => item.candidate_id),
    );
}

export function buildRouteReadinessReports(
    input: BuildRouteReadinessInput,
): RouteReadinessReport[] {
    const routeCodes = [
        ...new Set(input.geometry.prepared_routes.map((route) => String(route.route_code))),
    ];

    return routeCodes.map((routeCode) => {
        const existingRoute = input.catalog.routes_by_code.get(routeCode) ?? null;
        const existsInSupabase = existingRoute !== null;
        const reviewStatus = existingRoute?.review_status ?? null;
        const policy = resolveRoutePolicy(
            existsInSupabase,
            reviewStatus,
            input.replaceExistingUnreviewedRouteStops,
        );

        const actions = routeActions(input.plan, routeCode);
        const blockers = filterRouteBlockers(input.plan.blockers, routeCode);
        const warnings = filterRouteWarnings(input.plan.warnings, routeCode);
        const conflicts = routeConflicts(input.plan.conflicts, routeCode);
        const candidateIds = candidateIdsForRoute(input.geometry, routeCode);

        const resolutionForRoute = input.resolutionPlans.filter((plan) =>
            candidateIds.has(plan.candidate_id),
        );

        const manual_review_stops_count = resolutionForRoute.filter(
            (plan) =>
                plan.decision === "dashboard_review_required" ||
                plan.decision === "needs_manual_review" ||
                (plan.decision === "create_new_stop" && plan.duplicate_review_required),
        ).length;

        const held_for_review_count = resolutionForRoute.filter(
            (plan) => plan.decision === "dashboard_review_required",
        ).length;

        const geometryReport = input.plan.route_geometry_reports.find(
            (report) => report.route_code === routeCode,
        );
        const placeholderCount = geometryReport?.placeholder_stop_geometry_count ?? 0;

        const new_stops_count = resolutionForRoute.filter(
            (plan) => plan.decision === "create_new_stop",
        ).length;
        const reused_stops_count = resolutionForRoute.filter(
            (plan) =>
                plan.decision === "reuse_existing_stop" ||
                plan.decision === "merge_additional_data_to_existing",
        ).length;
        const source_links_to_create = actions.filter(
            (action) => action.action === "insert_source_link",
        ).length;
        const source_links_to_reuse = actions.filter(
            (action) => action.action === "reuse_source_link",
        ).length;

        const skippedProtected = actions.some((action) => action.action === "skip_protected_route");
        const hasRouteBlockers = blockers.length > 0;

        const reasons: string[] = [];
        if (skippedProtected) {
            reasons.push("Existing route is protected; import is comparison-only.");
        }
        if (hasRouteBlockers) {
            reasons.push(`${blockers.length} blocker(s) for this route.`);
        }
        if (held_for_review_count > 0) {
            reasons.push(
                `${held_for_review_count} stop(s) will import as placeholder stops for dashboard review.`,
            );
        }
        if (manual_review_stops_count > 0) {
            reasons.push(`${manual_review_stops_count} stop(s) need manual duplicate review.`);
        }
        if (placeholderCount > 0) {
            reasons.push(`${placeholderCount} stop(s) use placeholder/review geometry.`);
        }

        const risk_level = computeRiskLevel({
            blockers_count: blockers.length,
            manual_review_stops_count,
            held_for_review_count,
            placeholder_geometry_count: placeholderCount,
            route_policy: policy.route_policy,
            conflicts_count: conflicts.length,
        });

        const executable =
            !skippedProtected &&
            !hasRouteBlockers &&
            policy.route_policy !== "comparison_only_protected" &&
            policy.route_policy !== "skip_protected_route" &&
            (!existsInSupabase || isMergeableReviewStatus(reviewStatus));

        return {
            route_code: routeCode,
            executable,
            route_policy: policy.route_policy,
            existing_route_update_mode: policy.existing_route_update_mode,
            exists_in_supabase: existsInSupabase,
            existing_review_status: reviewStatus,
            new_stops_count,
            reused_stops_count,
            manual_review_stops_count,
            held_for_review_count,
            placeholder_geometry_count: placeholderCount,
            source_links_to_create,
            source_links_to_reuse,
            blockers_count: blockers.length,
            warnings_count: warnings.length,
            conflicts_count: conflicts.length,
            risk_level,
            reasons,
        };
    });
}

export function attachBulkImportReadiness(
    runRoot: string,
    routeReports: RouteReadinessReport[],
) {
    return computeBulkImportReadiness(runRoot, routeReports);
}
