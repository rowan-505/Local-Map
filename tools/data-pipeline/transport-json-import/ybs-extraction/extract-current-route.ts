/**
 * Extract the currently opened YBS Go route stop list from ADB UI XML.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    dumpUiXml,
    ensureDevice,
    getFocusedApp,
    getScreenSize,
    scrollDownStopListPage,
    scrollUpStopListPage,
    setStrictNoRouteListRefresh,
    sleep,
    tap,
} from "./adb.js";
import { DEFAULT_PACKAGE, EXTRACTION_SCHEMA_VERSION, resolveFromRepo } from "./config.js";
import { buildEnglishRouteNameFields } from "./english-route-name.js";
import {
    buildRouteDetailIdentitySnapshot,
    buildRouteIndexIdentitySnapshot,
    reconcileRouteIdentities,
    type RouteIdentityRecord,
} from "./route-identity.js";
import {
    detectCurrentDirection,
    detectLanguage,
    detectStopListScrollGap,
    detectYbsScreen,
    findScrollBoundaryOverlap,
    hasDirectionTabsVisible,
    isRouteDetailTopVisible,
    mergeStopRowsFromDumps,
    parseRouteMetadata,
    parseStopPairs,
    parseXmlTextNodes,
    isLikelyRouteBadgeNotOperator,
    type ParsedRouteMetadata,
    resolveDirectionTabTapTarget,
    stopRowDisplayArea,
    stopRowDisplayName,
    stopRowKey,
    validateParsedStops,
    type ExtractDirectionKey,
    type ParsedStopRow,
    type SkippedMetadataRow,
    type VariantQualityStatus,
} from "./parse-ui-xml.js";
import {
    parseStrictNoRouteListRefreshFlag,
    ROUTE_LIST_REFRESH_GESTURE_BLOCKED,
} from "./ybs-navigation-safety.js";

const DEFAULT_DEVICE_ID = "R3CX10JRQNZ";
const DEFAULT_RUN_ROOT = "tmp/transport-imports/ybs-all";
const DEFAULT_MAX_SCROLLS = 40;
const DEFAULT_SCROLL_PAUSE_MS = 700;
const STALE_SCROLL_LIMIT = 3;
const STOP_LIST_SCROLL_STEP_FRACTION = 0.22;
const STOP_LIST_SCROLL_MIN_OVERLAP = 1;
const STOP_LIST_GAP_RECOVERY_MAX = 5;
const STOP_LIST_GAP_BACKSTEP_FRACTION = 0.14;
const STOP_LIST_GAP_BACKSTEP_PAUSE_MS = 220;
const SCROLL_TO_TOP_MAX_ATTEMPTS = 45;
const SCROLL_TO_TOP_PAUSE_MS = 400;
const SCROLL_TO_TOP_FAST_PAUSE_MS = 180;
const SCROLL_TO_TOP_FAST_BURST_SIZE = 3;
const SCROLL_TO_TOP_FAST_STEP_FRACTION = 0.55;
const SCROLL_TO_TOP_FAST_DURATION_MS = 280;
const TAB_TAP_PAUSE_MS = 600;
const TAB_AFTER_SCROLL_PAUSE_MS = 500;
const BOTH_DIRECTIONS: ExtractDirectionKey[] = ["outbound", "inbound"];

function assertRouteDetailBeforeStopListSwipe(xml: string): void {
    const screen = detectYbsScreen(xml);
    if (screen === "route_list" || screen === "loading") {
        throw new Error(
            `${ROUTE_LIST_REFRESH_GESTURE_BLOCKED}: stop-list swipe blocked because current screen is "${screen}".`,
        );
    }
    if (screen !== "route_detail") {
        throw new Error(
            `${ROUTE_LIST_REFRESH_GESTURE_BLOCKED}: stop-list swipe blocked on unexpected screen "${screen}".`,
        );
    }
}

export type RouteLanguage = "my" | "en";
export type ExtractDirectionMode = ExtractDirectionKey | "both";

export type ExtractCurrentRouteOptions = {
    deviceId: string;
    runRoot: string;
    language: RouteLanguage;
    routeCode: string;
    direction: ExtractDirectionMode;
    packageName: string;
    maxScrolls: number;
    scrollPauseMs: number;
    routeIndexIdentity?: RouteIdentityRecord;
    /** Minimum upward scrolls before accepting top-of-list (used after outbound extraction). */
    scrollBackMinimum?: number;
    strictNoRouteListRefresh?: boolean;
};

