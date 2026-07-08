/**
 * Extract the YBS Go route list / index screen from ADB UI XML.
 *
 * Does not touch the database. Does not open route details.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { dumpUiXml, ensureDevice, getFocusedApp, scrollDownRouteList, setStrictNoRouteListRefresh, sleep } from "./adb.js";
import {
    DEFAULT_PACKAGE,
    defaultConfig,
    resolveFromRepo,
    routeIndexPageSourcesDir,
    routeIndexPath,
    type YbsExtractionConfig,
} from "./config.js";
import {
    assignRouteIdentities,
    type RouteIdentityRecord,
} from "./route-identity.js";
import {
    assertRouteListNotLoadingOrRefreshing,
    detectLanguage,
    detectYbsScreen,
    mergeRouteIndexRows,
    parseRouteIndexRows,
    parseXmlTextNodes,
    routeIndexDedupeKey,
    type ParsedRouteIndexRow,
} from "./parse-ui-xml.js";
import { parseStrictNoRouteListRefreshFlag } from "./ybs-navigation-safety.js";

const STALE_SCROLL_LIMIT = 5;

export type RouteIndexLanguage = "my" | "en";

export type ExtractRouteIndexOptions = {
    config?: Partial<YbsExtractionConfig>;
    language: RouteIndexLanguage;
    /** When true (default), capture starts at the current list position without scrolling up. */
    startFromCurrentPosition?: boolean;
    strictNoRouteListRefresh?: boolean;
    /** Rebuild index from saved XML dumps instead of reading the device. */
    replayPageSourcesDir?: string;
};

function xmlDumpPath(xmlDir: string, index: number): string {
    return path.join(xmlDir, `${String(index).padStart(3, "0")}.xml`);
}

function pickRicherRouteIndexRow(
    left: ParsedRouteIndexRow,
    right: ParsedRouteIndexRow,
): ParsedRouteIndexRow {
    const leftTitle = left.route_title_my ?? left.route_title_en;
    const rightTitle = right.route_title_my ?? right.route_title_en;

    if (leftTitle && !rightTitle) {
        return left;
    }
    if (rightTitle && !leftTitle) {
        return right;
    }
    if (left.raw_card_text.length !== right.raw_card_text.length) {
        return left.raw_card_text.length > right.raw_card_text.length ? left : right;
    }
    if (left.route_display_code && !right.route_display_code) {
        return left;
    }
    if (right.route_display_code && !left.route_display_code) {
        return right;
    }

    return left;
}

function dedupeRouteIndexRows(rows: ParsedRouteIndexRow[]): ParsedRouteIndexRow[] {
    const kept: ParsedRouteIndexRow[] = [];
    const overlapIndex = new Map<string, number>();

    for (const row of rows) {
        const dedupeKey = routeIndexDedupeKey(row);
        const existingIndex = overlapIndex.get(dedupeKey);

        if (existingIndex === undefined) {
            overlapIndex.set(dedupeKey, kept.length);
            kept.push(row);
            continue;
        }

        kept[existingIndex] = pickRicherRouteIndexRow(kept[existingIndex], row);
    }

    return kept;
}

function withListOrder(rows: ParsedRouteIndexRow[]): Array<ParsedRouteIndexRow & { list_order: number }> {
    return rows.map((row, index) => ({
        ...row,
        list_order: index + 1,
    }));
}

function applyRouteIdentity(rows: Array<ParsedRouteIndexRow & { list_order: number }>): RouteIdentityRecord[] {
    const identityInputs = rows.map((row) => ({
        list_order: row.list_order,
        route_display_code: row.route_display_code,
        route_number: row.route_number,
        route_title_my: row.route_title_my,
        route_title_en: row.route_title_en,
        operator_name: row.operator_name,
        badge_is_truncated: row.badge_is_truncated,
        raw_card_text: row.raw_card_text,
        card_bounds: row.card_bounds,
    }));

    return assignRouteIdentities(identityInputs);
}

