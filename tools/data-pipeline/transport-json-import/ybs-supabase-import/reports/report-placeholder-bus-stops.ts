#!/usr/bin/env npx tsx
/**
 * Read-only report: YBS bus stops with placeholder or manually-reviewed geometry.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/reports/report-placeholder-bus-stops.ts
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/reports/report-placeholder-bus-stops.ts --write-input-template
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/reports/report-placeholder-bus-stops.ts --route-code YBS-1
 */

import fs from "node:fs";
import process from "node:process";

import {
    BUS_MODE,
    PLACEHOLDER_BUS_STOPS_REPORT_JSON,
    PLACEHOLDER_BUS_STOPS_REPORT_MD,
    REVIEWED_STOP_GEOMETRY_FILENAME,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
    defaultBusGeometryRunPaths,
    ensureBusGeometryRunLayout,
    loadDatabaseEnv,
    placeholderBusStopGeometrySql,
    reportPath,
    resolveDatabaseUrl,
    reviewedStopGeometryInputPath,
    withReadOnlyClient,
    ybsStopSourceLinkExistsSql,
} from "../lib/placeholder-bus-stop-geometry.js";
import { PLACEHOLDER_GEOMETRY_MODE } from "../../ybs-db-prepare/geometry-rules.js";

export type PlaceholderBusStopPriority = "high" | "medium" | "low";

export type PlaceholderBusStopRow = {
    stop_id: number;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    review_status: string;
    is_active: boolean;
    lon: number | null;
    lat: number | null;
    usage_count: number;
    route_codes: string[];
    route_codes_truncated: boolean;
    placeholder_geometry_mode: string | null;
    geometry_status: string | null;
    geom_source: string | null;
    source_external_id: string | null;
    candidate_key: string | null;
    priority: PlaceholderBusStopPriority;
};

export type PlaceholderBusStopReport = {
    generated_at: string;
    source_name: typeof YBS_SOURCE_NAME;
    source_kind: typeof YBS_SOURCE_KIND;
    mode: typeof BUS_MODE;
    filter_route_code: string | null;
    summary: {
        total_stops: number;
        high_priority: number;
        medium_priority: number;
        low_priority: number;
        total_ybs_route_stop_usages: number;
        needs_review: number;
        manual_reviewed: number;
    };
    stops: PlaceholderBusStopRow[];
};

export type ReportPlaceholderBusStopsOptions = {
    runRoot?: string;
    databaseUrl?: string;
    routeCode?: string;
    writeInputTemplate?: boolean;
};

export function priorityForUsageCount(usageCount: number): PlaceholderBusStopPriority {
    if (usageCount >= 10) {
        return "high";
    }
    if (usageCount >= 3) {
        return "medium";
    }
    return "low";
}

export function comparePlaceholderBusStops(
    a: PlaceholderBusStopRow,
    b: PlaceholderBusStopRow,
): number {
    const priorityRank: Record<PlaceholderBusStopPriority, number> = {
        high: 0,
        medium: 1,
        low: 2,
    };

    const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
    if (byPriority !== 0) {
        return byPriority;
    }

    const byUsage = b.usage_count - a.usage_count;
    if (byUsage !== 0) {
        return byUsage;
    }

    return a.stop_id - b.stop_id;
}

function summarizeReport(stops: PlaceholderBusStopRow[]): PlaceholderBusStopReport["summary"] {
    return {
        total_stops: stops.length,
        high_priority: stops.filter((row) => row.priority === "high").length,
        medium_priority: stops.filter((row) => row.priority === "medium").length,
        low_priority: stops.filter((row) => row.priority === "low").length,
        total_ybs_route_stop_usages: stops.reduce((sum, row) => sum + row.usage_count, 0),
        needs_review: stops.filter((row) => row.review_status === "needs_review").length,
        manual_reviewed: stops.filter((row) => row.geometry_status === "manual_reviewed").length,
    };
}

