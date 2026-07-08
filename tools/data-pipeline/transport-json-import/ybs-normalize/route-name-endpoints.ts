/**
 * Route endpoint parsing, phrase normalization, and name-quality checks.
 *
 * Avoid splitting romanized Myanmar syllables on bare hyphens inside endpoint text.
 */

import { normalizePublicRouteTitle } from "../ybs-extraction/route-identity.js";

const YBS_ROUTE_CODE_PATTERN = /^YBS-[0-9]+(-[A-Z])?$/i;
const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;
const LATIN_CHAR_PATTERN = /[A-Za-z]/;
const MYANMAR_ROUTE_NUMBER_PREFIX_PATTERN = /^\([၀-၉\d]+\)\s*/u;

function parseRouteNumberFromCode(routeCode: string): number | null {
    const match = routeCode.trim().match(/^YBS-([0-9]+)/i);
    return match ? Number(match[1]) : null;
}

function routeCodeSuffix(routeCode: string): string {
    const hyphenated = routeCode.trim().match(/^YBS-[0-9]+-([A-Z])$/i);
    if (hyphenated) {
        return hyphenated[1].toUpperCase();
    }
    const compact = routeCode.trim().match(/^YBS-[0-9]+([A-Z])$/i);
    if (compact) {
        return compact[1].toUpperCase();
    }
    return "";
}

function buildYbsDisplayCode(routeNumber: number, suffix = ""): string {
    const normalizedSuffix = suffix.trim().toUpperCase();
    if (!normalizedSuffix) {
        return `YBS ${routeNumber}`;
    }
    return `YBS ${routeNumber}-${normalizedSuffix}`;
}

const BROKEN_ROMANIZATION_PATTERNS: RegExp[] = [
    /\bShit\b[\s↔-]*\bsae\b/i,
    /\bsae\b[\s↔-]*\bkoe\b/i,
    /\bChauk\b[\s↔-]*\bsae\b/i,
    /\bsae\b[\s↔-]*\bngar\b/i,
    /\bSae\b[\s↔-]*\bThone\b/i,
    /\bkoe\s+Kwae\b/i,
    /\bngar\s+Yat\b/i,
    /\bLan\s+Thone\s+Sae\b/i,
];

type EndpointPhraseRule = {
    myanmar?: RegExp;
    english?: RegExp;
    normalized_en: string;
    normalized_my?: string;
};

const ENDPOINT_PHRASE_RULES: EndpointPhraseRule[] = [
    {
        myanmar: /^\(?၈၉\)?\s*ကွေ့$|^\(?၈၉\)?\s*လမ်းဆုံ$/u,
        english: /Shit[\s-]*sae[\s-]*koe|89\s*Junction/i,
        normalized_en: "89 Junction",
    },
    {
        myanmar: /\(၁၃\)\s*ဂိတ်|၁၃\s*ဂိတ်/u,
        english: /Sae[\s-]*Thone\s*Gate|13\s*Gate/i,
        normalized_en: "13 Gate",
        normalized_my: "(၁၃) ဂိတ်",
    },
    {
        myanmar: /^\(?၆၅\)?\s*ရပ်ကွက်$|^သာကေတ\s*\(\s*၆၅\s*ရပ်ကွက်\s*\)$/u,
        english: /Chauk[\s-]*sae[\s-]*ngar|65\s*Ward|Thaketa\s*65\s*Ward/i,
        normalized_en: "Thaketa 65 Ward",
        normalized_my: "သာကေတ(၆၅ ရပ်ကွက်)",
    },
    {
        myanmar: /လမ်း\s*\(\s*၃၀\s*\)|လမ်း\s*၃၀/u,
        english: /Lan\s+Thone\s+Sae|30th\s+Street/i,
        normalized_en: "30th Street",
        normalized_my: "လမ်း(၃၀)",
    },
    {
        myanmar: /ဒဂုံဧရာအဝေးပြေး/u,
        english: /Dagon\s+Ayar\s+A\s*Way\s+Pyay|Dagon\s+Ayar\s+Highway/i,
        normalized_en: "Dagon Ayar Highway",
        normalized_my: "ဒဂုံဧရာအဝေးပြေး",
    },
    {
        myanmar: /အောင်မင်္ဂလာအဝေးပြေး/u,
        english: /Aung\s+Mingalar\s+A\s*Way\s+Pyay|Aung\s+Mingalar\s+Highway\s+Terminal/i,
        normalized_en: "Aung Mingalar Highway Terminal",
        normalized_my: "အောင်မင်္ဂလာအဝေးပြေး",
    },
];

