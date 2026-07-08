/**
 * CoreMap YBS route display name normalization.
 *
 * Converts source app titles such as "(၂) ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး"
 * into dashboard-standard names such as "YBS 2 · ပိတောက်ကွေ့ ↔ အောင်မင်္ဂလာအဝေးပြေး".
 */

import { normalizePublicRouteTitle } from "../ybs-extraction/route-identity.js";
import {
    buildDisplayCodeFromRouteCode,
    buildPrimaryRouteDisplayName,
    parseRouteEndpointsSafe,
    resolveRouteEndpoints,
    type VariantLike,
} from "./route-name-endpoints.js";

export const YBS_ROUTE_CODE_PATTERN = /^YBS-[0-9]+(-[A-Z])?$/;
export const COREMAP_DISPLAY_PREFIX_PATTERN = /^YBS [0-9]+(-[A-Z])? · /;
export const COREMAP_NAMED_DISPLAY_PREFIX_PATTERN =
    /^(?:YBS [0-9]+(?:-[A-Z])?|APS|TRIAL-[^ ·]+) · /u;
export const YBS_HYPHENATED_ROUTE_CODE_PATTERN = /^YBS-[0-9]+-[A-Z]$/i;
export const MYANMAR_ROUTE_NUMBER_PREFIX_PATTERN = /^\([၀-၉\d]+\)/;
export const PRIMARY_NAME_HYPHEN_SEPARATOR_PATTERN = / - /;

const ENDPOINT_SEPARATOR_PATTERN = /\s+-\s+|\s*↔\s*|\s+–\s+|\s+—\s+/u;
const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;
const LATIN_CHAR_PATTERN = /[A-Za-z]/;