/** Rebuild route index JSON from saved route-list XML dumps (no device). */
export function buildRouteIndexFromPageSources(options: {
    language: RouteIndexLanguage;
    pageSourcesDir: string;
    outputPath: string;
    runRoot: string;
}): string {
    const xmlPaths = fs
        .readdirSync(options.pageSourcesDir)
        .filter((name) => /^\d{3}\.xml$/.test(name))
        .sort()
        .map((name) => path.join(options.pageSourcesDir, name));

    if (xmlPaths.length === 0) {
        throw new Error(`No route index page sources found in ${options.pageSourcesDir}`);
    }

    const dumpRows = xmlPaths.map((xmlPath) => parseRouteIndexRows(fs.readFileSync(xmlPath, "utf8")));
    const merged = mergeRouteIndexRows(dumpRows);
    const dedupedRaw = dedupeRouteIndexRows(merged);
    const orderedRaw = withListOrder(dedupedRaw);
    const routes = applyRouteIdentity(orderedRaw);
    const detectedLanguage = detectLanguage(parseXmlTextNodes(fs.readFileSync(xmlPaths[0], "utf8")));

    const output = {
        source: {
            source_name: "external_ybs_app",
            source_kind: "visible_app_extraction",
            source_method: "adb_uiautomator_xml_replay",
            device_id: null,
            package: DEFAULT_PACKAGE,
            focused_app: null,
            captured_at: new Date().toISOString(),
        },
        language: options.language,
        routes,
        extraction: {
            language: options.language,
            detected_language: detectedLanguage.language,
            route_count: routes.length,
            run_root: resolveFromRepo(options.runRoot),
            xml_dump_count: xmlPaths.length,
            xml_paths: xmlPaths.map((xmlPath) => path.resolve(xmlPath)),
            list_position: {
                start_from_current_position: true,
                last_dump_index: xmlPaths.length - 1,
                completed_with_stale_scroll: true,
                replayed_from_page_sources: true,
            },
        },
        warnings: detectedLanguage.warnings,
    };

    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return options.outputPath;
}

