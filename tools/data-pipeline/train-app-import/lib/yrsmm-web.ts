/**
 * Fetch train route data from https://yrsmm.com (same backend as the YRS Move app WebView).
 */

import { createDecipheriv } from "node:crypto";

import type { DirectionCode, TrainLanguage } from "./types.js";
import { buildVariantCode } from "../normalize/merge-language-routes.js";

export const YRSMM_BASE_URL = "https://yrsmm.com";
export const YRSMM_API_BASE_URL = `${YRSMM_BASE_URL}/api/`;

/** Public API key shipped in the YRS Move web client bundle. */
export const YRSMM_API_KEY = "YangonRailwayService977292898HtetLinThu";

const YRSMM_AES_KEY = "YRSMOVEAPP123456!@#$%^yrsmoveapp";
const YRSMM_AES_IV = YRSMM_AES_KEY.slice(0, 16);

export type YrsmmLabeledValue = {
    value: string;
    text: string;
    color?: string;
};

export type YrsmmRouteListItem = {
    slug: string;
    title: string;
    route_type_title: string | null;
    type: YrsmmLabeledValue | null;
    way: YrsmmLabeledValue | null;
    direction: YrsmmLabeledValue | null;
    train_model: YrsmmLabeledValue | null;
    online_ticketing_system?: YrsmmLabeledValue | null;
    origin_station_title: string | null;
    origin_station_time: string | null;
    destination_station_title: string | null;
    destination_station_time: string | null;
};

export type YrsmmRouteProps = YrsmmRouteListItem & {
    description: string | null;
    total_stations: number | null;
    traveling_minutes: string | null;
    station_schedules: Array<{
        slug: string;
        title: string;
        time: string;
        latitude?: string;
        longitude?: string;
    }>;
};

type YrsmmPaginatedResponse<T> = {
    data: T[];
    meta: {
        last_page: number;
        current_page?: number;
    };
};

type YrsmmRouteListApiRow = Omit<YrsmmRouteListItem, "slug" | "title"> & {
    slug: string;
    title: string;
};

export function decryptYrsmmField(encryptedBase64: string): string {
    const ciphertext = Buffer.from(encryptedBase64, "base64");
    const decipher = createDecipheriv(
        "aes-256-cbc",
        Buffer.from(YRSMM_AES_KEY, "utf8"),
        Buffer.from(YRSMM_AES_IV, "utf8"),
    );
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function decodeRouteListApiRow(row: YrsmmRouteListApiRow): YrsmmRouteListItem {
    return {
        ...row,
        slug: decryptYrsmmField(row.slug),
        title: decryptYrsmmField(row.title),
    };
}

export function normalizeRouteSlug(slug: string): string {
    return slug.trim().replace(/-temp$/i, "");
}

export function mapDirectionValueToCode(value: string | null | undefined): DirectionCode | null {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized === "up" || value === "အဆန်") {
        return "UP";
    }
    if (normalized === "down" || value === "အစုန်") {
        return "DOWN";
    }
    if (normalized === "clockwise") {
        return "CLOCKWISE";
    }
    if (normalized === "anticlockwise") {
        return "ANTICLOCKWISE";
    }
    return null;
}

export function directionTextFromCode(directionCode: DirectionCode): string | null {
    switch (directionCode) {
        case "UP":
            return "Up";
        case "DOWN":
            return "Down";
        case "CLOCKWISE":
            return "Clockwise";
        case "ANTICLOCKWISE":
            return "Anticlockwise";
        default:
            return null;
    }
}

export function myanmarDirectionLabel(directionCode: DirectionCode): string | null {
    switch (directionCode) {
        case "UP":
            return "အဆန်";
        case "DOWN":
            return "အစုန်";
        case "CLOCKWISE":
            return "လက်ယာရစ်";
        case "ANTICLOCKWISE":
            return "လက်ဝဲရစ်";
        default:
            return null;
    }
}

export function canonicalTrainNumberFromSlugPart(slugPart: string): string {
    const trimmed = slugPart.trim();
    const gokteikMatch = trimmed.match(/^gokteik-(\d+)$/i);
    if (gokteikMatch?.[1]) {
        return gokteikMatch[1];
    }
    return trimmed;
}

