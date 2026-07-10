/**
 * Shared route file discovery and route_code resolution for YBS import workflow.
 */

import fs from "node:fs";
import path from "node:path";

import { YBS_ROUTE_CODE_PATTERN } from "../../ybs-normalize/route-display-names.js";

export type SourceRouteFile = {
    source_file_key: string;
    source_path: string;
    route_code_candidate: string | null;
};

export type RouteCodeResolution = {
    source_file_key: string;
    source_path: string;
    route_code: string;
    is_numbered_ybs: boolean;
    is_named_route: boolean;
};

export function parseRouteCodesArg(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function isNumberedYbsRouteCode(routeCode: string): boolean {
    return YBS_ROUTE_CODE_PATTERN.test(routeCode);
}

export function listMergedRouteJsonFiles(sourceDir: string): string[] {
    if (!fs.existsSync(sourceDir)) {
        return [];
    }

    return fs
        .readdirSync(sourceDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.basename(name, ".json"))
        .sort((left, right) => left.localeCompare(right));
}

export function resolveSourceRouteFiles(
    sourceDir: string,
    options: { routeCodes?: string[]; allRoutes?: boolean },
): SourceRouteFile[] {
    const absoluteSourceDir = path.isAbsolute(sourceDir) ? sourceDir : path.resolve(sourceDir);

    if (options.allRoutes) {
        return listMergedRouteJsonFiles(absoluteSourceDir).map((sourceFileKey) => ({
            source_file_key: sourceFileKey,
            source_path: path.join(absoluteSourceDir, `${sourceFileKey}.json`),
            route_code_candidate: readRouteCodeCandidate(path.join(absoluteSourceDir, `${sourceFileKey}.json`)),
        }));
    }

    if (!options.routeCodes || options.routeCodes.length === 0) {
        throw new Error("Provide --routes YBS-3,YBS-4 or --all-routes.");
    }

    return options.routeCodes.map((routeCode) => ({
        source_file_key: routeCode,
        source_path: path.join(absoluteSourceDir, `${routeCode}.json`),
        route_code_candidate: readRouteCodeCandidate(path.join(absoluteSourceDir, `${routeCode}.json`)),
    }));
}

function readRouteCodeCandidate(filePath: string): string | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const input = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
            route?: {
                route_code?: string | null;
                route_code_candidate?: string | null;
            };
        };
        const fromRoute =
            (typeof input.route?.route_code === "string" && input.route.route_code.trim()) ||
            (typeof input.route?.route_code_candidate === "string" &&
                input.route.route_code_candidate.trim());
        return fromRoute || path.basename(filePath, ".json");
    } catch {
        return path.basename(filePath, ".json");
    }
}

export function buildRouteCodeResolutions(
    sourceFiles: SourceRouteFile[],
    normalizedRouteCodes: Map<string, string>,
): {
    resolutions: RouteCodeResolution[];
    duplicate_route_codes: Array<{ route_code: string; source_file_keys: string[] }>;
} {
    const resolutions: RouteCodeResolution[] = [];
    const byRouteCode = new Map<string, string[]>();

    for (const sourceFile of sourceFiles) {
        const routeCode =
            normalizedRouteCodes.get(sourceFile.source_file_key) ??
            sourceFile.route_code_candidate ??
            sourceFile.source_file_key;

        resolutions.push({
            source_file_key: sourceFile.source_file_key,
            source_path: sourceFile.source_path,
            route_code: routeCode,
            is_numbered_ybs: isNumberedYbsRouteCode(routeCode),
            is_named_route: !isNumberedYbsRouteCode(routeCode),
        });

        const existing = byRouteCode.get(routeCode) ?? [];
        existing.push(sourceFile.source_file_key);
        byRouteCode.set(routeCode, existing);
    }

    const duplicate_route_codes = [...byRouteCode.entries()]
        .filter(([, keys]) => keys.length > 1)
        .map(([route_code, source_file_keys]) => ({ route_code, source_file_keys }));

    return { resolutions, duplicate_route_codes };
}
