/**
 * Phase 9 import executor for one YBS route.
 *
 * Applies one route from the Phase 8 dry-run plan into transport.* tables inside
 * a single transaction. Rolls back the whole route if a critical insert fails.
 *
 * Protection rule: never overwrite reviewed / verified / manual_protected rows.
 */

import type pg from "pg";

import { buildVariantCode } from "../../ybs-db-prepare/stop-normalize.js";
import {
    ensureSourceLink,
    findLinkedEntityId,
    sourceLinkExists,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
    type SourceLinkEntityType,
} from "./source-link-utils.js";
import { directionAwareStopExternalId } from "./supabase-schema-map.js";
import { validateExecuteGuards, type ExecuteGuardPlan } from "./import-execute-guards.js";

export { validateExecuteGuards } from "./import-execute-guards.js";
export type { ExecuteGuardResult, ImportSafetyReport } from "./import-execute-guards.js";

export const MODE_BUS = "bus";
export const ROUTE_KIND_URBAN = "urban";
export const STOP_TYPE_STOP = "stop";
export const CURRENCY_CODE_MMK = "MMK";
export const ROUTE_PATH_KIND_CORRIDOR_ESTIMATE = "corridor_estimate";

const PROTECTED_REVIEW_STATUSES = new Set(["reviewed", "verified", "manual_protected"]);
const PUBLIC_VISIBLE_REVIEW_STATUSES = new Set(["reviewed", "verified"]);

export type VariantRouteStopExpectation = {
    variantRef: string;
    variantCode: string;
    directionKey: string;
    expectedCount: number;
    expectedSequences: number[];
    routeStopActions: PlanAction[];
};

export type RouteStopCompletenessReport = {
    route_code: string;
    status: "passed" | "failed";
    variants: Array<{
        variant_code: string;
        direction_key: string;
        expected_stop_count_from_extraction: number;
        actual_route_stop_count: number;
        missing_sequences: number[];
        duplicate_sequences: number[];
        unresolved_stop_candidates: string[];
        status: "passed" | "failed";
    }>;
    violations: string[];
};

function routeIsActiveForPublic(reviewStatus: string): boolean {
    return PUBLIC_VISIBLE_REVIEW_STATUSES.has(reviewStatus);
}

function registerEntityRef(ctx: ExecutorContext, entityRef: string, entityId: number): void {
    if (entityRef) {
        ctx.refToEntityId.set(entityRef, entityId);
    }
}

export type PlanAction = {
    action: string;
    entity_type: string;
    external_id: string | null;
    entity_ref: string;
    existing_entity_id?: number | null;
    payload: Record<string, unknown>;
    reason?: string;
};

export type DryRunPlan = {
    source_name: string;
    source_kind: string;
    import_batch: {
        payload: Record<string, unknown>;
    };
    actions: PlanAction[];
    blockers?: ExecuteGuardPlan["blockers"];
    summary?: ExecuteGuardPlan["summary"];
};

export type GeoJsonPoint = {
    type: "Point";
    coordinates: [number, number];
};

export type GeoJsonLineString = {
    type: "LineString";
    coordinates: Array<[number, number]>;
};

export type TableCounts = Record<string, { inserted: number; updated: number; reused: number; skipped: number }>;

export type SkippedRow = {
    entity_type: string;
    external_id: string | null;
    action: string;
    reason: string;
};

export type ImportError = {
    entity_type: string;
    external_id: string | null;
    error_code: string;
    error_message: string;
};

export type ImportResult = {
    route_code: string;
    executed: boolean;
    import_batch_id: number | null;
    ids: {
        operators: Record<string, number>;
        routes: Record<string, number>;
        route_names: number[];
        route_variants: Record<string, number>;
        stops: Record<string, number>;
        stop_names: number[];
        route_stops: number[];
        route_paths: number[];
        fares: Record<string, number>;
        source_links: number[];
    };
    counts: TableCounts;
    skipped: SkippedRow[];
    conflicts: SkippedRow[];
    errors: ImportError[];
    stop_identity_metrics?: {
        protected_stop_reuse_count: number;
        protected_stop_not_modified_count: number;
        reused_cross_route_stop_count: number;
    };
    route_stop_completeness?: RouteStopCompletenessReport;
    replaced_route_stops_backup?: Array<{
        route_variant_id: number;
        stop_sequence: number;
        stop_id: number;
        normalized_data: Record<string, unknown> | null;
    }>;
};

function bumpCount(
    counts: TableCounts,
    table: string,
    kind: "inserted" | "updated" | "reused" | "skipped",
): void {
    if (!counts[table]) {
        counts[table] = { inserted: 0, updated: 0, reused: 0, skipped: 0 };
    }
    counts[table][kind]++;
}

function pointToWkt(point: GeoJsonPoint): string {
    return `SRID=4326;POINT(${point.coordinates[0]} ${point.coordinates[1]})`;
}

function lineStringToWkt(line: GeoJsonLineString): string {
    const coords = line.coordinates.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
    return `SRID=4326;LINESTRING(${coords})`;
}

function buildSourceRefs(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ybs_go: {
            source_name: YBS_SOURCE_NAME,
            source_kind: YBS_SOURCE_KIND,
            phase: "phase9_safe_import",
            ...extra,
        },
    };
}

