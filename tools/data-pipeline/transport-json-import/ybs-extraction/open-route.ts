/**
 * Open-route.ts — route list navigation with strict no-refresh guards.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    dumpUiXml,
    ensureDevice,
    getFocusedApp,
    getScreenSize,
    pressBack,
    scrollDownRouteList,
    setStrictNoRouteListRefresh,
    sleep,
    tap,
} from "./adb.js";
import { DEFAULT_PACKAGE, defaultConfig, resolveFromRepo } from "./config.js";
import {
    findBestRouteCardMatch,
    findBestRouteCardMatchAmongTargets,
    isConfidentRouteCardMatch,
    MIN_ROUTE_CARD_MATCH_SCORE,
    scoreRouteCardMatch,
    type RouteCardMatchResult,
} from "./route-card-match.js";
import { loadRouteIndexFile, loadRouteIndexItem, type RouteIndexLanguage } from "./route-index-store.js";
import type { RouteIdentityRecord } from "./route-identity.js";
import {
    assertRouteListNotLoadingOrRefreshing,
    detectYbsScreen,
    findStopDetailBackTapTarget,
    isRouteDetailScreen,
    isRouteListScreen,
    isStopDetailScreen,
    parseRouteIndexRows,
    parseXmlTextNodes,
    ROUTE_LIST_LOADING_STATE,
    type ParsedRouteIndexRow,
    YBS_APP_NOT_IN_FOREGROUND,
} from "./parse-ui-xml.js";
import {
    parseStrictNoRouteListRefreshFlag,
    ROUTE_LIST_LOADING_OR_REFRESHING,
    TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED,
} from "./ybs-navigation-safety.js";

const DEFAULT_RUN_ROOT = "tmp/transport-imports/ybs-all";
const DEFAULT_DEVICE_ID = "R3CX10JRQNZ";
const MAX_LIST_SCROLLS = 80;
const LIST_SCROLL_PAUSE_MS = 700;
const STALE_LIST_SCROLL_LIMIT = 2;
const TAP_PAUSE_MS = 900;
const BACK_PAUSE_MS = 500;
const MAX_BACK_ATTEMPTS = 6;

export type OpenRouteOptions = {
    deviceId: string;
    runRoot: string;
    language: RouteIndexLanguage;
    routeCode: string;
    packageName: string;
    indexPath?: string;
    maxListScrolls?: number;
    minMatchScore?: number;
    routeIndexItem?: RouteIdentityRecord;
    strictNoRouteListRefresh?: boolean;
};

export type OpenRouteResult = {
    routeCode: string;
    routeIndexItem: RouteIdentityRecord;
    match: RouteCardMatchResult;
    scrollAttempts: number;
    xmlPath: string;
    warnings: string[];
};

function openRouteProbePath(
    runRoot: string,
    language: RouteIndexLanguage,
    routeCode: string,
    label: string,
): string {
    return resolveFromRepo(
        path.join(runRoot, language, "page-sources", routeCode, "open-route", `${label}.xml`),
    );
}

function readScreen(deviceId: string, xmlPath: string): {
    xml: string;
    nodes: ReturnType<typeof parseXmlTextNodes>;
} {
    dumpUiXml(deviceId, xmlPath);
    const xml = fs.readFileSync(xmlPath, "utf8");
    return { xml, nodes: parseXmlTextNodes(xml) };
}

function ensureFocusedApp(deviceId: string, packageName: string): string {
    const focusedApp = getFocusedApp(deviceId);
    if (!focusedApp.includes(packageName)) {
        throw new Error(`Focused app is "${focusedApp}". Open ${packageName} first.`);
    }
    return focusedApp;
}

function assertRouteListSafe(xml: string): void {
    assertRouteListNotLoadingOrRefreshing(xml);
}

function assertYbsInForeground(deviceId: string, packageName: string): void {
    const focusedApp = getFocusedApp(deviceId);
    if (!focusedApp.includes(packageName)) {
        throw new Error(
            `${YBS_APP_NOT_IN_FOREGROUND}: YBS app is not in foreground (focused: ${focusedApp}). ` +
                "Re-open YBS Go on the route list and retry.",
        );
    }
}

function findListOrderForVisibleCard(
    card: ParsedRouteIndexRow,
    indexRoutes: RouteIdentityRecord[],
    minMatchScore: number,
): number | null {
    for (const route of indexRoutes) {
        const match = findBestRouteCardMatch(route, [card], minMatchScore);
        if (match && match.score >= minMatchScore) {
            return route.list_order;
        }
    }
    return null;
}

function assertTargetRouteNotAboveVisibleWindow(
    target: RouteIdentityRecord,
    visibleCards: ParsedRouteIndexRow[],
    indexRoutes: RouteIdentityRecord[],
    minMatchScore: number,
): void {
    if (!target.list_order) {
        return;
    }

    const visibleOrders = visibleCards
        .map((card) => findListOrderForVisibleCard(card, indexRoutes, minMatchScore))
        .filter((order): order is number => typeof order === "number");

    if (visibleOrders.length === 0) {
        return;
    }

    const minVisibleOrder = Math.min(...visibleOrders);
    if (minVisibleOrder > target.list_order) {
        throw new Error(
            `${TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED}: ` +
                `Route "${target.route_code_candidate}" (list_order ${target.list_order}) is above the current route list window ` +
                `(earliest visible list_order ${minVisibleOrder}). ` +
                "Manually return to the top/desired part of the route list without pull-refresh, then rerun.",
        );
    }
}

/**
 * Move from route detail or another screen back to the route list when possible.
 * Allowed actions only: XML dump, back button. Never refresh or relaunch.
 */