export type VariantStopLike = {
    stop_name_my?: string | null;
    stop_name_en?: string | null;
};

export type VariantLike = {
    direction_key?: string;
    direction_name?: string;
    stops?: VariantStopLike[];
};

export type RouteEndpointPair = {
    origin: string | null;
    destination: string | null;
};

export type ResolvedRouteEndpoints = {
    origin_my: string | null;
    destination_my: string | null;
    origin_en: string | null;
    destination_en: string | null;
};

export type RouteNameIssueCode =
    | "public_missing_display_code"
    | "public_missing_arrow"
    | "en_missing_display_code"
    | "en_multiple_arrows"
    | "origin_dest_contains_arrow"
    | "broken_numeric_romanization"
    | "missing_my_primary"
    | "missing_en_primary"
    | "missing_und_alias"
    | "en_contains_myanmar_script"
    | "und_alias_mismatch";

export type RouteNameRepairConfidence = "high" | "medium" | "needs_manual_review";

export function buildDisplayCodeFromRouteCode(routeCode: string | null | undefined): string | null {
    if (!routeCode?.trim()) {
        return null;
    }

    const trimmed = routeCode.trim().toUpperCase();
    if (YBS_ROUTE_CODE_PATTERN.test(trimmed)) {
        const routeNumber = parseRouteNumberFromCode(trimmed);
        if (routeNumber === null) {
            return null;
        }
        return buildYbsDisplayCode(routeNumber, routeCodeSuffix(trimmed));
    }

    return trimmed;
}

export function buildPrimaryRouteDisplayName(
    displayCode: string,
    origin: string,
    destination: string,
): string {
    return `${displayCode} · ${origin} ↔ ${destination}`;
}

export function countMainArrows(text: string | null | undefined): number {
    if (!text?.trim()) {
        return 0;
    }
    return (text.match(/↔/g) ?? []).length;
}

