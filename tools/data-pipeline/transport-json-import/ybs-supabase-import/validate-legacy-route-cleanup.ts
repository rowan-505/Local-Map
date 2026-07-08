#!/usr/bin/env npx tsx
/**
 * Phase D1 validation after legacy bus route-tree cleanup.
 *
 * Read-only. No DB writes.
 */

import pg from "pg";

import {
    DEFAULT_REPORT_DIR,
    loadEnv,
    loadLegacyRoutes,
    loadSystematicRoutes,
    resolveReportDir,
    writeJsonReport,
    writeMarkdownReport,
    getDatabaseUrl,
} from "./legacy-cleanup-shared.js";
import { YBS_SOURCE_NAME } from "./source-link-utils.js";

type CheckStatus = "passed" | "failed" | "warning" | "skipped";

type ValidationCheck = {
    check_id: number;
    name: string;
    status: CheckStatus;
    message: string;
    counts?: Record<string, number>;
};

type ValidationIssue = {
    severity: "blocker" | "warning";
    code: string;
    message: string;
    check_id?: number;
};

type OrphanStopSummary = {
    total_orphan_stops: number;
    orphan_bus_stops: number;
    orphan_legacy_like_stops: number;
    protected_orphan_stops: number;
    orphan_stops_with_ybs_source_link: number;
    orphan_stops_updated_recently: number;
    recent_days: number;
};

type SystematicSourceLinkSummary = {
    route_source_links: number;
    systematic_routes_missing_route_source_link: number;
    stop_source_links_on_systematic_routes: number;
    route_stop_source_links_on_systematic_routes: number;
    systematic_route_stops_missing_route_stop_source_link: number;
};

type DashboardExpectation = {
    current_systematic_dataset: string;
    legacy_only_dataset: string;
};

type ValidationReport = {
    generated_at: string;
    phase: "D1_validation";
    db_writes: 0;
    expect_zero_legacy_routes: boolean;
    result: "PASS" | "FAIL";
    status: "passed" | "failed";
    next_recommended_action: string;
    summary: {
        active_legacy_bus_routes: number;
        systematic_routes_active: number;
        systematic_routes_soft_deleted: number;
        systematic_route_stops: number;
        route_stops_on_deleted_legacy_variants: number;
        blocker_count: number;
        warning_count: number;
    };
    checks: ValidationCheck[];
    counts: {
        active_legacy_bus_routes: number;
        systematic_routes_active: number;
        systematic_routes_soft_deleted: number;
        systematic_route_stops: number;
        systematic_source_links: SystematicSourceLinkSummary;
        route_stops_on_deleted_legacy_variants: number;
        soft_deleted_legacy_routes: number;
        orphan_stops: OrphanStopSummary;
    };
    orphan_stops: OrphanStopSummary;
    systematic_routes_remaining: Array<{
        id: number;
        route_code: string;
        public_name: string;
        ybs_external_id: string;
    }>;
    legacy_routes_remaining: Array<{
        id: number;
        route_code: string;
        public_name: string;
        review_status: string | null;
        is_active: boolean | null;
    }>;
    systematic_routes_soft_deleted: Array<{
        id: number;
        route_code: string;
        public_name: string;
        deleted_at: string;
    }>;
    dashboard_expectations: DashboardExpectation;
    blockers: ValidationIssue[];
    warnings: ValidationIssue[];
    report_json_path: string;
    report_md_path: string;
};

const RECENT_ORPHAN_DAYS = 7;

