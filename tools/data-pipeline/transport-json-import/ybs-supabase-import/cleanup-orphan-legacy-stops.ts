#!/usr/bin/env npx tsx
/**
 * Phase D2 cleanup: soft-delete safe orphan legacy bus stops after Phase D1 validation.
 *
 * Default is dry-run. DB writes only with --execute and --confirm-orphan-stop-cleanup.
 */

import pg from "pg";

import {
    DEFAULT_REPORT_DIR,
    aggregateBlockReasons,
    classifyOrphanBusStop,
    executeOrphanStopCleanup,
    loadEnv,
    loadOrphanBusStops,
    reverifyOrphanStopsBeforeExecute,
    resolveOrphanCleanupCutoff,
    resolveReportDir,
    writeJsonReport,
    writeMarkdownReport,
    getDatabaseUrl,
    type CleanupMode,
    type OrphanBusStopRow,
} from "./legacy-cleanup-shared.js";

type StopCleanupResult = {
    stop_id: number;
    public_id: string | null;
    name: string | null;
    review_status: string | null;
    status: "planned" | "executed" | "skipped_blocked" | "skipped_not_selected";
    cleanup_mode: "soft_delete" | "hard_delete";
    block_reasons: string[];
    reason: string;
};

type CleanupReport = {
    generated_at: string;
    phase: "D2_cleanup";
    mode: CleanupMode;
    db_writes_executed: boolean;
    db_writes: number;
    cleanup_cutoff: string;
    options: {
        hard_delete: boolean;
        delete_stop_source_links: boolean;
        allow_delete_ybs_source_stops: boolean;
        limit: number | null;
        stop_ids_filter: number[];
    };
    status: "passed" | "refused" | "failed";
    refusal_reason?: string;
    error?: string;
    summary: {
        stops_selected: number;
        stops_planned: number;
        stops_executed: number;
        stops_skipped_blocked: number;
        stops_skipped_not_selected: number;
        blocked_by_reason: Record<string, number>;
        source_links_preserved: number;
        stop_names_preserved: number;
        source_links_deleted: number;
        stop_names_deleted: number;
        stops_soft_deleted: number;
        stops_hard_deleted: number;
    };
    stop_ids_selected: number[];
    public_ids_selected: string[];
    stops: StopCleanupResult[];
    report_json_path: string;
    report_md_path: string;
};

