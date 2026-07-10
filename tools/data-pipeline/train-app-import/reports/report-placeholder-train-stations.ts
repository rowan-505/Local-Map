#!/usr/bin/env npx tsx
/**
 * Read-only report: placeholder train stops created by simple_train_system_v1.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/reports/report-placeholder-train-stations.ts
 */

import fs from "node:fs";
import process from "node:process";

import {
    loadDatabaseEnv,
    resolveDatabaseUrl,
    withReadOnlyClient,
} from "../lib/db.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import { TRAIN_IMPORT_GENERATION, TRAIN_MODE } from "../lib/train-import-constants.js";

const JSON_REPORT_FILENAME = "placeholder-stations-review.json";
const MARKDOWN_REPORT_FILENAME = "placeholder-stations-review.md";

export type PlaceholderStationPriority = "high" | "medium" | "low";

export type PlaceholderTrainStationRow = {
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
    priority: PlaceholderStationPriority;
};

export type PlaceholderTrainStationReport = {
    generated_at: string;
    generation: typeof TRAIN_IMPORT_GENERATION;
    mode: typeof TRAIN_MODE;
    summary: {
        total_stations: number;
        high_priority: number;
        medium_priority: number;
        low_priority: number;
        total_v1_route_stop_usages: number;
    };
    stations: PlaceholderTrainStationRow[];
};

export type ReportPlaceholderTrainStationsOptions = {
    runRoot?: string;
    databaseUrl?: string;
};

export function priorityForUsageCount(usageCount: number): PlaceholderStationPriority {
    if (usageCount >= 10) {
        return "high";
    }
    if (usageCount >= 3) {
        return "medium";
    }
    return "low";
}