export type RouteVariantOutput = {
    direction_key: ExtractDirectionKey;
    direction_name: ExtractDirectionKey;
    detected_direction: "outbound" | "inbound" | "all" | "unknown";
    stop_count: number;
    real_stop_count: number;
    quality_status: VariantQualityStatus;
    parser_diagnostics: {
        skipped_metadata_rows: SkippedMetadataRow[];
    };
    stops: Array<{
        sequence: number;
        stop_name_my: string | null;
        stop_name_en: string | null;
        area_text_my: string | null;
        area_text_en: string | null;
        raw_text_my: string | null;
        raw_text_en: string | null;
        raw_text: string;
    }>;
};

type DirectionExtractionResult = {
    variant: RouteVariantOutput;
    xmlPaths: string[];
    warnings: string[];
    scrollCount: number;
};

function pageSourcePath(
    runRoot: string,
    language: RouteLanguage,
    routeCode: string,
    direction: ExtractDirectionKey,
    index: number,
): string {
    return resolveFromRepo(
        path.join(runRoot, language, "page-sources", routeCode, direction, `${String(index).padStart(3, "0")}.xml`),
    );
}

function directionProbePath(
    runRoot: string,
    language: RouteLanguage,
    routeCode: string,
    direction: ExtractDirectionKey,
): string {
    return resolveFromRepo(
        path.join(runRoot, language, "page-sources", routeCode, direction, "direction-probe.xml"),
    );
}

function metadataProbePath(runRoot: string, language: RouteLanguage, routeCode: string): string {
    return resolveFromRepo(
        path.join(runRoot, language, "page-sources", routeCode, "metadata-probe.xml"),
    );
}

function routeJsonPath(runRoot: string, language: RouteLanguage, routeCode: string): string {
    return resolveFromRepo(path.join(runRoot, language, "routes", `${routeCode}.json`));
}

function ensureFocusedApp(deviceId: string, packageName: string): string {
    const focusedApp = getFocusedApp(deviceId);
    if (!focusedApp.includes(packageName)) {
        throw new Error(`Focused app is "${focusedApp}". Open ${packageName} on the device first.`);
    }
    return focusedApp;
}

function mapStops(rows: ParsedStopRow[], language: RouteLanguage): RouteVariantOutput["stops"] {
    return rows.map((row, index) => {
        if (language === "en") {
            const stopName = row.stop_name_en ?? stopRowDisplayName(row);
            const areaText = row.area_text_en ?? stopRowDisplayArea(row);
            const rawText = row.raw_text_en ?? row.raw_text;

            return {
                sequence: index + 1,
                stop_name_my: null,
                stop_name_en: stopName,
                area_text_my: null,
                area_text_en: areaText,
                raw_text_my: null,
                raw_text_en: rawText,
                raw_text: rawText,
            };
        }

        const stopName = row.stop_name_my ?? stopRowDisplayName(row);
        const areaText = row.area_text_my ?? stopRowDisplayArea(row);
        const rawText = row.raw_text_my ?? row.raw_text;

        return {
            sequence: index + 1,
            stop_name_my: stopName,
            stop_name_en: null,
            area_text_my: areaText,
            area_text_en: null,
            raw_text_my: rawText,
            raw_text_en: null,
            raw_text: rawText,
        };
    });
}

function buildEmptyVariant(
    direction: ExtractDirectionKey,
    detectedDirection: RouteVariantOutput["detected_direction"] = "unknown",
): RouteVariantOutput {
    return {
        direction_key: direction,
        direction_name: direction,
        detected_direction: detectedDirection,
        stop_count: 0,
        real_stop_count: 0,
        quality_status: "failed",
        parser_diagnostics: {
            skipped_metadata_rows: [],
        },
        stops: [],
    };
}

function resolveVariantQualityStatus(input: {
    extractionFailed: boolean;
    realStopCount: number;
}): VariantQualityStatus {
    if (input.extractionFailed || input.realStopCount === 0) {
        return "failed";
    }
    return "success";
}

function directionsToExtract(mode: ExtractDirectionMode): ExtractDirectionKey[] {
    if (mode === "both") {
        return [...BOTH_DIRECTIONS];
    }
    return [mode];
}

async function captureViewportStops(
    options: ExtractCurrentRouteOptions,
    direction: ExtractDirectionKey,
    dumpIndex: number,
): Promise<{
    xmlPath: string;
    stops: ParsedStopRow[];
    warnings: string[];
    skipped_metadata_rows: SkippedMetadataRow[];
}> {
    const xmlPath = pageSourcePath(
        options.runRoot,
        options.language,
        options.routeCode,
        direction,
        dumpIndex,
    );

    dumpUiXml(options.deviceId, xmlPath);
    const xml = fs.readFileSync(xmlPath, "utf8");
    const nodes = parseXmlTextNodes(xml);
    const parsed = parseStopPairs(nodes, options.language);

    return {
        xmlPath,
        stops: parsed.stops,
        warnings: parsed.warnings,
        skipped_metadata_rows: parsed.skipped_metadata_rows,
    };
}

