#!/usr/bin/env npx tsx
/**
 * Stage 1: extract route cards from the Myanmar train app route list (All tab).
 *
 * User must open the app route list on the All tab before running.
 * Does not switch tabs. Does not normalize. No database access.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-route-index.ts --language en
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-route-index.ts --language my
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    dumpUiXml,
    ensureDevice,
    getFocusedApp,
    resolveTrainAppPackage,
    scrollDownTrainList,
    sleep,
    takeScreenshot,
} from "../../lib/adb.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    rawRouteListPageSourcesDir,
    rawRouteListPath,
    rawRouteListScreenshotsDir,
    resolveFromRepo,
    type TrainRunPaths,
} from "../../lib/paths.js";
import type { TrainLanguage, TrainRouteListCard, TrainRouteListFile } from "../../lib/types.js";
import { TRAIN_RAW_SCHEMA_VERSION } from "../../lib/types.js";
import {
    mergeTrainRouteListCards,
    parseTrainRouteListCards,
    type ParsedTrainRouteCard,
} from "../parse-train-ui.js";
import { isWebViewOnlyDump, webViewOnlyDumpMessage } from "../../lib/detect-ui-dump.js";

import { setStrictNoRouteListRefresh } from "../../../transport-json-import/ybs-extraction/adb.js";

const STALE_SCROLL_LIMIT = 5;
const DEFAULT_DEVICE_ID = process.env.ADB_DEVICE_ID ?? "R3CX10JRQNZ";
const DEFAULT_MAX_SCROLLS = 60;
const DEFAULT_SCROLL_PAUSE_MS = 900;

export type ExtractRouteIndexOptions = {
    language: TrainLanguage;
    runRoot?: string;
    deviceId?: string;
    packageName?: string;
    maxScrolls?: number;
    scrollPauseMs?: number;
    replayPageSourcesDir?: string;
};

function xmlDumpPath(xmlDir: string, index: number): string {
    return path.join(xmlDir, `${String(index).padStart(3, "0")}.xml`);
}

function screenshotPath(screenshotDir: string, index: number): string {
    return path.join(screenshotDir, `${String(index).padStart(3, "0")}.png`);
}

function toRouteListCard(card: ParsedTrainRouteCard, listIndex: number): TrainRouteListCard {
    return {
        list_index: listIndex,
        train_number: card.train_number,
        direction_text: card.direction_text,
        route_title: card.route_title,
        origin_destination_text: card.origin_destination_text,
        start_time_text: card.start_time_text,
        badges: card.badges,
        raw_card_text: card.raw_card_text,
        card_bounds: card.card_bounds,
    };
}

function buildFromPageSources(options: {
    language: TrainLanguage;
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
        throw new Error(`No page sources found in ${options.pageSourcesDir}`);
    }

    const dumpCards = xmlPaths.map((xmlPath) =>
        parseTrainRouteListCards(fs.readFileSync(xmlPath, "utf8")),
    );
    const merged = mergeTrainRouteListCards(dumpCards);
    const routes = merged.map((card, index) => toRouteListCard(card, index + 1));

    const output: TrainRouteListFile = {
        schema_version: TRAIN_RAW_SCHEMA_VERSION,
        language: options.language,
        extracted_at: new Date().toISOString(),
        source: {
            app: null,
            tab: "All",
            method: "adb_uiautomator_xml_replay",
        },
        routes,
        extraction: {
            run_root: resolveFromRepo(options.runRoot),
            xml_dump_count: xmlPaths.length,
            xml_paths: xmlPaths.map((xmlPath) => path.resolve(xmlPath)),
            screenshot_paths: [],
            stale_scroll_limit: STALE_SCROLL_LIMIT,
            completed_with_stale_scroll: true,
            replayed_from_page_sources: true,
        },
        warnings: [],
    };

    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return options.outputPath;
}

/** Scroll the train route list and collect visible route cards. */
export async function extractRouteIndex(
    options: ExtractRouteIndexOptions,
): Promise<string> {
    const paths: TrainRunPaths = defaultRunPaths(options.runRoot);
    const outputPath = rawRouteListPath(paths, options.language);

    if (options.replayPageSourcesDir) {
        return buildFromPageSources({
            language: options.language,
            pageSourcesDir: resolveFromRepo(options.replayPageSourcesDir),
            outputPath,
            runRoot: paths.runRoot,
        });
    }

    const deviceId = options.deviceId ?? process.env.ADB_DEVICE_ID ?? DEFAULT_DEVICE_ID;
    const packageName = resolveTrainAppPackage(options.packageName);
    const maxScrolls = options.maxScrolls ?? DEFAULT_MAX_SCROLLS;
    const scrollPauseMs = options.scrollPauseMs ?? DEFAULT_SCROLL_PAUSE_MS;

    ensureRunLayout(paths);
    setStrictNoRouteListRefresh(true);

    const xmlDir = rawRouteListPageSourcesDir(paths, options.language);
    const screenshotDir = rawRouteListScreenshotsDir(paths, options.language);
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    ensureDevice(deviceId);

    let focusedApp = "";
    try {
        focusedApp = getFocusedApp(deviceId);
        if (packageName && !focusedApp.includes(packageName)) {
            throw new Error(
                `Focused app is "${focusedApp}". Open train app (${packageName}) route list on All tab first.`,
            );
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }

    const warnings: string[] = [];

    const xmlPaths: string[] = [];
    const screenshotPaths: string[] = [];
    const dumpCards: ParsedTrainRouteCard[][] = [];
    let staleScrolls = 0;
    let mergedCount = 0;

    for (let dumpIndex = 0; dumpIndex < maxScrolls; dumpIndex++) {
        const xmlPath = xmlDumpPath(xmlDir, dumpIndex);
        const pngPath = screenshotPath(screenshotDir, dumpIndex);

        dumpUiXml(deviceId, xmlPath);
        takeScreenshot(deviceId, pngPath);

        xmlPaths.push(xmlPath);
        screenshotPaths.push(pngPath);

        const xml = fs.readFileSync(xmlPath, "utf8");
        if (dumpIndex === 0 && isWebViewOnlyDump(xml)) {
            throw new Error(webViewOnlyDumpMessage());
        }
        const cards = parseTrainRouteListCards(xml);
        dumpCards.push(cards);

        if (dumpIndex === 0 && cards.length === 0) {
            warnings.push(
                "No route cards found on first screen. Open the train app route list on the All tab first.",
            );
        }

        const merged = mergeTrainRouteListCards(dumpCards);
        if (merged.length === mergedCount) {
            staleScrolls++;
        } else {
            staleScrolls = 0;
            mergedCount = merged.length;
        }

        if (staleScrolls >= STALE_SCROLL_LIMIT) {
            break;
        }

        scrollDownTrainList(deviceId);
        await sleep(scrollPauseMs);
    }

    const merged = mergeTrainRouteListCards(dumpCards);
    if (merged.length === 0) {
        warnings.push("Route list is empty after scrolling.");
    }

    const routes = merged.map((card, index) => toRouteListCard(card, index + 1));

    const output: TrainRouteListFile = {
        schema_version: TRAIN_RAW_SCHEMA_VERSION,
        language: options.language,
        extracted_at: new Date().toISOString(),
        source: {
            app: packageName || focusedApp || null,
            tab: "All",
            method: "adb_uiautomator_xml",
            device_id: deviceId,
            package: packageName || null,
            focused_app: focusedApp || null,
        },
        routes,
        extraction: {
            run_root: paths.runRoot,
            xml_dump_count: xmlPaths.length,
            xml_paths: xmlPaths.map((xmlPath) => path.resolve(xmlPath)),
            screenshot_paths: screenshotPaths.map((pngPath) => path.resolve(pngPath)),
            stale_scroll_limit: STALE_SCROLL_LIMIT,
            completed_with_stale_scroll: staleScrolls >= STALE_SCROLL_LIMIT,
        },
        warnings,
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return outputPath;
}

function parseCliArgs(argv: string[]): ExtractRouteIndexOptions {
    const options: ExtractRouteIndexOptions = {
        language: "en",
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--language" && next) {
            if (next !== "en" && next !== "my") {
                throw new Error('--language must be "en" or "my"');
            }
            options.language = next;
            i++;
        } else if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--device" && next) {
            options.deviceId = next.trim();
            i++;
        } else if (arg === "--package" && next) {
            options.packageName = next.trim();
            i++;
        } else if (arg === "--max-scrolls" && next) {
            options.maxScrolls = Number(next);
            i++;
        } else if (arg === "--replay-page-sources" && next) {
            options.replayPageSourcesDir = next.trim();
            i++;
        }
    }

    return options;
}

async function main(): Promise<void> {
    const outputPath = await extractRouteIndex(parseCliArgs(process.argv.slice(2)));
    const data = JSON.parse(fs.readFileSync(outputPath, "utf8")) as TrainRouteListFile;
    console.log(`Saved route list: ${outputPath}`);
    console.log(`Routes found: ${data.routes.length}`);
    if (data.warnings.length > 0) {
        console.log(`Warnings: ${data.warnings.join("; ")}`);
    }
}

const isCliEntry = process.argv[1]?.includes("extract-route-index.ts");

if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
