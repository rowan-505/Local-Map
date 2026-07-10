#!/usr/bin/env npx tsx
/**
 * Activate simple_train_system_v1 train routes when data quality checks pass.
 *
 * Default: dry-run. Pass --execute to commit.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/repair/activate-reviewed-train-routes.ts
 *   npx tsx tools/data-pipeline/train-app-import/repair/activate-reviewed-train-routes.ts --execute
 */

import fs from "node:fs";
import process from "node:process";

import type pg from "pg";

import {
    buildCircularRouteValidationWarnings,
    computeValidationExpectedRouteStops,
    isCircularTrainRoute,
    resolveExpectedStopCount,
} from "../lib/circular-train-route.js";
import { loadDatabaseEnv, resolveDatabaseUrl, withWriteClient } from "../lib/db.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    normalizedRoutePathByVariantCode,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import {
    TRAIN_IMPORT_GENERATION,
    TRAIN_IMPORT_REVIEW_STATUS,
    TRAIN_MODE,
} from "../lib/train-import-constants.js";
import {
    validateTrainRouteData,
    type DbRouteRow,
    type DbRouteStopRow,
    type DbVariantRow,
    type TrainRouteValidationResult,
} from "../lib/train-route-validator.js";
import type { NormalizedTrainRoute } from "../lib/types.js";

const REPORT_FILENAME = "activate-reviewed-train-routes.json";

const IMMUTABLE_REVIEW_STATUSES = new Set(["verified", "manual_protected"]);

export type ActivationRouteStopRow = DbRouteStopRow & {
    stop_review_status: string | null;
    stop_generation: string | null;
};

export type TrainVariantActivationBundle = {
    route: DbRouteRow;
    variant: DbVariantRow;
    route_stops: ActivationRouteStopRow[];
};

export type TrainVariantActivationPlanItem = {
    route_id: number;
    route_code: string;
    variant_id: number;
    variant_code: string;
    action: "activate" | "skip";
    skip_reason: string | null;
    route_stop_count: number;
    expected_stop_count: number | null;
    expected_stop_count_source: string | null;
    placeholder_stop_ids: number[];
    validation_status: TrainRouteValidationResult["overall_status"];
    failed_checks: string[];
    warnings: string[];
};

export type TrainRouteActivationResult = {
    dry_run: boolean;
    executed: boolean;
    activated_route_count: number;
    activated_variant_count: number;
    skipped_variant_count: number;
    items: TrainVariantActivationPlanItem[];
};

export type ActivateReviewedTrainRoutesOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
};

function loadNormalizedFileFallback(
    paths: TrainRunPaths,
    variantCode: string,
): { expected: number | null; isCircular: boolean } {
    const normalizedFile = normalizedRoutePathByVariantCode(paths, variantCode);
    if (!fs.existsSync(normalizedFile)) {
        return { expected: null, isCircular: false };
    }

    const normalized = JSON.parse(fs.readFileSync(normalizedFile, "utf8")) as NormalizedTrainRoute;
    const stations = normalized.stations ?? [];
    return {
        expected: computeValidationExpectedRouteStops(stations),
        isCircular: isCircularTrainRoute(stations),
    };
}

function isImmutableReviewStatus(status: string | null | undefined): boolean {
    return IMMUTABLE_REVIEW_STATUSES.has((status ?? "").trim());
}

function isAlreadyActivated(route: DbRouteRow, variant: DbVariantRow): boolean {
    return route.is_active && variant.is_active && route.review_status === "reviewed" && variant.review_status === "reviewed";
}

export function findPlaceholderStopIds(stops: ActivationRouteStopRow[]): number[] {
    const ids = new Set<number>();

    for (const row of stops) {
        if (!row.stop_id || row.stop_id <= 0) {
            continue;
        }
        if (
            row.stop_generation === TRAIN_IMPORT_GENERATION &&
            row.stop_review_status === "needs_review"
        ) {
            ids.add(row.stop_id);
        }
    }

    return [...ids].sort((a, b) => a - b);
}

export function validationPassedForActivation(result: TrainRouteValidationResult): {
    ok: boolean;
    failed_checks: string[];
} {
    const failed_checks = result.checks
        .filter((row) => row.check_id !== 15 && row.status === "failed")
        .map((row) => `#${row.check_id} ${row.name}: ${row.message}`);

    return {
        ok: failed_checks.length === 0,
        failed_checks,
    };
}

