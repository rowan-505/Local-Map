#!/usr/bin/env npx tsx
/**
 * Phase D1 cleanup: soft-delete legacy bus route trees. Stops are never deleted.
 *
 * Default is dry-run. DB writes only with --execute and --confirm-legacy-route-cleanup.
 */

import pg from "pg";

import {
    DEFAULT_REPORT_DIR,
    buildPhaseD1CleanupPlan,
    detectSystematicRouteStopCollision,
    detectTransportColumnSupport,
    executeLegacyRouteTreeSoftCleanup,
    loadEnv,
    loadLegacyRoutes,
    loadSystematicRoutes,
    loadSystematicStopIds,
    resolveReportDir,
    verifyRouteIsLegacy,
    writeJsonReport,
    writeMarkdownReport,
    getDatabaseUrl,
    type CleanupMode,
    type PhaseD1CleanupPlan,
    type TransportColumnSupport,
} from "../lib/legacy-cleanup-shared.js";

type RouteResult = {
    route_code: string;
    route_id: number;
    status: "planned" | "executed" | "skipped_blocked" | "skipped_not_selected";
    blockers: string[];
    warnings: string[];
    planned_actions: PhaseD1CleanupPlan["planned_actions"];
    executed_counts?: {
        route_stops_deleted: number;
        route_paths_soft_deleted: number;
        route_variants_soft_deleted: number;
        routes_soft_deleted: number;
        fares_deactivated: number;
        source_links_deleted: number;
    };
};

type CleanupReport = {
    generated_at: string;
    phase: "D1_cleanup";
    mode: CleanupMode;
    db_writes_executed: boolean;
    db_writes: number;
    stops_deleted: 0;
    column_support: TransportColumnSupport;
    summary: {
        total_legacy_routes_selected: number;
        route_codes_selected: string[];
        routes_planned: number;
        routes_executed: number;
        routes_skipped_blocked: number;
        routes_skipped_not_selected: number;
        route_variants_affected: number;
        route_stops_affected: number;
        route_paths_affected: number;
        source_links_affected_by_entity_type: Record<string, number>;
        fares_affected: number;
        route_names_left: number;
        stops_left_untouched: number;
        legacy_only_stop_candidates_after_route_stops_deletion: number;
        shared_stops_protected_count: number;
        systematic_routes_affected: number;
    };
    legacy_only_stop_candidates_after_route_stops_deletion: number[];
    shared_stops_protected: number[];
    blockers: Array<{ route_code: string; route_id: number; blockers: string[] }>;
    routes: RouteResult[];
    status: "passed" | "refused" | "failed";
    refusal_reason?: string;
    error?: string;
    report_json_path: string;
    report_md_path: string;
};

