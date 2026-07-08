#!/usr/bin/env npx tsx
/**
 * Repair route_stop review display geometry in place (dry-run by default).
 *
 * Sets transport.route_stops.review_geom from the variant straight-line route_path
 * without changing transport.stops.geom.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import {
    isProtectedReviewStatus,
    ROUTE_PATH_KIND_CORRIDOR_ESTIMATE,
} from "./supabase-schema-map.js";
import { PLACEHOLDER_GEOMETRY_MODE } from "../ybs-db-prepare/geometry-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");
const DEFAULT_RUN_ROOT = "tmp/transport-imports/ybs-flow-test-ybs1-ybs2";
const REVIEW_GEOMETRY_DATA_REPAIRED_BY = "repair-route-stop-review-geometry";
const MAX_ACCEPTABLE_DISTANCE_FROM_PATH_M = 50;

type RepairMode = "dry_run" | "execute";

type CliOptions = {
    routeCode: string;
    mode: typeof PLACEHOLDER_GEOMETRY_MODE;
    execute: boolean;
    runRoot: string;
    databaseUrl?: string;
};

type RouteRow = {
    id: number;
    route_code: string;
    review_status: string | null;
    is_active: boolean | null;
};

type VariantRow = {
    id: number;
    variant_code: string;
    review_status: string | null;
};

type RoutePathRow = {
    id: number;
    route_variant_id: number;
    path_kind: string;
    review_status: string | null;
    placeholder_geometry_mode: string | null;
    has_geom: boolean;
};

type RouteStopRow = {
    id: number;
    route_variant_id: number;
    stop_id: number;
    stop_sequence: number;
    has_review_geom: boolean;
    stop_lng: number | null;
    stop_lat: number | null;
};

type PlannedRouteStopRepair = {
    route_stop_id: number;
    route_variant_id: number;
    variant_code: string;
    stop_id: number;
    stop_sequence: number;
    fraction: number;
    review_lng: number;
    review_lat: number;
    distance_from_path_m: number;
    had_review_geom_before: boolean;
};

type VariantRepairPlan = {
    variant_id: number;
    variant_code: string;
    route_path_id: number | null;
    route_stop_count: number;
    skipped_reason: string | null;
    planned_updates: PlannedRouteStopRepair[];
};

type RepairReport = {
    generated_at: string;
    mode: RepairMode;
    status: "passed" | "refused" | "failed";
    refusal_reason?: string;
    error?: string;
    route_code: string;
    route_id: number | null;
    repair_geometry_mode: string;
    variants_processed: number;
    route_stops_found: number;
    route_stops_updated: number;
    route_stops_missing_route_path: number;
    route_stops_with_review_geom_before: number;
    route_stops_with_review_geom_after: number;
    max_distance_from_path_m: number | null;
    physical_stop_geom_modified: false;
    executed: boolean;
    variants: VariantRepairPlan[];
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
    let mode: typeof PLACEHOLDER_GEOMETRY_MODE = PLACEHOLDER_GEOMETRY_MODE;
    let execute = false;
    let runRoot = DEFAULT_RUN_ROOT;
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--route-code" && next) {
            routeCode = next.trim();
            index++;
        } else if (arg === "--mode" && next) {
            if (next.trim() !== PLACEHOLDER_GEOMETRY_MODE) {
                throw new Error(`Unsupported --mode ${next}. Only ${PLACEHOLDER_GEOMETRY_MODE} is supported.`);
            }
            mode = PLACEHOLDER_GEOMETRY_MODE;
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

    return { routeCode, mode, execute, runRoot, databaseUrl };
}

function reviewGeometryData(routeCode: string): Record<string, unknown> {
    return {
        geom_source: "synthetic_even_distribution_placeholder",
        geometry_quality: "placeholder",
        placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
        needs_geometry_review: true,
        validator_required: true,
        public_safe: false,
        generated_from: "route_stop_sequence",
        repaired_by: REVIEW_GEOMETRY_DATA_REPAIRED_BY,
        route_code: routeCode,
    };
}

function buildMarkdown(report: RepairReport): string {
    const lines = [
        `# Repair route_stop review geometry — ${report.route_code}`,
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
        `| variants processed | ${report.variants_processed} |`,
        `| route_stops found | ${report.route_stops_found} |`,
        `| route_stops updated | ${report.route_stops_updated} |`,
        `| route_stops missing route_path | ${report.route_stops_missing_route_path} |`,
        `| route_stops with review_geom before | ${report.route_stops_with_review_geom_before} |`,
        `| route_stops with review_geom after | ${report.route_stops_with_review_geom_after} |`,
        `| max distance from path (m) | ${report.max_distance_from_path_m ?? "null"} |`,
        `| physical_stop_geom_modified | ${report.physical_stop_geom_modified} |`,
        "",
        "## Variants",
        "",
    ];

    for (const variant of report.variants) {
        lines.push(`### ${variant.variant_code}`);
        lines.push("");
        if (variant.skipped_reason) {
            lines.push(`- Skipped: ${variant.skipped_reason}`);
            continue;
        }
        lines.push(`- route_path_id: ${variant.route_path_id}`);
        lines.push(`- route_stops: ${variant.route_stop_count}`);
        lines.push(`- planned updates: ${variant.planned_updates.length}`);
    }

    return lines.filter((line) => line !== "").join("\n");
}

function writeReport(report: RepairReport, runRoot: string): RepairReport {
    const reportsDir = join(REPO_ROOT, runRoot, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const baseName = `repair-review-geometry-${report.route_code}`;
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
        select id::int, route_code, review_status, is_active
        from transport.routes
        where route_code = $1 and deleted_at is null
        limit 1
        `,
        [routeCode],
    );
    return result.rows[0] ?? null;
}

async function loadVariants(client: pg.Client, routeId: number): Promise<VariantRow[]> {
    const result = await client.query<VariantRow>(
        `
        select id::int, variant_code, review_status
        from transport.route_variants
        where route_id = $1 and deleted_at is null
        order by variant_code
        `,
        [routeId],
    );
    return result.rows;
}

async function loadPlaceholderRoutePath(
    client: pg.Client,
    variantId: number,
): Promise<RoutePathRow | null> {
    const result = await client.query<RoutePathRow>(
        `
        select
            id::int,
            route_variant_id::int,
            path_kind,
            review_status,
            coalesce(normalized_data->'geometry'->>'placeholder_geometry_mode', '') as placeholder_geometry_mode,
            (geom is not null and not st_isempty(geom)) as has_geom
        from transport.route_paths
        where route_variant_id = $1
          and deleted_at is null
          and path_kind = $2
          and review_status = 'needs_review'
          and coalesce(normalized_data->'geometry'->>'placeholder_geometry_mode', '') = $3
        order by id asc
        limit 1
        `,
        [variantId, ROUTE_PATH_KIND_CORRIDOR_ESTIMATE, PLACEHOLDER_GEOMETRY_MODE],
    );
    return result.rows[0] ?? null;
}

async function loadRouteStops(client: pg.Client, variantId: number): Promise<RouteStopRow[]> {
    const result = await client.query<RouteStopRow>(
        `
        select
            rs.id::int,
            rs.route_variant_id::int,
            rs.stop_id::int,
            rs.stop_sequence::int,
            (rs.review_geom is not null and not st_isempty(rs.review_geom)) as has_review_geom,
            st_x(s.geom)::float8 as stop_lng,
            st_y(s.geom)::float8 as stop_lat
        from transport.route_stops rs
        join transport.stops s on s.id = rs.stop_id
        where rs.route_variant_id = $1
          and s.deleted_at is null
        order by rs.stop_sequence asc, rs.id asc
        `,
        [variantId],
    );
    return result.rows;
}

async function planVariantRepair(
    client: pg.Client,
    variant: VariantRow,
    routeCode: string,
): Promise<VariantRepairPlan> {
    const routeStops = await loadRouteStops(client, variant.id);
    const routePath = await loadPlaceholderRoutePath(client, variant.id);
    if (!routePath) {
        return {
            variant_id: variant.id,
            variant_code: variant.variant_code,
            route_path_id: null,
            route_stop_count: routeStops.length,
            skipped_reason: "No straight_line_review corridor_estimate route_path found.",
            planned_updates: [],
        };
    }
    if (!routePath.has_geom) {
        return {
            variant_id: variant.id,
            variant_code: variant.variant_code,
            route_path_id: routePath.id,
            route_stop_count: routeStops.length,
            skipped_reason: "Route path has no geometry.",
            planned_updates: [],
        };
    }
    if (routeStops.length === 0) {
        return {
            variant_id: variant.id,
            variant_code: variant.variant_code,
            route_path_id: routePath.id,
            route_stop_count: 0,
            skipped_reason: "Variant has no route_stops.",
            planned_updates: [],
        };
    }

    const stopIds = routeStops.map((row) => row.id);
    const fractions = routeStops.map((row, index) => {
        if (routeStops.length === 1) {
            return 0;
        }
        return (row.stop_sequence - 1) / (routeStops.length - 1);
    });

    const interpolation = await client.query<{
        route_stop_id: number;
        review_lng: number;
        review_lat: number;
        distance_from_path_m: number;
    }>(
        `
        with path as (
            select geom
            from transport.route_paths
            where id = $3
        ),
        input as (
            select *
            from unnest($1::bigint[], $2::float8[])
                as t(route_stop_id, fraction)
        )
        select
            i.route_stop_id::int,
            st_x(point.geom)::float8 as review_lng,
            st_y(point.geom)::float8 as review_lat,
            st_distance(point.geom::geography, path.geom::geography)::float8 as distance_from_path_m
        from input i
        cross join path
        cross join lateral (
            select case
                when $4::int = 1 then st_startpoint(path.geom)
                else st_lineinterpolatepoint(path.geom, greatest(0::float8, least(1::float8, i.fraction)))
            end as geom
        ) point
        order by i.route_stop_id
        `,
        [stopIds, fractions, routePath.id, routeStops.length],
    );

    const interpolationById = new Map(
        interpolation.rows.map((row) => [row.route_stop_id, row]),
    );

    const plannedUpdates: PlannedRouteStopRepair[] = routeStops.map((row, index) => {
        const computed = interpolationById.get(row.id);
        if (!computed) {
            throw new Error(`Missing interpolation for route_stop id=${row.id}`);
        }
        return {
            route_stop_id: row.id,
            route_variant_id: variant.id,
            variant_code: variant.variant_code,
            stop_id: row.stop_id,
            stop_sequence: row.stop_sequence,
            fraction: fractions[index] ?? 0,
            review_lng: computed.review_lng,
            review_lat: computed.review_lat,
            distance_from_path_m: computed.distance_from_path_m,
            had_review_geom_before: row.has_review_geom,
        };
    });

    return {
        variant_id: variant.id,
        variant_code: variant.variant_code,
        route_path_id: routePath.id,
        route_stop_count: routeStops.length,
        skipped_reason: null,
        planned_updates: plannedUpdates,
    };
}

async function executeVariantRepair(
    client: pg.Client,
    variantPlan: VariantRepairPlan,
    routeCode: string,
): Promise<number> {
    if (variantPlan.skipped_reason || variantPlan.planned_updates.length === 0) {
        return 0;
    }

    const geometryData = reviewGeometryData(routeCode);
    const routeStopIds = variantPlan.planned_updates.map((row) => row.route_stop_id);
    const lngs = variantPlan.planned_updates.map((row) => row.review_lng);
    const lats = variantPlan.planned_updates.map((row) => row.review_lat);

    const result = await client.query<{ updated: number }>(
        `
        with input as (
            select *
            from unnest($1::bigint[], $2::float8[], $3::float8[])
                as t(route_stop_id, lng, lat)
        ),
        updated as (
            update transport.route_stops rs
            set review_geom = st_setsrid(st_makepoint(i.lng, i.lat), 4326),
                review_geometry_data = $4::jsonb,
                updated_at = now()
            from input i
            where rs.id = i.route_stop_id
            returning rs.id
        )
        select count(*)::int as updated from updated
        `,
        [routeStopIds, lngs, lats, JSON.stringify(geometryData)],
    );

    return result.rows[0]?.updated ?? 0;
}

export async function repairRouteStopReviewGeometry(options: CliOptions): Promise<RepairReport> {
    const baseReport: RepairReport = {
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        status: "passed",
        route_code: options.routeCode,
        route_id: null,
        repair_geometry_mode: options.mode,
        variants_processed: 0,
        route_stops_found: 0,
        route_stops_updated: 0,
        route_stops_missing_route_path: 0,
        route_stops_with_review_geom_before: 0,
        route_stops_with_review_geom_after: 0,
        max_distance_from_path_m: null,
        physical_stop_geom_modified: false,
        executed: false,
        variants: [],
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
        const variantPlans: VariantRepairPlan[] = [];
        for (const variant of variants) {
            variantPlans.push(await planVariantRepair(client, variant, options.routeCode));
        }

        const allPlanned = variantPlans.flatMap((plan) => plan.planned_updates);
        const beforeReviewGeomCount = allPlanned.filter((row) => row.had_review_geom_before).length;
        const missingPathCount = variantPlans
            .filter((plan) => plan.skipped_reason?.includes("route_path"))
            .reduce((sum, plan) => sum + plan.route_stop_count, 0);
        const maxDistance =
            allPlanned.length > 0
                ? Math.max(...allPlanned.map((row) => row.distance_from_path_m))
                : null;

        if (options.execute) {
            await client.query("begin");
            try {
                let updated = 0;
                for (const variantPlan of variantPlans) {
                    updated += await executeVariantRepair(client, variantPlan, options.routeCode);
                }
                await client.query("commit");
                baseReport.route_stops_updated = updated;
                baseReport.executed = true;
            } catch (error) {
                await client.query("rollback");
                throw error;
            }
        } else {
            baseReport.route_stops_updated = allPlanned.length;
        }

        baseReport.variants = variantPlans;
        baseReport.variants_processed = variantPlans.length;
        baseReport.route_stops_found = allPlanned.length + missingPathCount;
        baseReport.route_stops_missing_route_path = missingPathCount;
        baseReport.route_stops_with_review_geom_before = beforeReviewGeomCount;
        baseReport.route_stops_with_review_geom_after = options.execute
            ? allPlanned.length
            : allPlanned.length;
        baseReport.max_distance_from_path_m = maxDistance;

        return writeReport(baseReport, options.runRoot);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return writeReport(
            {
                ...baseReport,
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
    const options = parseArgs(process.argv.slice(2));
    const report = await repairRouteStopReviewGeometry(options);

    console.log(`Repair ${report.route_code}: ${report.status} (${report.mode})`);
    if (report.refusal_reason) {
        console.log(`Refusal: ${report.refusal_reason}`);
    }
    if (report.error) {
        console.error(`Error: ${report.error}`);
    }
    console.log(
        `route_stops found=${report.route_stops_found}, updated=${report.route_stops_updated}, max_distance_m=${report.max_distance_from_path_m ?? "n/a"}`,
    );
    console.log(`Report: ${report.report_json_path}`);

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
