import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { TrainLanguage } from "./types.js";

/** Default working folder for train import JSON (gitignored under tmp/). */
export const DEFAULT_RUN_ROOT = "tmp/train-import";

export type TrainRunPaths = {
    runRoot: string;
};

export function repoRoot(): string {
    return process.cwd();
}

export function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

export function defaultRunPaths(runRoot: string = DEFAULT_RUN_ROOT): TrainRunPaths {
    return { runRoot: resolveFromRepo(runRoot) };
}

/**
 * Stable filename key for one train_number + direction pair.
 * Example: "11" + "up" → "11__up"
 */
export function trainRouteKey(trainNumber: string, direction: string): string {
    const sanitize = (value: string): string =>
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");

    const numberPart = sanitize(trainNumber) || "unknown_train";
    const directionPart = sanitize(direction) || "unknown_direction";
    return `${numberPart}__${directionPart}`;
}

// ---------------------------------------------------------------------------
// Raw extraction paths
// ---------------------------------------------------------------------------

export function rawLanguageDir(paths: TrainRunPaths, language: TrainLanguage): string {
    return path.join(paths.runRoot, "raw", language);
}

export function rawRouteIndexPath(paths: TrainRunPaths, language: TrainLanguage): string {
    return path.join(rawLanguageDir(paths, language), "route-index.json");
}

/** Route list extraction output (All tab index pass). */
export function rawRouteListPath(paths: TrainRunPaths, language: TrainLanguage): string {
    return path.join(rawLanguageDir(paths, language), "route-list.json");
}

export function rawRouteListPageSourcesDir(paths: TrainRunPaths, language: TrainLanguage): string {
    return path.join(rawLanguageDir(paths, language), "route-list", "page-sources");
}

export function rawRouteListScreenshotsDir(paths: TrainRunPaths, language: TrainLanguage): string {
    return path.join(rawLanguageDir(paths, language), "route-list", "screenshots");
}

export function rawRoutesDir(paths: TrainRunPaths, language: TrainLanguage): string {
    return path.join(rawLanguageDir(paths, language), "routes");
}

export function rawRouteDetailPath(
    paths: TrainRunPaths,
    language: TrainLanguage,
    trainNumber: string,
    direction: string,
): string {
    const key = trainRouteKey(trainNumber, direction);
    return path.join(rawRoutesDir(paths, language), `${key}.json`);
}

export function rawRouteDetailPathByVariantCode(
    paths: TrainRunPaths,
    language: TrainLanguage,
    variantCode: string,
): string {
    return path.join(rawRoutesDir(paths, language), `${variantCode}.json`);
}

export function rawPageSourcesDirByVariantCode(
    paths: TrainRunPaths,
    language: TrainLanguage,
    variantCode: string,
): string {
    return path.join(rawLanguageDir(paths, language), "page-sources", variantCode);
}

export function rawRouteDetailScreenshotsDir(
    paths: TrainRunPaths,
    language: TrainLanguage,
    variantCode: string,
): string {
    return path.join(rawLanguageDir(paths, language), "screenshots", variantCode);
}

// ---------------------------------------------------------------------------
// Pipeline stage paths
// ---------------------------------------------------------------------------

export function mergedDir(paths: TrainRunPaths): string {
    return path.join(paths.runRoot, "merged");
}

export function mergedRoutePath(
    paths: TrainRunPaths,
    trainNumber: string,
    direction: string,
): string {
    const key = trainRouteKey(trainNumber, direction);
    return path.join(mergedDir(paths), `${key}.json`);
}

/** Merged output file named by variant_code, e.g. TRAIN-11-UP.json */
export function mergedRoutePathByVariantCode(paths: TrainRunPaths, variantCode: string): string {
    return path.join(mergedDir(paths), `${variantCode}.json`);
}

export function normalizedDir(paths: TrainRunPaths): string {
    return path.join(paths.runRoot, "normalized");
}

export function normalizedRoutePath(
    paths: TrainRunPaths,
    trainNumber: string,
    direction: string,
): string {
    const key = trainRouteKey(trainNumber, direction);
    return path.join(normalizedDir(paths), `${key}.json`);
}

export function stationMatchesDir(paths: TrainRunPaths): string {
    return path.join(paths.runRoot, "station-matches");
}

export function stationMatchPath(
    paths: TrainRunPaths,
    trainNumber: string,
    direction: string,
): string {
    const key = trainRouteKey(trainNumber, direction);
    return path.join(stationMatchesDir(paths), `${key}.json`);
}

export function autoMatchesPath(paths: TrainRunPaths): string {
    return path.join(stationMatchesDir(paths), "auto-matches.json");
}

export function unmatchedStationsPath(paths: TrainRunPaths): string {
    return path.join(stationMatchesDir(paths), "unmatched-stations.json");
}

export function manualOverridesPath(paths: TrainRunPaths): string {
    return path.join(stationMatchesDir(paths), "manual-overrides.json");
}

export function importReadyRoutePathByVariantCode(
    paths: TrainRunPaths,
    variantCode: string,
): string {
    return path.join(importReadyDir(paths), `${variantCode}.json`);
}

export function importReadyDir(paths: TrainRunPaths): string {
    return path.join(paths.runRoot, "import-ready");
}

export function importReadyRoutePath(
    paths: TrainRunPaths,
    trainNumber: string,
    direction: string,
): string {
    const key = trainRouteKey(trainNumber, direction);
    return path.join(importReadyDir(paths), `${key}.json`);
}

export function reportsDir(paths: TrainRunPaths): string {
    return path.join(paths.runRoot, "reports");
}

export function reportPath(paths: TrainRunPaths, filename: string): string {
    return path.join(reportsDir(paths), filename);
}

export function trainRouteValidationReportPath(paths: TrainRunPaths, variantCode: string): string {
    return path.join(reportsDir(paths), `${variantCode}-validation.json`);
}

export function normalizedRoutePathByVariantCode(paths: TrainRunPaths, variantCode: string): string {
    return path.join(normalizedDir(paths), `${variantCode}.json`);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Create standard tmp/train-import folders. Safe to call before every script run. */
export function ensureRunLayout(paths: TrainRunPaths): void {
    const dirs = [
        rawLanguageDir(paths, "en"),
        rawLanguageDir(paths, "my"),
        rawRoutesDir(paths, "en"),
        rawRoutesDir(paths, "my"),
        rawRouteListPageSourcesDir(paths, "en"),
        rawRouteListPageSourcesDir(paths, "my"),
        rawRouteListScreenshotsDir(paths, "en"),
        rawRouteListScreenshotsDir(paths, "my"),
        mergedDir(paths),
        normalizedDir(paths),
        stationMatchesDir(paths),
        importReadyDir(paths),
        reportsDir(paths),
    ];

    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
