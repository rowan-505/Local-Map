#!/usr/bin/env npx tsx
/**
 * Stage 2: extract train route detail + full schedule (one language).
 *
 * Reads route-list.json, opens each route, expands schedule, scrolls until
 * Collapse Schedule appears, then saves raw JSON per variant.
 *
 * Manual fallback:
 *   --current-route TRAIN-141-UP  (extract the already-open detail page)
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-route-details.ts --language en --all
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-route-details.ts --language my --all
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-route-details.ts --language en --current-route TRAIN-11-UP
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
    dumpUiXml,
    ensureDevice,
    getFocusedApp,
    pressBack,
    resolveTrainAppPackage,
    scrollDownStopListPage,
    scrollDownTrainList,
    sleep,
    takeScreenshot,
    tap,
} from "../../lib/adb.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    rawPageSourcesDirByVariantCode,
    rawRouteDetailPathByVariantCode,
    rawRouteDetailScreenshotsDir,
    rawRouteListPath,
    resolveFromRepo,
    type TrainRunPaths,
} from "../../lib/paths.js";
import type {
    RawTrainRouteDetail,
    RawTrainStationRow,
    TrainLanguage,
    TrainRouteListCard,
    TrainRouteListFile,
} from "../../lib/types.js";
import { TRAIN_RAW_SCHEMA_VERSION } from "../../lib/types.js";
import {
    buildVariantCode,
    mapDirectionCode,
    parseVariantCode,
} from "../../normalize/merge-language-routes.js";
import {
    detectTrainDetailScreen,
    findViewFullScheduleNode,
    mergeTrainDetailDumps,
    parseTrainDetailDump,
    tapCenter,
    type ParsedTrainStationRow,
} from "../parse-train-detail-ui.js";
import {
    parseTrainRouteListCards,
    trainRouteListDedupeKey,
    type ParsedTrainRouteCard,
} from "../parse-train-ui.js";

import { setStrictNoRouteListRefresh } from "../../../transport-json-import/ybs-extraction/adb.js";
import { parseXmlTextNodes as parseXmlNodes } from "../../../transport-json-import/ybs-extraction/parse-ui-xml.js";

const DEFAULT_DEVICE_ID = process.env.ADB_DEVICE_ID ?? "R3CX10JRQNZ";
const DEFAULT_MAX_SCROLLS = 50;
const DEFAULT_SCROLL_PAUSE_MS = 700;
const STALE_SCROLL_LIMIT = 3;
const TAP_PAUSE_MS = 900;
const BACK_PAUSE_MS = 600;
const MAX_LIST_SCROLLS = 80;
const LIST_SCROLL_PAUSE_MS = 700;

export type ExtractRouteDetailsOptions = {
    language: TrainLanguage;
    runRoot?: string;
    deviceId?: string;
    packageName?: string;
    all?: boolean;
    currentRoute?: string;
    force?: boolean;
    maxScrolls?: number;
    scrollPauseMs?: number;
    replayPageSourcesDir?: string;
    variantCode?: string;
};

export type ExtractRouteDetailsResult = {
    written: string[];
    skipped: string[];
    failed: Array<{ variant_code: string; error: string }>;
};

function xmlDumpPath(xmlDir: string, index: number): string {
    return path.join(xmlDir, `${String(index).padStart(3, "0")}.xml`);
}

function screenshotPath(screenshotDir: string, index: number): string {
    return path.join(screenshotDir, `${String(index).padStart(3, "0")}.png`);
}

function variantCodeFromListCard(card: TrainRouteListCard): string {
    if (!card.train_number) {
        throw new Error(
            `Route list card #${card.list_index} is missing train_number`,
        );
    }
    const directionCode = card.direction_text
        ? mapDirectionCode(card.direction_text)
        : "UNKNOWN";
    return buildVariantCode(card.train_number, directionCode);
}

function listCardKey(card: TrainRouteListCard): string {
    return trainRouteListDedupeKey({
        train_number: card.train_number,
        direction_text: card.direction_text,
        route_title: card.route_title,
        origin_destination_text: card.origin_destination_text,
        start_time_text: card.start_time_text,
        badges: card.badges,
        raw_card_text: card.raw_card_text,
        card_bounds: card.card_bounds ?? null,
    });
}

function parsedCardKey(card: ParsedTrainRouteCard): string {
    return trainRouteListDedupeKey(card);
}

function toRawStationRow(row: ParsedTrainStationRow): RawTrainStationRow {
    const time_text = row.time_text;
    let arrival_time_raw: string | null = null;
    let departure_time_raw: string | null = null;

    if (time_text?.includes(" / ")) {
        const [arrival, departure] = time_text.split(" / ").map((part) => part.trim());
        arrival_time_raw = arrival || null;
        departure_time_raw = departure || null;
    } else if (row.sequence === 1) {
        departure_time_raw = time_text;
    } else {
        arrival_time_raw = time_text;
    }

    return {
        sequence: row.sequence,
        name: row.name,
        time_text,
        station_name_raw: row.name,
        arrival_time_raw,
        departure_time_raw,
        raw_row_text: row.raw_row_text.join(" | "),
    };
}

function buildRouteDetailOutput(options: {
    language: TrainLanguage;
    variantCode: string;
    listCard: TrainRouteListCard | null;
    merged: ReturnType<typeof mergeTrainDetailDumps>;
    extraction: RawTrainRouteDetail["extraction"];
    warnings: string[];
}): RawTrainRouteDetail {
    const metadata = options.merged.metadata;
    const trainNumber =
        metadata.train_number ??
        options.listCard?.train_number ??
        parseVariantCode(options.variantCode).trainNumber;
    const parsedVariant = parseVariantCode(options.variantCode);
    const directionText =
        metadata.direction_text ??
        options.listCard?.direction_text ??
        (parsedVariant.directionCode === "UP"
            ? "Up"
            : parsedVariant.directionCode === "DOWN"
              ? "Down"
              : parsedVariant.directionCode);

    const detail: RawTrainRouteDetail = {
        schema_version: TRAIN_RAW_SCHEMA_VERSION,
        language: options.language,
        extracted_at: new Date().toISOString(),
        variant_code: options.variantCode,
        train_number: trainNumber,
        direction_text: directionText,
        route_title: metadata.route_title ?? options.listCard?.route_title ?? null,
        route_subtitle: metadata.route_subtitle ?? null,
        operation_text: metadata.operation_text,
        origin: metadata.origin,
        destination: metadata.destination,
        type: metadata.type ?? options.listCard?.badges[0] ?? null,
        direction: metadata.direction_text ?? directionText,
        way: metadata.way,
        train_model: metadata.train_model,
        total_stations_text: metadata.total_stations_text,
        traveling_time_text: metadata.traveling_time_text,
        stations: options.merged.stations.map(toRawStationRow),
        schedule_complete_marker_seen: options.merged.schedule_complete_marker_seen,
        warnings: [...new Set([...options.merged.warnings, ...options.warnings])],
        extraction: options.extraction,
        route_title_raw: metadata.route_title ?? options.listCard?.route_title ?? null,
        train_type_raw: metadata.type ?? options.listCard?.badges[0] ?? null,
        train_model_raw: metadata.train_model,
        way_raw: metadata.way,
        operation_day_raw: metadata.operation_text,
        origin_raw: metadata.origin.name,
        destination_raw: metadata.destination.name,
        total_stations_raw: metadata.total_stations_text,
        travel_duration_raw: metadata.traveling_time_text,
    };

    if (!detail.schedule_complete_marker_seen) {
        detail.warnings?.push("COLLAPSE_SCHEDULE_NOT_SEEN");
    }
    if (detail.stations.length === 0) {
        detail.warnings?.push("NO_STATIONS_EXTRACTED");
    }

    return detail;
}

function loadRouteList(paths: TrainRunPaths, language: TrainLanguage): TrainRouteListFile {
    const listPath = rawRouteListPath(paths, language);
    if (!fs.existsSync(listPath)) {
        throw new Error(`Route list not found: ${listPath}. Run extract-route-index.ts first.`);
    }
    return JSON.parse(fs.readFileSync(listPath, "utf8")) as TrainRouteListFile;
}

function readAndParseDump(xmlPath: string): ReturnType<typeof parseTrainDetailDump> {
    return parseTrainDetailDump(fs.readFileSync(xmlPath, "utf8"));
}

function buildFromPageSources(options: {
    language: TrainLanguage;
    variantCode: string;
    pageSourcesDir: string;
    outputPath: string;
    listCard: TrainRouteListCard | null;
}): string {
    const xmlPaths = fs
        .readdirSync(options.pageSourcesDir)
        .filter((name) => /^\d{3}\.xml$/.test(name))
        .sort()
        .map((name) => path.join(options.pageSourcesDir, name));

    if (xmlPaths.length === 0) {
        throw new Error(`No page sources found in ${options.pageSourcesDir}`);
    }

    const dumps = xmlPaths.map((xmlPath) => readAndParseDump(xmlPath));
    const merged = mergeTrainDetailDumps(dumps);
    const output = buildRouteDetailOutput({
        language: options.language,
        variantCode: options.variantCode,
        listCard: options.listCard,
        merged,
        warnings: [],
        extraction: {
            page_source_dir: path.resolve(options.pageSourcesDir),
            xml_dump_count: xmlPaths.length,
            scroll_pass_count: xmlPaths.length,
            ended_at_collapse_schedule: merged.schedule_complete_marker_seen,
            method: "adb_uiautomator_xml_replay",
            replayed_from_page_sources: true,
            opened_from_route_list: false,
        },
    });

    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return options.outputPath;
}

async function tapViewFullScheduleIfNeeded(
    deviceId: string,
    xmlPath: string,
): Promise<boolean> {
    const xml = fs.readFileSync(xmlPath, "utf8");
    const nodes = parseXmlNodes(xml);
    const target = findViewFullScheduleNode(nodes);
    if (!target) {
        return false;
    }

    const { x, y } = tapCenter(target.parsedBounds);
    tap(deviceId, x, y);
    await sleep(TAP_PAUSE_MS);
    return true;
}

async function captureDetailScreens(
    deviceId: string,
    xmlDir: string,
    screenshotDir: string,
    maxScrolls: number,
    scrollPauseMs: number,
): Promise<{
    xmlPaths: string[];
    screenshotPaths: string[];
    dumps: ReturnType<typeof parseTrainDetailDump>[];
    expandedSchedule: boolean;
}> {
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.mkdirSync(screenshotDir, { recursive: true });

    const xmlPaths: string[] = [];
    const screenshotPaths: string[] = [];
    const dumps: ReturnType<typeof parseTrainDetailDump>[] = [];
    let expandedSchedule = false;
    let staleScrolls = 0;
    let stationCount = 0;
    let fileIndex = 0;

    const pushDump = (): string => {
        const xmlPath = xmlDumpPath(xmlDir, fileIndex);
        const pngPath = screenshotPath(screenshotDir, fileIndex);
        fileIndex++;

        dumpUiXml(deviceId, xmlPath);
        takeScreenshot(deviceId, pngPath);
        xmlPaths.push(xmlPath);
        screenshotPaths.push(pngPath);
        dumps.push(readAndParseDump(xmlPath));
        return xmlPath;
    };

    const firstPath = pushDump();
    expandedSchedule = await tapViewFullScheduleIfNeeded(deviceId, firstPath);
    if (expandedSchedule) {
        pushDump();
    }

    while (xmlPaths.length < maxScrolls) {
        const merged = mergeTrainDetailDumps(dumps);
        if (merged.schedule_complete_marker_seen) {
            break;
        }

        if (merged.stations.length === stationCount) {
            staleScrolls++;
        } else {
            staleScrolls = 0;
            stationCount = merged.stations.length;
        }

        if (staleScrolls >= STALE_SCROLL_LIMIT) {
            break;
        }

        scrollDownStopListPage(deviceId);
        await sleep(scrollPauseMs);
        pushDump();
    }

    return { xmlPaths, screenshotPaths, dumps, expandedSchedule };
}

function findMatchingVisibleCard(
    visibleCards: ParsedTrainRouteCard[],
    listCard: TrainRouteListCard,
): ParsedTrainRouteCard | null {
    const targetKey = listCardKey(listCard);
    return visibleCards.find((card) => parsedCardKey(card) === targetKey) ?? null;
}

async function openRouteFromList(
    deviceId: string,
    listCard: TrainRouteListCard,
): Promise<{ tapped: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    const targetKey = listCardKey(listCard);
    let staleScrolls = 0;

    for (let attempt = 0; attempt < MAX_LIST_SCROLLS; attempt++) {
        const probePath = path.join(os.tmpdir(), `train-open-route-${Date.now()}.xml`);
        dumpUiXml(deviceId, probePath);
        const xml = fs.readFileSync(probePath, "utf8");
        fs.unlinkSync(probePath);

        const screen = detectTrainDetailScreen(xml);
        if (screen === "route_detail") {
            return { tapped: false, warnings: ["ROUTE_DETAIL_ALREADY_OPEN"] };
        }

        const visibleCards = parseTrainRouteListCards(xml);
        const match = findMatchingVisibleCard(visibleCards, listCard);
        if (match?.card_bounds) {
            const { x, y } = tapCenter(match.card_bounds);
            tap(deviceId, x, y);
            await sleep(TAP_PAUSE_MS);

            const verifyPath = path.join(os.tmpdir(), `train-open-route-verify-${Date.now()}.xml`);
            dumpUiXml(deviceId, verifyPath);
            const verifyScreen = detectTrainDetailScreen(fs.readFileSync(verifyPath, "utf8"));
            fs.unlinkSync(verifyPath);

            if (verifyScreen === "route_detail") {
                return { tapped: true, warnings };
            }

            warnings.push("ROUTE_CARD_TAP_DID_NOT_OPEN_DETAIL");
            return { tapped: false, warnings };
        }

        const beforeCount = visibleCards.length;
        scrollDownTrainList(deviceId);
        await sleep(LIST_SCROLL_PAUSE_MS);

        const afterPath = path.join(os.tmpdir(), `train-open-route-after-${Date.now()}.xml`);
        dumpUiXml(deviceId, afterPath);
        const afterCount = parseTrainRouteListCards(fs.readFileSync(afterPath, "utf8")).length;
        fs.unlinkSync(afterPath);

        if (afterCount === beforeCount) {
            staleScrolls++;
        } else {
            staleScrolls = 0;
        }

        if (staleScrolls >= STALE_SCROLL_LIMIT) {
            break;
        }
    }

    warnings.push(`ROUTE_CARD_NOT_FOUND:${targetKey}`);
    return { tapped: false, warnings };
}

async function extractOneRoute(options: {
    paths: TrainRunPaths;
    language: TrainLanguage;
    deviceId: string;
    packageName: string;
    variantCode: string;
    listCard: TrainRouteListCard | null;
    openFromList: boolean;
    maxScrolls: number;
    scrollPauseMs: number;
    replayPageSourcesDir?: string;
}): Promise<string> {
    const outputPath = rawRouteDetailPathByVariantCode(
        options.paths,
        options.language,
        options.variantCode,
    );

    if (options.replayPageSourcesDir) {
        return buildFromPageSources({
            language: options.language,
            variantCode: options.variantCode,
            pageSourcesDir: resolveFromRepo(options.replayPageSourcesDir),
            outputPath,
            listCard: options.listCard,
        });
    }

    const xmlDir = rawPageSourcesDirByVariantCode(
        options.paths,
        options.language,
        options.variantCode,
    );
    const screenshotDir = rawRouteDetailScreenshotsDir(
        options.paths,
        options.language,
        options.variantCode,
    );

    const warnings: string[] = [];
    let openedFromList = false;

    if (options.openFromList && options.listCard) {
        const openResult = await openRouteFromList(options.deviceId, options.listCard);
        openedFromList = openResult.tapped;
        warnings.push(...openResult.warnings);
        if (!openResult.tapped && !openResult.warnings.includes("ROUTE_DETAIL_ALREADY_OPEN")) {
            throw new Error(
                `Could not open route card for ${options.variantCode}. ` +
                    `Use --current-route ${options.variantCode} after opening the detail page manually.`,
            );
        }
    }

    const capture = await captureDetailScreens(
        options.deviceId,
        xmlDir,
        screenshotDir,
        options.maxScrolls,
        options.scrollPauseMs,
    );

    const merged = mergeTrainDetailDumps(capture.dumps);
    const output = buildRouteDetailOutput({
        language: options.language,
        variantCode: options.variantCode,
        listCard: options.listCard,
        merged,
        warnings,
        extraction: {
            page_source_dir: path.resolve(xmlDir),
            screenshot_paths: capture.screenshotPaths.map((filePath) => path.resolve(filePath)),
            xml_dump_count: capture.xmlPaths.length,
            scroll_pass_count: capture.xmlPaths.length,
            ended_at_collapse_schedule: merged.schedule_complete_marker_seen,
            method: options.openFromList
                ? "adb_uiautomator_xml"
                : "adb_uiautomator_xml_current_route",
            opened_from_route_list: openedFromList,
        },
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    if (openedFromList) {
        pressBack(options.deviceId);
        await sleep(BACK_PAUSE_MS);
    }

    return outputPath;
}

/** Extract route detail pages for one language. */
export async function extractRouteDetails(
    options: ExtractRouteDetailsOptions,
): Promise<ExtractRouteDetailsResult> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);
    setStrictNoRouteListRefresh(true);

    const result: ExtractRouteDetailsResult = {
        written: [],
        skipped: [],
        failed: [],
    };

    if (options.replayPageSourcesDir && options.variantCode) {
        const outputPath = await extractOneRoute({
            paths,
            language: options.language,
            deviceId: options.deviceId ?? process.env.ADB_DEVICE_ID ?? DEFAULT_DEVICE_ID,
            packageName: resolveTrainAppPackage(options.packageName),
            variantCode: options.variantCode,
            listCard: null,
            openFromList: false,
            maxScrolls: options.maxScrolls ?? DEFAULT_MAX_SCROLLS,
            scrollPauseMs: options.scrollPauseMs ?? DEFAULT_SCROLL_PAUSE_MS,
            replayPageSourcesDir: options.replayPageSourcesDir,
        });
        result.written.push(outputPath);
        return result;
    }

    const deviceId = options.deviceId ?? process.env.ADB_DEVICE_ID ?? DEFAULT_DEVICE_ID;
    const packageName = resolveTrainAppPackage(options.packageName);

    if (!options.replayPageSourcesDir) {
        ensureDevice(deviceId);
        const focusedApp = getFocusedApp(deviceId);
        if (packageName && !focusedApp.includes(packageName)) {
            throw new Error(
                `Focused app is "${focusedApp}". Open train app (${packageName}) first.`,
            );
        }
    }

    if (options.currentRoute) {
        const { trainNumber, directionCode } = parseVariantCode(options.currentRoute);
        const variantCode = buildVariantCode(trainNumber, directionCode);
        const outputPath = rawRouteDetailPathByVariantCode(paths, options.language, variantCode);

        if (!options.force && fs.existsSync(outputPath)) {
            result.skipped.push(outputPath);
            return result;
        }

        try {
            const writtenPath = await extractOneRoute({
                paths,
                language: options.language,
                deviceId,
                packageName,
                variantCode,
                listCard: null,
                openFromList: false,
                maxScrolls: options.maxScrolls ?? DEFAULT_MAX_SCROLLS,
                scrollPauseMs: options.scrollPauseMs ?? DEFAULT_SCROLL_PAUSE_MS,
            });
            result.written.push(writtenPath);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            result.failed.push({ variant_code: variantCode, error: message });
        }

        return result;
    }

    if (!options.all) {
        throw new Error('Pass --all or --current-route TRAIN-<number>-<UP|DOWN>.');
    }

    const routeList = loadRouteList(paths, options.language);
    for (const listCard of routeList.routes) {
        let variantCode: string;
        try {
            variantCode = variantCodeFromListCard(listCard);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            result.failed.push({ variant_code: `list_index_${listCard.list_index}`, error: message });
            continue;
        }

        const outputPath = rawRouteDetailPathByVariantCode(paths, options.language, variantCode);
        if (!options.force && fs.existsSync(outputPath)) {
            result.skipped.push(outputPath);
            continue;
        }

        try {
            const writtenPath = await extractOneRoute({
                paths,
                language: options.language,
                deviceId,
                packageName,
                variantCode,
                listCard,
                openFromList: true,
                maxScrolls: options.maxScrolls ?? DEFAULT_MAX_SCROLLS,
                scrollPauseMs: options.scrollPauseMs ?? DEFAULT_SCROLL_PAUSE_MS,
            });
            result.written.push(writtenPath);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            result.failed.push({ variant_code: variantCode, error: message });
        }
    }

    return result;
}