/** Scroll the route index and collect route cards. Downward scroll only — never pull-to-refresh. */
export async function extractRouteIndex(options: ExtractRouteIndexOptions): Promise<string> {
    const config = defaultConfig({
        packageName: DEFAULT_PACKAGE,
        ...options.config,
    });
    const outputPath = routeIndexPath(config, options.language);

    if (options.replayPageSourcesDir) {
        return buildRouteIndexFromPageSources({
            language: options.language,
            pageSourcesDir: resolveFromRepo(options.replayPageSourcesDir),
            outputPath,
            runRoot: config.outputRoot,
        });
    }

    setStrictNoRouteListRefresh(options.strictNoRouteListRefresh ?? true);
    const xmlDir = routeIndexPageSourcesDir(config);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(xmlDir, { recursive: true });

    ensureDevice(config.deviceId);

    let focusedApp = "";
    try {
        focusedApp = getFocusedApp(config.deviceId);
        if (!focusedApp.includes(config.packageName)) {
            throw new Error(`Focused app is "${focusedApp}". Open ${config.packageName} route list first.`);
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }

    const warnings: string[] = [];
    if (options.startFromCurrentPosition === false) {
        warnings.push(
            "startFromCurrentPosition=false is ignored. Route list scroll-to-top is forbidden to avoid pull-to-refresh.",
        );
    }

    const xmlPaths: string[] = [];
    const dumpRows: ParsedRouteIndexRow[][] = [];
    let staleScrolls = 0;
    let mergedCount = 0;
    let detectedLanguage: ReturnType<typeof detectLanguage> = {
        language: "mixed",
        warnings: [],
    };

    for (let dumpIndex = 0; dumpIndex < config.maxScrolls; dumpIndex++) {
        const xmlPath = xmlDumpPath(xmlDir, dumpIndex);
        dumpUiXml(config.deviceId, xmlPath);
        xmlPaths.push(xmlPath);

        const xml = fs.readFileSync(xmlPath, "utf8");
        assertRouteListNotLoadingOrRefreshing(xml);

        const ybsScreen = detectYbsScreen(xml);
        if (ybsScreen === "loading") {
            throw new Error(
                "ROUTE_LIST_LOADING_OR_REFRESHING: route list is loading or refreshing during index capture.",
            );
        }

        const rows = parseRouteIndexRows(xml);
        dumpRows.push(rows);

        if (dumpIndex === 0) {
            detectedLanguage = detectLanguage(parseXmlTextNodes(xml));
            warnings.push(...detectedLanguage.warnings);

            if (rows.length === 0) {
                warnings.push("No route cards found. Open the YBS route list screen first.");
            }

            if (
                detectedLanguage.language !== "mixed" &&
                detectedLanguage.language !== options.language
            ) {
                warnings.push(
                    `CLI language is "${options.language}" but screen looks like "${detectedLanguage.language}".`,
                );
            }
        }

        const merged = mergeRouteIndexRows(dumpRows);
        if (merged.length === mergedCount) {
            staleScrolls++;
        } else {
            staleScrolls = 0;
            mergedCount = merged.length;
        }

        if (staleScrolls >= STALE_SCROLL_LIMIT) {
            break;
        }

        scrollDownRouteList(config.deviceId);
        await sleep(config.scrollPauseMs);
    }

    const merged = mergeRouteIndexRows(dumpRows);
    const dedupedRaw = dedupeRouteIndexRows(merged);

    if (dedupedRaw.length === 0) {
        warnings.push("Route index is empty after scrolling.");
    }

    const orderedRaw = withListOrder(dedupedRaw);
    const routes = applyRouteIdentity(orderedRaw);

    const output = {
        source: {
            source_name: "external_ybs_app",
            source_kind: "visible_app_extraction",
            source_method: "adb_uiautomator_xml",
            device_id: config.deviceId,
            package: config.packageName,
            focused_app: focusedApp,
            captured_at: new Date().toISOString(),
        },
        language: options.language,
        routes,
        extraction: {
            language: options.language,
            detected_language: detectedLanguage.language,
            route_count: routes.length,
            run_root: resolveFromRepo(config.outputRoot),
            xml_dump_count: xmlPaths.length,
            xml_paths: xmlPaths.map((xmlPath) => path.resolve(xmlPath)),
            list_position: {
                start_from_current_position: true,
                last_dump_index: xmlPaths.length - 1,
                completed_with_stale_scroll: staleScrolls >= STALE_SCROLL_LIMIT,
            },
        },
        warnings,
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return outputPath;
}

function parseCliArgs(argv: string[]): ExtractRouteIndexOptions {
    const options: ExtractRouteIndexOptions = {
        config: {},
        language: "my",
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--device" && next) {
            options.config = { ...options.config, deviceId: next };
            i++;
        } else if ((arg === "--run" || arg === "--output-root") && next) {
            options.config = { ...options.config, outputRoot: next };
            i++;
        } else if (arg === "--language" && next) {
            if (next !== "my" && next !== "en") {
                throw new Error('--language must be "my" or "en"');
            }
            options.language = next;
            i++;
        } else if (arg === "--max-scrolls" && next) {
            options.config = { ...options.config, maxScrolls: Number(next) };
            i++;
        } else if (arg === "--start-from-current-position") {
            options.startFromCurrentPosition = true;
        } else if (arg === "--strict-no-route-list-refresh" && next) {
            options.strictNoRouteListRefresh = parseStrictNoRouteListRefreshFlag(next);
            i++;
        } else if (arg === "--replay-page-sources" && next) {
            options.replayPageSourcesDir = next;
            i++;
        }
    }

    if (options.startFromCurrentPosition === undefined) {
        options.startFromCurrentPosition = true;
    }
    if (options.strictNoRouteListRefresh === undefined) {
        options.strictNoRouteListRefresh = true;
    }

    return options;
}

function isCliInvocation(): boolean {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("extract-route-index.ts") || entry.endsWith("extract-route-index.js");
}

async function main(): Promise<void> {
    const outputPath = await extractRouteIndex(parseCliArgs(process.argv.slice(2)));
    console.log(`Wrote ${outputPath}`);
}

if (isCliInvocation()) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