function parseArgs(argv: string[]): { reportDir: string; expectZero: boolean } {
    let reportDir = DEFAULT_REPORT_DIR;
    let expectZero = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report-dir" && argv[i + 1]) {
            reportDir = resolveReportDir(argv[++i]!);
        } else if (arg === "--expect-zero") {
            expectZero = true;
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return { reportDir, expectZero };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-legacy-route-cleanup.ts \\
    --report-dir tmp/transport-imports/legacy-cleanup \\
    [--expect-zero]

Read-only validation after Phase D1. DB writes: 0.

--expect-zero  Fail when any active legacy bus routes remain (full cleanup expected).
`);
}

function renderMarkdown(report: ValidationReport): string {
    const lines = [
        `# Legacy route cleanup validation (Phase D1)`,
        "",
        `- Generated: ${report.generated_at}`,
        `- Result: **${report.result}**`,
        `- **DB writes: 0**`,
        `- expect-zero legacy routes: ${report.expect_zero_legacy_routes}`,
        "",
        "## Next recommended action",
        "",
        report.next_recommended_action,
        "",
        "## Summary counts",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        `| Active legacy bus routes | ${report.summary.active_legacy_bus_routes} |`,
        `| Systematic routes (active) | ${report.summary.systematic_routes_active} |`,
        `| Systematic routes soft-deleted | ${report.summary.systematic_routes_soft_deleted} |`,
        `| Systematic route_stops | ${report.summary.systematic_route_stops} |`,
        `| route_stops on deleted legacy variants | ${report.summary.route_stops_on_deleted_legacy_variants} |`,
        `| Blockers | ${report.summary.blocker_count} |`,
        `| Warnings | ${report.summary.warning_count} |`,
        "",
        "## Validation checks",
        "",
        "| # | Check | Status | Message |",
        "| ---: | --- | --- | --- |",
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.check_id} | ${check.name} | ${check.status} | ${check.message} |`);
    }
    lines.push("");

    lines.push(
        "## Orphan stops (report only — Phase D2 input)",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        `| Total orphan stops | ${report.orphan_stops.total_orphan_stops} |`,
        `| Orphan bus stops | ${report.orphan_stops.orphan_bus_stops} |`,
        `| Orphan legacy-like stops | ${report.orphan_stops.orphan_legacy_like_stops} |`,
        `| Protected orphan stops | ${report.orphan_stops.protected_orphan_stops} |`,
        `| Orphan stops with external_ybs_app stop source link | ${report.orphan_stops.orphan_stops_with_ybs_source_link} |`,
        `| Orphan stops updated in last ${report.orphan_stops.recent_days} days | ${report.orphan_stops.orphan_stops_updated_recently} |`,
        "",
        "## Dashboard expected behavior",
        "",
        `- Current/Systematic dataset: ${report.dashboard_expectations.current_systematic_dataset}`,
        `- Legacy only dataset: ${report.dashboard_expectations.legacy_only_dataset}`,
        "",
    );

    if (report.blockers.length > 0) {
        lines.push("## Blockers", "");
        for (const issue of report.blockers) {
            lines.push(`- **${issue.code}**: ${issue.message}`);
        }
        lines.push("");
    }

    if (report.warnings.length > 0) {
        lines.push("## Warnings", "");
        for (const issue of report.warnings) {
            lines.push(`- **${issue.code}**: ${issue.message}`);
        }
        lines.push("");
    }

    if (report.legacy_routes_remaining.length > 0) {
        lines.push("## Active legacy routes remaining (sample)", "");
        for (const route of report.legacy_routes_remaining.slice(0, 30)) {
            lines.push(
                `- ${route.route_code} (id=${route.id}, review_status=${route.review_status ?? "null"})`,
            );
        }
        if (report.legacy_routes_remaining.length > 30) {
            lines.push(`- … ${report.legacy_routes_remaining.length - 30} more in JSON`);
        }
        lines.push("");
    }

    if (report.result === "PASS") {
        lines.push(
            "## Phase D2 next step",
            "",
            "```bash",
            "npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-orphan-legacy-stops.ts \\",
            "  --report-dir tmp/transport-imports/legacy-cleanup",
            "```",
            "",
        );
    }

    return `${lines.join("\n")}\n`;
}

