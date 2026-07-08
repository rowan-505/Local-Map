import {
    isDescriptiveRouteBadge,
    isNamedOfficialDisplayCode,
    isTruncatedBadge,
} from "./route-identity.js";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { DEFAULT_PACKAGE, type ExtractionLanguage, YBS_HEADER_TEXTS } from "./config.js";
import { ROUTE_LIST_LOADING_OR_REFRESHING } from "./ybs-navigation-safety.js";

export type ParsedBounds = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    centerX: number;
    centerY: number;
};

export type XmlTextNode = {
    text: string;
    resourceId: string;
    className: string;
    packageName: string;
    bounds: string;
    parsedBounds: ParsedBounds;
    selected: boolean;
    checked: boolean;
};

export type ParsedStopRow = {
    stop_name_my: string | null;
    stop_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    raw_text_my: string | null;
    raw_text_en: string | null;
    raw_text: string;
};

export type ParsedRouteMetadata = {
    route_code: string | null;
    route_number: number | null;
    route_name_my: string | null;
    operator_name: string | null;
    mode: "bus";
    route_kind: "local_bus";
    fare_text: string | null;
    fare_min: number | null;
    fare_max: number | null;
    currency_code: string | null;
    stop_count: number | null;
    stop_count_text: string | null;
};

export type CardBounds = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    centerX: number;
    centerY: number;
};

export type ParsedRouteIndexRow = {
    route_display_code: string | null;
    route_number: number | null;
    route_title_my: string | null;
    route_title_en: string | null;
    operator_name: string | null;
    fare_text: string | null;
    fare_min: number | null;
    fare_max: number | null;
    app_total_stop_count: number | null;
    extraction_status: "pending";
    raw_card_text: string[];
    card_bounds: CardBounds | null;
    badge_is_truncated: boolean;
};

export type VariantQualityStatus = "success" | "failed";

export type SkippedMetadataRow = {
    stop_name: string;
    area_text: string;
    reason: "blocked_stop_name" | "blocked_area" | "blocked_pair" | "invalid_area";
};

export type ParseStopPairsResult = {
    stops: ParsedStopRow[];
    warnings: string[];
    skipped_metadata_rows: SkippedMetadataRow[];
};

export type DetectLanguageResult = {
    language: "my" | "en" | "mixed";
    warnings: string[];
};

export type DetectDirectionResult = {
    direction: "outbound" | "inbound" | "all" | "unknown";
    warnings: string[];
};

export type ExtractDirectionKey = "outbound" | "inbound";

export type DirectionTabTarget = {
    direction: ExtractDirectionKey | "all";
    label: string;
    centerX: number;
    centerY: number;
    bounds: string;
};

type XmlRawNode = {
    text: string;
    bounds: string;
    parsedBounds: ParsedBounds;
    clickable: boolean;
    selected: boolean;
    focused: boolean;
};

/** Legacy shape used by older extract helpers. */
export type TextViewNode = {
    text: string;
    top: number;
    left: number;
};

const STOP_LIST_HEADINGS = new Set(["မှတ်တိုင်များ", "Stops"]);

const ROUTE_DETAIL_SCREEN_CHROME_HEADINGS = new Set([
    "ဘတ်စ်အသေးစိတ်",
    "Bus Detail",
    "Bus Details",
]);

const METADATA_LABELS = new Set([
    ...YBS_HEADER_TEXTS,
    "ဘတ်စ်အသေးစိတ်",
    "မျှဝေမည်",
    "မြေပုံပေါ်တွင် ကြည့်ရန်",
    "ကုမ္ပဏီ",
    "ယာဉ်စီးခ",
    "မှတ်တိုင်များ",
    "Bus Detail",
    "Bus Details",
    "Bus Stops",
    "Share",
    "View on Map",
    "Company",
    "Fare",
    "Stops",
    "Outbound",
    "Inbound",
    "All",
    "Buses",
]);

const ENGLISH_STOP_COUNT_LABEL = /^\d+\s+Stops?$/i;
const ENGLISH_FARE_LABEL = /^\d[\d,]*\s*Ks(?:\b|$)/i;
const ROUTE_DETAIL_OPERATOR_LABELS = new Set(["ကုမ္ပဏီ", "Company"]);

export const SCROLL_BOUNDARY_DUPLICATE_REMOVED = "SCROLL_BOUNDARY_DUPLICATE_REMOVED";
export const BLOCKED_STOP_METADATA_IN_STOPS = "BLOCKED_STOP_METADATA_IN_STOPS";

const DIRECTION_TAB_LABELS = new Set(["အသွား", "အပြန်", "အားလုံး", "Outbound", "Inbound", "All"]);

const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;
const LATIN_CHAR_PATTERN = /[A-Za-z]/;
const MAX_STOP_ROW_VERTICAL_DISTANCE_PX = 100;
const MAX_COLUMN_X_DIFF_PX = 80;

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function readAttr(tag: string, name: string): string {
    const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
    return match ? decodeXmlEntities(match[1]) : "";
}

function readBoolAttr(tag: string, name: string): boolean {
    const value = readAttr(tag, name).toLowerCase();
    return value === "true";
}

/** Convert Android bounds string to numbers and center point. */
export function parseBounds(bounds: string): ParsedBounds {
    const match = bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!match) {
        throw new Error(`Invalid bounds format: ${bounds}`);
    }

    const x1 = Number(match[1]);
    const y1 = Number(match[2]);
    const x2 = Number(match[3]);
    const y2 = Number(match[4]);

    return {
        x1,
        y1,
        x2,
        y2,
        centerX: Math.round((x1 + x2) / 2),
        centerY: Math.round((y1 + y2) / 2),
    };
}

/** Parse all XML nodes that have visible text. */
export function parseXmlTextNodes(xml: string): XmlTextNode[] {
    const nodes: XmlTextNode[] = [];
    const nodeRegex = /<node\b[^>]*>/g;
    let match: RegExpExecArray | null;

    while ((match = nodeRegex.exec(xml)) !== null) {
        const tag = match[0];
        const text = readAttr(tag, "text").trim();
        if (!text) {
            continue;
        }

        const bounds = readAttr(tag, "bounds");
        if (!bounds) {
            continue;
        }

        nodes.push({
            text,
            resourceId: readAttr(tag, "resource-id"),
            className: readAttr(tag, "class"),
            packageName: readAttr(tag, "package"),
            bounds,
            parsedBounds: parseBounds(bounds),
            selected: readBoolAttr(tag, "selected"),
            checked: readBoolAttr(tag, "checked"),
        });
    }

    return nodes.sort(
        (a, b) =>
            a.parsedBounds.centerY - b.parsedBounds.centerY ||
            a.parsedBounds.centerX - b.parsedBounds.centerX,
    );
}

function parseXmlRawNodes(xml: string): XmlRawNode[] {
    const nodes: XmlRawNode[] = [];
    const nodeRegex = /<node\b[^>]*>/g;
    let match: RegExpExecArray | null;

    while ((match = nodeRegex.exec(xml)) !== null) {
        const tag = match[0];
        const bounds = readAttr(tag, "bounds");
        if (!bounds) {
            continue;
        }

        nodes.push({
            text: readAttr(tag, "text").trim(),
            bounds,
            parsedBounds: parseBounds(bounds),
            clickable: readBoolAttr(tag, "clickable"),
            selected: readBoolAttr(tag, "selected"),
            focused: readBoolAttr(tag, "focused"),
        });
    }

    return nodes;
}

function containsPoint(bounds: ParsedBounds, x: number, y: number): boolean {
    return x >= bounds.x1 && x <= bounds.x2 && y >= bounds.y1 && y <= bounds.y2;
}

function boundsArea(bounds: ParsedBounds): number {
    return (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1);
}

