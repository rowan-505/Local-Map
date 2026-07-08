#!/usr/bin/env npx tsx
/**
 * Report-only orphan legacy stop inspection after legacy route cleanup.
 *
 * Read-only. No DB writes. No deletes.
 *
 * Orphan stop =
 *   transport.stops.mode = 'bus'
 *   AND deleted_at IS NULL
 *   AND NOT EXISTS route_stops referencing the stop.
 *
 * Safe orphan legacy stop candidate =
 *   orphan stop
 *   AND review_status NOT IN ('reviewed','verified','manual_protected')
 *   AND no external_ybs_app stop source link
 *   AND not updated after the cleanup cutoff
 *   AND no suspicious/manual metadata
 *   AND not referenced by any other transport relation (terminals, parent stop).
 */

import pg from "pg";

import {
    DEFAULT_REPORT_DIR,
    classifyOrphanBusStop,
    loadEnv,
    loadOrphanBusStops,
    resolveOrphanCleanupCutoff,
    resolveReportDir,
    writeJsonReport,
    writeMarkdownReport,
    getDatabaseUrl,
    type OrphanBusStopCategory,
    type OrphanBusStopRow,
} from "./legacy-cleanup-shared.js";

type OrphanCategory = OrphanBusStopCategory;
type OrphanStopRow = OrphanBusStopRow;

type ReportPayload = {
    generated_at: string;
    phase: "D2_orphan_report";
    db_writes: 0;
    cleanup_cutoff: string;
    recent_hours: number | null;
    definitions: {
        orphan_stop: string;
        safe_orphan_legacy_stop_candidate: string;
    };
    summary: {
        total_orphan_stops: number;
        safe_to_delete_later: number;
        protected: number;
        ybs_source_link: number;
        protected_source_link: number;
        recently_updated: number;
        suspicious_metadata: number;
        referenced_by_other_relation: number;
    };
    categories: {
        safe_candidates: OrphanStopRow[];
        protected: OrphanStopRow[];
        ybs_source_link: OrphanStopRow[];
        protected_source_link: OrphanStopRow[];
        recently_updated: OrphanStopRow[];
        suspicious_metadata: OrphanStopRow[];
        referenced_by_other_relation: OrphanStopRow[];
    };
    report_json_path: string;
    report_md_path: string;
};

