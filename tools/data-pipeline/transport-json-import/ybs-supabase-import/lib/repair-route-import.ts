/**
 * Repair already-imported YBS routes: backfill missing source_links,
 * fix public visibility, and record duplicate-stop sequence metadata.
 */

import type pg from "pg";

import {
    ensureSourceLink,
    findLinkedEntityId,
    type SourceLinkEntityType,
} from "./source-link-utils.js";
import {
    ROUTE_PATH_KIND_CORRIDOR_ESTIMATE,
    selectRouteActions,
    type DryRunPlan,
    type PlanAction,
} from "./import-executor.js";

const PUBLIC_VISIBLE_REVIEW_STATUSES = new Set(["reviewed", "verified"]);

export type RepairResult = {
    route_code: string;
    source_links_inserted: number;
    source_links_reused: number;
    source_links_skipped: number;
    duplicate_stop_skips_recorded: number;
    public_visibility_fixed: boolean;
    errors: string[];
};

async function resolveRouteStopId(
    client: pg.PoolClient,
    variantId: number,
    sequence: number,
    stopId: number | null,
): Promise<number | null> {
    const bySequence = await client.query<{ id: string }>(
        `
        SELECT id::text
        FROM transport.route_stops
        WHERE route_variant_id = $1 AND stop_sequence = $2
        LIMIT 1
        `,
        [variantId, sequence],
    );
    if (bySequence.rows[0]) {
        return Number(bySequence.rows[0].id);
    }

    if (stopId !== null) {
        const byStop = await client.query<{ id: string }>(
            `
            SELECT id::text
            FROM transport.route_stops
            WHERE route_variant_id = $1 AND stop_id = $2
            LIMIT 1
            `,
            [variantId, stopId],
        );
        if (byStop.rows[0]) {
            return Number(byStop.rows[0].id);
        }
    }

    return null;
}