export async function ensureOnRouteListScreen(
    deviceId: string,
    probePath: string,
    packageName: string = DEFAULT_PACKAGE,
): Promise<{ xml: string; nodes: ReturnType<typeof parseXmlTextNodes> }> {
    let screen = readScreen(deviceId, probePath);

    for (let attempt = 0; attempt < MAX_BACK_ATTEMPTS; attempt++) {
        assertYbsInForeground(deviceId, packageName);

        if (isRouteListScreen(screen.nodes)) {
            assertRouteListSafe(screen.xml);
            return screen;
        }

        assertRouteListSafe(screen.xml);

        if (isRouteDetailScreen(screen.nodes)) {
            pressBack(deviceId);
            await sleep(BACK_PAUSE_MS);
            screen = readScreen(deviceId, probePath);
            continue;
        }

        const { width, height } = getScreenSize(deviceId);
        if (isStopDetailScreen(screen.nodes, height)) {
            const backTap = findStopDetailBackTapTarget(screen.xml, height, width);
            if (backTap) {
                tap(deviceId, backTap.centerX, backTap.centerY);
            } else {
                pressBack(deviceId);
            }
            await sleep(BACK_PAUSE_MS);
            screen = readScreen(deviceId, probePath);
            continue;
        }

        pressBack(deviceId);
        await sleep(BACK_PAUSE_MS);
        screen = readScreen(deviceId, probePath);
    }

    assertYbsInForeground(deviceId, packageName);

    if (!isRouteListScreen(screen.nodes)) {
        throw new Error(
            "Could not reach the YBS route list screen. Open the ဘတ်စ်များ route list first.",
        );
    }

    assertRouteListSafe(screen.xml);
    return screen;
}

function visibleCardsFingerprint(cards: ParsedRouteIndexRow[]): string {
    return cards
        .map(
            (card) =>
                `${card.route_display_code ?? ""}|${card.route_title_my ?? ""}|${card.card_bounds?.centerY ?? 0}`,
        )
        .join(";");
}

function resolveMatchedRouteIndexItem(
    targets: RouteIdentityRecord[],
    match: RouteCardMatchResult,
): RouteIdentityRecord {
    let bestTarget = targets[0];
    let bestScore = -1;

    for (const target of targets) {
        const scored = scoreRouteCardMatch(target, match.row);
        if (scored.score > bestScore) {
            bestScore = scored.score;
            bestTarget = target;
        }
    }

    return bestTarget;
}