function lineLanguage(text: string): "my" | "en" | "mixed" {
    const myanmar = (text.match(new RegExp(MYANMAR_CHAR_PATTERN.source, "g")) ?? []).length;
    const latin = (text.match(new RegExp(LATIN_CHAR_PATTERN.source, "g")) ?? []).length;
    if (myanmar > 0 && latin === 0) {
        return "my";
    }
    if (latin > 0 && myanmar === 0) {
        return "en";
    }
    return "mixed";
}

export function parseRouteNumberFromCode(routeCode: string | null | undefined): number | null {
    if (!routeCode) {
        return null;
    }
    const match = routeCode.match(/(?:YBS-)?(\d+)/i);
    return match ? Number(match[1]) : null;
}

export function parseStopCountText(text: string): number | null {
    const myanmarMatch = text.match(/(\d+)\s*မှတ်တိုင်/);
    if (myanmarMatch) {
        return Number(myanmarMatch[1]);
    }

    const englishMatch = text.trim().match(/^(\d+)\s+Stops?$/i);
    if (englishMatch) {
        return Number(englishMatch[1]);
    }

    return null;
}

function parseFareAmount(value: string): number | null {
    const amount = Number(value.replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : null;
}

export function parseFareText(text: string): {
    fare_min: number | null;
    fare_max: number | null;
    currency_code: string | null;
} {
    const trimmed = text.trim();
    const ksRangeMatch = trimmed.match(/^([\d,]+)\s*Ks\s*\/\s*([\d,]+)\s*Ks$/i);
    if (ksRangeMatch) {
        return {
            fare_min: parseFareAmount(ksRangeMatch[1]),
            fare_max: parseFareAmount(ksRangeMatch[2]),
            currency_code: "MMK",
        };
    }

    const kyatRangeMatch = trimmed.match(/^([\d,]+)\s*ကျပ်\s*\/\s*([\d,]+)\s*ကျပ်$/);
    if (kyatRangeMatch) {
        return {
            fare_min: parseFareAmount(kyatRangeMatch[1]),
            fare_max: parseFareAmount(kyatRangeMatch[2]),
            currency_code: "MMK",
        };
    }

    const singleKsMatch = trimmed.match(/^([\d,]+)\s*Ks$/i);
    if (singleKsMatch) {
        const fareMin = parseFareAmount(singleKsMatch[1]);
        return {
            fare_min: fareMin,
            fare_max: null,
            currency_code: fareMin === null ? null : "MMK",
        };
    }

    const singleKyatMatch = trimmed.match(/^([\d,]+)\s*ကျပ်$/);
    if (singleKyatMatch) {
        const fareMin = parseFareAmount(singleKyatMatch[1]);
        return {
            fare_min: fareMin,
            fare_max: null,
            currency_code: fareMin === null ? null : "MMK",
        };
    }

    return { fare_min: null, fare_max: null, currency_code: null };
}

function isFareText(text: string): boolean {
    const trimmed = text.trim();
    return (
        /\d+\s*Ks\s*\/\s*\d+\s*Ks/i.test(trimmed) ||
        /\d+\s*ကျပ်\s*\/\s*\d+\s*ကျပ်/.test(trimmed) ||
        ENGLISH_FARE_LABEL.test(trimmed)
    );
}

function isStopCountText(text: string): boolean {
    const trimmed = text.trim();
    return /\d+\s*မှတ်တိုင်/.test(trimmed) || ENGLISH_STOP_COUNT_LABEL.test(trimmed);
}

/** Block metadata/header/action rows from becoming stop names or areas. */
export function isBlockedStopMetadataText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }
    if (METADATA_LABELS.has(trimmed)) {
        return true;
    }
    if (DIRECTION_TAB_LABELS.has(trimmed)) {
        return true;
    }
    if (STOP_LIST_HEADINGS.has(trimmed)) {
        return true;
    }
    if (isStopCountText(trimmed)) {
        return true;
    }
    if (isFareText(trimmed)) {
        return true;
    }
    // Note: do not block "(number) name" as a route title here. Many YBS stop
    // names use that shape (for example "(၄၄) လမ်းဆုံ", "(၂) ဈေး"). The route
    // header title sits above the stop-list heading and is already excluded by
    // findStopListStartIndex, so blocking the pattern only drops real stops.
    if (trimmed === "YUPT") {
        return true;
    }
    if (isStandaloneRouteBadge(trimmed)) {
        return true;
    }
    return false;
}

function isRouteTitleText(text: string): boolean {
    const trimmed = text.trim();
    if (isStopCountText(trimmed) || isFareText(trimmed) || METADATA_LABELS.has(trimmed)) {
        return false;
    }

    const withNameAfterBadge = /^\([^)]+\)\s+.+/u.test(trimmed);
    const badgeAndNameInParens = /^\([^)]+\)$/u.test(trimmed);
    if (!withNameAfterBadge && !badgeAndNameInParens) {
        return false;
    }

    return MYANMAR_CHAR_PATTERN.test(trimmed);
}

function myanmarDigitsToNumber(text: string): number | null {
    const digitMap: Record<string, string> = {
        "၀": "0",
        "၁": "1",
        "၂": "2",
        "၃": "3",
        "၄": "4",
        "၅": "5",
        "၆": "6",
        "၇": "7",
        "၈": "8",
        "၉": "9",
    };

    if (!/^[၀-၉\d]+$/.test(text.trim())) {
        return null;
    }

    const normalized = text
        .trim()
        .split("")
        .map((char) => digitMap[char] ?? char)
        .join("");

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

function isLoadingPlaceholderPair(stopName: string, areaText: string): boolean {
    const trimmedName = stopName.trim();
    const trimmedArea = areaText.trim();
    const matchesLoadingName =
        /^မှတ်တိုင်\s+အမှတ်:\s*[၀-၉\d]+$/.test(trimmedName) ||
        /^Stop\s+(?:No|Number):\s*\d+$/i.test(trimmedName);
    const matchesLoadingArea =
        !trimmedArea || trimmedArea === "N/A" || trimmedArea === "N/A - N/A";
    return matchesLoadingName && matchesLoadingArea;
}

function isAreaRoadText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "N/A" || trimmed === "N/A - N/A") {
        return false;
    }

    return (
        text.includes(" - ") ||
        text.includes("—") ||
        (text.includes("လမ်း") && text.includes(" - ")) ||
        /\bRoad\b/i.test(text) ||
        /\bStreet\b/i.test(text)
    );
}

function isMetadataLabel(text: string): boolean {
    return isBlockedStopMetadataText(text);
}

function isDirectionTab(text: string): boolean {
    return DIRECTION_TAB_LABELS.has(text.trim());
}

function isStandaloneRouteBadge(text: string): boolean {
    return /^[၀-၉\d]{1,3}$/.test(text.trim());
}

function sameColumn(a: XmlTextNode, b: XmlTextNode): boolean {
    return Math.abs(a.parsedBounds.x1 - b.parsedBounds.x1) <= MAX_COLUMN_X_DIFF_PX;
}

function verticalDistance(a: XmlTextNode, b: XmlTextNode): number {
    return Math.abs(a.parsedBounds.centerY - b.parsedBounds.centerY);
}

export function stopRowDisplayName(row: ParsedStopRow): string {
    return row.stop_name_my ?? row.stop_name_en ?? "";
}

export function stopRowDisplayArea(row: ParsedStopRow): string {
    return row.area_text_my ?? row.area_text_en ?? "";
}

function buildStopRow(
    stopName: string,
    areaText: string,
    language: ExtractionLanguage = "my",
): ParsedStopRow {
    const raw_text = `${stopName}\n${areaText}`;

    if (language === "en") {
        return {
            stop_name_my: null,
            stop_name_en: stopName,
            area_text_my: null,
            area_text_en: areaText,
            raw_text_my: null,
            raw_text_en: raw_text,
            raw_text,
        };
    }

    return {
        stop_name_my: stopName,
        stop_name_en: null,
        area_text_my: areaText,
        area_text_en: null,
        raw_text_my: raw_text,
        raw_text_en: null,
        raw_text,
    };
}

