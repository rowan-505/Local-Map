/**
 * @deprecated Use tools/data-pipeline/transport-json-import/ybs-extraction/ instead.
 *
 * Legacy V1 prototype for single-route extraction.
 * Output folder tmp/transport-imports/ybs-2/ is legacy test data only.
 *
 * Extract YBS Go bus stop list from a connected Android phone via ADB UI XML.
 *
 * Prerequisites:
 * - adb installed and device connected
 * - YBS Go app open on the bus route stop list screen
 *
 * Does not touch the database.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_DEVICE_ID = "R3CX10JRQNZ";
const DEFAULT_PACKAGE = "com.ybsgo.app";
const DEFAULT_OUTPUT = "tmp/transport-imports/ybs-2/raw-extracted.json";
const DEFAULT_XML_DIR = "tmp/transport-imports/ybs-2/appium/page-sources";

const HEADER_TEXTS = new Set([
    "ဘတ်စ်အသေးစိတ်",
    "မျှဝေမည်",
    "အသွား",
    "အပြန်",
    "အားလုံး",
]);

const UI_CHROME_PATTERNS = [
    /^[\d.,\s]*(?:ကျပ်|MMK|Ks)?$/i,
    /^YBS\b/i,
    /^YUPT\b/i,
    /^\(\d+\)$/,
    /^[\d.]+%$/,
];

type TextViewNode = {
    text: string;
    top: number;
    left: number;
};

type StopRow = {
    stop_name_my: string;
    area_text_my: string;
    raw_text: string;
};

type CliOptions = {
    deviceId: string;
    packageName: string;
    outputPath: string;
    xmlDir: string;
    maxScrolls: number;
    scrollPauseMs: number;
};

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        deviceId: DEFAULT_DEVICE_ID,
        packageName: DEFAULT_PACKAGE,
        outputPath: DEFAULT_OUTPUT,
        xmlDir: DEFAULT_XML_DIR,
        maxScrolls: 40,
        scrollPauseMs: 700,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === "--device" && next) {
            options.deviceId = next;
            i++;
        } else if (arg === "--package" && next) {
            options.packageName = next;
            i++;
        } else if (arg === "--output" && next) {
            options.outputPath = next;
            i++;
        } else if (arg === "--xml-dir" && next) {
            options.xmlDir = next;
            i++;
        } else if (arg === "--max-scrolls" && next) {
            options.maxScrolls = Number(next);
            i++;
        }
    }

    return options;
}

function adb(deviceId: string, args: string[]): string {
    return execFileSync("adb", ["-s", deviceId, ...args], {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
    }).trim();
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function extractXmlPayload(raw: string): string {
    const start = raw.indexOf("<?xml");
    if (start >= 0) {
        return raw.slice(start);
    }
    const hierarchyStart = raw.indexOf("<hierarchy");
    if (hierarchyStart >= 0) {
        return raw.slice(hierarchyStart);
    }
    return raw;
}

function dumpUiXml(deviceId: string): string {
    const remotePath = "/sdcard/window_dump.xml";

    try {
        const stdout = execFileSync(
            "adb",
            ["-s", deviceId, "exec-out", "uiautomator", "dump", "/dev/tty"],
            { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
        );
        return extractXmlPayload(stdout);
    } catch {
        adb(deviceId, ["shell", "uiautomator", "dump", remotePath]);
        const xml = adb(deviceId, ["shell", "cat", remotePath]);
        return extractXmlPayload(xml);
    }
}

function getScreenSize(deviceId: string): { width: number; height: number } {
    const output = adb(deviceId, ["shell", "wm", "size"]);
    const match = output.match(/(\d+)x(\d+)/);
    if (!match) {
        return { width: 1080, height: 2400 };
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

function scrollDown(_deviceId: string): never {
    throw new Error(
        "extract-ybs-ui-v1 is archived and cannot swipe. " +
            "Use extract-current-route.ts / open-route.ts (safeSwipe via adb.ts).",
    );
}

function isUiChrome(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }
    if (HEADER_TEXTS.has(trimmed)) {
        return true;
    }
    return UI_CHROME_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function extractTextViews(xml: string): TextViewNode[] {
    const nodes: TextViewNode[] = [];
    const nodeRegex = /<node\b[^>]*>/g;
    let match: RegExpExecArray | null;

    while ((match = nodeRegex.exec(xml)) !== null) {
        const tag = match[0];
        if (!tag.includes("TextView")) {
            continue;
        }

        const textMatch = tag.match(/\btext="([^"]*)"/);
        const boundsMatch = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        if (!textMatch || !boundsMatch) {
            continue;
        }

        const text = decodeXmlEntities(textMatch[1]).trim();
        if (!text || isUiChrome(text)) {
            continue;
        }

        nodes.push({
            text,
            top: Number(boundsMatch[2]),
            left: Number(boundsMatch[1]),
        });
    }

    return nodes.sort((a, b) => a.top - b.top || a.left - b.left);
}

function rowKey(row: StopRow): string {
    return `${row.stop_name_my}|||${row.area_text_my}`;
}

function pairStopRows(textViews: TextViewNode[]): StopRow[] {
    const rows: StopRow[] = [];

    for (let i = 0; i < textViews.length - 1; i++) {
        const stopName = textViews[i].text;
        const areaNode = textViews[i + 1];

        if (Math.abs(areaNode.top - textViews[i].top) > 220) {
            continue;
        }

        rows.push({
            stop_name_my: stopName,
            area_text_my: areaNode.text,
            raw_text: `${stopName}\n${areaNode.text}`,
        });
        i++;
    }

    return rows;
}

function detectDirection(xml: string): "outbound" | "inbound" {
    const inboundIndex = xml.indexOf('text="အပြန်"');
    if (inboundIndex >= 0) {
        const nearby = xml.slice(inboundIndex, inboundIndex + 300);
        if (nearby.includes('selected="true"') || nearby.includes('checked="true"')) {
            return "inbound";
        }
    }
    return "outbound";
}

function extractRouteHints(textViews: TextViewNode[]): {
    route_name_my: string | null;
    route_number: string | null;
    operator_name: string | null;
    fare_text: string | null;
} {
    const topTexts = textViews.slice(0, 12).map((node) => node.text);
    let route_name_my: string | null = null;
    let route_number: string | null = null;
    let operator_name: string | null = null;
    let fare_text: string | null = null;

    for (const text of topTexts) {
        if (!route_name_my && (text.includes(" - ") || text.includes("—"))) {
            route_name_my = text;
            continue;
        }
        if (!route_number) {
            const numberMatch = text.match(/^\(?([၀-၉\d]+)\)?$/);
            if (numberMatch) {
                route_number = numberMatch[1];
                continue;
            }
        }
        if (!operator_name && /^YUPT$/i.test(text)) {
            operator_name = text;
            continue;
        }
        if (!fare_text && /ကျပ်|MMK|Ks/i.test(text)) {
            fare_text = text;
        }
    }

    return { route_name_my, route_number, operator_name, fare_text };
}

function mergeDumpRows(dumpRows: StopRow[][]): { stops: StopRow[]; warnings: string[] } {
    const warnings: string[] = [];
    const merged: StopRow[] = [];
    const seen = new Set<string>();

    for (let dumpIndex = 0; dumpIndex < dumpRows.length; dumpIndex++) {
        const rows = dumpRows[dumpIndex];
        const isLastDump = dumpIndex === dumpRows.length - 1;
        let rowsToAdd = rows;

        if (!isLastDump && rows.length > 0) {
            const lastRow = rows[rows.length - 1];
            const nextRows = dumpRows[dumpIndex + 1] ?? [];
            const confirmedInNext = nextRows.some((row) => rowKey(row) === rowKey(lastRow));

            if (!confirmedInNext) {
                rowsToAdd = rows.slice(0, -1);
                warnings.push(
                    `Ignored unconfirmed bottom row on dump ${dumpIndex + 1}: ${lastRow.stop_name_my}`,
                );
            }
        }

        for (const row of rowsToAdd) {
            const key = rowKey(row);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(row);
        }
    }

    return { stops: merged, warnings };
}

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function saveXmlDump(xmlDir: string, index: number, xml: string): string {
    const fileName = `dump-${String(index).padStart(3, "0")}.xml`;
    const filePath = path.join(xmlDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    return filePath;
}

async function collectStopList(options: CliOptions): Promise<{
    xmlPaths: string[];
    dumpRows: StopRow[][];
    directionName: "outbound" | "inbound";
    routeHints: ReturnType<typeof extractRouteHints>;
    warnings: string[];
}> {
    const warnings: string[] = [];
    const xmlPaths: string[] = [];
    const dumpRows: StopRow[][] = [];
    const seenAcrossDumps = new Set<string>();

    let directionName: "outbound" | "inbound" = "outbound";
    let routeHints: ReturnType<typeof extractRouteHints> = {
        route_name_my: null,
        route_number: null,
        operator_name: null,
        fare_text: null,
    };

    let staleScrolls = 0;

    for (let dumpIndex = 1; dumpIndex <= options.maxScrolls; dumpIndex++) {
        const xml = dumpUiXml(options.deviceId);
        const xmlPath = saveXmlDump(options.xmlDir, dumpIndex, xml);
        xmlPaths.push(xmlPath);

        const textViews = extractTextViews(xml);
        const rows = pairStopRows(textViews);
        dumpRows.push(rows);

        if (dumpIndex === 1) {
            directionName = detectDirection(xml);
            routeHints = extractRouteHints(textViews);
            if (rows.length === 0) {
                warnings.push("No stop rows found on first screen. Open the YBS route stop list first.");
            }
        }

        const newRows = rows.filter((row) => !seenAcrossDumps.has(rowKey(row)));
        if (newRows.length === 0) {
            staleScrolls++;
        } else {
            staleScrolls = 0;
            for (const row of newRows) {
                seenAcrossDumps.add(rowKey(row));
            }
        }

        if (staleScrolls >= 2) {
            break;
        }

        scrollDown(options.deviceId);
        await delay(options.scrollPauseMs);
    }

    return { xmlPaths, dumpRows, directionName, routeHints, warnings };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();

    const outputPath = path.isAbsolute(options.outputPath)
        ? options.outputPath
        : path.join(repoRoot, options.outputPath);
    const xmlDir = path.isAbsolute(options.xmlDir)
        ? options.xmlDir
        : path.join(repoRoot, options.xmlDir);

    ensureDir(path.dirname(outputPath));
    ensureDir(xmlDir);

    try {
        adb(options.deviceId, ["get-state"]);
    } catch {
        console.error(`Device not ready: ${options.deviceId}`);
        process.exit(1);
    }

    const collected = await collectStopList({ ...options, xmlDir });
    const merged = mergeDumpRows(collected.dumpRows);
    const allWarnings = [...collected.warnings, ...merged.warnings];

    const stops = merged.stops.map((row, index) => ({
        sequence: index + 1,
        stop_name_my: row.stop_name_my,
        area_text_my: row.area_text_my,
        raw_text: row.raw_text,
    }));

    if (stops.length === 0) {
        allWarnings.push("Final stop list is empty.");
    }

    const output = {
        source: {
            source_name: "external_ybs_app",
            source_kind: "visible_app_extraction",
            source_method: "adb_uiautomator_xml",
            device_id: options.deviceId,
            package: options.packageName,
        },
        route: {
            route_code: null,
            route_number: collected.routeHints.route_number,
            route_name_my: collected.routeHints.route_name_my,
            operator_name: collected.routeHints.operator_name,
            fare_text: collected.routeHints.fare_text,
        },
        variants: [
            {
                direction_name: collected.directionName,
                stops,
            },
        ],
        warnings: allWarnings,
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    console.log(`Wrote ${stops.length} stops to ${outputPath}`);
    console.log(`Saved ${collected.xmlPaths.length} XML dumps to ${xmlDir}`);
    if (allWarnings.length > 0) {
        console.log("Warnings:");
        for (const warning of allWarnings) {
            console.log(`- ${warning}`);
        }
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