function parseArgs(argv: string[]): {
    reportDir: string;
    stopIds: number[];
    limit?: number;
    execute: boolean;
    confirmOrphanStopCleanup: boolean;
    hardDelete: boolean;
    deleteStopSourceLinks: boolean;
    allowDeleteYbsSourceStops: boolean;
    cutoff?: string;
    recentHours: number;
} {
    let reportDir = DEFAULT_REPORT_DIR;
    const stopIds: number[] = [];
    let limit: number | undefined;
    let execute = false;
    let confirmOrphanStopCleanup = false;
    let hardDelete = false;
    let deleteStopSourceLinks = false;
    let allowDeleteYbsSourceStops = false;
    let cutoff: string | undefined;
    let recentHours = 24;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report-dir" && argv[i + 1]) {
            reportDir = resolveReportDir(argv[++i]!);
        } else if (arg === "--stop-ids" && argv[i + 1]) {
            stopIds.push(
                ...argv[++i]!
                    .split(",")
                    .map((value) => Number(value.trim()))
                    .filter((value) => Number.isFinite(value)),
            );
        } else if (arg === "--limit" && argv[i + 1]) {
            limit = Number(argv[++i]!);
        } else if (arg === "--cutoff" && argv[i + 1]) {
            cutoff = argv[++i]!.trim();
        } else if (arg === "--recent-hours" && argv[i + 1]) {
            recentHours = Number(argv[++i]!);
        } else if (arg === "--execute") {
            execute = true;
        } else if (
            arg === "--confirm-orphan-stop-cleanup" ||
            arg === "--confirm-cleanup"
        ) {
            confirmOrphanStopCleanup = true;
        } else if (arg === "--hard-delete") {
            hardDelete = true;
        } else if (arg === "--delete-stop-source-links") {
            deleteStopSourceLinks = true;
        } else if (arg === "--allow-delete-ybs-source-stops") {
            allowDeleteYbsSourceStops = true;
        } else if (arg === "--dry-run") {
            execute = false;
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return {
        reportDir,
        stopIds,
        limit,
        execute,
        confirmOrphanStopCleanup,
        hardDelete,
        deleteStopSourceLinks,
        allowDeleteYbsSourceStops,
        cutoff,
        recentHours,
    };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-orphan-legacy-stops.ts \\
    --dry-run \\
    --report-dir tmp/transport-imports/legacy-cleanup

  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-orphan-legacy-stops.ts \\
    --execute \\
    --confirm-orphan-stop-cleanup \\
    --report-dir tmp/transport-imports/legacy-cleanup

Options:
  --stop-ids 1,2,3              Optional stop id subset
  --limit 100                     Optional max safe stops to clean
  --cutoff <ISO>                  Cleanup cutoff for recently-updated check
  --recent-hours 24               Rolling cutoff when --cutoff is not set
  --allow-delete-ybs-source-stops Allow stops with external_ybs_app source links (default false)
  --delete-stop-source-links      Delete stop source_links (default: preserve)
  --hard-delete                   Hard-delete stops instead of soft-delete (default: soft-delete)

Default: dry-run only. No DB writes without --execute and --confirm-orphan-stop-cleanup.
`);
}

function displayName(stop: Pick<OrphanBusStopRow, "name_mm" | "name_en" | "name">): string {
    return stop.name_mm ?? stop.name_en ?? stop.name ?? "(unnamed)";
}

function toStopResult(
    stop: OrphanBusStopRow,
    status: StopCleanupResult["status"],
    hardDelete: boolean,
): StopCleanupResult {
    return {
        stop_id: stop.stop_id,
        public_id: stop.public_id,
        name: displayName(stop),
        review_status: stop.review_status,
        status,
        cleanup_mode: hardDelete ? "hard_delete" : "soft_delete",
        block_reasons: stop.block_reasons,
        reason: stop.reason,
    };
}

function selectSafeStops(
    stops: OrphanBusStopRow[],
    stopFilter: number[],
    limit?: number,
): { selected: OrphanBusStopRow[]; notSelected: OrphanBusStopRow[] } {
    const safe = stops.filter((stop) => stop.is_safe);
    let filtered = safe;

    if (stopFilter.length > 0) {
        const filterSet = new Set(stopFilter);
        filtered = safe.filter((stop) => filterSet.has(stop.stop_id));
    }

    if (limit && limit > 0) {
        filtered = filtered.slice(0, limit);
    }

    const selectedIds = new Set(filtered.map((stop) => stop.stop_id));
    const notSelected = stops.filter((stop) => !selectedIds.has(stop.stop_id));

    return { selected: filtered, notSelected };
}

function renderMarkdown(report: CleanupReport): string {
    const blockedLines = Object.entries(report.summary.blocked_by_reason)
        .sort(([, a], [, b]) => b - a)
        .map(([reason, count]) => `| ${reason} | ${count} |`)
        .join("\n");

    const lines = [
        `# Orphan legacy stop cleanup — Phase D2 (${report.mode})`,
        "",
        `- Generated: ${report.generated_at}`,
        `- Status: **${report.status}**`,
        `- DB writes executed: **${report.db_writes_executed ? "yes" : "no"}**`,
        `- DB writes: ${report.db_writes}`,
        `- Cleanup cutoff: ${report.cleanup_cutoff}`,
        `- Cleanup mode: ${report.options.hard_delete ? "hard delete" : "soft delete"}`,
        "",
        "## Summary",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        `| Stops selected (safe) | ${report.summary.stops_selected} |`,
        `| Stops planned | ${report.summary.stops_planned} |`,
        `| Stops executed | ${report.summary.stops_executed} |`,
        `| Stops skipped (blocked) | ${report.summary.stops_skipped_blocked} |`,
        `| Stops skipped (not selected) | ${report.summary.stops_skipped_not_selected} |`,
        `| Stops soft-deleted | ${report.summary.stops_soft_deleted} |`,
        `| Stops hard-deleted | ${report.summary.stops_hard_deleted} |`,
        `| Source links preserved | ${report.summary.source_links_preserved} |`,
        `| Stop names preserved | ${report.summary.stop_names_preserved} |`,
        `| Source links deleted | ${report.summary.source_links_deleted} |`,
        `| Stop names deleted | ${report.summary.stop_names_deleted} |`,
        "",
        "## Blocked stop count by reason",
        "",
        "| Reason | Count |",
        "| --- | ---: |",
        blockedLines || "| (none) | 0 |",
        "",
        "## Selected stop ids",
        "",
        report.stop_ids_selected.length > 0
            ? report.stop_ids_selected.map((id) => `- ${id}`).join("\n")
            : "(none)",
        "",
        "## Selected public_ids",
        "",
        report.public_ids_selected.length > 0
            ? report.public_ids_selected.map((id) => `- ${id}`).join("\n")
            : "(none)",
        "",
    ];

    if (report.refusal_reason) lines.push(`Refusal: ${report.refusal_reason}`, "");
    if (report.error) lines.push(`Error: ${report.error}`, "");

    lines.push("## Stop results (sample)", "");
    for (const stop of report.stops.slice(0, 40)) {
        lines.push(`- stop ${stop.stop_id} (${stop.public_id ?? "null"}): ${stop.status} — ${stop.reason}`);
    }
    if (report.stops.length > 40) {
        lines.push(`- … ${report.stops.length - 40} more in JSON`);
    }

    return `${lines.join("\n")}\n`;
}

