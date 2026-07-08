/**
 * Validate Stage 7 route index and Stage 8 route detail identity policy.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveFromRepo } from "./config.js";
import {
    isNamedOfficialDisplayCode,
    isTruncatedBadge,
    normalizePublicRouteTitle,
    type RouteIdentityRecord,
} from "./route-identity.js";
import { loadRouteIndexFile, type RouteIndexLanguage } from "./route-index-store.js";

export type ValidationSeverity = "error" | "warning";

export type ValidationFinding = {
    check_id: string;
    severity: ValidationSeverity;
    message: string;
    route_code?: string | null;
    list_order?: number | null;
    source: "route_index" | "route_detail";
    file?: string;
};

export type RouteIdentityValidationReport = {
    generated_at: string;
    run_root: string;
    language: RouteIndexLanguage;
    route_index_path: string;
    route_detail_dir: string;
    summary: {
        route_index_count: number;
        route_detail_count: number;
        error_count: number;
        warning_count: number;
        passed: boolean;
    };
    checks: Array<{
        check_id: string;
        title: string;
        error_count: number;
        warning_count: number;
    }>;
    findings: ValidationFinding[];
};

export type ValidateRouteIdentityOptions = {
    runRoot: string;
    language: RouteIndexLanguage;
    indexPath?: string;
};

const CHECK_TITLES: Record<string, string> = {
    numeric_route_number_type: "route_number is number or null only",
    route_number_not_fake: "route_number is not fake",
    unique_route_code_candidate: "route_code_candidate is unique when not null",
    duplicate_numeric_suffixes: "duplicate route numbers use YBS-<n>-A/B/C suffixes",
    unique_numeric_code_format: "unique route numbers use YBS-<number>",
    named_route_aps: "named route APS uses route_number = null and code APS",
    truncated_unclear_cards: "truncated or unclear cards need review before confirmation",
    separate_routes_for_duplicate_titles: "same route number + different title = separate routes",
    detail_variant_directions: "route detail has only outbound and inbound variants",
    no_four_variant_routes: "no route has 4 variants from duplicate bus grouping",
    stop_count_validation: "direction stop sum matches app_total_stop_count when available",
    numeric_field_types: "numeric fields are numbers",
};

type YbsNumericCode = {
    routeNumber: number;
    suffix: string | null;
};

type RouteDetailFile = {
    filePath: string;
    routeCode: string;
    route: Record<string, unknown>;
    route_index_identity: Record<string, unknown> | null;
    route_detail_identity: Record<string, unknown> | null;
    variants: Array<Record<string, unknown>>;
    validation: Record<string, unknown> | null;
    warnings: string[];
};

function isCliInvocation(): boolean {
    const entry = process.argv[1] ?? "";
    return (
        entry.endsWith("validate-route-identity.ts") ||
        entry.endsWith("validate-route-identity.js")
    );
}

function isNumberOrNull(value: unknown): boolean {
    return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isPositiveIntegerOrNull(value: unknown): boolean {
    return value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function parseYbsNumericCode(code: string | null | undefined): YbsNumericCode | null {
    if (!code) {
        return null;
    }

    const match = code.trim().match(/^YBS-(\d+)(?:-([A-Z]))?$/);
    if (!match) {
        return null;
    }

    return {
        routeNumber: Number(match[1]),
        suffix: match[2] ?? null,
    };
}

function routeIndexPathFor(runRoot: string, language: RouteIndexLanguage, indexPath?: string): string {
    if (indexPath) {
        return resolveFromRepo(indexPath);
    }

    return resolveFromRepo(path.join(runRoot, "route-index", `route-index-${language}.json`));
}

function routeDetailDirFor(runRoot: string, language: RouteIndexLanguage): string {
    return resolveFromRepo(path.join(runRoot, language, "routes"));
}

function reportPaths(runRoot: string, language: RouteIndexLanguage): {
    markdownPath: string;
    jsonPath: string;
} {
    const reportsDir = resolveFromRepo(path.join(runRoot, "reports"));
    return {
        markdownPath: path.join(reportsDir, `route-identity-validation-${language}.md`),
        jsonPath: path.join(reportsDir, `route-identity-validation-${language}.json`),
    };
}

function pushFinding(
    findings: ValidationFinding[],
    finding: ValidationFinding,
): void {
    findings.push(finding);
}

function loadRouteDetailFiles(routeDetailDir: string): RouteDetailFile[] {
    if (!fs.existsSync(routeDetailDir)) {
        return [];
    }

    return fs
        .readdirSync(routeDetailDir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => {
            const filePath = path.join(routeDetailDir, name);
            const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
            const route = (raw.route as Record<string, unknown>) ?? {};
            const routeCode =
                (route.route_code_candidate as string | undefined) ??
                (route.route_code as string | undefined) ??
                name.replace(/\.json$/, "");

            return {
                filePath,
                routeCode,
                route,
                route_index_identity: (raw.route_index_identity as Record<string, unknown> | null) ?? null,
                route_detail_identity: (raw.route_detail_identity as Record<string, unknown> | null) ?? null,
                variants: Array.isArray(raw.variants) ? (raw.variants as Array<Record<string, unknown>>) : [],
                validation: (raw.validation as Record<string, unknown> | null) ?? null,
                warnings: Array.isArray(raw.warnings) ? (raw.warnings as string[]) : [],
            };
        });
}

function checkNumericRouteNumberType(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const route of routes) {
        if (!isNumberOrNull(route.route_number)) {
            pushFinding(findings, {
                check_id: "numeric_route_number_type",
                severity: "error",
                message: `route_number must be number or null, got ${typeof route.route_number}`,
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }
    }
}

function checkRouteNumberNotFake(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const route of routes) {
        const routeNumber = route.route_number;
        const code = route.route_code_candidate;
        const parsedCode = parseYbsNumericCode(code);

        if (routeNumber !== null && !Number.isInteger(routeNumber)) {
            pushFinding(findings, {
                check_id: "route_number_not_fake",
                severity: "error",
                message: `route_number must be a positive integer when set`,
                route_code: code,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (routeNumber !== null && routeNumber <= 0) {
            pushFinding(findings, {
                check_id: "route_number_not_fake",
                severity: "error",
                message: `route_number must be > 0 when set`,
                route_code: code,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (parsedCode && routeNumber !== null && parsedCode.routeNumber !== routeNumber) {
            pushFinding(findings, {
                check_id: "route_number_not_fake",
                severity: "error",
                message: `route_number ${routeNumber} does not match route_code_candidate ${code}`,
                route_code: code,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (
            isNamedOfficialDisplayCode(route.route_display_code) &&
            routeNumber !== null
        ) {
            pushFinding(findings, {
                check_id: "route_number_not_fake",
                severity: "error",
                message: `named display code "${route.route_display_code}" must not have route_number`,
                route_code: code,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        const display = route.route_display_code?.trim() ?? "";
        if (/^[၀-၉\d]+$/.test(display) && routeNumber !== null) {
            const displayNumber = Number(display.replace(/[၀-၉]/g, (char) => {
                const map: Record<string, string> = {
                    "၀": "0",
                    "၁": "1",
                    "၂": "2",
                    "၃": "3",
                    "၄": "4",
                    "၅": "5",
                    "၆": "6",
                    "၇": "7",
                    "၈": "8",
                    "၉": "9",
                };
                return map[char] ?? char;
            }));

            if (Number.isFinite(displayNumber) && displayNumber !== routeNumber) {
                pushFinding(findings, {
                    check_id: "route_number_not_fake",
                    severity: "warning",
                    message: `pure numeric badge "${display}" does not match route_number ${routeNumber}`,
                    route_code: code,
                    list_order: route.list_order,
                    source: "route_index",
                });
            }
        }
    }
}

function checkUniqueRouteCodeCandidate(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    const seen = new Map<string, RouteIdentityRecord>();

    for (const route of routes) {
        const code = route.route_code_candidate;
        if (!code) {
            continue;
        }

        const previous = seen.get(code);
        if (previous) {
            pushFinding(findings, {
                check_id: "unique_route_code_candidate",
                severity: "error",
                message: `duplicate route_code_candidate "${code}" (list_order ${previous.list_order} and ${route.list_order})`,
                route_code: code,
                list_order: route.list_order,
                source: "route_index",
            });
            continue;
        }

        seen.set(code, route);
    }
}

function routeTitleKey(route: RouteIdentityRecord): string {
    return route.route_title_my ?? route.route_title_en ?? `__row_${route.list_order}`;
}

function distinctTitleCount(group: RouteIdentityRecord[]): number {
    return new Set(group.map(routeTitleKey)).size;
}

function groupRoutesByNumber(routes: RouteIdentityRecord[]): Map<number, RouteIdentityRecord[]> {
    const groups = new Map<number, RouteIdentityRecord[]>();

    for (const route of routes) {
        if (route.route_number === null) {
            continue;
        }

        const group = groups.get(route.route_number) ?? [];
        group.push(route);
        groups.set(route.route_number, group);
    }

    return groups;
}

function checkDuplicateNumericSuffixes(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const [routeNumber, group] of groupRoutesByNumber(routes).entries()) {
        const titleGroups = new Map<string, RouteIdentityRecord[]>();

        for (const route of group) {
            const titleKey = routeTitleKey(route);
            const bucket = titleGroups.get(titleKey) ?? [];
            bucket.push(route);
            titleGroups.set(titleKey, bucket);
        }

        if (titleGroups.size <= 1) {
            continue;
        }

        const suffixes = group
            .map((route) => parseYbsNumericCode(route.route_code_candidate))
            .filter((parsed): parsed is YbsNumericCode => parsed !== null);

        if (suffixes.length !== group.length) {
            pushFinding(findings, {
                check_id: "duplicate_numeric_suffixes",
                severity: "error",
                message: `route_number ${routeNumber} has ${group.length} separate routes but not all use YBS-${routeNumber}-<suffix> codes`,
                route_code: `YBS-${routeNumber}`,
                source: "route_index",
            });
            continue;
        }

        for (const route of group) {
            const parsed = parseYbsNumericCode(route.route_code_candidate);
            if (!parsed?.suffix) {
                pushFinding(findings, {
                    check_id: "duplicate_numeric_suffixes",
                    severity: "error",
                    message: `route_number ${routeNumber} duplicate route must use suffix code, got ${route.route_code_candidate}`,
                    route_code: route.route_code_candidate,
                    list_order: route.list_order,
                    source: "route_index",
                });
            }

            if (route.duplicate_number_group_key !== `YBS-${routeNumber}`) {
                pushFinding(findings, {
                    check_id: "duplicate_numeric_suffixes",
                    severity: "error",
                    message: `expected duplicate_number_group_key YBS-${routeNumber}`,
                    route_code: route.route_code_candidate,
                    list_order: route.list_order,
                    source: "route_index",
                });
            }
        }
    }
}

function checkUniqueNumericCodeFormat(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const [routeNumber, group] of groupRoutesByNumber(routes).entries()) {
        if (group.length === 1 || distinctTitleCount(group) > 1) {
            continue;
        }

        for (const route of group) {
            const expected = `YBS-${routeNumber}`;
            if (route.route_code_candidate !== expected) {
                pushFinding(findings, {
                    check_id: "unique_numeric_code_format",
                    severity: "error",
                    message: `unique route_number ${routeNumber} should use ${expected}, got ${route.route_code_candidate}`,
                    route_code: route.route_code_candidate,
                    list_order: route.list_order,
                    source: "route_index",
                });
            }

            if (route.identity_status !== "unique_numeric_route_candidate") {
                pushFinding(findings, {
                    check_id: "unique_numeric_code_format",
                    severity: "warning",
                    message: `unique route_number ${routeNumber} should have identity_status unique_numeric_route_candidate`,
                    route_code: route.route_code_candidate,
                    list_order: route.list_order,
                    source: "route_index",
                });
            }
        }
    }
}

function checkNamedRouteAps(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const route of routes) {
        const isAps =
            route.route_code_candidate === "APS" ||
            route.route_display_code?.trim().toUpperCase() === "APS";

        if (!isAps) {
            continue;
        }

        if (route.route_number !== null) {
            pushFinding(findings, {
                check_id: "named_route_aps",
                severity: "error",
                message: "APS route must have route_number = null",
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (route.route_code_candidate !== "APS") {
            pushFinding(findings, {
                check_id: "named_route_aps",
                severity: "error",
                message: `APS route must use route_code_candidate APS, got ${route.route_code_candidate}`,
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (route.identity_status !== "named_route_candidate") {
            pushFinding(findings, {
                check_id: "named_route_aps",
                severity: "warning",
                message: `APS route should have identity_status named_route_candidate`,
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }
    }
}

function checkTruncatedUnclearCards(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const route of routes) {
        const truncatedBadge = isTruncatedBadge(route.route_display_code);
        const unclearStatus =
            route.identity_status === "truncated_code_needs_detail" ||
            route.identity_status === "unknown_needs_review";

        if (!truncatedBadge && !unclearStatus && !route.needs_detail_confirmation) {
            continue;
        }

        if (
            truncatedBadge &&
            route.route_code_candidate !== null &&
            route.identity_status !== "named_route_candidate"
        ) {
            pushFinding(findings, {
                check_id: "truncated_unclear_cards",
                severity: "error",
                message: `truncated badge "${route.route_display_code}" must not have route_code_candidate before detail confirmation`,
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (unclearStatus && route.route_code_candidate !== null) {
            pushFinding(findings, {
                check_id: "truncated_unclear_cards",
                severity: "error",
                message: `${route.identity_status} must keep route_code_candidate null before detail confirmation`,
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }

        if (
            (truncatedBadge || unclearStatus) &&
            !route.needs_detail_confirmation &&
            route.identity_status !== "named_route_candidate"
        ) {
            pushFinding(findings, {
                check_id: "truncated_unclear_cards",
                severity: "warning",
                message: `unclear index card should set needs_detail_confirmation = true`,
                route_code: route.route_code_candidate,
                list_order: route.list_order,
                source: "route_index",
            });
        }
    }
}

function checkSeparateRoutesForDuplicateTitles(
    routes: RouteIdentityRecord[],
    findings: ValidationFinding[],
): void {
    for (const [routeNumber, group] of groupRoutesByNumber(routes).entries()) {
        if (distinctTitleCount(group) <= 1) {
            continue;
        }

        const codes = new Set(
            group.map((route) => route.route_code_candidate).filter((code): code is string => Boolean(code)),
        );

        if (codes.size < distinctTitleCount(group)) {
            pushFinding(findings, {
                check_id: "separate_routes_for_duplicate_titles",
                severity: "error",
                message: `route_number ${routeNumber} has ${distinctTitleCount(group)} different titles but only ${codes.size} route_code_candidate values`,
                route_code: `YBS-${routeNumber}`,
                source: "route_index",
            });
        }

        const byTitle = new Map<string, Set<string>>();

        for (const route of group) {
            const title = routeTitleKey(route);
            const code = route.route_code_candidate ?? `__pending_${route.list_order}`;
            const codesForTitle = byTitle.get(title) ?? new Set<string>();
            codesForTitle.add(code);
            byTitle.set(title, codesForTitle);
        }

        for (const route of group) {
            const title = routeTitleKey(route);
            const sameTitleRoutes = group.filter((other) => routeTitleKey(other) === title);

            if (sameTitleRoutes.length > 1) {
                const uniqueCodes = new Set(
                    sameTitleRoutes
                        .map((item) => item.route_code_candidate)
                        .filter((code): code is string => Boolean(code)),
                );
                if (uniqueCodes.size > 1) {
                    pushFinding(findings, {
                        check_id: "separate_routes_for_duplicate_titles",
                        severity: "error",
                        message: `same route_number ${routeNumber} and same public title should share one route_code_candidate`,
                        route_code: route.route_code_candidate,
                        list_order: route.list_order,
                        source: "route_index",
                    });
                }
            }
        }
    }
}

function checkDetailVariantDirections(
    detailFiles: RouteDetailFile[],
    findings: ValidationFinding[],
): void {
    for (const detail of detailFiles) {
        const directionKeys = detail.variants.map((variant) => String(variant.direction_key ?? variant.direction_name ?? ""));

        for (const directionKey of directionKeys) {
            if (directionKey !== "outbound" && directionKey !== "inbound") {
                pushFinding(findings, {
                    check_id: "detail_variant_directions",
                    severity: "error",
                    message: `invalid variant direction "${directionKey}"`,
                    route_code: detail.routeCode,
                    source: "route_detail",
                    file: detail.filePath,
                });
            }
        }

        if (detail.variants.length > 2) {
            pushFinding(findings, {
                check_id: "detail_variant_directions",
                severity: "error",
                message: `route detail has ${detail.variants.length} variants; expected outbound and inbound only`,
                route_code: detail.routeCode,
                source: "route_detail",
                file: detail.filePath,
            });
        }
    }
}

function checkNoFourVariantRoutes(
    detailFiles: RouteDetailFile[],
    findings: ValidationFinding[],
): void {
    for (const detail of detailFiles) {
        if (detail.variants.length >= 4) {
            pushFinding(findings, {
                check_id: "no_four_variant_routes",
                severity: "error",
                message: `route has ${detail.variants.length} variants; policy allows outbound + inbound only`,
                route_code: detail.routeCode,
                source: "route_detail",
                file: detail.filePath,
            });
        }

        const directionCounts = new Map<string, number>();
        for (const variant of detail.variants) {
            const key = String(variant.direction_key ?? variant.direction_name ?? "unknown");
            directionCounts.set(key, (directionCounts.get(key) ?? 0) + 1);
        }

        for (const [direction, count] of directionCounts.entries()) {
            if (count > 1) {
                pushFinding(findings, {
                    check_id: "no_four_variant_routes",
                    severity: "error",
                    message: `duplicate "${direction}" variant appears ${count} times`,
                    route_code: detail.routeCode,
                    source: "route_detail",
                    file: detail.filePath,
                });
            }
        }
    }
}

function checkStopCountValidation(
    detailFiles: RouteDetailFile[],
    findings: ValidationFinding[],
): void {
    for (const detail of detailFiles) {
        const appTotal =
            (detail.route.app_total_stop_count as number | null | undefined) ??
            (detail.route.stop_count as number | null | undefined) ??
            null;

        if (appTotal === null || appTotal === undefined) {
            continue;
        }

        const outboundCount = Number(
            detail.variants.find((variant) => variant.direction_key === "outbound")?.stop_count ?? 0,
        );
        const inboundCount = Number(
            detail.variants.find((variant) => variant.direction_key === "inbound")?.stop_count ?? 0,
        );
        const directionSum = outboundCount + inboundCount;

        const validationMatches = detail.validation?.matches_app_total_stop_count;
        if (validationMatches === false) {
            pushFinding(findings, {
                check_id: "stop_count_validation",
                severity: "warning",
                message: `validation.matches_app_total_stop_count is false (${directionSum} vs app ${appTotal})`,
                route_code: detail.routeCode,
                source: "route_detail",
                file: detail.filePath,
            });
        } else if (validationMatches === null || validationMatches === undefined) {
            if (directionSum !== appTotal) {
                pushFinding(findings, {
                    check_id: "stop_count_validation",
                    severity: "warning",
                    message: `direction_stop_count_sum ${directionSum} does not match app_total_stop_count ${appTotal}`,
                    route_code: detail.routeCode,
                    source: "route_detail",
                    file: detail.filePath,
                });
            }
        }

        if (detail.warnings.includes("TOTAL_STOP_COUNT_MISMATCH")) {
            pushFinding(findings, {
                check_id: "stop_count_validation",
                severity: "warning",
                message: "route detail warnings include TOTAL_STOP_COUNT_MISMATCH",
                route_code: detail.routeCode,
                source: "route_detail",
                file: detail.filePath,
            });
        }
    }
}

function checkNumericFieldTypes(
    routes: RouteIdentityRecord[],
    detailFiles: RouteDetailFile[],
    findings: ValidationFinding[],
): void {
    for (const route of routes) {
        for (const field of ["fare_min", "fare_max", "app_total_stop_count", "duplicate_number_group_index"] as const) {
            const value = route[field];
            if (value !== null && value !== undefined && typeof value !== "number") {
                pushFinding(findings, {
                    check_id: "numeric_field_types",
                    severity: "error",
                    message: `route index ${field} must be number or null`,
                    route_code: route.route_code_candidate,
                    list_order: route.list_order,
                    source: "route_index",
                });
            }
        }
    }

    for (const detail of detailFiles) {
        for (const field of ["route_number", "fare_min", "fare_max", "app_total_stop_count"] as const) {
            const value = detail.route[field];
            if (value !== null && value !== undefined && typeof value !== "number") {
                pushFinding(findings, {
                    check_id: "numeric_field_types",
                    severity: "error",
                    message: `route detail ${field} must be number or null`,
                    route_code: detail.routeCode,
                    source: "route_detail",
                    file: detail.filePath,
                });
            }
        }

        for (const variant of detail.variants) {
            const stopCount = variant.stop_count;
            if (stopCount !== null && stopCount !== undefined && typeof stopCount !== "number") {
                pushFinding(findings, {
                    check_id: "numeric_field_types",
                    severity: "error",
                    message: "variant stop_count must be number",
                    route_code: detail.routeCode,
                    source: "route_detail",
                    file: detail.filePath,
                });
            }

            const stops = Array.isArray(variant.stops) ? variant.stops : [];
            for (const stop of stops) {
                const sequence = (stop as Record<string, unknown>).sequence;
                if (sequence !== null && sequence !== undefined && typeof sequence !== "number") {
                    pushFinding(findings, {
                        check_id: "numeric_field_types",
                        severity: "error",
                        message: "stop sequence must be number",
                        route_code: detail.routeCode,
                        source: "route_detail",
                        file: detail.filePath,
                    });
                }
            }
        }
    }
}

function summarizeChecks(findings: ValidationFinding[]): RouteIdentityValidationReport["checks"] {
    return Object.entries(CHECK_TITLES).map(([check_id, title]) => {
        const bucket = findings.filter((finding) => finding.check_id === check_id);
        return {
            check_id,
            title,
            error_count: bucket.filter((finding) => finding.severity === "error").length,
            warning_count: bucket.filter((finding) => finding.severity === "warning").length,
        };
    });
}

function renderMarkdown(report: RouteIdentityValidationReport): string {
    const lines: string[] = [
        "# Route Identity Validation",
        "",
        `- Generated: ${report.generated_at}`,
        `- Run root: ${report.run_root}`,
        `- Language: ${report.language}`,
        `- Route index: ${report.route_index_path}`,
        `- Route detail dir: ${report.route_detail_dir}`,
        `- Route index rows: ${report.summary.route_index_count}`,
        `- Route detail files: ${report.summary.route_detail_count}`,
        `- Errors: ${report.summary.error_count}`,
        `- Warnings: ${report.summary.warning_count}`,
        `- Passed: ${report.summary.passed ? "yes" : "no"}`,
        "",
        "## Check summary",
        "",
        "| Check | Errors | Warnings |",
        "|---|---:|---:|",
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.title} | ${check.error_count} | ${check.warning_count} |`);
    }

    if (report.findings.length === 0) {
        lines.push("", "No findings.");
        return `${lines.join("\n")}\n`;
    }

    lines.push("", "## Findings", "");

    for (const finding of report.findings) {
        const parts = [
            `- [${finding.severity}] ${finding.check_id}`,
            finding.message,
            finding.route_code ? `route=${finding.route_code}` : null,
            finding.list_order ? `list_order=${finding.list_order}` : null,
            finding.file ? `file=${finding.file}` : null,
        ].filter(Boolean);
        lines.push(parts.join(" | "));
    }

    return `${lines.join("\n")}\n`;
}

/** Validate route index and extracted route detail files. */
export function validateRouteIdentity(
    options: ValidateRouteIdentityOptions,
): RouteIdentityValidationReport {
    const routeIndexPath = routeIndexPathFor(options.runRoot, options.language, options.indexPath);
    const routeDetailDir = routeDetailDirFor(options.runRoot, options.language);
    const index = loadRouteIndexFile(routeIndexPath);
    const routes = index.routes;
    const detailFiles = loadRouteDetailFiles(routeDetailDir);
    const findings: ValidationFinding[] = [];

    checkNumericRouteNumberType(routes, findings);
    checkRouteNumberNotFake(routes, findings);
    checkUniqueRouteCodeCandidate(routes, findings);
    checkDuplicateNumericSuffixes(routes, findings);
    checkUniqueNumericCodeFormat(routes, findings);
    checkNamedRouteAps(routes, findings);
    checkTruncatedUnclearCards(routes, findings);
    checkSeparateRoutesForDuplicateTitles(routes, findings);
    checkDetailVariantDirections(detailFiles, findings);
    checkNoFourVariantRoutes(detailFiles, findings);
    checkStopCountValidation(detailFiles, findings);
    checkNumericFieldTypes(routes, detailFiles, findings);

    const errorCount = findings.filter((finding) => finding.severity === "error").length;
    const warningCount = findings.filter((finding) => finding.severity === "warning").length;

    return {
        generated_at: new Date().toISOString(),
        run_root: resolveFromRepo(options.runRoot),
        language: options.language,
        route_index_path: routeIndexPath,
        route_detail_dir: routeDetailDir,
        summary: {
            route_index_count: routes.length,
            route_detail_count: detailFiles.length,
            error_count: errorCount,
            warning_count: warningCount,
            passed: errorCount === 0,
        },
        checks: summarizeChecks(findings),
        findings,
    };
}

