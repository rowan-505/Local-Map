/**
 * Phase 8: build YBS Supabase dry-run import plan.
 *
 * Read-only against Supabase. No inserts, updates, or deletes.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import type { RoutesWithGeometryOutput } from "../ybs-db-prepare/prepare-geometry.js";
import type { StopResolutionPlanEntry } from "../ybs-db-prepare/build-stop-resolution.js";
import {
    PHASE8_SCHEMA_VERSION,
    type DryRunPlan,
    type DryRunPlanSummary,
    type ImportBatchPlan,
    type Phase8DryRunReport,
    type PlanAction,
    type PlanBlocker,
    type PlanConflict,
    type PlanWarning,
    type RouteGeometryReviewReport,
    type SourceLinkEntityType,
} from "./import-plan-types.js";
import {
    attachBulkImportReadiness,
    buildRouteReadinessReports,
} from "./build-route-readiness.js";
import { MANUAL_REVIEW_CONFIDENCE_SCORE, resolveRoutePolicy } from "./route-import-policy.js";
import {
    CURRENCY_CODE_MMK,
    DEFAULT_REVIEW_STATUS,
    FARE_TYPE_FLAT,
    ROUTE_KIND_URBAN,
    ROUTE_PATH_KIND_CORRIDOR_ESTIMATE,
    STOP_TYPE_STOP,
    TRANSPORT_MODE_BUS,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
    entityRefFare,
    entityRefOperator,
    entityRefRoute,
    entityRefRoutePath,
    entityRefRouteStop,
    entityRefStopCandidate,
    entityRefStopExisting,
    entityRefStopRoutePosition,
    entityRefStopUsage,
    entityRefVariant,
    fareExternalId,
    findSourceLink,
    isMergeableReviewStatus,
    isProtectedReviewStatus,
    normalizeOperatorCode,
    operatorExternalId,
    primaryDisplayName,
    routeExternalId,
    routePathExternalId,
    routeStopExternalId,
    directionAwareStopExternalId,
    stopExternalId,
    stopUsageExternalId,
    variantExternalId,
    type ExistingOperatorRow,
    type ExistingRouteRow,
    type ExistingSourceLinkRow,
    type ExistingStopRow,
    type SupabaseCatalog,
} from "./supabase-schema-map.js";

export type BuildDryRunPlanOptions = {
    runRoot: string;
    databaseUrl?: string;
    skipSupabase?: boolean;
    replaceExistingUnreviewedRouteStops?: boolean;
};

type StopResolutionPlanFile = {
    plans: StopResolutionPlanEntry[];
};

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

function loadDatabaseEnv(): void {
    for (const envPath of [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ]) {
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

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function shouldImportPlaceholderStop(resolutionPlan: StopResolutionPlanEntry | undefined): boolean {
    return (
        resolutionPlan?.decision === "dashboard_review_required" ||
        resolutionPlan?.decision === "needs_manual_review"
    );
}

function planPlaceholderStopFromCandidate(input: {
    actions: PlanAction[];
    summary: DryRunPlanSummary;
    conflicts: PlanConflict[];
    catalog: SupabaseCatalog;
    stop: RoutesWithGeometryOutput["resolved_stops"][number];
    resolutionPlan: StopResolutionPlanEntry | undefined;
    stopRef: string;
    stopExtId: string;
}): void {
    const { actions, summary, conflicts, catalog, stop, resolutionPlan, stopRef, stopExtId } = input;
    const duplicateReviewRequired = true;
    const confidenceScore = MANUAL_REVIEW_CONFIDENCE_SCORE;

    actions.push({
        action: "insert_stop",
        entity_type: "stop",
        external_id: stopExtId,
        entity_ref: stopRef,
        payload: {
            candidate_id: stop.candidate_id,
            candidate_key: stop.candidate_key,
            name_mm: stop.primary_name_my,
            name_en: stop.primary_name_en,
            name: primaryDisplayName(stop.primary_name_my, stop.primary_name_en),
            mode: TRANSPORT_MODE_BUS,
            stop_type: STOP_TYPE_STOP,
            geometry: stop.geometry,
            review_status: DEFAULT_REVIEW_STATUS.stop,
            confidence_score: confidenceScore,
            normalized_data: {
                ...stop.normalized_data,
                duplicate_review_required: duplicateReviewRequired,
                manual_review_reason: resolutionPlan?.manual_review_reason ?? null,
                ybs_go: {
                    candidate_key: stop.candidate_key,
                    area_text_my: stop.area_text_my,
                    area_text_en: stop.area_text_en,
                },
            },
        },
    });
    summary.stops_to_create++;

    if (stop.primary_name_my) {
        actions.push({
            action: "insert_stop_name",
            entity_type: "stop",
            external_id: stopExtId,
            entity_ref: stopRef,
            payload: {
                stop_ref: stopRef,
                name: stop.primary_name_my,
                language_code: "my",
                is_primary: true,
            },
        });
        summary.stop_names_to_insert++;
    }

    if (stop.primary_name_en) {
        actions.push({
            action: "insert_stop_name",
            entity_type: "stop",
            external_id: stopExtId,
            entity_ref: stopRef,
            payload: {
                stop_ref: stopRef,
                name: stop.primary_name_en,
                language_code: "en",
                is_primary: true,
            },
        });
        summary.stop_names_to_insert++;
    }

    conflicts.push({
        code: "STOP_NEEDS_MANUAL_REVIEW",
        message: `Stop candidate ${stop.candidate_id} imported as placeholder for manual review.`,
        entity_type: "stop",
        external_id: stopExtId,
        candidate_id: stop.candidate_id,
    });
    summary.conflicts++;

    planSourceLink(actions, summary, catalog, "stop", stopExtId, stopRef, {
        candidate_id: stop.candidate_id,
        candidate_key: stop.candidate_key,
        placeholder_for_manual_review: true,
    });
}

function planUsagePlaceholderStop(input: {
    actions: PlanAction[];
    summary: DryRunPlanSummary;
    conflicts: PlanConflict[];
    catalog: SupabaseCatalog;
    stop: RoutesWithGeometryOutput["resolved_stops"][number];
    directionKey: string;
    sourceSequence: number;
    usageRef: string;
    usageExtId: string;
}): void {
    const {
        actions,
        summary,
        conflicts,
        catalog,
        stop,
        directionKey,
        sourceSequence,
        usageRef,
        usageExtId,
    } = input;

    actions.push({
        action: "insert_stop",
        entity_type: "stop",
        external_id: usageExtId,
        entity_ref: usageRef,
        payload: {
            candidate_id: stop.candidate_id,
            candidate_key: stop.candidate_key,
            name_mm: stop.primary_name_my,
            name_en: stop.primary_name_en,
            name: primaryDisplayName(stop.primary_name_my, stop.primary_name_en),
            mode: TRANSPORT_MODE_BUS,
            stop_type: STOP_TYPE_STOP,
            geometry: stop.geometry,
            review_status: DEFAULT_REVIEW_STATUS.stop,
            confidence_score: MANUAL_REVIEW_CONFIDENCE_SCORE,
            normalized_data: {
                ...stop.normalized_data,
                duplicate_review_required: true,
                duplicate_usage_on_variant: true,
                source_sequence: sourceSequence,
                direction_key: directionKey,
                ybs_go: {
                    candidate_key: stop.candidate_key,
                    area_text_my: stop.area_text_my,
                    area_text_en: stop.area_text_en,
                },
            },
        },
    });
    summary.stops_to_create++;

    planSourceLink(actions, summary, catalog, "stop", usageExtId, usageRef, {
        candidate_id: stop.candidate_id,
        candidate_key: stop.candidate_key,
        duplicate_usage_on_variant: true,
        direction_key: directionKey,
        source_sequence: sourceSequence,
    });

    conflicts.push({
        code: "STOP_NEEDS_MANUAL_REVIEW",
        message: `Duplicate stop usage on variant at sequence ${sourceSequence}; created usage-specific placeholder stop.`,
        entity_type: "stop",
        external_id: usageExtId,
        candidate_id: stop.candidate_id,
    });
    summary.conflicts++;
}

function ensureRouteStopStopPlanned(input: {
    actions: PlanAction[];
    summary: DryRunPlanSummary;
    conflicts: PlanConflict[];
    catalog: SupabaseCatalog;
    stop: RoutesWithGeometryOutput["resolved_stops"][number];
    resolutionPlan: StopResolutionPlanEntry | undefined;
    routeCode: string;
    directionKey: string;
    sequence: number;
    plannedStopRefs: Set<string>;
}): string | null {
    const {
        actions,
        summary,
        conflicts,
        catalog,
        stop,
        resolutionPlan,
        routeCode,
        directionKey,
        sequence,
        plannedStopRefs,
    } = input;

    const stopExtId = directionAwareStopExternalId(routeCode, directionKey, sequence);
    const stopRef = entityRefStopRoutePosition(routeCode, directionKey, sequence);
    const candidateRef = entityRefStopCandidate(stop.candidate_id);

    if (plannedStopRefs.has(stopRef)) {
        return stopRef;
    }

    if (resolutionPlan?.decision === "blocked_missing_clean_name") {
        actions.push({
            action: "insert_import_error",
            entity_type: "import_error",
            external_id: stopExtId,
            entity_ref: candidateRef,
            payload: {
                entity_type: "stop",
                error_code: "BLOCKED_MISSING_CLEAN_NAME",
                error_message: "Stop candidate is missing a clean Myanmar name.",
                candidate_id: stop.candidate_id,
            },
        });
        summary.import_errors_planned++;
        return null;
    }

    if (shouldImportPlaceholderStop(resolutionPlan)) {
        planPlaceholderStopFromCandidate({
            actions,
            summary,
            conflicts,
            catalog,
            stop,
            resolutionPlan,
            stopRef,
            stopExtId,
        });
        plannedStopRefs.add(stopRef);
        return stopRef;
    }

    if (resolutionPlan?.decision === "blocked_conflict") {
        actions.push({
            action: "blocked_conflict",
            entity_type: "stop",
            external_id: stopExtId,
            entity_ref: candidateRef,
            existing_entity_id: resolutionPlan.matched_stop_id,
            payload: {
                candidate_id: stop.candidate_id,
                matched_stop_id: resolutionPlan.matched_stop_id,
                warnings: resolutionPlan.warnings,
            },
            reason: "Protected existing stop conflicts with extracted data.",
        });
        summary.blocked_conflicts++;
        conflicts.push({
            code: "STOP_PROTECTED_CONFLICT",
            message: `Stop candidate ${stop.candidate_id} conflicts with protected existing stop.`,
            entity_type: "stop",
            external_id: stopExtId,
            existing_entity_id: resolutionPlan.matched_stop_id,
            candidate_id: stop.candidate_id,
        });
        summary.conflicts++;
        return null;
    }

    const matchedStopId = resolutionPlan?.matched_stop_id ?? null;
    const existingStop = matchedStopId ? catalog.stops_by_id.get(matchedStopId) : undefined;
    const oppositeDirectionReuse = resolutionPlan?.warnings.includes("OPPOSITE_DIRECTION_STOP_REUSE");

    if (
        matchedStopId &&
        !oppositeDirectionReuse &&
        (resolutionPlan?.decision === "reuse_existing_stop" ||
            resolutionPlan?.decision === "merge_additional_data_to_existing")
    ) {
        const reuseRef = entityRefStopExisting(matchedStopId);

        if (existingStop && isProtectedReviewStatus(existingStop.review_status)) {
            actions.push({
                action: "reuse_existing_stop",
                entity_type: "stop",
                external_id: stopExtId,
                entity_ref: reuseRef,
                existing_entity_id: matchedStopId,
                payload: {
                    candidate_id: stop.candidate_id,
                    matched_stop_id: matchedStopId,
                    geometry: stop.geometry,
                    geom_source: stop.geom_source,
                    safe_source_link_only: true,
                    protected_stop_reuse: true,
                    protected_stop_not_modified: true,
                    normalized_data: resolutionPlan?.stop_identity ?? {},
                },
            });
            summary.stops_to_reuse++;
        } else if (resolutionPlan.decision === "merge_additional_data_to_existing") {
            actions.push({
                action: "merge_additional_stop_data",
                entity_type: "stop",
                external_id: stopExtId,
                entity_ref: reuseRef,
                existing_entity_id: matchedStopId,
                payload: {
                    candidate_id: stop.candidate_id,
                    matched_stop_id: matchedStopId,
                    merge_actions: resolutionPlan.merge_actions,
                    fill_name_mm: !existingStop?.name_mm && stop.primary_name_my,
                    fill_name_en: !existingStop?.name_en && stop.primary_name_en,
                    geometry: stop.geometry,
                    geom_source: stop.geom_source,
                    normalized_data: {
                        ...(resolutionPlan?.stop_identity ?? {}),
                        ...(stop.normalized_data ?? {}),
                    },
                },
            });
            summary.stops_to_merge++;
        } else {
            actions.push({
                action: "reuse_existing_stop",
                entity_type: "stop",
                external_id: stopExtId,
                entity_ref: reuseRef,
                existing_entity_id: matchedStopId,
                payload: {
                    candidate_id: stop.candidate_id,
                    matched_stop_id: matchedStopId,
                    geometry: stop.geometry,
                    geom_source: stop.geom_source,
                },
            });
            summary.stops_to_reuse++;
        }

        planSourceLink(actions, summary, catalog, "stop", stopExtId, reuseRef, {
            candidate_id: stop.candidate_id,
            candidate_key: stop.candidate_key,
            route_code: routeCode,
            direction_key: directionKey,
            sequence,
        });
        plannedStopRefs.add(stopRef);
        return reuseRef;
    }

    const stopIdentity = resolutionPlan?.stop_identity;
    const duplicateReviewRequired =
        Boolean(resolutionPlan?.duplicate_review_required) ||
        oppositeDirectionReuse ||
        Boolean(stopIdentity?.duplicate_review_required);
    const confidenceScore = duplicateReviewRequired
        ? (resolutionPlan?.import_confidence_score ?? MANUAL_REVIEW_CONFIDENCE_SCORE)
        : stop.confidence_score;
    const possibleSharedTerminal =
        !resolutionPlan?.shared_terminal &&
        resolutionPlan?.stop_place_key &&
        resolutionPlan?.direction_key;

    actions.push({
        action: "insert_stop",
        entity_type: "stop",
        external_id: stopExtId,
        entity_ref: stopRef,
        payload: {
            candidate_id: stop.candidate_id,
            candidate_key: stop.candidate_key,
            name_mm: stop.primary_name_my,
            name_en: stop.primary_name_en,
            name: primaryDisplayName(stop.primary_name_my, stop.primary_name_en),
            mode: TRANSPORT_MODE_BUS,
            stop_type: STOP_TYPE_STOP,
            geometry: stop.geometry,
            review_status: duplicateReviewRequired
                ? "needs_review"
                : DEFAULT_REVIEW_STATUS.stop,
            confidence_score: confidenceScore,
            normalized_data: {
                ...stop.normalized_data,
                ...(stopIdentity ?? {}),
                duplicate_review_required: duplicateReviewRequired,
                possible_duplicate_stop_ids: resolutionPlan?.possible_duplicate_stop_ids ?? [],
                direction_key: directionKey,
                boarding_stop_key: resolutionPlan?.boarding_stop_key ?? stop.candidate_key,
                boarding_side_key: resolutionPlan?.boarding_side_key ?? null,
                side_group: resolutionPlan?.side_group ?? null,
                direction_family: resolutionPlan?.direction_family ?? null,
                stop_place_key: resolutionPlan?.stop_place_key ?? null,
                match_confidence_reason: duplicateReviewRequired
                    ? (resolutionPlan?.match_confidence_reason ?? "uncertain_created_separate_stop")
                    : (resolutionPlan?.match_confidence_reason ?? null),
                possible_shared_terminal: possibleSharedTerminal ? true : undefined,
                ybs_go: {
                    candidate_key: stop.candidate_key,
                    boarding_stop_key: resolutionPlan?.boarding_stop_key ?? stop.candidate_key,
                    boarding_side_key: resolutionPlan?.boarding_side_key ?? null,
                    stop_place_key: resolutionPlan?.stop_place_key ?? null,
                    area_text_my: stop.area_text_my,
                    area_text_en: stop.area_text_en,
                    route_code: routeCode,
                    direction_key: directionKey,
                    sequence,
                },
            },
        },
    });
    summary.stops_to_create++;

    if (stop.primary_name_my) {
        actions.push({
            action: "insert_stop_name",
            entity_type: "stop",
            external_id: stopExtId,
            entity_ref: stopRef,
            payload: {
                stop_ref: stopRef,
                name: stop.primary_name_my,
                language_code: "my",
                is_primary: true,
            },
        });
        summary.stop_names_to_insert++;
    }

    if (stop.primary_name_en) {
        actions.push({
            action: "insert_stop_name",
            entity_type: "stop",
            external_id: stopExtId,
            entity_ref: stopRef,
            payload: {
                stop_ref: stopRef,
                name: stop.primary_name_en,
                language_code: "en",
                is_primary: true,
            },
        });
        summary.stop_names_to_insert++;
    }

    if (duplicateReviewRequired) {
        conflicts.push({
            code: oppositeDirectionReuse
                ? "OPPOSITE_DIRECTION_STOP_REUSE"
                : "STOP_NEEDS_MANUAL_REVIEW",
            message: oppositeDirectionReuse
                ? `Separate boarding stop created for ${routeCode} ${directionKey} sequence ${sequence} after opposite-direction reuse was prevented.`
                : `New stop candidate ${stop.candidate_id} created with needs_review duplicate flag.`,
            entity_type: "stop",
            external_id: stopExtId,
            candidate_id: stop.candidate_id,
        });
        summary.conflicts++;
    }

    planSourceLink(actions, summary, catalog, "stop", stopExtId, stopRef, {
        candidate_id: stop.candidate_id,
        candidate_key: stop.candidate_key,
        route_code: routeCode,
        direction_key: directionKey,
        sequence,
    });
    plannedStopRefs.add(stopRef);
    return stopRef;
}

function emptySummary(): DryRunPlanSummary {
    return {
        routes_to_insert: 0,
        routes_to_update: 0,
        routes_skipped_protected: 0,
        operators_to_upsert: 0,
        route_variants_to_insert: 0,
        stops_to_create: 0,
        stops_to_reuse: 0,
        stops_to_merge: 0,
        stop_names_to_insert: 0,
        route_names_to_insert: 0,
        route_stops_to_insert: 0,
        route_paths_to_insert: 0,
        fares_to_insert: 0,
        source_links_to_create: 0,
        source_links_to_reuse: 0,
        import_errors_planned: 0,
        blocked_conflicts: 0,
        blockers: 0,
        warnings: 0,
        placeholder_stop_geometry_count: 0,
        placeholder_route_path_count: 0,
        conflicts: 0,
        total_actions: 0,
    };
}

type GeometryMetadata = {
    geom_source?: unknown;
    geometry_quality?: unknown;
    needs_geometry_review?: unknown;
    validator_required?: unknown;
    public_safe?: unknown;
};

function geometryMetadata(value: Record<string, unknown> | undefined): GeometryMetadata {
    const geometry = value?.geometry;
    return geometry && typeof geometry === "object"
        ? (geometry as GeometryMetadata)
        : {};
}

function isPublicSafeFalse(value: Record<string, unknown> | undefined): boolean {
    return geometryMetadata(value).public_safe === false;
}

function isValidatorRequired(value: Record<string, unknown> | undefined): boolean {
    return geometryMetadata(value).validator_required === true;
}

function isReviewGeometry(value: Record<string, unknown> | undefined): boolean {
    const metadata = geometryMetadata(value);
    return (
        metadata.public_safe === false ||
        metadata.validator_required === true ||
        metadata.needs_geometry_review === true ||
        metadata.geometry_quality === "placeholder" ||
        metadata.geometry_quality === "interpolated"
    );
}

function hasPointGeometry(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }

    const geometry = value as { type?: unknown; coordinates?: unknown };
    return (
        geometry.type === "Point" &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length === 2 &&
        geometry.coordinates.every((coordinate) => Number.isFinite(Number(coordinate)))
    );
}

function hasLineStringGeometry(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }

    const geometry = value as { type?: unknown; coordinates?: unknown };
    return (
        geometry.type === "LineString" &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length >= 2 &&
        geometry.coordinates.every(
            (coordinate) =>
                Array.isArray(coordinate) &&
                coordinate.length === 2 &&
                coordinate.every((part) => Number.isFinite(Number(part))),
        )
    );
}

function pushPlaceholderWarning(
    warnings: PlanWarning[],
    summary: DryRunPlanSummary,
    details: Omit<PlanWarning, "code" | "message"> & { message?: string },
): void {
    warnings.push({
        code: "PLACEHOLDER_GEOMETRY_REQUIRES_REVIEW",
        message:
            details.message ??
            "Generated placeholder geometry is allowed only while review_status=needs_review and public_safe=false.",
        route_code: details.route_code,
        variant_code: details.variant_code,
        candidate_id: details.candidate_id,
    });
    summary.warnings++;
}

async function loadSupabaseCatalog(databaseUrl: string): Promise<SupabaseCatalog> {
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

            const sourceLinks = await client.query<ExistingSourceLinkRow>(`
                SELECT entity_type, entity_id::int, external_id, source_name, source_kind
                FROM transport.source_links
                WHERE source_name = $1
                  AND external_id LIKE '%ybs_go:%'
            `, [YBS_SOURCE_NAME]);

            const operators = await client.query<ExistingOperatorRow>(`
                SELECT id::int, operator_code, name, review_status
                FROM transport.operators
                WHERE deleted_at IS NULL
            `);

            const routes = await client.query<ExistingRouteRow>(`
                SELECT id::int, route_code, operator_id::int, public_name, review_status
                FROM transport.routes
                WHERE deleted_at IS NULL
            `);

            const stops = await client.query<ExistingStopRow>(`
                SELECT id::int, review_status, name_mm, name_en
                FROM transport.stops
                WHERE deleted_at IS NULL
            `);

            await client.query("COMMIT");

            const source_links_by_external_id = new Map<string, ExistingSourceLinkRow>();
            for (const row of sourceLinks.rows) {
                source_links_by_external_id.set(row.external_id, row);
            }

            const operators_by_code = new Map<string, ExistingOperatorRow>();
            for (const row of operators.rows) {
                operators_by_code.set(row.operator_code.toUpperCase(), row);
            }

            const routes_by_code = new Map<string, ExistingRouteRow>();
            for (const row of routes.rows) {
                routes_by_code.set(row.route_code, row);
            }

            const stops_by_id = new Map<number, ExistingStopRow>();
            for (const row of stops.rows) {
                stops_by_id.set(row.id, row);
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
                source_links_by_external_id,
                operators_by_code,
                routes_by_code,
                stops_by_id,
            };
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

function createEmptyCatalog(): SupabaseCatalog {
    return {
        loaded_at: new Date().toISOString(),
        database_url_host: null,
        source_links_by_external_id: new Map(),
        operators_by_code: new Map(),
        routes_by_code: new Map(),
        stops_by_id: new Map(),
    };
}

function planSourceLink(
    actions: PlanAction[],
    summary: DryRunPlanSummary,
    catalog: SupabaseCatalog,
    entityType: SourceLinkEntityType,
    externalId: string,
    entityRef: string,
    payload: Record<string, unknown> = {},
): void {
    const existing = findSourceLink(catalog, externalId);
    if (existing) {
        actions.push({
            action: "reuse_source_link",
            entity_type: entityType,
            external_id: externalId,
            entity_ref: entityRef,
            existing_entity_id: existing.entity_id,
            payload: {
                existing_entity_id: existing.entity_id,
                source_name: YBS_SOURCE_NAME,
                source_kind: YBS_SOURCE_KIND,
                ...payload,
            },
        });
        summary.source_links_to_reuse++;
        return;
    }

    actions.push({
        action: "insert_source_link",
        entity_type: entityType,
        external_id: externalId,
        entity_ref: entityRef,
        payload: {
            source_name: YBS_SOURCE_NAME,
            source_kind: YBS_SOURCE_KIND,
            external_id: externalId,
            is_primary: true,
            ...payload,
        },
    });
    summary.source_links_to_create++;
}

function renderReportMarkdown(report: Phase8DryRunReport): string {
    const blockerLines =
        report.blockers.length > 0
            ? report.blockers.map((item) => `- ${item.code}: ${item.message}`).join("\n")
            : "- None";

    const warningLines =
        report.warnings.length > 0
            ? report.warnings.map((item) => `- ${item.code}: ${item.message}`).join("\n")
            : "- None";

    const conflictLines =
        report.conflicts.length > 0
            ? report.conflicts.map((item) => `- ${item.code}: ${item.message}`).join("\n")
            : "- None";

    const routeGeometryLines =
        report.route_geometry_reports.length > 0
            ? report.route_geometry_reports
                  .map(
                      (item) =>
                          `- ${item.route_code}: placeholder stops=${item.placeholder_stop_geometry_count}, placeholder paths=${item.placeholder_route_path_count}, public_hidden_until_review=${item.public_hidden_until_review}, validator_required=${item.validator_required}`,
                  )
                  .join("\n")
            : "- None";

    const routeReadinessLines =
        report.route_readiness_reports.length > 0
            ? report.route_readiness_reports
                  .map(
                      (item) =>
                          `- ${item.route_code}: executable=${item.executable}, policy=${item.route_policy}, update_mode=${item.existing_route_update_mode}, risk=${item.risk_level}, new_stops=${item.new_stops_count}, reused_stops=${item.reused_stops_count}, manual_review=${item.manual_review_stops_count}, held=${item.held_for_review_count}, placeholder_geom=${item.placeholder_geometry_count}, source_links_create=${item.source_links_to_create}`,
                  )
                  .join("\n")
            : "- None";

    return [
        "# Phase 8 YBS Supabase Dry-Run Report",
        "",
        `Generated at: ${report.generated_at}`,
        `Run root: ${report.run_root}`,
        `Plan: ${report.plan_path}`,
        "",
        "## Summary",
        "",
        `- Routes to insert: ${report.summary.routes_to_insert}`,
        `- Routes to update: ${report.summary.routes_to_update}`,
        `- Routes skipped (protected): ${report.summary.routes_skipped_protected}`,
        `- Operators to upsert: ${report.summary.operators_to_upsert}`,
        `- Route variants to insert: ${report.summary.route_variants_to_insert}`,
        `- Stops to create: ${report.summary.stops_to_create}`,
        `- Stops to reuse: ${report.summary.stops_to_reuse}`,
        `- Stops to merge: ${report.summary.stops_to_merge}`,
        `- Route stops to insert: ${report.summary.route_stops_to_insert}`,
        `- Route paths to insert: ${report.summary.route_paths_to_insert}`,
        `- Fares to insert: ${report.summary.fares_to_insert}`,
        `- Source links to create: ${report.summary.source_links_to_create}`,
        `- Source links to reuse: ${report.summary.source_links_to_reuse}`,
        `- Import errors planned: ${report.summary.import_errors_planned}`,
        `- Blocked conflicts: ${report.summary.blocked_conflicts}`,
        `- Blockers: ${report.summary.blockers}`,
        `- Warnings: ${report.summary.warnings}`,
        `- Placeholder stop geometry: ${report.summary.placeholder_stop_geometry_count}`,
        `- Placeholder route paths: ${report.summary.placeholder_route_path_count}`,
        `- Conflicts: ${report.summary.conflicts}`,
        `- Total planned actions: ${report.summary.total_actions}`,
        `- Bulk import readiness: ${report.bulk_import_readiness.overall_status}`,
        "",
        "## Route readiness",
        "",
        routeReadinessLines,
        "",
        "## Blockers",
        "",
        blockerLines,
        "",
        "## Warnings",
        "",
        warningLines,
        "",
        "## Route geometry review",
        "",
        routeGeometryLines,
        "",
        "## Conflicts",
        "",
        conflictLines,
        "",
    ].join("\n");
}

export async function buildDryRunPlan(
    options: BuildDryRunPlanOptions,
): Promise<{ plan: DryRunPlan; report: Phase8DryRunReport }> {
    const runRoot = resolveFromRepo(options.runRoot);
    const geometryPath = path.join(runRoot, "db-prep", "routes-with-geometry.json");
    const resolutionPath = path.join(runRoot, "db-prep", "stop-resolution-plan.json");
    const dryRunDir = path.join(runRoot, "supabase-dry-run");
    const reportsDir = path.join(runRoot, "reports");

    fs.mkdirSync(dryRunDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    const geometry = readJsonFile<RoutesWithGeometryOutput>(geometryPath);
    const resolution = readJsonFile<StopResolutionPlanFile>(resolutionPath);
    const planByCandidateId = new Map(
        resolution.plans.map((entry) => [entry.candidate_id, entry]),
    );

    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const catalog =
        !options.skipSupabase && databaseUrl
            ? await loadSupabaseCatalog(databaseUrl)
            : createEmptyCatalog();

    const actions: PlanAction[] = [];
    const blockers: PlanBlocker[] = [...geometry.blocked_routes.map((item) => ({
        code: item.block_code,
        message: item.message,
        route_code: item.route_code,
        variant_code: item.variant_code,
    }))];
    const warnings: PlanWarning[] = [];
    const conflicts: PlanConflict[] = [];
    const routeGeometryReports: RouteGeometryReviewReport[] = [];
    const summary = emptySummary();
    summary.blockers = blockers.length;

    const importBatch: ImportBatchPlan = {
        action: "create_import_batch",
        entity_ref: "$import_batch:ybs-go",
        payload: {
            source_name: YBS_SOURCE_NAME,
            source_kind: YBS_SOURCE_KIND,
            import_scope: "ybs_go_routes",
            import_mode: "dry_run_plan",
            status: "planned",
            source_file_path: geometryPath,
            notes: "Phase 8 dry-run plan for YBS Go extracted routes. No database writes.",
        },
    };

    const resolvedStopByCandidateId = new Map(
        geometry.resolved_stops.map((stop) => [stop.candidate_id, stop]),
    );
    const readyVariantCodes = new Set(
        geometry.prepared_variants
            .filter((variant) => variant.geometry_status === "ready")
            .map((variant) => variant.variant_code),
    );
    const variantDirectionByCode = new Map(
        geometry.prepared_variants.map((variant) => [variant.variant_code, variant.direction_key]),
    );
    const plannedRouteStopRefs = new Set<string>();
    const routeUpdateModeByRouteCode = new Map<string, string>();
    const routeStopLinkByVariantSeq = new Map(
        geometry.route_stops.map((link) => [`${link.variant_code}:${link.sequence}`, link]),
    );

    for (const preparedRoute of geometry.prepared_routes) {
        const routeCode = String(preparedRoute.route_code);
        const routeVariants = geometry.prepared_variants.filter(
            (item) => item.route_code === routeCode,
        );
        const routeStopsForRoute = geometry.route_stops.filter(
            (item) => item.route_code === routeCode,
        );
        const routePathsForRoute = geometry.route_paths.filter(
            (item) => item.route_code === routeCode,
        );
        const routeStopCandidateIds = new Set(
            routeStopsForRoute.map((item) => item.candidate_id),
        );
        const stopsForRoute = [...routeStopCandidateIds]
            .map((candidateId) => resolvedStopByCandidateId.get(candidateId))
            .filter(
                (stop): stop is RoutesWithGeometryOutput["resolved_stops"][number] =>
                    Boolean(stop),
            );
        const placeholderStopGeometryCount = stopsForRoute.filter((stop) =>
            isReviewGeometry(stop.normalized_data),
        ).length;
        const placeholderRoutePathCount = routePathsForRoute.filter((routePath) =>
            isReviewGeometry(routePath.normalized_data),
        ).length;

        routeGeometryReports.push({
            route_code: routeCode,
            placeholder_stop_geometry_count: placeholderStopGeometryCount,
            placeholder_route_path_count: placeholderRoutePathCount,
            public_hidden_until_review: true,
            validator_required: placeholderStopGeometryCount > 0 || placeholderRoutePathCount > 0,
        });
        summary.placeholder_stop_geometry_count += placeholderStopGeometryCount;
        summary.placeholder_route_path_count += placeholderRoutePathCount;

        if (!routeCode.trim()) {
            blockers.push({
                code: "ROUTE_CODE_MISSING",
                message: "Route import needs a valid route_code.",
                route_code: routeCode,
            });
            summary.blockers++;
        }

        if (routeVariants.length === 0) {
            blockers.push({
                code: "ROUTE_VARIANTS_MISSING",
                message: `Route ${routeCode} has no prepared variants.`,
                route_code: routeCode,
            });
            summary.blockers++;
        }

        if (routeStopsForRoute.length === 0) {
            blockers.push({
                code: "ROUTE_STOPS_MISSING",
                message: `Route ${routeCode} has no route_stops.`,
                route_code: routeCode,
            });
            summary.blockers++;
        }

        for (const stop of stopsForRoute) {
            if (!hasPointGeometry(stop.geometry)) {
                blockers.push({
                    code: "STOP_GEOMETRY_MISSING",
                    message: `Stop ${stop.candidate_id} has no geometry.`,
                    route_code: routeCode,
                    candidate_id: stop.candidate_id,
                });
                summary.blockers++;
                continue;
            }

            if (isReviewGeometry(stop.normalized_data)) {
                if (stop.review_status !== "needs_review") {
                    blockers.push({
                        code: "PLACEHOLDER_STOP_REVIEW_STATUS_INVALID",
                        message: `Generated stop geometry for ${stop.candidate_id} must stay needs_review.`,
                        route_code: routeCode,
                        candidate_id: stop.candidate_id,
                    });
                    summary.blockers++;
                }
                if (!isPublicSafeFalse(stop.normalized_data)) {
                    blockers.push({
                        code: "PLACEHOLDER_STOP_PUBLIC_SAFE_INVALID",
                        message: `Generated stop geometry for ${stop.candidate_id} must set public_safe=false.`,
                        route_code: routeCode,
                        candidate_id: stop.candidate_id,
                    });
                    summary.blockers++;
                }
                if (!isValidatorRequired(stop.normalized_data)) {
                    blockers.push({
                        code: "PLACEHOLDER_STOP_VALIDATOR_FLAG_MISSING",
                        message: `Generated stop geometry for ${stop.candidate_id} must require validator review.`,
                        route_code: routeCode,
                        candidate_id: stop.candidate_id,
                    });
                    summary.blockers++;
                }
                pushPlaceholderWarning(warnings, summary, {
                    route_code: routeCode,
                    candidate_id: stop.candidate_id,
                    message: `Generated stop geometry for ${stop.candidate_id} requires dashboard review before public release.`,
                });
            }
        }

        for (const variant of routeVariants) {
            const routePath = routePathsForRoute.find(
                (item) => item.variant_code === variant.variant_code,
            );
            if (!routePath) {
                blockers.push({
                    code: "ROUTE_PATH_MISSING",
                    message: `Variant ${variant.variant_code} has no route_path.`,
                    route_code: routeCode,
                    variant_code: variant.variant_code,
                });
                summary.blockers++;
                continue;
            }

            if (!hasLineStringGeometry(routePath.geometry)) {
                blockers.push({
                    code: "ROUTE_PATH_GEOMETRY_MISSING",
                    message: `Variant ${variant.variant_code} route_path has no geometry.`,
                    route_code: routeCode,
                    variant_code: variant.variant_code,
                });
                summary.blockers++;
                continue;
            }

            if (isReviewGeometry(routePath.normalized_data)) {
                if (routePath.review_status !== "needs_review") {
                    blockers.push({
                        code: "PLACEHOLDER_ROUTE_PATH_REVIEW_STATUS_INVALID",
                        message: `Generated route path for ${variant.variant_code} must stay needs_review.`,
                        route_code: routeCode,
                        variant_code: variant.variant_code,
                    });
                    summary.blockers++;
                }
                if (!isPublicSafeFalse(routePath.normalized_data)) {
                    blockers.push({
                        code: "PLACEHOLDER_ROUTE_PATH_PUBLIC_SAFE_INVALID",
                        message: `Generated route path for ${variant.variant_code} must set public_safe=false.`,
                        route_code: routeCode,
                        variant_code: variant.variant_code,
                    });
                    summary.blockers++;
                }
                if (!isValidatorRequired(routePath.normalized_data)) {
                    blockers.push({
                        code: "PLACEHOLDER_ROUTE_PATH_VALIDATOR_FLAG_MISSING",
                        message: `Generated route path for ${variant.variant_code} must require validator review.`,
                        route_code: routeCode,
                        variant_code: variant.variant_code,
                    });
                    summary.blockers++;
                }
                pushPlaceholderWarning(warnings, summary, {
                    route_code: routeCode,
                    variant_code: variant.variant_code,
                    message: `Generated route path for ${variant.variant_code} requires dashboard review before public release.`,
                });
            }
        }

        const operatorCode = normalizeOperatorCode(
            typeof preparedRoute.operator_name === "string"
                ? preparedRoute.operator_name
                : null,
        );
        const operatorRef = entityRefOperator(operatorCode);
        const routeRef = entityRefRoute(routeCode);
        const routeExtId = routeExternalId(routeCode);
        const operatorExtId = operatorExternalId(operatorCode);

        const existingOperator = catalog.operators_by_code.get(operatorCode);
        const existingRouteLink = findSourceLink(catalog, routeExtId);
        const existingRoute =
            existingRouteLink
                ? catalog.routes_by_code.get(routeCode)
                : catalog.routes_by_code.get(routeCode);
        const routePolicy = resolveRoutePolicy(
            Boolean(existingRoute),
            existingRoute?.review_status ?? null,
            Boolean(options.replaceExistingUnreviewedRouteStops),
        );
        routeUpdateModeByRouteCode.set(routeCode, routePolicy.existing_route_update_mode);

        actions.push({
            action: "upsert_operator",
            entity_type: "operator",
            external_id: operatorExtId,
            entity_ref: operatorRef,
            existing_entity_id: existingOperator?.id ?? null,
            payload: {
                operator_code: operatorCode,
                name: operatorCode,
                primary_mode: TRANSPORT_MODE_BUS,
                review_status: DEFAULT_REVIEW_STATUS.operator,
            },
        });
        summary.operators_to_upsert++;
        planSourceLink(actions, summary, catalog, "operator", operatorExtId, operatorRef, {
            operator_code: operatorCode,
        });

        if (existingRoute && !existingRouteLink) {
            blockers.push({
                code: "NON_YBS_EXISTING_ROUTE_COLLISION",
                message:
                    `Route ${routeCode} exists (id=${existingRoute.id}) without YBS source_link ${routeExtId}. ` +
                    "Remove the pre-existing route first with cleanup-test-ybs-route.ts --allow-non-ybs-route, then re-run the dry-run plan.",
                route_code: routeCode,
            });
            summary.blockers++;
            continue;
        }

        if (existingRoute && isProtectedReviewStatus(existingRoute.review_status)) {
            actions.push({
                action: "skip_protected_route",
                entity_type: "route",
                external_id: routeExtId,
                entity_ref: routeRef,
                existing_entity_id: existingRoute.id,
                payload: {
                    route_code: routeCode,
                    review_status: existingRoute.review_status,
                },
                reason: "Existing route is protected and must not be overwritten.",
            });
            summary.routes_skipped_protected++;
            planSourceLink(actions, summary, catalog, "route", routeExtId, routeRef, {
                route_code: routeCode,
                existing_entity_id: existingRoute.id,
            });
            continue;
        }

        const routePayload = {
            route_code: routeCode,
            operator_ref: operatorRef,
            public_name:
                typeof preparedRoute.public_name === "string"
                    ? preparedRoute.public_name
                    : typeof preparedRoute.route_name_my === "string"
                      ? preparedRoute.route_name_my
                      : primaryDisplayName(
                            typeof preparedRoute.route_name_my === "string"
                                ? preparedRoute.route_name_my
                                : null,
                            typeof preparedRoute.route_name_en === "string"
                                ? preparedRoute.route_name_en
                                : null,
                        ),
            mode: TRANSPORT_MODE_BUS,
            route_kind: ROUTE_KIND_URBAN,
            origin_name:
                (typeof preparedRoute.origin_name === "string"
                    ? preparedRoute.origin_name
                    : null) ??
                geometry.prepared_variants.find((variant) => variant.route_code === routeCode)
                    ?.origin_name ??
                null,
            destination_name:
                (typeof preparedRoute.destination_name === "string"
                    ? preparedRoute.destination_name
                    : null) ??
                geometry.prepared_variants.find((variant) => variant.route_code === routeCode)
                    ?.destination_name ??
                null,
            review_status: DEFAULT_REVIEW_STATUS.route,
            confidence_score: preparedRoute.confidence_score ?? null,
            normalized_data: {
                ybs_go: {
                    route_number: preparedRoute.route_number ?? null,
                    route_display_code: preparedRoute.route_display_code ?? null,
                    fare_text: preparedRoute.fare_text ?? null,
                    source_title_my: preparedRoute.source_title_my ?? null,
                    source_title_en: preparedRoute.source_title_en ?? null,
                    route_name_alias_und: preparedRoute.route_name_alias_und ?? routeCode,
                },
            },
        };

        if (existingRoute && isMergeableReviewStatus(existingRoute.review_status)) {
            actions.push({
                action: "update_unreviewed_route",
                entity_type: "route",
                external_id: routeExtId,
                entity_ref: routeRef,
                existing_entity_id: existingRoute.id,
                payload: {
                    ...routePayload,
                    existing_route_update_mode: routePolicy.existing_route_update_mode,
                },
            });
            summary.routes_to_update++;
        } else if (!existingRoute) {
            actions.push({
                action: "insert_route",
                entity_type: "route",
                external_id: routeExtId,
                entity_ref: routeRef,
                payload: routePayload,
            });
            summary.routes_to_insert++;
        } else {
            conflicts.push({
                code: "ROUTE_REVIEW_STATUS_UNSUPPORTED",
                message: `Route ${routeCode} exists with review_status=${existingRoute.review_status}.`,
                entity_type: "route",
                external_id: routeExtId,
                existing_entity_id: existingRoute.id,
                route_code: routeCode,
            });
            summary.conflicts++;
        }

        planSourceLink(actions, summary, catalog, "route", routeExtId, routeRef, {
            route_code: routeCode,
        });

        const routeNameMy =
            typeof preparedRoute.route_name_my === "string" ? preparedRoute.route_name_my : null;
        const routeNameEn =
            typeof preparedRoute.route_name_en === "string" ? preparedRoute.route_name_en : null;

        if (routeNameMy) {
            actions.push({
                action: "insert_route_name",
                entity_type: "route",
                external_id: routeExtId,
                entity_ref: routeRef,
                payload: {
                    route_ref: routeRef,
                    name: routeNameMy,
                    language_code: "my",
                    name_type: "primary",
                    is_primary: true,
                },
            });
            summary.route_names_to_insert++;
        }

        if (routeNameEn) {
            actions.push({
                action: "insert_route_name",
                entity_type: "route",
                external_id: routeExtId,
                entity_ref: routeRef,
                payload: {
                    route_ref: routeRef,
                    name: routeNameEn,
                    language_code: "en",
                    name_type: "primary",
                    is_primary: true,
                },
            });
            summary.route_names_to_insert++;
        }

        actions.push({
            action: "insert_route_name",
            entity_type: "route",
            external_id: routeExtId,
            entity_ref: routeRef,
            payload: {
                route_ref: routeRef,
                name: routeCode,
                language_code: "und",
                name_type: "alias",
                is_primary: false,
            },
        });
        summary.route_names_to_insert++;

        const fareMin =
            typeof preparedRoute.fare_min === "number" ? preparedRoute.fare_min : null;
        const fareMax =
            typeof preparedRoute.fare_max === "number" ? preparedRoute.fare_max : null;

        if (fareMin !== null || fareMax !== null) {
            const fareRef = entityRefFare(routeCode);
            const fareExtId = fareExternalId(routeCode);
            actions.push({
                action: "insert_fare",
                entity_type: "fare",
                external_id: fareExtId,
                entity_ref: fareRef,
                payload: {
                    route_ref: routeRef,
                    fare_type: FARE_TYPE_FLAT,
                    amount_min: fareMin,
                    amount_max: fareMax,
                    currency_code: CURRENCY_CODE_MMK,
                    note: preparedRoute.fare_text ?? null,
                    review_status: DEFAULT_REVIEW_STATUS.fare,
                },
            });
            summary.fares_to_insert++;
            planSourceLink(actions, summary, catalog, "fare", fareExtId, fareRef, {
                route_code: routeCode,
            });
        }

        for (const variant of routeVariants) {
            const variantRef = entityRefVariant(routeCode, variant.direction_key);
            const variantExtId = variantExternalId(routeCode, variant.direction_key);

            if (variant.geometry_status !== "ready") {
                continue;
            }

            actions.push({
                action: "insert_route_variant",
                entity_type: "route_variant",
                external_id: variantExtId,
                entity_ref: variantRef,
                payload: {
                    route_ref: routeRef,
                    variant_code: variant.variant_code,
                    direction_name: variant.direction_name,
                    direction_id: variant.gtfs_direction_id,
                    origin_name: variant.origin_name,
                    destination_name: variant.destination_name,
                    headsign: variant.destination_name,
                    review_status: DEFAULT_REVIEW_STATUS.route_variant,
                },
            });
            summary.route_variants_to_insert++;
            planSourceLink(actions, summary, catalog, "route_variant", variantExtId, variantRef, {
                route_code: routeCode,
                direction_key: variant.direction_key,
            });

            const routePath = geometry.route_paths.find(
                (item) => item.variant_code === variant.variant_code,
            );
            if (routePath) {
                const pathRef = entityRefRoutePath(routeCode, variant.direction_key);
                const pathExtId = routePathExternalId(routeCode, variant.direction_key);
                actions.push({
                    action: "insert_route_path",
                    entity_type: "route_path",
                    external_id: pathExtId,
                    entity_ref: pathRef,
                    payload: {
                        variant_ref: variantRef,
                        path_kind: ROUTE_PATH_KIND_CORRIDOR_ESTIMATE,
                        geometry: routePath.geometry,
                        distance_m: routePath.distance_m,
                        review_status: DEFAULT_REVIEW_STATUS.route_path,
                        confidence_score: routePath.confidence_score,
                        normalized_data: routePath.normalized_data,
                    },
                });
                summary.route_paths_to_insert++;
                planSourceLink(actions, summary, catalog, "route_path", pathExtId, pathRef, {
                    route_code: routeCode,
                    direction_key: variant.direction_key,
                });
            }
        }
    }

    const plannedUsageStopRefs = new Set<string>();
    const usedBaseStopRefByVariant = new Map<string, Set<string>>();

    for (const routeStop of geometry.route_stops) {
        if (!readyVariantCodes.has(routeStop.variant_code)) {
            continue;
        }

        const directionKey =
            variantDirectionByCode.get(routeStop.variant_code) ??
            (routeStop.variant_code.endsWith("-INBOUND") ? "inbound" : "outbound");
        const variantRef = entityRefVariant(routeStop.route_code, directionKey);

        const resolvedStop = resolvedStopByCandidateId.get(routeStop.candidate_id);
        if (!resolvedStop) {
            blockers.push({
                code: "UNRESOLVED_STOP_ID_FOR_SEQUENCE",
                message: `Route stop sequence ${routeStop.sequence} has no resolved stop for candidate ${routeStop.candidate_id}.`,
                route_code: routeStop.route_code,
                variant_code: routeStop.variant_code,
                candidate_id: routeStop.candidate_id,
            });
            summary.blockers++;
            continue;
        }

        const resolutionPlan = planByCandidateId.get(routeStop.candidate_id);
        let stopRef = ensureRouteStopStopPlanned({
            actions,
            summary,
            conflicts,
            catalog,
            stop: resolvedStop,
            resolutionPlan,
            routeCode: routeStop.route_code,
            directionKey,
            sequence: routeStop.sequence,
            plannedStopRefs: plannedRouteStopRefs,
        });
        if (!stopRef) {
            continue;
        }

        const usedOnVariant = usedBaseStopRefByVariant.get(variantRef) ?? new Set<string>();
        if (usedOnVariant.has(stopRef)) {
            const resolvedStop = resolvedStopByCandidateId.get(routeStop.candidate_id);
            if (!resolvedStop) {
                blockers.push({
                    code: "UNRESOLVED_STOP_ID_FOR_SEQUENCE",
                    message: `Duplicate usage at sequence ${routeStop.sequence} missing resolved stop ${routeStop.candidate_id}.`,
                    route_code: routeStop.route_code,
                    variant_code: routeStop.variant_code,
                    candidate_id: routeStop.candidate_id,
                });
                summary.blockers++;
                continue;
            }

            const usageRef = entityRefStopUsage(
                routeStop.candidate_id,
                directionKey,
                routeStop.sequence,
            );
            const usageExtId = directionAwareStopExternalId(
                routeStop.route_code,
                directionKey,
                routeStop.sequence,
            );
            if (!plannedUsageStopRefs.has(usageRef)) {
                planUsagePlaceholderStop({
                    actions,
                    summary,
                    conflicts,
                    catalog,
                    stop: resolvedStop,
                    directionKey,
                    sourceSequence: routeStop.sequence,
                    usageRef,
                    usageExtId,
                });
                plannedUsageStopRefs.add(usageRef);
            }
            stopRef = usageRef;
        } else {
            usedOnVariant.add(stopRef);
            usedBaseStopRefByVariant.set(variantRef, usedOnVariant);
        }

        const routeStopRef = entityRefRouteStop(
            routeStop.route_code,
            directionKey,
            routeStop.sequence,
        );
        const routeStopExtId = routeStopExternalId(
            routeStop.route_code,
            directionKey,
            routeStop.sequence,
        );

        const routeStopLink = routeStopLinkByVariantSeq.get(
            `${routeStop.variant_code}:${routeStop.sequence}`,
        );

        actions.push({
            action: "insert_route_stop",
            entity_type: "route_stop",
            external_id: routeStopExtId,
            entity_ref: routeStopRef,
            payload: {
                variant_ref: variantRef,
                stop_ref: stopRef,
                stop_sequence: routeStop.sequence,
                source_sequence: routeStop.sequence,
                direction_key: directionKey,
                candidate_id: routeStop.candidate_id,
                review_geometry: routeStopLink?.review_geometry ?? null,
                review_geometry_data: routeStopLink?.review_geometry_data ?? null,
                physical_stop_geom_preserved: routeStopLink?.physical_stop_geom_preserved ?? false,
                existing_route_update_mode:
                    routeUpdateModeByRouteCode.get(routeStop.route_code) ??
                    "append_missing_sequences_only",
            },
        });
        summary.route_stops_to_insert++;
        planSourceLink(actions, summary, catalog, "route_stop", routeStopExtId, routeStopRef, {
            route_code: routeStop.route_code,
            direction_key: directionKey,
            sequence: routeStop.sequence,
        });
    }

    summary.total_actions = actions.length + 1;

    const routeReadinessReports = buildRouteReadinessReports({
        runRoot,
        plan: {
            schema_version: PHASE8_SCHEMA_VERSION,
            generated_at: new Date().toISOString(),
            run_root: runRoot,
            source_name: YBS_SOURCE_NAME,
            source_kind: YBS_SOURCE_KIND,
            import_batch: importBatch,
            actions,
            blockers,
            warnings,
            conflicts,
            route_geometry_reports: routeGeometryReports,
            route_readiness_reports: [],
            bulk_import_readiness: attachBulkImportReadiness(runRoot, []),
            summary,
        },
        geometry,
        resolutionPlans: resolution.plans,
        catalog,
        replaceExistingUnreviewedRouteStops: Boolean(options.replaceExistingUnreviewedRouteStops),
    });
    const bulkImportReadiness = attachBulkImportReadiness(runRoot, routeReadinessReports);

    const plan: DryRunPlan = {
        schema_version: PHASE8_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        source_name: YBS_SOURCE_NAME,
        source_kind: YBS_SOURCE_KIND,
        import_batch: importBatch,
        actions,
        blockers,
        warnings,
        conflicts,
        route_geometry_reports: routeGeometryReports,
        route_readiness_reports: routeReadinessReports,
        bulk_import_readiness: bulkImportReadiness,
        summary,
    };

    const planPath = path.join(dryRunDir, "plan.json");
    const reportJsonPath = path.join(reportsDir, "phase8-supabase-dry-run.json");
    const reportMarkdownPath = path.join(reportsDir, "phase8-supabase-dry-run.md");

    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    const report: Phase8DryRunReport = {
        generated_at: plan.generated_at,
        run_root: runRoot,
        plan_path: planPath,
        summary,
        blockers,
        warnings,
        conflicts,
        route_geometry_reports: routeGeometryReports,
        route_readiness_reports: routeReadinessReports,
        bulk_import_readiness: bulkImportReadiness,
    };

    fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportMarkdownPath, `${renderReportMarkdown(report)}\n`, "utf8");

    return { plan, report };
}

function parseCliArgs(argv: string[]): BuildDryRunPlanOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let databaseUrl: string | undefined;
    let skipSupabase = false;
    let replaceExistingUnreviewedRouteStops = false;

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
        } else if (arg === "--replace-existing-unreviewed-route-stops") {
            replaceExistingUnreviewedRouteStops = true;
        }
    }

    return { runRoot, databaseUrl, skipSupabase, replaceExistingUnreviewedRouteStops };
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const { report } = await buildDryRunPlan(parseCliArgs(process.argv.slice(2)));

    console.log("Phase 8 Supabase dry-run plan complete.");
    console.log(`Plan: ${report.plan_path}`);
    console.log(`Routes to insert: ${report.summary.routes_to_insert}`);
    console.log(`Routes to update: ${report.summary.routes_to_update}`);
    console.log(`Routes skipped (protected): ${report.summary.routes_skipped_protected}`);
    console.log(`Stops to create: ${report.summary.stops_to_create}`);
    console.log(`Stops to reuse: ${report.summary.stops_to_reuse}`);
    console.log(`Stops to merge: ${report.summary.stops_to_merge}`);
    console.log(`Route stops to insert: ${report.summary.route_stops_to_insert}`);
    console.log(`Route paths to insert: ${report.summary.route_paths_to_insert}`);
    console.log(`Source links to create: ${report.summary.source_links_to_create}`);
    console.log(`Source links to reuse: ${report.summary.source_links_to_reuse}`);
    console.log(`Blockers: ${report.summary.blockers}`);
    console.log(`Warnings: ${report.summary.warnings}`);
    console.log(`Placeholder stop geometry: ${report.summary.placeholder_stop_geometry_count}`);
    console.log(`Placeholder route paths: ${report.summary.placeholder_route_path_count}`);
    console.log(`Conflicts: ${report.summary.conflicts}`);
    console.log(`Blocked conflicts: ${report.summary.blocked_conflicts}`);
    console.log(`Total actions: ${report.summary.total_actions}`);
    console.log(`Bulk import readiness: ${report.bulk_import_readiness.overall_status}`);
    for (const route of report.route_readiness_reports) {
        console.log(
            `  ${route.route_code}: executable=${route.executable} risk=${route.risk_level} policy=${route.route_policy}`,
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