export function evaluateVariantActivation(
    bundle: TrainVariantActivationBundle,
    options: {
        normalizedFileFallback: number | null;
        normalizedFileIsCircular: boolean;
    },
): TrainVariantActivationPlanItem {
    const base = {
        route_id: bundle.route.route_id,
        route_code: bundle.route.route_code,
        variant_id: bundle.variant.variant_id,
        variant_code: bundle.variant.variant_code,
        route_stop_count: bundle.route_stops.length,
    };

    if (bundle.route.mode !== TRAIN_MODE) {
        return {
            ...base,
            action: "skip",
            skip_reason: `route mode is ${bundle.route.mode}, not ${TRAIN_MODE}`,
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids: [],
            validation_status: "failed",
            failed_checks: [],
            warnings: [],
        };
    }

    if (
        isImmutableReviewStatus(bundle.route.review_status) ||
        isImmutableReviewStatus(bundle.variant.review_status)
    ) {
        return {
            ...base,
            action: "skip",
            skip_reason: "route or variant has immutable review_status (verified/manual_protected)",
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids: [],
            validation_status: "failed",
            failed_checks: [],
            warnings: [],
        };
    }

    if (isAlreadyActivated(bundle.route, bundle.variant)) {
        return {
            ...base,
            action: "skip",
            skip_reason: "route and variant are already reviewed and active",
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids: [],
            validation_status: "passed",
            failed_checks: [],
            warnings: [],
        };
    }

    const placeholder_stop_ids = findPlaceholderStopIds(bundle.route_stops);
    if (placeholder_stop_ids.length > 0) {
        return {
            ...base,
            action: "skip",
            skip_reason: `route uses placeholder stop(s) still needing review: ${placeholder_stop_ids.join(", ")}`,
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids,
            validation_status: "failed",
            failed_checks: [],
            warnings: [],
        };
    }

    const missingGeom = bundle.route_stops.find(
        (row) => row.stop_id && row.stop_exists && !row.has_geom,
    );
    if (missingGeom) {
        return {
            ...base,
            action: "skip",
            skip_reason: `stop_id ${missingGeom.stop_id} at sequence ${missingGeom.stop_sequence} has no geometry`,
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids,
            validation_status: "failed",
            failed_checks: [],
            warnings: [],
        };
    }

    const sortedStops = [...bundle.route_stops].sort((a, b) => a.stop_sequence - b.stop_sequence);
    const sequenceGap = sortedStops.find((row, index) => row.stop_sequence !== index + 1);
    if (sortedStops.length === 0) {
        return {
            ...base,
            action: "skip",
            skip_reason: "variant has no route_stops",
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids,
            validation_status: "failed",
            failed_checks: [],
            warnings: [],
        };
    }
    if (sequenceGap) {
        return {
            ...base,
            action: "skip",
            skip_reason: `route_stop sequence gap at sequence ${sequenceGap.stop_sequence}`,
            expected_stop_count: null,
            expected_stop_count_source: null,
            placeholder_stop_ids,
            validation_status: "failed",
            failed_checks: [],
            warnings: [],
        };
    }

    const resolvedExpected = resolveExpectedStopCount({
        routeNormalizedData: bundle.route.normalized_data,
        variantNormalizedData: bundle.variant.normalized_data,
        normalizedFileFallback: options.normalizedFileFallback,
        normalizedFileIsCircular: options.normalizedFileIsCircular,
    });

    const warnings = buildCircularRouteValidationWarnings(bundle.variant.normalized_data);
    const validation = validateTrainRouteData({
        variant_code: bundle.variant.variant_code,
        route: bundle.route,
        variant: bundle.variant,
        route_stops: bundle.route_stops,
        expected_stop_count: resolvedExpected.expected_stop_count,
        warnings,
    });
    const validationGate = validationPassedForActivation(validation);

    if (!validationGate.ok) {
        return {
            ...base,
            action: "skip",
            skip_reason: validationGate.failed_checks.join("; "),
            expected_stop_count: resolvedExpected.expected_stop_count,
            expected_stop_count_source: resolvedExpected.expected_stop_count_source,
            placeholder_stop_ids,
            validation_status: "failed",
            failed_checks: validationGate.failed_checks,
            warnings: validation.warnings,
        };
    }

    return {
        ...base,
        action: "activate",
        skip_reason: null,
        expected_stop_count: resolvedExpected.expected_stop_count,
        expected_stop_count_source: resolvedExpected.expected_stop_count_source,
        placeholder_stop_ids,
        validation_status: "passed",
        failed_checks: [],
        warnings: validation.warnings,
    };
}