function isRouteDetailBadgeText(text: string): boolean {
    const trimmed = text.trim();
    if (isStandaloneRouteBadge(trimmed)) {
        return true;
    }
    return /^\d+\s*\([^)]+\)$/i.test(trimmed);
}

/** True when detail-screen operator text is likely a route badge, not a company name. */
export function isLikelyRouteBadgeNotOperator(text: string | null | undefined): boolean {
    if (!text) {
        return true;
    }
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }
    return isRouteDetailBadgeText(trimmed) || /^[၀-၉\d]+$/.test(trimmed);
}

function isInvalidRouteDetailOperatorCandidate(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || METADATA_LABELS.has(trimmed) || STOP_LIST_HEADINGS.has(trimmed)) {
        return true;
    }
    if (isDirectionTab(trimmed)) {
        return true;
    }
    if (isFareText(trimmed) || isStopCountText(trimmed) || isRouteTitleText(trimmed)) {
        return true;
    }
    if (isLikelyRouteBadgeNotOperator(trimmed)) {
        return true;
    }
    return false;
}

function extractRouteDetailOperatorName(nodes: XmlTextNode[]): string | null {
    const texts = nodes.map((node) => node.text.trim());

    for (let index = 0; index < texts.length - 1; index++) {
        if (!ROUTE_DETAIL_OPERATOR_LABELS.has(texts[index])) {
            continue;
        }
        const candidate = texts[index + 1];
        if (candidate && !isInvalidRouteDetailOperatorCandidate(candidate)) {
            return candidate;
        }
    }

    for (const text of texts) {
        if (isInvalidRouteDetailOperatorCandidate(text)) {
            continue;
        }
        if (looksLikeRouteIndexOperator(text)) {
            return text.trim();
        }
    }

    return null;
}

/** Parse route header metadata separately from the stop list. */
export function parseRouteMetadata(
    nodes: XmlTextNode[],
    routeCode: string | null = null,
): ParsedRouteMetadata {
    const texts = nodes.map((node) => node.text);

    const route_name_my = texts.find((text) => isRouteTitleText(text)) ?? null;
    const stopCountText = texts.find((text) => isStopCountText(text)) ?? null;
    const fare_text = texts.find((text) => isFareText(text)) ?? null;
    const operator_name = extractRouteDetailOperatorName(nodes);
    const badgeNumber = texts.find((text) => isStandaloneRouteBadge(text));
    const route_number =
        parseRouteNumberFromCode(routeCode) ??
        (badgeNumber ? myanmarDigitsToNumber(badgeNumber) : null);

    const fare = fare_text ? parseFareText(fare_text) : { fare_min: null, fare_max: null, currency_code: null };

    return {
        route_code: routeCode,
        route_number,
        route_name_my,
        operator_name,
        mode: "bus",
        route_kind: "local_bus",
        fare_text,
        fare_min: fare.fare_min,
        fare_max: fare.fare_max,
        currency_code: fare.currency_code,
        stop_count: stopCountText ? parseStopCountText(stopCountText) : null,
        stop_count_text: stopCountText,
    };
}

function findStopListStartIndex(nodes: XmlTextNode[]): number {
    const headingIndex = nodes.findIndex((node) => STOP_LIST_HEADINGS.has(node.text.trim()));
    if (headingIndex < 0) {
        return 0;
    }

    let startIndex = headingIndex + 1;
    while (startIndex < nodes.length && isDirectionTab(nodes[startIndex].text)) {
        startIndex++;
    }

    return startIndex;
}

function isRealStopName(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    return !isBlockedStopMetadataText(trimmed);
}

/**
 * Some YBS stops are named with digits only (for example "၁၀၆"). Digits alone
 * look like a route badge, so they are only accepted when paired with a real
 * road-area line.
 */
function isNumberedStopNameWithArea(nameText: string, areaText: string): boolean {
    return (
        isStandaloneRouteBadge(nameText.trim()) &&
        !isBlockedStopMetadataText(areaText) &&
        isAreaRoadText(areaText)
    );
}

function isValidStopPair(nameText: string, areaText: string): boolean {
    if (isNumberedStopNameWithArea(nameText, areaText)) {
        return true;
    }
    if (!isRealStopName(nameText)) {
        return false;
    }
    if (isBlockedStopMetadataText(areaText)) {
        return false;
    }
    return isAreaRoadText(areaText);
}

function classifyInvalidStopPairReason(
    stopName: string,
    areaText: string,
): SkippedMetadataRow["reason"] | null {
    const blockedName = isBlockedStopMetadataText(stopName);
    const blockedArea = isBlockedStopMetadataText(areaText);

    if (blockedName && blockedArea) {
        return "blocked_pair";
    }
    if (blockedName) {
        return "blocked_stop_name";
    }
    if (blockedArea) {
        return "blocked_area";
    }
    if (!isAreaRoadText(areaText)) {
        return "invalid_area";
    }
    return null;
}

/** Pair stop rows from YBS route detail list area only. */
export function parseStopPairs(
    nodes: XmlTextNode[],
    language: ExtractionLanguage = "my",
): ParseStopPairsResult {
    const warnings: string[] = [];
    const skipped_metadata_rows: SkippedMetadataRow[] = [];
    const startIndex = findStopListStartIndex(nodes);
    const scoped = nodes.slice(startIndex);
    const candidates = scoped.filter((node, nodeIndex) => {
        const text = node.text.trim();
        if (isDirectionTab(text) || STOP_LIST_HEADINGS.has(text)) {
            return false;
        }
        if (text === "YUPT") {
            return false;
        }
        if (isStandaloneRouteBadge(text)) {
            // Digit-only stop names exist (for example "၁၀၆"). Keep the node only
            // when it sits directly above a road-area line in the same column,
            // otherwise treat it as a route badge.
            const next = scoped[nodeIndex + 1];
            return Boolean(
                next &&
                    isAreaRoadText(next.text) &&
                    sameColumn(node, next) &&
                    verticalDistance(node, next) <= MAX_STOP_ROW_VERTICAL_DISTANCE_PX,
            );
        }
        return true;
    });

    const stops: ParsedStopRow[] = [];
    let index = 0;

    while (index < candidates.length) {
        const current = candidates[index];
        const next = candidates[index + 1];

        if (!next) {
            if (current.text.trim()) {
                warnings.push(`Unpaired text at end of list: ${current.text}`);
            }
            break;
        }

        if (!sameColumn(current, next) || verticalDistance(current, next) > MAX_STOP_ROW_VERTICAL_DISTANCE_PX) {
            warnings.push(`Skipped lonely text (no nearby pair): ${current.text}`);
            index++;
            continue;
        }

        let stopName = current.text;
        let areaText = next.text;

        if (isAreaRoadText(current.text) && !isAreaRoadText(next.text)) {
            if (!isRealStopName(next.text)) {
                skipped_metadata_rows.push({
                    stop_name: next.text,
                    area_text: current.text,
                    reason: classifyInvalidStopPairReason(next.text, current.text) ?? "blocked_pair",
                });
                index += 2;
                continue;
            }
            stopName = next.text;
            areaText = current.text;
        }

        if (isAreaRoadText(stopName) && !isAreaRoadText(areaText)) {
            warnings.push(`Skipped area-first pair without road text: ${stopName} / ${areaText}`);
            index += 2;
            continue;
        }

        if (isLoadingPlaceholderPair(stopName, areaText)) {
            index += 2;
            continue;
        }

        if (!isValidStopPair(stopName, areaText)) {
            const skipReason = classifyInvalidStopPairReason(stopName, areaText);
            if (skipReason) {
                skipped_metadata_rows.push({
                    stop_name: stopName,
                    area_text: areaText,
                    reason: skipReason,
                });
            } else {
                warnings.push(`Skipped invalid stop pair: ${stopName} / ${areaText}`);
            }
            index += 2;
            continue;
        }

        const row = buildStopRow(stopName, areaText, language);
        stops.push(row);
        index += 2;
    }

    if (stops.length === 0) {
        warnings.push("No stop pairs found in XML.");
    }

    return { stops, warnings, skipped_metadata_rows };
}