function parseArgs(argv: string[]): {
    reportDir: string;
    routes: string[];
    limit?: number;
    execute: boolean;
    confirmLegacyRouteCleanup: boolean;
} {
    let reportDir = DEFAULT_REPORT_DIR;
    const routes: string[] = [];
    let limit: number | undefined;
    let execute = false;
    let confirmLegacyRouteCleanup = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report-dir" && argv[i + 1]) {
            reportDir = resolveReportDir(argv[++i]!);
        } else if ((arg === "--routes" || arg === "--route-codes") && argv[i + 1]) {
            routes.push(
                ...argv[++i]!
                    .split(",")
                    .map((code) => code.trim())
                    .filter(Boolean),
            );
        } else if (arg === "--limit" && argv[i + 1]) {
            limit = Number(argv[++i]!);
        } else if (arg === "--execute") {
            execute = true;
        } else if (
            arg === "--confirm-legacy-route-cleanup" ||
            arg === "--confirm-cleanup"
        ) {
            confirmLegacyRouteCleanup = true;
        } else if (arg === "--dry-run") {
            execute = false;
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return { reportDir, routes, limit, execute, confirmLegacyRouteCleanup };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup/cleanup-legacy-bus-routes.ts \\
    --dry-run \\
    --report-dir tmp/transport-imports/legacy-cleanup

  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup/cleanup-legacy-bus-routes.ts \\
    --execute \\
    --confirm-legacy-route-cleanup \\
    --report-dir tmp/transport-imports/legacy-cleanup

Options:
  --routes YBS-10,YBS-11   Optional route_code subset (case-sensitive match)
  --limit 10               Optional max routes after filtering
  --dry-run                Default. No DB writes.
  --execute                Apply cleanup (requires --confirm-legacy-route-cleanup)

Phase D1 soft-deletes legacy route trees. transport.stops are never deleted.
`);
}

function mergeSourceLinkCounts(
    target: Record<string, number>,
    source: Record<string, number>,
): void {
    for (const [entityType, count] of Object.entries(source)) {
        target[entityType] = (target[entityType] ?? 0) + count;
    }
}

function renderMarkdown(report: CleanupReport): string {
    const sourceLinkLines = Object.entries(report.summary.source_links_affected_by_entity_type)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([entityType, count]) => `| ${entityType} | ${count} |`)
        .join("\n");

    const lines = [
        `# Legacy bus route cleanup — Phase D1 (${report.mode})`,
        "",
        `- Generated: ${report.generated_at}`,
        `- Status: **${report.status}**`,
        `- DB writes executed: **${report.db_writes_executed ? "yes" : "no"}**`,
        `- DB writes: ${report.db_writes}`,
        `- Stops deleted: ${report.stops_deleted} (by design)`,
        "",
        "## Summary",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        `| Total legacy routes selected | ${report.summary.total_legacy_routes_selected} |`,
        `| Route variants affected | ${report.summary.route_variants_affected} |`,
        `| Route stops affected (hard delete) | ${report.summary.route_stops_affected} |`,
        `| Route paths affected (soft delete) | ${report.summary.route_paths_affected} |`,
        `| Fares affected (deactivated) | ${report.summary.fares_affected} |`,
        `| Route names left untouched | ${report.summary.route_names_left} |`,
        `| Stops left untouched | ${report.summary.stops_left_untouched} |`,
        `| Legacy-only stop candidates after route_stops deletion | ${report.summary.legacy_only_stop_candidates_after_route_stops_deletion} |`,
        `| Shared stops protected | ${report.summary.shared_stops_protected_count} |`,
        `| Systematic routes affected | ${report.summary.systematic_routes_affected} |`,
        "",
        "## Route codes selected",
        "",
        report.summary.route_codes_selected.map((code) => `- ${code}`).join("\n") || "- (none)",
        "",
        "## Source links affected by entity_type",
        "",
        "| entity_type | count |",
        "| --- | ---: |",
        sourceLinkLines || "| (none) | 0 |",
        "",
        "## Safety",
        "",
        "- Systematic routes affected must be 0 before execute.",
        "- transport.stops, transport.stop_names, and stop source_links are never deleted.",
        "- route_names are left in place when the route is soft-deleted.",
        "",
    ];

    if (report.refusal_reason) lines.push(`Refusal: ${report.refusal_reason}`, "");
    if (report.error) lines.push(`Error: ${report.error}`, "");
    if (report.blockers.length > 0) {
        lines.push("## Blockers", "");
        for (const item of report.blockers) {
            lines.push(`- **${item.route_code}** (id=${item.route_id}): ${item.blockers.join("; ")}`);
        }
        lines.push("");
    }

    return `${lines.join("\n")}\n`;
}

function selectLegacyRoutes(
    legacyRoutes: Awaited<ReturnType<typeof loadLegacyRoutes>>,
    routeFilter: string[],
    limit?: number,
): { selected: typeof legacyRoutes; notFound: string[] } {
    if (routeFilter.length === 0) {
        const selected = limit && limit > 0 ? legacyRoutes.slice(0, limit) : legacyRoutes;
        return { selected, notFound: [] };
    }

    const byCode = new Map(legacyRoutes.map((route) => [route.route_code, route]));
    const selected: typeof legacyRoutes = [];
    const notFound: string[] = [];

    for (const code of routeFilter) {
        const route = byCode.get(code);
        if (route) selected.push(route);
        else notFound.push(code);
    }

    const limited = limit && limit > 0 ? selected.slice(0, limit) : selected;
    return { selected: limited, notFound };
}