async function loadPlaceholderBusStops(
    databaseUrl: string,
    routeCode?: string,
): Promise<PlaceholderBusStopRow[]> {
    const routeFilterSql = routeCode
        ? `
            AND EXISTS (
                SELECT 1
                FROM transport.route_stops AS rs_filter
                INNER JOIN transport.route_variants AS rv_filter
                    ON rv_filter.id = rs_filter.route_variant_id
                   AND rv_filter.deleted_at IS NULL
                INNER JOIN transport.routes AS r_filter
                    ON r_filter.id = rv_filter.route_id
                   AND r_filter.deleted_at IS NULL
                WHERE rs_filter.stop_id = s.id
                  AND r_filter.route_code = $4
            )
        `
        : "";

    return withReadOnlyClient(databaseUrl, async (client) => {
        const params: unknown[] = [BUS_MODE, YBS_SOURCE_NAME, YBS_SOURCE_KIND];
        if (routeCode) {
            params.push(routeCode);
        }

        const result = await client.query<{
            stop_id: string;
            name: string;
            name_mm: string | null;
            name_en: string | null;
            review_status: string;
            is_active: boolean;
            lon: number | null;
            lat: number | null;
            usage_count: string;
            route_codes: string[] | null;
            placeholder_geometry_mode: string | null;
            geometry_status: string | null;
            geom_source: string | null;
            source_external_id: string | null;
            candidate_key: string | null;
        }>(
            `
            SELECT
                s.id::text AS stop_id,
                s.name,
                s.name_mm,
                s.name_en,
                s.review_status,
                s.is_active,
                ST_X(s.geom)::float8 AS lon,
                ST_Y(s.geom)::float8 AS lat,
                count(rs.id)::text AS usage_count,
                (
                    SELECT coalesce(array_agg(route_code ORDER BY route_code), ARRAY[]::text[])
                    FROM (
                        SELECT DISTINCT r2.route_code
                        FROM transport.route_stops AS rs2
                        INNER JOIN transport.route_variants AS rv2
                            ON rv2.id = rs2.route_variant_id
                           AND rv2.deleted_at IS NULL
                        INNER JOIN transport.routes AS r2
                            ON r2.id = rv2.route_id
                           AND r2.deleted_at IS NULL
                        INNER JOIN transport.source_links AS sl_route
                            ON sl_route.entity_type = 'route'
                           AND sl_route.entity_id = r2.id
                           AND sl_route.source_name = $2
                           AND sl_route.source_kind = $3
                           AND sl_route.external_id LIKE 'route:ybs_go:%'
                        WHERE rs2.stop_id = s.id
                        ORDER BY r2.route_code
                        LIMIT 10
                    ) AS route_codes_sub
                ) AS route_codes,
                coalesce(s.normalized_data->'geometry'->>'placeholder_geometry_mode', null) AS placeholder_geometry_mode,
                coalesce(s.normalized_data->>'geometry_status', null) AS geometry_status,
                coalesce(s.normalized_data->'geometry'->>'geom_source', null) AS geom_source,
                (
                    SELECT sl.external_id
                    FROM transport.source_links AS sl
                    WHERE sl.entity_type = 'stop'
                      AND sl.entity_id = s.id
                      AND sl.source_name = $2
                      AND sl.source_kind = $3
                      AND sl.external_id LIKE 'stop:ybs_go:%'
                    ORDER BY sl.id ASC
                    LIMIT 1
                ) AS source_external_id,
                coalesce(s.normalized_data->'ybs_go'->>'candidate_key', null) AS candidate_key
            FROM transport.stops AS s
            LEFT JOIN transport.route_stops AS rs
                ON rs.stop_id = s.id
            LEFT JOIN transport.route_variants AS rv
                ON rv.id = rs.route_variant_id
               AND rv.deleted_at IS NULL
            LEFT JOIN transport.routes AS r
                ON r.id = rv.route_id
               AND r.deleted_at IS NULL
            WHERE s.mode = $1
              AND s.deleted_at IS NULL
              AND s.review_status IN ('imported_unreviewed', 'needs_review', 'reviewed')
              AND ${ybsStopSourceLinkExistsSql("s")}
              AND ${placeholderBusStopGeometrySql("s")}
              ${routeFilterSql}
            GROUP BY
                s.id,
                s.name,
                s.name_mm,
                s.name_en,
                s.review_status,
                s.is_active,
                s.geom,
                s.normalized_data
            ORDER BY s.id ASC
            `,
            params,
        );

        return result.rows.map((row) => {
            const usage_count = Number(row.usage_count);
            const route_codes = row.route_codes ?? [];

            return {
                stop_id: Number(row.stop_id),
                name: row.name,
                name_mm: row.name_mm,
                name_en: row.name_en,
                review_status: row.review_status,
                is_active: row.is_active,
                lon: row.lon,
                lat: row.lat,
                usage_count,
                route_codes,
                route_codes_truncated: usage_count > route_codes.length,
                placeholder_geometry_mode: row.placeholder_geometry_mode,
                geometry_status: row.geometry_status,
                geom_source: row.geom_source,
                source_external_id: row.source_external_id,
                candidate_key: row.candidate_key,
                priority: priorityForUsageCount(usage_count),
            };
        });
    });
}

