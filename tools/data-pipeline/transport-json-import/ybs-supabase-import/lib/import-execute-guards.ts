/**
 * Pre-execute safety guards for YBS Supabase import.
 *
 * Read-only checks against the Phase 8 plan and live database state.
 */

import type pg from "pg";

import {
    findLinkedEntityId,
    sourceLinkConflict,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
    type SourceLinkEntityType,
} from "./source-link-utils.js";

export type GuardPlanAction = {
    action: string;
    entity_type: string;
    external_id: string | null;
    entity_ref: string;
    existing_entity_id?: number | null;
    payload: Record<string, unknown>;
    reason?: string;
};

export type PlanBlocker = {
    code: string;
    message: string;
    route_code?: string;
    variant_code?: string;
    candidate_id?: string;
};

export type PlanSummary = {
    routes_to_insert?: number;
    routes_to_update?: number;
    route_variants_to_insert?: number;
    route_stops_to_insert?: number;
    route_paths_to_insert?: number;
    source_links_to_create?: number;
};

export type ExecuteGuardPlan = {
    blockers?: PlanBlocker[];
    summary?: PlanSummary;
    actions?: GuardPlanAction[];
};

export type ExecuteGuardOptions = {
    client: pg.PoolClient;
    routeCode: string;
    routeActions: GuardPlanAction[];
    stopActions: GuardPlanAction[];
    plan: ExecuteGuardPlan;
    replaceExistingUnreviewedRouteStops?: boolean;
};

export type ExecuteGuardResult = {
    safe: boolean;
    violations: string[];
};

function routeScopedActions(routeCode: string, routeActions: GuardPlanAction[], stopActions: GuardPlanAction[]): GuardPlanAction[] {
    return [...routeActions, ...stopActions];
}

function countAction(actions: GuardPlanAction[], actionType: string): number {
    return actions.filter((action) => action.action === actionType).length;
}

function routeDecisionAction(routeActions: GuardPlanAction[]): GuardPlanAction | undefined {
    return (
        routeActions.find((action) => action.entity_type === "route" && action.action === "insert_route") ??
        routeActions.find((action) => action.entity_type === "route" && action.action === "update_unreviewed_route") ??
        routeActions.find((action) => action.entity_type === "route" && action.action === "skip_protected_route")
    );
}

function geometryMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
    const geometry = value?.geometry;
    return geometry && typeof geometry === "object" ? (geometry as Record<string, unknown>) : {};
}

function isReviewGeometryPayload(payload: Record<string, unknown> | undefined): boolean {
    const metadata = geometryMetadata(payload?.normalized_data as Record<string, unknown> | undefined);
    return (
        metadata.public_safe === false ||
        metadata.validator_required === true ||
        metadata.needs_geometry_review === true ||
        metadata.geometry_quality === "placeholder" ||
        metadata.geometry_quality === "interpolated"
    );
}

function validatePlaceholderGeometry(actions: GuardPlanAction[]): string[] {
    const violations: string[] = [];

    for (const action of actions) {
        if (action.action !== "insert_stop" && action.action !== "insert_route_path") {
            continue;
        }

        if (!isReviewGeometryPayload(action.payload)) {
            continue;
        }

        const reviewStatus = String(action.payload.review_status ?? "");
        const normalized = action.payload.normalized_data as Record<string, unknown> | undefined;
        const metadata = geometryMetadata(normalized);
        const entity = `${action.entity_type}:${action.external_id ?? action.entity_ref}`;

        if (reviewStatus !== "needs_review") {
            violations.push(
                `Placeholder geometry for ${entity} must have review_status=needs_review (found ${reviewStatus || "missing"}).`,
            );
        }
        if (metadata.public_safe !== false) {
            violations.push(`Placeholder geometry for ${entity} must set public_safe=false.`);
        }
        if (metadata.validator_required !== true) {
            violations.push(`Placeholder geometry for ${entity} must set validator_required=true.`);
        }
    }

    return violations;
}

function duplicatePlanKeys(actions: GuardPlanAction[]): string[] {
    const violations: string[] = [];
    const variantKeys = new Set<string>();
    const routeStopKeys = new Set<string>();

    for (const action of actions) {
        if (action.action === "insert_route_variant") {
            const variantCode = String(action.payload.variant_code ?? "");
            const key = `${action.payload.route_ref ?? ""}::${variantCode}`;
            if (variantKeys.has(key)) {
                violations.push(`Duplicate insert_route_variant planned for ${variantCode}.`);
            }
            variantKeys.add(key);
        }

        if (action.action === "insert_route_stop") {
            const variantRef = String(action.payload.variant_ref ?? "");
            const sequence = Number(action.payload.stop_sequence);
            const key = `${variantRef}::${sequence}`;
            if (routeStopKeys.has(key)) {
                violations.push(
                    `Duplicate insert_route_stop planned for ${variantRef} sequence ${sequence}.`,
                );
            }
            routeStopKeys.add(key);
        }
    }

    return violations;
}

