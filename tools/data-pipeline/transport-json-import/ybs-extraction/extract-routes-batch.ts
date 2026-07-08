/**
 * Open selected routes from the route index and extract outbound + inbound detail.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { ensureDevice, setStrictNoRouteListRefresh, sleep } from "./adb.js";
import { defaultConfig, resolveFromRepo } from "./config.js";
import { extractCurrentRoute, type RouteLanguage } from "./extract-current-route.js";
import { ensureOnRouteListScreen, openRouteFromIndex } from "./open-route.js";
import { ROUTE_LIST_LOADING_STATE, YBS_APP_NOT_IN_FOREGROUND, isLikelyRouteBadgeNotOperator } from "./parse-ui-xml.js";
import {
    ROUTE_LIST_LOADING_OR_REFRESHING,
    ROUTE_LIST_REFRESH_GESTURE_BLOCKED,
    TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED,
    parseStrictNoRouteListRefreshFlag,
} from "./ybs-navigation-safety.js";
import {
    listRouteCodesFromIndex,
    loadRouteIndexFile,
    resolveRouteIndexPath,
    type RouteIndexLanguage,
} from "./route-index-store.js";

const BETWEEN_ROUTE_PAUSE_MS = 1200;

export type ExtractRoutesBatchOptions = {
    deviceId: string;
    runRoot: string;
    language: RouteIndexLanguage;
    packageName: string;
    routeCodes: string[];
    fromIndex?: boolean;
    indexPath?: string;
    limit?: number;
    skipExisting?: boolean;
    retryFailed?: boolean;
    maxListScrolls?: number;
    strictNoRouteListRefresh?: boolean;
};

export type ExtractRoutesBatchSuccess = {
    routeCode: string;
    outputPath: string;
    warnings: string[];
};

export type ExtractRoutesBatchFailure = {
    routeCode: string;
    error: string;
    phase: "open" | "extract" | "validate" | "recover";
};

export type ExtractRoutesBatchReport = {
    last_run_at: string;
    run_root: string;
    language: RouteIndexLanguage;
    index_path: string;
    options: {
        limit: number | null;
        skip_existing: boolean;
        retry_failed: boolean;
        from_index: boolean;
    };
    succeeded: ExtractRoutesBatchSuccess[];
    failed: ExtractRoutesBatchFailure[];
    skipped: string[];
};

export type ExtractRoutesBatchResult = {
    report: ExtractRoutesBatchReport;
    reportPath: string;
};

function routeJsonPath(runRoot: string, language: RouteIndexLanguage, routeCode: string): string {
    return resolveFromRepo(path.join(runRoot, language, "routes", `${routeCode}.json`));
}

function batchReportPath(runRoot: string, language: RouteIndexLanguage): string {
    return resolveFromRepo(path.join(runRoot, "reports", `extract-routes-batch-${language}.json`));
}

function loadPreviousFailures(reportPath: string): string[] {
    if (!fs.existsSync(reportPath)) {
        throw new Error(`No previous batch report found at ${reportPath}. Run a batch first.`);
    }

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as ExtractRoutesBatchReport;
    return report.failed.map((entry) => entry.routeCode);
}

function resolveRouteCodes(
    options: ExtractRoutesBatchOptions,
    indexPath: string,
): string[] {
    if (options.retryFailed) {
        return loadPreviousFailures(batchReportPath(options.runRoot, options.language));
    }

    if (options.routeCodes.length > 0) {
        let codes = options.routeCodes;
        if (options.limit !== undefined) {
            codes = codes.slice(0, options.limit);
        }
        return codes;
    }

    if (!options.fromIndex && !options.indexPath) {
        return [];
    }

    const index = loadRouteIndexFile(indexPath);
    const skipCodes = new Set<string>();

    if (options.skipExisting) {
        for (const route of index.routes) {
            const code = route.route_code_candidate;
            if (!code) {
                continue;
            }
            if (fs.existsSync(routeJsonPath(options.runRoot, options.language, code))) {
                skipCodes.add(code);
            }
        }
    }

    return listRouteCodesFromIndex(index, {
        limit: options.limit,
        skipCodes,
    });
}

function validateExtractedRouteOutput(outputPath: string, language: RouteLanguage): string[] {
    const warnings: string[] = [];
    const raw = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
        variants?: Array<{
            direction_key?: string;
            stop_count?: number;
            real_stop_count?: number;
            quality_status?: string;
        }>;
        route?: {
            app_total_stop_count?: number | null;
            route_name_my?: string | null;
            operator_name?: string | null;
            fare_text?: string | null;
            fare_min?: number | null;
            fare_max?: number | null;
        };
        validation?: {
            matches_app_total_stop_count?: boolean | null;
            direction_stop_count_sum?: number;
            quality_status?: string;
        };
        extraction?: {
            extraction_status?: string;
            quality_status?: string;
        };
        warnings?: string[];
    };

    const variants = raw.variants ?? [];
    const outbound = variants.find((variant) => variant.direction_key === "outbound");
    const inbound = variants.find((variant) => variant.direction_key === "inbound");

    if (!outbound) {
        warnings.push("MISSING_OUTBOUND_VARIANT");
    }
    if (!inbound) {
        warnings.push("MISSING_INBOUND_VARIANT");
    }

    const appTotal = raw.route?.app_total_stop_count;
    const outboundCount = outbound?.real_stop_count ?? outbound?.stop_count ?? 0;
    const inboundCount = inbound?.real_stop_count ?? inbound?.stop_count ?? 0;
    const directionSum = raw.validation?.direction_stop_count_sum ?? outboundCount + inboundCount;

    if (appTotal !== null && appTotal !== undefined) {
        if (directionSum !== appTotal) {
            warnings.push("TOTAL_STOP_COUNT_MISMATCH");
            warnings.push(
                `direction_stop_count_sum ${directionSum} does not match app_total_stop_count ${appTotal}`,
            );
        }
    }

    if (raw.warnings?.includes("TOTAL_STOP_COUNT_MISMATCH")) {
        if (!warnings.includes("TOTAL_STOP_COUNT_MISMATCH")) {
            warnings.push("TOTAL_STOP_COUNT_MISMATCH");
        }
    }

    if (language === "my" && !raw.route?.route_name_my) {
        warnings.push("ROUTE_NAME_MY_MISSING");
    }

    if (!raw.route?.operator_name || isLikelyRouteBadgeNotOperator(raw.route.operator_name)) {
        warnings.push("OPERATOR_NAME_MISSING_OR_INVALID");
    }

    return warnings;
}

async function returnToRouteList(
    deviceId: string,
    runRoot: string,
    language: RouteIndexLanguage,
    routeCode: string,
    packageName: string,
): Promise<void> {
    const listProbe = resolveFromRepo(
        path.join(runRoot, language, "page-sources", routeCode, "open-route", "return-to-list.xml"),
    );
    fs.mkdirSync(path.dirname(listProbe), { recursive: true });
    await ensureOnRouteListScreen(deviceId, listProbe, packageName);
    await sleep(BETWEEN_ROUTE_PAUSE_MS);
}

/** Open and extract one or more routes from the route index. */
export async function extractRoutesBatch(
    options: ExtractRoutesBatchOptions,
): Promise<ExtractRoutesBatchResult> {
    ensureDevice(options.deviceId);
    setStrictNoRouteListRefresh(options.strictNoRouteListRefresh ?? true);

    const indexPath = resolveRouteIndexPath({
        runRoot: options.runRoot,
        language: options.language,
        indexPath: options.indexPath,
    });
    const index = loadRouteIndexFile(indexPath);
    const routeCodes = resolveRouteCodes(options, indexPath);

    const succeeded: ExtractRoutesBatchSuccess[] = [];
    const failed: ExtractRoutesBatchFailure[] = [];
    const skipped: string[] = [];

    if (routeCodes.length === 0) {
        throw new Error("No route codes selected for batch extraction.");
    }

    for (const routeCode of routeCodes) {
        if (
            options.skipExisting &&
            !options.retryFailed &&
            fs.existsSync(routeJsonPath(options.runRoot, options.language, routeCode))
        ) {
            skipped.push(routeCode);
            continue;
        }

        const routeIndexItem = index.routes.find((route) => route.route_code_candidate === routeCode);
        if (!routeIndexItem) {
            failed.push({
                routeCode,
                phase: "open",
                error: `Route code "${routeCode}" was not found in ${indexPath}`,
            });
            continue;
        }

        try {
            const openResult = await openRouteFromIndex({
                deviceId: options.deviceId,
                runRoot: options.runRoot,
                language: options.language,
                routeCode,
                packageName: options.packageName,
                indexPath,
                maxListScrolls: options.maxListScrolls,
                routeIndexItem,
                strictNoRouteListRefresh: options.strictNoRouteListRefresh,
            });

            const outputPath = await extractCurrentRoute({
                deviceId: options.deviceId,
                runRoot: options.runRoot,
                language: options.language,
                routeCode,
                direction: "both",
                packageName: options.packageName,
                maxScrolls: 40,
                scrollPauseMs: 700,
                routeIndexIdentity: openResult.routeIndexItem,
                strictNoRouteListRefresh: options.strictNoRouteListRefresh,
            });

            const validationWarnings = validateExtractedRouteOutput(outputPath, options.language);
            const warnings = [...openResult.warnings, ...validationWarnings];

            if (validationWarnings.includes("MISSING_OUTBOUND_VARIANT") ||
                validationWarnings.includes("MISSING_INBOUND_VARIANT")) {
                failed.push({
                    routeCode,
                    phase: "validate",
                    error: validationWarnings.join("; "),
                });
                await returnToRouteList(
                    options.deviceId,
                    options.runRoot,
                    options.language,
                    routeCode,
                    options.packageName,
                );
                continue;
            }

            succeeded.push({
                routeCode,
                outputPath,
                warnings,
            });

            await returnToRouteList(
                options.deviceId,
                options.runRoot,
                options.language,
                routeCode,
                options.packageName,
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const phase: ExtractRoutesBatchFailure["phase"] = message.includes("route detail screen")
                ? "open"
                : "extract";

            failed.push({
                routeCode,
                phase,
                error: message,
            });

            // Hard stop: never try to recover from a stuck route list by
            // refreshing, relaunching, or more navigation. Only the user can
            // restore the list manually.
            if (message.includes(ROUTE_LIST_LOADING_STATE) || message.includes(ROUTE_LIST_LOADING_OR_REFRESHING)) {
                console.error(
                    `${ROUTE_LIST_LOADING_OR_REFRESHING}: YBS route list is loading or refreshing. ` +
                        "Stopping the batch. Do not refresh the list. " +
                        "Restore the route list manually on the phone, then re-run with --retry-failed.",
                );
                break;
            }

            if (message.includes(ROUTE_LIST_REFRESH_GESTURE_BLOCKED)) {
                console.error(
                    `${ROUTE_LIST_REFRESH_GESTURE_BLOCKED}: blocked a forbidden route-list gesture. ` +
                        "Stopping the batch. Manually reopen the route list without pull-refresh, then re-run.",
                );
                break;
            }

            if (message.includes(TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED)) {
                console.error(
                    `${TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED}: target route is above the current list window. ` +
                        "Manually scroll to the correct list position without pull-refresh, then re-run.",
                );
                break;
            }

            if (message.includes(YBS_APP_NOT_IN_FOREGROUND)) {
                console.error(
                    `${YBS_APP_NOT_IN_FOREGROUND}: YBS Go left the foreground. ` +
                        "Stopping the batch. Re-open YBS Go on the route list, then re-run.",
                );
                break;
            }

            try {
                await returnToRouteList(
                    options.deviceId,
                    options.runRoot,
                    options.language,
                    routeCode,
                    options.packageName,
                );
            } catch (recoverError: unknown) {
                const recoverMessage =
                    recoverError instanceof Error ? recoverError.message : String(recoverError);
                const lastFailure = failed[failed.length - 1];
                if (lastFailure?.routeCode === routeCode) {
                    lastFailure.error = `${lastFailure.error}; recover: ${recoverMessage}`;
                    lastFailure.phase = "recover";
                }

                if (recoverMessage.includes(ROUTE_LIST_LOADING_STATE) || recoverMessage.includes(ROUTE_LIST_LOADING_OR_REFRESHING)) {
                    console.error(
                        `${ROUTE_LIST_LOADING_OR_REFRESHING}: YBS route list is loading or refreshing. ` +
                            "Stopping the batch. Restore the route list manually on the phone, then re-run with --retry-failed.",
                    );
                    break;
                }

                if (recoverMessage.includes(ROUTE_LIST_REFRESH_GESTURE_BLOCKED)) {
                    console.error(
                        `${ROUTE_LIST_REFRESH_GESTURE_BLOCKED}: blocked a forbidden route-list gesture during recovery. Stopping the batch.`,
                    );
                    break;
                }

                if (recoverMessage.includes(TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED)) {
                    console.error(
                        `${TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED}: route list position must be reset manually. Stopping the batch.`,
                    );
                    break;
                }

                if (recoverMessage.includes(YBS_APP_NOT_IN_FOREGROUND)) {
                    console.error(
                        `${YBS_APP_NOT_IN_FOREGROUND}: YBS Go left the foreground during recovery. ` +
                            "Stopping the batch. Re-open YBS Go on the route list, then re-run.",
                    );
                    break;
                }
            }
        }
    }

    const report: ExtractRoutesBatchReport = {
        last_run_at: new Date().toISOString(),
        run_root: resolveFromRepo(options.runRoot),
        language: options.language,
        index_path: indexPath,
        options: {
            limit: options.limit ?? null,
            skip_existing: Boolean(options.skipExisting),
            retry_failed: Boolean(options.retryFailed),
            from_index: Boolean(options.fromIndex || options.indexPath),
        },
        succeeded,
        failed,
        skipped,
    };

    const reportPath = batchReportPath(options.runRoot, options.language);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { report, reportPath };
}

function parseRouteCodesArg(value: string): string[] {
    return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
}

function parseCliArgs(argv: string[]): ExtractRoutesBatchOptions {
    const config = defaultConfig();
    const options: ExtractRoutesBatchOptions = {
        deviceId: config.deviceId,
        runRoot: config.outputRoot,
        language: "my",
        packageName: config.packageName,
        routeCodes: [],
        skipExisting: false,
        retryFailed: false,
        fromIndex: false,
        strictNoRouteListRefresh: true,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--device" && next) {
            options.deviceId = next;
            i++;
        } else if ((arg === "--run" || arg === "--output-root") && next) {
            options.runRoot = next;
            i++;
        } else if (arg === "--language" && next) {
            if (next !== "my" && next !== "en") {
                throw new Error('--language must be "my" or "en"');
            }
            options.language = next;
            i++;
        } else if (arg === "--routes" && next) {
            options.routeCodes = parseRouteCodesArg(next);
            i++;
        } else if (arg === "--from-index") {
            options.fromIndex = true;
            if (next && !next.startsWith("-")) {
                options.indexPath = next;
                i++;
            }
        } else if (arg === "--index-path" && next) {
            options.indexPath = next;
            i++;
        } else if (arg === "--limit" && next) {
            options.limit = Number(next);
            i++;
        } else if (arg === "--skip-existing") {
            options.skipExisting = true;
        } else if (arg === "--retry-failed") {
            options.retryFailed = true;
        } else if (arg === "--max-list-scrolls" && next) {
            options.maxListScrolls = Number(next);
            i++;
        } else if (arg === "--strict-no-route-list-refresh" && next) {
            options.strictNoRouteListRefresh = parseStrictNoRouteListRefreshFlag(next);
            i++;
        }
    }

    const hasRouteSource =
        options.routeCodes.length > 0 || options.fromIndex || options.indexPath || options.retryFailed;

    if (!hasRouteSource) {
        throw new Error(
            "Provide --routes, --from-index, or --retry-failed to choose which routes to extract.",
        );
    }

    return options;
}