/** Remove empty texts and common headers/buttons. */
export function filterUsefulTexts(nodes: XmlTextNode[]): XmlTextNode[] {
    return nodes.filter((node) => !isMetadataLabel(node.text));
}

export function stopRowKey(row: ParsedStopRow): string {
    return `${stopRowDisplayName(row)}|||${stopRowDisplayArea(row)}`;
}

function countScriptChars(text: string): { myanmar: number; latin: number } {
    const myanmar = (text.match(new RegExp(MYANMAR_CHAR_PATTERN.source, "g")) ?? []).length;
    const latin = (text.match(new RegExp(LATIN_CHAR_PATTERN.source, "g")) ?? []).length;
    return { myanmar, latin };
}

/** Return dominant language for the screen. */
export function detectLanguage(nodes: XmlTextNode[]): DetectLanguageResult {
    const useful = filterUsefulTexts(nodes);
    const warnings: string[] = [];

    let myanmar = 0;
    let latin = 0;

    for (const node of useful) {
        const counts = countScriptChars(node.text);
        myanmar += counts.myanmar;
        latin += counts.latin;
    }

    if (myanmar === 0 && latin === 0) {
        return {
            language: "mixed",
            warnings: ["Could not detect language from visible text."],
        };
    }

    if (myanmar >= latin * 1.5) {
        return { language: "my", warnings };
    }

    if (latin >= myanmar * 1.5) {
        return { language: "en", warnings };
    }

    warnings.push("Screen text looks mixed between Myanmar and English.");
    return { language: "mixed", warnings };
}

const DIRECTION_LABELS = {
    outbound: new Set(["အသွား", "Outbound"]),
    inbound: new Set(["အပြန်", "Inbound"]),
    all: new Set(["အားလုံး", "All"]),
} as const;

function directionLabelsFor(
    direction: ExtractDirectionKey | "all",
): Set<string> {
    return DIRECTION_LABELS[direction];
}

/** Return true when outbound/inbound/all direction tabs are visible. */
export function hasDirectionTabs(nodes: XmlTextNode[]): boolean {
    return (
        findDirectionTabTarget(nodes, "outbound") !== null ||
        findDirectionTabTarget(nodes, "inbound") !== null ||
        findDirectionTabTarget(nodes, "all") !== null
    );
}

const DIRECTION_TAB_MAX_CENTER_Y_FRACTION = 0.55;
const ROUTE_HEADER_MAX_CENTER_Y_FRACTION = 0.5;

/** Return true when direction tabs are in the upper viewport (not off-screen in XML only). */
export function hasDirectionTabsVisible(nodes: XmlTextNode[], screenHeight: number): boolean {
    const maxCenterY = Math.round(screenHeight * DIRECTION_TAB_MAX_CENTER_Y_FRACTION);
    const outbound = findDirectionTabTarget(nodes, "outbound");
    const inbound = findDirectionTabTarget(nodes, "inbound");

    const outboundVisible = outbound !== null && outbound.centerY <= maxCenterY;
    const inboundVisible = inbound !== null && inbound.centerY <= maxCenterY;

    return outboundVisible || inboundVisible;
}

/** Return true when route detail header text is in the upper viewport. */
export function hasRouteDetailHeaderVisible(nodes: XmlTextNode[], screenHeight: number): boolean {
    const maxCenterY = Math.round(screenHeight * ROUTE_HEADER_MAX_CENTER_Y_FRACTION);

    return nodes.some((node) => {
        const text = node.text.trim();
        if (!text) {
            return false;
        }

        const isHeader =
            isRouteTitleText(text) ||
            isStopCountText(text) ||
            isMetadataLabel(text) ||
            ROUTE_DETAIL_SCREEN_CHROME_HEADINGS.has(text);

        return isHeader && node.parsedBounds.centerY <= maxCenterY;
    });
}

/** Route detail top is visible when header and direction tabs are on screen. */
export function isRouteDetailTopVisible(nodes: XmlTextNode[], screenHeight: number): boolean {
    return hasDirectionTabsVisible(nodes, screenHeight) && hasRouteDetailHeaderVisible(nodes, screenHeight);
}