export type EnsureDirectionTabsVisibleResult = {
    ok: boolean;
    xml: string;
    nodes: ReturnType<typeof parseXmlTextNodes>;
    scrollsPerformed: number;
    screenHeight: number;
};

/**
 * Scroll toward the route detail top until header and direction tabs are visible.
 * Uses safe downward finger swipes (content moves up). No pull-to-refresh.
 */
export async function ensureDirectionTabsVisible(
    deviceId: string,
    probePath: string,
    options: { maxAttempts?: number; minimumScrolls?: number } = {},
): Promise<EnsureDirectionTabsVisibleResult> {
    const maxAttempts = options.maxAttempts ?? SCROLL_TO_TOP_MAX_ATTEMPTS;
    const minimumScrolls = options.minimumScrolls ?? 0;
    const useFastReturn = minimumScrolls > 0;
    const { height: screenHeight } = getScreenSize(deviceId);

    fs.mkdirSync(path.dirname(probePath), { recursive: true });

    let lastXml = "";
    let lastNodes = parseXmlTextNodes("");
    let scrollsPerformed = 0;

    const readProbe = (): void => {
        dumpUiXml(deviceId, probePath);
        lastXml = fs.readFileSync(probePath, "utf8");
        lastNodes = parseXmlTextNodes(lastXml);
    };

    const topIsReady = (): boolean =>
        isRouteDetailTopVisible(lastNodes, screenHeight) && scrollsPerformed >= minimumScrolls;

    readProbe();
    if (topIsReady()) {
        return {
            ok: true,
            xml: lastXml,
            nodes: lastNodes,
            scrollsPerformed,
            screenHeight,
        };
    }

    while (scrollsPerformed < maxAttempts) {
        assertRouteDetailBeforeStopListSwipe(lastXml);

        const burstSize = useFastReturn
            ? Math.min(SCROLL_TO_TOP_FAST_BURST_SIZE, maxAttempts - scrollsPerformed)
            : 1;

        for (let burstIndex = 0; burstIndex < burstSize && scrollsPerformed < maxAttempts; burstIndex++) {
            scrollUpStopListPage(
                deviceId,
                useFastReturn
                    ? {
                          stepFraction: SCROLL_TO_TOP_FAST_STEP_FRACTION,
                          durationMs: SCROLL_TO_TOP_FAST_DURATION_MS,
                      }
                    : undefined,
            );
            scrollsPerformed++;
            await sleep(useFastReturn ? SCROLL_TO_TOP_FAST_PAUSE_MS : SCROLL_TO_TOP_PAUSE_MS);
        }

        readProbe();
        if (topIsReady()) {
            return {
                ok: true,
                xml: lastXml,
                nodes: lastNodes,
                scrollsPerformed,
                screenHeight,
            };
        }
    }

    return {
        ok: topIsReady(),
        xml: lastXml,
        nodes: lastNodes,
        scrollsPerformed,
        screenHeight,
    };
}

/** Parse route header metadata once from the route detail screen. */
async function captureRouteMetadataOnce(
    options: ExtractCurrentRouteOptions,
): Promise<{
    metadata: ParsedRouteMetadata;
    detectedLanguage: ReturnType<typeof detectLanguage>;
    warnings: string[];
}> {
    const warnings: string[] = [];
    const probePath = metadataProbePath(options.runRoot, options.language, options.routeCode);
    const topScreen = await ensureDirectionTabsVisible(options.deviceId, probePath);

    if (!topScreen.ok) {
        warnings.push(
            `Could not find direction tabs on screen. Open the YBS route stop list for ${options.routeCode} first.`,
        );
    } else if (!isRouteDetailTopVisible(topScreen.nodes, topScreen.screenHeight)) {
        warnings.push("Direction tabs are in XML but route detail header is not fully visible.");
    }

    const screen = { xml: topScreen.xml, nodes: topScreen.nodes };

    const detectedLanguage = detectLanguage(screen.nodes);
    warnings.push(...detectedLanguage.warnings);

    if (
        detectedLanguage.language !== "mixed" &&
        detectedLanguage.language !== options.language
    ) {
        warnings.push(
            `CLI language is "${options.language}" but screen looks like "${detectedLanguage.language}".`,
        );
    }

    const metadata = parseRouteMetadata(screen.nodes, options.routeCode);

    return { metadata, detectedLanguage, warnings };
}