export async function validateExecuteGuards(options: ExecuteGuardOptions): Promise<ExecuteGuardResult> {
    const violations: string[] = [];
    const { routeCode, routeActions, stopActions, plan, client } = options;
    const allActions = routeScopedActions(routeCode, routeActions, stopActions);
    const routeAction = routeDecisionAction(routeActions);

    const routeBlockers = (plan.blockers ?? []).filter(
        (blocker) => blocker.route_code === routeCode,
    );
    for (const blocker of routeBlockers) {
        violations.push(`Plan blocker [${blocker.code}]: ${blocker.message}`);
    }

    const routeRow = await client.query<{ id: string; review_status: string }>(
        `SELECT id::text, review_status FROM transport.routes WHERE route_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [routeCode],
    );
    const routeExists = Boolean(routeRow.rows[0]);
    const routeId = routeRow.rows[0] ? Number(routeRow.rows[0].id) : null;
    const routeReviewStatus = routeRow.rows[0]?.review_status ?? null;

    if (routeAction?.action === "insert_route" && routeExists) {
        violations.push(
            `Route ${routeCode} already exists in Supabase (id=${routeId}); plan must not use insert_route.`,
        );
    }

    if (routeAction?.action === "update_unreviewed_route" && !routeExists) {
        violations.push(
            `Route ${routeCode} does not exist in Supabase; plan must not use update_unreviewed_route.`,
        );
    }

    if (!routeExists && routeAction?.action === "insert_route") {
        const variantsToInsert = countAction(allActions, "insert_route_variant");
        const routeStopsToInsert = countAction(allActions, "insert_route_stop");
        const routePathsToInsert = countAction(allActions, "insert_route_path");
        const sourceLinksToCreate = countAction(allActions, "insert_source_link");

        if (
            variantsToInsert === 0 &&
            routeStopsToInsert === 0 &&
            routePathsToInsert === 0 &&
            sourceLinksToCreate === 0
        ) {
            violations.push(
                `New route ${routeCode} has nothing to insert (variants, route_stops, route_paths, source_links all zero).`,
            );
        }
    }

    violations.push(...duplicatePlanKeys(allActions));
    violations.push(...validatePlaceholderGeometry(allActions));

    if (
        routeExists &&
        routeReviewStatus &&
        ["reviewed", "verified", "manual_protected"].includes(routeReviewStatus) &&
        options.replaceExistingUnreviewedRouteStops
    ) {
        violations.push(
            `Route ${routeCode} is ${routeReviewStatus}; --replace-existing-unreviewed-route-stops is not allowed.`,
        );
    }

    for (const action of allActions) {
        if (action.action !== "insert_source_link" || !action.external_id) {
            continue;
        }

        const entityType = action.entity_type as SourceLinkEntityType;
        const plannedEntityId =
            action.existing_entity_id !== null && action.existing_entity_id !== undefined
                ? Number(action.existing_entity_id)
                : null;

        const conflict = await sourceLinkConflict(client, {
            entityType,
            externalId: action.external_id,
            plannedEntityId,
        });
        if (conflict) {
            violations.push(conflict);
        }
    }

    if (routeId) {
        const variantActions = allActions.filter((action) => action.action === "insert_route_variant");
        for (const action of variantActions) {
            const variantCode = String(action.payload.variant_code ?? "");
            const existingVariant = await client.query<{ id: string }>(
                `
                SELECT id::text
                FROM transport.route_variants
                WHERE route_id = $1 AND variant_code = $2 AND deleted_at IS NULL
                LIMIT 1
                `,
                [routeId, variantCode],
            );
            if (existingVariant.rows[0] && action.external_id) {
                const linkedId = await findLinkedEntityId(client, "route_variant", action.external_id);
                if (
                    linkedId !== null &&
                    linkedId !== Number(existingVariant.rows[0].id)
                ) {
                    violations.push(
                        `route_variant ${variantCode} source_link points to entity ${linkedId} but DB variant is ${existingVariant.rows[0].id}.`,
                    );
                }
            }
        }

        const variantRows = await client.query<{ id: string; variant_code: string }>(
            `SELECT id::text, variant_code FROM transport.route_variants WHERE route_id = $1 AND deleted_at IS NULL`,
            [routeId],
        );
        const variantIdByRef = new Map<string, number>();
        for (const action of allActions) {
            if (action.action === "insert_route_variant" && action.entity_ref) {
                const existing = variantRows.rows.find(
                    (row) => row.variant_code === String(action.payload.variant_code ?? ""),
                );
                if (existing) {
                    variantIdByRef.set(action.entity_ref, Number(existing.id));
                }
            }
        }

        for (const action of allActions) {
            if (action.action !== "insert_route_stop") {
                continue;
            }
            const variantRef = String(action.payload.variant_ref ?? "");
            const variantId = variantIdByRef.get(variantRef);
            if (!variantId) {
                continue;
            }
            const sequence = Number(action.payload.stop_sequence);
            const duplicates = await client.query<{ count: string }>(
                `
                SELECT count(*)::text
                FROM transport.route_stops
                WHERE route_variant_id = $1 AND stop_sequence = $2
                `,
                [variantId, sequence],
            );
            const count = Number(duplicates.rows[0]?.count ?? 0);
            if (count > 1) {
                violations.push(
                    `route_stop unique violation: variant ${variantRef} sequence ${sequence} has ${count} rows.`,
                );
            }
        }
    }

    return {
        safe: violations.length === 0,
        violations,
    };
}

export function refuseAllRoutesWithoutMaxRoutes(input: {
    routeCodes: string[];
    maxRoutesExplicit: boolean;
}): string | null {
    if (input.routeCodes.length > 1 && !input.maxRoutesExplicit) {
        return "Refusing multi-route execute without explicit --max-routes.";
    }
    return null;
}

export type RouteExecuteSafety = {
    route_code: string;
    safe_to_execute: boolean;
    violations: string[];
    plan_decision: string | null;
    exists_in_supabase: boolean;
};

export function assessRouteExecuteSafetyFromPlan(input: {
    routeCode: string;
    existsInSupabase: boolean;
    planDecision: string | null;
    routeBlockers: string[];
    executable: boolean;
    riskLevel: string;
}): RouteExecuteSafety {
    const violations: string[] = [...input.routeBlockers];

    if (!input.executable) {
        violations.push(`Route readiness reports executable=false (risk=${input.riskLevel}).`);
    }

    if (!input.existsInSupabase && input.planDecision === "update_unreviewed_route") {
        violations.push("Plan uses update_unreviewed_route but route does not exist.");
    }

    if (input.existsInSupabase && input.planDecision === "insert_route") {
        violations.push("Plan uses insert_route but route already exists.");
    }

    if (!input.existsInSupabase && input.planDecision !== "insert_route") {
        violations.push(`New route must use insert_route (found ${input.planDecision ?? "none"}).`);
    }

    return {
        route_code: input.routeCode,
        safe_to_execute: violations.length === 0,
        violations,
        plan_decision: input.planDecision,
        exists_in_supabase: input.existsInSupabase,
    };
}

export type ImportSafetyReport = {
    SAFE_TO_EXECUTE_YBS2: boolean;
    SAFE_TO_UPDATE_YBS1: boolean;
    SAFE_FOR_BULK_IMPORT: boolean;
    ybs2: RouteExecuteSafety;
    ybs1: RouteExecuteSafety;
    bulk_import_status: string;
    notes: string[];
};

export function buildImportSafetyReport(input: {
    existingRoute: string;
    newRoute: string;
    ybs1: RouteExecuteSafety;
    ybs2: RouteExecuteSafety;
    bulkImportStatus: string;
    phase10Passed: boolean;
}): ImportSafetyReport {
    const notes: string[] = [];

    const safeToExecuteYbs2 =
        input.ybs2.safe_to_execute &&
        !input.ybs2.exists_in_supabase &&
        input.ybs2.plan_decision === "insert_route";

    const safeToUpdateYbs1 =
        input.ybs1.safe_to_execute &&
        input.ybs1.exists_in_supabase &&
        input.ybs1.plan_decision === "update_unreviewed_route";

    const safeForBulkImport =
        input.bulkImportStatus === "READY_FOR_SMALL_BATCH_IMPORT" &&
        input.phase10Passed &&
        safeToExecuteYbs2;

    if (!safeToExecuteYbs2) {
        notes.push(`${input.newRoute} is not safe to execute yet. Review execute guard violations.`);
    }
    if (!safeToUpdateYbs1) {
        notes.push(
            `${input.existingRoute} requires an explicit update import command; default append-only updates are not auto-executed.`,
        );
    }
    if (!safeForBulkImport) {
        notes.push("Bulk import remains blocked until small-batch test imports pass validation.");
    }

    return {
        SAFE_TO_EXECUTE_YBS2: safeToExecuteYbs2,
        SAFE_TO_UPDATE_YBS1: safeToUpdateYbs1,
        SAFE_FOR_BULK_IMPORT: safeForBulkImport,
        ybs2: input.ybs2,
        ybs1: input.ybs1,
        bulk_import_status: input.bulkImportStatus,
        notes,
    };
}

export { YBS_SOURCE_NAME, YBS_SOURCE_KIND };
