/**
 * Shared DB + source loading for route name quality report and repair.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

import {
    buildDisplayCodeFromRouteCode,
    buildResolvedRouteNames,
    detectRouteNameIssues,
    isTrialRouteCode,
    scoreRouteNameRepairConfidence,
    type RouteNameIssueCode,
    type RouteNameRepairConfidence,
    type VariantLike,
} from "../../ybs-normalize/route-name-endpoints.js";
import {
    requirePipelineDatabaseUrl,
    resolvePipelineDatabaseUrl,
    type PipelineDbTarget,
} from "./resolve-pipeline-db-url.js";
import { isProtectedReviewStatus } from "./supabase-schema-map.js";
import { YBS_SOURCE_NAME } from "./source-link-utils.js";

export { resolvePipelineDatabaseUrl, type PipelineDbTarget };

const DEFAULT_MERGED_SOURCE_DIR = "tmp/transport-imports/ybs-all/merged/routes";

export type RouteNameDbRow = {
    id: number;
    route_code: string;
    public_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
    review_status: string | null;
    has_ybs_route_source_link: boolean;
};

export type RouteNameDbNameRow = {
    language_code: string;
    name_type: string;
    is_primary: boolean;
    name: string;
};

export type RouteNameQualityRow = {
    route_code: string;
    route_id: number;
    review_status: string | null;
    has_ybs_route_source_link: boolean;
    public_name: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    origin_name: string | null;
    destination_name: string | null;
    alias_und: string | null;
    issue_codes: RouteNameIssueCode[];
    proposed_public_name: string | null;
    proposed_primary_name_my: string | null;
    proposed_primary_name_en: string | null;
    proposed_origin_name: string | null;
    proposed_destination_name: string | null;
    confidence: RouteNameRepairConfidence;
    safe_to_execute: boolean;
    repair_blocked_reason: string | null;
    source_json_path: string | null;
};

/**
 * @deprecated Prefer resolvePipelineDatabaseUrl({ target }).
 * Never silently uses bare DATABASE_URL.
 */
export function resolveDatabaseUrl(override?: string): string {
    return requirePipelineDatabaseUrl({ explicit: override });
}

export function loadMergedRouteJson(
    repoRoot: string,
    routeCode: string,
    mergedSourceDir = DEFAULT_MERGED_SOURCE_DIR,
): {
    route_title_my: string | null;
    route_title_en: string | null;
    route_name_en: string | null;
    variants: VariantLike[];
    source_path: string | null;
} {
    const candidates = [join(repoRoot, mergedSourceDir, `${routeCode}.json`)];
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
        return {
            route_title_my:
                (typeof parsed.route_detail_identity?.route_title_my === "string"
                    ? parsed.route_detail_identity.route_title_my
                    : null) ??
                (typeof parsed.route_index_identity?.route_title_my === "string"
                    ? parsed.route_index_identity.route_title_my
                    : null) ??
                (typeof route.route_name_my === "string" ? route.route_name_my : null),
            route_title_en:
                (typeof parsed.route_detail_identity?.route_title_en === "string"
                    ? parsed.route_detail_identity.route_title_en
                    : null) ??
                (typeof parsed.route_index_identity?.route_title_en === "string"
                    ? parsed.route_index_identity.route_title_en
                    : null) ??
                (typeof route.route_name_en === "string" ? route.route_name_en : null),
            route_name_en:
                (typeof route.route_name_en === "string" ? route.route_name_en : null) ??
                null,
            variants: parsed.variants ?? [],
            source_path: filePath,
        };
    }

    return {
        route_title_my: null,
        route_title_en: null,
        route_name_en: null,
        variants: [],
        source_path: null,
    };
}

export async function fetchRouteNameRows(
    client: pg.Client,
    options: {
        routeCodes?: string[];
        includeTrial: boolean;
    },
): Promise<RouteNameDbRow[]> {
    const params: unknown[] = [];
    const filters: string[] = ["r.deleted_at IS NULL", "r.mode = 'bus'"];

    if (options.routeCodes && options.routeCodes.length > 0) {
        params.push(options.routeCodes);
        filters.push(`r.route_code = ANY($${params.length}::text[])`);
    } else if (!options.includeTrial) {
        filters.push(`(r.route_code LIKE 'YBS-%' OR r.route_code = 'APS')`);
    }

    const result = await client.query<RouteNameDbRow>(
        `
        SELECT
            r.id::int AS id,
            r.route_code,
            r.public_name,
            r.origin_name,
            r.destination_name,
            r.review_status,
            EXISTS (
                SELECT 1
                FROM transport.source_links sl
                WHERE sl.entity_type = 'route'
                  AND sl.entity_id = r.id
                  AND sl.source_name = '${YBS_SOURCE_NAME}'
                  AND sl.external_id LIKE 'route:ybs_go:%'
            ) AS has_ybs_route_source_link
        FROM transport.routes r
        WHERE ${filters.join(" AND ")}
        ORDER BY r.route_code
        `,
        params,
    );

    return result.rows;
}

export async function fetchRouteNamesForRoute(
    client: pg.Client,
    routeId: number,
): Promise<RouteNameDbNameRow[]> {
    const result = await client.query<RouteNameDbNameRow>(
        `
        SELECT language_code, name_type, is_primary, name
        FROM transport.route_names
        WHERE route_id = $1
        ORDER BY language_code, is_primary DESC, id
        `,
        [routeId],
    );
    return result.rows;
}