export function parseRouteSlug(
    slug: string,
    directionHint?: string | null,
): {
    trainNumber: string;
    directionCode: DirectionCode;
    directionText: string | null;
} {
    const normalized = normalizeRouteSlug(slug);
    const suffixMatch = normalized.match(/^(.+)-(up|down)$/i);
    if (suffixMatch?.[1] && suffixMatch[2]) {
        const directionCode = suffixMatch[2].toUpperCase() as DirectionCode;
        return {
            trainNumber: canonicalTrainNumberFromSlugPart(suffixMatch[1]),
            directionCode,
            directionText: directionTextFromCode(directionCode),
        };
    }

    const hintedCode = mapDirectionValueToCode(directionHint);
    if (hintedCode) {
        return {
            trainNumber: canonicalTrainNumberFromSlugPart(normalized),
            directionCode: hintedCode,
            directionText: directionTextFromCode(hintedCode),
        };
    }

    return {
        trainNumber: canonicalTrainNumberFromSlugPart(normalized),
        directionCode: "UNKNOWN",
        directionText: null,
    };
}

export function slugToEnglishLabel(slug: string): string {
    return slug
        .split("-")
        .filter(Boolean)
        .map((part) => {
            if (/^\d+$/.test(part)) {
                return part;
            }
            return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(" ")
        .replace(/\bRailway Station\b/i, "Railway Station")
        .trim();
}

export function stationSlugToEnglishName(stationSlug: string): string {
    if (stationSlug.endsWith("-railway-station")) {
        const base = stationSlug.replace(/-railway-station$/, "");
        const words = base.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1));
        return `${words.join(" ")} Railway Station`;
    }
    return slugToEnglishLabel(stationSlug);
}

export function variantCodeFromSlug(slug: string, directionHint?: string | null): string {
    const parsed = parseRouteSlug(slug, directionHint);
    return buildVariantCode(parsed.trainNumber, parsed.directionCode);
}

export function translateOperationTextToEnglish(myLine: string): string | null {
    const trimmed = myLine.trim();
    if (/နေ့စဉ်/.test(trimmed)) {
        return "Daily";
    }
    if (/အပတ်စဥ်\s*သောကြာနေ့/.test(trimmed)) {
        return "Every Friday";
    }
    return null;
}

export function extractOperationFromDescription(
    description: string | null | undefined,
    language: TrainLanguage,
): { operation_text: string | null; operation_day_raw: string | null } {
    if (!description?.trim()) {
        return { operation_text: null, operation_day_raw: null };
    }

    let myLine: string | null = null;
    for (const line of description.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const parenthesized = trimmed.match(/^\(([^)]+)\)$/)?.[1]?.trim() ?? trimmed;
        if (
            /^(အပတ်စဥ်|နေ့စဉ်)/.test(parenthesized) ||
            /သောကြာ|တနင်္လာ|အင်္ဂါ|ဗုဒ္ဓ|ကြာသပတေး|စနေ|တနင်္ဂနွေ/.test(parenthesized)
        ) {
            myLine = parenthesized;
            break;
        }
    }

    if (!myLine) {
        return { operation_text: null, operation_day_raw: null };
    }

    if (language === "my") {
        return { operation_text: myLine, operation_day_raw: myLine };
    }

    return {
        operation_text: translateOperationTextToEnglish(myLine),
        operation_day_raw: myLine,
    };
}

export async function fetchYrsmmJson<T>(
    resource: string,
    params: Record<string, string | number | undefined> = {},
): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            query.set(key, String(value));
        }
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const url = `${YRSMM_API_BASE_URL}${resource.replace(/^\//, "")}${suffix}`;
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": YRSMM_API_KEY,
            "User-Agent": "CoreMapTrainImport/1.0",
        },
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return (await response.json()) as T;
}

