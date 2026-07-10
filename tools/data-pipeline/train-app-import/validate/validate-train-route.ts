#!/usr/bin/env npx tsx
/**
 * Stage 10: validate one imported train route variant (read-only SELECT).
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/validate/validate-train-route.ts --route TRAIN-141-UP
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    buildCircularRouteValidationWarnings,
    CIRCULAR_CLOSING_DUPLICATE_WARNING,
    computeValidationExpectedRouteStops,
    isCircularTrainRoute,
    readCircularRouteMetadata,
    resolveExpectedStopCount,
} from "../lib/circular-train-route.js";
import {
    loadDatabaseEnv,
    resolveDatabaseUrl,
    withReadOnlyClient,
} from "../lib/db.js";
import { parseVariantCode } from "../normalize/merge-language-routes.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    normalizedRoutePathByVariantCode,
    trainRouteValidationReportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import {
    runTrainRouteValidatorSelfTest,
    validateTrainRouteData,
    type DbRouteStopRow,
    type DbRouteRow,
    type DbVariantRow,
    type TrainRouteValidationResult,
} from "../lib/train-route-validator.js";
import type { NormalizedTrainRoute } from "../lib/types.js";

const VALIDATION_SCHEMA_VERSION = 1;

export type TrainRouteValidationReport = {
    schema_version: typeof VALIDATION_SCHEMA_VERSION;
    validated_at: string;
    variant_code: string;
    route_code: string;
    overall_status: TrainRouteValidationResult["overall_status"];
    checks: TrainRouteValidationResult["checks"];
    warnings: string[];
    summary: TrainRouteValidationResult["summary"];
    db: {
        route_id: number | null;
        variant_id: number | null;
        route_stop_count: number;
    };
    expected_stop_count: number | null;
    expected_stop_count_source: string;
    circular_route: {
        is_circular_route: boolean | null;
        closing_duplicate_stop_skipped: boolean | null;
        source_total_stations: number | null;
        imported_route_stops: number | null;
        validation_expected_route_stops: number | null;
    };
    /** @deprecated Use expected_stop_count */
    expected_total_stations: number | null;
    /** @deprecated Use expected_stop_count */
    validation_expected_route_stops: number | null;
    normalized_file: string | null;
};

export type ValidateTrainRouteOptions = {
    variantCode: string;
    runRoot?: string;
    databaseUrl?: string;
};

function loadNormalizedRouteFallback(
    paths: TrainRunPaths,
    variantCode: string,
): { expected: number | null; isCircular: boolean; normalizedFile: string | null } {
    const normalizedFile = normalizedRoutePathByVariantCode(paths, variantCode);
    if (!fs.existsSync(normalizedFile)) {
        return { expected: null, isCircular: false, normalizedFile: null };
    }

    const normalized = JSON.parse(fs.readFileSync(normalizedFile, "utf8")) as NormalizedTrainRoute;
    const stations = normalized.stations ?? [];
    return {
        expected: computeValidationExpectedRouteStops(stations),
        isCircular: isCircularTrainRoute(stations),
        normalizedFile,
    };
}

async function loadDbBundle(
    databaseUrl: string,
    variantCode: string,
): Promise<{
    route: DbRouteRow | null;
    variant: DbVariantRow | null;
    route_stops: DbRouteStopRow[];
}> {
    return withReadOnlyClient(databaseUrl, async (client) => {
        const header = await client.query<{
            route_id: string;
            route_code: string;
            mode: string;
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
                r.mode,
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
            WHERE v.variant_code = $1
              AND v.deleted_at IS NULL
              AND r.deleted_at IS NULL
            LIMIT 1
            `,
            [variantCode],
        );

        if (!header.rows[0]) {
            return { route: null, variant: null, route_stops: [] };
        }

        const row = header.rows[0];
        const route: DbRouteRow = {
            route_id: Number(row.route_id),
            route_code: row.route_code,
            mode: row.mode,
            review_status: row.route_review_status,
            is_active: row.route_is_active,
            normalized_data: row.route_normalized_data,
        };
        const variant: DbVariantRow = {
            variant_id: Number(row.variant_id),
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
                (s.geom IS NOT NULL) AS has_geom
            FROM transport.route_stops AS rs
            LEFT JOIN transport.stops AS s
                ON s.id = rs.stop_id
               AND s.deleted_at IS NULL
            WHERE rs.route_variant_id = $1
            ORDER BY rs.stop_sequence ASC
            `,
            [variant.variant_id],
        );

        const route_stops: DbRouteStopRow[] = stops.rows.map((stop) => ({
            route_stop_id: Number(stop.route_stop_id),
            stop_id: stop.stop_id ? Number(stop.stop_id) : null,
            stop_sequence: stop.stop_sequence,
            arrival_offset_seconds: stop.arrival_offset_seconds,
            departure_offset_seconds: stop.departure_offset_seconds,
            source_time_type: stop.source_time_type,
            stop_exists: stop.stop_exists,
            stop_mode: stop.stop_mode,
            has_geom: stop.has_geom,
        }));

        return { route, variant, route_stops };
    });
}