export function assessRouteNameQuality(input: {
    route: RouteNameDbRow;
    routeNames: RouteNameDbNameRow[];
    mergedSource: ReturnType<typeof loadMergedRouteJson>;
    allowReviewed: boolean;
    repairOnlyHighConfidence: boolean;
}): RouteNameQualityRow {
    const primaryMy = input.routeNames.find((row) => row.language_code === "my" && row.is_primary);
    const primaryEn = input.routeNames.find((row) => row.language_code === "en" && row.is_primary);
    const aliasUnd = input.routeNames.find(
        (row) => row.language_code === "und" && row.name_type === "alias",
    );

    const displayCode = buildDisplayCodeFromRouteCode(input.route.route_code) ?? input.route.route_code;

    const issue_codes = detectRouteNameIssues({
        route_code: input.route.route_code,
        display_code: displayCode,
        public_name: input.route.public_name,
        origin_name: input.route.origin_name,
        destination_name: input.route.destination_name,
        primary_name_my: primaryMy?.name ?? null,
        primary_name_en: primaryEn?.name ?? null,
        alias_und: aliasUnd?.name ?? null,
    });

    const proposed = buildResolvedRouteNames({
        route_code: input.route.route_code,
        route_title_my: input.mergedSource.route_title_my,
        route_title_en: input.mergedSource.route_title_en,
        route_name_en: input.mergedSource.route_name_en,
        variants: input.mergedSource.variants,
    });

    const confidence = scoreRouteNameRepairConfidence({
        route_code: input.route.route_code,
        issues: issue_codes,
        endpoints: proposed,
        is_trial_route: isTrialRouteCode(input.route.route_code),
    });

    let repair_blocked_reason: string | null = null;
    if (!input.allowReviewed && isProtectedReviewStatus(input.route.review_status)) {
        repair_blocked_reason = `review_status=${input.route.review_status} (protected)`;
    } else if (input.route.review_status !== "imported_unreviewed") {
        repair_blocked_reason = `review_status=${input.route.review_status ?? "null"}`;
    } else if (!input.route.has_ybs_route_source_link) {
        repair_blocked_reason = "missing external_ybs_app route source link";
    } else if (!input.mergedSource.source_path) {
        repair_blocked_reason = "merged source JSON not found";
    } else if (!proposed.primary_name_my || !proposed.primary_name_en) {
        repair_blocked_reason = "could not build proposed names from source";
    } else if (input.repairOnlyHighConfidence && confidence !== "high") {
        repair_blocked_reason = `confidence=${confidence}`;
    } else if (issue_codes.length === 0) {
        repair_blocked_reason = "no name quality issues detected";
    }

    const safe_to_execute = repair_blocked_reason === null;

    return {
        route_code: input.route.route_code,
        route_id: input.route.id,
        review_status: input.route.review_status,
        has_ybs_route_source_link: input.route.has_ybs_route_source_link,
        public_name: input.route.public_name,
        primary_name_my: primaryMy?.name ?? null,
        primary_name_en: primaryEn?.name ?? null,
        origin_name: input.route.origin_name,
        destination_name: input.route.destination_name,
        alias_und: aliasUnd?.name ?? null,
        issue_codes,
        proposed_public_name: proposed.public_name,
        proposed_primary_name_my: proposed.primary_name_my,
        proposed_primary_name_en: proposed.primary_name_en,
        proposed_origin_name: proposed.origin_en,
        proposed_destination_name: proposed.destination_en,
        confidence,
        safe_to_execute,
        repair_blocked_reason,
        source_json_path: input.mergedSource.source_path,
    };
}

export function renderRouteNameQualityMarkdown(report: {
    generated_at: string;
    total_routes: number;
    routes_with_issues: number;
    routes_safe_to_repair: number;
    rows: RouteNameQualityRow[];
}): string {
    const lines = [
        "# Route name quality report",
        "",
        `- Generated at: ${report.generated_at}`,
        `- Total routes scanned: ${report.total_routes}`,
        `- Routes with issues: ${report.routes_with_issues}`,
        `- Routes safe to auto-repair: ${report.routes_safe_to_repair}`,
        "",
        "## Summary",
        "",
        markdownRouteTable(report.rows.filter((row) => row.issue_codes.length > 0)),
        "",
        "## Safe auto-repair candidates",
        "",
        markdownRouteTable(report.rows.filter((row) => row.safe_to_execute)),
        "",
    ];

    return lines.join("\n");
}

function markdownRouteTable(rows: RouteNameQualityRow[]): string {
    if (rows.length === 0) {
        return "_None_";
    }

    const header = [
        "| Route | Issues | Confidence | Safe | public_name | en primary | proposed en |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ];
    const body = rows.map((row) => {
        const issues = row.issue_codes.join(", ") || "—";
        return `| ${row.route_code} | ${issues} | ${row.confidence} | ${row.safe_to_execute ? "yes" : "no"} | ${escapeCell(row.public_name)} | ${escapeCell(row.primary_name_en)} | ${escapeCell(row.proposed_primary_name_en)} |`;
    });
    return [...header, ...body].join("\n");
}

function escapeCell(value: string | null | undefined): string {
    return (value ?? "—").replace(/\|/g, "\\|");
}
