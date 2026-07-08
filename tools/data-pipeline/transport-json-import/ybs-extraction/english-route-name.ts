/**
 * English route name helpers for YBS Phase 4 extraction.
 *
 * Do not AI-translate Myanmar titles. Build English names from variant endpoints.
 */

const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;
const LATIN_CHAR_PATTERN = /[A-Za-z]/;

export type EnglishRouteNameSource =
    | "generated_from_english_variant_endpoints"
    | "missing_english_endpoints";

export type EnglishRouteNameResult = {
    route_name_en: string | null;
    route_name_en_source: EnglishRouteNameSource;
    route_name_en_confidence: number;
    needs_route_name_review: boolean;
};

export type EnglishRouteNameStop = {
    stop_name_en?: string | null;
};

export type EnglishRouteNameVariant = {
    direction_key?: string;
    direction_name?: string;
    stops?: EnglishRouteNameStop[];
};

/** True when text is Myanmar-only (not usable as route_name_en). */
export function isMyanmarText(text: string | null | undefined): boolean {
    if (!text?.trim()) {
        return false;
    }

    const myanmar = (text.match(new RegExp(MYANMAR_CHAR_PATTERN.source, "g")) ?? []).length;
    const latin = (text.match(new RegExp(LATIN_CHAR_PATTERN.source, "g")) ?? []).length;

    return myanmar > 0 && latin === 0;
}

/** Keep the visible English-screen detail title for audit, even when Myanmar. */
export function resolveEnglishDetailTitleRaw(
    detailTitle: string | null | undefined,
): string | null {
    const trimmed = detailTitle?.trim();
    return trimmed || null;
}

function firstEnglishStopName(stops: EnglishRouteNameStop[]): string | null {
    for (const stop of stops) {
        const name = stop.stop_name_en?.trim();
        if (name) {
            return name;
        }
    }

    return null;
}

function lastEnglishStopName(stops: EnglishRouteNameStop[]): string | null {
    for (let index = stops.length - 1; index >= 0; index--) {
        const name = stops[index].stop_name_en?.trim();
        if (name) {
            return name;
        }
    }

    return null;
}

function findVariant(
    variants: EnglishRouteNameVariant[],
    direction: "outbound" | "inbound",
): EnglishRouteNameVariant | undefined {
    return variants.find(
        (variant) => variant.direction_key === direction || variant.direction_name === direction,
    );
}

/**
 * Generate route_name_en from English variant endpoint stop names.
 *
 * Primary: outbound first + last stop_name_en.
 * Fallback: inbound last + first stop_name_en (reversed direction).
 */
export function generateEnglishRouteNameFromVariants(
    variants: EnglishRouteNameVariant[],
): EnglishRouteNameResult {
    const outbound = findVariant(variants, "outbound");
    const inbound = findVariant(variants, "inbound");
    const outboundStops = outbound?.stops ?? [];
    const inboundStops = inbound?.stops ?? [];

    let first = firstEnglishStopName(outboundStops);
    let last = lastEnglishStopName(outboundStops);

    if ((!first || !last) && inboundStops.length > 0) {
        const inboundFirst = firstEnglishStopName(inboundStops);
        const inboundLast = lastEnglishStopName(inboundStops);

        if (!first && inboundLast) {
            first = inboundLast;
        }
        if (!last && inboundFirst) {
            last = inboundFirst;
        }
    }

    if (first && last) {
        return {
            route_name_en: `${first} - ${last}`,
            route_name_en_source: "generated_from_english_variant_endpoints",
            route_name_en_confidence: 80,
            needs_route_name_review: false,
        };
    }

    return {
        route_name_en: null,
        route_name_en_source: "missing_english_endpoints",
        route_name_en_confidence: 0,
        needs_route_name_review: true,
    };
}

/**
 * Build English route name fields for one extraction or merge output.
 */
export function buildEnglishRouteNameFields(input: {
    variants: EnglishRouteNameVariant[];
    detailTitleRaw?: string | null;
}): EnglishRouteNameResult & {
    route_detail_title_en_raw: string | null;
} {
    const generated = generateEnglishRouteNameFromVariants(input.variants);
    const route_detail_title_en_raw = resolveEnglishDetailTitleRaw(input.detailTitleRaw);

    return {
        ...generated,
        route_detail_title_en_raw,
    };
}
