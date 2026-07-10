/**
 * Parse Myanmar train app route detail + expanded schedule from ADB XML.
 *
 * File-only. No database access.
 */

import {
    parseCombinedTrainTitle,
    parseTrainNumberToken,
    trimToNull,
} from "../lib/text-normalize.js";
import {
    parseBounds,
    parseXmlTextNodes,
    type ParsedBounds,
} from "../../transport-json-import/ybs-extraction/parse-ui-xml.js";

export type TrainDetailTextNode = ReturnType<typeof parseXmlTextNodes>[number];

export type ParsedTrainEndpoint = {
    name: string | null;
    time_text: string | null;
};

export type ParsedTrainStationRow = {
    sequence: number;
    name: string;
    time_text: string | null;
    raw_row_text: string[];
    row_bounds: ParsedBounds | null;
};

export type ParsedTrainDetailMetadata = {
    train_number: string | null;
    direction_text: string | null;
    route_title: string | null;
    route_subtitle: string | null;
    operation_text: string | null;
    origin: ParsedTrainEndpoint;
    destination: ParsedTrainEndpoint;
    type: string | null;
    direction: string | null;
    way: string | null;
    train_model: string | null;
    total_stations_text: string | null;
    traveling_time_text: string | null;
};

export type ParsedTrainDetailDump = {
    metadata: ParsedTrainDetailMetadata;
    stations: ParsedTrainStationRow[];
    schedule_complete_marker_seen: boolean;
    collapse_schedule_y: number | null;
    warnings: string[];
};

const CLOCK_TIME_RE = /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;
const DURATION_RE = /\d+\s*(?:hr|hour|နာရီ).*(?:min|မိနစ်)|\d+\s*(?:min|မိနစ်)/i;
const DIRECTION_RE = /^(up|down|အဆန်|အစုန်)$/i;
const PRICE_RE = /\d[\d,]*\s*(?:ks|kyat|ကျပ်)\b/i;
const TOTAL_STATIONS_RE = /^(?:total\s*)?stations?\b|ဘူတာရုံ.*အရေအတွက်|ဖြတ်သန်းဘူတာများ/i;
const TRAVEL_TIME_LABEL_RE = /travel(?:ing)?\s*time|duration|ခရီးကြာချိန်|ကြာချိန်/i;

const VIEW_FULL_SCHEDULE_RE =
    /view\s*full\s*schedule|full\s*schedule|အချိန်ဇယား\s*အပြည့်အစုံ|အပြည့်အစုံ.*ကြည့်မည်/i;
const COLLAPSE_SCHEDULE_RE =
    /collapse\s*schedule|အချိန်ဇယား\s*အကျဉ်းချုပ်|အကျဉ်းချုပ်.*ကြည့်မည်|ဇယား.*(?:ပိတ်ရန်|ပိတ်မည်)/i;

const DETAIL_NOISE = new Set([
    "Favorite",
    "Share",
    "မျှဝေမည်",
    "ရှာဖွေရန်",
    "Settings",
    "ဆက်တင်",
    "Search",
    "Explore",
    "Find route",
    "Image",
    "Video",
    "ဓာတ်ပုံ",
    "ဗီဒီယို",
    "Schedule (List)",
    "Schedule (Map)",
    "အချိန်ဇယား (စာရင်း)",
    "အချိန်ဇယား (မြေပုံ)",
]);

const METADATA_LABELS: Record<string, keyof ParsedTrainDetailMetadata> = {
    type: "type",
    "train type": "type",
    "အမျိုးအစား": "type",
    direction: "direction",
    "လမ်းကြောင်း": "direction",
    way: "way",
    ခရီး: "way",
    "train model": "train_model",
    model: "train_model",
    "ရထားမော်ဒယ်": "train_model",
    operation: "operation_text",
    "operation day": "operation_text",
    "operation days": "operation_text",
    "total stations": "total_stations_text",
    stations: "total_stations_text",
    "ဖြတ်သန်းဘူတာများ": "total_stations_text",
    "traveling time": "traveling_time_text",
    "travel time": "traveling_time_text",
    duration: "traveling_time_text",
    ကြာချိန်: "traveling_time_text",
};