function isCliInvocation(): boolean {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("extract-routes-batch.ts") || entry.endsWith("extract-routes-batch.js");
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const { report, reportPath } = await extractRoutesBatch(options);

    for (const result of report.succeeded) {
        console.log(`Wrote ${result.outputPath}`);
        const raw = JSON.parse(fs.readFileSync(result.outputPath, "utf8")) as {
            route?: { app_total_stop_count?: number | null };
            validation?: {
                direction_stop_count_sum?: number;
                matches_app_total_stop_count?: boolean | null;
                quality_status?: string;
            };
            extraction?: {
                outbound_stop_count?: number;
                inbound_stop_count?: number;
                quality_status?: string;
            };
        };
        console.log(
            [
                `${result.routeCode} app_total_stop_count: ${raw.route?.app_total_stop_count ?? "n/a"}`,
                `outbound stop_count: ${raw.extraction?.outbound_stop_count ?? "n/a"}`,
                `inbound stop_count: ${raw.extraction?.inbound_stop_count ?? "n/a"}`,
                `direction_stop_count_sum: ${raw.validation?.direction_stop_count_sum ?? "n/a"}`,
                `matches_app_total_stop_count: ${raw.validation?.matches_app_total_stop_count ?? "n/a"}`,
                `quality_status: ${raw.extraction?.quality_status ?? raw.validation?.quality_status ?? "n/a"}`,
            ].join("\n"),
        );
        if (result.warnings.length > 0) {
            console.log(`Warnings for ${result.routeCode}: ${result.warnings.join(" | ")}`);
        }
    }

    for (const failure of report.failed) {
        console.error(`Failed ${failure.routeCode} (${failure.phase}): ${failure.error}`);
    }

    if (report.skipped.length > 0) {
        console.log(`Skipped ${report.skipped.length} existing routes`);
    }

    console.log(`Wrote batch report ${reportPath}`);
    console.log(
        `Batch done: ${report.succeeded.length} succeeded, ${report.failed.length} failed, ${report.skipped.length} skipped`,
    );

    if (report.failed.length > 0) {
        process.exitCode = 1;
    }
}

if (isCliInvocation()) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