function withPhaseMetadata(
    normalizedData: Record<string, unknown> | undefined,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        ...(normalizedData ?? {}),
        import_phase: "phase9_safe_import",
        ...extra,
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when an action belongs to one route code.
 * Uses segment boundaries so YBS-1 does not match YBS-10 / YBS-100.
 */
export function actionBelongsToRoute(action: PlanAction, routeCode: string): boolean {
    const payload = action.payload ?? {};
    if (payload.route_code === routeCode) {
        return true;
    }

    const external = action.external_id ?? "";
    const ref = action.entity_ref ?? "";
    const routeTokenPattern = new RegExp(`:${escapeRegExp(routeCode)}(?::|$)`);
    return routeTokenPattern.test(external) || routeTokenPattern.test(ref);
}

/** Actions that belong to a single route (route-scoped external_id filter). */
export function selectRouteActions(plan: DryRunPlan, routeCode: string): PlanAction[] {
    return plan.actions.filter((action) => actionBelongsToRoute(action, routeCode));
}

type ExecutorContext = {
    client: pg.PoolClient;
    plan: DryRunPlan;
    routeCode: string;
    importBatchId: number;
    result: ImportResult;
    refToEntityId: Map<string, number>;
    routeActions: PlanAction[];
    replaceExistingUnreviewedRouteStops: boolean;
    routeStopsReplaced: boolean;
    routeStopExpectations: VariantRouteStopExpectation[];
};

const MERGEABLE_REVIEW_STATUSES = new Set([
    "imported_unreviewed",
    "needs_review",
    "rejected",
]);

async function createImportBatch(ctx: {
    client: pg.PoolClient;
    plan: DryRunPlan;
    routeCode: string;
}): Promise<number> {
    const payload = ctx.plan.import_batch.payload;
    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.import_batches (
            source_name, source_kind, import_scope, import_mode, status,
            source_file_path, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id::text
        `,
        [
            String(payload.source_name ?? YBS_SOURCE_NAME),
            String(payload.source_kind ?? YBS_SOURCE_KIND),
            "ybs_go_single_route",
            "phase9_safe_import",
            "running",
            String(payload.source_file_path ?? ""),
            `Phase 9 safe import for ${ctx.routeCode}.`,
        ],
    );
    return Number(inserted.rows[0].id);
}

async function upsertOperator(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const operatorCode = String(action.payload.operator_code ?? "YBS");
    const existing = await ctx.client.query<{ id: string; review_status: string }>(
        `SELECT id::text, review_status FROM transport.operators WHERE operator_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [operatorCode],
    );

    let operatorId: number;
    if (existing.rows[0]) {
        operatorId = Number(existing.rows[0].id);
        if (PROTECTED_REVIEW_STATUSES.has(existing.rows[0].review_status)) {
            bumpCount(ctx.result.counts, "operators", "skipped");
        } else {
            bumpCount(ctx.result.counts, "operators", "reused");
        }
    } else {
        const inserted = await ctx.client.query<{ id: string }>(
            `
            INSERT INTO transport.operators (
                operator_code, name, operator_type, primary_mode, review_status,
                source_refs, normalized_data, confidence_score, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, true)
            RETURNING id::text
            `,
            [
                operatorCode,
                String(action.payload.name ?? operatorCode),
                String(action.payload.operator_type ?? "bus_operator"),
                MODE_BUS,
                String(action.payload.review_status ?? "imported_unreviewed"),
                JSON.stringify(buildSourceRefs({ operator_code: operatorCode })),
                JSON.stringify(withPhaseMetadata({})),
                50,
            ],
        );
        operatorId = Number(inserted.rows[0].id);
        bumpCount(ctx.result.counts, "operators", "inserted");
    }

    ctx.refToEntityId.set(action.entity_ref, operatorId);
    ctx.result.ids.operators[operatorCode] = operatorId;
}

async function importRoute(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const routeCode = String(action.payload.route_code);
    const operatorRef = String(action.payload.operator_ref ?? "");
    const operatorId = ctx.refToEntityId.get(operatorRef) ?? null;

    if (action.action === "insert_route" && action.external_id) {
        const linkedRouteId = await findLinkedEntityId(ctx.client, "route", action.external_id);
        if (linkedRouteId) {
            ctx.refToEntityId.set(action.entity_ref, linkedRouteId);
            ctx.result.ids.routes[routeCode] = linkedRouteId;
            bumpCount(ctx.result.counts, "routes", "reused");
            return;
        }
    }

    const existing = await ctx.client.query<{ id: string; review_status: string }>(
        `SELECT id::text, review_status FROM transport.routes WHERE route_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [routeCode],
    );

    const publicName = String(action.payload.public_name ?? routeCode);
    const originName = action.payload.origin_name ?? null;
    const destinationName = action.payload.destination_name ?? null;
    const confidence = action.payload.confidence_score ?? null;
    const normalizedData = withPhaseMetadata(
        action.payload.normalized_data as Record<string, unknown> | undefined,
    );

    let routeId: number;

    if (existing.rows[0]) {
        routeId = Number(existing.rows[0].id);
        const reviewStatus = existing.rows[0].review_status;

        if (PROTECTED_REVIEW_STATUSES.has(reviewStatus)) {
            ctx.result.conflicts.push({
                entity_type: "route",
                external_id: action.external_id,
                action: "skip_protected_route",
                reason: `Route ${routeCode} is ${reviewStatus}; not overwritten.`,
            });
            bumpCount(ctx.result.counts, "routes", "skipped");
            ctx.refToEntityId.set(action.entity_ref, routeId);
            ctx.result.ids.routes[routeCode] = routeId;
            return;
        }

        // Mergeable: only update safe metadata; never downgrade names to null.
        await ctx.client.query(
            `
            UPDATE transport.routes SET
                operator_id = COALESCE(operator_id, $2),
                public_name = $3,
                mode = $4,
                route_kind = $5,
                origin_name = COALESCE($6, origin_name),
                destination_name = COALESCE($7, destination_name),
                confidence_score = $8,
                normalized_data = normalized_data || $9::jsonb,
                is_active = $10,
                updated_at = now()
            WHERE id = $1
            `,
            [
                routeId,
                operatorId,
                publicName,
                MODE_BUS,
                ROUTE_KIND_URBAN,
                originName,
                destinationName,
                confidence,
                JSON.stringify(normalizedData),
                routeIsActiveForPublic(reviewStatus),
            ],
        );
        bumpCount(ctx.result.counts, "routes", "updated");
    } else {
        if (operatorId === null) {
            throw new Error(`Cannot insert route ${routeCode}: operator not resolved.`);
        }
        const inserted = await ctx.client.query<{ id: string }>(
            `
            INSERT INTO transport.routes (
                operator_id, route_code, public_name, mode, route_kind,
                origin_name, destination_name, review_status,
                source_refs, normalized_data, confidence_score, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
            RETURNING id::text
            `,
            [
                operatorId,
                routeCode,
                publicName,
                MODE_BUS,
                ROUTE_KIND_URBAN,
                originName,
                destinationName,
                String(action.payload.review_status ?? "imported_unreviewed"),
                JSON.stringify(buildSourceRefs({ route_code: routeCode })),
                JSON.stringify(normalizedData),
                confidence,
                routeIsActiveForPublic(String(action.payload.review_status ?? "imported_unreviewed")),
            ],
        );
        routeId = Number(inserted.rows[0].id);
        bumpCount(ctx.result.counts, "routes", "inserted");
    }

    ctx.refToEntityId.set(action.entity_ref, routeId);
    ctx.result.ids.routes[routeCode] = routeId;
}

async function insertRouteName(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const routeRef = String(action.payload.route_ref ?? "");
    const routeId = ctx.refToEntityId.get(routeRef);
    if (!routeId) {
        throw new Error(`route_name references unresolved route ${routeRef}.`);
    }

    const name = String(action.payload.name);
    const languageCode = String(action.payload.language_code ?? "und");
    const nameType = String(action.payload.name_type ?? "primary");

    const existing = await ctx.client.query<{ id: string }>(
        `SELECT id::text FROM transport.route_names WHERE route_id = $1 AND name = $2 AND language_code = $3 LIMIT 1`,
        [routeId, name, languageCode],
    );
    if (existing.rows[0]) {
        bumpCount(ctx.result.counts, "route_names", "reused");
        return;
    }

    const scriptCode = languageCode === "my" ? "Mymr" : languageCode === "en" ? "Latn" : null;
    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.route_names (
            route_id, name, language_code, script_code, name_type, is_primary, search_weight
        )
        VALUES ($1, $2, $3, $4, $5, $6, 50)
        RETURNING id::text
        `,
        [routeId, name, languageCode, scriptCode, nameType, Boolean(action.payload.is_primary)],
    );
    ctx.result.ids.route_names.push(Number(inserted.rows[0].id));
    bumpCount(ctx.result.counts, "route_names", "inserted");
}

async function insertRouteVariant(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const routeRef = String(action.payload.route_ref ?? "");
    const routeId = ctx.refToEntityId.get(routeRef);
    if (!routeId) {
        throw new Error(`route_variant references unresolved route ${routeRef}.`);
    }

    const routeIdentity = await ctx.client.query<{ route_code: string; mode: string }>(
        `SELECT route_code, mode FROM transport.routes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [routeId],
    );
    const route = routeIdentity.rows[0];
    if (!route) {
        throw new Error(`route_variant references missing route id ${routeId}.`);
    }

    const requestedDirectionId =
        typeof action.payload.direction_id === "number" ? action.payload.direction_id : null;
    const canonicalYbs = route.mode === MODE_BUS && route.route_code.startsWith("YBS-");
    if (canonicalYbs && requestedDirectionId !== 0 && requestedDirectionId !== 1) {
        throw new Error(
            `YBS route_variant ${action.entity_ref} requires direction_id 0 (D0) or 1 (D1).`,
        );
    }
    const variantCode = canonicalYbs
        ? `${route.route_code}-D${requestedDirectionId}`
        : String(action.payload.variant_code);
    const directionName = canonicalYbs
        ? `D${requestedDirectionId}`
        : (action.payload.direction_name ?? null);

    if (action.external_id) {
        const linkedVariantId = await findLinkedEntityId(
            ctx.client,
            "route_variant",
            action.external_id,
        );
        if (linkedVariantId) {
            ctx.refToEntityId.set(action.entity_ref, linkedVariantId);
            ctx.result.ids.route_variants[variantCode] = linkedVariantId;
            bumpCount(ctx.result.counts, "route_variants", "reused");
            return;
        }
    }

    const existing = await ctx.client.query<{ id: string }>(
        `SELECT id::text FROM transport.route_variants WHERE route_id = $1 AND variant_code = $2 AND deleted_at IS NULL LIMIT 1`,
        [routeId, variantCode],
    );
    if (existing.rows[0]) {
        ctx.refToEntityId.set(action.entity_ref, Number(existing.rows[0].id));
        ctx.result.ids.route_variants[variantCode] = Number(existing.rows[0].id);
        bumpCount(ctx.result.counts, "route_variants", "reused");
        return;
    }

    const directionId = requestedDirectionId;
    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.route_variants (
            route_id, variant_code, direction_name, direction_id,
            origin_name, destination_name, headsign, review_status,
            source_refs, normalized_data, confidence_score, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, true)
        RETURNING id::text
        `,
        [
            routeId,
            variantCode,
            directionName,
            directionId,
            action.payload.origin_name ?? null,
            action.payload.destination_name ?? null,
            action.payload.headsign ?? action.payload.destination_name ?? null,
            String(action.payload.review_status ?? "imported_unreviewed"),
            JSON.stringify(buildSourceRefs({ variant_code: variantCode })),
            JSON.stringify(withPhaseMetadata({})),
            20,
        ],
    );
    ctx.refToEntityId.set(action.entity_ref, Number(inserted.rows[0].id));
    ctx.result.ids.route_variants[variantCode] = Number(inserted.rows[0].id);
    bumpCount(ctx.result.counts, "route_variants", "inserted");
}

async function insertStop(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const candidateId = String(action.payload.candidate_id);

    if (action.external_id) {
        const linkedStopId = await findLinkedEntityId(ctx.client, "stop", action.external_id);
        if (linkedStopId) {
            ctx.refToEntityId.set(action.entity_ref, linkedStopId);
            ctx.result.ids.stops[candidateId] = linkedStopId;
            bumpCount(ctx.result.counts, "stops", "reused");
            return;
        }
    }

    const geometry = action.payload.geometry as GeoJsonPoint;
    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.stops (
            name, name_mm, name_en, mode, stop_type, geom,
            review_status, source_refs, normalized_data, confidence_score, is_active
        )
        VALUES ($1, $2, $3, $4, $5, ST_GeomFromEWKT($6), $7, $8::jsonb, $9::jsonb, $10, true)
        RETURNING id::text
        `,
        [
            String(action.payload.name),
            action.payload.name_mm ?? null,
            action.payload.name_en ?? null,
            MODE_BUS,
            STOP_TYPE_STOP,
            pointToWkt(geometry),
            String(action.payload.review_status ?? "needs_review"),
            JSON.stringify(buildSourceRefs({ candidate_id: candidateId })),
            JSON.stringify(
                withPhaseMetadata(action.payload.normalized_data as Record<string, unknown>),
            ),
            action.payload.confidence_score ?? 20,
        ],
    );
    const stopId = Number(inserted.rows[0].id);
    ctx.refToEntityId.set(action.entity_ref, stopId);
    ctx.result.ids.stops[candidateId] = stopId;
    bumpCount(ctx.result.counts, "stops", "inserted");
}

async function reuseExistingStop(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const stopId = Number(action.existing_entity_id ?? action.payload.matched_stop_id);
    ctx.refToEntityId.set(action.entity_ref, stopId);
    ctx.result.ids.stops[String(action.payload.candidate_id)] = stopId;
    bumpCount(ctx.result.counts, "stops", "reused");

    if (!ctx.result.stop_identity_metrics) {
        ctx.result.stop_identity_metrics = {
            protected_stop_reuse_count: 0,
            protected_stop_not_modified_count: 0,
            reused_cross_route_stop_count: 0,
        };
    }

    if (action.payload.protected_stop_reuse === true) {
        ctx.result.stop_identity_metrics.protected_stop_reuse_count++;
    }
    if (action.payload.protected_stop_not_modified === true) {
        ctx.result.stop_identity_metrics.protected_stop_not_modified_count++;
    }
}

async function mergeAdditionalStopData(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const stopId = Number(action.existing_entity_id ?? action.payload.matched_stop_id);

    const existing = await ctx.client.query<{ review_status: string; name_mm: string | null; name_en: string | null }>(
        `SELECT review_status, name_mm, name_en FROM transport.stops WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [stopId],
    );
    if (!existing.rows[0]) {
        throw new Error(`merge stop target ${stopId} not found.`);
    }

    if (PROTECTED_REVIEW_STATUSES.has(existing.rows[0].review_status)) {
        ctx.result.conflicts.push({
            entity_type: "stop",
            external_id: action.external_id,
            action: "skip_protected_stop",
            reason: `Stop ${stopId} is ${existing.rows[0].review_status}; only source_link added.`,
        });
        bumpCount(ctx.result.counts, "stops", "skipped");
        ctx.refToEntityId.set(action.entity_ref, stopId);
        ctx.result.ids.stops[String(action.payload.candidate_id)] = stopId;

        if (!ctx.result.stop_identity_metrics) {
            ctx.result.stop_identity_metrics = {
                protected_stop_reuse_count: 0,
                protected_stop_not_modified_count: 0,
                reused_cross_route_stop_count: 0,
            };
        }
        ctx.result.stop_identity_metrics.protected_stop_reuse_count++;
        ctx.result.stop_identity_metrics.protected_stop_not_modified_count++;
        return;
    }

    const identityMetadata =
        (action.payload.normalized_data as Record<string, unknown> | undefined) ?? {};
    const fillNameMm =
        typeof action.payload.fill_name_mm === "string" ? action.payload.fill_name_mm : null;
    const fillNameEn =
        typeof action.payload.fill_name_en === "string" ? action.payload.fill_name_en : null;

    await ctx.client.query(
        `
        UPDATE transport.stops SET
            name_mm = COALESCE(name_mm, $2),
            name_en = COALESCE(name_en, $3),
            normalized_data = normalized_data || $4::jsonb,
            updated_at = now()
        WHERE id = $1
        `,
        [
            stopId,
            fillNameMm,
            fillNameEn,
            JSON.stringify({
                ...identityMetadata,
                ybs_go: (action.payload.normalized_data as Record<string, unknown>)?.ybs_go ?? {},
                import_phase: "phase9_safe_import",
            }),
        ],
    );

    ctx.refToEntityId.set(action.entity_ref, stopId);
    ctx.result.ids.stops[String(action.payload.candidate_id)] = stopId;
    bumpCount(ctx.result.counts, "stops", "updated");
}

async function insertStopName(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const stopRef = String(action.payload.stop_ref ?? "");
    const stopId = ctx.refToEntityId.get(stopRef);
    if (!stopId) {
        // Stop was skipped/blocked; record as non-fatal skip.
        ctx.result.skipped.push({
            entity_type: "stop_name",
            external_id: action.external_id,
            action: action.action,
            reason: `stop_name references unresolved stop ${stopRef}.`,
        });
        bumpCount(ctx.result.counts, "stop_names", "skipped");
        return;
    }

    const name = String(action.payload.name);
    const languageCode = String(action.payload.language_code ?? "und");

    const existing = await ctx.client.query<{ id: string }>(
        `SELECT id::text FROM transport.stop_names WHERE stop_id = $1 AND name = $2 AND language_code = $3 LIMIT 1`,
        [stopId, name, languageCode],
    );
    if (existing.rows[0]) {
        bumpCount(ctx.result.counts, "stop_names", "reused");
        return;
    }

    const scriptCode = languageCode === "my" ? "Mymr" : languageCode === "en" ? "Latn" : null;
    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.stop_names (
            stop_id, name, language_code, script_code, name_type, is_primary, search_weight
        )
        VALUES ($1, $2, $3, $4, 'imported', false, 50)
        RETURNING id::text
        `,
        [stopId, name, languageCode, scriptCode],
    );
    ctx.result.ids.stop_names.push(Number(inserted.rows[0].id));
    bumpCount(ctx.result.counts, "stop_names", "inserted");
}

async function maybeReplaceUnreviewedRouteStops(ctx: ExecutorContext): Promise<void> {
    if (ctx.routeStopsReplaced || !ctx.replaceExistingUnreviewedRouteStops) {
        return;
    }

    const updateAction = ctx.routeActions.find(
        (action) => action.action === "update_unreviewed_route",
    );
    const updateMode = String(
        updateAction?.payload?.existing_route_update_mode ?? "append_missing_sequences_only",
    );
    if (updateMode !== "replace_unreviewed_route_stops") {
        return;
    }

    const routeId = Number(updateAction?.existing_entity_id ?? 0);
    if (!routeId) {
        return;
    }

    const routeRow = await ctx.client.query<{ review_status: string }>(
        `SELECT review_status FROM transport.routes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [routeId],
    );
    const reviewStatus = routeRow.rows[0]?.review_status;
    if (!reviewStatus || !MERGEABLE_REVIEW_STATUSES.has(reviewStatus)) {
        ctx.result.skipped.push({
            entity_type: "route_stop",
            external_id: null,
            action: "replace_unreviewed_route_stops",
            reason: `Route ${routeId} is protected or unsupported for replacement (${reviewStatus ?? "missing"}).`,
        });
        return;
    }

    const variantIds = [...ctx.refToEntityId.entries()]
        .filter(([entityRef]) => entityRef.startsWith("$variant:"))
        .map(([, entityId]) => entityId);
    if (variantIds.length === 0) {
        return;
    }

    const backupRows = await ctx.client.query<{
        route_variant_id: string;
        stop_sequence: number;
        stop_id: string;
        normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT route_variant_id::text, stop_sequence, stop_id::text, normalized_data
        FROM transport.route_stops
        WHERE route_variant_id = ANY($1::bigint[])
        ORDER BY route_variant_id, stop_sequence
        `,
        [variantIds],
    );

    ctx.result.replaced_route_stops_backup = backupRows.rows.map((row) => ({
        route_variant_id: Number(row.route_variant_id),
        stop_sequence: row.stop_sequence,
        stop_id: Number(row.stop_id),
        normalized_data: row.normalized_data,
    }));

    await ctx.client.query(
        `DELETE FROM transport.route_stops WHERE route_variant_id = ANY($1::bigint[])`,
        [variantIds],
    );

    await ctx.client.query(
        `
        UPDATE transport.import_batches
        SET notes = COALESCE(notes, '') || $2,
            updated_at = now()
        WHERE id = $1
        `,
        [
            ctx.importBatchId,
            `\nReplaced route_stops backup for ${ctx.routeCode}: ${JSON.stringify(ctx.result.replaced_route_stops_backup)}`,
        ],
    );

    ctx.routeStopsReplaced = true;
    bumpCount(ctx.result.counts, "route_stops", "updated");
}

export function buildRouteStopExpectations(
    routeActions: PlanAction[],
    routeCode: string,
): VariantRouteStopExpectation[] {
    const byVariant = new Map<string, VariantRouteStopExpectation>();

    for (const action of routeActions) {
        if (action.action !== "insert_route_stop") {
            continue;
        }
        if (!actionBelongsToRoute(action, routeCode)) {
            continue;
        }

        const variantRef = String(action.payload.variant_ref ?? "");
        const directionKey =
            String(action.payload.direction_key ?? "") ||
            (action.external_id?.split(":")[3] ?? "");
        const variantCode = buildVariantCode(routeCode, directionKey);
        const sequence = Number(action.payload.stop_sequence);
        const bucket =
            byVariant.get(variantRef) ??
            ({
                variantRef,
                variantCode,
                directionKey,
                expectedCount: 0,
                expectedSequences: [],
                routeStopActions: [],
            } satisfies VariantRouteStopExpectation);
        bucket.expectedSequences.push(sequence);
        bucket.routeStopActions.push(action);
        bucket.expectedCount = bucket.expectedSequences.length;
        byVariant.set(variantRef, bucket);
    }

    for (const bucket of byVariant.values()) {
        bucket.expectedSequences.sort((left, right) => left - right);
    }

    return [...byVariant.values()].sort((left, right) => left.variantCode.localeCompare(right.variantCode));
}

export async function validateRouteStopCompleteness(ctx: ExecutorContext): Promise<RouteStopCompletenessReport> {
    const report: RouteStopCompletenessReport = {
        route_code: ctx.routeCode,
        status: "passed",
        variants: [],
        violations: [],
    };

    for (const expected of ctx.routeStopExpectations) {
        const variantId = ctx.refToEntityId.get(expected.variantRef);
        const variantReport = {
            variant_code: expected.variantCode,
            direction_key: expected.directionKey,
            expected_stop_count_from_extraction: expected.expectedCount,
            actual_route_stop_count: 0,
            missing_sequences: [] as number[],
            duplicate_sequences: [] as number[],
            unresolved_stop_candidates: [] as string[],
            status: "passed" as "passed" | "failed",
        };

        if (!variantId) {
            variantReport.status = "failed";
            report.violations.push(`Variant ${expected.variantCode} was not resolved for route_stop validation.`);
            report.variants.push(variantReport);
            continue;
        }

        for (const action of expected.routeStopActions) {
            const stopRef = String(action.payload.stop_ref ?? "");
            if (!ctx.refToEntityId.get(stopRef)) {
                variantReport.unresolved_stop_candidates.push(
                    String(action.payload.candidate_id ?? stopRef),
                );
            }
            const routeStopId = ctx.refToEntityId.get(action.entity_ref);
            if (!routeStopId) {
                variantReport.unresolved_stop_candidates.push(
                    `sequence:${String(action.payload.stop_sequence)}`,
                );
            } else if (action.external_id) {
                const hasLink = await sourceLinkExists(ctx.client, "route_stop", action.external_id);
                if (!hasLink) {
                    variantReport.status = "failed";
                    report.violations.push(
                        `route_stop sequence ${action.payload.stop_sequence} on ${expected.variantCode} is missing source_link.`,
                    );
                }
            }
        }

        const rows = await ctx.client.query<{ stop_sequence: number }>(
            `
            SELECT stop_sequence::int
            FROM transport.route_stops
            WHERE route_variant_id = $1
            ORDER BY stop_sequence
            `,
            [variantId],
        );
        const actualSequences = rows.rows.map((row) => row.stop_sequence);
        variantReport.actual_route_stop_count = actualSequences.length;

        if (variantReport.actual_route_stop_count !== expected.expectedCount) {
            variantReport.status = "failed";
            report.violations.push(
                `Variant ${expected.variantCode}: expected ${expected.expectedCount} route_stops, found ${variantReport.actual_route_stop_count}.`,
            );
        }

        const expectedSet = new Set(expected.expectedSequences);
        variantReport.missing_sequences = expected.expectedSequences.filter(
            (sequence) => !actualSequences.includes(sequence),
        );
        if (variantReport.missing_sequences.length > 0) {
            variantReport.status = "failed";
            report.violations.push(
                `Variant ${expected.variantCode} missing sequences: ${variantReport.missing_sequences.join(", ")}.`,
            );
        }

        const duplicateCounts = new Map<number, number>();
        for (const sequence of actualSequences) {
            duplicateCounts.set(sequence, (duplicateCounts.get(sequence) ?? 0) + 1);
        }
        variantReport.duplicate_sequences = [...duplicateCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([sequence]) => sequence);
        if (variantReport.duplicate_sequences.length > 0) {
            variantReport.status = "failed";
            report.violations.push(
                `Variant ${expected.variantCode} duplicate sequences: ${variantReport.duplicate_sequences.join(", ")}.`,
            );
        }

        for (let index = 0; index < expected.expectedSequences.length; index++) {
            const wanted = index + 1;
            const actual = expected.expectedSequences[index];
            if (actual !== wanted) {
                variantReport.status = "failed";
                report.violations.push(
                    `Variant ${expected.variantCode} sequences are not continuous from 1 (expected ${wanted}, found ${actual}).`,
                );
                break;
            }
        }

        if (variantReport.unresolved_stop_candidates.length > 0) {
            variantReport.status = "failed";
            report.violations.push(
                `Variant ${expected.variantCode} unresolved stop candidates: ${[...new Set(variantReport.unresolved_stop_candidates)].join(", ")}.`,
            );
        }

        if (variantReport.status === "failed") {
            report.status = "failed";
        }
        report.variants.push(variantReport);
    }

    if (report.violations.length > 0) {
        report.status = "failed";
    }

    return report;
}

async function validateStopSourceLinkAlignment(ctx: ExecutorContext): Promise<string[]> {
    const violations: string[] = [];

    for (const expected of ctx.routeStopExpectations) {
        const variantId = ctx.refToEntityId.get(expected.variantRef);
        if (!variantId) {
            continue;
        }

        for (const action of expected.routeStopActions) {
            const sequence = Number(action.payload.stop_sequence);
            if (!Number.isFinite(sequence)) {
                continue;
            }

            const stopExternalId = directionAwareStopExternalId(
                ctx.routeCode,
                expected.directionKey,
                sequence,
            );

            const routeStopRow = await ctx.client.query<{ stop_id: string }>(
                `
                SELECT stop_id::text
                FROM transport.route_stops
                WHERE route_variant_id = $1
                  AND stop_sequence = $2
                LIMIT 1
                `,
                [variantId, sequence],
            );
            const actualStopId = routeStopRow.rows[0]?.stop_id;
            if (!actualStopId) {
                violations.push(
                    `route_stop ${expected.variantCode} seq ${sequence} missing after import.`,
                );
                continue;
            }

            const linkRow = await ctx.client.query<{ entity_id: string }>(
                `
                SELECT entity_id::text
                FROM transport.source_links
                WHERE entity_type = 'stop'
                  AND source_name = $1
                  AND source_kind = $2
                  AND external_id = $3
                LIMIT 1
                `,
                [YBS_SOURCE_NAME, YBS_SOURCE_KIND, stopExternalId],
            );

            if (!linkRow.rows[0]) {
                violations.push(`stop source_link missing for ${stopExternalId}.`);
                continue;
            }

            if (Number(linkRow.rows[0].entity_id) !== Number(actualStopId)) {
                violations.push(
                    `stop source_link ${stopExternalId} points to entity_id=${linkRow.rows[0].entity_id}, but route_stop uses stop_id=${actualStopId}.`,
                );
            }
        }
    }

    return violations;
}

async function insertRouteStop(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    await maybeReplaceUnreviewedRouteStops(ctx);

    if (action.external_id) {
        const linkedRouteStopId = await findLinkedEntityId(
            ctx.client,
            "route_stop",
            action.external_id,
        );
        if (linkedRouteStopId) {
            ctx.result.ids.route_stops.push(linkedRouteStopId);
            bumpCount(ctx.result.counts, "route_stops", "reused");
            registerEntityRef(ctx, action.entity_ref, linkedRouteStopId);
            return;
        }
    }

    const variantRef = String(action.payload.variant_ref ?? "");
    const stopRef = String(action.payload.stop_ref ?? "");
    const variantId = ctx.refToEntityId.get(variantRef);
    const stopId = ctx.refToEntityId.get(stopRef);

    if (!variantId || !stopId) {
        throw new Error(
            `UNRESOLVED_STOP_ID_FOR_SEQUENCE: route_stop ${action.external_id ?? "unknown"} missing variant (${variantRef}) or stop (${stopRef}).`,
        );
    }

    const sequence = Number(action.payload.stop_sequence);
    const existing = await ctx.client.query<{ id: string }>(
        `SELECT id::text FROM transport.route_stops WHERE route_variant_id = $1 AND stop_sequence = $2 LIMIT 1`,
        [variantId, sequence],
    );
    if (existing.rows[0]) {
        const routeStopId = Number(existing.rows[0].id);
        bumpCount(ctx.result.counts, "route_stops", "reused");
        ctx.result.ids.route_stops.push(routeStopId);
        registerEntityRef(ctx, action.entity_ref, routeStopId);
        return;
    }

    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.route_stops (
            route_variant_id, stop_id, stop_sequence,
            pickup_type, drop_off_type, is_timing_point,
            source_refs, normalized_data,
            review_geom, review_geometry_data
        )
        VALUES (
            $1, $2, $3, 0, 0, false, $4::jsonb, $5::jsonb,
            CASE WHEN $6::text IS NULL THEN NULL ELSE ST_GeomFromEWKT($6) END,
            COALESCE($7::jsonb, '{}'::jsonb)
        )
        RETURNING id::text
        `,
        [
            variantId,
            stopId,
            sequence,
            JSON.stringify(buildSourceRefs({ sequence })),
            JSON.stringify(withPhaseMetadata({})),
            action.payload.review_geometry
                ? pointToWkt(action.payload.review_geometry as GeoJsonPoint)
                : null,
            action.payload.review_geometry_data
                ? JSON.stringify(action.payload.review_geometry_data)
                : null,
        ],
    );
    const routeStopId = Number(inserted.rows[0].id);
    ctx.result.ids.route_stops.push(routeStopId);
    bumpCount(ctx.result.counts, "route_stops", "inserted");
    registerEntityRef(ctx, action.entity_ref, routeStopId);
}