export function applyRouteSiblingGate(
    items: TrainVariantActivationPlanItem[],
): TrainVariantActivationPlanItem[] {
    const byRoute = new Map<number, TrainVariantActivationPlanItem[]>();
    for (const item of items) {
        const group = byRoute.get(item.route_id) ?? [];
        group.push(item);
        byRoute.set(item.route_id, group);
    }

    return items.map((item) => {
        if (item.action !== "activate") {
            return item;
        }

        const siblings = byRoute.get(item.route_id) ?? [];
        const blockedSibling = siblings.find((row) => row.action !== "activate");
        if (!blockedSibling) {
            return item;
        }

        return {
            ...item,
            action: "skip",
            skip_reason: `sibling variant ${blockedSibling.variant_code} not eligible: ${blockedSibling.skip_reason ?? "unknown"}`,
        };
    });
}

async function loadV1TrainVariantBundles(client: pg.PoolClient): Promise<TrainVariantActivationBundle[]> {
    const headers = await client.query<{
        route_id: string;
        route_code: string;
        route_review_status: string;
        route_is_active: boolean;
        route_normalized_data: Record<string, unknown> | null;
        variant_id: string;
        variant_code: string;
        variant_review_status: string;
        variant_is_active: boolean;
        variant_normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT
            r.id::text AS route_id,
            r.route_code,
            r.review_status AS route_review_status,
            r.is_active AS route_is_active,
            r.normalized_data AS route_normalized_data,
            v.id::text AS variant_id,
            v.variant_code,
            v.review_status AS variant_review_status,
            v.is_active AS variant_is_active,
            v.normalized_data AS variant_normalized_data
        FROM transport.route_variants AS v
        INNER JOIN transport.routes AS r ON r.id = v.route_id
        WHERE v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $1
          AND r.normalized_data->>'generation' = $2
          AND v.normalized_data->>'generation' = $2
        ORDER BY r.route_code ASC, v.variant_code ASC
        `,
        [TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );

    const bundles: TrainVariantActivationBundle[] = [];

    for (const row of headers.rows) {
        const variant_id = Number(row.variant_id);
        const route: DbRouteRow = {
            route_id: Number(row.route_id),
            route_code: row.route_code,
            mode: TRAIN_MODE,
            review_status: row.route_review_status,
            is_active: row.route_is_active,
            normalized_data: row.route_normalized_data,
        };
        const variant: DbVariantRow = {
            variant_id,
            variant_code: row.variant_code,
            review_status: row.variant_review_status,
            is_active: row.variant_is_active,
            normalized_data: row.variant_normalized_data,
        };

        const stops = await client.query<{
            route_stop_id: string;
            stop_id: string | null;
            stop_sequence: number;
            arrival_offset_seconds: number | null;
            departure_offset_seconds: number | null;
            source_time_type: string | null;
            stop_exists: boolean;
            stop_mode: string | null;
            has_geom: boolean;
            stop_review_status: string | null;
            stop_generation: string | null;
        }>(
            `
            SELECT
                rs.id::text AS route_stop_id,
                rs.stop_id::text AS stop_id,
                rs.stop_sequence,
                rs.arrival_offset_seconds,
                rs.departure_offset_seconds,
                rs.source_time_type,
                (s.id IS NOT NULL) AS stop_exists,
                s.mode AS stop_mode,
                (s.geom IS NOT NULL) AS has_geom,
                s.review_status AS stop_review_status,
                s.normalized_data->>'generation' AS stop_generation
            FROM transport.route_stops AS rs
            LEFT JOIN transport.stops AS s
                ON s.id = rs.stop_id
               AND s.deleted_at IS NULL
            WHERE rs.route_variant_id = $1
            ORDER BY rs.stop_sequence ASC
            `,
            [variant_id],
        );

        const route_stops: ActivationRouteStopRow[] = stops.rows.map((stop) => ({
            route_stop_id: Number(stop.route_stop_id),
            stop_id: stop.stop_id ? Number(stop.stop_id) : null,
            stop_sequence: stop.stop_sequence,
            arrival_offset_seconds: stop.arrival_offset_seconds,
            departure_offset_seconds: stop.departure_offset_seconds,
            source_time_type: stop.source_time_type,
            stop_exists: stop.stop_exists,
            stop_mode: stop.stop_mode,
            has_geom: stop.has_geom,
            stop_review_status: stop.stop_review_status,
            stop_generation: stop.stop_generation,
        }));

        bundles.push({ route, variant, route_stops });
    }

    return bundles;
}

async function activateRoute(client: pg.PoolClient, routeId: number): Promise<boolean> {
    const result = await client.query<{ id: string }>(
        `
        UPDATE transport.routes AS r
        SET
            review_status = 'reviewed',
            is_active = true,
            updated_at = now()
        WHERE r.id = $1
          AND r.deleted_at IS NULL
          AND r.mode = $2
          AND r.normalized_data->>'generation' = $3
          AND r.review_status NOT IN ('verified', 'manual_protected')
        RETURNING r.id::text
        `,
        [routeId, TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );
    return result.rowCount === 1;
}

async function activateVariant(client: pg.PoolClient, variantId: number): Promise<boolean> {
    const result = await client.query<{ id: string }>(
        `
        UPDATE transport.route_variants AS v
        SET
            review_status = 'reviewed',
            is_active = true,
            updated_at = now()
        FROM transport.routes AS r
        WHERE v.id = $1
          AND r.id = v.route_id
          AND v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $2
          AND v.normalized_data->>'generation' = $3
          AND r.normalized_data->>'generation' = $3
          AND v.review_status NOT IN ('verified', 'manual_protected')
        RETURNING v.id::text
        `,
        [variantId, TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );
    return result.rowCount === 1;
}

/** Evaluate and optionally activate v1 train routes that pass quality checks. */
export async function activateReviewedTrainRoutes(
    options: ActivateReviewedTrainRoutesOptions = {},
): Promise<{ reportPath: string; result: TrainRouteActivationResult }> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const execute = options.execute === true;

    const result = await withWriteClient(databaseUrl, async (client) => {
        const bundles = await loadV1TrainVariantBundles(client);
        const evaluated = bundles.map((bundle) => {
            const fallback = loadNormalizedFileFallback(paths, bundle.variant.variant_code);
            return evaluateVariantActivation(bundle, {
                normalizedFileFallback: fallback.expected,
                normalizedFileIsCircular: fallback.isCircular,
            });
        });
        const items = applyRouteSiblingGate(evaluated);

        const routesToActivate = new Set<number>();
        const variantsToActivate = items.filter((item) => item.action === "activate");

        for (const item of variantsToActivate) {
            routesToActivate.add(item.route_id);
        }

        if (execute) {
            for (const routeId of routesToActivate) {
                await activateRoute(client, routeId);
            }
            for (const item of variantsToActivate) {
                const updated = await activateVariant(client, item.variant_id);
                if (!updated) {
                    item.action = "skip";
                    item.skip_reason = "activation update affected 0 rows";
                }
            }
        }

        const activatedVariants = items.filter((item) => item.action === "activate");

        return {
            dry_run: !execute,
            executed: execute,
            activated_route_count: execute ? routesToActivate.size : new Set(activatedVariants.map((row) => row.route_id)).size,
            activated_variant_count: activatedVariants.length,
            skipped_variant_count: items.length - activatedVariants.length,
            items,
        } satisfies TrainRouteActivationResult;
    });

    const report = {
        generated_at: new Date().toISOString(),
        generation: TRAIN_IMPORT_GENERATION,
        mode: TRAIN_MODE,
        import_review_status: TRAIN_IMPORT_REVIEW_STATUS,
        ...result,
    };

    const reportOutputPath = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { reportPath: reportOutputPath, result };
}

function parseCliArgs(argv: string[]): ActivateReviewedTrainRoutesOptions {
    const options: ActivateReviewedTrainRoutesOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--execute") {
            options.execute = true;
        }
    }

    return options;
}

function printSummary(reportOutputPath: string, result: TrainRouteActivationResult): void {
    console.log(`Report: ${reportOutputPath}`);
    console.log(result.executed ? "Executed activation." : "Dry run only.");
    console.log(
        `Routes to activate: ${result.activated_route_count}, variants to activate: ${result.activated_variant_count}, skipped: ${result.skipped_variant_count}`,
    );

    for (const item of result.items) {
        if (item.action === "activate") {
            console.log(`  [activate] ${item.variant_code} (${item.route_code})`);
        } else {
            console.log(`  [skip] ${item.variant_code} (${item.route_code}): ${item.skip_reason}`);
        }
    }
}

export function runActivateReviewedTrainRoutesSelfTest(): void {
    const stops: ActivationRouteStopRow[] = [
        {
            route_stop_id: 1,
            stop_id: 100,
            stop_sequence: 1,
            arrival_offset_seconds: null,
            departure_offset_seconds: 0,
            source_time_type: "departure",
            stop_exists: true,
            stop_mode: TRAIN_MODE,
            has_geom: true,
            stop_review_status: "reviewed",
            stop_generation: TRAIN_IMPORT_GENERATION,
        },
        {
            route_stop_id: 2,
            stop_id: 101,
            stop_sequence: 2,
            arrival_offset_seconds: 3600,
            departure_offset_seconds: null,
            source_time_type: "arrival",
            stop_exists: true,
            stop_mode: TRAIN_MODE,
            has_geom: true,
            stop_review_status: "reviewed",
            stop_generation: null,
        },
    ];

    const route: DbRouteRow = {
        route_id: 1,
        route_code: "TRAIN-11",
        mode: TRAIN_MODE,
        review_status: TRAIN_IMPORT_REVIEW_STATUS,
        is_active: false,
        normalized_data: { generation: TRAIN_IMPORT_GENERATION },
    };
    const variant: DbVariantRow = {
        variant_id: 2,
        variant_code: "TRAIN-11-UP",
        review_status: TRAIN_IMPORT_REVIEW_STATUS,
        is_active: false,
        normalized_data: { generation: TRAIN_IMPORT_GENERATION },
    };

    const ok = evaluateVariantActivation(
        { route, variant, route_stops: stops },
        { normalizedFileFallback: 2, normalizedFileIsCircular: false },
    );
    if (ok.action !== "activate") {
        throw new Error(`expected activate, got skip: ${ok.skip_reason}`);
    }

    const withPlaceholder = evaluateVariantActivation(
        {
            route,
            variant,
            route_stops: [
                {
                    ...stops[0]!,
                    stop_review_status: "needs_review",
                    stop_generation: TRAIN_IMPORT_GENERATION,
                },
                stops[1]!,
            ],
        },
        { normalizedFileFallback: 2, normalizedFileIsCircular: false },
    );
    if (withPlaceholder.action !== "skip" || !withPlaceholder.skip_reason?.includes("placeholder")) {
        throw new Error("expected placeholder skip");
    }

    const gated = applyRouteSiblingGate([
        {
            ...ok,
            route_id: 99,
            variant_code: "TRAIN-11-UP",
        },
        {
            ...ok,
            route_id: 99,
            variant_id: 3,
            variant_code: "TRAIN-11-DOWN",
            action: "skip",
            skip_reason: "validation failed",
        },
    ]);
    if (gated[0]?.action !== "skip" || !gated[0]?.skip_reason?.includes("sibling variant")) {
        throw new Error("expected sibling gate to block activation");
    }

    console.log("ok - activate-reviewed-train-routes self-test");
}

async function main(): Promise<void> {
    const { reportPath: reportOutputPath, result } = await activateReviewedTrainRoutes(
        parseCliArgs(process.argv.slice(2)),
    );
    printSummary(reportOutputPath, result);
}

const isCliEntry = process.argv[1]?.includes("activate-reviewed-train-routes.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("activate-reviewed-train-routes.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runActivateReviewedTrainRoutesSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
