#!/usr/bin/env npx tsx
/**
 * Repair imported route display names (dry-run by default).
 *
 * Usage:
 *   npx tsx .../repair-imported-route-names.ts --dry-run --report-dir tmp/transport-imports/route-name-repair
 *   npx tsx .../repair-imported-route-names.ts --execute --confirm-route-name-repair --report-dir tmp/transport-imports/route-name-repair
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import { writeJsonFile, writeTextFile } from "../lib/test-flow-report.js";
import {
    assessRouteNameQuality,
    fetchRouteNameRows,
    loadMergedRouteJson,
    resolveDatabaseUrl,
    type RouteNameQualityRow,
} from "../lib/route-name-repair-lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");

type RouteNameRow = {
    id: number;
    language_code: string;
    name_type: string;
    is_primary: boolean;
    name: string;
};

type PlannedRouteNameChange = {
    route_code: string;
    route_id: number;
    language_code: string;
    name_type: string;
    is_primary: boolean;
    before: string | null;
    after: string;
    action: "insert" | "update";
    route_name_id: number | null;
};

type RepairExecutionReport = {
    generated_at: string;
    mode: "dry_run" | "execute";
    executed: boolean;
    options: {
        routes?: string[];
        include_trial: boolean;
        allow_reviewed: boolean;
        repair_only_high_confidence: boolean;
    };
    summary: {
        scanned: number;
        with_issues: number;
        planned_repairs: number;
        skipped: number;
        executed_repairs: number;
        refused_execute: boolean;
        refusal_reason?: string;
    };
    repairs: Array<{
        row: RouteNameQualityRow;
        route_changes: {
            public_name: { before: string | null; after: string | null };
            origin_name: { before: string | null; after: string | null };
            destination_name: { before: string | null; after: string | null };
        };
        route_name_changes: PlannedRouteNameChange[];
        skipped_reason?: string;
    }>;
};

type CliOptions = {
    dryRun: boolean;
    execute: boolean;
    confirmRouteNameRepair: boolean;
    reportDir: string;
    routes?: string[];
    includeTrial: boolean;
    allowReviewed: boolean;
    mergedSourceDir: string;
    databaseUrl?: string;
};

function loadEnv(): void {
    for (const envPath of [
        join(REPO_ROOT, "apps/api/.env"),
        join(REPO_ROOT, "infrastructure/.env"),
        join(REPO_ROOT, ".env"),
    ]) {
        if (existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function parseCliArgs(argv: string[]): CliOptions {
    let dryRun = true;
    let execute = false;
    let confirmRouteNameRepair = false;
    let reportDir = "tmp/transport-imports/route-name-repair";
    let routes: string[] | undefined;
    let includeTrial = false;
    let allowReviewed = false;
    let mergedSourceDir = "tmp/transport-imports/ybs-all/merged/routes";
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === "--dry-run") {
            dryRun = true;
            execute = false;
        } else if (arg === "--execute") {
            execute = true;
            dryRun = false;
        } else if (arg === "--confirm-route-name-repair") {
            confirmRouteNameRepair = true;
        } else if (arg === "--report-dir" && next) {
            reportDir = next.trim();
            index++;
        } else if (arg === "--routes" && next) {
            routes = next
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            index++;
        } else if (arg === "--include-trial") {
            includeTrial = true;
        } else if (arg === "--allow-reviewed") {
            allowReviewed = true;
        } else if (arg === "--merged-source-dir" && next) {
            mergedSourceDir = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        }
    }

    return {
        dryRun,
        execute,
        confirmRouteNameRepair,
        reportDir,
        routes,
        includeTrial,
        allowReviewed,
        mergedSourceDir,
        databaseUrl,
    };
}

function planRouteNameChanges(
    routeCode: string,
    routeId: number,
    existing: RouteNameRow[],
    row: RouteNameQualityRow,
): PlannedRouteNameChange[] {
    const targets = [
        {
            language_code: "my",
            name_type: "primary",
            is_primary: true,
            after: row.proposed_primary_name_my,
        },
        {
            language_code: "en",
            name_type: "primary",
            is_primary: true,
            after: row.proposed_primary_name_en,
        },
        {
            language_code: "und",
            name_type: "alias",
            is_primary: false,
            after: routeCode,
        },
    ] as const;

    const planned: PlannedRouteNameChange[] = [];
    for (const target of targets) {
        if (!target.after) {
            continue;
        }

        const current =
            existing.find(
                (nameRow) =>
                    nameRow.language_code === target.language_code &&
                    nameRow.is_primary === target.is_primary,
            ) ??
            existing.find((nameRow) => nameRow.language_code === target.language_code) ??
            null;

        if (current && current.name === target.after && current.name_type === target.name_type) {
            continue;
        }

        planned.push({
            route_code: routeCode,
            route_id: routeId,
            language_code: target.language_code,
            name_type: target.name_type,
            is_primary: target.is_primary,
            before: current?.name ?? null,
            after: target.after,
            action: current ? "update" : "insert",
            route_name_id: current?.id ?? null,
        });
    }

    return planned;
}

function renderRepairMarkdown(report: RepairExecutionReport): string {
    const lines = [
        "# Repair imported route names",
        "",
        `- Generated at: ${report.generated_at}`,
        `- Mode: ${report.mode}`,
        `- Executed: ${report.executed}`,
        `- Scanned: ${report.summary.scanned}`,
        `- With issues: ${report.summary.with_issues}`,
        `- Planned repairs: ${report.summary.planned_repairs}`,
        `- Skipped: ${report.summary.skipped}`,
        `- Executed repairs: ${report.summary.executed_repairs}`,
        "",
    ];

    if (report.summary.refusal_reason) {
        lines.push(`Refusal: ${report.summary.refusal_reason}`, "");
    }

    for (const repair of report.repairs) {
        lines.push(`## ${repair.row.route_code}`, "");
        if (repair.skipped_reason) {
            lines.push(`Skipped: ${repair.skipped_reason}`, "");
            continue;
        }
        lines.push(
            `- confidence: ${repair.row.confidence}`,
            `- issues: ${repair.row.issue_codes.join(", ") || "—"}`,
            `- public_name: ${repair.route_changes.public_name.before ?? "—"} → ${repair.route_changes.public_name.after ?? "—"}`,
            `- origin_name: ${repair.route_changes.origin_name.before ?? "—"} → ${repair.route_changes.origin_name.after ?? "—"}`,
            `- destination_name: ${repair.route_changes.destination_name.before ?? "—"} → ${repair.route_changes.destination_name.after ?? "—"}`,
            "",
        );
        for (const change of repair.route_name_changes) {
            lines.push(
                `- ${change.action} ${change.language_code}/${change.name_type}: "${change.before ?? "—"}" → "${change.after}"`,
            );
        }
        lines.push("");
    }

    return lines.join("\n");
}

async function main(): Promise<void> {
    loadEnv();
    const options = parseCliArgs(process.argv.slice(2));
    const reportRoot = join(REPO_ROOT, options.reportDir);
    mkdirSync(reportRoot, { recursive: true });

    const client = new pg.Client({ connectionString: resolveDatabaseUrl(options.databaseUrl) });
    await client.connect();

    const repairs: RepairExecutionReport["repairs"] = [];
    let executedRepairs = 0;

    try {
        const routes = await fetchRouteNameRows(client, {
            routeCodes: options.routes,
            includeTrial: options.includeTrial,
        });

        for (const route of routes) {
            const routeNames = await client.query<RouteNameRow>(
                `
                SELECT id::int, language_code, name_type, is_primary, name
                FROM transport.route_names
                WHERE route_id = $1
                ORDER BY language_code, is_primary DESC, id
                `,
                [route.id],
            );

            const mergedSource = loadMergedRouteJson(REPO_ROOT, route.route_code, options.mergedSourceDir);
            const assessed = assessRouteNameQuality({
                route,
                routeNames: routeNames.rows,
                mergedSource,
                allowReviewed: options.allowReviewed,
                repairOnlyHighConfidence: true,
            });

            if (!assessed.safe_to_execute) {
                repairs.push({
                    row: assessed,
                    route_changes: {
                        public_name: { before: assessed.public_name, after: assessed.proposed_public_name },
                        origin_name: { before: assessed.origin_name, after: assessed.proposed_origin_name },
                        destination_name: {
                            before: assessed.destination_name,
                            after: assessed.proposed_destination_name,
                        },
                    },
                    route_name_changes: [],
                    skipped_reason: assessed.repair_blocked_reason ?? "not safe to execute",
                });
                continue;
            }

            const routeNameChanges = planRouteNameChanges(
                route.route_code,
                route.id,
                routeNames.rows,
                assessed,
            );

            repairs.push({
                row: assessed,
                route_changes: {
                    public_name: { before: assessed.public_name, after: assessed.proposed_public_name },
                    origin_name: { before: assessed.origin_name, after: assessed.proposed_origin_name },
                    destination_name: {
                        before: assessed.destination_name,
                        after: assessed.proposed_destination_name,
                    },
                },
                route_name_changes: routeNameChanges,
            });
        }

        const planned = repairs.filter((repair) => !repair.skipped_reason);
        const report: RepairExecutionReport = {
            generated_at: new Date().toISOString(),
            mode: options.execute ? "execute" : "dry_run",
            executed: false,
            options: {
                routes: options.routes,
                include_trial: options.includeTrial,
                allow_reviewed: options.allowReviewed,
                repair_only_high_confidence: true,
            },
            summary: {
                scanned: repairs.length,
                with_issues: repairs.filter((repair) => repair.row.issue_codes.length > 0).length,
                planned_repairs: planned.length,
                skipped: repairs.length - planned.length,
                executed_repairs: 0,
                refused_execute: false,
            },
            repairs,
        };

        if (options.execute) {
            if (!options.confirmRouteNameRepair) {
                report.summary.refused_execute = true;
                report.summary.refusal_reason =
                    "Missing --confirm-route-name-repair. No database writes were performed.";
            } else if (planned.length === 0) {
                report.summary.refusal_reason = "No safe high-confidence repairs to execute.";
            } else {
                await client.query("BEGIN");
                try {
                    for (const repair of planned) {
                        const row = repair.row;
                        await client.query(
                            `
                            UPDATE transport.routes
                            SET public_name = $2,
                                origin_name = $3,
                                destination_name = $4,
                                updated_at = now()
                            WHERE id = $1
                            `,
                            [
                                row.route_id,
                                row.proposed_public_name,
                                row.proposed_origin_name,
                                row.proposed_destination_name,
                            ],
                        );

                        for (const change of repair.route_name_changes) {
                            if (change.action === "update" && change.route_name_id) {
                                await client.query(
                                    `
                                    UPDATE transport.route_names
                                    SET name = $2,
                                        name_type = $3,
                                        is_primary = $4,
                                        updated_at = now()
                                    WHERE id = $1
                                    `,
                                    [
                                        change.route_name_id,
                                        change.after,
                                        change.name_type,
                                        change.is_primary,
                                    ],
                                );
                            } else {
                                await client.query(
                                    `
                                    INSERT INTO transport.route_names (
                                        route_id,
                                        language_code,
                                        name_type,
                                        is_primary,
                                        name,
                                        created_at,
                                        updated_at
                                    )
                                    VALUES ($1, $2, $3, $4, $5, now(), now())
                                    `,
                                    [
                                        change.route_id,
                                        change.language_code,
                                        change.name_type,
                                        change.is_primary,
                                        change.after,
                                    ],
                                );
                            }
                        }

                        executedRepairs++;
                    }
                    await client.query("COMMIT");
                    report.executed = true;
                    report.summary.executed_repairs = executedRepairs;
                } catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const jsonPath = join(reportRoot, `repair-route-names-${timestamp}.json`);
        const mdPath = join(reportRoot, `repair-route-names-${timestamp}.md`);
        writeJsonFile(jsonPath, report);
        writeTextFile(mdPath, renderRepairMarkdown(report));

        console.log(`Wrote ${jsonPath}`);
        console.log(`Wrote ${mdPath}`);
        console.log(
            `Mode=${report.mode}; planned=${report.summary.planned_repairs}; executed=${report.summary.executed_repairs}; skipped=${report.summary.skipped}`,
        );
        if (report.summary.refusal_reason) {
            console.log(`Note: ${report.summary.refusal_reason}`);
        }
    } finally {
        await client.end();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
