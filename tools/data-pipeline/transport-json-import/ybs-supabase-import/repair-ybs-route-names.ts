#!/usr/bin/env npx tsx
/**
 * Repair YBS route display names in place (dry-run by default).
 *
 * Normalizes transport.routes.public_name, origin_name, destination_name, and
 * transport.route_names (my/en primary + und alias) without touching stops,
 * paths, review_geom, or review status.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import {
    isProtectedReviewStatus,
    isMergeableReviewStatus,
} from "./supabase-schema-map.js";
import {
    normalizeYbsRouteDisplayNames,
    parseRouteEndpoints,
    type RouteDisplayNameReport,
} from "../ybs-normalize/route-display-names.js";

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

type RouteRow = {
    id: number;
    route_code: string;
    public_name: string;
    origin_name: string | null;
    destination_name: string | null;
    review_status: string | null;
};

type RouteNameRow = {
    id: number;
    language_code: string;
    name_type: string;
    is_primary: boolean;
    name: string;
};

type PlannedRouteNameChange = {
    language_code: string;
    name_type: string;
    is_primary: boolean;
    before: string | null;
    after: string;
    action: "insert" | "update";
};

type RepairReport = {
    generated_at: string;
    mode: RepairMode;
    status: "passed" | "refused" | "failed";
    refusal_reason?: string;
    error?: string;
    route_code: string;
    route_id: number | null;
    before: {
        public_name: string | null;
        origin_name: string | null;
        destination_name: string | null;
        route_names: RouteNameRow[];
    };
    after: {
        public_name: string | null;
        origin_name: string | null;
        destination_name: string | null;
        route_names: PlannedRouteNameChange[];
    };
    route_display_names: RouteDisplayNameReport;
    executed: boolean;
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
    const url = override ?? process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL is not configured.");
    }
    return url;
}

const DEFAULT_MERGED_SOURCE_DIR = "tmp/transport-imports/ybs-all/merged/routes";

type VariantStop = {
    stop_name_my?: string | null;
    stop_name_en?: string | null;
};

type VariantLike = {
    direction_key?: string;
    direction_name?: string;
    stops?: VariantStop[];
};

function findVariant(variants: VariantLike[], direction: "outbound" | "inbound"): VariantLike | undefined {
    return variants.find(
        (variant) => variant.direction_key === direction || variant.direction_name === direction,
    );
}

function firstStopName(stops: VariantStop[], field: "stop_name_my" | "stop_name_en"): string | null {
    for (const stop of stops) {
        const name = stop[field]?.trim();
        if (name) {
            return name;
        }
    }
    return null;
}

function lastStopName(stops: VariantStop[], field: "stop_name_my" | "stop_name_en"): string | null {
    for (let index = stops.length - 1; index >= 0; index--) {
        const name = stops[index]?.[field]?.trim();
        if (name) {
            return name;
        }
    }
    return null;
}

function generateRouteTitleFromVariantEndpoints(
    variants: VariantLike[],
    field: "stop_name_my" | "stop_name_en",
): string | null {
    const outbound = findVariant(variants, "outbound");
    const inbound = findVariant(variants, "inbound");
    const outboundStops = outbound?.stops ?? [];
    const inboundStops = inbound?.stops ?? [];

    let first = firstStopName(outboundStops, field);
    let last = lastStopName(outboundStops, field);

    if ((!first || !last) && inboundStops.length > 0) {
        if (!first) {
            first = lastStopName(inboundStops, field);
        }
        if (!last) {
            last = firstStopName(inboundStops, field);
        }
    }

    if (first && last) {
        return `${first} - ${last}`;
    }

    return null;
}

function routeTitleHasParseableEndpoints(title: string | null | undefined): boolean {
    const endpoints = parseRouteEndpoints(title);
    return Boolean(endpoints.origin && endpoints.destination);
}

function loadRouteSourceFromRun(
    runRoot: string,
    routeCode: string,
): {
    route_title_my: string | null;
    route_title_en: string | null;
    route_name_en: string | null;
    route_number: number | null;
    source_path: string | null;
} | null {
    const candidates = [
        join(REPO_ROOT, runRoot, "input", `${routeCode}.json`),
        join(REPO_ROOT, runRoot, "merged", "routes", `${routeCode}.json`),
        join(REPO_ROOT, runRoot, "normalized", "routes", `${routeCode}.json`),
        join(REPO_ROOT, DEFAULT_MERGED_SOURCE_DIR, `${routeCode}.json`),
    ];

    for (const filePath of candidates) {
        if (!existsSync(filePath)) {
            continue;
        }

        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
            route?: Record<string, unknown>;
            route_detail_identity?: Record<string, unknown>;
            route_index_identity?: Record<string, unknown>;
            variants?: VariantLike[];
        };
        const route = parsed.route ?? {};
        const variants = parsed.variants ?? [];

        let route_title_my =
            (typeof parsed.route_detail_identity?.route_title_my === "string"
                ? parsed.route_detail_identity.route_title_my
                : null) ??
            (typeof parsed.route_index_identity?.route_title_my === "string"
                ? parsed.route_index_identity.route_title_my
                : null) ??
            (typeof route.source_title_my === "string" ? route.source_title_my : null) ??
            (typeof route.route_name_my === "string" ? route.route_name_my : null);

        if (!routeTitleHasParseableEndpoints(route_title_my)) {
            const generatedMy = generateRouteTitleFromVariantEndpoints(variants, "stop_name_my");
            if (generatedMy) {
                route_title_my = generatedMy;
            }
        }

        let route_title_en =
            (typeof parsed.route_detail_identity?.route_title_en === "string"
                ? parsed.route_detail_identity.route_title_en
                : null) ??
            (typeof parsed.route_index_identity?.route_title_en === "string"
                ? parsed.route_index_identity.route_title_en
                : null) ??
            (typeof route.source_title_en === "string" ? route.source_title_en : null) ??
            (typeof route.route_detail_title_en_raw === "string"
                ? route.route_detail_title_en_raw
                : null);

        if (!routeTitleHasParseableEndpoints(route_title_en)) {
            const generatedEn = generateRouteTitleFromVariantEndpoints(variants, "stop_name_en");
            if (generatedEn) {
                route_title_en = generatedEn;
            }
        }

        return {
            route_title_my,
            route_title_en,
            route_name_en:
                (typeof parsed.route_detail_identity?.route_name_en === "string"
                    ? parsed.route_detail_identity.route_name_en
                    : null) ??
                (typeof route.route_name_en === "string" ? route.route_name_en : null),
            route_number:
                typeof route.route_number === "number" && Number.isFinite(route.route_number)
                    ? route.route_number
                    : null,
            source_path: filePath,
        };
    }

    return null;
}

function loadSourceTitlesFromRun(
    runRoot: string,
    routeCode: string,
): {
    route_title_my: string | null;
    route_title_en: string | null;
    route_name_en: string | null;
    route_number: number | null;
} {
    const loaded = loadRouteSourceFromRun(runRoot, routeCode);
    if (!loaded) {
        return { route_title_my: null, route_title_en: null, route_name_en: null, route_number: null };
    }

    return {
        route_title_my: loaded.route_title_my,
        route_title_en: loaded.route_title_en,
        route_name_en: loaded.route_name_en,
        route_number: loaded.route_number,
    };
}

function planRouteNameChanges(
    existing: RouteNameRow[],
    normalized: RouteDisplayNameReport,
): PlannedRouteNameChange[] {
    const planned: PlannedRouteNameChange[] = [];

    const targets = [
        {
            language_code: "my",
            name_type: "primary",
            is_primary: true,
            after: normalized.primary_name_my,
        },
        {
            language_code: "en",
            name_type: "primary",
            is_primary: true,
            after: normalized.primary_name_en,
        },
        {
            language_code: "und",
            name_type: "alias",
            is_primary: false,
            after: normalized.alias_und,
        },
    ] as const;

    for (const target of targets) {
        if (!target.after) {
            continue;
        }

        const current =
            existing.find(
                (row) =>
                    row.language_code === target.language_code &&
                    row.is_primary === target.is_primary,
            ) ??
            existing.find((row) => row.language_code === target.language_code) ??
            null;

        if (current && current.name === target.after && current.name_type === target.name_type) {
            continue;
        }

        planned.push({
            language_code: target.language_code,
            name_type: target.name_type,
            is_primary: target.is_primary,
            before: current?.name ?? null,
            after: target.after,
            action: current ? "update" : "insert",
        });
    }

    return planned;
}

function renderMarkdown(report: RepairReport): string {
    const lines = [
        `# Repair YBS route names — ${report.route_code}`,
        "",
        `Generated at: ${report.generated_at}`,
        `Mode: ${report.mode}`,
        `Status: ${report.status}`,
        "",
        "## Source titles",
        "",
        `- my: ${report.route_display_names.source_title_my ?? "—"}`,
        `- en title: ${report.route_display_names.source_title_en ?? "—"}`,
        "",
        "## Normalized targets",
        "",
        `- route_code: ${report.route_display_names.route_code ?? "—"}`,
        `- display_code: ${report.route_display_names.display_code ?? "—"}`,
        `- public_name: ${report.route_display_names.public_name ?? "—"}`,
        `- primary_name_my: ${report.route_display_names.primary_name_my ?? "—"}`,
        `- primary_name_en: ${report.route_display_names.primary_name_en ?? "—"}`,
        `- alias_und: ${report.route_display_names.alias_und ?? "—"}`,
        `- origin_my: ${report.route_display_names.origin_my ?? "—"}`,
        `- destination_my: ${report.route_display_names.destination_my ?? "—"}`,
        `- origin_en: ${report.route_display_names.origin_en ?? "—"}`,
        `- destination_en: ${report.route_display_names.destination_en ?? "—"}`,
        "",
        "## Before",
        "",
        `- public_name: ${report.before.public_name ?? "—"}`,
        `- origin_name: ${report.before.origin_name ?? "—"}`,
        `- destination_name: ${report.before.destination_name ?? "—"}`,
        "",
        "## Planned route_names changes",
        "",
    ];

    if (report.after.route_names.length === 0) {
        lines.push("- None");
    } else {
        for (const change of report.after.route_names) {
            lines.push(
                `- ${change.action} ${change.language_code} (${change.name_type}): "${change.before ?? "—"}" → "${change.after}"`,
            );
        }
    }

    if (report.route_display_names.validation_warnings.length > 0) {
        lines.push("", "## Warnings", "");
        for (const warning of report.route_display_names.validation_warnings) {
            lines.push(`- ${warning}`);
        }
    }

    if (report.route_display_names.validation_errors.length > 0) {
        lines.push("", "## Errors", "");
        for (const error of report.route_display_names.validation_errors) {
            lines.push(`- ${error}`);
        }
    }

    lines.push("");
    return lines.join("\n");
}

async function repairRouteNames(options: CliOptions): Promise<RepairReport> {
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const client = new pg.Client({ connectionString: databaseUrl });
    const reportsDir = join(REPO_ROOT, options.runRoot, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportJsonPath = join(reportsDir, `repair-route-names-${options.routeCode}-${timestamp}.json`);
    const reportMdPath = join(reportsDir, `repair-route-names-${options.routeCode}-${timestamp}.md`);

    const baseReport: RepairReport = {
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        status: "failed",
        route_code: options.routeCode,
        route_id: null,
        before: {
            public_name: null,
            origin_name: null,
            destination_name: null,
            route_names: [],
        },
        after: {
            public_name: null,
            origin_name: null,
            destination_name: null,
            route_names: [],
        },
        route_display_names: {
            source_title_my: null,
            source_title_en: null,
            extracted_route_number: null,
            route_code: null,
            display_code: null,
            origin_my: null,
            destination_my: null,
            origin_en: null,
            destination_en: null,
            public_name: null,
            primary_name_my: null,
            primary_name_en: null,
            alias_und: null,
            validation_warnings: [],
            validation_errors: [],
        },
        executed: false,
        report_json_path: reportJsonPath,
        report_md_path: reportMdPath,
    };

    try {
        await client.connect();

        const routeResult = await client.query<RouteRow>(
            `
            SELECT id::int, route_code, public_name, origin_name, destination_name, review_status
            FROM transport.routes
            WHERE route_code = $1 AND deleted_at IS NULL
            LIMIT 1
            `,
            [options.routeCode],
        );
        const route = routeResult.rows[0];
        if (!route) {
            baseReport.status = "refused";
            baseReport.refusal_reason = `Route not found: ${options.routeCode}`;
            writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
            writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
            return baseReport;
        }

        if (isProtectedReviewStatus(route.review_status)) {
            baseReport.status = "refused";
            baseReport.refusal_reason = `Route ${options.routeCode} is ${route.review_status}; protected from repair.`;
            baseReport.route_id = route.id;
            writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
            writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
            return baseReport;
        }

        if (!isMergeableReviewStatus(route.review_status)) {
            baseReport.status = "refused";
            baseReport.refusal_reason = `Route ${options.routeCode} review_status=${route.review_status} is not mergeable.`;
            baseReport.route_id = route.id;
            writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
            writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
            return baseReport;
        }

        const routeNamesResult = await client.query<RouteNameRow>(
            `
            SELECT id::int, language_code, name_type, is_primary, name
            FROM transport.route_names
            WHERE route_id = $1
            ORDER BY language_code, is_primary DESC, id
            `,
            [route.id],
        );

        const sourceTitles = loadSourceTitlesFromRun(options.runRoot, options.routeCode);
        const normalized = normalizeYbsRouteDisplayNames({
            route_code: route.route_code,
            route_number: sourceTitles.route_number,
            route_title_my:
                sourceTitles.route_title_my ??
                routeNamesResult.rows.find((row) => row.language_code === "my")?.name ??
                route.public_name,
            route_title_en: sourceTitles.route_title_en,
            route_name_en: sourceTitles.route_name_en,
        });

        if (!normalized.public_name || normalized.validation_errors.length > 0) {
            baseReport.status = "refused";
            baseReport.refusal_reason = normalized.validation_errors.join("; ") || "Normalization failed.";
            baseReport.route_id = route.id;
            baseReport.route_display_names = normalized;
            writeFileSync(reportJsonPath, `${JSON.stringify(baseReport, null, 2)}\n`, "utf8");
            writeFileSync(reportMdPath, `${renderMarkdown(baseReport)}\n`, "utf8");
            return baseReport;
        }

        const plannedRouteNames = planRouteNameChanges(routeNamesResult.rows, normalized);
        const nextOrigin =
            normalized.origin_en ?? normalized.origin_my ?? route.origin_name;
        const nextDestination =
            normalized.destination_en ?? normalized.destination_my ?? route.destination_name;

        baseReport.route_id = route.id;
        baseReport.before = {
            public_name: route.public_name,
            origin_name: route.origin_name,
            destination_name: route.destination_name,
            route_names: routeNamesResult.rows,
        };
        baseReport.route_display_names = normalized;
        baseReport.after = {
            public_name: normalized.public_name,
            origin_name: nextOrigin,
            destination_name: nextDestination,
            route_names: plannedRouteNames,
        };

        if (options.execute) {
            await client.query("BEGIN");
            try {
                await client.query(
                    `
                    UPDATE transport.routes
                    SET public_name = $2,
                        origin_name = $3,
                        destination_name = $4,
                        updated_at = now()
                    WHERE id = $1
                    `,
                    [route.id, normalized.public_name, nextOrigin, nextDestination],
                );

                for (const change of plannedRouteNames) {
                    const scriptCode =
                        change.language_code === "my"
                            ? "Mymr"
                            : change.language_code === "en"
                              ? "Latn"
                              : null;

                    if (change.action === "update") {
                        await client.query(
                            `
                            UPDATE transport.route_names
                            SET name = $2,
                                name_type = $3,
                                is_primary = $4,
                                script_code = $5,
                                updated_at = now()
                            WHERE route_id = $1
                              AND language_code = $6
                              AND is_primary = $4
                            `,
                            [
                                route.id,
                                change.after,
                                change.name_type,
                                change.is_primary,
                                scriptCode,
                                change.language_code,
                            ],
                        );
                    } else {
                        await client.query(
                            `
                            INSERT INTO transport.route_names (
                                route_id, name, language_code, script_code, name_type, is_primary, search_weight
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, 50)
                            `,
                            [
                                route.id,
                                change.after,
                                change.language_code,
                                scriptCode,
                                change.name_type,
                                change.is_primary,
                            ],
                        );
                    }
                }

                await client.query("COMMIT");
                baseReport.executed = true;
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }

        baseReport.status = "passed";
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
    const report = await repairRouteNames(options);

    console.log(`Repair ${options.routeCode}: ${report.status} (${report.mode})`);
    if (report.refusal_reason) {
        console.log(`Refusal: ${report.refusal_reason}`);
    }
    if (report.error) {
        console.log(`Error: ${report.error}`);
    }
    if (report.after.public_name) {
        console.log(`public_name: ${report.before.public_name ?? "—"} → ${report.after.public_name}`);
    }
    console.log(`route_names changes: ${report.after.route_names.length}`);
    console.log(`Report: ${report.report_json_path}`);

    if (report.status !== "passed") {
        process.exitCode = 1;
    }
}

const isMainModule =
    process.argv[1] &&
    (process.argv[1].endsWith("repair-ybs-route-names.ts") ||
        process.argv[1].endsWith("repair-ybs-route-names.js"));

if (isMainModule) {
    void main();
}

export { repairRouteNames };
