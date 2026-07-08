#!/usr/bin/env npx tsx
/**
 * Phase D1 report: legacy bus routes without external_ybs_app route source links.
 *
 * Read-only. No DB writes.
 */

import pg from "pg";

import {
    DEFAULT_REPORT_DIR,
    buildLegacyRouteCandidate,
    loadEnv,
    loadLegacyRoutes,
    loadSystematicRoutes,
    loadSystematicStopIds,
    renderWorkflowCommands,
    resolveReportDir,
    writeJsonReport,
    writeMarkdownReport,
    getDatabaseUrl,
    type LegacyRouteCandidate,
} from "./legacy-cleanup-shared.js";

type ReportPayload = {
    generated_at: string;
    phase: "D1_report";
    db_writes: 0;
    definitions: {
        systematic_route: string;
        legacy_route: string;
    };
    summary: {
        systematic_routes_excluded: number;
        legacy_routes_found: number;
        legacy_routes_selected: number;
        legacy_routes_blocked: number;
        legacy_routes_with_warnings: number;
        total_variants: number;
        total_route_stops: number;
        total_route_paths: number;
        total_unique_stops: number;
        total_stops_shared_with_systematic: number;
        total_legacy_only_stops: number;
        total_source_links_affected: number;
        protected_legacy_only_stops: number;
    };
    blockers: Array<{ route_code: string; route_id: number; blockers: string[] }>;
    warnings: Array<{ route_code: string; route_id: number; warnings: string[] }>;
    systematic_routes_excluded: Array<{
        id: number;
        route_code: string;
        public_name: string;
        ybs_external_id: string;
    }>;
    legacy_routes_selected: LegacyRouteCandidate[];
    legacy_routes_blocked: LegacyRouteCandidate[];
    report_json_path: string;
    report_md_path: string;
};

function parseArgs(argv: string[]): { reportDir: string } {
    let reportDir = DEFAULT_REPORT_DIR;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report-dir" && argv[i + 1]) {
            reportDir = resolveReportDir(argv[++i]!);
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }
    return { reportDir };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-legacy-cleanup-candidates.ts \\
    --report-dir tmp/transport-imports/legacy-cleanup