async function prepareDirectionTab(
    options: ExtractCurrentRouteOptions,
    direction: ExtractDirectionKey,
): Promise<{
    ok: boolean;
    detectedDirection: ReturnType<typeof detectCurrentDirection>;
    warnings: string[];
}> {
    const warnings: string[] = [];
    const probePath = directionProbePath(options.runRoot, options.language, options.routeCode, direction);
    const minimumScrolls = options.scrollBackMinimum ?? 0;
    const topScreen = await ensureDirectionTabsVisible(options.deviceId, probePath, {
        minimumScrolls,
    });
    const lastXml = topScreen.xml;
    const lastNodes = topScreen.nodes;

    if (!topScreen.ok) {
        warnings.push(
            `Could not scroll back to route detail header after ${topScreen.scrollsPerformed} upward swipe(s). Direction tabs are not visible.`,
        );
        warnings.push(
            `Could not find direction tabs on screen. Open the YBS route stop list for ${options.routeCode} first.`,
        );

        return {
            ok: false,
            detectedDirection: detectCurrentDirection(lastNodes, lastXml),
            warnings,
        };
    }

    if (!hasDirectionTabsVisible(lastNodes, topScreen.screenHeight)) {
        warnings.push("Direction tabs are not visible in the upper screen area after scrolling to top.");
        return {
            ok: false,
            detectedDirection: detectCurrentDirection(lastNodes, lastXml),
            warnings,
        };
    }

    const tapTarget = resolveDirectionTabTapTarget(lastXml, direction);
    if (!tapTarget) {
        warnings.push(`Direction tabs are visible but "${direction}" tab was not found.`);

        return {
            ok: false,
            detectedDirection: detectCurrentDirection(lastNodes, lastXml),
            warnings,
        };
    }

    const detected = detectCurrentDirection(lastNodes, lastXml);

    if (detected.direction === "all") {
        warnings.push("All tab appears selected. Tapping the requested direction tab before extraction.");
    } else if (detected.direction !== "unknown" && detected.direction !== direction) {
        warnings.push(`Screen looked like "${detected.direction}" before tap. Tapping "${direction}" tab.`);
    }

    if (detected.direction !== direction) {
        tap(options.deviceId, tapTarget.centerX, tapTarget.centerY);
        await sleep(TAB_TAP_PAUSE_MS);

        dumpUiXml(options.deviceId, probePath);
        const afterXml = fs.readFileSync(probePath, "utf8");
        const afterNodes = parseXmlTextNodes(afterXml);
        const afterTap = detectCurrentDirection(afterNodes, afterXml);
        warnings.push(...afterTap.warnings);

        if (afterTap.direction === "all") {
            warnings.push(
                "All tab still looks selected after tap. Stop extraction to avoid mixed-direction stops.",
            );
            return { ok: false, detectedDirection: afterTap, warnings };
        }

        if (afterTap.direction !== "unknown" && afterTap.direction !== direction) {
            warnings.push(
                `After tap, screen still looks like "${afterTap.direction}" instead of "${direction}".`,
            );
            return { ok: false, detectedDirection: afterTap, warnings };
        }

        await sleep(TAB_AFTER_SCROLL_PAUSE_MS);

        const finalDirection =
            afterTap.direction === "unknown"
                ? {
                      direction,
                      warnings: [
                          ...afterTap.warnings,
                          `Tapped "${tapTarget.label}" but selected tab state is unclear. Continuing with requested direction.`,
                      ],
                  }
                : afterTap;

        return { ok: true, detectedDirection: finalDirection, warnings };
    }

    return { ok: true, detectedDirection: detected, warnings };
}

function parseStopsFromXml(xml: string, language: RouteLanguage): ParsedStopRow[] {
    return parseStopPairs(parseXmlTextNodes(xml), language).stops;
}

/**
 * Scroll the stop list down while keeping at least one overlapping row between dumps.
 * When a gap is detected from live XML, scroll back and retry with a smaller step.
 */