export function comparePlaceholderStations(
    a: PlaceholderTrainStationRow,
    b: PlaceholderTrainStationRow,
): number {
    const priorityRank: Record<PlaceholderStationPriority, number> = {
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

function summarizeReport(stations: PlaceholderTrainStationRow[]): PlaceholderTrainStationReport["summary"] {
    return {
        total_stations: stations.length,
        high_priority: stations.filter((row) => row.priority === "high").length,
        medium_priority: stations.filter((row) => row.priority === "medium").length,
        low_priority: stations.filter((row) => row.priority === "low").length,
        total_v1_route_stop_usages: stations.reduce((sum, row) => sum + row.usage_count, 0),
    };
}

async function loadPlaceholderTrainStations(databaseUrl: string): Promise<PlaceholderTrainStationRow[]> {
    return withReadOnlyClient(databaseUrl, async (client) => {
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
                        WHERE rs2.stop_id = s.id
                          AND (
                              rs2.normalized_data->>'generation' = $2
                              OR rs2.source_refs->>'generation' = $2
                          )
                        ORDER BY r2.route_code
                        LIMIT 10
                    ) AS route_codes_sub
                ) AS route_codes
            FROM transport.stops AS s
            LEFT JOIN transport.route_stops AS rs
                ON rs.stop_id = s.id
               AND (
                   rs.normalized_data->>'generation' = $2
                   OR rs.source_refs->>'generation' = $2
               )
            LEFT JOIN transport.route_variants AS rv
                ON rv.id = rs.route_variant_id
               AND rv.deleted_at IS NULL
            LEFT JOIN transport.routes AS r
                ON r.id = rv.route_id
               AND r.deleted_at IS NULL
            WHERE s.mode = $1
              AND s.deleted_at IS NULL
              AND s.normalized_data->>'generation' = $2
            GROUP BY s.id, s.name, s.name_mm, s.name_en, s.review_status, s.is_active, s.geom
            ORDER BY s.id ASC
            `,
            [TRAIN_MODE, TRAIN_IMPORT_GENERATION],
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
                priority: priorityForUsageCount(usage_count),
            };
        });
    });
}

export function renderPlaceholderStationMarkdown(report: PlaceholderTrainStationReport): string {
    const lines: string[] = [
        "# Placeholder train stations review",
        "",
        `Generated: ${report.generated_at}`,
        "",
        "## Summary",
        "",
        `- Total placeholder stations: ${report.summary.total_stations}`,
        `- High priority (usage >= 10): ${report.summary.high_priority}`,
        `- Medium priority (usage >= 3): ${report.summary.medium_priority}`,
        `- Low priority: ${report.summary.low_priority}`,
        `- Total v1 route_stop usages: ${report.summary.total_v1_route_stop_usages}`,
        "",
        "## Stations (high → medium → low, then usage count)",
        "",
        "| Priority | stop_id | usage | name | name_en | lon | lat | review_status | active | route_codes |",
        "|---|---:|---:|---|---|---:|---:|---|---|---|",
    ];

    for (const row of report.stations) {
        const routeCodes =
            row.route_codes.length > 0
                ? row.route_codes.join(", ") + (row.route_codes_truncated ? " …" : "")
                : "(none)";
        lines.push(
            `| ${row.priority} | ${row.stop_id} | ${row.usage_count} | ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.name_en ?? "")} | ${formatCoord(row.lon)} | ${formatCoord(row.lat)} | ${row.review_status} | ${row.is_active} | ${escapeMarkdownCell(routeCodes)} |`,
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

/** Generate read-only placeholder train station review reports. */
export async function reportPlaceholderTrainStations(
    options: ReportPlaceholderTrainStationsOptions = {},
): Promise<{
    jsonReportPath: string;
    markdownReportPath: string;
    report: PlaceholderTrainStationReport;
}> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const stations = (await loadPlaceholderTrainStations(databaseUrl)).sort(comparePlaceholderStations);

    const report: PlaceholderTrainStationReport = {
        generated_at: new Date().toISOString(),
        generation: TRAIN_IMPORT_GENERATION,
        mode: TRAIN_MODE,
        summary: summarizeReport(stations),
        stations,
    };

    const jsonReportPath = reportPath(paths, JSON_REPORT_FILENAME);
    const markdownReportPath = reportPath(paths, MARKDOWN_REPORT_FILENAME);

    fs.writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(markdownReportPath, renderPlaceholderStationMarkdown(report), "utf8");

    return { jsonReportPath, markdownReportPath, report };
}

function parseCliArgs(argv: string[]): ReportPlaceholderTrainStationsOptions {
    const options: ReportPlaceholderTrainStationsOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        }
    }

    return options;
}

function printSummary(
    jsonReportPath: string,
    markdownReportPath: string,
    report: PlaceholderTrainStationReport,
): void {
    console.log(`JSON report: ${jsonReportPath}`);
    console.log(`Markdown report: ${markdownReportPath}`);
    console.log(
        `Stations: ${report.summary.total_stations} ` +
            `(high=${report.summary.high_priority}, medium=${report.summary.medium_priority}, low=${report.summary.low_priority})`,
    );

    for (const row of report.stations.slice(0, 10)) {
        console.log(
            `  [${row.priority}] stop_id=${row.stop_id} usage=${row.usage_count} name=${row.name}`,
        );
    }

    if (report.stations.length > 10) {
        console.log(`  ... ${report.stations.length - 10} more in report files`);
    }
}

export function runReportPlaceholderTrainStationsSelfTest(): void {
    if (priorityForUsageCount(10) !== "high") {
        throw new Error("expected high priority at 10");
    }
    if (priorityForUsageCount(9) !== "medium") {
        throw new Error("expected medium priority at 9");
    }
    if (priorityForUsageCount(2) !== "low") {
        throw new Error("expected low priority at 2");
    }

    const sorted = [
        {
            stop_id: 2,
            priority: "medium" as const,
            usage_count: 5,
            name: "B",
            name_mm: null,
            name_en: null,
            review_status: "needs_review",
            is_active: false,
            lon: 96.1,
            lat: 19.7,
            route_codes: ["TRAIN-1"],
            route_codes_truncated: false,
        },
        {
            stop_id: 1,
            priority: "high" as const,
            usage_count: 12,
            name: "A",
            name_mm: null,
            name_en: null,
            review_status: "needs_review",
            is_active: false,
            lon: 96.1,
            lat: 19.7,
            route_codes: ["TRAIN-2"],
            route_codes_truncated: false,
        },
    ].sort(comparePlaceholderStations);

    if (sorted[0]?.stop_id !== 1) {
        throw new Error("expected high-priority station first");
    }

    const markdown = renderPlaceholderStationMarkdown({
        generated_at: "2026-07-09T00:00:00.000Z",
        generation: TRAIN_IMPORT_GENERATION,
        mode: TRAIN_MODE,
        summary: summarizeReport(sorted),
        stations: sorted,
    });
    if (!markdown.includes("# Placeholder train stations review")) {
        throw new Error("expected markdown heading");
    }

    console.log("ok - report-placeholder-train-stations self-test");
}

async function main(): Promise<void> {
    const { jsonReportPath, markdownReportPath, report } = await reportPlaceholderTrainStations(
        parseCliArgs(process.argv.slice(2)),
    );
    printSummary(jsonReportPath, markdownReportPath, report);
}

const isCliEntry = process.argv[1]?.includes("report-placeholder-train-stations.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("report-placeholder-train-stations.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runReportPlaceholderTrainStationsSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