/** Scroll the route list and find the best matching card for one index item. Does not tap. */
export async function findRouteCardOnList(options: OpenRouteOptions): Promise<OpenRouteResult> {
    ensureDevice(options.deviceId);
    ensureFocusedApp(options.deviceId, options.packageName);
    setStrictNoRouteListRefresh(options.strictNoRouteListRefresh ?? true);

    const indexPath =
        options.indexPath ??
        resolveFromRepo(path.join(options.runRoot, "route-index", `route-index-${options.language}.json`));
    const indexRoutes = loadRouteIndexFile(indexPath).routes;

    const routeCode =
        options.routeIndexItem?.route_code_candidate ??
        options.routeCode;
    const routeIndexItems = indexRoutes.filter((route) => route.route_code_candidate === routeCode);
    const routeIndexItem = routeIndexItems[0] ?? options.routeIndexItem ?? loadRouteIndexItem({
        routeCode: options.routeCode,
        language: options.language,
        runRoot: options.runRoot,
        indexPath: options.indexPath,
    });
    const warnings: string[] = [];
    const probeDir = openRouteProbePath(options.runRoot, options.language, routeCode, "list-start");
    fs.mkdirSync(path.dirname(probeDir), { recursive: true });

    await ensureOnRouteListScreen(options.deviceId, probeDir, options.packageName);

    const maxScrolls = options.maxListScrolls ?? MAX_LIST_SCROLLS;
    const minScore = options.minMatchScore ?? MIN_ROUTE_CARD_MATCH_SCORE;
    let bestOverall: RouteCardMatchResult | null = null;
    let bestXmlPath = probeDir;
    let scrollAttempts = 0;
    let lastFingerprint = "";
    let staleScrolls = 0;

    for (let scrollIndex = 0; scrollIndex < maxScrolls; scrollIndex++) {
        scrollAttempts = scrollIndex;
        const xmlPath = openRouteProbePath(
            options.runRoot,
            options.language,
            routeCode,
            `scan-${String(scrollIndex).padStart(3, "0")}`,
        );
        const screen = readScreen(options.deviceId, xmlPath);
        assertRouteListSafe(screen.xml);

        const ybsScreen = detectYbsScreen(screen.xml);
        if (ybsScreen !== "route_list") {
            throw new Error(
                `Expected route list screen while searching for "${routeCode}" but detected "${ybsScreen}".`,
            );
        }

        const visibleCards = parseRouteIndexRows(screen.xml);
        if (scrollIndex === 0) {
            assertTargetRouteNotAboveVisibleWindow(
                routeIndexItem,
                visibleCards,
                indexRoutes,
                minScore,
            );
        }

        const fingerprint = visibleCardsFingerprint(visibleCards);
        if (fingerprint && fingerprint === lastFingerprint) {
            staleScrolls++;
        } else {
            staleScrolls = 0;
            lastFingerprint = fingerprint;
        }

        const match = findBestRouteCardMatchAmongTargets(routeIndexItems, visibleCards, minScore);

        if (match && (!bestOverall || match.score > bestOverall.score)) {
            bestOverall = match;
            bestXmlPath = xmlPath;
        }

        if (match && isConfidentRouteCardMatch(match, minScore)) {
            bestOverall = match;
            bestXmlPath = xmlPath;
            break;
        }

        if (staleScrolls >= STALE_LIST_SCROLL_LIMIT) {
            break;
        }

        if (scrollIndex < maxScrolls - 1) {
            scrollDownRouteList(options.deviceId);
            await sleep(LIST_SCROLL_PAUSE_MS);
        }
    }

    if (!bestOverall?.row.card_bounds) {
        throw new Error(
            `Could not find route card for "${routeCode}" on the route list after ${scrollAttempts + 1} screen scans. ` +
                "Scroll down only was used. Manually position the list closer to the route without pull-refresh, then rerun.",
        );
    }

    if (bestOverall.score < minScore + 5) {
        warnings.push(
            `Low-confidence card match (score ${bestOverall.score}). Review open-route XML before batch extraction.`,
        );
    }

    const matchedRouteIndexItem = resolveMatchedRouteIndexItem(routeIndexItems, bestOverall);

    return {
        routeCode,
        routeIndexItem: matchedRouteIndexItem,
        match: bestOverall,
        scrollAttempts: scrollAttempts + 1,
        xmlPath: bestXmlPath,
        warnings,
    };
}

/** Scroll the route list and tap the best matching card for one index item. */
export async function openRouteFromIndex(options: OpenRouteOptions): Promise<OpenRouteResult> {
    const result = await findRouteCardOnList(options);

    const { centerX, centerY } = result.match.row.card_bounds!;
    tap(options.deviceId, centerX, centerY);
    await sleep(TAP_PAUSE_MS);

    const openedPath = openRouteProbePath(
        options.runRoot,
        options.language,
        result.routeCode,
        "opened-detail",
    );
    const opened = readScreen(options.deviceId, openedPath);

    if (!isRouteDetailScreen(opened.nodes)) {
        throw new Error(
            `Tapped route card for "${result.routeCode}" but route detail screen was not detected.`,
        );
    }

    return {
        ...result,
        warnings: result.warnings,
    };
}

function parseCliArgs(argv: string[]): OpenRouteOptions {
    const config = defaultConfig();
    const options: OpenRouteOptions = {
        deviceId: config.deviceId,
        runRoot: config.outputRoot,
        language: "my",
        routeCode: "",
        packageName: config.packageName,
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
        } else if (arg === "--route-code" && next) {
            options.routeCode = next;
            i++;
        } else if (arg === "--from-index" && next) {
            options.indexPath = next;
            i++;
        } else if (arg === "--max-list-scrolls" && next) {
            options.maxListScrolls = Number(next);
            i++;
        } else if (arg === "--strict-no-route-list-refresh" && next) {
            options.strictNoRouteListRefresh = parseStrictNoRouteListRefreshFlag(next);
            i++;
        }
    }

    if (!options.routeCode) {
        throw new Error("--route-code is required");
    }

    setStrictNoRouteListRefresh(options.strictNoRouteListRefresh ?? true);

    return options;
}

function isCliInvocation(): boolean {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("open-route.ts") || entry.endsWith("open-route.js");
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const result = await openRouteFromIndex(options);

    console.log(
        JSON.stringify(
            {
                route_code: result.routeCode,
                match_score: result.match.score,
                match_breakdown: result.match.breakdown,
                scroll_attempts: result.scrollAttempts,
                tapped_bounds: result.match.row.card_bounds,
                xml_path: result.xmlPath,
                warnings: result.warnings,
            },
            null,
            2,
        ),
    );
}

if (isCliInvocation()) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}

// Re-export for batch error matching
export { ROUTE_LIST_LOADING_STATE, ROUTE_LIST_LOADING_OR_REFRESHING };