export function containsBrokenNumericRomanization(text: string | null | undefined): boolean {
    if (!text?.trim()) {
        return false;
    }

    if (countMainArrows(text) > 1) {
        return true;
    }

    return BROKEN_ROMANIZATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function stripLeadingRouteNumberPrefix(text: string | null | undefined): string | null {
    if (!text?.trim()) {
        return null;
    }
    const stripped = text.trim().replace(MYANMAR_ROUTE_NUMBER_PREFIX_PATTERN, "").trim();
    return stripped || text.trim();
}

/**
 * Parse route endpoints using only main separators (↔ or spaced hyphen/dash).
 * Does not split on bare hyphens inside romanized syllable groups.
 */
export function parseRouteEndpointsSafe(title: string | null | undefined): RouteEndpointPair {
    const normalized = normalizePublicRouteTitle(title);
    if (!normalized) {
        return { origin: null, destination: null };
    }

    if (normalized.includes("↔")) {
        const parts = normalized
            .split(/\s*↔\s*/u)
            .map((part) => part.trim())
            .filter(Boolean);
        if (parts.length >= 2) {
            return {
                origin: parts[0] ?? null,
                destination: parts.slice(1).join(" ↔ ") || null,
            };
        }
    }

    const spacedDashMatch = normalized.match(/^(.+?)\s+-\s+(.+)$/u);
    if (spacedDashMatch) {
        return {
            origin: spacedDashMatch[1]?.trim() ?? null,
            destination: spacedDashMatch[2]?.trim() ?? null,
        };
    }

    const spacedEnDashMatch = normalized.match(/^(.+?)\s+[–—]\s+(.+)$/u);
    if (spacedEnDashMatch) {
        return {
            origin: spacedEnDashMatch[1]?.trim() ?? null,
            destination: spacedEnDashMatch[2]?.trim() ?? null,
        };
    }

    return { origin: normalized, destination: null };
}

function findVariant(variants: VariantLike[], direction: "outbound" | "inbound"): VariantLike | undefined {
    return variants.find(
        (variant) => variant.direction_key === direction || variant.direction_name === direction,
    );
}

function firstStopField(stops: VariantStopLike[], field: "stop_name_my" | "stop_name_en"): string | null {
    for (const stop of stops) {
        const value = stop[field]?.trim();
        if (value) {
            return value;
        }
    }
    return null;
}

function lastStopField(stops: VariantStopLike[], field: "stop_name_my" | "stop_name_en"): string | null {
    for (let index = stops.length - 1; index >= 0; index--) {
        const value = stops[index]?.[field]?.trim();
        if (value) {
            return value;
        }
    }
    return null;
}

function isWeakMyanmarRouteTitle(title: string | null | undefined): boolean {
    const stripped = stripLeadingRouteNumberPrefix(title);
    if (!stripped?.trim()) {
        return true;
    }
    return /^\([၀-၉\d]+\)\s*ကွေ့$/u.test(stripped.trim());
}

function resolvePreferredVariantDirection(input: {
    route_code?: string | null;
    route_title_my?: string | null;
}): "outbound" | "inbound" {
    const routeCode = input.route_code?.trim().toUpperCase() ?? "";
    if (routeCode === "APS" || routeCode.startsWith("TRIAL-")) {
        return "inbound";
    }
    if (isWeakMyanmarRouteTitle(input.route_title_my)) {
        return "inbound";
    }
    return "outbound";
}

export function resolveVariantEndpointStops(
    variants: VariantLike[],
    preferredDirection: "outbound" | "inbound" = "outbound",
): {
    origin_my: string | null;
    destination_my: string | null;
    origin_en: string | null;
    destination_en: string | null;
} {
    const outbound = findVariant(variants, "outbound");
    const inbound = findVariant(variants, "inbound");
    const primary = preferredDirection === "inbound" ? inbound : outbound;
    const secondary = preferredDirection === "inbound" ? outbound : inbound;
    const primaryStops = primary?.stops ?? [];
    const secondaryStops = secondary?.stops ?? [];

    let origin_my = firstStopField(primaryStops, "stop_name_my");
    let destination_my = lastStopField(primaryStops, "stop_name_my");
    let origin_en = firstStopField(primaryStops, "stop_name_en");
    let destination_en = lastStopField(primaryStops, "stop_name_en");

    if ((!origin_my || !destination_my) && secondaryStops.length > 0) {
        if (!origin_my) {
            origin_my = lastStopField(secondaryStops, "stop_name_my");
        }
        if (!destination_my) {
            destination_my = firstStopField(secondaryStops, "stop_name_my");
        }
    }

    if ((!origin_en || !destination_en) && secondaryStops.length > 0) {
        if (!origin_en) {
            origin_en = lastStopField(secondaryStops, "stop_name_en");
        }
        if (!destination_en) {
            destination_en = firstStopField(secondaryStops, "stop_name_en");
        }
    }

    return { origin_my, destination_my, origin_en, destination_en };
}

export function normalizeMyanmarEndpointPhrase(text: string | null | undefined): string | null {
    if (!text?.trim()) {
        return null;
    }

    const trimmed = stripLeadingRouteNumberPrefix(text) ?? text.trim();
    for (const rule of ENDPOINT_PHRASE_RULES) {
        if (rule.myanmar?.test(trimmed) && rule.normalized_my) {
            return rule.normalized_my;
        }
    }

    return trimmed;
}

export function normalizeEnglishEndpointPhrase(
    text: string | null | undefined,
    myanmarHint?: string | null,
): string | null {
    if (!text?.trim() && !myanmarHint?.trim()) {
        return null;
    }

    const candidates = [myanmarHint, text].filter(Boolean) as string[];
    for (const candidate of candidates) {
        for (const rule of ENDPOINT_PHRASE_RULES) {
            if (rule.myanmar?.test(candidate)) {
                return rule.normalized_en;
            }
            if (rule.english?.test(candidate)) {
                return rule.normalized_en;
            }
        }
    }

    const trimmed = text?.trim() ?? null;
    if (!trimmed) {
        return null;
    }

    if (containsBrokenNumericRomanization(trimmed)) {
        return null;
    }

    return trimmed.replace(/\s*\/\s*/g, " / ");
}

export function resolveRouteEndpoints(input: {
    route_code?: string | null;
    route_title_my?: string | null;
    route_title_en?: string | null;
    route_name_en?: string | null;
    variants?: VariantLike[];
}): ResolvedRouteEndpoints {
    const titleMyEndpoints = parseRouteEndpointsSafe(input.route_title_my);
    const titleEnEndpoints = parseRouteEndpointsSafe(
        input.route_title_en ?? input.route_name_en ?? null,
    );
    const variantDirection = resolvePreferredVariantDirection(input);
    const variantStops = resolveVariantEndpointStops(input.variants ?? [], variantDirection);
    const useVariantMy =
        isWeakMyanmarRouteTitle(input.route_title_my) ||
        input.route_code?.trim().toUpperCase() === "APS" ||
        input.route_code?.trim().toUpperCase().startsWith("TRIAL-");

    const origin_my_raw = useVariantMy
        ? (variantStops.origin_my ??
          stripLeadingRouteNumberPrefix(titleMyEndpoints.origin) ??
          titleMyEndpoints.origin)
        : (stripLeadingRouteNumberPrefix(titleMyEndpoints.origin) ??
          titleMyEndpoints.origin ??
          variantStops.origin_my);
    const destination_my_raw = useVariantMy
        ? (variantStops.destination_my ?? titleMyEndpoints.destination)
        : (titleMyEndpoints.destination ?? variantStops.destination_my);

    const useVariantEn =
        input.route_code?.trim().toUpperCase() === "APS" ||
        input.route_code?.trim().toUpperCase().startsWith("TRIAL-");

    const origin_en_raw = useVariantEn
        ? (variantStops.origin_en ?? titleEnEndpoints.origin ?? input.route_name_en ?? null)
        : (titleEnEndpoints.origin ?? variantStops.origin_en ?? input.route_name_en ?? null);
    const destination_en_raw = useVariantEn
        ? (variantStops.destination_en ?? titleEnEndpoints.destination)
        : (titleEnEndpoints.destination ?? variantStops.destination_en);

    const origin_my = normalizeMyanmarEndpointPhrase(origin_my_raw) ?? origin_my_raw;
    const destination_my =
        normalizeMyanmarEndpointPhrase(destination_my_raw) ?? destination_my_raw;

    const origin_en =
        normalizeEnglishEndpointPhrase(origin_en_raw, origin_my_raw ?? variantStops.origin_my) ??
        normalizeEnglishEndpointPhrase(variantStops.origin_en, variantStops.origin_my) ??
        origin_en_raw;
    const destination_en =
        normalizeEnglishEndpointPhrase(
            destination_en_raw,
            destination_my_raw ?? variantStops.destination_my,
        ) ??
        normalizeEnglishEndpointPhrase(variantStops.destination_en, variantStops.destination_my) ??
        destination_en_raw;

    return {
        origin_my: origin_my ?? null,
        destination_my: destination_my ?? null,
        origin_en: origin_en ?? null,
        destination_en: destination_en ?? null,
    };
}

export function hasDisplayCodePrefix(name: string | null | undefined, displayCode: string): boolean {
    if (!name?.trim() || !displayCode) {
        return false;
    }
    return name.startsWith(`${displayCode} · `);
}

export function containsMyanmarScript(text: string | null | undefined): boolean {
    if (!text?.trim()) {
        return false;
    }
    const myanmar = (text.match(new RegExp(MYANMAR_CHAR_PATTERN.source, "g")) ?? []).length;
    const latin = (text.match(new RegExp(LATIN_CHAR_PATTERN.source, "g")) ?? []).length;
    return myanmar > 0 && latin === 0;
}

export function detectRouteNameIssues(input: {
    route_code: string;
    display_code: string;
    public_name?: string | null;
    origin_name?: string | null;
    destination_name?: string | null;
    primary_name_my?: string | null;
    primary_name_en?: string | null;
    alias_und?: string | null;
}): RouteNameIssueCode[] {
    const issues: RouteNameIssueCode[] = [];

    if (!input.primary_name_my) {
        issues.push("missing_my_primary");
    }
    if (!input.primary_name_en) {
        issues.push("missing_en_primary");
    }
    if (!input.alias_und) {
        issues.push("missing_und_alias");
    } else if (input.alias_und !== input.route_code) {
        issues.push("und_alias_mismatch");
    }

    if (input.public_name && !hasDisplayCodePrefix(input.public_name, input.display_code)) {
        issues.push("public_missing_display_code");
    }
    if (input.public_name && !input.public_name.includes(" ↔ ")) {
        issues.push("public_missing_arrow");
    }

    if (input.primary_name_en) {
        if (!hasDisplayCodePrefix(input.primary_name_en, input.display_code)) {
            issues.push("en_missing_display_code");
        }
        if (countMainArrows(input.primary_name_en) > 1) {
            issues.push("en_multiple_arrows");
        }
        if (containsMyanmarScript(input.primary_name_en)) {
            issues.push("en_contains_myanmar_script");
        }
        if (containsBrokenNumericRomanization(input.primary_name_en)) {
            issues.push("broken_numeric_romanization");
        }
    }

    if (
        countMainArrows(input.origin_name) > 0 ||
        countMainArrows(input.destination_name) > 0
    ) {
        issues.push("origin_dest_contains_arrow");
    }

    if (
        containsBrokenNumericRomanization(input.origin_name) ||
        containsBrokenNumericRomanization(input.destination_name)
    ) {
        issues.push("broken_numeric_romanization");
    }

    return [...new Set(issues)];
}

export function scoreRouteNameRepairConfidence(input: {
    route_code: string;
    issues: RouteNameIssueCode[];
    endpoints: ResolvedRouteEndpoints;
    is_trial_route: boolean;
}): RouteNameRepairConfidence {
    const { endpoints, issues, is_trial_route } = input;

    if (!endpoints.origin_my || !endpoints.destination_my || !endpoints.origin_en || !endpoints.destination_en) {
        return "needs_manual_review";
    }

    if (is_trial_route) {
        return "medium";
    }

    const hardIssues = issues.filter((issue) =>
        ["missing_my_primary", "missing_en_primary", "missing_und_alias", "en_contains_myanmar_script"].includes(
            issue,
        ),
    );
    if (hardIssues.length > 0) {
        return "needs_manual_review";
    }

    if (
        issues.includes("broken_numeric_romanization") ||
        issues.includes("en_multiple_arrows") ||
        issues.includes("origin_dest_contains_arrow") ||
        issues.includes("public_missing_display_code") ||
        issues.includes("en_missing_display_code")
    ) {
        return "high";
    }

    return "medium";
}

export function buildResolvedRouteNames(input: {
    route_code: string;
    route_title_my?: string | null;
    route_title_en?: string | null;
    route_name_en?: string | null;
    variants?: VariantLike[];
}): {
    display_code: string | null;
    public_name: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    alias_und: string | null;
    origin_my: string | null;
    destination_my: string | null;
    origin_en: string | null;
    destination_en: string | null;
} {
    const displayCode = buildDisplayCodeFromRouteCode(input.route_code);
    const endpoints = resolveRouteEndpoints({
        route_code: input.route_code,
        route_title_my: input.route_title_my,
        route_title_en: input.route_title_en,
        route_name_en: input.route_name_en,
        variants: input.variants,
    });

    if (!displayCode || !endpoints.origin_my || !endpoints.destination_my) {
        return {
            display_code: displayCode,
            public_name: null,
            primary_name_my: null,
            primary_name_en: null,
            alias_und: input.route_code,
            ...endpoints,
        };
    }

    const primary_name_my = buildPrimaryRouteDisplayName(
        displayCode,
        endpoints.origin_my,
        endpoints.destination_my,
    );

    const primary_name_en =
        endpoints.origin_en && endpoints.destination_en
            ? buildPrimaryRouteDisplayName(displayCode, endpoints.origin_en, endpoints.destination_en)
            : null;

    return {
        display_code: displayCode,
        public_name: primary_name_my,
        primary_name_my,
        primary_name_en,
        alias_und: input.route_code,
        ...endpoints,
    };
}

export function isTrialRouteCode(routeCode: string): boolean {
    return routeCode.startsWith("TRIAL-");
}

export function isNamedRouteCode(routeCode: string): boolean {
    return !YBS_ROUTE_CODE_PATTERN.test(routeCode);
}

export function collectRouteNameQualityWarnings(input: {
    route_code: string;
    public_name?: string | null;
    origin_name?: string | null;
    destination_name?: string | null;
    route_names: Array<{
        language_code: string;
        name_type: string;
        is_primary: boolean;
        name: string;
    }>;
}): string[] {
    const displayCode = buildDisplayCodeFromRouteCode(input.route_code) ?? input.route_code;
    const primaryEn = input.route_names.find((row) => row.language_code === "en" && row.is_primary);
    const aliasUnd = input.route_names.find(
        (row) => row.language_code === "und" && row.name_type === "alias",
    );

    const issues = detectRouteNameIssues({
        route_code: input.route_code,
        display_code: displayCode,
        public_name: input.public_name,
        origin_name: input.origin_name,
        destination_name: input.destination_name,
        primary_name_my: input.route_names.find((row) => row.language_code === "my" && row.is_primary)?.name,
        primary_name_en: primaryEn?.name ?? null,
        alias_und: aliasUnd?.name ?? null,
    });

    const warnings: string[] = [];
    const issueMessages: Record<RouteNameIssueCode, string> = {
        public_missing_display_code: "public_name is missing display code prefix.",
        public_missing_arrow: "public_name is missing main ↔ separator.",
        en_missing_display_code: "en primary route_name is missing display code prefix.",
        en_multiple_arrows: "en primary route_name has more than one ↔ separator.",
        origin_dest_contains_arrow: "origin_name or destination_name contains ↔.",
        broken_numeric_romanization:
            "Broken numeric romanization detected (e.g. Shit-sae, Sae-Thone, Chauk-sae-ngar).",
        missing_my_primary: "Missing my primary route_name.",
        missing_en_primary: "Missing en primary route_name.",
        missing_und_alias: "Missing und alias route_name.",
        en_contains_myanmar_script: "en primary route_name contains Myanmar script.",
        und_alias_mismatch: `und alias must equal route_code (${input.route_code}).`,
    };

    for (const issue of issues) {
        const message = issueMessages[issue];
        if (message) {
            warnings.push(message);
        }
    }

    return warnings;
}