async function loadValidationCounts(client: pg.Client): Promise<{
    systematic_route_stops: number;
    systematic_routes_soft_deleted: number;
    route_stops_on_deleted_legacy_variants: number;
    soft_deleted_legacy_routes: number;
    systematic_source_links: SystematicSourceLinkSummary;
    orphan_stops: OrphanStopSummary;
    systematic_routes_soft_deleted_rows: Array<{
        id: number;
        route_code: string;
        public_name: string;
        deleted_at: string;
    }>;
}> {
    const result = await client.query<{
        systematic_route_stops: string;
        systematic_routes_soft_deleted: string;
        route_stops_on_deleted_legacy_variants: string;
        soft_deleted_legacy_routes: string;
        route_source_links: string;
        systematic_routes_missing_route_source_link: string;
        stop_source_links_on_systematic_routes: string;
        route_stop_source_links_on_systematic_routes: string;
        systematic_route_stops_missing_route_stop_source_link: string;
        total_orphan_stops: string;
        orphan_bus_stops: string;
        orphan_legacy_like_stops: string;
        protected_orphan_stops: string;
        orphan_stops_with_ybs_source_link: string;
        orphan_stops_updated_recently: string;
    }>(
        `
        with systematic_routes as (
            select r.id
            from transport.routes r
            where r.mode = 'bus'
              and r.deleted_at is null
              and exists (
                  select 1
                  from transport.source_links sl
                  where sl.entity_type = 'route'
                    and sl.entity_id = r.id
                    and sl.source_name = $1
                    and sl.external_id like 'route:ybs_go:%'
              )
        ),
        systematic_routes_all as (
            select r.id
            from transport.routes r
            where r.mode = 'bus'
              and exists (
                  select 1
                  from transport.source_links sl
                  where sl.entity_type = 'route'
                    and sl.entity_id = r.id
                    and sl.source_name = $1
                    and sl.external_id like 'route:ybs_go:%'
              )
        ),
        legacy_routes as (
            select r.id
            from transport.routes r
            where r.mode = 'bus'
              and not exists (
                  select 1
                  from transport.source_links sl
                  where sl.entity_type = 'route'
                    and sl.entity_id = r.id
                    and sl.source_name = $1
                    and sl.external_id like 'route:ybs_go:%'
              )
        ),
        systematic_variants as (
            select rv.id, rv.route_id
            from transport.route_variants rv
            where rv.route_id in (select id from systematic_routes)
              and rv.deleted_at is null
        ),
        systematic_route_stop_rows as (
            select rs.id, rs.stop_id
            from transport.route_stops rs
            where rs.route_variant_id in (select id from systematic_variants)
        ),
        orphan_stop_rows as (
            select s.id, s.review_status, s.stop_type, s.updated_at
            from transport.stops s
            where s.deleted_at is null
              and not exists (
                  select 1 from transport.route_stops rs where rs.stop_id = s.id
              )
        )
        select
            (select count(*)::text from systematic_route_stop_rows) as systematic_route_stops,
            (
                select count(*)::text
                from transport.routes r
                where r.id in (select id from systematic_routes_all)
                  and r.deleted_at is not null
            ) as systematic_routes_soft_deleted,
            (
                select count(*)::text
                from transport.route_stops rs
                inner join transport.route_variants rv on rv.id = rs.route_variant_id
                inner join legacy_routes lr on lr.id = rv.route_id
                where rv.deleted_at is not null
            ) as route_stops_on_deleted_legacy_variants,
            (
                select count(*)::text
                from transport.routes r
                inner join legacy_routes lr on lr.id = r.id
                where r.deleted_at is not null
            ) as soft_deleted_legacy_routes,
            (
                select count(*)::text
                from transport.source_links sl
                where sl.entity_type = 'route'
                  and sl.source_name = $1
                  and sl.external_id like 'route:ybs_go:%'
                  and sl.entity_id in (select id from systematic_routes)
            ) as route_source_links,
            (
                select count(*)::text
                from systematic_routes sr
                where not exists (
                    select 1
                    from transport.source_links sl
                    where sl.entity_type = 'route'
                      and sl.entity_id = sr.id
                      and sl.source_name = $1
                      and sl.external_id like 'route:ybs_go:%'
                )
            ) as systematic_routes_missing_route_source_link,
            (
                select count(distinct sl.id)::text
                from transport.source_links sl
                inner join systematic_route_stop_rows srs on srs.stop_id = sl.entity_id
                where sl.entity_type = 'stop'
                  and sl.source_name = $1
                  and sl.external_id like 'stop:ybs_go:%'
            ) as stop_source_links_on_systematic_routes,
            (
                select count(distinct sl.id)::text
                from transport.source_links sl
                inner join systematic_route_stop_rows srs on srs.id = sl.entity_id
                where sl.entity_type = 'route_stop'
                  and sl.source_name = $1
                  and sl.external_id like 'route_stop:ybs_go:%'
            ) as route_stop_source_links_on_systematic_routes,
            (
                select count(*)::text
                from systematic_route_stop_rows srs
                where not exists (
                    select 1
                    from transport.source_links sl
                    where sl.entity_type = 'route_stop'
                      and sl.entity_id = srs.id
                      and sl.source_name = $1
                      and sl.external_id like 'route_stop:ybs_go:%'
                )
            ) as systematic_route_stops_missing_route_stop_source_link,
            (select count(*)::text from orphan_stop_rows) as total_orphan_stops,
            (
                select count(*)::text
                from orphan_stop_rows o
                where coalesce(o.stop_type, 'stop') = 'stop'
            ) as orphan_bus_stops,
            (
                select count(*)::text
                from orphan_stop_rows o
                where not exists (
                    select 1
                    from transport.source_links sl
                    where sl.entity_type = 'stop'
                      and sl.entity_id = o.id
                      and sl.source_name = $1
                      and sl.external_id like 'stop:ybs_go:%'
                )
            ) as orphan_legacy_like_stops,
            (
                select count(*)::text
                from orphan_stop_rows o
                where o.review_status in ('reviewed', 'verified', 'manual_protected')
            ) as protected_orphan_stops,
            (
                select count(*)::text
                from orphan_stop_rows o
                where exists (
                    select 1
                    from transport.source_links sl
                    where sl.entity_type = 'stop'
                      and sl.entity_id = o.id
                      and sl.source_name = $1
                      and sl.external_id like 'stop:ybs_go:%'
                )
            ) as orphan_stops_with_ybs_source_link,
            (
                select count(*)::text
                from orphan_stop_rows o
                where o.updated_at >= now() - ($2::text || ' days')::interval
            ) as orphan_stops_updated_recently
        `,
        [YBS_SOURCE_NAME, String(RECENT_ORPHAN_DAYS)],
    );

    const softDeletedSystematic = await client.query<{
        id: string;
        route_code: string;
        public_name: string;
        deleted_at: string;
    }>(
        `
        select r.id::text, r.route_code, r.public_name, r.deleted_at::text
        from transport.routes r
        where r.mode = 'bus'
          and r.deleted_at is not null
          and exists (
              select 1
              from transport.source_links sl
              where sl.entity_type = 'route'
                and sl.entity_id = r.id
                and sl.source_name = $1
                and sl.external_id like 'route:ybs_go:%'
          )
        order by r.route_code, r.id
        `,
        [YBS_SOURCE_NAME],
    );

    const row = result.rows[0]!;

    return {
        systematic_route_stops: Number(row.systematic_route_stops),
        systematic_routes_soft_deleted: Number(row.systematic_routes_soft_deleted),
        route_stops_on_deleted_legacy_variants: Number(
            row.route_stops_on_deleted_legacy_variants,
        ),
        soft_deleted_legacy_routes: Number(row.soft_deleted_legacy_routes),
        systematic_source_links: {
            route_source_links: Number(row.route_source_links),
            systematic_routes_missing_route_source_link: Number(
                row.systematic_routes_missing_route_source_link,
            ),
            stop_source_links_on_systematic_routes: Number(
                row.stop_source_links_on_systematic_routes,
            ),
            route_stop_source_links_on_systematic_routes: Number(
                row.route_stop_source_links_on_systematic_routes,
            ),
            systematic_route_stops_missing_route_stop_source_link: Number(
                row.systematic_route_stops_missing_route_stop_source_link,
            ),
        },
        orphan_stops: {
            total_orphan_stops: Number(row.total_orphan_stops),
            orphan_bus_stops: Number(row.orphan_bus_stops),
            orphan_legacy_like_stops: Number(row.orphan_legacy_like_stops),
            protected_orphan_stops: Number(row.protected_orphan_stops),
            orphan_stops_with_ybs_source_link: Number(row.orphan_stops_with_ybs_source_link),
            orphan_stops_updated_recently: Number(row.orphan_stops_updated_recently),
            recent_days: RECENT_ORPHAN_DAYS,
        },
        systematic_routes_soft_deleted_rows: softDeletedSystematic.rows.map((r) => ({
            id: Number(r.id),
            route_code: r.route_code,
            public_name: r.public_name,
            deleted_at: r.deleted_at,
        })),
    };
}