async function scrollStopListWithOverlapGuard(
    options: ExtractCurrentRouteOptions,
    previousStops: ParsedStopRow[],
    probeBasePath: string,
    warnings: string[],
): Promise<number> {
    let stepFraction = STOP_LIST_SCROLL_STEP_FRACTION;
    let scrollAttempts = 0;

    for (let recoveryAttempt = 0; recoveryAttempt < STOP_LIST_GAP_RECOVERY_MAX; recoveryAttempt++) {
        const liveProbePath = `${probeBasePath}.pre-swipe-live.xml`;
        dumpUiXml(options.deviceId, liveProbePath);
        assertRouteDetailBeforeStopListSwipe(fs.readFileSync(liveProbePath, "utf8"));

        scrollDownStopListPage(options.deviceId, {
            stepFraction,
            durationMs: 380,
        });
        scrollAttempts++;
        await sleep(options.scrollPauseMs);

        const postScrollProbePath = `${probeBasePath}.post-swipe-overlap-probe.xml`;
        dumpUiXml(options.deviceId, postScrollProbePath);
        assertRouteDetailBeforeStopListSwipe(fs.readFileSync(postScrollProbePath, "utf8"));

        const probeStops = parseStopsFromXml(
            fs.readFileSync(postScrollProbePath, "utf8"),
            options.language,
        );
        const overlap = findScrollBoundaryOverlap(previousStops, probeStops);

        if (overlap >= STOP_LIST_SCROLL_MIN_OVERLAP) {
            return scrollAttempts;
        }

        if (!detectStopListScrollGap(previousStops, probeStops)) {
            return scrollAttempts;
        }

        warnings.push(
            `STOP_LIST_SCROLL_GAP_RECOVERING: overlap=${overlap}, step=${stepFraction.toFixed(2)}, attempt=${recoveryAttempt + 1}`,
        );

        scrollUpStopListPage(options.deviceId, {
            stepFraction: STOP_LIST_GAP_BACKSTEP_FRACTION,
            durationMs: 280,
        });
        scrollAttempts++;
        await sleep(STOP_LIST_GAP_BACKSTEP_PAUSE_MS);
        stepFraction = Math.max(0.12, stepFraction * 0.82);
    }

    warnings.push("STOP_LIST_SCROLL_GAP_RECOVERY_EXHAUSTED");
    return scrollAttempts;
}

async function collectStopDumps(
    options: ExtractCurrentRouteOptions,
    direction: ExtractDirectionKey,
    detectedDirection: ReturnType<typeof detectCurrentDirection>,
): Promise<{
    xmlPaths: string[];
    dumpRows: ParsedStopRow[][];
    warnings: string[];
    skipped_metadata_rows: SkippedMetadataRow[];
    scrollCount: number;
}> {
    const warnings: string[] = [];
    const xmlPaths: string[] = [];
    const dumpRows: ParsedStopRow[][] = [];
    const skipped_metadata_rows: SkippedMetadataRow[] = [];
    const seenAcrossDumps = new Set<string>();

    let staleScrolls = 0;
    let scrollCount = 0;

    for (let dumpIndex = 0; dumpIndex < options.maxScrolls; dumpIndex++) {
        const captured = await captureViewportStops(options, direction, dumpIndex);
        xmlPaths.push(captured.xmlPath);
        dumpRows.push(captured.stops);
        warnings.push(...captured.warnings);
        skipped_metadata_rows.push(...captured.skipped_metadata_rows);

        if (dumpIndex === 0) {
            const xml = fs.readFileSync(captured.xmlPath, "utf8");
            const nodes = parseXmlTextNodes(xml);
            const onScreenDirection = detectCurrentDirection(nodes, xml);
            if (onScreenDirection.direction === "all") {
                warnings.push("All tab appears selected during extraction. Stop list may be mixed.");
            } else if (
                onScreenDirection.direction !== "unknown" &&
                onScreenDirection.direction !== direction
            ) {
                warnings.push(
                    `Extraction screen looks like "${onScreenDirection.direction}" instead of "${direction}".`,
                );
            } else if (
                detectedDirection.direction !== "unknown" &&
                onScreenDirection.direction === "unknown"
            ) {
                warnings.push(
                    `Requested "${direction}" but selected tab state became unclear during extraction.`,
                );
            }

            if (captured.stops.length === 0) {
                warnings.push("No stop rows found on first screen after direction tab selection.");
            }
        }

        const newRows = captured.stops.filter((row) => !seenAcrossDumps.has(stopRowKey(row)));
        const madeProgress = newRows.length > 0;

        if (madeProgress) {
            staleScrolls = 0;
            for (const row of newRows) {
                seenAcrossDumps.add(stopRowKey(row));
            }
        } else {
            staleScrolls++;
        }

        if (staleScrolls >= STALE_SCROLL_LIMIT) {
            break;
        }

        scrollCount += await scrollStopListWithOverlapGuard(
            options,
            captured.stops,
            captured.xmlPath,
            warnings,
        );
    }

    return { xmlPaths, dumpRows, warnings, skipped_metadata_rows, scrollCount };
}