export async function cleanupLegacyBusRoutes(options: {
    reportDir: string;
    routes?: string[];
    limit?: number;
    execute?: boolean;
    confirmLegacyRouteCleanup?: boolean;
    databaseUrl?: string;
}): Promise<CleanupReport> {
    const generatedAt = new Date().toISOString();
    const execute = options.execute ?? false;
    const confirmLegacyRouteCleanup = options.confirmLegacyRouteCleanup ?? false;
    const mode: CleanupMode = execute ? "execute" : "dry_run";

    const baseReport: CleanupReport = {
        generated_at: generatedAt,
        phase: "D1_cleanup",
        mode,
        db_writes_executed: false,
        db_writes: 0,
        stops_deleted: 0,
        column_support: {
            route_paths_deleted_at: false,
            route_paths_is_active: false,
            route_variants_deleted_at: false,
            route_variants_is_active: false,
            routes_deleted_at: false,
            routes_is_active: false,
            fares_is_active: false,
            fares_deleted_at: false,
        },
        summary: {
            total_legacy_routes_selected: 0,
            route_codes_selected: [],
            routes_planned: 0,
            routes_executed: 0,
            routes_skipped_blocked: 0,
            routes_skipped_not_selected: 0,
            route_variants_affected: 0,
            route_stops_affected: 0,
            route_paths_affected: 0,
            source_links_affected_by_entity_type: {},
            fares_affected: 0,
            route_names_left: 0,
            stops_left_untouched: 0,
            legacy_only_stop_candidates_after_route_stops_deletion: 0,
            shared_stops_protected_count: 0,
            systematic_routes_affected: 0,
        },
        legacy_only_stop_candidates_after_route_stops_deletion: [],
        shared_stops_protected: [],
        blockers: [],
        routes: [],
        status: "failed",
        report_json_path: "",
        report_md_path: "",
    };

    if (execute && !confirmLegacyRouteCleanup) {
        return finalizeReport(options.reportDir, {
            ...baseReport,
            status: "refused",
            refusal_reason:
                "Execute refused. Pass --confirm-legacy-route-cleanup after reviewing the dry-run report.",
        });
    }

    const client = new pg.Client({
        connectionString: options.databaseUrl ?? getDatabaseUrl(),
    });
    await client.connect();

    try {
        const columnSupport = await detectTransportColumnSupport(client);
        const systematicRoutes = await loadSystematicRoutes(client);
        const systematicStopIds = await loadSystematicStopIds(client);
        const legacyRoutes = await loadLegacyRoutes(client);
        const { selected, notFound } = selectLegacyRoutes(
            legacyRoutes,
            options.routes ?? [],
            options.limit,
        );

        const plans: PhaseD1CleanupPlan[] = [];
        for (const route of selected) {
            plans.push(await buildPhaseD1CleanupPlan(client, route, systematicStopIds));
        }

        const routeResults: RouteResult[] = [];
        const reportBlockers: CleanupReport["blockers"] = [];
        let dbWrites = 0;
        let systematicRoutesAffected = 0;

        for (const missingCode of notFound) {
            routeResults.push({
                route_code: missingCode,
                route_id: 0,
                status: "skipped_not_selected",
                blockers: ["route_code not found among active legacy bus routes"],
                warnings: [],
                planned_actions: {
                    route_stops_deleted: 0,
                    route_paths_soft_deleted: 0,
                    route_variants_soft_deleted: 0,
                    routes_soft_deleted: 0,
                    fares_deactivated: 0,
                    route_names_left: 0,
                    source_links_deleted: 0,
                    stops_left_untouched: 0,
                },
            });
        }

        const eligiblePlans = plans.filter((plan) => plan.eligible);
        for (const plan of plans.filter((plan) => !plan.eligible)) {
            reportBlockers.push({
                route_code: plan.route_code,
                route_id: plan.route_id,
                blockers: plan.blockers,
            });
            routeResults.push({
                route_code: plan.route_code,
                route_id: plan.route_id,
                status: "skipped_blocked",
                blockers: plan.blockers,
                warnings: plan.warnings,
                planned_actions: plan.planned_actions,
            });
        }

        if (execute && eligiblePlans.length > 0) {
            let collisionRouteIds: number[] = [];
            for (const plan of eligiblePlans) {
                const collision = await detectSystematicRouteStopCollision(
                    client,
                    plan.route_id,
                    plan.scope.variant_ids,
                    plan.scope.route_stop_ids,
                );
                if (collision.affected > 0) {
                    collisionRouteIds = [
                        ...collisionRouteIds,
                        ...collision.systematic_route_ids,
                    ];
                }
            }
            systematicRoutesAffected = new Set(collisionRouteIds).size;
            if (systematicRoutesAffected > 0) {
                return finalizeReport(options.reportDir, {
                    ...baseReport,
                    column_support: columnSupport,
                    status: "refused",
                    refusal_reason: `Execute refused. Cleanup would affect ${systematicRoutesAffected} systematic or mismatched route(s): ${[...new Set(collisionRouteIds)].join(", ")}`,
                    blockers: reportBlockers,
                    routes: routeResults,
                    summary: {
                        ...baseReport.summary,
                        systematic_routes_affected: systematicRoutesAffected,
                    },
                });
            }
        }

        if (execute) {
            await client.query("begin");
        }

        for (const plan of eligiblePlans) {
            const reverify = await verifyRouteIsLegacy(client, plan.route_id);
            if (!reverify.is_legacy) {
                const blockers = reverify.blockers;
                reportBlockers.push({
                    route_code: plan.route_code,
                    route_id: plan.route_id,
                    blockers,
                });
                routeResults.push({
                    route_code: plan.route_code,
                    route_id: plan.route_id,
                    status: "skipped_blocked",
                    blockers,
                    warnings: plan.warnings,
                    planned_actions: plan.planned_actions,
                });
                continue;
            }

            if (execute) {
                const executed = await executeLegacyRouteTreeSoftCleanup(
                    client,
                    plan.route_id,
                    plan.scope,
                    columnSupport,
                );
                dbWrites +=
                    executed.source_links_deleted +
                    executed.route_stops_deleted +
                    executed.route_paths_soft_deleted +
                    executed.route_variants_soft_deleted +
                    executed.routes_soft_deleted +
                    executed.fares_deactivated;

                routeResults.push({
                    route_code: plan.route_code,
                    route_id: plan.route_id,
                    status: "executed",
                    blockers: [],
                    warnings: plan.warnings,
                    planned_actions: plan.planned_actions,
                    executed_counts: executed,
                });
            } else {
                routeResults.push({
                    route_code: plan.route_code,
                    route_id: plan.route_id,
                    status: "planned",
                    blockers: [],
                    warnings: plan.warnings,
                    planned_actions: plan.planned_actions,
                });
            }
        }

        if (execute) {
            await client.query("commit");
        }

        const plannedOrExecuted = routeResults.filter(
            (route) => route.status === "planned" || route.status === "executed",
        );

        const sourceLinksByEntityType: Record<string, number> = {};
        const legacyOnlyStopIds = new Set<number>();
        const sharedStopIds = new Set<number>();

        for (const route of plannedOrExecuted) {
            const plan = eligiblePlans.find((item) => item.route_id === route.route_id);
            if (!plan) continue;
            mergeSourceLinkCounts(
                sourceLinksByEntityType,
                plan.scope.source_links_by_entity_type,
            );
            for (const stopId of plan.scope.stop_ids_legacy_only) {
                legacyOnlyStopIds.add(stopId);
            }
            for (const stopId of plan.scope.stop_ids_shared_with_systematic) {
                sharedStopIds.add(stopId);
            }
        }

        const report: CleanupReport = {
            ...baseReport,
            column_support: columnSupport,
            db_writes_executed: execute && dbWrites > 0,
            db_writes: dbWrites,
            status: "passed",
            summary: {
                total_legacy_routes_selected: plannedOrExecuted.length,
                route_codes_selected: plannedOrExecuted.map((route) => route.route_code),
                routes_planned: routeResults.filter((route) => route.status === "planned").length,
                routes_executed: routeResults.filter((route) => route.status === "executed").length,
                routes_skipped_blocked: routeResults.filter((route) => route.status === "skipped_blocked")
                    .length,
                routes_skipped_not_selected: routeResults.filter(
                    (route) => route.status === "skipped_not_selected",
                ).length,
                route_variants_affected: plannedOrExecuted.reduce(
                    (sum, route) => sum + route.planned_actions.route_variants_soft_deleted,
                    0,
                ),
                route_stops_affected: plannedOrExecuted.reduce(
                    (sum, route) => sum + route.planned_actions.route_stops_deleted,
                    0,
                ),
                route_paths_affected: plannedOrExecuted.reduce(
                    (sum, route) => sum + route.planned_actions.route_paths_soft_deleted,
                    0,
                ),
                source_links_affected_by_entity_type: sourceLinksByEntityType,
                fares_affected: plannedOrExecuted.reduce(
                    (sum, route) => sum + route.planned_actions.fares_deactivated,
                    0,
                ),
                route_names_left: plannedOrExecuted.reduce(
                    (sum, route) => sum + route.planned_actions.route_names_left,
                    0,
                ),
                stops_left_untouched: new Set(
                    plannedOrExecuted.flatMap((route) => {
                        const plan = eligiblePlans.find((item) => item.route_id === route.route_id);
                        return plan?.scope.stop_ids ?? [];
                    }),
                ).size,
                legacy_only_stop_candidates_after_route_stops_deletion: legacyOnlyStopIds.size,
                shared_stops_protected_count: sharedStopIds.size,
                systematic_routes_affected: systematicRoutesAffected,
            },
            legacy_only_stop_candidates_after_route_stops_deletion: [...legacyOnlyStopIds].sort(
                (a, b) => a - b,
            ),
            shared_stops_protected: [...sharedStopIds].sort((a, b) => a - b),
            blockers: reportBlockers,
            routes: routeResults,
        };

        if (systematicRoutes.length === 0) {
            report.summary.systematic_routes_affected = 0;
        }

        return finalizeReport(options.reportDir, report);
    } catch (error) {
        if (execute) {
            await client.query("rollback");
        }
        const message = error instanceof Error ? error.message : String(error);
        return finalizeReport(options.reportDir, {
            ...baseReport,
            status: "failed",
            error: message,
        });
    } finally {
        await client.end();
    }
}