/** Validate one imported train route variant against the database. */
export async function validateTrainRoute(
    options: ValidateTrainRouteOptions,
): Promise<{ reportPath: string; report: TrainRouteValidationReport }> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    const { expected: fallbackExpected, isCircular: normalizedFileIsCircular, normalizedFile } =
        loadNormalizedRouteFallback(paths, options.variantCode);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const bundle = await loadDbBundle(databaseUrl, options.variantCode);
    const resolvedExpected = resolveExpectedStopCount({
        routeNormalizedData: bundle.route?.normalized_data,
        variantNormalizedData: bundle.variant?.normalized_data,
        normalizedFileFallback: fallbackExpected,
        normalizedFileIsCircular,
    });
    const circularRoute = readCircularRouteMetadata(bundle.variant?.normalized_data);
    const circularWarnings = [
        ...buildCircularRouteValidationWarnings(bundle.variant?.normalized_data),
        ...(circularRoute.closing_duplicate_stop_skipped !== true &&
        normalizedFileIsCircular &&
        fallbackExpected != null &&
        bundle.route_stops.length === fallbackExpected
            ? [CIRCULAR_CLOSING_DUPLICATE_WARNING]
            : []),
    ];
    const validationWarnings = [...new Set(circularWarnings)];
    const validation = validateTrainRouteData({
        variant_code: options.variantCode,
        route: bundle.route,
        variant: bundle.variant,
        route_stops: bundle.route_stops,
        expected_stop_count: resolvedExpected.expected_stop_count,
        warnings: validationWarnings,
    });

    const routeCode = bundle.route?.route_code ?? `TRAIN-${parseVariantCode(options.variantCode).trainNumber}`;

    const report: TrainRouteValidationReport = {
        schema_version: VALIDATION_SCHEMA_VERSION,
        validated_at: new Date().toISOString(),
        variant_code: options.variantCode,
        route_code: routeCode,
        overall_status: validation.overall_status,
        checks: validation.checks,
        warnings: validation.warnings,
        summary: validation.summary,
        db: {
            route_id: bundle.route?.route_id ?? null,
            variant_id: bundle.variant?.variant_id ?? null,
            route_stop_count: bundle.route_stops.length,
        },
        expected_stop_count: resolvedExpected.expected_stop_count,
        expected_stop_count_source: resolvedExpected.expected_stop_count_source,
        circular_route: circularRoute,
        expected_total_stations: resolvedExpected.expected_stop_count,
        validation_expected_route_stops: resolvedExpected.expected_stop_count,
        normalized_file: normalizedFile,
    };

    const outputPath = trainRouteValidationReportPath(paths, options.variantCode);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { reportPath: outputPath, report };
}

function parseCliArgs(argv: string[]): ValidateTrainRouteOptions {
    const options: ValidateTrainRouteOptions = {
        variantCode: "",
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--route" && next) {
            options.variantCode = next.trim();
            i++;
        } else if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        }
    }

    if (!options.variantCode) {
        throw new Error('Missing --route TRAIN-<number>-<UP|DOWN>.');
    }

    return options;
}

function printSummary(report: TrainRouteValidationReport, outputPath: string): void {
    console.log(`Validation report: ${outputPath}`);
    console.log(`Overall: ${report.overall_status}`);
    console.log(
        `Route stops: ${report.db.route_stop_count}, expected: ${report.expected_stop_count ?? "unknown"} ` +
            `(source=${report.expected_stop_count_source})`,
    );
    console.log(`Passed: ${report.summary.passed}, failed: ${report.summary.failed}, skipped: ${report.summary.skipped}`);
    for (const warning of report.warnings) {
        console.log(`  [warning] ${warning}`);
    }
    for (const row of report.checks) {
        if (row.status !== "passed") {
            console.log(`  [${row.status}] #${row.check_id} ${row.name}: ${row.message}`);
        }
    }
}

async function main(): Promise<void> {
    const { reportPath, report } = await validateTrainRoute(parseCliArgs(process.argv.slice(2)));
    printSummary(report, reportPath);
    if (report.overall_status !== "passed") {
        process.exitCode = 1;
    }
}

const isCliEntry = process.argv[1]?.includes("validate-train-route.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("validate-train-route.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runTrainRouteValidatorSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