function buildDashboardExpectations(
    activeLegacyCount: number,
    systematicCount: number,
    expectZero: boolean,
): DashboardExpectation {
    const fullCleanupDone = expectZero ? activeLegacyCount === 0 : activeLegacyCount === 0;

    return {
        current_systematic_dataset: `Should list ${systematicCount} systematic YBS route(s) with external_ybs_app route source links. Legacy routes without that link should not appear as active current routes.`,
        legacy_only_dataset: fullCleanupDone
            ? "Should show 0 active legacy bus routes after full cleanup."
            : `Should show ${activeLegacyCount} remaining active legacy bus route(s) if cleanup was subset/limited. Soft-deleted legacy routes should not appear as active.`,
    };
}

function buildNextAction(result: "PASS" | "FAIL", expectZero: boolean, legacyCount: number): string {
    if (result === "PASS") {
        return "PASS — proceed to Phase D2 orphan stop report: npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-orphan-legacy-stops.ts --report-dir tmp/transport-imports/legacy-cleanup";
    }
    if (expectZero && legacyCount > 0) {
        return "FAIL — active legacy routes remain but --expect-zero was set. Finish Phase D1 cleanup, then re-run validation.";
    }
    return "FAIL — fix blockers above, re-run cleanup if needed, then run validate-legacy-route-cleanup.ts again.";
}