async function buildEntityRefMap(
    client: pg.PoolClient,
    plan: DryRunPlan,
    routeCode: string,
): Promise<{ refMap: Map<string, number>; duplicateSkips: Array<{
    variant_id: number;
    sequence: number;
    stop_id: number;
    existing_sequence: number;
}> }> {
    const refMap = new Map<string, number>();
    const duplicateSkips: Array<{
        variant_id: number;
        sequence: number;
        stop_id: number;
        existing_sequence: number;
    }> = [];

    const routeRow = await client.query<{ id: string; review_status: string }>(
        `
        SELECT id::text, review_status
        FROM transport.routes
        WHERE route_code = $1 AND deleted_at IS NULL
        LIMIT 1
        `,
        [routeCode],
    );
    if (!routeRow.rows[0]) {
        throw new Error(`Route ${routeCode} not found.`);
    }
    const routeId = Number(routeRow.rows[0].id);

    for (const action of plan.actions) {
        if (action.entity_type === "route" && action.payload.route_code === routeCode) {
            refMap.set(action.entity_ref, routeId);
        }
    }

    const variants = await client.query<{ id: string; variant_code: string }>(
        `
        SELECT id::text, variant_code
        FROM transport.route_variants
        WHERE route_id = $1 AND deleted_at IS NULL
        `,
        [routeId],
    );
    const variantByCode = new Map(variants.rows.map((row) => [row.variant_code, Number(row.id)]));

    for (const action of selectRouteActions(plan, routeCode)) {
        if (action.entity_type !== "route_variant") {
            continue;
        }
        const variantCode = String(action.payload.variant_code ?? "");
        const variantId = variantByCode.get(variantCode);
        if (variantId) {
            refMap.set(action.entity_ref, variantId);
        }
    }

    for (const action of plan.actions) {
        if (action.entity_type !== "stop") {
            continue;
        }
        if (!action.external_id) {
            continue;
        }
        const linkedStopId = await findLinkedEntityId(client, "stop", action.external_id);
        if (linkedStopId) {
            refMap.set(action.entity_ref, linkedStopId);
        }
    }

    for (const action of selectRouteActions(plan, routeCode)) {
        if (action.action !== "insert_route_stop") {
            continue;
        }
        const variantRef = String(action.payload.variant_ref ?? "");
        const variantId = refMap.get(variantRef);
        if (!variantId) {
            continue;
        }
        const stopRef = String(action.payload.stop_ref ?? "");
        const stopId = refMap.get(stopRef) ?? null;
        const sequence = Number(action.payload.stop_sequence);
        const routeStopId = await resolveRouteStopId(client, variantId, sequence, stopId);
        if (routeStopId) {
            refMap.set(action.entity_ref, routeStopId);
            if (stopId !== null) {
                const bySequence = await client.query<{ id: string }>(
                    `
                    SELECT id::text
                    FROM transport.route_stops
                    WHERE route_variant_id = $1 AND stop_sequence = $2
                    LIMIT 1
                    `,
                    [variantId, sequence],
                );
                if (!bySequence.rows[0]) {
                    const existingSequence = await client.query<{ stop_sequence: number }>(
                        `
                        SELECT stop_sequence::int
                        FROM transport.route_stops
                        WHERE route_variant_id = $1 AND stop_id = $2
                        LIMIT 1
                        `,
                        [variantId, stopId],
                    );
                    if (existingSequence.rows[0]) {
                        duplicateSkips.push({
                            variant_id: variantId,
                            sequence,
                            stop_id: stopId,
                            existing_sequence: existingSequence.rows[0].stop_sequence,
                        });
                    }
                }
            }
        }
    }

    for (const action of selectRouteActions(plan, routeCode)) {
        if (action.action !== "insert_route_path") {
            continue;
        }
        const variantRef = String(action.payload.variant_ref ?? "");
        const variantId = refMap.get(variantRef);
        if (!variantId) {
            continue;
        }
        const existingPath = await client.query<{ id: string }>(
            `
            SELECT id::text
            FROM transport.route_paths
            WHERE route_variant_id = $1
              AND path_kind = $2
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [variantId, ROUTE_PATH_KIND_CORRIDOR_ESTIMATE],
        );
        if (existingPath.rows[0]) {
            refMap.set(action.entity_ref, Number(existingPath.rows[0].id));
        }
    }

    return { refMap, duplicateSkips };
}

async function persistDuplicateStopSkips(
    client: pg.PoolClient,
    skips: Array<{
        variant_id: number;
        sequence: number;
        stop_id: number;
        existing_sequence: number;
    }>,
): Promise<number> {
    if (skips.length === 0) {
        return 0;
    }

    const byVariant = new Map<number, typeof skips>();
    for (const skip of skips) {
        const list = byVariant.get(skip.variant_id) ?? [];
        list.push(skip);
        byVariant.set(skip.variant_id, list);
    }

    for (const [variantId, variantSkips] of byVariant) {
        const metadata = {
            import_metadata: {
                skipped_duplicate_stop_sequences: variantSkips.map((skip) => ({
                    sequence: skip.sequence,
                    stop_id: skip.stop_id,
                    existing_sequence: skip.existing_sequence,
                })),
            },
        };
        await client.query(
            `
            UPDATE transport.route_variants
            SET normalized_data = COALESCE(normalized_data, '{}'::jsonb) || $2::jsonb,
                updated_at = now()
            WHERE id = $1
            `,
            [variantId, JSON.stringify(metadata)],
        );
    }

    return skips.length;
}

async function repairPublicVisibility(
    client: pg.PoolClient,
    routeCode: string,
): Promise<boolean> {
    const result = await client.query<{ review_status: string; is_active: boolean }>(
        `
        SELECT review_status, is_active
        FROM transport.routes
        WHERE route_code = $1 AND deleted_at IS NULL
        LIMIT 1
        `,
        [routeCode],
    );
    const route = result.rows[0];
    if (!route) {
        return false;
    }

    const shouldBeActive = PUBLIC_VISIBLE_REVIEW_STATUSES.has(route.review_status);
    if (route.is_active === shouldBeActive) {
        return false;
    }

    await client.query(
        `
        UPDATE transport.routes
        SET is_active = $2, updated_at = now()
        WHERE route_code = $1 AND deleted_at IS NULL
        `,
        [routeCode, shouldBeActive],
    );
    return true;
}

export async function repairRouteImport(options: {
    client: pg.PoolClient;
    plan: DryRunPlan;
    routeCode: string;
    importBatchId?: number | null;
}): Promise<RepairResult> {
    const { client, plan, routeCode } = options;
    const result: RepairResult = {
        route_code: routeCode,
        source_links_inserted: 0,
        source_links_reused: 0,
        source_links_skipped: 0,
        duplicate_stop_skips_recorded: 0,
        public_visibility_fixed: false,
        errors: [],
    };

    const { refMap, duplicateSkips } = await buildEntityRefMap(client, plan, routeCode);
    result.duplicate_stop_skips_recorded = await persistDuplicateStopSkips(client, duplicateSkips);
    result.public_visibility_fixed = await repairPublicVisibility(client, routeCode);

    const sourceLinkActions = selectRouteActions(plan, routeCode).filter(
        (action) => action.action === "insert_source_link" || action.action === "reuse_source_link",
    );

    for (const action of sourceLinkActions) {
        const entityId = refMap.get(action.entity_ref);
        if (!entityId || !action.external_id) {
            result.source_links_skipped++;
            result.errors.push(
                `Unresolved ${action.entity_type} for ${action.external_id} (ref ${action.entity_ref}).`,
            );
            continue;
        }

        try {
            const linkResult = await ensureSourceLink(client, {
                entityType: action.entity_type as SourceLinkEntityType,
                entityId,
                externalId: action.external_id,
                importBatchId: options.importBatchId ?? null,
                confidenceScore: 20,
                isPrimary: true,
                sourcePayload: {
                    entity_ref: action.entity_ref,
                    repaired: true,
                    ...action.payload,
                },
            });
            if (linkResult.status === "inserted") {
                result.source_links_inserted++;
            } else {
                result.source_links_reused++;
            }
        } catch (error) {
            result.source_links_skipped++;
            result.errors.push(
                `${action.external_id}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    return result;
}