async function extractDirectionVariant(
    options: ExtractCurrentRouteOptions,
    direction: ExtractDirectionKey,
): Promise<DirectionExtractionResult> {
    const warnings: string[] = [];
    const tabPrep = await prepareDirectionTab(options, direction);
    warnings.push(...tabPrep.warnings);

    if (!tabPrep.ok) {
        warnings.push(`Stopped before extraction because "${direction}" tab could not be selected safely.`);
        return {
            variant: buildEmptyVariant(direction, tabPrep.detectedDirection.direction),
            xmlPaths: [],
            warnings,
            scrollCount: 0,
        };
    }

    const collected = await collectStopDumps(options, direction, tabPrep.detectedDirection);
    const merged = mergeStopRowsFromDumps(collected.dumpRows);
    const stops = mapStops(merged.stops, options.language);
    const realStopCount = stops.length;
    const qualityStatus = resolveVariantQualityStatus({
        extractionFailed: false,
        realStopCount,
    });

    warnings.push(...collected.warnings, ...merged.warnings, ...validateParsedStops(merged.stops));

    if (stops.length === 0) {
        warnings.push(`Final ${direction} stop list is empty.`);
    }

    return {
        variant: {
            direction_key: direction,
            direction_name: direction,
            detected_direction: tabPrep.detectedDirection.direction,
            stop_count: realStopCount,
            real_stop_count: realStopCount,
            quality_status: qualityStatus,
            parser_diagnostics: {
                skipped_metadata_rows: collected.skipped_metadata_rows,
            },
            stops,
        },
        xmlPaths: collected.xmlPaths,
        warnings,
        scrollCount: collected.scrollCount,
    };
}

function validateTotalStopCount(
    appTotalStopCount: number | null,
    variants: RouteVariantOutput[],
): string[] {
    const warnings: string[] = [];
    const outboundCount = variants.find((variant) => variant.direction_key === "outbound")?.real_stop_count ?? 0;
    const inboundCount = variants.find((variant) => variant.direction_key === "inbound")?.real_stop_count ?? 0;
    const directionStopCountSum = outboundCount + inboundCount;

    if (appTotalStopCount !== null && directionStopCountSum !== appTotalStopCount) {
        warnings.push("TOTAL_STOP_COUNT_MISMATCH");
        warnings.push(
            `App shows ${appTotalStopCount} stops (${directionStopCountSum} extracted: outbound ${outboundCount} + inbound ${inboundCount}).`,
        );
    }

    return warnings;
}

function resolveRouteQualityStatus(variants: RouteVariantOutput[]): VariantQualityStatus {
    if (variants.some((variant) => variant.quality_status === "failed")) {
        return "failed";
    }
    return "success";
}

function resolveExtractionStatus(variants: RouteVariantOutput[]): "success" | "failed" {
    return resolveRouteQualityStatus(variants) === "failed" ? "failed" : "success";
}

type ResolvedRouteHeaderFields = {
    route_name_my: string | null;
    route_name_en: string | null;
    operator_name: string | null;
    fare_text: string | null;
    fare_min: number | null;
    fare_max: number | null;
};

function resolveRouteHeaderFields(
    metadata: ParsedRouteMetadata,
    language: RouteLanguage,
    routeIndexIdentity: ReturnType<typeof buildRouteIndexIdentitySnapshot> | null,
    warnings: string[],
): ResolvedRouteHeaderFields {
    let route_name_my = metadata.route_name_my;
    let operator_name = metadata.operator_name;

    if (language === "my" && !route_name_my && routeIndexIdentity?.route_title_my) {
        route_name_my = routeIndexIdentity.route_title_my;
        warnings.push("ROUTE_NAME_MY_FALLBACK_FROM_ROUTE_INDEX");
    }

    if (
        isLikelyRouteBadgeNotOperator(operator_name) &&
        routeIndexIdentity?.operator_name &&
        !isLikelyRouteBadgeNotOperator(routeIndexIdentity.operator_name)
    ) {
        operator_name = routeIndexIdentity.operator_name;
        warnings.push("OPERATOR_NAME_FALLBACK_FROM_ROUTE_INDEX");
    }

    if (language === "my" && !route_name_my) {
        warnings.push("ROUTE_NAME_MY_MISSING");
    }

    if (!operator_name || isLikelyRouteBadgeNotOperator(operator_name)) {
        warnings.push("OPERATOR_NAME_MISSING_OR_INVALID");
    }

    if (!metadata.fare_text && metadata.fare_min === null && metadata.fare_max === null) {
        warnings.push("FARE_FIELDS_MISSING");
    }

    return {
        route_name_my: language === "my" ? route_name_my : null,
        route_name_en: null,
        operator_name,
        fare_text: metadata.fare_text,
        fare_min: metadata.fare_min,
        fare_max: metadata.fare_max,
    };
}

