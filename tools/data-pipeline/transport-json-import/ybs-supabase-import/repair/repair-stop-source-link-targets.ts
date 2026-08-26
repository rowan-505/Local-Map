#!/usr/bin/env npx tsx
/**
 * Repair YBS stop source_links so each sequence external_id points at the
 * actual route_stops.stop_id. Dry-run by default.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import { ensureSourceLink } from "../lib/source-link-utils.js";
import {
    directionAwareStopExternalId,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
} from "../lib/supabase-schema-map.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");
const DEFAULT_RUN_ROOT = "tmp/transport-imports/ybs-flow-test-ybs1-ybs2";

type RepairMode = "dry_run" | "execute";

type CliOptions = {
    routeCode: string;
    execute: boolean;
    runRoot: string;
    databaseUrl?: string;
};

type RouteStopUsageRow = {
    route_code: string;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    stop_sequence: number;
    stop_id: number;
    route_stop_id: number;
};

type PlannedRepairAction = {
    external_id: string;
    route_stop_id: number;
    stop_sequence: number;
    direction_key: string;
    variant_code: string;
    action: "update" | "insert";
    before_entity_id: number | null;
    after_entity_id: number;
    source_link_id: number | null;
};

export type StopSourceLinkRepairReport = {
    generated_at: string;
    mode: RepairMode;
    status: "passed" | "refused" | "failed";
    refusal_reason?: string;
    error?: string;
    route_code: string;
    route_id: number | null;
    executed: boolean;
    total_route_stops: number;
    correct_source_links_before: number;
    wrong_entity_id_before: number;
    missing_source_links_before: number;
    updated_source_links: number;
    inserted_source_links: number;
    correct_source_links_after: number;
    remaining_wrong_entity_id: number;
    remaining_missing_source_links: number;
    planned_actions: PlannedRepairAction[];
    report_json_path: string;
    report_md_path: string;
};

function loadEnv(): void {
    for (const envPath of [
        join(REPO_ROOT, "apps/api/.env"),
        join(REPO_ROOT, "infrastructure/.env"),
        join(REPO_ROOT, ".env"),
    ]) {
        if (existsSync(envPath)) {
            loadDotenv({ path: envPath, override: false });
        }
    }
}

function parseCliArgs(argv: string[]): CliOptions {
    let routeCode = "";
    let execute = false;
    let runRoot = DEFAULT_RUN_ROOT;
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === "--route-code" && next) {
            routeCode = next.trim();
            index++;
        } else if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--execute") {
            execute = true;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        }
    }

    if (!routeCode) {
        throw new Error("Missing required --route-code YBS-<number>.");
    }

    return { routeCode, execute, runRoot, databaseUrl };
}

function resolveDatabaseUrl(override?: string): string {
    const url =
        override ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.SUPABASE_DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL is not configured.");
    }
    return url;
}

function resolveDirectionKey(row: RouteStopUsageRow): "outbound" | "inbound" | null {
    if (row.direction_id === 0) {
        return "outbound";
    }
    if (row.direction_id === 1) {
        return "inbound";
    }

    return null;
}

function renderMarkdown(report: StopSourceLinkRepairReport): string {
    const lines = [
        `# Repair stop source_link targets — ${report.route_code}`,
        "",
        `Generated at: ${report.generated_at}`,
        `Mode: ${report.mode}`,
        `Status: ${report.status}`,
        "",
        "## Summary",
        "",
        `| Metric | Count |`,
        `| --- | ---: |`,
        `| total route_stops | ${report.total_route_stops} |`,
        `| correct source_links before | ${report.correct_source_links_before} |`,
        `| wrong entity_id before | ${report.wrong_entity_id_before} |`,
        `| missing source_links before | ${report.missing_source_links_before} |`,
        `| updated source_links | ${report.updated_source_links} |`,
        `| inserted source_links | ${report.inserted_source_links} |`,
        `| correct source_links after | ${report.correct_source_links_after} |`,
        `| remaining wrong entity_id | ${report.remaining_wrong_entity_id} |`,
        `| remaining missing source_links | ${report.remaining_missing_source_links} |`,
        "",
    ];

    if (report.refusal_reason) {
        lines.push(`Refusal: ${report.refusal_reason}`, "");
    }
    if (report.error) {
        lines.push(`Error: ${report.error}`, "");
    }

    lines.push("## Planned actions", "");
    if (report.planned_actions.length === 0) {
        lines.push("- None");
    } else {
        for (const action of report.planned_actions.slice(0, 50)) {
            lines.push(
                `- ${action.action} ${action.external_id}: entity_id ${action.before_entity_id ?? "missing"} → ${action.after_entity_id} (${action.variant_code} seq ${action.stop_sequence})`,
            );
        }
        if (report.planned_actions.length > 50) {
            lines.push(`- ... and ${report.planned_actions.length - 50} more`);
        }
    }

    lines.push("");
    return lines.join("\n");
}

async function loadRouteStopUsages(
    client: pg.Client,
    routeCode: string,
): Promise<{ routeId: number; rows: RouteStopUsageRow[] }> {
    const routeResult = await client.query<{ id: string }>(
        `
        SELECT id::text
        FROM transport.routes
        WHERE route_code = $1 AND deleted_at IS NULL
        LIMIT 1
        `,
        [routeCode],
    );
    const route = routeResult.rows[0];
    if (!route) {
        throw new Error(`Route not found: ${routeCode}`);
    }

    const rows = await client.query<{
        route_code: string;
        variant_code: string;
        direction_name: string | null;
        direction_id: number | null;
        stop_sequence: number;
        stop_id: string;
        route_stop_id: string;
    }>(
        `
        SELECT
            r.route_code,
            rv.variant_code,
            rv.direction_name,
            rv.direction_id::int,
            rs.stop_sequence::int,
            rs.stop_id::text,
            rs.id::text AS route_stop_id
        FROM transport.route_stops rs
        INNER JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
        INNER JOIN transport.routes r ON r.id = rv.route_id
        WHERE r.route_code = $1
          AND r.deleted_at IS NULL
          AND rv.deleted_at IS NULL
        ORDER BY rv.variant_code, rs.stop_sequence
        `,
        [routeCode],
    );

    return {
        routeId: Number(route.id),
        rows: rows.rows.map((row) => ({
            route_code: row.route_code,
            variant_code: row.variant_code,
            direction_name: row.direction_name,
            direction_id: row.direction_id,
            stop_sequence: row.stop_sequence,
            stop_id: Number(row.stop_id),
            route_stop_id: Number(row.route_stop_id),
        })),
    };
}

async function findStopSourceLink(
    client: pg.Client,
    externalId: string,
): Promise<{ id: number; entity_id: number } | null> {
    const result = await client.query<{ id: string; entity_id: string }>(
        `
        SELECT id::text, entity_id::text
        FROM transport.source_links
        WHERE entity_type = 'stop'
          AND source_name = $1
          AND source_kind = $2
          AND external_id = $3
        LIMIT 1
        `,
        [YBS_SOURCE_NAME, YBS_SOURCE_KIND, externalId],
    );

    if (!result.rows[0]) {
        return null;
    }

    return {
        id: Number(result.rows[0].id),
        entity_id: Number(result.rows[0].entity_id),
    };
}

async function assessStopSourceLinks(
    client: pg.Client,
    routeCode: string,
    usages: RouteStopUsageRow[],
): Promise<{
    correct: number;
    wrong: number;
    missing: number;
    planned: PlannedRepairAction[];
}> {
    let correct = 0;
    let wrong = 0;
    let missing = 0;
    const planned: PlannedRepairAction[] = [];

    for (const usage of usages) {
        const directionKey = resolveDirectionKey(usage);
        if (!directionKey) {
            throw new Error(
                `Could not resolve direction for variant ${usage.variant_code} seq ${usage.stop_sequence}.`,
            );
        }

        const externalId = directionAwareStopExternalId(
            routeCode,
            directionKey,
            usage.stop_sequence,
        );
        const link = await findStopSourceLink(client, externalId);

        if (!link) {
            missing++;
            planned.push({
                external_id: externalId,
                route_stop_id: usage.route_stop_id,
                stop_sequence: usage.stop_sequence,
                direction_key: directionKey,
                variant_code: usage.variant_code,
                action: "insert",
                before_entity_id: null,
                after_entity_id: usage.stop_id,
                source_link_id: null,
            });
            continue;
        }

        if (link.entity_id === usage.stop_id) {
            correct++;
            continue;
        }

        wrong++;
        planned.push({
            external_id: externalId,
            route_stop_id: usage.route_stop_id,
            stop_sequence: usage.stop_sequence,
            direction_key: directionKey,
            variant_code: usage.variant_code,
            action: "update",
            before_entity_id: link.entity_id,
            after_entity_id: usage.stop_id,
            source_link_id: link.id,
        });
    }

    return { correct, wrong, missing, planned };
}

export async function repairStopSourceLinkTargets(
    options: CliOptions,
): Promise<StopSourceLinkRepairReport> {
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const client = new pg.Client({ connectionString: databaseUrl });
    const reportsDir = join(REPO_ROOT, options.runRoot, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const reportJsonPath = join(
        reportsDir,
        `repair-stop-source-link-targets-${options.routeCode}.json`,
    );
    const reportMdPath = join(
        reportsDir,
        `repair-stop-source-link-targets-${options.routeCode}.md`,
    );

    const baseReport: StopSourceLinkRepairReport = {
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        status: "failed",
        route_code: options.routeCode,
        route_id: null,
        executed: false,
        total_route_stops: 0,
        correct_source_links_before: 0,
        wrong_entity_id_before: 0,
        missing_source_links_before: 0,
        updated_source_links: 0,
        inserted_source_links: 0,
        correct_source_links_after: 0,
        remaining_wrong_entity_id: 0,
        remaining_missing_source_links: 0,
        planned_actions: [],
        report_json_path: reportJsonPath,
        report_md_path: reportMdPath,
    };

    try {
        await client.connect();

        const { routeId, rows } = await loadRouteStopUsages(client, options.routeCode);
        baseReport.route_id = routeId;
        baseReport.total_route_stops = rows.length;

        if (rows.length === 0) {
            baseReport.status = "refused";
            baseReport.refusal_reason = `Route ${options.routeCode} has no route_stops.`;
            writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
            writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
            return baseReport;
        }

        const before = await assessStopSourceLinks(client, options.routeCode, rows);
        baseReport.correct_source_links_before = before.correct;
        baseReport.wrong_entity_id_before = before.wrong;
        baseReport.missing_source_links_before = before.missing;
        baseReport.planned_actions = before.planned;

        if (options.execute && before.planned.length > 0) {
            await client.query("BEGIN");
            try {
                for (const action of before.planned) {
                    if (action.action === "update" && action.source_link_id) {
                        await client.query(
                            `
                            UPDATE transport.source_links
                            SET entity_id = $2
                            WHERE id = $1
                            `,
                            [action.source_link_id, action.after_entity_id],
                        );
                        baseReport.updated_source_links++;
                    } else {
                        const result = await ensureSourceLink(client, {
                            entityType: "stop",
                            entityId: action.after_entity_id,
                            externalId: action.external_id,
                            importBatchId: null,
                            confidenceScore: 20,
                            isPrimary: true,
                            sourcePayload: {
                                route_code: options.routeCode,
                                direction_key: action.direction_key,
                                sequence: action.stop_sequence,
                                repaired_by: "repair-stop-source-link-targets",
                            },
                        });
                        if (result.status === "inserted" || result.status === "realigned") {
                            baseReport.inserted_source_links++;
                        }
                    }
                }
                await client.query("COMMIT");
                baseReport.executed = true;
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }

        const after = await assessStopSourceLinks(client, options.routeCode, rows);
        baseReport.correct_source_links_after = after.correct;
        baseReport.remaining_wrong_entity_id = after.wrong;
        baseReport.remaining_missing_source_links = after.missing;

        baseReport.status =
            after.wrong === 0 && after.missing === 0 ? "passed" : options.execute ? "failed" : "passed";

        writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
        writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
        return baseReport;
    } catch (error) {
        baseReport.error = error instanceof Error ? error.message : String(error);
        writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
        writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
        return baseReport;
    } finally {
        await client.end();
    }
}

async function main(): Promise<void> {
    loadEnv();
    const options = parseCliArgs(process.argv.slice(2));
    const report = await repairStopSourceLinkTargets(options);

    console.log(`Repair stop source_links ${options.routeCode}: ${report.status} (${report.mode})`);
    if (report.refusal_reason) {
        console.log(`Refusal: ${report.refusal_reason}`);
    }
    if (report.error) {
        console.log(`Error: ${report.error}`);
    }
    console.log(`total route_stops: ${report.total_route_stops}`);
    console.log(
        `before: correct=${report.correct_source_links_before} wrong=${report.wrong_entity_id_before} missing=${report.missing_source_links_before}`,
    );
    console.log(
        `actions: updated=${report.updated_source_links} inserted=${report.inserted_source_links}`,
    );
    console.log(
        `after: correct=${report.correct_source_links_after} wrong=${report.remaining_wrong_entity_id} missing=${report.remaining_missing_source_links}`,
    );
    console.log(`Report: ${report.report_json_path}`);

    if (report.status !== "passed") {
        process.exitCode = 1;
    }
}

const isMainModule =
    process.argv[1] &&
    (process.argv[1].endsWith("repair-stop-source-link-targets.ts") ||
        process.argv[1].endsWith("repair-stop-source-link-targets.js"));

if (isMainModule) {
    void main();
}
