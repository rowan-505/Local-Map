/**
 * Load route index items for Stage 8 navigation.
 */

import fs from "node:fs";

import { defaultConfig, routeIndexPath, type YbsExtractionConfig } from "./config.js";
import type { RouteIdentityRecord } from "./route-identity.js";

export type RouteIndexLanguage = "my" | "en";

export type RouteIndexFile = {
    language: RouteIndexLanguage;
    routes: RouteIdentityRecord[];
};

export function loadRouteIndexFile(indexPath: string): RouteIndexFile {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8")) as RouteIndexFile;
    if (!Array.isArray(raw.routes)) {
        throw new Error(`Invalid route index file: ${indexPath}`);
    }
    return raw;
}

export function resolveRouteIndexPath(
    options: {
        runRoot?: string;
        language: RouteIndexLanguage;
        indexPath?: string;
        config?: Partial<YbsExtractionConfig>;
    },
): string {
    if (options.indexPath) {
        return options.indexPath;
    }

    const config = defaultConfig({
        outputRoot: options.runRoot,
        ...options.config,
    });

    return routeIndexPath(config, options.language);
}

export function findRouteIndexItems(index: RouteIndexFile, routeCode: string): RouteIdentityRecord[] {
    const normalized = routeCode.trim();
    const matches = index.routes.filter((route) => route.route_code_candidate === normalized);

    if (matches.length === 0) {
        const known = index.routes
            .map((route) => route.route_code_candidate)
            .filter(Boolean)
            .slice(0, 12)
            .join(", ");

        throw new Error(
            `Route code "${normalized}" was not found in route index. Examples: ${known}`,
        );
    }

    return matches;
}

export function findRouteIndexItem(
    index: RouteIndexFile,
    routeCode: string,
): RouteIdentityRecord {
    return findRouteIndexItems(index, routeCode)[0];
}

export function loadRouteIndexItem(options: {
    routeCode: string;
    language: RouteIndexLanguage;
    runRoot?: string;
    indexPath?: string;
    config?: Partial<YbsExtractionConfig>;
}): RouteIdentityRecord {
    const indexPath = resolveRouteIndexPath(options);
    const index = loadRouteIndexFile(indexPath);
    return findRouteIndexItem(index, options.routeCode);
}

export function listRouteCodesFromIndex(
    index: RouteIndexFile,
    options?: { limit?: number; skipCodes?: Set<string> },
): string[] {
    const skip = options?.skipCodes ?? new Set<string>();
    const seen = new Set<string>();
    const codes: string[] = [];

    for (const route of index.routes) {
        const code = route.route_code_candidate;
        if (!code || skip.has(code) || seen.has(code)) {
            continue;
        }
        seen.add(code);
        codes.push(code);
    }

    if (options?.limit !== undefined) {
        return codes.slice(0, options.limit);
    }

    return codes;
}