function parseArgs(argv: string[]): {
    reportDir: string;
    cutoff?: string;
    recentHours: number;
} {
    let reportDir = DEFAULT_REPORT_DIR;
    let cutoff: string | undefined;
    let recentHours = 24;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report-dir" && argv[i + 1]) {
            reportDir = resolveReportDir(argv[++i]!);
        } else if (arg === "--cutoff" && argv[i + 1]) {
            cutoff = argv[++i]!.trim();
        } else if (arg === "--recent-hours" && argv[i + 1]) {
            recentHours = Number(argv[++i]!);
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return { reportDir, cutoff, recentHours };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-orphan-legacy-stops.ts \\
    --report-dir tmp/transport-imports/legacy-cleanup \\
    [--cutoff 2026-07-08T00:00:00Z] \\
    [--recent-hours 24]

Read-only report. No deletes. DB writes: 0.

--cutoff        Cleanup cutoff timestamp (ISO). Orphan stops updated after this are flagged recent.
                Default: now minus --recent-hours.
--recent-hours  Rolling window used when --cutoff is not given. Default 24.
`);
}

function displayName(stop: OrphanStopRow): string {
    return stop.name_mm ?? stop.name_en ?? stop.name ?? "(unnamed)";
}

function renderStopTable(rows: OrphanStopRow[], limit = 40): string {
    const header = [
        "| stop_id | public_id | name | review_status | conf | active | updated_at | src_links | source_names | reason |",
        "| ---: | --- | --- | --- | ---: | :---: | --- | ---: | --- | --- |",
    ];
    const body = rows.slice(0, limit).map((stop) =>
        `| ${stop.stop_id} | ${stop.public_id ?? "null"} | ${displayName(stop)} | ${stop.review_status ?? "null"} | ${stop.confidence_score ?? "null"} | ${stop.is_active ? "yes" : "no"} | ${stop.updated_at ?? "null"} | ${stop.source_link_count} | ${stop.source_names.join(", ") || "(none)"} | ${stop.reason} |`,
    );
    if (rows.length > limit) {
        body.push(`| … | | | | | | | | | ${rows.length - limit} more in JSON |`);
    }
    return [...header, ...body].join("\n");
}

function renderMarkdown(report: ReportPayload): string {
    const lines = [
        "# Orphan legacy stop inspection (report only)",
        "",
        `- Generated: ${report.generated_at}`,
        `- Phase: ${report.phase}`,
        `- **DB writes: 0** (no deletes)`,
        `- Cleanup cutoff: ${report.cleanup_cutoff}`,
        "",
        "## Definitions",
        "",
        `- Orphan stop: ${report.definitions.orphan_stop}`,
        `- Safe orphan legacy stop candidate: ${report.definitions.safe_orphan_legacy_stop_candidate}`,
        "",
        "## Summary",
        "",
        "| Category | Count |",
        "| --- | ---: |",
        `| Total orphan stops | ${report.summary.total_orphan_stops} |`,
        `| **Safe to delete later** | **${report.summary.safe_to_delete_later}** |`,
        `| Protected (do not delete) | ${report.summary.protected} |`,
        `| With external_ybs_app stop source link (do not delete by default) | ${report.summary.ybs_source_link} |`,
        `| With manual/admin/important source link (do not delete) | ${report.summary.protected_source_link} |`,
        `| Recently updated (do not delete by default) | ${report.summary.recently_updated} |`,
        `| Suspicious/manual metadata (do not delete by default) | ${report.summary.suspicious_metadata} |`,
        `| Referenced by other relation (do not delete) | ${report.summary.referenced_by_other_relation} |`,
        "",
        "## 1. Safe orphan legacy stop candidates",
        "",
        report.categories.safe_candidates.length > 0
            ? renderStopTable(report.categories.safe_candidates)
            : "(none)",
        "",
        "## 2. Protected orphan stops (do not delete)",
        "",
        report.categories.protected.length > 0
            ? renderStopTable(report.categories.protected)
            : "(none)",
        "",
        "## 3. Orphan stops with external_ybs_app stop source link (do not delete by default)",
        "",
        report.categories.ybs_source_link.length > 0
            ? renderStopTable(report.categories.ybs_source_link)
            : "(none)",
        "",
        "## 4. Orphan stops with manual/admin/important source link (do not delete)",
        "",
        report.categories.protected_source_link.length > 0
            ? renderStopTable(report.categories.protected_source_link)
            : "(none)",
        "",
        "## 5. Recently updated orphan stops (do not delete by default)",
        "",
        report.categories.recently_updated.length > 0
            ? renderStopTable(report.categories.recently_updated)
            : "(none)",
        "",
        "## 6. Orphan stops with suspicious/manual metadata (do not delete by default)",
        "",
        report.categories.suspicious_metadata.length > 0
            ? renderStopTable(report.categories.suspicious_metadata)
            : "(none)",
        "",
        "## 7. Orphan stops referenced by another relation (do not delete)",
        "",
        report.categories.referenced_by_other_relation.length > 0
            ? renderStopTable(report.categories.referenced_by_other_relation)
            : "(none)",
        "",
        "## Result",
        "",
        `Exact count safe to delete later: **${report.summary.safe_to_delete_later}**`,
        "",
        "This report never deletes. Use a separate cleanup step for deletes.",
        "",
    ];

    return `${lines.join("\n")}\n`;
}

export async function reportOrphanLegacyStops(options: {
    reportDir: string;
    cutoff?: string;
    recentHours?: number;
    databaseUrl?: string;
}): Promise<ReportPayload> {
    const generatedAt = new Date().toISOString();
    const { cutoffIso, cutoffMs, recentHours } = resolveOrphanCleanupCutoff({
        cutoff: options.cutoff,
        recentHours: options.recentHours,
    });

    const client = new pg.Client({
        connectionString: options.databaseUrl ?? getDatabaseUrl(),
    });
    await client.connect();

    try {
        await client.query("begin");
        await client.query("set transaction read only");

        const rawRows = await loadOrphanBusStops(client);
        const rows = rawRows.map((row) =>
            classifyOrphanBusStop(row, { cutoffMs, allowYbsSourceStops: false }),
        );

        await client.query("commit");

        const byCategory = (category: OrphanCategory) =>
            rows.filter((row) => row.category === category);

        const safe = rows.filter((row) => row.is_safe);
        const protectedStops = byCategory("protected");
        const ybsLinked = byCategory("ybs_source_link");
        const protectedSource = byCategory("protected_source_link");
        const recent = byCategory("recently_updated");
        const suspicious = byCategory("suspicious_metadata");
        const otherRelation = byCategory("referenced_by_other_relation");

        const report: ReportPayload = {
            generated_at: generatedAt,
            phase: "D2_orphan_report",
            db_writes: 0,
            cleanup_cutoff: cutoffIso,
            recent_hours: recentHours,
            definitions: {
                orphan_stop:
                    "transport.stops.mode = 'bus' AND deleted_at IS NULL AND no route_stops reference the stop",
                safe_orphan_legacy_stop_candidate:
                    "orphan stop, review_status not protected, no external_ybs_app stop source link, no manual/admin source link, not updated after cleanup cutoff, no suspicious/manual metadata, not referenced by terminals or child stops",
            },
            summary: {
                total_orphan_stops: rows.length,
                safe_to_delete_later: safe.length,
                protected: protectedStops.length,
                ybs_source_link: ybsLinked.length,
                protected_source_link: protectedSource.length,
                recently_updated: recent.length,
                suspicious_metadata: suspicious.length,
                referenced_by_other_relation: otherRelation.length,
            },
            categories: {
                safe_candidates: safe,
                protected: protectedStops,
                ybs_source_link: ybsLinked,
                protected_source_link: protectedSource,
                recently_updated: recent,
                suspicious_metadata: suspicious,
                referenced_by_other_relation: otherRelation,
            },
            report_json_path: "",
            report_md_path: "",
        };

        const jsonPath = writeJsonReport(
            `${options.reportDir}/orphan-legacy-stops-report.json`,
            report,
        );
        const mdPath = writeMarkdownReport(
            `${options.reportDir}/orphan-legacy-stops-report.md`,
            renderMarkdown({ ...report, report_json_path: jsonPath, report_md_path: "" }),
        );
        const finalReport = { ...report, report_json_path: jsonPath, report_md_path: mdPath };
        writeJsonReport(jsonPath, finalReport);
        return finalReport;
    } catch (error) {
        await client.query("rollback");
        throw error;
    } finally {
        await client.end();
    }
}

async function main(): Promise<void> {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const report = await reportOrphanLegacyStops({
        reportDir: args.reportDir,
        cutoff: args.cutoff,
        recentHours: args.recentHours,
    });

    console.log("Orphan legacy stop report (read-only, no deletes)");
    console.log(`DB writes: ${report.db_writes}`);
    console.log(`Cleanup cutoff: ${report.cleanup_cutoff}`);
    console.log(`Total orphan stops: ${report.summary.total_orphan_stops}`);
    console.log(`Safe to delete later: ${report.summary.safe_to_delete_later}`);
    console.log(`Protected: ${report.summary.protected}`);
    console.log(`YBS source link: ${report.summary.ybs_source_link}`);
    console.log(`Protected source link: ${report.summary.protected_source_link}`);
    console.log(`Recently updated: ${report.summary.recently_updated}`);
    console.log(`Suspicious metadata: ${report.summary.suspicious_metadata}`);
    console.log(`Referenced by other relation: ${report.summary.referenced_by_other_relation}`);
    console.log(`JSON: ${report.report_json_path}`);
    console.log(`Markdown: ${report.report_md_path}`);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("report-orphan-legacy-stops.ts") ||
        process.argv[1].endsWith("report-orphan-legacy-stops.js"));

if (isMain) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
