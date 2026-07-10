#!/usr/bin/env npx tsx
/**
 * Safe cleanup for test YBS route imports (dry-run by default).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import {
    isProtectedReviewStatus,
    routeExternalId,
} from "../lib/supabase-schema-map.js";
import { YBS_SOURCE_KIND, YBS_SOURCE_NAME } from "../lib/source-link-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");

const DEFAULT_ALLOWED_STATUSES = ["imported_unreviewed", "needs_review"] as const;
const ORPHAN_ALLOWED_STATUSES = new Set([
    "imported_unreviewed",
    "needs_review",
    "rejected",
]);

type CleanupMode = "dry_run" | "execute";

type RouteRow = {
    id: number;
    route_code: string;
    review_status: string | null;
    is_active: boolean | null;
    operator_id: number | null;
};

type StopCleanupAction =
    | "deleted"
    | "deactivated"
    | "kept_shared"
    | "kept_protected"
    | "kept_terminal_linked";

type StopCleanupRow = {
    stop_id: number;
    review_status: string | null;
    has_ybs_source_link: boolean;
    other_route_stop_refs: number;
    terminal_link_count: number;
    action: StopCleanupAction;
    reason: string;
};

type OrphanStopAction =
    | "deleted"
    | "soft_deleted"
    | "skipped_still_used"
    | "skipped_protected"
    | "skipped_terminal_linked"
    | "skipped_parent_linked"
    | "skipped_not_test_stop"
    | "skipped_infrastructure";

type OrphanStopRow = {
    stop_id: number;
    review_status: string | null;
    is_active: boolean | null;
    route_stop_refs: number;
    terminal_link_count: number;
    parent_child_count: number;
    external_ids: string[];
    action: OrphanStopAction;
    reason: string;
};

type SharedStopCleanupRow = {
    stop_id: number;
    review_status: string | null;
    is_active: boolean | null;
    route_stop_refs: number;
    action: "cleared_shared_metadata" | "skipped_protected";
    reason: string;
};

type SuspectedTestStopRow = {
    stop_id: number;
    review_status: string | null;
    is_active: boolean | null;
    route_stop_refs: number;
    reason: string;
};

type CleanupReport = {
    generated_at: string;
    mode: CleanupMode;
    status: "passed" | "refused" | "failed";
    route_code: string;
    cleanup_orphan_stops: boolean;
    soft_delete_stops: boolean;
    refusal_reason?: string;
    error?: string;
    route_existed_before_cleanup: boolean;
    route?: {
        id: number;
        review_status: string | null;
        is_active: boolean | null;
        has_ybs_route_source_link: boolean;
        ybs_route_external_id: string;
    };
    allowed_review_statuses: string[];
    counts: {
        source_links: number;
        route_stops: number;
        route_paths: number;
        route_variants: number;
        fares: number;
        route_names: number;
        service_notes: number;
        terminals_unlinked: number;
        route_variant_stop_refs_cleared: number;
        parent_stop_refs_cleared: number;
        stops_deleted: number;
        stops_deactivated: number;
        stops_kept: number;
        routes: number;
        orphan_stops_found: number;
        orphan_stops_deleted: number;
        orphan_stops_soft_deleted: number;
        orphan_stops_skipped_still_used: number;
        orphan_stops_skipped_protected: number;
        orphan_source_links_deleted: number;
        stop_names_deleted: number;
        shared_stops_metadata_cleared: number;
        shared_stops_reactivated: number;
    };
    entity_ids: {
        route_id: number | null;
        route_variant_ids: number[];
        route_stop_ids: number[];
        route_path_ids: number[];
        fare_ids: number[];
        source_link_ids: number[];
        stop_ids_considered: number[];
        orphan_stop_ids_deleted: number[];
        orphan_stop_ids_soft_deleted: number[];
        orphan_source_link_ids: number[];
        shared_stop_ids_cleared: number[];
    };
    stops: StopCleanupRow[];
    orphan_stops: OrphanStopRow[];
    shared_stops: SharedStopCleanupRow[];
    remaining_suspected_test_stops: SuspectedTestStopRow[];
    executed: boolean;
    report_json_path: string;
    report_md_path: string;
};

function loadEnv(): void {
    loadDotenv({ path: join(REPO_ROOT, ".env") });
    loadDotenv({ path: join(REPO_ROOT, "apps/api/.env") });
}

function getDatabaseUrl(): string {
    const url =
        process.env.SUPABASE_DB_URL ??
        process.env.DATABASE_URL ??
        process.env.DIRECT_URL;
    if (!url) {
        throw new Error(
            "Missing database URL. Set SUPABASE_DB_URL, DATABASE_URL, or DIRECT_URL.",
        );
    }
    return url;
}

function parseArgs(argv: string[]): {
    routeCode: string;
    requireStatuses: string[];
    execute: boolean;
    runRoot: string;
    cleanupOrphanStops: boolean;
    softDeleteStops: boolean;
    allowNonYbsRoute: boolean;
} {
    let routeCode = "";
    const requireStatuses: string[] = [];
    let execute = false;
    let runRoot = join(REPO_ROOT, "tmp/transport-imports/ybs-flow-test-ybs1-ybs2");
    let cleanupOrphanStops = false;
    let softDeleteStops = false;
    let allowNonYbsRoute = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--route-code" && argv[i + 1]) {
            routeCode = argv[++i]!.trim().toUpperCase();
        } else if (arg === "--require-status" && argv[i + 1]) {
            requireStatuses.push(argv[++i]!.trim());
        } else if (arg === "--run" && argv[i + 1]) {
            runRoot = argv[++i]!.startsWith("/")
                ? argv[i]!
                : join(REPO_ROOT, argv[i]!);
        } else if (arg === "--run-root" && argv[i + 1]) {
            runRoot = argv[++i]!.startsWith("/")
                ? argv[i]!
                : join(REPO_ROOT, argv[i]!);
        } else if (arg === "--dry-run") {
            execute = false;
        } else if (arg === "--execute") {
            execute = true;
        } else if (arg === "--cleanup-orphan-stops") {
            cleanupOrphanStops = true;
        } else if (arg === "--soft-delete-stops") {
            softDeleteStops = true;
        } else if (arg === "--allow-non-ybs-route") {
            allowNonYbsRoute = true;
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    if (!routeCode) {
        printHelp();
        throw new Error("Missing required --route-code");
    }

    const allowed =
        requireStatuses.length > 0 ? requireStatuses : [...DEFAULT_ALLOWED_STATUSES];

    return {
        routeCode,
        requireStatuses: allowed,
        execute,
        runRoot,
        cleanupOrphanStops,
        softDeleteStops,
        allowNonYbsRoute,
    };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup/cleanup-test-ybs-route.ts \\
    --route-code YBS-2 \\
    [--require-status imported_unreviewed] \\
    [--cleanup-orphan-stops] \\
    [--soft-delete-stops] \\
    [--run tmp/transport-imports/ybs-flow-test-ybs1-ybs2] \\
    [--run-root <same as --run>] \\
    [--dry-run] \\
    [--allow-non-ybs-route] \\
    [--execute]

Modes:
  Default: dry-run (no DB writes). Use --execute to apply deletes.
  --dry-run: explicit alias for default dry-run mode.
  --allow-non-ybs-route: required for Phase B cleanup of pre-existing non-YBS routes.
  --cleanup-orphan-stops: also remove orphan YBS test stops after route cleanup.
    Works when route is already deleted. Writes reports to <run>/reports/cleanup-<route>.json.
`);
}

function emptyCounts(): CleanupReport["counts"] {
    return {
        source_links: 0,
        route_stops: 0,
        route_paths: 0,
        route_variants: 0,
        fares: 0,
        route_names: 0,
        service_notes: 0,
        terminals_unlinked: 0,
        route_variant_stop_refs_cleared: 0,
        parent_stop_refs_cleared: 0,
        stops_deleted: 0,
        stops_deactivated: 0,
        stops_kept: 0,
        routes: 0,
        orphan_stops_found: 0,
        orphan_stops_deleted: 0,
        orphan_stops_soft_deleted: 0,
        orphan_stops_skipped_still_used: 0,
        orphan_stops_skipped_protected: 0,
        orphan_source_links_deleted: 0,
        stop_names_deleted: 0,
        shared_stops_metadata_cleared: 0,
        shared_stops_reactivated: 0,
    };
}

function renderMarkdown(report: CleanupReport): string {
    const lines = [
        `# YBS test route cleanup — ${report.route_code}`,
        "",
        `- Generated: ${report.generated_at}`,
        `- Mode: ${report.mode}`,
        `- Status: **${report.status}**`,
        `- Executed: ${report.executed ? "yes" : "no"}`,
        `- Route existed before cleanup: ${report.route_existed_before_cleanup}`,
        `- Cleanup orphan stops: ${report.cleanup_orphan_stops}`,
        `- Soft delete stops: ${report.soft_delete_stops}`,
    ];

    if (report.refusal_reason) lines.push(`- Refusal: ${report.refusal_reason}`);
    if (report.error) lines.push(`- Error: ${report.error}`);

    lines.push(
        "",
        "## Route tree deletes",
        "",
        `| Entity | Count |`,
        `| --- | ---: |`,
        `| routes | ${report.counts.routes} |`,
        `| route_variants | ${report.counts.route_variants} |`,
        `| route_stops | ${report.counts.route_stops} |`,
        `| route_paths | ${report.counts.route_paths} |`,
        `| source_links | ${report.counts.source_links} |`,
        `| fares | ${report.counts.fares} |`,
        `| route_names | ${report.counts.route_names} |`,
        `| route stops deleted | ${report.counts.stops_deleted} |`,
        `| route stops deactivated | ${report.counts.stops_deactivated} |`,
        "",
        "## Orphan stop cleanup",
        "",
        `| Metric | Count |`,
        `| --- | ---: |`,
        `| orphan stops found | ${report.counts.orphan_stops_found} |`,
        `| orphan stops deleted | ${report.counts.orphan_stops_deleted} |`,
        `| orphan stops soft deleted | ${report.counts.orphan_stops_soft_deleted} |`,
        `| skipped (still used) | ${report.counts.orphan_stops_skipped_still_used} |`,
        `| skipped (protected) | ${report.counts.orphan_stops_skipped_protected} |`,
        `| orphan source_links deleted | ${report.counts.orphan_source_links_deleted} |`,
        `| stop_names deleted | ${report.counts.stop_names_deleted} |`,
        `| shared stops metadata cleared | ${report.counts.shared_stops_metadata_cleared} |`,
        `| shared stops reactivated | ${report.counts.shared_stops_reactivated} |`,
    );

    if (report.orphan_stops.length > 0) {
        lines.push("", "### Orphan stop actions", "");
        for (const stop of report.orphan_stops) {
            lines.push(
                `- stop ${stop.stop_id}: **${stop.action}** — ${stop.reason} (route_stops=${stop.route_stop_refs}, terminals=${stop.terminal_link_count})`,
            );
        }
    }

    if (report.remaining_suspected_test_stops.length > 0) {
        lines.push("", "## Remaining suspected test stops", "");
        for (const stop of report.remaining_suspected_test_stops) {
            lines.push(
                `- stop ${stop.stop_id} (${stop.review_status ?? "null"}, active=${stop.is_active ?? "null"}, route_stops=${stop.route_stop_refs}): ${stop.reason}`,
            );
        }
    }

    return `${lines.join("\n")}\n`;
}

function writeReport(report: CleanupReport, runRoot: string): CleanupReport {
    const reportsDir = join(runRoot, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const reportJsonPath = join(reportsDir, `cleanup-${report.route_code}.json`);
    const reportMdPath = join(reportsDir, `cleanup-${report.route_code}.md`);
    const finalReport = {
        ...report,
        report_json_path: reportJsonPath,
        report_md_path: reportMdPath,
    };
    writeFileSync(reportJsonPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    writeFileSync(reportMdPath, renderMarkdown(finalReport), "utf8");
    return finalReport;
}

type RunStopHints = {
    new_stop_ids: number[];
    candidate_ids: string[];
};

function loadRunStopHints(runRoot: string, routeCode: string): RunStopHints {
    const paths = [
        join(runRoot, "db-prep/routes-with-geometry.json"),
        join(runRoot, "phase7-geometry/routes-with-geometry.json"),
    ];
    const newStopIds = new Set<number>();
    const candidateIds = new Set<string>();

    for (const filePath of paths) {
        if (!existsSync(filePath)) continue;
        try {
            const payload = JSON.parse(readFileSync(filePath, "utf8")) as {
                resolved_stops?: Array<{
                    candidate_id?: string;
                    matched_stop_id?: number | null;
                    stop_ref?: string;
                    resolution_decision?: string;
                }>;
                route_stops?: Array<{ route_code?: string; candidate_id?: string }>;
            };
            for (const stop of payload.resolved_stops ?? []) {
                if (stop.candidate_id) candidateIds.add(stop.candidate_id);
                const isNew =
                    stop.stop_ref?.startsWith("new:") ||
                    stop.resolution_decision === "create_new_stop";
                if (isNew && stop.matched_stop_id) {
                    newStopIds.add(stop.matched_stop_id);
                }
            }
            for (const link of payload.route_stops ?? []) {
                if (link.route_code?.toUpperCase() === routeCode && link.candidate_id) {
                    candidateIds.add(link.candidate_id);
                }
            }
        } catch {
            // ignore malformed hint files
        }
    }

    return {
        new_stop_ids: [...newStopIds],
        candidate_ids: [...candidateIds],
    };
}

async function loadRoute(client: pg.Client, routeCode: string): Promise<RouteRow | null> {
    const result = await client.query<RouteRow>(
        `select id, route_code, review_status, is_active, operator_id
         from transport.routes
         where upper(route_code) = upper($1)
           and deleted_at is null
         limit 1`,
        [routeCode],
    );
    return result.rows[0] ?? null;
}

async function hasYbsRouteSourceLink(
    client: pg.Client,
    routeId: number,
    externalId: string,
): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(
        `select exists (
            select 1 from transport.source_links sl
            where sl.entity_type = 'route'
              and sl.entity_id = $1
              and sl.source_name = $2
              and sl.source_kind = $3
              and sl.external_id = $4
         ) as exists`,
        [routeId, YBS_SOURCE_NAME, YBS_SOURCE_KIND, externalId],
    );
    return result.rows[0]?.exists ?? false;
}

async function collectRouteScope(client: pg.Client, routeId: number) {
    const variants = await client.query<{ id: number }>(
        `select id from transport.route_variants where route_id = $1`,
        [routeId],
    );
    const variantIds = variants.rows.map((r) => r.id);

    const routeStops =
        variantIds.length === 0
            ? { rows: [] as { id: number; stop_id: number }[] }
            : await client.query<{ id: number; stop_id: number }>(
                  `select id, stop_id from transport.route_stops
                   where route_variant_id = any($1::bigint[])`,
                  [variantIds],
              );

    const routePaths =
        variantIds.length === 0
            ? { rows: [] as { id: number }[] }
            : await client.query<{ id: number }>(
                  `select id from transport.route_paths
                   where route_variant_id = any($1::bigint[])`,
                  [variantIds],
              );

    const fares = await client.query<{ id: number }>(
        `select id from transport.fares
         where route_id = $1 or route_variant_id = any($2::bigint[])`,
        [routeId, variantIds.length > 0 ? variantIds : [0]],
    );

    const routeNames = await client.query<{ id: number }>(
        `select id from transport.route_names where route_id = $1`,
        [routeId],
    );

    const serviceNotes = await client.query<{ id: number }>(
        `select id from transport.service_notes
         where route_id = $1 or route_variant_id = any($2::bigint[])`,
        [routeId, variantIds.length > 0 ? variantIds : [0]],
    );

    const routeStopIds = routeStops.rows.map((r) => r.id);
    const routePathIds = routePaths.rows.map((r) => r.id);
    const fareIds = fares.rows.map((r) => r.id);
    const stopIds = [...new Set(routeStops.rows.map((r) => r.stop_id))];

    const sourceLinks = await client.query<{ id: number }>(
        `select id from transport.source_links
         where (entity_type = 'route' and entity_id = $1)
            or (entity_type = 'route_variant' and entity_id = any($2::bigint[]))
            or (entity_type = 'route_stop' and entity_id = any($3::bigint[]))
            or (entity_type = 'route_path' and entity_id = any($4::bigint[]))
            or (entity_type = 'fare' and entity_id = any($5::bigint[]))
            or (entity_type = 'stop' and entity_id = any($6::bigint[]))`,
        [routeId, variantIds, routeStopIds, routePathIds, fareIds, stopIds],
    );

    return {
        variantIds,
        routeStopIds,
        routePathIds,
        fareIds,
        routeNameCount: routeNames.rowCount ?? routeNames.rows.length,
        serviceNoteIds: serviceNotes.rows.map((r) => r.id),
        stopIds,
        sourceLinkIds: sourceLinks.rows.map((r) => r.id),
    };
}

async function planStopCleanup(
    client: pg.Client,
    stopIds: number[],
    variantIds: number[],
): Promise<StopCleanupRow[]> {
    if (stopIds.length === 0) return [];

    const stops = await client.query<{ id: number; review_status: string | null }>(
        `select id, review_status from transport.stops
         where id = any($1::bigint[]) and deleted_at is null`,
        [stopIds],
    );

    const ybsLinks = await client.query<{ entity_id: number }>(
        `select distinct entity_id from transport.source_links
         where entity_type = 'stop' and entity_id = any($1::bigint[])
           and source_name = $2 and source_kind = $3`,
        [stopIds, YBS_SOURCE_NAME, YBS_SOURCE_KIND],
    );
    const ybsStopIds = new Set(ybsLinks.rows.map((r) => r.entity_id));

    const otherRefs = await client.query<{ stop_id: number; ref_count: number }>(
        `select rs.stop_id, count(*)::int as ref_count
         from transport.route_stops rs
         where rs.stop_id = any($1::bigint[])
           and rs.route_variant_id <> all($2::bigint[])
         group by rs.stop_id`,
        [stopIds, variantIds.length > 0 ? variantIds : [0]],
    );
    const otherRefByStop = new Map(otherRefs.rows.map((r) => [r.stop_id, r.ref_count]));

    const terminalRefs = await client.query<{ linked_stop_id: number; ref_count: number }>(
        `select linked_stop_id, count(*)::int as ref_count
         from transport.terminals
         where linked_stop_id = any($1::bigint[]) and deleted_at is null
         group by linked_stop_id`,
        [stopIds],
    );
    const terminalRefByStop = new Map(
        terminalRefs.rows.map((r) => [r.linked_stop_id, r.ref_count]),
    );

    return stops.rows.map((stop) => {
        const hasYbs = ybsStopIds.has(stop.id);
        const otherRouteStopRefs = otherRefByStop.get(stop.id) ?? 0;
        const terminalLinkCount = terminalRefByStop.get(stop.id) ?? 0;

        if (isProtectedReviewStatus(stop.review_status)) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                has_ybs_source_link: hasYbs,
                other_route_stop_refs: otherRouteStopRefs,
                terminal_link_count: terminalLinkCount,
                action: "kept_protected" as const,
                reason: `stop review_status=${stop.review_status ?? "null"} is protected`,
            };
        }
        if (!hasYbs) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                has_ybs_source_link: false,
                other_route_stop_refs: otherRouteStopRefs,
                terminal_link_count: terminalLinkCount,
                action: "kept_shared" as const,
                reason: "no YBS import source_link — shared or pre-existing stop",
            };
        }
        if (otherRouteStopRefs > 0) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                has_ybs_source_link: true,
                other_route_stop_refs: otherRouteStopRefs,
                terminal_link_count: terminalLinkCount,
                action: "deactivated" as const,
                reason: "YBS-imported stop still referenced by other routes — deactivate only",
            };
        }
        return {
            stop_id: stop.id,
            review_status: stop.review_status,
            has_ybs_source_link: true,
            other_route_stop_refs: 0,
            terminal_link_count: terminalLinkCount,
            action: "deleted" as const,
            reason:
                terminalLinkCount > 0
                    ? "YBS-imported stop; terminal links will be cleared before delete"
                    : "YBS-imported stop with no other route_stops references",
        };
    });
}

async function detachStopForeignReferences(
    client: pg.Client,
    stopIds: number[],
    variantIds: number[],
): Promise<{
    terminals_unlinked: number;
    route_variant_stop_refs_cleared: number;
    parent_stop_refs_cleared: number;
}> {
    if (stopIds.length === 0) {
        return {
            terminals_unlinked: 0,
            route_variant_stop_refs_cleared: 0,
            parent_stop_refs_cleared: 0,
        };
    }

    const terminals = await client.query(
        `update transport.terminals
         set linked_stop_id = null, updated_at = now()
         where linked_stop_id = any($1::bigint[]) and deleted_at is null`,
        [stopIds],
    );
    const variantRefs = await client.query(
        `update transport.route_variants
         set origin_stop_id = case when origin_stop_id = any($1::bigint[]) then null else origin_stop_id end,
             destination_stop_id = case when destination_stop_id = any($1::bigint[]) then null else destination_stop_id end,
             updated_at = now()
         where (origin_stop_id = any($1::bigint[]) or destination_stop_id = any($1::bigint[]))
           and id <> all($2::bigint[])`,
        [stopIds, variantIds.length > 0 ? variantIds : [0]],
    );
    const parentRefs = await client.query(
        `update transport.stops
         set parent_stop_id = null, updated_at = now()
         where parent_stop_id = any($1::bigint[]) and deleted_at is null`,
        [stopIds],
    );

    return {
        terminals_unlinked: terminals.rowCount ?? 0,
        route_variant_stop_refs_cleared: variantRefs.rowCount ?? 0,
        parent_stop_refs_cleared: parentRefs.rowCount ?? 0,
    };
}

async function executeRouteCleanup(
    client: pg.Client,
    routeId: number,
    scope: Awaited<ReturnType<typeof collectRouteScope>>,
    stopPlan: StopCleanupRow[],
): Promise<{
    terminals_unlinked: number;
    route_variant_stop_refs_cleared: number;
    parent_stop_refs_cleared: number;
}> {
    if (scope.sourceLinkIds.length > 0) {
        await client.query(`delete from transport.source_links where id = any($1::bigint[])`, [
            scope.sourceLinkIds,
        ]);
    }
    if (scope.routeStopIds.length > 0) {
        await client.query(`delete from transport.route_stops where id = any($1::bigint[])`, [
            scope.routeStopIds,
        ]);
    }
    if (scope.routePathIds.length > 0) {
        await client.query(`delete from transport.route_paths where id = any($1::bigint[])`, [
            scope.routePathIds,
        ]);
    }
    if (scope.variantIds.length > 0) {
        await client.query(
            `update transport.route_variants
             set origin_stop_id = null, destination_stop_id = null, updated_at = now()
             where id = any($1::bigint[])`,
            [scope.variantIds],
        );
        await client.query(`delete from transport.route_variants where id = any($1::bigint[])`, [
            scope.variantIds,
        ]);
    }
    if (scope.fareIds.length > 0) {
        await client.query(`delete from transport.fares where id = any($1::bigint[])`, [
            scope.fareIds,
        ]);
    }
    await client.query(`delete from transport.route_names where route_id = $1`, [routeId]);
    if (scope.serviceNoteIds.length > 0) {
        await client.query(`delete from transport.service_notes where id = any($1::bigint[])`, [
            scope.serviceNoteIds,
        ]);
    }

    const stopsToDelete = stopPlan.filter((s) => s.action === "deleted").map((s) => s.stop_id);
    const stopsToDeactivate = stopPlan
        .filter((s) => s.action === "deactivated")
        .map((s) => s.stop_id);

    const detachCounts = await detachStopForeignReferences(
        client,
        stopsToDelete,
        scope.variantIds,
    );

    if (stopsToDelete.length > 0) {
        await client.query(
            `delete from transport.source_links
             where entity_type = 'stop' and entity_id = any($1::bigint[])`,
            [stopsToDelete],
        );
        await client.query(`delete from transport.stop_names where stop_id = any($1::bigint[])`, [
            stopsToDelete,
        ]);
        await client.query(`delete from transport.stops where id = any($1::bigint[])`, [
            stopsToDelete,
        ]);
    }
    if (stopsToDeactivate.length > 0) {
        await client.query(
            `update transport.stops
             set is_active = false, review_status = 'rejected', updated_at = now()
             where id = any($1::bigint[])`,
            [stopsToDeactivate],
        );
    }

    await client.query(
        `delete from transport.source_links where entity_type = 'route' and entity_id = $1`,
        [routeId],
    );
    await client.query(`delete from transport.routes where id = $1`, [routeId]);

    return detachCounts;
}

type OrphanCandidateRow = {
    id: number;
    review_status: string | null;
    is_active: boolean | null;
    route_stop_refs: number;
    terminal_link_count: number;
    parent_child_count: number;
    has_ybs_stop_link: boolean;
    has_route_scoped_metadata: boolean;
    has_new_import_hint: boolean;
    external_ids: string[];
};

async function findOrphanCandidateStops(
    client: pg.Client,
    routeCode: string,
    hints: RunStopHints,
): Promise<OrphanCandidateRow[]> {
    const variantPrefix = `${routeCode}-`;
    const routeStopPrefix = `route_stop:ybs_go:${routeCode}:`;

    const result = await client.query<{
        id: string;
        review_status: string | null;
        is_active: boolean | null;
        route_stop_refs: number;
        terminal_link_count: number;
        parent_child_count: number;
        has_ybs_stop_link: boolean;
        has_route_scoped_metadata: boolean;
        has_new_import_hint: boolean;
        external_ids: string[] | null;
    }>(
        `
        with hint_stop_ids as (
            select unnest($3::bigint[]) as stop_id
        ),
        hint_candidates as (
            select unnest($4::text[]) as candidate_id
        ),
        route_scoped_stop_links as (
            select distinct sl.entity_id as stop_id
            from transport.source_links sl
            where sl.entity_type = 'stop'
              and sl.source_name = $1
              and sl.source_kind = $2
              and sl.external_id like 'stop:ybs_go:%'
        ),
        route_scoped_metadata as (
            select s.id as stop_id
            from transport.stops s
            where s.deleted_at is null
              and coalesce(s.normalized_data->'ybs_go'->>'variant_code', '') like $5
        ),
        route_scoped_orphans as (
            select stop_id from route_scoped_stop_links
            union
            select stop_id from route_scoped_metadata
            union
            select stop_id from hint_stop_ids
            union
            select s.id as stop_id
            from transport.stops s
            join transport.source_links sl
              on sl.entity_type = 'stop'
             and sl.entity_id = s.id
             and sl.source_name = $1
             and sl.external_id like 'stop:ybs_go:%'
            join hint_candidates hc
              on sl.external_id like '%' || hc.candidate_id || '%'
            where s.deleted_at is null
        )
        select
            s.id::text as id,
            s.review_status,
            s.is_active,
            coalesce(rs.route_stop_refs, 0)::int as route_stop_refs,
            coalesce(t.terminal_link_count, 0)::int as terminal_link_count,
            coalesce(p.parent_child_count, 0)::int as parent_child_count,
            exists (
                select 1 from transport.source_links sl
                where sl.entity_type = 'stop'
                  and sl.entity_id = s.id
                  and sl.source_name = $1
                  and sl.source_kind = $2
                  and sl.external_id like 'stop:ybs_go:%'
            ) as has_ybs_stop_link,
            coalesce(s.normalized_data->'ybs_go'->>'variant_code', '') like $5 as has_route_scoped_metadata,
            exists (select 1 from hint_stop_ids h where h.stop_id = s.id) as has_new_import_hint,
            (
                select array_agg(distinct sl.external_id order by sl.external_id)
                from transport.source_links sl
                where sl.entity_type = 'stop' and sl.entity_id = s.id
            ) as external_ids
        from transport.stops s
        join route_scoped_orphans rso on rso.stop_id = s.id
        left join lateral (
            select count(*)::int as route_stop_refs
            from transport.route_stops rs
            where rs.stop_id = s.id
        ) rs on true
        left join lateral (
            select count(*)::int as terminal_link_count
            from transport.terminals t
            where t.linked_stop_id = s.id and t.deleted_at is null
        ) t on true
        left join lateral (
            select count(*)::int as parent_child_count
            from transport.stops child
            where child.parent_stop_id = s.id and child.deleted_at is null
        ) p on true
        where s.deleted_at is null
        order by s.id
        `,
        [
            YBS_SOURCE_NAME,
            YBS_SOURCE_KIND,
            hints.new_stop_ids.length > 0 ? hints.new_stop_ids : [0],
            hints.candidate_ids.length > 0 ? hints.candidate_ids : [""],
            `${variantPrefix}%`,
        ],
    );

    return result.rows.map((row) => ({
        id: Number(row.id),
        review_status: row.review_status,
        is_active: row.is_active,
        route_stop_refs: row.route_stop_refs,
        terminal_link_count: row.terminal_link_count,
        parent_child_count: row.parent_child_count,
        has_ybs_stop_link: row.has_ybs_stop_link,
        has_route_scoped_metadata: row.has_route_scoped_metadata,
        has_new_import_hint: row.has_new_import_hint,
        external_ids: row.external_ids ?? [],
    }));
}

function planOrphanStopCleanup(
    candidates: OrphanCandidateRow[],
    softDeleteStops: boolean,
): OrphanStopRow[] {
    return candidates.map((stop) => {
        const isTestStop =
            stop.has_ybs_stop_link ||
            stop.has_route_scoped_metadata ||
            (stop.has_new_import_hint &&
                (stop.external_ids.some((id) => id.startsWith("stop:ybs_go:")) ||
                    stop.review_status === "needs_review"));

        if (!isTestStop) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "skipped_not_test_stop",
                reason: "stop is not linked to this YBS test import",
            };
        }
        if (isProtectedReviewStatus(stop.review_status)) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "skipped_protected",
                reason: `protected review_status=${stop.review_status ?? "null"}`,
            };
        }
        if (!ORPHAN_ALLOWED_STATUSES.has(stop.review_status ?? "")) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "skipped_not_test_stop",
                reason: `review_status=${stop.review_status ?? "null"} is outside orphan cleanup allowlist`,
            };
        }
        if (stop.route_stop_refs > 0) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "skipped_still_used",
                reason: "stop is still referenced by route_stops",
            };
        }
        if (stop.terminal_link_count > 0) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "skipped_terminal_linked",
                reason: "stop is linked to transport.terminals",
            };
        }
        if (stop.parent_child_count > 0) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "skipped_parent_linked",
                reason: "another stop uses this stop as parent_stop_id",
            };
        }
        if (softDeleteStops) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                terminal_link_count: stop.terminal_link_count,
                parent_child_count: stop.parent_child_count,
                external_ids: stop.external_ids,
                action: "soft_deleted",
                reason: "orphan YBS test stop soft-deleted",
            };
        }
        return {
            stop_id: stop.id,
            review_status: stop.review_status,
            is_active: stop.is_active,
            route_stop_refs: stop.route_stop_refs,
            terminal_link_count: stop.terminal_link_count,
            parent_child_count: stop.parent_child_count,
            external_ids: stop.external_ids,
            action: "deleted",
            reason: "orphan YBS test stop hard-deleted",
        };
    });
}

async function collectOrphanSourceLinkIds(
    client: pg.Client,
    routeCode: string,
    stopIds: number[],
): Promise<number[]> {
    const routeStopPrefix = `route_stop:ybs_go:${routeCode}:`;
    const result = await client.query<{ id: number }>(
        `select id from transport.source_links
         where (
             entity_type = 'stop' and entity_id = any($1::bigint[])
         ) or (
             entity_type = 'route_stop' and external_id like $2
         )`,
        [stopIds.length > 0 ? stopIds : [0], `${routeStopPrefix}%`],
    );
    return result.rows.map((r) => r.id);
}

async function findSharedStopsWithRouteMetadata(
    client: pg.Client,
    routeCode: string,
): Promise<
    Array<{
        id: number;
        review_status: string | null;
        is_active: boolean | null;
        route_stop_refs: number;
    }>
> {
    const variantPrefix = `${routeCode}-`;
    const result = await client.query<{
        id: string;
        review_status: string | null;
        is_active: boolean | null;
        route_stop_refs: number;
    }>(
        `
        select
            s.id::text as id,
            s.review_status,
            s.is_active,
            coalesce((select count(*)::int from transport.route_stops rs where rs.stop_id = s.id), 0) as route_stop_refs
        from transport.stops s
        where s.deleted_at is null
          and coalesce(s.normalized_data->'ybs_go'->>'variant_code', '') like $1
          and exists (select 1 from transport.route_stops rs where rs.stop_id = s.id)
        order by s.id
        `,
        [`${variantPrefix}%`],
    );

    return result.rows.map((row) => ({
        id: Number(row.id),
        review_status: row.review_status,
        is_active: row.is_active,
        route_stop_refs: row.route_stop_refs,
    }));
}

function planSharedStopMetadataCleanup(
    stops: Awaited<ReturnType<typeof findSharedStopsWithRouteMetadata>>,
): SharedStopCleanupRow[] {
    return stops.map((stop) => {
        if (isProtectedReviewStatus(stop.review_status)) {
            return {
                stop_id: stop.id,
                review_status: stop.review_status,
                is_active: stop.is_active,
                route_stop_refs: stop.route_stop_refs,
                action: "skipped_protected",
                reason: `protected review_status=${stop.review_status ?? "null"}`,
            };
        }

        return {
            stop_id: stop.id,
            review_status: stop.review_status,
            is_active: stop.is_active,
            route_stop_refs: stop.route_stop_refs,
            action: "cleared_shared_metadata",
            reason: "clear YBS route metadata from shared stop; reactivate if rejected by test cleanup",
        };
    });
}

async function executeSharedStopMetadataCleanup(
    client: pg.Client,
    plan: SharedStopCleanupRow[],
): Promise<{ metadata_cleared: number; reactivated: number }> {
    const stopIds = plan
        .filter((row) => row.action === "cleared_shared_metadata")
        .map((row) => row.stop_id);
    if (stopIds.length === 0) {
        return { metadata_cleared: 0, reactivated: 0 };
    }

    const result = await client.query<{ reactivated: number }>(
        `
        with updated as (
            update transport.stops
            set normalized_data = (
                    coalesce(normalized_data, '{}'::jsonb)
                    - 'ybs_go'
                    - 'review_geometry'
                ) || jsonb_build_object('cleanup_note', 'shared_stop_ybs_test_metadata_cleared'),
                is_active = true,
                review_status = case
                    when review_status = 'rejected' then 'imported_unreviewed'
                    else review_status
                end,
                updated_at = now()
            where id = any($1::bigint[])
            returning id, review_status
        )
        select count(*)::int as reactivated from updated
        `,
        [stopIds],
    );

    return {
        metadata_cleared: stopIds.length,
        reactivated: result.rows[0]?.reactivated ?? stopIds.length,
    };
}

async function findRemainingSuspectedTestStops(
    client: pg.Client,
    routeCode: string,
): Promise<SuspectedTestStopRow[]> {
    const variantPrefix = `${routeCode}-`;
    const result = await client.query<{
        id: string;
        review_status: string | null;
        is_active: boolean | null;
        route_stop_refs: number;
        reason: string;
    }>(
        `
        select
            s.id::text as id,
            s.review_status,
            s.is_active,
            coalesce((select count(*)::int from transport.route_stops rs where rs.stop_id = s.id), 0) as route_stop_refs,
            case
                when coalesce((select count(*)::int from transport.route_stops rs where rs.stop_id = s.id), 0) > 0
                    then 'still referenced by route_stops on another route'
                when s.review_status = 'rejected' and s.is_active = false
                    then 'shared stop deactivated during route cleanup'
                else 'route-scoped YBS metadata remains'
            end as reason
        from transport.stops s
        where s.deleted_at is null
          and (
              coalesce(s.normalized_data->'ybs_go'->>'variant_code', '') like $1
              or exists (
                  select 1 from transport.source_links sl
                  where sl.entity_type = 'stop'
                    and sl.entity_id = s.id
                    and sl.source_name = $2
                    and sl.external_id like 'stop:ybs_go:%'
              )
          )
        order by s.id
        `,
        [`${variantPrefix}%`, YBS_SOURCE_NAME],
    );

    return result.rows.map((row) => ({
        stop_id: Number(row.id),
        review_status: row.review_status,
        is_active: row.is_active,
        route_stop_refs: row.route_stop_refs,
        reason: row.reason,
    }));
}

async function executeOrphanStopCleanup(
    client: pg.Client,
    routeCode: string,
    orphanPlan: OrphanStopRow[],
): Promise<{ orphan_source_links_deleted: number; stop_names_deleted: number }> {
    const stopIdsToDelete = orphanPlan
        .filter((row) => row.action === "deleted")
        .map((row) => row.stop_id);
    const stopIdsToSoftDelete = orphanPlan
        .filter((row) => row.action === "soft_deleted")
        .map((row) => row.stop_id);

    const orphanSourceLinkIds = await collectOrphanSourceLinkIds(
        client,
        routeCode,
        [...stopIdsToDelete, ...stopIdsToSoftDelete],
    );

    if (orphanSourceLinkIds.length > 0) {
        await client.query(`delete from transport.source_links where id = any($1::bigint[])`, [
            orphanSourceLinkIds,
        ]);
    }

    if (stopIdsToDelete.length > 0) {
        await detachStopForeignReferences(client, stopIdsToDelete, []);
        await client.query(
            `delete from transport.source_links
             where entity_type = 'stop' and entity_id = any($1::bigint[])`,
            [stopIdsToDelete],
        );
        const stopNames = await client.query(
            `delete from transport.stop_names where stop_id = any($1::bigint[])`,
            [stopIdsToDelete],
        );
        await client.query(`delete from transport.stops where id = any($1::bigint[])`, [
            stopIdsToDelete,
        ]);
        return {
            orphan_source_links_deleted: orphanSourceLinkIds.length,
            stop_names_deleted: stopNames.rowCount ?? 0,
        };
    }

    if (stopIdsToSoftDelete.length > 0) {
        await client.query(
            `update transport.stops
             set is_active = false,
                 review_status = 'rejected',
                 normalized_data = coalesce(normalized_data, '{}'::jsonb)
                     || jsonb_build_object('cleanup_note', 'orphan_ybs_test_stop_cleanup'),
                 updated_at = now()
             where id = any($1::bigint[])`,
            [stopIdsToSoftDelete],
        );
    }

    return {
        orphan_source_links_deleted: orphanSourceLinkIds.length,
        stop_names_deleted: 0,
    };
}

export async function cleanupTestYbsRoute(options: {
    routeCode: string;
    requireStatuses: string[];
    execute: boolean;
    runRoot: string;
    cleanupOrphanStops: boolean;
    softDeleteStops: boolean;
    allowNonYbsRoute?: boolean;
    databaseUrl?: string;
}): Promise<CleanupReport> {
    const generatedAt = new Date().toISOString();
    const mode: CleanupMode = options.execute ? "execute" : "dry_run";
    const allowed = new Set(options.requireStatuses);

    const baseReport: CleanupReport = {
        generated_at: generatedAt,
        mode,
        status: "failed",
        route_code: options.routeCode,
        cleanup_orphan_stops: options.cleanupOrphanStops,
        soft_delete_stops: options.softDeleteStops,
        route_existed_before_cleanup: false,
        allowed_review_statuses: options.requireStatuses,
        counts: emptyCounts(),
        entity_ids: {
            route_id: null,
            route_variant_ids: [],
            route_stop_ids: [],
            route_path_ids: [],
            fare_ids: [],
            source_link_ids: [],
            stop_ids_considered: [],
            orphan_stop_ids_deleted: [],
            orphan_stop_ids_soft_deleted: [],
            orphan_source_link_ids: [],
            shared_stop_ids_cleared: [],
        },
        stops: [],
        orphan_stops: [],
        shared_stops: [],
        remaining_suspected_test_stops: [],
        executed: false,
        report_json_path: "",
        report_md_path: "",
    };

    const client = new pg.Client({ connectionString: options.databaseUrl ?? getDatabaseUrl() });
    await client.connect();

    let planned: CleanupReport | undefined;

    try {
        const route = await loadRoute(client, options.routeCode);
        const routeExisted = Boolean(route);
        baseReport.route_existed_before_cleanup = routeExisted;

        if (!route && !options.cleanupOrphanStops) {
            return writeReport(
                {
                    ...baseReport,
                    status: "refused",
                    refusal_reason: `Route not found: ${options.routeCode}. Use --cleanup-orphan-stops to clean leftover test stops when the route is already deleted.`,
                },
                options.runRoot,
            );
        }

        let counts = emptyCounts();
        let entityIds = { ...baseReport.entity_ids };
        let stops: StopCleanupRow[] = [];
        let orphanStops: OrphanStopRow[] = [];
        let sharedStops: SharedStopCleanupRow[] = [];
        let remainingSuspected: SuspectedTestStopRow[] = [];

        if (route) {
            const ybsExternalId = routeExternalId(options.routeCode);
            const hasYbsLink = await hasYbsRouteSourceLink(client, route.id, ybsExternalId);
            baseReport.route = {
                id: route.id,
                review_status: route.review_status,
                is_active: route.is_active,
                has_ybs_route_source_link: hasYbsLink,
                ybs_route_external_id: ybsExternalId,
            };
            entityIds.route_id = route.id;

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

            const reviewStatus = route.review_status ?? "";
            if (!allowed.has(reviewStatus)) {
                return writeReport(
                    {
                        ...baseReport,
                        status: "refused",
                        refusal_reason: `Route review_status=${reviewStatus || "null"} is not in allowed list`,
                    },
                    options.runRoot,
                );
            }

            if (!hasYbsLink && !options.cleanupOrphanStops && !options.allowNonYbsRoute) {
                return writeReport(
                    {
                        ...baseReport,
                        status: "refused",
                        refusal_reason: `Route has no YBS source_link (${ybsExternalId}). Pass --allow-non-ybs-route to remove a pre-existing non-YBS route at this code (e.g. OSM).`,
                    },
                    options.runRoot,
                );
            }

            if (hasYbsLink || options.allowNonYbsRoute) {
                const scope = await collectRouteScope(client, route.id);
                stops = await planStopCleanup(client, scope.stopIds, scope.variantIds);
                counts = {
                    ...counts,
                    source_links: scope.sourceLinkIds.length,
                    route_stops: scope.routeStopIds.length,
                    route_paths: scope.routePathIds.length,
                    route_variants: scope.variantIds.length,
                    fares: scope.fareIds.length,
                    route_names: scope.routeNameCount,
                    service_notes: scope.serviceNoteIds.length,
                    terminals_unlinked: stops
                        .filter((s) => s.action === "deleted")
                        .reduce((sum, s) => sum + s.terminal_link_count, 0),
                    stops_deleted: stops.filter((s) => s.action === "deleted").length,
                    stops_deactivated: stops.filter((s) => s.action === "deactivated").length,
                    stops_kept: stops.filter(
                        (s) =>
                            s.action === "kept_shared" ||
                            s.action === "kept_protected" ||
                            s.action === "kept_terminal_linked",
                    ).length,
                    routes: 1,
                };
                entityIds = {
                    ...entityIds,
                    route_variant_ids: scope.variantIds,
                    route_stop_ids: scope.routeStopIds,
                    route_path_ids: scope.routePathIds,
                    fare_ids: scope.fareIds,
                    source_link_ids: scope.sourceLinkIds,
                    stop_ids_considered: scope.stopIds,
                };
            }
        }

        if (options.cleanupOrphanStops) {
            const hints = loadRunStopHints(options.runRoot, options.routeCode);
            const candidates = await findOrphanCandidateStops(
                client,
                options.routeCode,
                hints,
            );
            orphanStops = planOrphanStopCleanup(candidates, options.softDeleteStops);
            const orphanSourceLinkIds = await collectOrphanSourceLinkIds(
                client,
                options.routeCode,
                orphanStops
                    .filter((row) => row.action === "deleted" || row.action === "soft_deleted")
                    .map((row) => row.stop_id),
            );

            counts.orphan_stops_found = orphanStops.length;
            counts.orphan_stops_deleted = orphanStops.filter((row) => row.action === "deleted")
                .length;
            counts.orphan_stops_soft_deleted = orphanStops.filter(
                (row) => row.action === "soft_deleted",
            ).length;
            counts.orphan_stops_skipped_still_used = orphanStops.filter(
                (row) => row.action === "skipped_still_used",
            ).length;
            counts.orphan_stops_skipped_protected = orphanStops.filter(
                (row) => row.action === "skipped_protected",
            ).length;
            counts.orphan_source_links_deleted = orphanSourceLinkIds.length;
            counts.stop_names_deleted = counts.orphan_stops_deleted;

            entityIds.orphan_stop_ids_deleted = orphanStops
                .filter((row) => row.action === "deleted")
                .map((row) => row.stop_id);
            entityIds.orphan_stop_ids_soft_deleted = orphanStops
                .filter((row) => row.action === "soft_deleted")
                .map((row) => row.stop_id);
            entityIds.orphan_source_link_ids = orphanSourceLinkIds;

            const sharedCandidates = await findSharedStopsWithRouteMetadata(
                client,
                options.routeCode,
            );
            sharedStops = planSharedStopMetadataCleanup(sharedCandidates);
            counts.shared_stops_metadata_cleared = sharedStops.filter(
                (row) => row.action === "cleared_shared_metadata",
            ).length;
            entityIds.shared_stop_ids_cleared = sharedStops
                .filter((row) => row.action === "cleared_shared_metadata")
                .map((row) => row.stop_id);
        }

        if (options.execute) {
            await client.query("begin");
            try {
                if (
                    route &&
                    (baseReport.route?.has_ybs_route_source_link || options.allowNonYbsRoute)
                ) {
                    const scope = await collectRouteScope(client, route.id);
                    const routeStopPlan = await planStopCleanup(
                        client,
                        scope.stopIds,
                        scope.variantIds,
                    );
                    const detachCounts = await executeRouteCleanup(
                        client,
                        route.id,
                        scope,
                        routeStopPlan,
                    );
                    counts.terminals_unlinked = detachCounts.terminals_unlinked;
                    counts.route_variant_stop_refs_cleared =
                        detachCounts.route_variant_stop_refs_cleared;
                    counts.parent_stop_refs_cleared = detachCounts.parent_stop_refs_cleared;
                }

                if (options.cleanupOrphanStops) {
                    const orphanCounts = await executeOrphanStopCleanup(
                        client,
                        options.routeCode,
                        orphanStops,
                    );
                    counts.orphan_source_links_deleted = orphanCounts.orphan_source_links_deleted;
                    counts.stop_names_deleted = orphanCounts.stop_names_deleted;

                    const sharedCounts = await executeSharedStopMetadataCleanup(
                        client,
                        sharedStops,
                    );
                    counts.shared_stops_metadata_cleared = sharedCounts.metadata_cleared;
                    counts.shared_stops_reactivated = sharedCounts.reactivated;
                }

                await client.query("commit");
            } catch (executeError) {
                await client.query("rollback");
                throw executeError;
            }
        }

        if (options.cleanupOrphanStops) {
            remainingSuspected = await findRemainingSuspectedTestStops(
                client,
                options.routeCode,
            );
        }

        planned = {
            ...baseReport,
            status: "passed",
            counts,
            entity_ids: entityIds,
            stops,
            orphan_stops: orphanStops,
            shared_stops: sharedStops,
            remaining_suspected_test_stops: remainingSuspected,
            executed: options.execute,
        };

        if (!options.execute) {
            console.log("Dry-run plan (no DB writes):");
            console.log(
                JSON.stringify(
                    {
                        route_existed_before_cleanup: routeExisted,
                        counts,
                        orphan_stop_ids_deleted: entityIds.orphan_stop_ids_deleted,
                        orphan_stop_ids_soft_deleted: entityIds.orphan_stop_ids_soft_deleted,
                        orphan_source_link_ids: entityIds.orphan_source_link_ids,
                    },
                    null,
                    2,
                ),
            );
        }

        return writeReport(planned, options.runRoot);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return writeReport(
            {
                ...(planned ?? baseReport),
                status: "failed",
                error: message,
            },
            options.runRoot,
        );
    } finally {
        await client.end();
    }
}

async function main(): Promise<void> {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const report = await cleanupTestYbsRoute(args);

    console.log(`Cleanup ${report.route_code}: ${report.status} (${report.mode})`);
    if (report.refusal_reason) console.log(`Refusal: ${report.refusal_reason}`);
    if (report.error) console.error(`Error: ${report.error}`);
    console.log(`Route existed before cleanup: ${report.route_existed_before_cleanup}`);
    console.log(
        `Route tree: routes=${report.counts.routes}, route_stops=${report.counts.route_stops}, source_links=${report.counts.source_links}`,
    );
    console.log(
        `Orphans: found=${report.counts.orphan_stops_found}, deleted=${report.counts.orphan_stops_deleted}, skipped_used=${report.counts.orphan_stops_skipped_still_used}, shared_metadata_cleared=${report.counts.shared_stops_metadata_cleared}`,
    );
    console.log(`Remaining suspected test stops: ${report.remaining_suspected_test_stops.length}`);
    console.log(`Report: ${report.report_json_path}`);

    if (report.status === "refused" || report.status === "failed") process.exit(1);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("cleanup-test-ybs-route.ts") ||
        process.argv[1].endsWith("cleanup-test-ybs-route.js"));

if (isMain) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