Read-only report. DB writes: 0.
`);
}

function renderMarkdown(report: ReportPayload): string {
    const lines = [
        "# Legacy bus route cleanup candidates (Phase D1 report)",
        "",
        `- Generated: ${report.generated_at}`,
        `- Phase: ${report.phase}`,
        `- **DB writes: 0**`,
        "",
        "## Definitions",
        "",
        `- Systematic/current route: ${report.definitions.systematic_route}`,
        `- Legacy route: ${report.definitions.legacy_route}`,
        "",
        "## Summary",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        `| Systematic routes excluded | ${report.summary.systematic_routes_excluded} |`,
        `| Legacy routes found | ${report.summary.legacy_routes_found} |`,
        `| Legacy routes selected (eligible) | ${report.summary.legacy_routes_selected} |`,
        `| Legacy routes blocked | ${report.summary.legacy_routes_blocked} |`,
        `| Legacy routes with warnings | ${report.summary.legacy_routes_with_warnings} |`,
        `| Total variants | ${report.summary.total_variants} |`,
        `| Total route_stops | ${report.summary.total_route_stops} |`,
        `| Total route_paths | ${report.summary.total_route_paths} |`,
        `| Total unique stops on legacy routes | ${report.summary.total_unique_stops} |`,
        `| Stops shared with systematic routes | ${report.summary.total_stops_shared_with_systematic} |`,
        `| Legacy-only stops (kept in D1) | ${report.summary.total_legacy_only_stops} |`,
        `| Protected legacy-only stops | ${report.summary.protected_legacy_only_stops} |`,
        `| Source links that would be affected | ${report.summary.total_source_links_affected} |`,
        "",
        "## Safety",
        "",
        "- Any route with `external_ybs_app` route source link is excluded.",
        "- Protected routes (`reviewed`, `verified`, `manual_protected`) are blocked.",
        "- Phase D1 deletes route trees only. Stops are not deleted.",
        "",
    ];

    if (report.blockers.length > 0) {
        lines.push("## Blockers", "");
        for (const item of report.blockers) {
            lines.push(`- **${item.route_code}** (id=${item.route_id}): ${item.blockers.join("; ")}`);
        }
        lines.push("");
    }

    if (report.warnings.length > 0) {
        lines.push("## Warnings", "");
        for (const item of report.warnings.slice(0, 50)) {
            lines.push(`- **${item.route_code}** (id=${item.route_id}): ${item.warnings.join("; ")}`);
        }
        if (report.warnings.length > 50) {
            lines.push(`- … and ${report.warnings.length - 50} more (see JSON report)`);
        }
        lines.push("");
    }

    lines.push(
        "## Systematic routes excluded (sample)",
        "",
        "| route_code | id | ybs_external_id |",
        "| --- | ---: | --- |",
    );
    for (const route of report.systematic_routes_excluded.slice(0, 20)) {
        lines.push(`| ${route.route_code} | ${route.id} | ${route.ybs_external_id} |`);
    }
    if (report.systematic_routes_excluded.length > 20) {
        lines.push(`| … | | ${report.systematic_routes_excluded.length - 20} more in JSON |`);
    }
    lines.push("");

    lines.push(
        "## Legacy routes selected",
        "",
        "| route_code | id | review_status | active | variants | route_stops | paths | unique stops | shared stops | legacy-only stops | source_links |",
        "| --- | ---: | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const route of report.legacy_routes_selected) {
        lines.push(
            `| ${route.route_code} | ${route.id} | ${route.review_status ?? "null"} | ${route.is_active ? "yes" : "no"} | ${route.variant_count} | ${route.route_stop_count} | ${route.route_path_count} | ${route.unique_stop_count} | ${route.stops_shared_with_systematic_count} | ${route.legacy_only_stop_count} | ${route.source_links_affected.length} |`,
        );
    }
    lines.push("", renderWorkflowCommands(report.report_json_path.replace(/\/[^/]+$/, "")));

    return `${lines.join("\n")}\n`;
}

export async function reportLegacyCleanupCandidates(options: {
    reportDir: string;
    databaseUrl?: string;
}): Promise<ReportPayload> {
    const generatedAt = new Date().toISOString();
    const client = new pg.Client({
        connectionString: options.databaseUrl ?? getDatabaseUrl(),
    });
    await client.connect();

    try {
        await client.query("begin");
        await client.query("set transaction read only");

        const systematicRoutes = await loadSystematicRoutes(client);
        const legacyRoutes = await loadLegacyRoutes(client);
        const systematicStopIds = await loadSystematicStopIds(client);

        const candidates: LegacyRouteCandidate[] = [];
        for (const route of legacyRoutes) {
            candidates.push(await buildLegacyRouteCandidate(client, route, systematicStopIds));
        }

        const selected = candidates.filter((route) => route.eligible);
        const blocked = candidates.filter((route) => !route.eligible);
        const withWarnings = candidates.filter((route) => route.warnings.length > 0);

        const protectedOnlyResult = await client.query<{ count: string }>(
            `
            with systematic_routes as (
                select r.id
                from transport.routes r
                inner join transport.source_links sl
                    on sl.entity_type = 'route'
                   and sl.entity_id = r.id
                   and sl.source_name = 'external_ybs_app'
                   and sl.external_id like 'route:ybs_go:%'
                where r.mode = 'bus' and r.deleted_at is null
            ),
            legacy_routes as (
                select r.id
                from transport.routes r
                where r.mode = 'bus'
                  and r.deleted_at is null
                  and not exists (
                      select 1 from transport.source_links sl
                      where sl.entity_type = 'route'
                        and sl.entity_id = r.id
                        and sl.source_name = 'external_ybs_app'
                        and sl.external_id like 'route:ybs_go:%'
                  )
            ),
            legacy_only_stops as (
                select distinct rs.stop_id
                from transport.route_stops rs
                join transport.route_variants rv on rv.id = rs.route_variant_id
                where rv.route_id in (select id from legacy_routes)
                  and rs.stop_id not in (
                      select distinct rs2.stop_id
                      from transport.route_stops rs2
                      join transport.route_variants rv2 on rv2.id = rs2.route_variant_id
                      where rv2.route_id in (select id from systematic_routes)
                  )
            )
            select count(*)::text as count
            from transport.stops s
            join legacy_only_stops los on los.stop_id = s.id
            where s.deleted_at is null
              and s.review_status in ('reviewed', 'verified', 'manual_protected')
            `,
        );

        const report: ReportPayload = {
            generated_at: generatedAt,
            phase: "D1_report",
            db_writes: 0,
            definitions: {
                systematic_route:
                    "transport.routes.mode = 'bus' with transport.source_links entity_type='route', source_name='external_ybs_app', external_id LIKE 'route:ybs_go:%'",
                legacy_route:
                    "transport.routes.mode = 'bus', deleted_at IS NULL, and no matching external_ybs_app route source link",
            },
            summary: {
                systematic_routes_excluded: systematicRoutes.length,
                legacy_routes_found: legacyRoutes.length,
                legacy_routes_selected: selected.length,
                legacy_routes_blocked: blocked.length,
                legacy_routes_with_warnings: withWarnings.length,
                total_variants: selected.reduce((sum, route) => sum + route.variant_count, 0),
                total_route_stops: selected.reduce((sum, route) => sum + route.route_stop_count, 0),
                total_route_paths: selected.reduce((sum, route) => sum + route.route_path_count, 0),
                total_unique_stops: new Set(selected.flatMap((route) => route.legacy_only_stop_ids.concat(route.stop_ids_shared_with_systematic))).size,
                total_stops_shared_with_systematic: new Set(
                    selected.flatMap((route) => route.stop_ids_shared_with_systematic),
                ).size,
                total_legacy_only_stops: new Set(selected.flatMap((route) => route.legacy_only_stop_ids))
                    .size,
                total_source_links_affected: selected.reduce(
                    (sum, route) => sum + route.source_links_affected.length,
                    0,
                ),
                protected_legacy_only_stops: Number(protectedOnlyResult.rows[0]?.count ?? 0),
            },
            blockers: blocked.map((route) => ({
                route_code: route.route_code,
                route_id: route.id,
                blockers: route.blockers,
            })),
            warnings: withWarnings.map((route) => ({
                route_code: route.route_code,
                route_id: route.id,
                warnings: route.warnings,
            })),
            systematic_routes_excluded: systematicRoutes,
            legacy_routes_selected: selected,
            legacy_routes_blocked: blocked,
            report_json_path: "",
            report_md_path: "",
        };

        await client.query("commit");

        const jsonPath = writeJsonReport(
            `${options.reportDir}/phase-d1-legacy-route-candidates.json`,
            report,
        );
        const mdPath = writeMarkdownReport(
            `${options.reportDir}/phase-d1-legacy-route-candidates.md`,
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
    const report = await reportLegacyCleanupCandidates({ reportDir: args.reportDir });

    console.log("Legacy route cleanup report (read-only)");
    console.log(`DB writes: ${report.db_writes}`);
    console.log(`Systematic routes excluded: ${report.summary.systematic_routes_excluded}`);
    console.log(`Legacy routes found: ${report.summary.legacy_routes_found}`);
    console.log(`Legacy routes selected: ${report.summary.legacy_routes_selected}`);
    console.log(`Legacy routes blocked: ${report.summary.legacy_routes_blocked}`);
    console.log(`JSON: ${report.report_json_path}`);
    console.log(`Markdown: ${report.report_md_path}`);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("report-legacy-cleanup-candidates.ts") ||
        process.argv[1].endsWith("report-legacy-cleanup-candidates.js"));

if (isMain) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