/** Extract one open route and write combined route JSON. */
export async function extractCurrentRoute(options: ExtractCurrentRouteOptions): Promise<string> {
    setStrictNoRouteListRefresh(options.strictNoRouteListRefresh ?? true);

    const outputPath = routeJsonPath(options.runRoot, options.language, options.routeCode);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    ensureDevice(options.deviceId);
    const focusedApp = ensureFocusedApp(options.deviceId, options.packageName);

    const warnings: string[] = [];
    const directions = directionsToExtract(options.direction);
    const xmlPaths: string[] = [];

    const metadataCapture = await captureRouteMetadataOnce(options);
    warnings.push(...metadataCapture.warnings);

    const routeMetadata = metadataCapture.metadata;
    const variants: RouteVariantOutput[] = [];
    let previousScrollCount = 0;

    for (const direction of directions) {
        const result = await extractDirectionVariant(
            { ...options, scrollBackMinimum: previousScrollCount },
            direction,
        );
        variants.push(result.variant);
        xmlPaths.push(...result.xmlPaths);
        warnings.push(...result.warnings);
        previousScrollCount = result.scrollCount;
    }

    const outboundVariant = variants.find((variant) => variant.direction_key === "outbound");
    const inboundVariant = variants.find((variant) => variant.direction_key === "inbound");
    const outboundStopCount = outboundVariant?.real_stop_count ?? 0;
    const inboundStopCount = inboundVariant?.real_stop_count ?? 0;
    const directionStopCountSum = outboundStopCount + inboundStopCount;
    const appTotalStopCount = routeMetadata.stop_count;
    const matchesAppTotalStopCount =
        appTotalStopCount === null ? null : directionStopCountSum === appTotalStopCount;
    const qualityStatus = resolveRouteQualityStatus(variants);
    const extractionStatus = resolveExtractionStatus(variants);

    if (options.direction === "both") {
        warnings.push(...validateTotalStopCount(appTotalStopCount, variants));
    }

    const routeIndexIdentity = options.routeIndexIdentity
        ? buildRouteIndexIdentitySnapshot(options.routeIndexIdentity)
        : null;

    const provisionalRouteCode =
        options.routeIndexIdentity?.route_code_candidate ?? options.routeCode;

    const resolvedHeader = resolveRouteHeaderFields(
        routeMetadata,
        options.language,
        routeIndexIdentity,
        warnings,
    );

    const routeDetailIdentity = buildRouteDetailIdentitySnapshot(
        {
            route_number: routeMetadata.route_number,
            route_name_my: resolvedHeader.route_name_my,
            route_name_en: resolvedHeader.route_name_en,
            operator_name: resolvedHeader.operator_name,
        },
        provisionalRouteCode,
    );

    const reconciliation = routeIndexIdentity
        ? reconcileRouteIdentities(routeIndexIdentity, routeDetailIdentity)
        : {
              route_code_candidate: provisionalRouteCode,
              identity_status: routeDetailIdentity.identity_status,
              warnings: [],
          };

    warnings.push(...reconciliation.warnings);

    const finalRouteCode = reconciliation.route_code_candidate ?? options.routeCode;
    routeDetailIdentity.route_code_candidate = finalRouteCode;

    const englishNameFields =
        options.language === "en"
            ? buildEnglishRouteNameFields({
                  variants: variants.map((variant) => ({
                      direction_key: variant.direction_key,
                      stops: variant.stops,
                  })),
                  detailTitleRaw: resolvedHeader.route_name_my,
              })
            : null;

    const output = {
        extraction_schema_version: EXTRACTION_SCHEMA_VERSION,
        source: {
            source_name: "external_ybs_app",
            source_kind: "visible_app_extraction",
            source_method: "adb_uiautomator_xml",
            device_id: options.deviceId,
            package: options.packageName,
            focused_app: focusedApp,
            captured_at: new Date().toISOString(),
        },
        route_index_identity: routeIndexIdentity,
        route_detail_identity: routeDetailIdentity,
        route: {
            route_code_candidate: finalRouteCode,
            route_number: routeMetadata.route_number,
            route_display_code:
                routeIndexIdentity?.route_display_code ??
                (routeMetadata.route_number === null ? null : String(routeMetadata.route_number)),
            route_name_my: resolvedHeader.route_name_my,
            route_detail_title_en_raw: englishNameFields?.route_detail_title_en_raw ?? null,
            route_name_en: englishNameFields?.route_name_en ?? null,
            route_name_en_source: englishNameFields?.route_name_en_source ?? null,
            route_name_en_confidence: englishNameFields?.route_name_en_confidence ?? null,
            needs_route_name_review: englishNameFields?.needs_route_name_review ?? null,
            operator_name: resolvedHeader.operator_name,
            fare_text: resolvedHeader.fare_text,
            fare_min: resolvedHeader.fare_min,
            fare_max: resolvedHeader.fare_max,
            app_total_stop_count: appTotalStopCount,
            identity_status: reconciliation.identity_status,
        },
        variants: variants.map((variant) => ({
            direction_key: variant.direction_key,
            stop_count: variant.stop_count,
            real_stop_count: variant.real_stop_count,
            quality_status: variant.quality_status,
            parser_diagnostics: variant.parser_diagnostics,
            stops: variant.stops,
        })),
        validation: {
            direction_stop_count_sum: directionStopCountSum,
            matches_app_total_stop_count: matchesAppTotalStopCount,
            quality_status: qualityStatus,
        },
        extraction: {
            language: options.language,
            detected_language: metadataCapture.detectedLanguage.language,
            directions_extracted: directions,
            extraction_status: extractionStatus,
            quality_status: qualityStatus,
            outbound_stop_count: outboundStopCount,
            inbound_stop_count: inboundStopCount,
            outbound_real_stop_count: outboundStopCount,
            inbound_real_stop_count: inboundStopCount,
            run_root: resolveFromRepo(options.runRoot),
            xml_dump_count: xmlPaths.length,
            xml_paths: xmlPaths,
        },
        warnings,
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return outputPath;
}

function parseCliArgs(argv: string[]): ExtractCurrentRouteOptions {
    const options: ExtractCurrentRouteOptions = {
        deviceId: DEFAULT_DEVICE_ID,
        runRoot: DEFAULT_RUN_ROOT,
        language: "my",
        routeCode: "YBS-UNKNOWN",
        direction: "both",
        packageName: DEFAULT_PACKAGE,
        maxScrolls: DEFAULT_MAX_SCROLLS,
        scrollPauseMs: DEFAULT_SCROLL_PAUSE_MS,
        strictNoRouteListRefresh: true,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--device" && next) {
            options.deviceId = next;
            i++;
        } else if (arg === "--run" && next) {
            options.runRoot = next;
            i++;
        } else if (arg === "--language" && next) {
            if (next !== "my" && next !== "en") {
                throw new Error('--language must be "my" or "en"');
            }
            options.language = next;
            i++;
        } else if (arg === "--route-code" && next) {
            options.routeCode = next;
            i++;
        } else if (arg === "--direction" && next) {
            if (next !== "outbound" && next !== "inbound" && next !== "both") {
                throw new Error('--direction must be "outbound", "inbound", or "both". Do not use "all".');
            }
            options.direction = next;
            i++;
        } else if (arg === "--max-scrolls" && next) {
            options.maxScrolls = Number(next);
            i++;
        } else if (arg === "--strict-no-route-list-refresh" && next) {
            options.strictNoRouteListRefresh = parseStrictNoRouteListRefreshFlag(next);
            i++;
        }
    }

    setStrictNoRouteListRefresh(options.strictNoRouteListRefresh ?? true);

    return options;
}

function isCliInvocation(): boolean {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("extract-current-route.ts") || entry.endsWith("extract-current-route.js");
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));

    const outputPath = await extractCurrentRoute(options);
    const raw = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
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

    console.log(`Wrote ${outputPath}`);
    console.log(
        [
            `app_total_stop_count: ${raw.route?.app_total_stop_count ?? "n/a"}`,
            `outbound stop_count: ${raw.extraction?.outbound_stop_count ?? "n/a"}`,
            `inbound stop_count: ${raw.extraction?.inbound_stop_count ?? "n/a"}`,
            `direction_stop_count_sum: ${raw.validation?.direction_stop_count_sum ?? "n/a"}`,
            `matches_app_total_stop_count: ${raw.validation?.matches_app_total_stop_count ?? "n/a"}`,
            `quality_status: ${raw.extraction?.quality_status ?? raw.validation?.quality_status ?? "n/a"}`,
        ].join("\n"),
    );
}

if (isCliInvocation()) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