export function writeRouteIdentityValidationReport(
    report: RouteIdentityValidationReport,
    outputPaths: { markdownPath: string; jsonPath: string },
): { markdownPath: string; jsonPath: string } {
    fs.mkdirSync(path.dirname(outputPaths.markdownPath), { recursive: true });
    fs.writeFileSync(outputPaths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(outputPaths.markdownPath, renderMarkdown(report), "utf8");
    return outputPaths;
}

function parseCliArgs(argv: string[]): ValidateRouteIdentityOptions {
    const options: ValidateRouteIdentityOptions = {
        runRoot: "tmp/transport-imports/ybs-all",
        language: "my",
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--output-root") && next) {
            options.runRoot = next;
            i++;
        } else if (arg === "--language" && next) {
            if (next !== "my" && next !== "en") {
                throw new Error('--language must be "my" or "en"');
            }
            options.language = next;
            i++;
        } else if (arg === "--from-index" && next) {
            options.indexPath = next;
            i++;
        }
    }

    return options;
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const report = validateRouteIdentity(options);
    const outputPaths = writeRouteIdentityValidationReport(
        report,
        reportPaths(options.runRoot, options.language),
    );

    console.log(`Wrote ${outputPaths.markdownPath}`);
    console.log(`Wrote ${outputPaths.jsonPath}`);
    console.log(
        `Validation ${report.summary.passed ? "passed" : "failed"}: ${report.summary.error_count} errors, ${report.summary.warning_count} warnings`,
    );

    if (!report.summary.passed) {
        process.exitCode = 1;
    }
}

if (isCliInvocation()) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
