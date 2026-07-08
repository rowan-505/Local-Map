import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** Default ADB device id for YBS extraction. */
export const DEFAULT_DEVICE_ID = "R3CX10JRQNZ";

/** YBS Go Android package name. */
export const DEFAULT_PACKAGE = "com.ybsgo.app";

/** Default output root under repo tmp. */
export const DEFAULT_OUTPUT_ROOT = "tmp/transport-imports/ybs-all";

/** Phase 4 extraction schema version written to route JSON files. */
export const EXTRACTION_SCHEMA_VERSION = 2;

export type ExtractionLanguage = "my" | "en";

/** Header texts to ignore when parsing stop lists. */
export const YBS_HEADER_TEXTS = new Set([
    "ဘတ်စ်အသေးစိတ်",
    "မျှဝေမည်",
    "အသွား",
    "အပြန်",
    "အားလုံး",
]);

export type YbsExtractionConfig = {
    deviceId: string;
    packageName: string;
    outputRoot: string;
    maxScrolls: number;
    scrollPauseMs: number;
};

export function repoRoot(): string {
    return process.cwd();
}

export function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

export function defaultConfig(overrides: Partial<YbsExtractionConfig> = {}): YbsExtractionConfig {
    return {
        deviceId: DEFAULT_DEVICE_ID,
        packageName: DEFAULT_PACKAGE,
        outputRoot: DEFAULT_OUTPUT_ROOT,
        maxScrolls: 60,
        scrollPauseMs: 900,
        ...overrides,
    };
}

/** Active Phase 4 run root, e.g. tmp/transport-imports/ybs-all. */
export function runRootDir(config: YbsExtractionConfig): string {
    return resolveFromRepo(config.outputRoot);
}

/** Route index JSON for one UI language. */
export function routeIndexPath(config: YbsExtractionConfig, language: ExtractionLanguage = "my"): string {
    return resolveFromRepo(
        path.join(config.outputRoot, "route-index", `route-index-${language}.json`),
    );
}

/** Route index XML page-source dumps. */
export function routeIndexPageSourcesDir(config: YbsExtractionConfig): string {
    return resolveFromRepo(path.join(config.outputRoot, "route-index", "page-sources"));
}

/** Language-specific route JSON directory. */
export function languageRoutesDir(config: YbsExtractionConfig, language: ExtractionLanguage): string {
    return resolveFromRepo(path.join(config.outputRoot, language, "routes"));
}

/** One extracted route JSON path. */
export function languageRouteJsonPath(
    config: YbsExtractionConfig,
    language: ExtractionLanguage,
    routeCode: string,
): string {
    return path.join(languageRoutesDir(config, language), `${routeCode}.json`);
}

/** Language-specific page-source root for one route. */
export function languagePageSourcesDir(
    config: YbsExtractionConfig,
    language: ExtractionLanguage,
    routeCode: string,
): string {
    return resolveFromRepo(path.join(config.outputRoot, language, "page-sources", routeCode));
}

/** Language-specific screenshots directory for one route. */
export function languageScreenshotsDir(
    config: YbsExtractionConfig,
    language: ExtractionLanguage,
    routeCode: string,
): string {
    return resolveFromRepo(path.join(config.outputRoot, language, "screenshots", routeCode));
}

/** Merged Myanmar + English route JSON for one route code. */
export function mergedRoutePath(config: YbsExtractionConfig, routeCode: string): string {
    return resolveFromRepo(path.join(config.outputRoot, "merged", "routes", `${routeCode}.json`));
}

/** Batch and validation reports. */
export function reportsDir(config: YbsExtractionConfig): string {
    return resolveFromRepo(path.join(config.outputRoot, "reports"));
}

/** Run manifest for the active Phase 4 extraction folder. */
export function runManifestPath(config: YbsExtractionConfig): string {
    return resolveFromRepo(path.join(config.outputRoot, "raw-extracted.json"));
}

/**
 * @deprecated Legacy V1 layout: tmp/transport-imports/ybs-2/raw-extracted.json
 * Use languageRouteJsonPath() instead.
 */
export function rawExtractedPath(config: YbsExtractionConfig, routeKey: string): string {
    return path.join(resolveFromRepo(path.join(config.outputRoot, routeKey)), "raw-extracted.json");
}

/**
 * @deprecated Use mergedRoutePath(config, routeCode) instead.
 */
export function mergedRoutesPath(config: YbsExtractionConfig): string {
    return resolveFromRepo(path.join(config.outputRoot, "merged-routes.json"));
}

/** Ensure standard Phase 4 output folders exist under the run root. */
export function ensureRunLayout(config: YbsExtractionConfig): void {
    const dirs = [
        routeIndexPageSourcesDir(config),
        languageRoutesDir(config, "my"),
        languageRoutesDir(config, "en"),
        resolveFromRepo(path.join(config.outputRoot, "my", "page-sources")),
        resolveFromRepo(path.join(config.outputRoot, "en", "page-sources")),
        resolveFromRepo(path.join(config.outputRoot, "my", "screenshots")),
        resolveFromRepo(path.join(config.outputRoot, "en", "screenshots")),
        resolveFromRepo(path.join(config.outputRoot, "merged", "routes")),
        reportsDir(config),
    ];

    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