export async function fetchYrsmmText(path: string): Promise<string> {
    const url = path.startsWith("http") ? path : `${YRSMM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(url, {
        headers: {
            "User-Agent": "CoreMapTrainImport/1.0",
            Accept: "text/html,application/json",
        },
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.text();
}

export async function fetchAllRouteListItemsFromApi(): Promise<YrsmmRouteListItem[]> {
    const items: YrsmmRouteListItem[] = [];
    let page = 1;
    let lastPage = 1;

    while (page <= lastPage) {
        const response = await fetchYrsmmJson<YrsmmPaginatedResponse<YrsmmRouteListApiRow>>("route", {
            page,
        });
        lastPage = response.meta.last_page;
        for (const row of response.data) {
            items.push(decodeRouteListApiRow(row));
        }
        page += 1;
    }

    return items.sort((left, right) => left.slug.localeCompare(right.slug));
}

/** Authoritative route slug list from the live YRS API (not the stale sitemap). */
export async function fetchRouteSlugsFromApi(): Promise<string[]> {
    const items = await fetchAllRouteListItemsFromApi();
    return items.map((item) => item.slug);
}

/** @deprecated Sitemap includes removed routes and misses active ones. Prefer fetchRouteSlugsFromApi(). */
export async function fetchRouteSlugsFromSitemap(): Promise<string[]> {
    const xml = await fetchYrsmmText("/sitemap.xml");
    const matches = [...xml.matchAll(/<loc>\s*https:\/\/yrsmm\.com\/route\/([^<\s]+)\s*<\/loc>/gi)];
    const slugs = matches
        .map((match) => decodeURIComponent(match[1] ?? "").trim())
        .filter(Boolean);

    return [...new Set(slugs)].sort((left, right) => left.localeCompare(right));
}

export function parseInertiaRouteProps(html: string): YrsmmRouteProps {
    const match = html.match(/data-page="([^"]+)"/);
    if (!match?.[1]) {
        throw new Error("Inertia data-page not found in HTML");
    }

    const decoded = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&");

    const page = JSON.parse(decoded) as {
        props?: { route?: YrsmmRouteProps };
    };

    const route = page.props?.route;
    if (!route?.slug) {
        throw new Error("Route props missing from Inertia page");
    }

    return route;
}

export async function fetchRoutePropsBySlug(slug: string): Promise<YrsmmRouteProps> {
    const html = await fetchYrsmmText(`/route/${encodeURIComponent(slug)}`);
    return parseInertiaRouteProps(html);
}

export function runYrsmmWebSelfTest(): void {
    const parsed = parseRouteSlug("141-up");
    if (parsed.trainNumber !== "141" || parsed.directionCode !== "UP") {
        throw new Error("parseRouteSlug failed for 141-up");
    }
    const nga2 = parseRouteSlug("nga-2", "anticlockwise");
    if (nga2.trainNumber !== "nga-2" || nga2.directionCode !== "ANTICLOCKWISE") {
        throw new Error("parseRouteSlug failed for nga-2 anticlockwise");
    }
    if (variantCodeFromSlug("nga-2", "anticlockwise") !== "TRAIN-nga-2-ANTICLOCKWISE") {
        throw new Error("variantCodeFromSlug failed for nga-2");
    }
    const tempRoute = parseRouteSlug("61-up-temp");
    if (tempRoute.trainNumber !== "61" || tempRoute.directionCode !== "UP") {
        throw new Error("parseRouteSlug failed for 61-up-temp");
    }
    if (variantCodeFromSlug("61-up-temp") !== "TRAIN-61-UP") {
        throw new Error("variantCodeFromSlug failed for 61-up-temp");
    }
    const gokteik1 = parseRouteSlug("gokteik-1", "up");
    if (gokteik1.trainNumber !== "1" || gokteik1.directionCode !== "UP") {
        throw new Error("parseRouteSlug failed for gokteik-1");
    }
    if (variantCodeFromSlug("gokteik-1", "up") !== "TRAIN-1-UP") {
        throw new Error("variantCodeFromSlug failed for gokteik-1");
    }
    if (variantCodeFromSlug("gokteik-2", "down") !== "TRAIN-2-DOWN") {
        throw new Error("variantCodeFromSlug failed for gokteik-2");
    }
    const operation = extractOperationFromDescription("သာစည်-တောင်ကြီး\r\n(အပတ်စဥ် သောကြာနေ့)", "en");
    if (operation.operation_text !== "Every Friday" || operation.operation_day_raw !== "အပတ်စဥ် သောကြာနေ့") {
        throw new Error("extractOperationFromDescription failed");
    }
    if (stationSlugToEnglishName("thazi-railway-station") !== "Thazi Railway Station") {
        throw new Error("stationSlugToEnglishName failed");
    }
    const decryptedSlug = decryptYrsmmField("z/Uf9Pd4co3waYyGpW6E/A==");
    if (decryptedSlug !== "141-up") {
        throw new Error(`decryptYrsmmField failed: got ${decryptedSlug}`);
    }
    console.log("ok - yrsmm-web self-test");
}