function parseCliArgs(argv: string[]): ExtractRouteDetailsOptions {
    const options: ExtractRouteDetailsOptions = {
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
        } else if (arg === "--current-route" && next) {
            options.currentRoute = next.trim();
            i++;
        } else if (arg === "--variant-code" && next) {
            options.variantCode = next.trim();
            i++;
        } else if (arg === "--replay-page-sources" && next) {
            options.replayPageSourcesDir = next.trim();
            i++;
        } else if (arg === "--max-scrolls" && next) {
            options.maxScrolls = Number(next);
            i++;
        } else if (arg === "--all") {
            options.all = true;
        } else if (arg === "--force") {
            options.force = true;
        }
    }

    return options;
}

async function main(): Promise<void> {
    const result = await extractRouteDetails(parseCliArgs(process.argv.slice(2)));
    console.log(`Written: ${result.written.length}`);
    console.log(`Skipped: ${result.skipped.length}`);
    console.log(`Failed: ${result.failed.length}`);
    for (const filePath of result.written) {
        console.log(`  saved ${filePath}`);
    }
    for (const failure of result.failed) {
        console.log(`  failed ${failure.variant_code}: ${failure.error}`);
    }
    if (result.failed.length > 0) {
        process.exitCode = 1;
    }
}

const isCliEntry = process.argv[1]?.includes("extract-route-details.ts");

if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