/** Return true when the screen looks like the YBS route list. */
export function isRouteListScreen(nodes: XmlTextNode[]): boolean {
    const header = nodes.some((node) => {
        const text = node.text.trim();
        return text === "ဘတ်စ်များ" || text === "Buses";
    });
    if (header) {
        return true;
    }

    const titleCount = nodes.filter(
        (node) => node.parsedBounds.x1 >= 200 && /^\([၀-၉\d]/.test(node.text.trim()),
    ).length;

    return titleCount >= 3;
}

/** Return true when the screen looks like a route detail stop list. */
export function isRouteDetailScreen(nodes: XmlTextNode[]): boolean {
    return hasDirectionTabs(nodes) || hasRouteDetailScreenChrome(nodes);
}

const STOP_DETAIL_TITLE_MAX_CENTER_Y_FRACTION = 0.5;
const STOP_DETAIL_HEADER_MAX_CENTER_Y_FRACTION = 0.14;
const STOP_DETAIL_BACK_MAX_CENTER_X_FRACTION = 0.22;

const STOP_DETAIL_BUS_LINES_HEADINGS = new Set([
    "ဘတ်စ်လိုင်းများ",
    "Bus Lines",
    "Bus lines",
]);

function hasStopDetailBusLinesSection(nodes: XmlTextNode[]): boolean {
    return nodes.some((node) => STOP_DETAIL_BUS_LINES_HEADINGS.has(node.text.trim()));
}

function hasMainRouteListHeader(nodes: XmlTextNode[]): boolean {
    return nodes.some((node) => {
        const text = node.text.trim();
        return text === "ဘတ်စ်များ" || text === "Buses";
    });
}

/** Route detail chrome survives when direction tabs scroll off-screen. */
function hasRouteDetailScreenChrome(nodes: XmlTextNode[]): boolean {
    return nodes.some((node) => ROUTE_DETAIL_SCREEN_CHROME_HEADINGS.has(node.text.trim()));
}

export type StopDetailBackTapTarget = {
    centerX: number;
    centerY: number;
};

/** Find the top-left back control on a YBS stop detail screen. */
export function findStopDetailBackTapTarget(
    xml: string,
    screenHeight: number,
    screenWidth = 1080,
): StopDetailBackTapTarget | null {
    const maxCenterY = Math.round(screenHeight * STOP_DETAIL_HEADER_MAX_CENTER_Y_FRACTION);
    const maxCenterX = Math.round(screenWidth * STOP_DETAIL_BACK_MAX_CENTER_X_FRACTION);
    const candidates = parseXmlRawNodes(xml).filter(
        (node) =>
            node.clickable &&
            node.parsedBounds.centerY <= maxCenterY &&
            node.parsedBounds.centerX <= maxCenterX,
    );

    if (candidates.length === 0) {
        return null;
    }

    const tapNode = candidates.sort(
        (left, right) => left.parsedBounds.centerX - right.parsedBounds.centerX,
    )[0];

    return {
        centerX: tapNode.parsedBounds.centerX,
        centerY: tapNode.parsedBounds.centerY,
    };
}

function isStopDetailTitleCandidate(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    if (isMetadataLabel(trimmed) || isDirectionTab(trimmed)) {
        return false;
    }
    if (isRouteTitleText(trimmed) || isStopCountText(trimmed) || isFareText(trimmed)) {
        return false;
    }
    if (trimmed === "YUPT" || isStandaloneRouteBadge(trimmed)) {
        return false;
    }
    if (STOP_LIST_HEADINGS.has(trimmed)) {
        return false;
    }
    return true;
}

/** Pick the most common non-system Android package from a UI XML dump. */
export function detectUiForegroundPackage(nodes: XmlTextNode[]): string | null {
    const counts = new Map<string, number>();
    for (const node of nodes) {
        const pkg = node.packageName.trim();
        if (!pkg || pkg === "android" || pkg.startsWith("android.")) {
            continue;
        }
        counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
    }

    let best: string | null = null;
    let bestCount = 0;
    for (const [pkg, count] of counts) {
        if (count > bestCount) {
            best = pkg;
            bestCount = count;
        }
    }

    return best;
}

/** Return true when the screen looks like a YBS stop detail page. */
export function isStopDetailScreen(
    nodes: XmlTextNode[],
    screenHeight: number,
    packageName: string = DEFAULT_PACKAGE,
): boolean {
    if (detectUiForegroundPackage(nodes) !== packageName) {
        return false;
    }

    if (hasDirectionTabs(nodes)) {
        return false;
    }

    if (hasRouteDetailScreenChrome(nodes)) {
        return false;
    }

    if (nodes.some((node) => STOP_LIST_HEADINGS.has(node.text.trim()))) {
        return false;
    }

    const titleNode = findStopDetailTitleNode(nodes, screenHeight);
    if (!titleNode) {
        return false;
    }

    if (hasMainRouteListHeader(nodes)) {
        return false;
    }

    // Stop detail lists bus lines at this stop; that can look like the route list.
    if (hasStopDetailBusLinesSection(nodes)) {
        return true;
    }

    if (isRouteListScreen(nodes)) {
        return false;
    }

    return true;
}

function findStopDetailTitleNode(nodes: XmlTextNode[], screenHeight: number): XmlTextNode | null {
    const maxCenterY = Math.round(screenHeight * STOP_DETAIL_TITLE_MAX_CENTER_Y_FRACTION);
    const candidates = nodes.filter(
        (node) =>
            node.parsedBounds.centerY <= maxCenterY && isStopDetailTitleCandidate(node.text),
    );

    if (candidates.length === 0) {
        return null;
    }

    return candidates.sort((left, right) => left.parsedBounds.centerY - right.parsedBounds.centerY)[0];
}

export function isRouteListScreenXml(xml: string): boolean {
    return isRouteListScreen(parseXmlTextNodes(xml));
}

export function isRouteDetailScreenXml(xml: string): boolean {
    return isRouteDetailScreen(parseXmlTextNodes(xml));
}

/** Error code used when the YBS route list is stuck in a loading state. */
export const ROUTE_LIST_LOADING_STATE = "ROUTE_LIST_LOADING_STATE";

/** Error code when ADB shows the phone left the YBS app (home screen / launcher). */
export const YBS_APP_NOT_IN_FOREGROUND = "YBS_APP_NOT_IN_FOREGROUND";

export type YbsScreen = "route_list" | "route_detail" | "stop_detail" | "loading" | "unknown";

export type RouteListLoadingOrRefreshingState = {
    loading: boolean;
    refreshing: boolean;
    reason: "progress_bar_visible" | "route_list_empty" | "refresh_indicator" | null;
};

/** Classify the current YBS screen from one UI XML dump. */
export function detectYbsScreen(xml: string, screenHeight = 2340): YbsScreen {
    const refreshState = detectRouteListLoadingOrRefreshing(xml);
    if (refreshState.loading || refreshState.refreshing) {
        return "loading";
    }

    const nodes = parseXmlTextNodes(xml);
    if (isRouteDetailScreen(nodes)) {
        return "route_detail";
    }
    if (isStopDetailScreen(nodes, screenHeight)) {
        return "stop_detail";
    }
    if (isRouteListScreen(nodes)) {
        return "route_list";
    }

    return "unknown";
}

/**
 * Detect route list loading or refresh-in-progress state.
 * Stop extraction immediately when true.
 */
export function detectRouteListLoadingOrRefreshing(xml: string): RouteListLoadingOrRefreshingState {
    const base = detectRouteListLoadingState(xml);
    if (base.loading) {
        return {
            loading: true,
            refreshing: true,
            reason: base.reason,
        };
    }

    if (!xml.trim()) {
        return { loading: false, refreshing: false, reason: null };
    }

    const nodes = parseXmlTextNodes(xml);
    if (!isRouteListScreen(nodes)) {
        return { loading: false, refreshing: false, reason: null };
    }

    const hasRefreshIndicator = nodes.some((node) => {
        const text = node.text.trim().toLowerCase();
        return (
            text.includes("refresh") ||
            text.includes("loading") ||
            text.includes("ခေတ္တ") ||
            text.includes("စောင့်ပါ")
        );
    });

    if (hasRefreshIndicator && xml.includes("android.widget.ProgressBar")) {
        return { loading: true, refreshing: true, reason: "refresh_indicator" };
    }

    return { loading: false, refreshing: false, reason: null };
}

/** Throw when route list is loading or refreshing. */
export function assertRouteListNotLoadingOrRefreshing(xml: string): void {
    const state = detectRouteListLoadingOrRefreshing(xml);
    if (state.loading || state.refreshing) {
        const detail = state.reason ?? "unknown";
        throw new Error(
            `${ROUTE_LIST_LOADING_OR_REFRESHING}: YBS route list is loading or refreshing (${detail}). ` +
                "Do not refresh the list. Manually reopen the route list without pull-refresh, then re-run.",
        );
    }
}

export type RouteListLoadingState = {
    loading: boolean;
    reason: "progress_bar_visible" | "route_list_empty" | null;
};

/**
 * Detect the YBS route list loading/stuck state.
 *
 * The YBS app has a bug: refreshing the route list can cause infinite loading.
 * Automation must stop when this state is detected. Only the user can restore
 * the list manually on the phone.
 */
export function detectRouteListLoadingState(xml: string): RouteListLoadingState {
    if (!xml.trim()) {
        return { loading: false, reason: null };
    }

    const nodes = parseXmlTextNodes(xml);

    // A route detail screen with a spinner is not a route list problem.
    if (isRouteDetailScreen(nodes)) {
        return { loading: false, reason: null };
    }

    const hasListHeader = nodes.some((node) => {
        const text = node.text.trim();
        return text === "ဘတ်စ်များ" || text === "Buses";
    });

    if (hasListHeader && xml.includes("android.widget.ProgressBar")) {
        return { loading: true, reason: "progress_bar_visible" };
    }

    if (hasListHeader && parseRouteIndexRows(xml).length === 0) {
        return { loading: true, reason: "route_list_empty" };
    }

    return { loading: false, reason: null };
}

/** Find one direction tab text node on screen. */
export function findDirectionTabTarget(
    nodes: XmlTextNode[],
    direction: ExtractDirectionKey | "all",
): DirectionTabTarget | null {
    const labels = directionLabelsFor(direction);
    const tabNode = nodes.find((node) => labels.has(node.text.trim()));
    if (!tabNode) {
        return null;
    }

    return {
        direction,
        label: tabNode.text.trim(),
        centerX: tabNode.parsedBounds.centerX,
        centerY: tabNode.parsedBounds.centerY,
        bounds: tabNode.bounds,
    };
}

/**
 * Resolve tap coordinates for a direction tab.
 * Prefers the smallest clickable XML node that contains the tab label.
 */
export function resolveDirectionTabTapTarget(
    xml: string,
    direction: ExtractDirectionKey,
): DirectionTabTarget | null {
    const textTarget = findDirectionTabTarget(parseXmlTextNodes(xml), direction);
    if (!textTarget) {
        return null;
    }

    const rawNodes = parseXmlRawNodes(xml);
    const clickables = rawNodes.filter(
        (node) =>
            node.clickable &&
            containsPoint(
                node.parsedBounds,
                textTarget.centerX,
                textTarget.centerY,
            ),
    );
    const tapNode = clickables.sort(
        (left, right) => boundsArea(left.parsedBounds) - boundsArea(right.parsedBounds),
    )[0];

    const tapBounds = tapNode?.parsedBounds ?? {
        centerX: textTarget.centerX,
        centerY: textTarget.centerY,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
    };

    return {
        direction,
        label: textTarget.label,
        centerX: tapBounds.centerX,
        centerY: tapBounds.centerY,
        bounds: tapNode?.bounds ?? textTarget.bounds,
    };
}

function findActiveDirectionFromClickableTabs(xml: string): ExtractDirectionKey | "all" | null {
    for (const direction of ["outbound", "inbound", "all"] as const) {
        const textTarget = findDirectionTabTarget(parseXmlTextNodes(xml), direction);
        if (!textTarget) {
            continue;
        }

        const rawNodes = parseXmlRawNodes(xml);
        const clickables = rawNodes.filter(
            (node) =>
                node.clickable &&
                containsPoint(
                    node.parsedBounds,
                    textTarget.centerX,
                    textTarget.centerY,
                ),
        );
        const tapNode = clickables.sort(
            (left, right) => boundsArea(left.parsedBounds) - boundsArea(right.parsedBounds),
        )[0];

        if (tapNode?.selected || tapNode?.focused) {
            return direction;
        }

        const textNode = parseXmlTextNodes(xml).find((node) => node.text.trim() === textTarget.label);
        if (textNode?.selected || textNode?.checked) {
            return direction;
        }
    }

    return null;
}

/** Warn when metadata/header rows appear inside parsed stops. */
export function validateParsedStops(stops: ParsedStopRow[]): string[] {
    const warnings: string[] = [];

    if (stops.length === 0) {
        return warnings;
    }

    const firstName = stopRowDisplayName(stops[0]).trim();
    if (
        firstName &&
        isBlockedStopMetadataText(firstName) &&
        !isNumberedStopNameWithArea(firstName, stopRowDisplayArea(stops[0]))
    ) {
        warnings.push(
            `${BLOCKED_STOP_METADATA_IN_STOPS}: first stop looks like metadata/header, not a real stop: ${firstName}`,
        );
    }

    for (const stop of stops) {
        const areaText = stopRowDisplayArea(stop);
        const fields = [stop.stop_name_my, stop.stop_name_en, stop.area_text_my, stop.area_text_en];
        for (const field of fields) {
            if (!field) {
                continue;
            }
            const trimmed = field.trim();
            if (isBlockedStopMetadataText(trimmed) && !isNumberedStopNameWithArea(trimmed, areaText)) {
                warnings.push(`${BLOCKED_STOP_METADATA_IN_STOPS}: metadata text in stop list: ${trimmed}`);
            }
        }
    }

    return warnings;
}

/** Best effort direction tab detection from visible nodes. */
export function detectCurrentDirection(nodes: XmlTextNode[], xml = ""): DetectDirectionResult {
    const warnings: string[] = [];

    if (xml) {
        const active = findActiveDirectionFromClickableTabs(xml);
        if (active) {
            return { direction: active, warnings };
        }
    }

    for (const [direction, labels] of Object.entries(DIRECTION_LABELS) as Array<
        [keyof typeof DIRECTION_LABELS, Set<string>]
    >) {
        const match = nodes.find((node) => labels.has(node.text.trim()));
        if (match && (match.selected || match.checked)) {
            return { direction, warnings };
        }
    }

    for (const [direction, labels] of Object.entries(DIRECTION_LABELS) as Array<
        [keyof typeof DIRECTION_LABELS, Set<string>]
    >) {
        if (nodes.some((node) => labels.has(node.text.trim()))) {
            warnings.push(`Direction tab "${direction}" is visible but selected state is unclear.`);
            return { direction: "unknown", warnings };
        }
    }

    warnings.push("Could not detect outbound/inbound/all tab.");
    return { direction: "unknown", warnings };
}

/** Legacy helper: TextView list for route header parsing. */
export function extractTextViews(xml: string): TextViewNode[] {
    return parseXmlTextNodes(xml).map((node) => ({
        text: node.text,
        top: node.parsedBounds.y1,
        left: node.parsedBounds.x1,
    }));
}

/** Legacy helper: pair stop rows from simplified text nodes. */
export function pairStopRows(textViews: TextViewNode[]): ParsedStopRow[] {
    const nodes: XmlTextNode[] = textViews.map((view) => ({
        text: view.text,
        resourceId: "",
        className: "android.widget.TextView",
        packageName: "",
        bounds: `[${view.left},${view.top}][${view.left + 1},${view.top + 1}]`,
        parsedBounds: parseBounds(`[${view.left},${view.top}][${view.left + 1},${view.top + 1}]`),
        selected: false,
        checked: false,
    }));

    return parseStopPairs(nodes).stops;
}

/** Legacy helper for extract-current-route.ts. */
export function detectDirection(xml: string): "outbound" | "inbound" {
    const result = detectCurrentDirection(parseXmlTextNodes(xml));
    if (result.direction === "inbound") {
        return "inbound";
    }
    return "outbound";
}

/** Legacy route header hints. Prefer parseRouteMetadata(). */
export function extractRouteHeaderHints(textViews: TextViewNode[]): {
    route_name_my: string | null;
    route_number: string | null;
    operator_name: string | null;
    fare_text: string | null;
} {
    const metadata = parseRouteMetadata(
        textViews.map((view) => ({
            text: view.text,
            resourceId: "",
            className: "android.widget.TextView",
            packageName: "",
            bounds: `[${view.left},${view.top}][${view.left + 1},${view.top + 1}]`,
            parsedBounds: parseBounds(`[${view.left},${view.top}][${view.left + 1},${view.top + 1}]`),
            selected: false,
            checked: false,
        })),
    );

    return {
        route_name_my: metadata.route_name_my,
        route_number: metadata.route_number === null ? null : String(metadata.route_number),
        operator_name: metadata.operator_name,
        fare_text: metadata.fare_text,
    };
}

/**
 * Parse route rows from a route list / index screen.
 */
export function parseRouteIndexRows(xml: string): ParsedRouteIndexRow[] {
    const nodes = parseXmlTextNodes(xml);
    const titleNodes = nodes.filter(
        (node) => isRouteListTitle(node.text) && node.parsedBounds.x1 >= 200,
    );

    const rows: ParsedRouteIndexRow[] = [];
    const usedBadgeNodes = new Set<XmlTextNode>();

    for (const titleNode of titleNodes) {
        const badgeNode = findRouteIndexBadgeForTitle(nodes, titleNode, usedBadgeNodes);
        if (badgeNode) {
            usedBadgeNodes.add(badgeNode);
        }
        rows.push(buildRouteIndexRow(nodes, titleNode, badgeNode));
    }

    const badgeNodes = nodes.filter(
        (node) =>
            !usedBadgeNodes.has(node) &&
            node.parsedBounds.x1 >= 80 &&
            node.parsedBounds.x1 < 250 &&
            isRouteListBadge(node.text),
    );

    for (const badgeNode of badgeNodes) {
        const row = buildRouteIndexRow(nodes, undefined, badgeNode);
        if (!row.route_title_my && !row.route_title_en) {
            const named = isNamedOfficialDisplayCode(row.route_display_code);
            const truncated = row.badge_is_truncated || isTruncatedBadge(row.route_display_code);
            const descriptive = isDescriptiveRouteBadge(row.route_display_code);
            if (!named && !truncated && !descriptive) {
                continue;
            }
        }
        rows.push(row);
    }

    rows.sort(
        (left, right) =>
            (left.card_bounds?.centerY ?? 0) - (right.card_bounds?.centerY ?? 0),
    );

    const seen = new Set<string>();
    return rows.filter((row) => {
        const key = routeIndexRowKey(row);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function buildRouteIndexRow(
    nodes: XmlTextNode[],
    titleNode: XmlTextNode | undefined,
    badgeNode: XmlTextNode | undefined,
): ParsedRouteIndexRow {
    const title = titleNode?.text.trim() ?? null;
    const anchorNode = titleNode ?? badgeNode!;
    const cardNodes = nodes.filter((node) => {
        if (isRouteIndexNoise(node.text)) {
            return false;
        }

        const verticalDistance = node.parsedBounds.y1 - anchorNode.parsedBounds.y1;
        return verticalDistance >= -15 && verticalDistance <= 140;
    });

    const badgeText = badgeNode?.text.trim() ?? null;
    const operatorNode = cardNodes
        .filter((node) => {
            const text = node.text.trim();
            if (text === title || node === badgeNode || node === titleNode) {
                return false;
            }
            if (node.parsedBounds.x1 < 250) {
                return false;
            }
            return looksLikeRouteIndexOperator(text);
        })
        .sort((left, right) => left.parsedBounds.y1 - right.parsedBounds.y1)[0];

    const fareNode = cardNodes.find((node) => isFareText(node.text));
    const stopCountNode = cardNodes.find((node) => isStopCountText(node.text));
    const operatorText = operatorNode?.text.trim() ?? null;
    const fareText = fareNode?.text.trim() ?? null;
    const fare = fareText ? parseFareText(fareText) : { fare_min: null, fare_max: null, currency_code: null };
    const nameLanguage = title ? lineLanguage(title) : "my";
    const badgeIsTruncated = isTruncatedBadgeText(badgeText);
    const routeDisplayCode = formatRouteDisplayCode(badgeText);
    const routeNumber =
        parsePureNumericBadge(badgeText) ??
        parseLeadingNumericBadge(badgeText) ??
        (title ? parseRouteNumberFromTitle(title) : null);

    const rawCardText = [badgeText, title, operatorText, fareText, stopCountNode?.text.trim()]
        .filter((value): value is string => Boolean(value));

    return {
        route_display_code: routeDisplayCode,
        route_number: routeNumber,
        route_title_my: title && nameLanguage === "en" ? null : title,
        route_title_en: title && nameLanguage === "en" ? title : null,
        operator_name: operatorText,
        fare_text: fareText,
        fare_min: fare.fare_min,
        fare_max: fare.fare_max,
        app_total_stop_count: stopCountNode ? parseStopCountText(stopCountNode.text) : null,
        extraction_status: "pending",
        raw_card_text: rawCardText,
        card_bounds: buildRouteCardBounds(
            titleNode ?? badgeNode!,
            badgeNode,
            operatorNode,
        ),
        badge_is_truncated: badgeIsTruncated,
    };
}

function findRouteIndexBadgeForTitle(
    nodes: XmlTextNode[],
    titleNode: XmlTextNode,
    usedBadgeNodes: Set<XmlTextNode>,
): XmlTextNode | undefined {
    return nodes
        .filter((node) => {
            if (usedBadgeNodes.has(node)) {
                return false;
            }
            if (node.parsedBounds.x1 >= 250 || node.parsedBounds.x1 < 80) {
                return false;
            }
            if (!isRouteListBadge(node.text)) {
                return false;
            }

            const verticalDistance = node.parsedBounds.y1 - titleNode.parsedBounds.y1;
            return verticalDistance >= -50 && verticalDistance <= 60;
        })
        .sort(
            (left, right) =>
                Math.abs(left.parsedBounds.y1 - titleNode.parsedBounds.y1) -
                Math.abs(right.parsedBounds.y1 - titleNode.parsedBounds.y1),
        )[0];
}

function isRouteListBadge(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 40) {
        return false;
    }
    if (isRouteIndexNoise(trimmed)) {
        return false;
    }
    if (isTruncatedBadgeText(trimmed)) {
        return true;
    }
    if (/^[၀-၉\d]+$/.test(trimmed)) {
        return true;
    }
    if (/^[၀-၉\d]+\s*[\(\[]/.test(trimmed)) {
        return true;
    }
    if (/^\d+\s*[\(\[]/.test(trimmed)) {
        return true;
    }
    if (/^[A-Za-z][A-Za-z0-9-]{1,15}$/.test(trimmed) && !/^[၀-၉\d]/.test(trimmed)) {
        return true;
    }
    if (isDescriptiveRouteBadge(trimmed)) {
        return true;
    }
    return false;
}

const ROUTE_INDEX_IGNORE = new Set([
    "ဘတ်စ်များ",
    "ဘတ်စ်လိုင်းနံပါတ်များကို ရှာပါ...",
    "စူးစမ်းရန်",
    "လမ်းကြောင်းရှာ",
    "ဆက်တင်",
    "Buses",
    "Search bus line numbers...",
    "Explore",
    "Find route",
    "Settings",
]);

function isRouteIndexNoise(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }
    if (ROUTE_INDEX_IGNORE.has(trimmed)) {
        return true;
    }
    if (/^[\uE000-\uF8FF]/.test(trimmed)) {
        return true;
    }
    if (trimmed.length <= 2 && !/[\u1000-\u109F\d]/.test(trimmed)) {
        return true;
    }
    return false;
}

function isRouteListTitle(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 8) {
        return false;
    }
    if (/^\([၀-၉\d]/.test(trimmed)) {
        return true;
    }
    if (/^\(\d+/.test(trimmed)) {
        return true;
    }
    if (/^\([A-Za-z][^)]*\)/.test(trimmed) && trimmed.length >= 12) {
        return true;
    }
    if (/^\(စမ်းသပ်\)/.test(trimmed) && trimmed.length >= 12) {
        return true;
    }
    return false;
}

function isTruncatedBadgeText(badgeText: string | null): boolean {
    if (!badgeText) {
        return false;
    }

    const trimmed = badgeText.trim();
    return trimmed.endsWith("...") || trimmed.endsWith("…");
}

function formatRouteDisplayCode(badgeText: string | null): string | null {
    if (!badgeText) {
        return null;
    }

    const pure = parsePureNumericBadge(badgeText);
    if (pure !== null) {
        return String(pure);
    }

    return badgeText.trim();
}

function buildRouteCardBounds(
    titleNode: XmlTextNode,
    badgeNode: XmlTextNode | undefined,
    operatorNode: XmlTextNode | undefined,
): CardBounds | null {
    const parts = [titleNode, badgeNode, operatorNode].filter(
        (node): node is XmlTextNode => node !== undefined,
    );

    if (parts.length === 0) {
        return null;
    }

    const x1 = Math.min(...parts.map((node) => node.parsedBounds.x1));
    const y1 = Math.min(...parts.map((node) => node.parsedBounds.y1));
    const x2 = Math.max(...parts.map((node) => node.parsedBounds.x2));
    const y2 = Math.max(...parts.map((node) => node.parsedBounds.y2));

    return {
        x1,
        y1,
        x2,
        y2,
        centerX: Math.round((x1 + x2) / 2),
        centerY: Math.round((y1 + y2) / 2),
    };
}

function parsePureNumericBadge(badgeText: string | null): number | null {
    if (!badgeText) {
        return null;
    }

    const trimmed = badgeText.trim();
    if (!/^[၀-၉\d]+$/.test(trimmed)) {
        return null;
    }

    return myanmarDigitsToNumber(trimmed) ?? Number(trimmed);
}

function parseLeadingNumericBadge(badgeText: string | null): number | null {
    if (!badgeText) {
        return null;
    }

    const match = badgeText.trim().match(/^([၀-၉\d]+)/);
    if (!match) {
        return null;
    }

    return myanmarDigitsToNumber(match[1]) ?? Number(match[1]);
}

function looksLikeRouteIndexOperator(text: string): boolean {
    const trimmed = text.trim();
    if (isRouteListTitle(trimmed) || isRouteIndexNoise(trimmed)) {
        return false;
    }
    if (isFareText(trimmed) || isStopCountText(trimmed)) {
        return false;
    }
    return trimmed.length >= 2 && trimmed.length <= 40;
}

function parseRouteNumberFromBadge(badgeText: string | null): number | null {
    if (!badgeText) {
        return null;
    }

    const match = badgeText.trim().match(/^([၀-၉\d]+)/);
    if (!match) {
        return null;
    }

    return myanmarDigitsToNumber(match[1]) ?? Number(match[1]);
}

function parseRouteNumberFromTitle(title: string): number | null {
    const match = title.trim().match(/^\(([၀-၉\d]+)/);
    if (!match) {
        return null;
    }

    return myanmarDigitsToNumber(match[1]) ?? Number(match[1]);
}

export function routeIndexRowKey(row: ParsedRouteIndexRow): string {
    return [
        row.raw_card_text.join("|"),
        row.route_display_code ?? "",
        row.route_title_my ?? row.route_title_en ?? "",
        row.operator_name ?? "",
    ].join("|||");
}

export function routeIndexOverlapKey(row: ParsedRouteIndexRow): string {
    return [
        row.route_number ?? "null",
        row.route_display_code ?? "",
        (row.route_title_my ?? row.route_title_en ?? "").slice(0, 48),
    ].join("|||");
}

/** Collapse scroll duplicates while keeping separate routes with different titles. */
export function routeIndexDedupeKey(row: ParsedRouteIndexRow): string {
    const title = (row.route_title_my ?? row.route_title_en ?? "").trim();
    if (title) {
        return [row.route_number ?? "null", title].join("|||");
    }

    return routeIndexRowKey(row);
}

/** Merge route index rows from multiple scroll dumps. */
export function mergeRouteIndexRows(dumpRows: ParsedRouteIndexRow[][]): ParsedRouteIndexRow[] {
    if (dumpRows.length === 0) {
        return [];
    }

    const merged: ParsedRouteIndexRow[] = [...dumpRows[0]];

    for (let dumpIndex = 1; dumpIndex < dumpRows.length; dumpIndex++) {
        const nextRows = dumpRows[dumpIndex];
        const overlap = findRouteIndexOverlap(merged, nextRows);
        merged.push(...nextRows.slice(overlap));
    }

    return merged;
}

function findRouteIndexOverlap(
    prev: ParsedRouteIndexRow[],
    next: ParsedRouteIndexRow[],
): number {
    const exact = findRouteIndexOverlapByKey(prev, next, routeIndexRowKey);
    if (exact > 0) {
        return exact;
    }

    return findRouteIndexOverlapByKey(prev, next, routeIndexOverlapKey);
}

function findRouteIndexOverlapByKey(
    prev: ParsedRouteIndexRow[],
    next: ParsedRouteIndexRow[],
    keyFn: (row: ParsedRouteIndexRow) => string,
): number {
    const maxOverlap = Math.min(prev.length, next.length);

    for (let overlap = maxOverlap; overlap >= 1; overlap--) {
        let matches = true;

        for (let index = 0; index < overlap; index++) {
            if (keyFn(prev[prev.length - overlap + index]) !== keyFn(next[index])) {
                matches = false;
                break;
            }
        }

        if (matches) {
            return overlap;
        }
    }

    return 0;
}

/** Find exact suffix/prefix overlap between scroll dumps (same name + area rows only). */
export function findScrollBoundaryOverlap(prev: ParsedStopRow[], next: ParsedStopRow[]): number {
    const maxOverlap = Math.min(prev.length, next.length);

    for (let overlap = maxOverlap; overlap >= 1; overlap--) {
        let matches = true;

        for (let index = 0; index < overlap; index++) {
            if (stopRowKey(prev[prev.length - overlap + index]) !== stopRowKey(next[index])) {
                matches = false;
                break;
            }
        }

        if (matches) {
            return overlap;
        }
    }

    return 0;
}

/**
 * True when consecutive stop-list dumps look like a scroll gap (no overlap and no shared
 * stop rows between the previous and next windows).
 */
export function detectStopListScrollGap(prev: ParsedStopRow[], next: ParsedStopRow[]): boolean {
    if (prev.length === 0 || next.length === 0) {
        return false;
    }

    if (findScrollBoundaryOverlap(prev, next) > 0) {
        return false;
    }

    const prevKeys = new Set(prev.map((row) => stopRowKey(row)));
    for (const row of next) {
        if (prevKeys.has(stopRowKey(row))) {
            return false;
        }
    }

    return true;
}

/** Merge stop rows from multiple XML dumps. */
export function mergeStopRowsFromDumps(dumpRows: ParsedStopRow[][]): {
    stops: ParsedStopRow[];
    warnings: string[];
} {
    const warnings: string[] = [];

    if (dumpRows.length === 0) {
        return { stops: [], warnings };
    }

    const merged: ParsedStopRow[] = [...dumpRows[0]];

    for (let dumpIndex = 1; dumpIndex < dumpRows.length; dumpIndex++) {
        const nextRows = dumpRows[dumpIndex];
        if (nextRows.length === 0) {
            continue;
        }

        const overlap = findScrollBoundaryOverlap(merged, nextRows);
        const newRows = nextRows.slice(overlap);

        if (overlap > 0) {
            warnings.push(
                `${SCROLL_BOUNDARY_DUPLICATE_REMOVED}: removed ${overlap} duplicate row(s) at scroll boundary between dump ${dumpIndex} and ${dumpIndex + 1}.`,
            );
        } else if (merged.length > 0) {
            const prevLast = merged[merged.length - 1];
            const nextFirst = nextRows[0];

            if (
                stopRowDisplayName(prevLast) === stopRowDisplayName(nextFirst) &&
                stopRowKey(prevLast) !== stopRowKey(nextFirst)
            ) {
                warnings.push(
                    `Same stop name at boundary with different area: ${stopRowDisplayName(prevLast)} (kept both).`,
                );
            }
        }

        merged.push(...newRows);
    }

    return { stops: merged, warnings };
}

function isCliInvocation(): boolean {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("parse-ui-xml.ts") || entry.endsWith("parse-ui-xml.js");
}

function runCli(): void {
    const xmlArg = process.argv[2];
    if (!xmlArg) {
        console.error("Usage: pnpm tsx tools/data-pipeline/transport-json-import/ybs-extraction/parse-ui-xml.ts <xml-file>");
        process.exit(1);
    }

    const xmlPath = path.resolve(xmlArg);
    const xml = fs.readFileSync(xmlPath, "utf8");
    const nodes = parseXmlTextNodes(xml);
    const metadata = parseRouteMetadata(nodes);
    const language = detectLanguage(nodes);
    const direction = detectCurrentDirection(nodes);
    const parsed = parseStopPairs(nodes);

    const output = {
        file: xmlPath,
        metadata,
        language: language.language,
        direction: direction.direction,
        stop_count: parsed.stops.length,
        stops: parsed.stops,
        warnings: [...language.warnings, ...direction.warnings, ...parsed.warnings],
    };

    console.log(JSON.stringify(output, null, 2));
}

if (isCliInvocation()) {
    runCli();
}