export function renderPlaceholderBusStopMarkdown(report: PlaceholderBusStopReport): string {
    const lines: string[] = [
        "# Placeholder YBS bus stops review",
        "",
        `Generated: ${report.generated_at}`,
        "",
        "## Summary",
        "",
        `- Total placeholder/review stops: ${report.summary.total_stops}`,
        `- High priority (usage >= 10): ${report.summary.high_priority}`,
        `- Medium priority (usage >= 3): ${report.summary.medium_priority}`,
        `- Low priority: ${report.summary.low_priority}`,
        `- Total YBS route_stop usages: ${report.summary.total_ybs_route_stop_usages}`,
        `- review_status=needs_review: ${report.summary.needs_review}`,
        `- geometry_status=manual_reviewed: ${report.summary.manual_reviewed}`,
        report.filter_route_code ? `- Route filter: ${report.filter_route_code}` : "",
        "",
        "## Manual fix workflow",
        "",
        "1. Generate or edit `tmp/transport-imports/reviewed-stop-geometry.json`",
        "2. Put real lon/lat for each stop_id",
        "3. Dry-run: `npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair/update-placeholder-stop-geometry.ts`",
        "4. Execute: add `--execute`",
        "",
        "## Stops (high → medium → low, then usage count)",
        "",
        "| Priority | stop_id | usage | name | name_en | lon | lat | review_status | geom_status | mode | route_codes |",
        "|---|---:|---:|---|---|---:|---:|---|---|---|---|",
    ];

    for (const row of report.stops) {
        const routeCodes =
            row.route_codes.length > 0
                ? row.route_codes.join(", ") + (row.route_codes_truncated ? " …" : "")
                : "(none)";
        lines.push(
            `| ${row.priority} | ${row.stop_id} | ${row.usage_count} | ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.name_en ?? "")} | ${formatCoord(row.lon)} | ${formatCoord(row.lat)} | ${row.review_status} | ${row.geometry_status ?? row.placeholder_geometry_mode ?? PLACEHOLDER_GEOMETRY_MODE} | ${row.geom_source ?? ""} | ${escapeMarkdownCell(routeCodes)} |`,
        );
    }

    lines.push("");
    return `${lines.join("\n")}\n`;
}

function escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatCoord(value: number | null): string {
    return value == null ? "" : value.toFixed(5);
}