function isDetailNoise(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }
    if (DETAIL_NOISE.has(trimmed)) {
        return true;
    }
    if (/^schedule\s*\(/i.test(trimmed) || /^အချိန်ဇယား\s*\(/u.test(trimmed)) {
        return true;
    }
    if (PRICE_RE.test(trimmed)) {
        return true;
    }
    if (VIEW_FULL_SCHEDULE_RE.test(trimmed) || COLLAPSE_SCHEDULE_RE.test(trimmed)) {
        return true;
    }
    return false;
}

function parseClockTime(text: string): string | null {
    const match = text.trim().match(CLOCK_TIME_RE);
    return match ? match[0].replace(/\s+/g, " ").toUpperCase() : null;
}

function parseTrainNumber(text: string): string | null {
    return parseTrainNumberToken(text);
}

function isDirectionText(text: string): boolean {
    return DIRECTION_RE.test(text.trim());
}

function normalizeLabel(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMetadataLabel(text: string): boolean {
    const label = normalizeLabel(text);
    return label in METADATA_LABELS || TOTAL_STATIONS_RE.test(label) || TRAVEL_TIME_LABEL_RE.test(label);
}

function metadataFieldForLabel(text: string): keyof ParsedTrainDetailMetadata | null {
    const label = normalizeLabel(text);
    if (label in METADATA_LABELS) {
        return METADATA_LABELS[label] ?? null;
    }
    if (TOTAL_STATIONS_RE.test(label)) {
        return "total_stations_text";
    }
    if (TRAVEL_TIME_LABEL_RE.test(label)) {
        return "traveling_time_text";
    }
    return null;
}

function sameRow(left: TrainDetailTextNode, right: TrainDetailTextNode, tolerance = 30): boolean {
    return Math.abs(left.parsedBounds.centerY - right.parsedBounds.centerY) <= tolerance;
}

function findValueNodeBelowLabel(
    nodes: TrainDetailTextNode[],
    labelNode: TrainDetailTextNode,
): TrainDetailTextNode | null {
    const anchorX = labelNode.parsedBounds.centerX;
    const candidates = nodes
        .filter((node) => {
            if (node === labelNode || isDetailNoise(node.text)) {
                return false;
            }
            if (node.parsedBounds.y1 <= labelNode.parsedBounds.y2) {
                return false;
            }
            if (node.parsedBounds.y1 > labelNode.parsedBounds.y2 + 90) {
                return false;
            }
            return Math.abs(node.parsedBounds.centerX - anchorX) <= 120;
        })
        .sort(
            (left, right) =>
                left.parsedBounds.y1 - right.parsedBounds.y1 ||
                Math.abs(left.parsedBounds.centerX - anchorX) -
                    Math.abs(right.parsedBounds.centerX - anchorX),
        );

    return candidates[0] ?? null;
}

function findValueNodeForLabel(
    nodes: TrainDetailTextNode[],
    labelNode: TrainDetailTextNode,
): TrainDetailTextNode | null {
    const below = findValueNodeBelowLabel(nodes, labelNode);
    if (below) {
        return below;
    }

    const candidates = nodes
        .filter((node) => {
            if (node === labelNode || isDetailNoise(node.text)) {
                return false;
            }
            if (node.parsedBounds.x1 <= labelNode.parsedBounds.x2 + 20) {
                return false;
            }
            return sameRow(node, labelNode);
        })
        .sort((left, right) => left.parsedBounds.x1 - right.parsedBounds.x1);

    return candidates[0] ?? null;
}

function isEndpointLabel(text: string): boolean {
    const trimmed = text.trim();
    return (
        /^(origin|destination)$/i.test(trimmed) ||
        trimmed === "စမှတ်" ||
        trimmed === "ဆုံးမှတ်"
    );
}

function parseSummaryCardEndpoints(nodes: TrainDetailTextNode[]): {
    origin: ParsedTrainEndpoint;
    destination: ParsedTrainEndpoint;
} {
    const zoneNodes = nodes.filter((node) => {
        const text = node.text.trim();
        if (!text || isDetailNoise(text) || isMetadataLabel(text)) {
            return false;
        }
        const { y1 } = node.parsedBounds;
        return y1 >= 360 && y1 <= 680;
    });

    function endpointFromColumn(columnNodes: TrainDetailTextNode[]): ParsedTrainEndpoint {
        const nameNode =
            columnNodes
                .filter((node) => looksLikeStationName(node.text))
                .sort((left, right) => left.parsedBounds.y1 - right.parsedBounds.y1)[0] ?? null;
        const timeNode =
            columnNodes
                .filter((node) => parseClockTime(node.text))
                .sort((left, right) => left.parsedBounds.y1 - right.parsedBounds.y1)[0] ?? null;

        return {
            name: trimToNull(nameNode?.text ?? null),
            time_text: timeNode ? parseClockTime(timeNode.text) : null,
        };
    }

    const midpoint = 500;
    const leftNodes = zoneNodes.filter((node) => node.parsedBounds.centerX < midpoint);
    const rightNodes = zoneNodes.filter((node) => node.parsedBounds.centerX >= midpoint);

    return {
        origin: endpointFromColumn(leftNodes),
        destination: endpointFromColumn(rightNodes),
    };
}

function findLabeledEndpoint(
    nodes: TrainDetailTextNode[],
    labelPattern: RegExp,
): ParsedTrainEndpoint {
    const labelNode = nodes.find((node) => labelPattern.test(node.text.trim()));
    if (!labelNode) {
        return { name: null, time_text: null };
    }

    const rowNodes = nodes.filter(
        (node) =>
            !isDetailNoise(node.text) &&
            node.parsedBounds.y1 >= labelNode.parsedBounds.y1 &&
            node.parsedBounds.y1 <= labelNode.parsedBounds.y2 + 80,
    );

    const anchorX = labelNode.parsedBounds.x1;
    const nameNode =
        rowNodes
            .filter((node) => {
                const text = node.text.trim();
                if (!text || labelPattern.test(text) || isEndpointLabel(text) || parseClockTime(text)) {
                    return false;
                }
                return Math.abs(node.parsedBounds.x1 - anchorX) <= 180;
            })
            .sort(
                (left, right) =>
                    left.parsedBounds.y1 - right.parsedBounds.y1 ||
                    Math.abs(left.parsedBounds.x1 - anchorX) - Math.abs(right.parsedBounds.x1 - anchorX),
            )[0] ?? null;

    const timeNode =
        rowNodes
            .filter((node) => {
                if (labelPattern.test(node.text.trim()) || isEndpointLabel(node.text)) {
                    return false;
                }
                if (nameNode && node === nameNode) {
                    return false;
                }
                return node.parsedBounds.x1 > (nameNode?.parsedBounds.x2 ?? labelNode.parsedBounds.x2);
            })
            .map((node) => ({ node, clock: parseClockTime(node.text) }))
            .filter((entry): entry is { node: TrainDetailTextNode; clock: string } =>
                Boolean(entry.clock),
            )
            .sort((left, right) => left.node.parsedBounds.x1 - right.node.parsedBounds.x1)[0]
            ?.node ?? null;

    return {
        name: trimToNull(nameNode?.text ?? null),
        time_text: timeNode ? parseClockTime(timeNode.text) : null,
    };
}

function emptyMetadata(): ParsedTrainDetailMetadata {
    return {
        train_number: null,
        direction_text: null,
        route_title: null,
        route_subtitle: null,
        operation_text: null,
        origin: { name: null, time_text: null },
        destination: { name: null, time_text: null },
        type: null,
        direction: null,
        way: null,
        train_model: null,
        total_stations_text: null,
        traveling_time_text: null,
    };
}

function parseHeaderMetadata(nodes: TrainDetailTextNode[]): Partial<ParsedTrainDetailMetadata> {
    const headerNodes = nodes.filter(
        (node) => !isDetailNoise(node.text) && node.parsedBounds.y1 < 420,
    );

    let train_number: string | null = null;
    let direction_text: string | null = null;
    const titleCandidates: string[] = [];
    const subtitleCandidates: string[] = [];

    for (const node of headerNodes) {
        const text = node.text.trim();
        if (!text) {
            continue;
        }

        const combined = parseCombinedTrainTitle(text);
        if (combined) {
            if (!train_number && combined.train_number) {
                train_number = combined.train_number;
            }
            if (!direction_text && combined.direction_text) {
                direction_text = combined.direction_text;
            }
            continue;
        }

        const number = parseTrainNumber(text);
        if (number && node.parsedBounds.x1 < 220 && !train_number) {
            train_number = number;
            continue;
        }

        if (isDirectionText(text) && !direction_text) {
            direction_text = text;
            continue;
        }

        if (parseClockTime(text) || isMetadataLabel(text)) {
            continue;
        }

        if (text.length >= 8) {
            titleCandidates.push(text);
        } else if (text.length >= 3) {
            subtitleCandidates.push(text);
        }
    }

    return {
        train_number,
        direction_text,
        direction: direction_text,
        route_title: titleCandidates.sort((a, b) => b.length - a.length)[0] ?? null,
        route_subtitle: subtitleCandidates.sort((a, b) => b.length - a.length)[0] ?? null,
    };
}

function parseLabeledMetadata(nodes: TrainDetailTextNode[], maxY: number): Partial<ParsedTrainDetailMetadata> {
    const metadata: Partial<ParsedTrainDetailMetadata> = {};
    const scopedNodes = nodes.filter(
        (node) => !isDetailNoise(node.text) && node.parsedBounds.y1 <= maxY,
    );

    for (const node of scopedNodes) {
        const field = metadataFieldForLabel(node.text);
        if (!field || field === "origin" || field === "destination") {
            continue;
        }

        const valueNode = findValueNodeForLabel(scopedNodes, node);
        const value = trimToNull(valueNode?.text ?? null);
        if (!value) {
            continue;
        }

        if (field === "type" && !metadata.type) {
            metadata.type = value;
        } else if (field === "direction" && !metadata.direction) {
            metadata.direction = value;
            if (!metadata.direction_text) {
                metadata.direction_text = value;
            }
        } else if (field === "way" && !metadata.way) {
            metadata.way = value;
        } else if (field === "train_model" && !metadata.train_model) {
            metadata.train_model = value;
        } else if (field === "operation_text" && !metadata.operation_text) {
            metadata.operation_text = value;
        } else if (field === "total_stations_text" && !metadata.total_stations_text) {
            metadata.total_stations_text = value;
        } else if (field === "traveling_time_text" && !metadata.traveling_time_text) {
            metadata.traveling_time_text = value;
        }
    }

    metadata.origin = findLabeledEndpoint(scopedNodes, /^origin$/i);
    if (!metadata.origin.name) {
        metadata.origin = findLabeledEndpoint(scopedNodes, /^စမှတ်$/u);
    }

    metadata.destination = findLabeledEndpoint(scopedNodes, /^destination$/i);
    if (!metadata.destination.name) {
        metadata.destination = findLabeledEndpoint(scopedNodes, /^ဆုံးမှတ်$/u);
    }

    if (!metadata.origin.name || !metadata.destination.name) {
        const summary = parseSummaryCardEndpoints(scopedNodes);
        if (!metadata.origin.name && summary.origin.name) {
            metadata.origin = summary.origin;
        }
        if (!metadata.destination.name && summary.destination.name) {
            metadata.destination = summary.destination;
        }
    }

    return metadata;
}

export function findCollapseScheduleNode(nodes: TrainDetailTextNode[]): TrainDetailTextNode | null {
    return (
        nodes.find((node) => COLLAPSE_SCHEDULE_RE.test(node.text.trim())) ??
        null
    );
}

export function hasCollapseScheduleMarker(nodes: TrainDetailTextNode[]): boolean {
    return findCollapseScheduleNode(nodes) !== null;
}

export function findViewFullScheduleNode(nodes: TrainDetailTextNode[]): TrainDetailTextNode | null {
    return (
        nodes.find((node) => VIEW_FULL_SCHEDULE_RE.test(node.text.trim())) ??
        null
    );
}

export function tapCenter(bounds: ParsedBounds): { x: number; y: number } {
    return {
        x: Math.round(bounds.centerX),
        y: Math.round(bounds.centerY),
    };
}

function scheduleZoneNodes(
    nodes: TrainDetailTextNode[],
    collapseY: number | null,
): TrainDetailTextNode[] {
    const minY = 730;
    const maxY = collapseY ?? Number.POSITIVE_INFINITY;

    return nodes.filter((node) => {
        const text = node.text.trim();
        if (!text || isDetailNoise(text)) {
            return false;
        }
        if (isMetadataLabel(text)) {
            return false;
        }
        if (VIEW_FULL_SCHEDULE_RE.test(text) || COLLAPSE_SCHEDULE_RE.test(text)) {
            return false;
        }
        const { y1, y2 } = node.parsedBounds;
        return y1 >= minY && y2 <= maxY;
    });
}

function clusterRows(nodes: TrainDetailTextNode[]): TrainDetailTextNode[][] {
    const sorted = [...nodes].sort(
        (left, right) =>
            left.parsedBounds.centerY - right.parsedBounds.centerY ||
            left.parsedBounds.centerX - right.parsedBounds.centerX,
    );

    const rows: TrainDetailTextNode[][] = [];
    for (const node of sorted) {
        const row = rows.find((existing) =>
            existing.some((member) => sameRow(member, node, 35)),
        );
        if (row) {
            row.push(node);
        } else {
            rows.push([node]);
        }
    }

    return rows;
}

function looksLikeStationName(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 80) {
        return false;
    }
    if (isEndpointLabel(trimmed) || parseClockTime(trimmed) || isMetadataLabel(trimmed) || isDirectionText(trimmed)) {
        return false;
    }
    if (DURATION_RE.test(trimmed)) {
        return false;
    }
    if (/^\d+$/.test(trimmed)) {
        return false;
    }
    if (/station$/i.test(trimmed) || /ဘူတာ/u.test(trimmed)) {
        return true;
    }
    if (/^[A-Za-z][A-Za-z\s.'-]{1,60}$/.test(trimmed)) {
        return true;
    }
    if (/^[\u1000-\u109F0-9\s.'-]{2,60}$/u.test(trimmed)) {
        return true;
    }
    return false;
}

function buildStationRow(rowNodes: TrainDetailTextNode[]): ParsedTrainStationRow | null {
    const texts = rowNodes.map((node) => node.text.trim()).filter(Boolean);
    if (texts.length === 0) {
        return null;
    }

    const timeTexts = texts
        .map((text) => parseClockTime(text))
        .filter((value): value is string => Boolean(value));

    const nameNode =
        rowNodes
            .filter((node) => looksLikeStationName(node.text))
            .sort((left, right) => left.parsedBounds.x1 - right.parsedBounds.x1)[0] ?? null;

    if (!nameNode) {
        return null;
    }

    const x1 = Math.min(...rowNodes.map((node) => node.parsedBounds.x1));
    const y1 = Math.min(...rowNodes.map((node) => node.parsedBounds.y1));
    const x2 = Math.max(...rowNodes.map((node) => node.parsedBounds.x2));
    const y2 = Math.max(...rowNodes.map((node) => node.parsedBounds.y2));

    return {
        sequence: 0,
        name: nameNode.text.trim(),
        time_text: timeTexts.length > 0 ? timeTexts.join(" / ") : null,
        raw_row_text: texts,
        row_bounds: parseBounds(`[${x1},${y1}][${x2},${y2}]`),
    };
}

export function parseTrainStationRows(
    nodes: TrainDetailTextNode[],
    options?: { collapseY?: number | null },
): ParsedTrainStationRow[] {
    const collapseY = options?.collapseY ?? findCollapseScheduleNode(nodes)?.parsedBounds.y1 ?? null;
    const zoneNodes = scheduleZoneNodes(nodes, collapseY);
    const rows = clusterRows(zoneNodes)
        .map((rowNodes) => buildStationRow(rowNodes))
        .filter((row): row is ParsedTrainStationRow => row !== null);

    return rows.map((row, index) => ({
        ...row,
        sequence: index + 1,
    }));
}

export function parseTrainDetailMetadata(
    nodes: TrainDetailTextNode[],
    options?: { maxY?: number | null },
): ParsedTrainDetailMetadata {
    const maxY = options?.maxY ?? findCollapseScheduleNode(nodes)?.parsedBounds.y1 ?? 1200;
    const metadata = emptyMetadata();

    Object.assign(metadata, parseHeaderMetadata(nodes));
    Object.assign(metadata, parseLabeledMetadata(nodes, maxY));

    if (!metadata.direction) {
        metadata.direction = metadata.direction_text;
    }

    return metadata;
}

/** Parse one route-detail XML dump. */
export function parseTrainDetailDump(xml: string): ParsedTrainDetailDump {
    const nodes = parseXmlTextNodes(xml);
    const collapseNode = findCollapseScheduleNode(nodes);
    const collapseY = collapseNode?.parsedBounds.y1 ?? null;
    const warnings: string[] = [];

    const metadata = parseTrainDetailMetadata(nodes, { maxY: collapseY ?? undefined });
    const stations = parseTrainStationRows(nodes, { collapseY });

    if (!metadata.train_number) {
        warnings.push("MISSING_TRAIN_NUMBER");
    }

    return {
        metadata,
        stations,
        schedule_complete_marker_seen: collapseNode !== null,
        collapse_schedule_y: collapseY,
        warnings,
    };
}

function stationRowKey(row: ParsedTrainStationRow): string {
    return row.name.trim().toLowerCase();
}

function pickRicherStationRow(
    left: ParsedTrainStationRow,
    right: ParsedTrainStationRow,
): ParsedTrainStationRow {
    const leftScore = Number(Boolean(left.time_text)) + left.raw_row_text.length;
    const rightScore = Number(Boolean(right.time_text)) + right.raw_row_text.length;
    return rightScore > leftScore ? right : left;
}

/** Merge station rows from multiple scroll dumps in screen order. */
export function mergeTrainStationRows(dumps: ParsedTrainStationRow[][]): ParsedTrainStationRow[] {
    const merged: ParsedTrainStationRow[] = [];
    const indexByKey = new Map<string, number>();

    for (const dump of dumps) {
        for (const row of dump) {
            const key = stationRowKey(row);
            const existingIndex = indexByKey.get(key);
            if (existingIndex === undefined) {
                indexByKey.set(key, merged.length);
                merged.push({ ...row });
                continue;
            }

            merged[existingIndex] = pickRicherStationRow(merged[existingIndex]!, row);
        }
    }

    return merged.map((row, index) => ({
        ...row,
        sequence: index + 1,
    }));
}

export function mergeTrainDetailDumps(dumps: ParsedTrainDetailDump[]): ParsedTrainDetailDump {
    const metadata = dumps.map((dump) => dump.metadata).find(Boolean) ?? emptyMetadata();
    const richerMetadata = dumps
        .map((dump) => dump.metadata)
        .reduce((best, current) => {
            const bestScore = Object.values(best).filter(Boolean).length;
            const currentScore = Object.values(current).filter(Boolean).length;
            return currentScore > bestScore ? current : best;
        }, metadata);

    const stations = mergeTrainStationRows(dumps.map((dump) => dump.stations));
    const schedule_complete_marker_seen = dumps.some(
        (dump) => dump.schedule_complete_marker_seen,
    );
    const warnings = [...new Set(dumps.flatMap((dump) => dump.warnings))];

    if (schedule_complete_marker_seen && stations.length === 0) {
        warnings.push("COLLAPSE_SEEN_BUT_NO_STATIONS");
    }

    return {
        metadata: richerMetadata,
        stations,
        schedule_complete_marker_seen,
        collapse_schedule_y:
            dumps.find((dump) => dump.collapse_schedule_y !== null)?.collapse_schedule_y ?? null,
        warnings,
    };
}

export function detectTrainDetailScreen(xml: string): "route_detail" | "route_list" | "unknown" {
    const nodes = parseXmlTextNodes(xml);
    const texts = nodes.map((node) => node.text.trim()).filter(Boolean);

    if (texts.some((text) => VIEW_FULL_SCHEDULE_RE.test(text) || COLLAPSE_SCHEDULE_RE.test(text))) {
        return "route_detail";
    }

    if (
        texts.some((text) => /^(all|up|down|အားလုံး|အဆန်|အစုန်)$/i.test(text)) &&
        nodes.some((node) => node.parsedBounds.x1 < 220 && parseTrainNumber(node.text))
    ) {
        return "route_list";
    }

    if (texts.some((text) => /^origin$/i.test(text) || /^destination$/i.test(text))) {
        return "route_detail";
    }

    return "unknown";
}

export function runParseTrainDetailUiSelfTest(): void {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <node text="141 (Up)" bounds="[60,200][260,240]" class="android.widget.TextView" />
  <node text="Thazi-Taunggyi (Every Friday)" bounds="[60,235][600,270]" class="android.widget.TextView" />
  <node text="Thazi Railway Station" bounds="[60,480][320,515]" class="android.widget.TextView" />
  <node text="05:00 AM" bounds="[60,515][200,550]" class="android.widget.TextView" />
  <node text="Taunggyi Railway Station" bounds="[500,480][760,515]" class="android.widget.TextView" />
  <node text="06:30 PM" bounds="[500,515][660,550]" class="android.widget.TextView" />
  <node text="Type" bounds="[60,580][150,610]" class="android.widget.TextView" />
  <node text="Mail" bounds="[60,615][150,645]" class="android.widget.TextView" />
  <node text="Direction" bounds="[220,580][350,610]" class="android.widget.TextView" />
  <node text="Up" bounds="[220,615][280,645]" class="android.widget.TextView" />
  <node text="Way" bounds="[380,580][450,610]" class="android.widget.TextView" />
  <node text="One Way" bounds="[380,615][500,645]" class="android.widget.TextView" />
  <node text="Train model" bounds="[60,655][220,685]" class="android.widget.TextView" />
  <node text="AAR" bounds="[60,690][120,720]" class="android.widget.TextView" />
  <node text="Total stations" bounds="[220,655][380,685]" class="android.widget.TextView" />
  <node text="20 Station" bounds="[220,690][340,720]" class="android.widget.TextView" />
  <node text="Traveling time" bounds="[380,655][540,685]" class="android.widget.TextView" />
  <node text="13 hr 30 min" bounds="[380,690][540,720]" class="android.widget.TextView" />
  <node text="Thazi Railway Station" bounds="[60,760][320,795]" class="android.widget.TextView" />
  <node text="05:00 AM" bounds="[820,760][960,795]" class="android.widget.TextView" />
  <node text="Hti Thein" bounds="[60,900][220,935]" class="android.widget.TextView" />
  <node text="05:30 PM" bounds="[820,900][960,935]" class="android.widget.TextView" />
  <node text="Collapse Schedule" bounds="[300,980][780,1040]" class="android.widget.Button" clickable="true" />
  <node text="Favorite" bounds="[100,1100][300,1150]" class="android.widget.TextView" />
  <node text="5,000 Ks" bounds="[100,1200][300,1240]" class="android.widget.TextView" />
</hierarchy>`;

    const dump = parseTrainDetailDump(sampleXml);

    if (dump.metadata.train_number !== "141" || dump.metadata.direction_text !== "Up") {
        throw new Error("metadata identity mismatch");
    }
    if (dump.metadata.type !== "Mail" || dump.metadata.way !== "One Way") {
        throw new Error("metadata labels mismatch");
    }
    if (dump.metadata.train_model !== "AAR" || dump.metadata.total_stations_text !== "20 Station") {
        throw new Error("metadata grid mismatch");
    }
    if (dump.metadata.origin.name !== "Thazi Railway Station" || dump.metadata.destination.name !== "Taunggyi Railway Station") {
        throw new Error("origin/destination mismatch");
    }
    if (!dump.schedule_complete_marker_seen) {
        throw new Error("collapse marker not detected");
    }
    if (dump.stations.length !== 2) {
        throw new Error(`expected 2 stations, got ${dump.stations.length}`);
    }
    if (dump.stations.some((row) => /favorite|ks/i.test(row.name))) {
        throw new Error("noise leaked into station rows");
    }

    const myanmarCollapseXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <node text="အချိန်ဇယား အကျဉ်းချုပ်ကြည့်မည်" bounds="[300,900][780,960]" class="android.widget.Button" />
</hierarchy>`;
    if (!hasCollapseScheduleMarker(parseXmlTextNodes(myanmarCollapseXml))) {
        throw new Error("myanmar collapse marker not detected");
    }

    const myanmarViewFullXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <node text="အချိန်ဇယား အပြည့်အစုံကြည့်မည်" bounds="[300,700][780,760]" class="android.widget.Button" />
</hierarchy>`;
    if (!findViewFullScheduleNode(parseXmlTextNodes(myanmarViewFullXml))) {
        throw new Error("myanmar view-full marker not detected");
    }

    const merged = mergeTrainDetailDumps([
        dump,
        {
            ...dump,
            stations: [
                {
                    sequence: 1,
                    name: "Mandalay",
                    time_text: "06:30 PM",
                    raw_row_text: ["Mandalay", "06:30 PM"],
                    row_bounds: null,
                },
            ],
            schedule_complete_marker_seen: true,
            collapse_schedule_y: 900,
            warnings: [],
        },
    ]);

    if (merged.stations.length !== 3) {
        throw new Error("station merge failed");
    }

    console.log("ok - parse-train-detail-ui self-test");
}

const isSelfTestEntry =
    process.argv[1]?.includes("parse-train-detail-ui.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runParseTrainDetailUiSelfTest();
}