export async function validateLegacyRouteCleanup(options: {
    reportDir: string;
    expectZero?: boolean;
    databaseUrl?: string;
}): Promise<ValidationReport> {
    const generatedAt = new Date().toISOString();
    const expectZero = options.expectZero ?? false;
    const client = new pg.Client({
        connectionString: options.databaseUrl ?? getDatabaseUrl(),
    });
    await client.connect();

    try {
        await client.query("begin");
        await client.query("set transaction read only");

        const systematicRoutes = await loadSystematicRoutes(client);
        const legacyRoutes = await loadLegacyRoutes(client);
        const metrics = await loadValidationCounts(client);

        const blockers: ValidationIssue[] = [];
        const warnings: ValidationIssue[] = [];
        const checks: ValidationCheck[] = [];

        // Check 1: active legacy bus routes
        const legacyCount = legacyRoutes.length;
        if (expectZero && legacyCount > 0) {
            blockers.push({
                severity: "blocker",
                check_id: 1,
                code: "active_legacy_routes_remain",
                message: `${legacyCount} active legacy bus route(s) remain but --expect-zero was passed.`,
            });
            checks.push({
                check_id: 1,
                name: "Active legacy bus routes",
                status: "failed",
                message: `Expected 0, found ${legacyCount}.`,
                counts: { active_legacy_bus_routes: legacyCount },
            });
        } else if (legacyCount > 0) {
            warnings.push({
                severity: "warning",
                check_id: 1,
                code: "active_legacy_routes_remain",
                message: `${legacyCount} active legacy bus route(s) remain (subset cleanup — not a failure without --expect-zero).`,
            });
            checks.push({
                check_id: 1,
                name: "Active legacy bus routes",
                status: "warning",
                message: `${legacyCount} remain. OK for subset cleanup; use --expect-zero after full cleanup.`,
                counts: { active_legacy_bus_routes: legacyCount },
            });
        } else {
            checks.push({
                check_id: 1,
                name: "Active legacy bus routes",
                status: "passed",
                message: "0 active legacy bus routes.",
                counts: { active_legacy_bus_routes: 0 },
            });
        }

        // Check 2: systematic routes exist
        if (systematicRoutes.length === 0) {
            blockers.push({
                severity: "blocker",
                check_id: 2,
                code: "no_systematic_routes",
                message: "No active systematic YBS routes found.",
            });
            checks.push({
                check_id: 2,
                name: "Systematic routes exist",
                status: "failed",
                message: "Count is 0.",
                counts: { systematic_routes_active: 0 },
            });
        } else {
            checks.push({
                check_id: 2,
                name: "Systematic routes exist",
                status: "passed",
                message: `${systematicRoutes.length} active systematic route(s).`,
                counts: { systematic_routes_active: systematicRoutes.length },
            });
        }

        // Check 3: systematic routes not soft-deleted by cleanup
        if (metrics.systematic_routes_soft_deleted > 0) {
            blockers.push({
                severity: "blocker",
                check_id: 3,
                code: "systematic_routes_soft_deleted",
                message: `${metrics.systematic_routes_soft_deleted} systematic route(s) have deleted_at set.`,
            });
            checks.push({
                check_id: 3,
                name: "Systematic routes not soft-deleted",
                status: "failed",
                message: `${metrics.systematic_routes_soft_deleted} affected.`,
                counts: { systematic_routes_soft_deleted: metrics.systematic_routes_soft_deleted },
            });
        } else {
            checks.push({
                check_id: 3,
                name: "Systematic routes not soft-deleted",
                status: "passed",
                message: "0 systematic routes soft-deleted.",
                counts: { systematic_routes_soft_deleted: 0 },
            });
        }

        // Check 4: systematic route_stops exist
        if (metrics.systematic_route_stops === 0) {
            blockers.push({
                severity: "blocker",
                check_id: 4,
                code: "no_systematic_route_stops",
                message: "No route_stops found on active systematic route variants.",
            });
            checks.push({
                check_id: 4,
                name: "Systematic route_stops exist",
                status: "failed",
                message: "Count is 0.",
                counts: { systematic_route_stops: 0 },
            });
        } else {
            checks.push({
                check_id: 4,
                name: "Systematic route_stops exist",
                status: "passed",
                message: `${metrics.systematic_route_stops} route_stops on systematic variants.`,
                counts: { systematic_route_stops: metrics.systematic_route_stops },
            });
        }

        // Check 5: systematic source_links
        const sl = metrics.systematic_source_links;
        let check5Status: CheckStatus = "passed";
        let check5Message = `route=${sl.route_source_links}, stop=${sl.stop_source_links_on_systematic_routes}, route_stop=${sl.route_stop_source_links_on_systematic_routes}`;

        if (sl.systematic_routes_missing_route_source_link > 0) {
            check5Status = "failed";
            blockers.push({
                severity: "blocker",
                check_id: 5,
                code: "systematic_routes_missing_source_link",
                message: `${sl.systematic_routes_missing_route_source_link} systematic route(s) missing route:ybs_go source_link.`,
            });
        }
        if (sl.route_source_links === 0) {
            check5Status = "failed";
            blockers.push({
                severity: "blocker",
                check_id: 5,
                code: "no_systematic_route_source_links",
                message: "No route source_links found for systematic routes.",
            });
        }
        if (sl.systematic_route_stops_missing_route_stop_source_link > 0) {
            warnings.push({
                severity: "warning",
                check_id: 5,
                code: "systematic_route_stops_missing_source_link",
                message: `${sl.systematic_route_stops_missing_route_stop_source_link} systematic route_stops missing route_stop:ybs_go source_link.`,
            });
            if (check5Status === "passed") check5Status = "warning";
        }
        if (check5Status === "failed") {
            check5Message = `Source link integrity failed. ${check5Message}`;
        }

        checks.push({
            check_id: 5,
            name: "Systematic source_links intact",
            status: check5Status,
            message: check5Message,
            counts: {
                route_source_links: sl.route_source_links,
                stop_source_links: sl.stop_source_links_on_systematic_routes,
                route_stop_source_links: sl.route_stop_source_links_on_systematic_routes,
                routes_missing_route_link: sl.systematic_routes_missing_route_source_link,
                route_stops_missing_link: sl.systematic_route_stops_missing_route_stop_source_link,
            },
        });

        // Check 6: no route_stops on deleted legacy variants
        if (metrics.route_stops_on_deleted_legacy_variants > 0) {
            blockers.push({
                severity: "blocker",
                check_id: 6,
                code: "route_stops_on_deleted_legacy_variants",
                message: `${metrics.route_stops_on_deleted_legacy_variants} route_stops still reference deleted legacy variants.`,
            });
            checks.push({
                check_id: 6,
                name: "No route_stops on deleted legacy variants",
                status: "failed",
                message: `${metrics.route_stops_on_deleted_legacy_variants} remain.`,
                counts: {
                    route_stops_on_deleted_legacy_variants:
                        metrics.route_stops_on_deleted_legacy_variants,
                },
            });
        } else {
            checks.push({
                check_id: 6,
                name: "No route_stops on deleted legacy variants",
                status: "passed",
                message: "0 route_stops on deleted legacy variants.",
                counts: { route_stops_on_deleted_legacy_variants: 0 },
            });
        }

        // Check 7: orphan stops (report only)
        checks.push({
            check_id: 7,
            name: "Orphan stops after cleanup (report only)",
            status: "passed",
            message: `total=${metrics.orphan_stops.total_orphan_stops}, legacy-like=${metrics.orphan_stops.orphan_legacy_like_stops}, protected=${metrics.orphan_stops.protected_orphan_stops}`,
            counts: { ...metrics.orphan_stops },
        });

        // Check 8: dashboard expectations
        const dashboard = buildDashboardExpectations(
            legacyCount,
            systematicRoutes.length,
            expectZero,
        );
        checks.push({
            check_id: 8,
            name: "Dashboard expected behavior",
            status: legacyCount === 0 || !expectZero ? "passed" : "warning",
            message: dashboard.legacy_only_dataset,
        });

        const result: "PASS" | "FAIL" = blockers.length === 0 ? "PASS" : "FAIL";

        const report: ValidationReport = {
            generated_at: generatedAt,
            phase: "D1_validation",
            db_writes: 0,
            expect_zero_legacy_routes: expectZero,
            result,
            status: result === "PASS" ? "passed" : "failed",
            next_recommended_action: buildNextAction(result, expectZero, legacyCount),
            summary: {
                active_legacy_bus_routes: legacyCount,
                systematic_routes_active: systematicRoutes.length,
                systematic_routes_soft_deleted: metrics.systematic_routes_soft_deleted,
                systematic_route_stops: metrics.systematic_route_stops,
                route_stops_on_deleted_legacy_variants:
                    metrics.route_stops_on_deleted_legacy_variants,
                blocker_count: blockers.length,
                warning_count: warnings.length,
            },
            checks,
            counts: {
                active_legacy_bus_routes: legacyCount,
                systematic_routes_active: systematicRoutes.length,
                systematic_routes_soft_deleted: metrics.systematic_routes_soft_deleted,
                systematic_route_stops: metrics.systematic_route_stops,
                systematic_source_links: metrics.systematic_source_links,
                route_stops_on_deleted_legacy_variants:
                    metrics.route_stops_on_deleted_legacy_variants,
                soft_deleted_legacy_routes: metrics.soft_deleted_legacy_routes,
                orphan_stops: metrics.orphan_stops,
            },
            orphan_stops: metrics.orphan_stops,
            systematic_routes_remaining: systematicRoutes,
            legacy_routes_remaining: legacyRoutes,
            systematic_routes_soft_deleted: metrics.systematic_routes_soft_deleted_rows,
            dashboard_expectations: dashboard,
            blockers,
            warnings,
            report_json_path: "",
            report_md_path: "",
        };

        await client.query("commit");

        const jsonPath = writeJsonReport(
            `${options.reportDir}/legacy-route-cleanup-validation.json`,
            report,
        );
        const mdPath = writeMarkdownReport(
            `${options.reportDir}/legacy-route-cleanup-validation.md`,
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
    const report = await validateLegacyRouteCleanup({
        reportDir: args.reportDir,
        expectZero: args.expectZero,
    });

    console.log(`Phase D1 validation: ${report.result}`);
    console.log(`DB writes: ${report.db_writes}`);
    console.log(`Active legacy routes: ${report.summary.active_legacy_bus_routes}`);
    console.log(`Systematic routes: ${report.summary.systematic_routes_active}`);
    console.log(`Blockers: ${report.summary.blocker_count}`);
    console.log(`Next: ${report.next_recommended_action}`);
    console.log(`Report: ${report.report_json_path}`);

    if (report.result === "FAIL") process.exit(1);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("validate-legacy-route-cleanup.ts") ||
        process.argv[1].endsWith("validate-legacy-route-cleanup.js"));

if (isMain) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