export function buildReviewedStopGeometryTemplate(
    stops: PlaceholderBusStopRow[],
): Array<{
    stop_id: number;
    name_en: string | null;
    lon: number;
    lat: number;
    review_note: string;
}> {
    return stops.map((row) => ({
        stop_id: row.stop_id,
        name_en: row.name_en,
        lon: row.lon ?? 0,
        lat: row.lat ?? 0,
        review_note: `TODO: replace placeholder coordinates. source=${row.source_external_id ?? "unknown"} routes=${row.route_codes.slice(0, 3).join(", ") || "none"}`,
    }));
}

/** Generate read-only placeholder bus stop review reports. */
export async function reportPlaceholderBusStops(
    options: ReportPlaceholderBusStopsOptions = {},
): Promise<{
    jsonReportPath: string;
    markdownReportPath: string;
    inputTemplatePath: string | null;
    report: PlaceholderBusStopReport;
}> {
    const paths = defaultBusGeometryRunPaths(options.runRoot);
    ensureBusGeometryRunLayout(paths);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const stops = (await loadPlaceholderBusStops(databaseUrl, options.routeCode)).sort(
        comparePlaceholderBusStops,
    );

    const report: PlaceholderBusStopReport = {
        generated_at: new Date().toISOString(),
        source_name: YBS_SOURCE_NAME,
        source_kind: YBS_SOURCE_KIND,
        mode: BUS_MODE,
        filter_route_code: options.routeCode ?? null,
        summary: summarizeReport(stops),
        stops,
    };

    const jsonReportPath = reportPath(paths, PLACEHOLDER_BUS_STOPS_REPORT_JSON);
    const markdownReportPath = reportPath(paths, PLACEHOLDER_BUS_STOPS_REPORT_MD);

    fs.writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(markdownReportPath, renderPlaceholderBusStopMarkdown(report), "utf8");

    let inputTemplatePath: string | null = null;
    if (options.writeInputTemplate) {
        inputTemplatePath = reviewedStopGeometryInputPath(paths);
        const template = buildReviewedStopGeometryTemplate(stops);
        fs.writeFileSync(inputTemplatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    }

    return { jsonReportPath, markdownReportPath, inputTemplatePath, report };
}

function parseCliArgs(argv: string[]): ReportPlaceholderBusStopsOptions {
    const options: ReportPlaceholderBusStopsOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--route-code" && next) {
            options.routeCode = next.trim();
            i++;
        } else if (arg === "--write-input-template") {
            options.writeInputTemplate = true;
        }
    }

    return options;
}

function printSummary(
    jsonReportPath: string,
    markdownReportPath: string,
    inputTemplatePath: string | null,
    report: PlaceholderBusStopReport,
): void {
    console.log(`JSON report: ${jsonReportPath}`);
    console.log(`Markdown report: ${markdownReportPath}`);
    if (inputTemplatePath) {
        console.log(`Input template: ${inputTemplatePath}`);
    }
    console.log(
        `Stops: ${report.summary.total_stops} ` +
            `(high=${report.summary.high_priority}, medium=${report.summary.medium_priority}, low=${report.summary.low_priority})`,
    );

    for (const row of report.stops.slice(0, 10)) {
        console.log(
            `  [${row.priority}] stop_id=${row.stop_id} usage=${row.usage_count} name=${row.name}`,
        );
    }

    if (report.stops.length > 10) {
        console.log(`  ... ${report.stops.length - 10} more in report files`);
    }

    if (!inputTemplatePath) {
        console.log("");
        console.log(
            "Next: re-run with --write-input-template to create tmp/transport-imports/reviewed-stop-geometry.json",
        );
    }
}

async function main(): Promise<void> {
    const { jsonReportPath, markdownReportPath, inputTemplatePath, report } =
        await reportPlaceholderBusStops(parseCliArgs(process.argv.slice(2)));
    printSummary(jsonReportPath, markdownReportPath, inputTemplatePath, report);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("report-placeholder-bus-stops.ts") ||
        process.argv[1].endsWith("report-placeholder-bus-stops.js"));

if (isMain) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