export async function cleanupOrphanLegacyStops(options: {
    reportDir: string;
    stopIds?: number[];
    limit?: number;
    execute?: boolean;
    confirmOrphanStopCleanup?: boolean;
    hardDelete?: boolean;
    deleteStopSourceLinks?: boolean;
    allowDeleteYbsSourceStops?: boolean;
    cutoff?: string;
    recentHours?: number;
    databaseUrl?: string;
}): Promise<CleanupReport> {
    const generatedAt = new Date().toISOString();
    const execute = options.execute ?? false;
    const confirmOrphanStopCleanup = options.confirmOrphanStopCleanup ?? false;
    const hardDelete = options.hardDelete ?? false;
    const deleteStopSourceLinks = options.deleteStopSourceLinks ?? false;
    const allowDeleteYbsSourceStops = options.allowDeleteYbsSourceStops ?? false;
    const mode: CleanupMode = execute ? "execute" : "dry_run";
    const { cutoffIso, cutoffMs } = resolveOrphanCleanupCutoff({
        cutoff: options.cutoff,
        recentHours: options.recentHours,
    });
    const classifyOptions = { cutoffMs, allowYbsSourceStops: allowDeleteYbsSourceStops };

    const baseReport: CleanupReport = {
        generated_at: generatedAt,
        phase: "D2_cleanup",
        mode,
        db_writes_executed: false,
        db_writes: 0,
        cleanup_cutoff: cutoffIso,
        options: {
            hard_delete: hardDelete,
            delete_stop_source_links: deleteStopSourceLinks,
            allow_delete_ybs_source_stops: allowDeleteYbsSourceStops,
            limit: options.limit ?? null,
            stop_ids_filter: options.stopIds ?? [],
        },
        status: "failed",
        summary: {
            stops_selected: 0,
            stops_planned: 0,
            stops_executed: 0,
            stops_skipped_blocked: 0,
            stops_skipped_not_selected: 0,
            blocked_by_reason: {},
            source_links_preserved: 0,
            stop_names_preserved: 0,
            source_links_deleted: 0,
            stop_names_deleted: 0,
            stops_soft_deleted: 0,
            stops_hard_deleted: 0,
        },
        stop_ids_selected: [],
        public_ids_selected: [],
        stops: [],
        report_json_path: "",
        report_md_path: "",
    };

    if (execute && !confirmOrphanStopCleanup) {
        return finalizeReport(options.reportDir, {
            ...baseReport,
            status: "refused",
            refusal_reason:
                "Execute refused. Pass --confirm-orphan-stop-cleanup after reviewing the dry-run report and Phase D1 validation.",
        });
    }

    const client = new pg.Client({
        connectionString: options.databaseUrl ?? getDatabaseUrl(),
    });
    await client.connect();

    try {
        const rawRows = await loadOrphanBusStops(client);
        const classified = rawRows.map((row) => classifyOrphanBusStop(row, classifyOptions));
        const { selected, notSelected } = selectSafeStops(
            classified,
            options.stopIds ?? [],
            options.limit,
        );

        const blocked = classified.filter((stop) => !stop.is_safe);
        const stopResults: StopCleanupResult[] = [];
        let dbWrites = 0;
        let stopsSoftDeleted = 0;
        let stopsHardDeleted = 0;
        let sourceLinksPreserved = 0;
        let stopNamesPreserved = 0;
        let sourceLinksDeleted = 0;
        let stopNamesDeleted = 0;

        for (const stop of blocked) {
            stopResults.push(toStopResult(stop, "skipped_blocked", hardDelete));
        }

        for (const stop of notSelected) {
            if (stop.is_safe) {
                stopResults.push(toStopResult(stop, "skipped_not_selected", hardDelete));
            } else if (!blocked.some((item) => item.stop_id === stop.stop_id)) {
                stopResults.push(toStopResult(stop, "skipped_blocked", hardDelete));
            }
        }

        for (const stop of selected) {
            stopResults.push(
                toStopResult(stop, execute ? "executed" : "planned", hardDelete),
            );
        }

        const plannedIds = selected.map((stop) => stop.stop_id);

        if (plannedIds.length === 0) {
            const report: CleanupReport = {
                ...baseReport,
                status: "passed",
                summary: {
                    ...baseReport.summary,
                    stops_selected: 0,
                    stops_planned: 0,
                    stops_skipped_blocked: stopResults.filter((s) => s.status === "skipped_blocked")
                        .length,
                    stops_skipped_not_selected: stopResults.filter(
                        (s) => s.status === "skipped_not_selected",
                    ).length,
                    blocked_by_reason: aggregateBlockReasons(blocked),
                },
                stops: stopResults,
            };
            return finalizeReport(options.reportDir, report);
        }

        if (execute) {
            const reverify = await reverifyOrphanStopsBeforeExecute(
                client,
                plannedIds,
                classifyOptions,
            );

            if (reverify.blocked.length > 0) {
                return finalizeReport(options.reportDir, {
                    ...baseReport,
                    status: "refused",
                    refusal_reason: `Execute refused. ${reverify.blocked.length} planned stop(s) failed re-verification before write.`,
                    summary: {
                        ...baseReport.summary,
                        stops_selected: plannedIds.length,
                        stops_skipped_blocked:
                            blocked.length + reverify.blocked.length,
                        blocked_by_reason: aggregateBlockReasons([
                            ...blocked,
                            ...reverify.blocked.map((item) => ({
                                block_reasons: item.blockers,
                            })),
                        ]),
                    },
                    stop_ids_selected: plannedIds,
                    public_ids_selected: selected
                        .map((stop) => stop.public_id)
                        .filter((id): id is string => Boolean(id)),
                    stops: [
                        ...stopResults,
                        ...reverify.blocked.map((item) => ({
                            stop_id: item.stop_id,
                            public_id: null,
                            name: null,
                            review_status: null,
                            status: "skipped_blocked" as const,
                            cleanup_mode: hardDelete ? "hard_delete" as const : "soft_delete" as const,
                            block_reasons: item.blockers,
                            reason: item.blockers.join("; "),
                        })),
                    ],
                });
            }

            await client.query("begin");
            const cleanupCounts = await executeOrphanStopCleanup(
                client,
                reverify.safe_stop_ids,
                {
                    hardDelete,
                    deleteStopSourceLinks,
                    deleteStopNames: false,
                },
            );
            await client.query("commit");

            stopsSoftDeleted = cleanupCounts.stops_soft_deleted;
            stopsHardDeleted = cleanupCounts.stops_hard_deleted;
            sourceLinksPreserved = cleanupCounts.source_links_preserved;
            stopNamesPreserved = cleanupCounts.stop_names_preserved;
            sourceLinksDeleted = cleanupCounts.source_links_deleted;
            stopNamesDeleted = cleanupCounts.stop_names_deleted;
            dbWrites =
                stopsSoftDeleted +
                stopsHardDeleted +
                sourceLinksDeleted +
                stopNamesDeleted;
        } else {
            const linkPreserveEstimate = selected.reduce(
                (sum, stop) => sum + stop.source_link_count,
                0,
            );
            sourceLinksPreserved = deleteStopSourceLinks ? 0 : linkPreserveEstimate;
            sourceLinksDeleted = deleteStopSourceLinks ? linkPreserveEstimate : 0;

            const nameCount = await client.query<{ count: string }>(
                `select count(*)::text as count from transport.stop_names where stop_id = any($1::bigint[])`,
                [plannedIds],
            );
            stopNamesPreserved = Number(nameCount.rows[0]?.count ?? 0);
        }

        const report: CleanupReport = {
            ...baseReport,
            db_writes_executed: execute && dbWrites > 0,
            db_writes: dbWrites,
            status: "passed",
            summary: {
                stops_selected: selected.length,
                stops_planned: selected.length,
                stops_executed: execute ? selected.length : 0,
                stops_skipped_blocked: stopResults.filter((s) => s.status === "skipped_blocked")
                    .length,
                stops_skipped_not_selected: stopResults.filter(
                    (s) => s.status === "skipped_not_selected",
                ).length,
                blocked_by_reason: aggregateBlockReasons(blocked),
                source_links_preserved: sourceLinksPreserved,
                stop_names_preserved: stopNamesPreserved,
                source_links_deleted: sourceLinksDeleted,
                stop_names_deleted: stopNamesDeleted,
                stops_soft_deleted: stopsSoftDeleted,
                stops_hard_deleted: stopsHardDeleted,
            },
            stop_ids_selected: selected.map((stop) => stop.stop_id),
            public_ids_selected: selected
                .map((stop) => stop.public_id)
                .filter((id): id is string => Boolean(id)),
            stops: stopResults,
        };

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
    const jsonPath = writeJsonReport(
        `${reportDir}/orphan-stop-cleanup-${suffix}.json`,
        report,
    );
    const mdPath = writeMarkdownReport(
        `${reportDir}/orphan-stop-cleanup-${suffix}.md`,
        renderMarkdown({ ...report, report_json_path: jsonPath, report_md_path: "" }),
    );
    const finalReport = { ...report, report_json_path: jsonPath, report_md_path: mdPath };
    writeJsonReport(jsonPath, finalReport);
    return finalReport;
}

async function main(): Promise<void> {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const report = await cleanupOrphanLegacyStops({
        reportDir: args.reportDir,
        stopIds: args.stopIds,
        limit: args.limit,
        execute: args.execute,
        confirmOrphanStopCleanup: args.confirmOrphanStopCleanup,
        hardDelete: args.hardDelete,
        deleteStopSourceLinks: args.deleteStopSourceLinks,
        allowDeleteYbsSourceStops: args.allowDeleteYbsSourceStops,
        cutoff: args.cutoff,
        recentHours: args.recentHours,
    });

    console.log(`Phase D2 orphan stop cleanup: ${report.status} (${report.mode})`);
    console.log(`DB writes executed: ${report.db_writes_executed ? "yes" : "no"}`);
    console.log(`DB writes: ${report.db_writes}`);
    console.log(`Stops selected: ${report.summary.stops_selected}`);
    console.log(`Stops planned: ${report.summary.stops_planned}`);
    console.log(`Stops executed: ${report.summary.stops_executed}`);
    console.log(`Source links preserved: ${report.summary.source_links_preserved}`);
    if (report.refusal_reason) console.log(`Refusal: ${report.refusal_reason}`);
    if (report.error) console.error(`Error: ${report.error}`);
    console.log(`Report: ${report.report_json_path}`);

    if (report.status === "refused" || report.status === "failed") process.exit(1);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("cleanup-orphan-legacy-stops.ts") ||
        process.argv[1].endsWith("cleanup-orphan-legacy-stops.js"));

if (isMain) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