const MYANMAR_DIGIT_MAP: Record<string, string> = {
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

export type RouteDisplayNameInput = {
    route_code?: string | null;
    route_number?: number | null;
    route_name_my?: string | null;
    /** Generated English route name from variant endpoints (preferred over Myanmar route_title_en). */
    route_name_en?: string | null;
    route_title_my?: string | null;
    route_title_en?: string | null;
    variants?: VariantLike[];
};

/** True when text is Myanmar-only (not usable as an English route title). */
export function containsMyanmarScript(text: string | null | undefined): boolean {
    if (!text?.trim()) {
        return false;
    }

    const myanmar = (text.match(new RegExp(MYANMAR_CHAR_PATTERN.source, "g")) ?? []).length;
    const latin = (text.match(new RegExp(LATIN_CHAR_PATTERN.source, "g")) ?? []).length;

    return myanmar > 0 && latin === 0;
}

function resolveEnglishRouteTitleSource(input: RouteDisplayNameInput): string | null {
    const titleEn = input.route_title_en?.trim() || null;
    if (titleEn && !containsMyanmarScript(titleEn)) {
        return titleEn;
    }

    const nameEn = input.route_name_en?.trim() || null;
    if (nameEn && !containsMyanmarScript(nameEn)) {
        return nameEn;
    }

    return null;
}

export type RouteDisplayNameReport = {
    source_title_my: string | null;
    source_title_en: string | null;
    extracted_route_number: number | null;
    route_code: string | null;
    display_code: string | null;
    origin_my: string | null;
    destination_my: string | null;
    origin_en: string | null;
    destination_en: string | null;
    public_name: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    alias_und: string | null;
    validation_warnings: string[];
    validation_errors: string[];
};

export function myanmarDigitsToNumber(text: string): number | null {
    if (!/^[၀-၉\d]+$/u.test(text.trim())) {
        return null;
    }

    const normalized = text
        .trim()
        .split("")
        .map((char) => MYANMAR_DIGIT_MAP[char] ?? char)
        .join("");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parseRouteNumberFromCode(routeCode: string | null | undefined): number | null {
    if (!routeCode) {
        return null;
    }

    const match = routeCode.trim().match(/^YBS-([0-9]+)/i);
    if (!match) {
        return null;
    }

    return Number(match[1]);
}

export function buildYbsRouteCode(routeNumber: number, suffix = ""): string {
    const normalizedSuffix = suffix.trim().toUpperCase();
    if (!normalizedSuffix) {
        return `YBS-${routeNumber}`;
    }
    if (normalizedSuffix.startsWith("-")) {
        return `YBS-${routeNumber}${normalizedSuffix}`;
    }
    return `YBS-${routeNumber}-${normalizedSuffix}`;
}

export function buildYbsDisplayCode(routeNumber: number, suffix = ""): string {
    const normalizedSuffix = suffix.trim().toUpperCase();
    if (!normalizedSuffix) {
        return `YBS ${routeNumber}`;
    }
    if (normalizedSuffix.startsWith("-")) {
        return `YBS ${routeNumber}${normalizedSuffix}`;
    }
    return `YBS ${routeNumber}-${normalizedSuffix}`;
}

export function parseRouteEndpoints(
    title: string | null | undefined,
): { origin: string | null; destination: string | null } {
    return parseRouteEndpointsSafe(title);
}

export { buildPrimaryRouteDisplayName } from "./route-name-endpoints.js";

export function routeCodeSuffix(routeCode: string | null | undefined): string {
    if (!routeCode) {
        return "";
    }

    const trimmed = routeCode.trim();
    const hyphenatedMatch = trimmed.match(/^YBS-[0-9]+-([A-Z])$/i);
    if (hyphenatedMatch) {
        return hyphenatedMatch[1].toUpperCase();
    }

    const legacyCompactMatch = trimmed.match(/^YBS-[0-9]+([A-Z])$/i);
    if (legacyCompactMatch) {
        return legacyCompactMatch[1].toUpperCase();
    }

    return "";
}

export function normalizeYbsRouteDisplayNames(
    input: RouteDisplayNameInput,
): RouteDisplayNameReport {
    const warnings: string[] = [];
    const errors: string[] = [];

    const sourceTitleMy =
        input.route_title_my?.trim() ||
        input.route_name_my?.trim() ||
        null;
    const englishTitleSource = resolveEnglishRouteTitleSource(input);
    const sourceTitleEn = englishTitleSource;

    const explicitRouteCode = input.route_code?.trim() ?? null;
    const preserveExplicitHyphenatedCode =
        Boolean(explicitRouteCode) && YBS_HYPHENATED_ROUTE_CODE_PATTERN.test(explicitRouteCode);

    const routeNumber =
        (typeof input.route_number === "number" && Number.isFinite(input.route_number)
            ? input.route_number
            : null) ?? parseRouteNumberFromCode(explicitRouteCode);

    const suffix = routeCodeSuffix(explicitRouteCode);

    let routeCode: string | null;
    let displayCode: string | null;

    if (preserveExplicitHyphenatedCode && explicitRouteCode) {
        routeCode = explicitRouteCode.toUpperCase();
        displayCode = buildDisplayCodeFromRouteCode(routeCode);
    } else if (routeNumber !== null) {
        routeCode = buildYbsRouteCode(routeNumber, suffix);
        displayCode = buildYbsDisplayCode(routeNumber, suffix);
    } else if (explicitRouteCode) {
        routeCode = explicitRouteCode.toUpperCase();
        displayCode = buildDisplayCodeFromRouteCode(routeCode);
    } else {
        routeCode = null;
        displayCode = null;
    }

    const resolvedEndpoints = resolveRouteEndpoints({
        route_code: routeCode ?? explicitRouteCode,
        route_title_my: sourceTitleMy,
        route_title_en: input.route_title_en,
        route_name_en: input.route_name_en ?? englishTitleSource,
        variants: input.variants,
    });

    const originMy = resolvedEndpoints.origin_my;
    const destinationMy = resolvedEndpoints.destination_my;
    const originEn = resolvedEndpoints.origin_en;
    const destinationEn = resolvedEndpoints.destination_en;

    let primaryNameMy: string | null = null;
    let primaryNameEn: string | null = null;

    if (displayCode && originMy && destinationMy) {
        primaryNameMy = buildPrimaryRouteDisplayName(displayCode, originMy, destinationMy);
    }

    if (displayCode && originEn && destinationEn) {
        primaryNameEn = buildPrimaryRouteDisplayName(displayCode, originEn, destinationEn);
    } else if (input.route_title_en?.trim() && containsMyanmarScript(input.route_title_en)) {
        warnings.push(
            "English route_title_en contains Myanmar script only; English primary display name not built from it.",
        );
    } else if (!englishTitleSource) {
        warnings.push("English primary display name unavailable; no Latin English route title or route_name_en.");
    }

    if (!routeCode) {
        errors.push("route_code could not be resolved.");
    }

    if (!displayCode) {
        errors.push("display_code could not be resolved from route_code.");
    }

    if (!originMy || !destinationMy) {
        errors.push("Myanmar route endpoints could not be parsed from source title.");
    }

    if (!primaryNameMy) {
        errors.push("Myanmar primary display name could not be built.");
    }

    if (sourceTitleMy && !englishTitleSource) {
        warnings.push("English source title missing.");
    }

    if (
        primaryNameMy &&
        primaryNameEn &&
        primaryNameMy === primaryNameEn &&
        englishTitleSource
    ) {
        warnings.push("Myanmar and English primary route names are identical despite English source.");
    }

    return {
        source_title_my: sourceTitleMy,
        source_title_en: sourceTitleEn,
        extracted_route_number: routeNumber,
        route_code: routeCode,
        display_code: displayCode,
        origin_my: originMy,
        destination_my: destinationMy,
        origin_en: originEn,
        destination_en: destinationEn,
        public_name: primaryNameMy,
        primary_name_my: primaryNameMy,
        primary_name_en: primaryNameEn,
        alias_und: routeCode,
        validation_warnings: warnings,
        validation_errors: errors,
    };
}

export function isValidCoreMapPrimaryRouteName(name: string): boolean {
    return (
        COREMAP_NAMED_DISPLAY_PREFIX_PATTERN.test(name) &&
        name.includes(" ↔ ") &&
        !MYANMAR_ROUTE_NUMBER_PREFIX_PATTERN.test(name) &&
        !PRIMARY_NAME_HYPHEN_SEPARATOR_PATTERN.test(name)
    );
}

export function validateStoredRouteDisplayNames(input: {
    route_code: string;
    public_name: string;
    route_names: Array<{
        language_code: string;
        name_type: string;
        is_primary: boolean;
        name: string;
    }>;
}): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!YBS_ROUTE_CODE_PATTERN.test(input.route_code) && !input.route_code.startsWith("TRIAL-") && input.route_code !== "APS") {
        errors.push(`route_code "${input.route_code}" is outside supported route display scope.`);
    }

    if (!COREMAP_NAMED_DISPLAY_PREFIX_PATTERN.test(input.public_name)) {
        errors.push(`public_name does not start with a valid display code prefix.`);
    }

    if (!isValidCoreMapPrimaryRouteName(input.public_name)) {
        errors.push("public_name is not a valid CoreMap primary display name.");
    }

    const primaryMy = input.route_names.find(
        (row) => row.language_code === "my" && row.is_primary,
    );
    const primaryEn = input.route_names.find(
        (row) => row.language_code === "en" && row.is_primary,
    );
    const aliasUnd = input.route_names.find(
        (row) => row.language_code === "und" && row.name_type === "alias",
    );

    for (const row of [primaryMy, primaryEn]) {
        if (!row) {
            continue;
        }
        if (row.name_type !== "primary") {
            errors.push(`${row.language_code} route_name name_type must be primary (found ${row.name_type}).`);
        }
        if (!isValidCoreMapPrimaryRouteName(row.name)) {
            errors.push(`${row.language_code} primary route_name is not CoreMap format.`);
        }
    }

    if (!primaryMy) {
        errors.push("Missing my primary route_name.");
    }

    if (!primaryEn) {
        errors.push("Missing en primary route_name.");
    } else if (containsMyanmarScript(primaryEn.name)) {
        errors.push("en primary route_name contains Myanmar script.");
    }

    if (
        primaryMy &&
        primaryEn &&
        primaryMy.name === primaryEn.name &&
        !containsMyanmarScript(primaryEn.name)
    ) {
        errors.push("my and en primary route_names must not be identical when English is Latin.");
    }

    if (!aliasUnd) {
        errors.push("Missing und alias route_name.");
    } else if (aliasUnd.name !== input.route_code) {
        errors.push(`und alias must equal route_code (found "${aliasUnd.name}").`);
    }

    if (input.public_name.includes("YBS-")) {
        errors.push("public_name must not contain hyphen-style route code.");
    }

    return { errors, warnings };
}