function finalizeReport(reportDir: string, report: CleanupReport): CleanupReport {
    const suffix = report.mode === "execute" ? "execute" : "dry-run";
    const jsonPath = writeJsonReport(`${reportDir}/legacy-route-cleanup-${suffix}.json`, report);
    const mdPath = writeMarkdownReport(
        `${reportDir}/legacy-route-cleanup-${suffix}.md`,
        renderMarkdown({ ...report, report_json_path: jsonPath, report_md_path: "" }),
    );
    const finalReport = { ...report, report_json_path: jsonPath, report_md_path: mdPath };
    writeJsonReport(jsonPath, finalReport);
    return finalReport;
}

async function main(): Promise<void> {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const report = await cleanupLegacyBusRoutes({
        reportDir: args.reportDir,
        routes: args.routes,
        limit: args.limit,
        execute: args.execute,
        confirmLegacyRouteCleanup: args.confirmLegacyRouteCleanup,
    });

    console.log(`Phase D1 legacy route cleanup: ${report.status} (${report.mode})`);
    console.log(`DB writes executed: ${report.db_writes_executed ? "yes" : "no"}`);
    console.log(`DB writes: ${report.db_writes}`);
    console.log(`Legacy routes selected: ${report.summary.total_legacy_routes_selected}`);
    console.log(`Route stops affected: ${report.summary.route_stops_affected}`);
    console.log(`Stops left untouched: ${report.summary.stops_left_untouched}`);
    console.log(`Systematic routes affected: ${report.summary.systematic_routes_affected}`);
    if (report.refusal_reason) console.log(`Refusal: ${report.refusal_reason}`);
    if (report.error) console.error(`Error: ${report.error}`);
    console.log(`Report: ${report.report_json_path}`);

    if (report.status === "refused" || report.status === "failed") process.exit(1);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("cleanup-legacy-bus-routes.ts") ||
        process.argv[1].endsWith("cleanup-legacy-bus-routes.js"));

if (isMain) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