async function insertRoutePath(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const variantRef = String(action.payload.variant_ref ?? "");
    const variantId = ctx.refToEntityId.get(variantRef);
    if (!variantId) {
        ctx.result.skipped.push({
            entity_type: "route_path",
            external_id: action.external_id,
            action: action.action,
            reason: `route_path references unresolved variant ${variantRef}.`,
        });
        bumpCount(ctx.result.counts, "route_paths", "skipped");
        return;
    }

    if (action.external_id) {
        const linkedPathId = await findLinkedEntityId(ctx.client, "route_path", action.external_id);
        if (linkedPathId) {
            ctx.result.ids.route_paths.push(linkedPathId);
            bumpCount(ctx.result.counts, "route_paths", "reused");
            registerEntityRef(ctx, action.entity_ref, linkedPathId);
            return;
        }
    }

    const existingPath = await ctx.client.query<{ id: string }>(
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
        const routePathId = Number(existingPath.rows[0].id);
        ctx.result.ids.route_paths.push(routePathId);
        bumpCount(ctx.result.counts, "route_paths", "reused");
        registerEntityRef(ctx, action.entity_ref, routePathId);
        return;
    }

    const geometry = action.payload.geometry as GeoJsonLineString;
    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.route_paths (
            route_variant_id, path_kind, geom, distance_m,
            review_status, source_refs, normalized_data, confidence_score, is_active
        )
        VALUES ($1, $2, ST_GeomFromEWKT($3), $4, $5, $6::jsonb, $7::jsonb, $8, true)
        RETURNING id::text
        `,
        [
            variantId,
            ROUTE_PATH_KIND_CORRIDOR_ESTIMATE,
            lineStringToWkt(geometry),
            action.payload.distance_m ?? null,
            String(action.payload.review_status ?? "needs_review"),
            JSON.stringify(buildSourceRefs({})),
            JSON.stringify(
                withPhaseMetadata(action.payload.normalized_data as Record<string, unknown>),
            ),
            action.payload.confidence_score ?? 20,
        ],
    );
    const routePathId = Number(inserted.rows[0].id);
    ctx.result.ids.route_paths.push(routePathId);
    bumpCount(ctx.result.counts, "route_paths", "inserted");
    registerEntityRef(ctx, action.entity_ref, routePathId);
}

async function insertFare(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const routeRef = String(action.payload.route_ref ?? "");
    const routeId = ctx.refToEntityId.get(routeRef);
    if (!routeId) {
        throw new Error(`fare references unresolved route ${routeRef}.`);
    }

    const inserted = await ctx.client.query<{ id: string }>(
        `
        INSERT INTO transport.fares (
            route_id, fare_type, amount_min, amount_max, currency_code, note,
            review_status, source_refs, normalized_data, confidence_score, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, true)
        RETURNING id::text
        `,
        [
            routeId,
            String(action.payload.fare_type ?? "flat"),
            action.payload.amount_min ?? null,
            action.payload.amount_max ?? null,
            CURRENCY_CODE_MMK,
            action.payload.note ?? null,
            String(action.payload.review_status ?? "imported_unreviewed"),
            JSON.stringify(buildSourceRefs({})),
            JSON.stringify(withPhaseMetadata({})),
            20,
        ],
    );
    const fareId = Number(inserted.rows[0].id);
    ctx.refToEntityId.set(action.entity_ref, fareId);
    ctx.result.ids.fares[ctx.routeCode] = fareId;
    bumpCount(ctx.result.counts, "fares", "inserted");
}

async function applySourceLink(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    const entityId = ctx.refToEntityId.get(action.entity_ref);
    if (!entityId || !action.external_id) {
        ctx.result.skipped.push({
            entity_type: `source_link:${action.entity_type}`,
            external_id: action.external_id,
            action: action.action,
            reason: `source_link references unresolved entity ${action.entity_ref}.`,
        });
        bumpCount(ctx.result.counts, "source_links", "skipped");
        return;
    }

    const linkResult = await ensureSourceLink(ctx.client, {
        entityType: action.entity_type as SourceLinkEntityType,
        entityId,
        externalId: action.external_id,
        importBatchId: ctx.importBatchId,
        confidenceScore: 20,
        isPrimary: true,
        sourcePayload: {
            entity_ref: action.entity_ref,
            ...action.payload,
        },
    });

    ctx.result.ids.source_links.push(linkResult.source_link_id);
    bumpCount(ctx.result.counts, "source_links", linkResult.status === "inserted" ? "inserted" : "reused");
}

const IMPORT_ORDER: Record<string, number> = {
    upsert_operator: 1,
    insert_route: 2,
    update_unreviewed_route: 2,
    skip_protected_route: 2,
    insert_route_name: 3,
    insert_route_variant: 4,
    insert_stop: 5,
    reuse_existing_stop: 5,
    merge_additional_stop_data: 5,
    insert_stop_name: 6,
    insert_route_stop: 7,
    insert_route_path: 8,
    insert_fare: 9,
    insert_source_link: 10,
    reuse_source_link: 10,
    blocked_conflict: 99,
    insert_import_error: 99,
};

const CRITICAL_ACTIONS = new Set([
    "upsert_operator",
    "insert_route",
    "update_unreviewed_route",
    "insert_route_variant",
    "insert_stop",
    "insert_route_stop",
    "insert_fare",
]);

function orderedActions(actions: PlanAction[]): PlanAction[] {
    return actions
        .map((action, index) => ({ action, index }))
        .sort((left, right) => {
            const leftOrder = IMPORT_ORDER[left.action.action] ?? 50;
            const rightOrder = IMPORT_ORDER[right.action.action] ?? 50;
            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }
            return left.index - right.index;
        })
        .map((entry) => entry.action);
}

async function dispatchAction(ctx: ExecutorContext, action: PlanAction): Promise<void> {
    switch (action.action) {
        case "upsert_operator":
            return upsertOperator(ctx, action);
        case "insert_route":
        case "update_unreviewed_route":
            return importRoute(ctx, action);
        case "skip_protected_route":
            ctx.result.conflicts.push({
                entity_type: "route",
                external_id: action.external_id,
                action: action.action,
                reason: action.reason ?? "Protected route skipped.",
            });
            bumpCount(ctx.result.counts, "routes", "skipped");
            return;
        case "insert_route_name":
            return insertRouteName(ctx, action);
        case "insert_route_variant":
            return insertRouteVariant(ctx, action);
        case "insert_stop":
            return insertStop(ctx, action);
        case "reuse_existing_stop":
            return reuseExistingStop(ctx, action);
        case "merge_additional_stop_data":
            return mergeAdditionalStopData(ctx, action);
        case "hold_dashboard_review_stop":
            throw new Error(
                "hold_dashboard_review_stop is obsolete; rebuild the dry-run plan so manual-review stops import as placeholders.",
            );
        case "insert_stop_name":
            return insertStopName(ctx, action);
        case "insert_route_stop":
            return insertRouteStop(ctx, action);
        case "insert_route_path":
            return insertRoutePath(ctx, action);
        case "insert_fare":
            return insertFare(ctx, action);
        case "insert_source_link":
        case "reuse_source_link":
            return applySourceLink(ctx, action);
        case "blocked_conflict":
            ctx.result.conflicts.push({
                entity_type: action.entity_type,
                external_id: action.external_id,
                action: action.action,
                reason: action.reason ?? "Blocked conflict from plan.",
            });
            ctx.result.errors.push({
                entity_type: action.entity_type,
                external_id: action.external_id,
                error_code: "BLOCKED_CONFLICT",
                error_message: action.reason ?? "Blocked conflict from plan.",
            });
            return;
        case "insert_import_error":
            ctx.result.errors.push({
                entity_type: String(action.payload.entity_type ?? action.entity_type),
                external_id: action.external_id,
                error_code: String(action.payload.error_code ?? "IMPORT_ERROR"),
                error_message: String(action.payload.error_message ?? "Non-fatal skipped item."),
            });
            return;
        default:
            ctx.result.skipped.push({
                entity_type: action.entity_type,
                external_id: action.external_id,
                action: action.action,
                reason: `Unhandled action ${action.action}.`,
            });
            return;
    }
}

async function writeImportErrors(ctx: ExecutorContext): Promise<void> {
    for (const error of ctx.result.errors) {
        await ctx.client.query(
            `
            INSERT INTO transport.import_errors (
                import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
            )
            VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)
            `,
            [ctx.importBatchId, error.entity_type, error.external_id, error.error_code, error.error_message],
        );
    }
}

async function finalizeBatch(ctx: ExecutorContext): Promise<void> {
    const inserted = Object.values(ctx.result.counts).reduce((sum, c) => sum + c.inserted, 0);
    const updated = Object.values(ctx.result.counts).reduce((sum, c) => sum + c.updated, 0);
    const skipped = Object.values(ctx.result.counts).reduce((sum, c) => sum + c.skipped, 0);

    await ctx.client.query(
        `
        UPDATE transport.import_batches SET
            status = 'completed',
            inserted_count = $2,
            updated_count = $3,
            skipped_count = $4,
            error_count = $5,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
        `,
        [ctx.importBatchId, inserted, updated, skipped, ctx.result.errors.length],
    );
}

export function emptyResult(routeCode: string): ImportResult {
    return {
        route_code: routeCode,
        executed: false,
        import_batch_id: null,
        ids: {
            operators: {},
            routes: {},
            route_names: [],
            route_variants: {},
            stops: {},
            stop_names: [],
            route_stops: [],
            route_paths: [],
            fares: {},
            source_links: [],
        },
        counts: {},
        skipped: [],
        conflicts: [],
        errors: [],
    };
}

/**
 * Execute one route in a single transaction. Critical insert failure rolls back
 * the whole route. Returns the populated ImportResult.
 */
export async function executeRouteImport(options: {
    client: pg.PoolClient;
    plan: DryRunPlan;
    routeCode: string;
    routeActions: PlanAction[];
    stopActions: PlanAction[];
    replaceExistingUnreviewedRouteStops?: boolean;
}): Promise<ImportResult> {
    const { client, plan, routeCode } = options;
    const result = emptyResult(routeCode);
    result.executed = true;

    await client.query("BEGIN");
    try {
        const guardResult = await validateExecuteGuards({
            client,
            routeCode,
            routeActions: options.routeActions,
            stopActions: options.stopActions,
            plan: options.plan,
            replaceExistingUnreviewedRouteStops: options.replaceExistingUnreviewedRouteStops,
        });
        if (!guardResult.safe) {
            throw new Error(`Execute guards failed:\n- ${guardResult.violations.join("\n- ")}`);
        }

        const importBatchId = await createImportBatch({ client, plan, routeCode });
        result.import_batch_id = importBatchId;

        const ctx: ExecutorContext = {
            client,
            plan,
            routeCode,
            importBatchId,
            result,
            refToEntityId: new Map(),
            routeActions: options.routeActions,
            replaceExistingUnreviewedRouteStops: Boolean(options.replaceExistingUnreviewedRouteStops),
            routeStopsReplaced: false,
            routeStopExpectations: buildRouteStopExpectations(options.routeActions, routeCode),
        };

        // Stop-related actions must resolve before route_stops; combine and order.
        const combined = orderedActions([...options.stopActions, ...options.routeActions]);

        for (const action of combined) {
            const critical = CRITICAL_ACTIONS.has(action.action);
            try {
                await dispatchAction(ctx, action);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (critical) {
                    throw new Error(`Critical action ${action.action} failed: ${message}`);
                }
                result.skipped.push({
                    entity_type: action.entity_type,
                    external_id: action.external_id,
                    action: action.action,
                    reason: `Non-fatal failure: ${message}`,
                });
                result.errors.push({
                    entity_type: action.entity_type,
                    external_id: action.external_id,
                    error_code: "NON_FATAL_INSERT_FAILED",
                    error_message: message,
                });
            }
        }

        const completeness = await validateRouteStopCompleteness(ctx);
        result.route_stop_completeness = completeness;
        if (completeness.status === "failed") {
            throw new Error(
                `Route stop completeness validation failed:\n- ${completeness.violations.join("\n- ")}`,
            );
        }

        const stopLinkViolations = await validateStopSourceLinkAlignment(ctx);
        if (stopLinkViolations.length > 0) {
            throw new Error(
                `Stop source_link alignment validation failed:\n- ${stopLinkViolations.join("\n- ")}`,
            );
        }

        await writeImportErrors(ctx);
        await finalizeBatch(ctx);

        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        const message = error instanceof Error ? error.message : String(error);
        result.executed = false;
        result.errors.push({
            entity_type: "route",
            external_id: `route:ybs_go:${routeCode}`,
            error_code: "ROUTE_ROLLED_BACK",
            error_message: message,
        });
        throw Object.assign(new Error(message), { importResult: result });
    }
}
