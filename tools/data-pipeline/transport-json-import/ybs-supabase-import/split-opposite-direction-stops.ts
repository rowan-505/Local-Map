#!/usr/bin/env npx tsx
/**
 * Split transport.stops rows reused by both inbound and outbound on the same YBS route.
 *
 * Dry-run by default. Use --execute to apply changes.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import {
    directionAwareStopExternalId,
    isProtectedReviewStatus,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
} from "./supabase-schema-map.js";
import { isExplicitSharedTerminal } from "../ybs-db-prepare/stop-normalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");
const DEFAULT_RUN_ROOT = "tmp/transport-imports/ybs-flow-test-ybs1-ybs2";
const MANUAL_REVIEW_CONFIDENCE_SCORE = 5;

type RepairMode = "dry_run" | "execute";

type CliOptions = {
    routeCode: string;
    execute: boolean;
    runRoot: string;
    databaseUrl?: string;
};

type RouteRow = {
    id: number;
    route_code: string;
    review_status: string | null;
};

type VariantRow = {
    id: number;
    variant_code: string;
    direction_key: "inbound" | "outbound";
};

type SharedStopUsage = {
    stop_id: number;
    stop_name: string | null;
    stop_name_mm: string | null;
    stop_name_en: string | null;
    review_status: string;
    mode: string;
    stop_type: string;
    source_refs: Record<string, unknown> | null;
    normalized_data: Record<string, unknown> | null;
    inbound_route_stop_id: number;
    inbound_sequence: number;
    outbound_route_stop_id: number;
    outbound_sequence: number;
    allowed_shared_terminal: boolean;
    skip_reason: string | null;
};

type PlannedSplit = {
    shared_stop_id: number;
    stop_name: string | null;
    inbound_sequence: number;
    outbound_sequence: number;
    allowed_shared_terminal: boolean;
    keep_direction: "inbound";
    clone_direction: "outbound";
    outbound_route_stop_id: number;
    skip_reason: string | null;
    new_stop_id: number | null;
    new_external_id: string;
};

type SplitReport = {
    generated_at: string;
    mode: RepairMode;
    status: "passed" | "refused" | "failed";
    refusal_reason?: string;
    error?: string;
    route_code: string;
    route_id: number | null;
    shared_stop_usages_found: number;
    splits_planned: number;
    splits_executed: number;
    splits_skipped: number;
    direction_split_stop_count: number;
    opposite_direction_reuse_prevented_count: number;
    possible_shared_terminal_count: number;
    still_shared_stop_count: number;
    executed: boolean;
    shared_usages: SharedStopUsage[];
    planned_splits: PlannedSplit[];
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

function getDatabaseUrl(explicit?: string): string {
    const url =
        explicit ??
        process.env.SUPABASE_DB_URL ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.DIRECT_URL;
    if (!url) {
        throw new Error("Database URL not found. Set DATABASE_URL in apps/api/.env.");
    }
    return url;
}

function parseArgs(argv: string[]): CliOptions {
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
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--execute") {
            execute = true;
        }
    }

    if (!routeCode) {
        throw new Error("--route-code is required.");
    }

    return { routeCode, execute, runRoot, databaseUrl };
}

function variantDirectionKey(variantCode: string): "inbound" | "outbound" | null {
    const code = variantCode.trim().toUpperCase();
    if (code.endsWith("-INBOUND")) {
        return "inbound";
    }
    if (code.endsWith("-OUTBOUND")) {
        return "outbound";
    }
    return null;
}

function buildMarkdown(report: SplitReport): string {
    const lines = [
        `# Split opposite-direction stops — ${report.route_code}`,
        "",
        `- Status: **${report.status}**`,
        `- Mode: ${report.mode}`,
        `- Executed: ${report.executed ? "yes" : "no"}`,
        report.refusal_reason ? `- Refusal: ${report.refusal_reason}` : "",
        report.error ? `- Error: ${report.error}` : "",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        `| route_id | ${report.route_id ?? "null"} |`,
        `| shared_stop_usages_found | ${report.shared_stop_usages_found} |`,
        `| splits_planned | ${report.splits_planned} |`,
        `| splits_executed | ${report.splits_executed} |`,
        `| splits_skipped | ${report.splits_skipped} |`,
        `| direction_split_stop_count | ${report.direction_split_stop_count} |`,
        `| opposite_direction_reuse_prevented_count | ${report.opposite_direction_reuse_prevented_count} |`,
        `| possible_shared_terminal_count | ${report.possible_shared_terminal_count} |`,
        `| still_shared_stop_count | ${report.still_shared_stop_count} |`,
        "",
        "## Shared stop usages",
        "",
    ];

    if (report.shared_usages.length === 0) {
        lines.push("None.");
    } else {
        lines.push(
            "| stop_id | name | inbound_seq | outbound_seq | allowed_shared_terminal | skip_reason |",
        );
        lines.push("| ---: | --- | ---: | ---: | --- | --- |");
        for (const row of report.shared_usages) {
            lines.push(
                `| ${row.stop_id} | ${row.stop_name ?? ""} | ${row.inbound_sequence} | ${row.outbound_sequence} | ${row.allowed_shared_terminal} | ${row.skip_reason ?? ""} |`,
            );
        }
    }

    lines.push("", "## Planned splits", "");
    if (report.planned_splits.length === 0) {
        lines.push("None.");
    } else {
        lines.push(
            "| shared_stop_id | inbound_seq | outbound_seq | new_external_id | new_stop_id | skip_reason |",
        );
        lines.push("| ---: | ---: | ---: | --- | ---: | --- |");
        for (const row of report.planned_splits) {
            lines.push(
                `| ${row.shared_stop_id} | ${row.inbound_sequence} | ${row.outbound_sequence} | ${row.new_external_id} | ${row.new_stop_id ?? ""} | ${row.skip_reason ?? ""} |`,
            );
        }
    }

    return lines.filter((line) => line !== "").join("\n");
}

function writeReport(report: SplitReport, runRoot: string): SplitReport {
    const reportsDir = join(REPO_ROOT, runRoot, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const baseName = `split-opposite-direction-stops-${report.route_code}`;
    const reportJsonPath = join(reportsDir, `${baseName}.json`);
    const reportMdPath = join(reportsDir, `${baseName}.md`);
    const finalReport = {
        ...report,
        report_json_path: reportJsonPath,
        report_md_path: reportMdPath,
    };
    writeFileSync(reportJsonPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    writeFileSync(reportMdPath, `${buildMarkdown(finalReport)}\n`, "utf8");
    return finalReport;
}

async function loadRoute(client: pg.Client, routeCode: string): Promise<RouteRow | null> {
    const result = await client.query<RouteRow>(
        `
        select id::int, route_code, review_status
        from transport.routes
        where route_code = $1 and deleted_at is null
        limit 1
        `,
        [routeCode],
    );
    return result.rows[0] ?? null;
}

async function loadVariants(client: pg.Client, routeId: number): Promise<VariantRow[]> {
    const result = await client.query<{ id: number; variant_code: string }>(
        `
        select id::int, variant_code
        from transport.route_variants
        where route_id = $1 and deleted_at is null
        order by variant_code
        `,
        [routeId],
    );

    return result.rows
        .map((row) => {
            const direction = variantDirectionKey(row.variant_code);
            if (!direction) {
                return null;
            }
            return {
                id: row.id,
                variant_code: row.variant_code,
                direction_key: direction,
            };
        })
        .filter((row): row is VariantRow => Boolean(row));
}

async function loadSharedStopUsages(
    client: pg.Client,
    inboundVariantId: number,
    outboundVariantId: number,
): Promise<SharedStopUsage[]> {
    const result = await client.query<SharedStopUsage>(
        `
        with inbound as (
            select rs.id::int as route_stop_id, rs.stop_id::int, rs.stop_sequence::int
            from transport.route_stops rs
            where rs.route_variant_id = $1
        ),
        outbound as (
            select rs.id::int as route_stop_id, rs.stop_id::int, rs.stop_sequence::int
            from transport.route_stops rs
            where rs.route_variant_id = $2
        )
        select
            s.id::int as stop_id,
            s.name as stop_name,
            s.name_mm as stop_name_mm,
            s.name_en as stop_name_en,
            s.review_status,
            s.mode,
            s.stop_type,
            s.source_refs,
            s.normalized_data,
            i.route_stop_id as inbound_route_stop_id,
            i.stop_sequence as inbound_sequence,
            o.route_stop_id as outbound_route_stop_id,
            o.stop_sequence as outbound_sequence,
            (coalesce(s.normalized_data->>'shared_terminal', 'false') = 'true') as allowed_shared_terminal,
            null::text as skip_reason
        from inbound i
        join outbound o on o.stop_id = i.stop_id
        join transport.stops s on s.id = i.stop_id
        where s.deleted_at is null
        order by i.stop_sequence asc, o.stop_sequence asc
        `,
        [inboundVariantId, outboundVariantId],
    );

    return result.rows.map((row) => ({
        ...row,
        allowed_shared_terminal:
            row.allowed_shared_terminal || isExplicitSharedTerminal(row.normalized_data),
        skip_reason: isProtectedReviewStatus(row.review_status)
            ? `Protected stop review_status=${row.review_status}`
            : row.allowed_shared_terminal ||
                isExplicitSharedTerminal(row.normalized_data)
              ? "Explicit shared_terminal"
              : null,
    }));
}

async function cloneStopForOutbound(input: {
    client: pg.Client;
    usage: SharedStopUsage;
    routeCode: string;
    outboundSequence: number;
}): Promise<number> {
    const { client, usage, routeCode, outboundSequence } = input;
    const normalizedData = {
        ...(usage.normalized_data ?? {}),
        direction_split: true,
        original_shared_stop_id: usage.stop_id,
        direction_key: "outbound",
        duplicate_review_required: true,
        possible_shared_terminal: true,
        ybs_go: {
            ...(typeof usage.normalized_data?.ybs_go === "object"
                ? (usage.normalized_data.ybs_go as Record<string, unknown>)
                : {}),
            route_code: routeCode,
            direction_key: "outbound",
            sequence: outboundSequence,
        },
    };

    const inserted = await client.query<{ id: number }>(
        `
        insert into transport.stops (
            name, name_mm, name_en, mode, stop_type, geom,
            review_status, source_refs, normalized_data, confidence_score, is_active
        )
        select
            s.name,
            s.name_mm,
            s.name_en,
            s.mode,
            s.stop_type,
            s.geom,
            'needs_review',
            s.source_refs,
            $2::jsonb,
            $3,
            true
        from transport.stops s
        where s.id = $1
        returning id::int
        `,
        [usage.stop_id, JSON.stringify(normalizedData), MANUAL_REVIEW_CONFIDENCE_SCORE],
    );
    const newStopId = inserted.rows[0]?.id;
    if (!newStopId) {
        throw new Error(`Failed to clone stop from stop_id=${usage.stop_id}`);
    }

    await client.query(
        `
        insert into transport.stop_names (stop_id, name, language_code, script_code, name_type, is_primary, search_weight)
        select $2, sn.name, sn.language_code, sn.script_code, sn.name_type, sn.is_primary, sn.search_weight
        from transport.stop_names sn
        where sn.stop_id = $1
          and not exists (
              select 1
              from transport.stop_names existing
              where existing.stop_id = $2
                and existing.name = sn.name
                and existing.language_code = sn.language_code
          )
        `,
        [usage.stop_id, newStopId],
    );

    const externalId = directionAwareStopExternalId(routeCode, "outbound", outboundSequence);
    await client.query(
        `
        insert into transport.source_links (
            entity_type, entity_id, source_name, source_kind, external_id, source_payload
        )
        select 'stop', $1, $2, $3, $4, $5::jsonb
        where not exists (
            select 1
            from transport.source_links sl
            where sl.entity_type = 'stop'
              and sl.source_name = $2
              and sl.source_kind = $3
              and sl.external_id = $4
        )
        `,
        [
            newStopId,
            YBS_SOURCE_NAME,
            YBS_SOURCE_KIND,
            externalId,
            JSON.stringify({
                route_code: routeCode,
                direction_key: "outbound",
                sequence: outboundSequence,
                direction_split: true,
                original_shared_stop_id: usage.stop_id,
            }),
        ],
    );

    await client.query(
        `
        update transport.route_stops
        set stop_id = $2,
            updated_at = now()
        where id = $1
        `,
        [usage.outbound_route_stop_id, newStopId],
    );

    return newStopId;
}

export async function splitOppositeDirectionStops(options: CliOptions): Promise<SplitReport> {
    const baseReport: SplitReport = {
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        status: "passed",
        route_code: options.routeCode,
        route_id: null,
        shared_stop_usages_found: 0,
        splits_planned: 0,
        splits_executed: 0,
        splits_skipped: 0,
        direction_split_stop_count: 0,
        opposite_direction_reuse_prevented_count: 0,
        possible_shared_terminal_count: 0,
        still_shared_stop_count: 0,
        executed: false,
        shared_usages: [],
        planned_splits: [],
        report_json_path: "",
        report_md_path: "",
    };

    const client = new pg.Client({ connectionString: getDatabaseUrl(options.databaseUrl) });
    await client.connect();

    try {
        const route = await loadRoute(client, options.routeCode);
        if (!route) {
            return writeReport(
                {
                    ...baseReport,
                    status: "refused",
                    refusal_reason: `Route not found: ${options.routeCode}`,
                },
                options.runRoot,
            );
        }

        baseReport.route_id = route.id;

        if (isProtectedReviewStatus(route.review_status)) {
            return writeReport(
                {
                    ...baseReport,
                    status: "refused",
                    refusal_reason: `Route review_status=${route.review_status} is protected`,
                },
                options.runRoot,
            );
        }

        const variants = await loadVariants(client, route.id);
        const inbound = variants.find((variant) => variant.direction_key === "inbound");
        const outbound = variants.find((variant) => variant.direction_key === "outbound");
        if (!inbound || !outbound) {
            return writeReport(
                {
                    ...baseReport,
                    status: "refused",
                    refusal_reason: "Route is missing inbound or outbound variant.",
                },
                options.runRoot,
            );
        }

        const sharedUsages = await loadSharedStopUsages(client, inbound.id, outbound.id);
        baseReport.shared_usages = sharedUsages;
        baseReport.shared_stop_usages_found = sharedUsages.length;

        const plannedSplits: PlannedSplit[] = [];
        let stillShared = 0;
        let possibleSharedTerminal = 0;

        for (const usage of sharedUsages) {
            if (usage.allowed_shared_terminal) {
                stillShared++;
                plannedSplits.push({
                    shared_stop_id: usage.stop_id,
                    stop_name: usage.stop_name,
                    inbound_sequence: usage.inbound_sequence,
                    outbound_sequence: usage.outbound_sequence,
                    allowed_shared_terminal: true,
                    keep_direction: "inbound",
                    clone_direction: "outbound",
                    outbound_route_stop_id: usage.outbound_route_stop_id,
                    skip_reason: usage.skip_reason ?? "Explicit shared_terminal",
                    new_stop_id: null,
                    new_external_id: directionAwareStopExternalId(
                        options.routeCode,
                        "outbound",
                        usage.outbound_sequence,
                    ),
                });
                continue;
            }

            if (usage.skip_reason) {
                baseReport.splits_skipped++;
                possibleSharedTerminal++;
                plannedSplits.push({
                    shared_stop_id: usage.stop_id,
                    stop_name: usage.stop_name,
                    inbound_sequence: usage.inbound_sequence,
                    outbound_sequence: usage.outbound_sequence,
                    allowed_shared_terminal: false,
                    keep_direction: "inbound",
                    clone_direction: "outbound",
                    outbound_route_stop_id: usage.outbound_route_stop_id,
                    skip_reason: usage.skip_reason,
                    new_stop_id: null,
                    new_external_id: directionAwareStopExternalId(
                        options.routeCode,
                        "outbound",
                        usage.outbound_sequence,
                    ),
                });
                continue;
            }

            possibleSharedTerminal++;
            plannedSplits.push({
                shared_stop_id: usage.stop_id,
                stop_name: usage.stop_name,
                inbound_sequence: usage.inbound_sequence,
                outbound_sequence: usage.outbound_sequence,
                allowed_shared_terminal: false,
                keep_direction: "inbound",
                clone_direction: "outbound",
                outbound_route_stop_id: usage.outbound_route_stop_id,
                skip_reason: null,
                new_stop_id: null,
                new_external_id: directionAwareStopExternalId(
                    options.routeCode,
                    "outbound",
                    usage.outbound_sequence,
                ),
            });
        }

        const executableSplits = plannedSplits.filter((row) => !row.skip_reason);
        baseReport.planned_splits = plannedSplits;
        baseReport.splits_planned = executableSplits.length;
        baseReport.possible_shared_terminal_count = possibleSharedTerminal;
        baseReport.still_shared_stop_count = stillShared;

        if (options.execute && executableSplits.length > 0) {
            await client.query("BEGIN");
            try {
                for (const plan of executableSplits) {
                    const usage = sharedUsages.find((row) => row.stop_id === plan.shared_stop_id);
                    if (!usage) {
                        continue;
                    }
                    plan.new_stop_id = await cloneStopForOutbound({
                        client,
                        usage,
                        routeCode: options.routeCode,
                        outboundSequence: plan.outbound_sequence,
                    });
                    baseReport.splits_executed++;
                }
                await client.query("COMMIT");
                baseReport.executed = true;
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }

        baseReport.direction_split_stop_count = baseReport.splits_executed;
        baseReport.opposite_direction_reuse_prevented_count = baseReport.splits_executed;

        if (baseReport.still_shared_stop_count > 0) {
            const illegalShared = sharedUsages.filter(
                (row) => !row.allowed_shared_terminal && !row.skip_reason,
            );
            if (illegalShared.length > 0 && !options.execute) {
                baseReport.status = "passed";
            }
        }

        const remainingShared = await loadSharedStopUsages(client, inbound.id, outbound.id);
        const illegalRemaining = remainingShared.filter(
            (row) => !row.allowed_shared_terminal && !row.skip_reason,
        );
        baseReport.still_shared_stop_count = remainingShared.filter(
            (row) => row.allowed_shared_terminal,
        ).length;
        if (illegalRemaining.length > 0) {
            baseReport.status = "failed";
            baseReport.error = `${illegalRemaining.length} stop_id(s) still shared by inbound and outbound without shared_terminal.`;
        }

        return writeReport(baseReport, options.runRoot);
    } catch (error) {
        return writeReport(
            {
                ...baseReport,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
            },
            options.runRoot,
        );
    } finally {
        await client.end();
    }
}

async function main(): Promise<void> {
    loadEnv();
    const options = parseArgs(process.argv.slice(2));
    const report = await splitOppositeDirectionStops(options);
    console.log(`Split opposite-direction stops — ${report.route_code}`);
    console.log(`Status: ${report.status}`);
    console.log(`Mode: ${report.mode}`);
    console.log(`Shared usages found: ${report.shared_stop_usages_found}`);
    console.log(`Splits planned: ${report.splits_planned}`);
    console.log(`Splits executed: ${report.splits_executed}`);
    console.log(`Still shared (allowed): ${report.still_shared_stop_count}`);
    console.log(`Report: ${report.report_md_path}`);
    if (report.status === "failed") {
        process.exitCode = 1;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
