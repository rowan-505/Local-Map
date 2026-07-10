import { trimName } from "./derive-display-name.js";

const MYANMAR_SCRIPT_RE = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

export function looksMyanmarTransportName(text: string): boolean {
    return MYANMAR_SCRIPT_RE.test(text);
}

export function looksLatinTransportName(text: string): boolean {
    return LATIN_LETTER_RE.test(text);
}

/**
 * Fills missing `name_mm` / `name_en` from `name_und` and canonical cache when the
 * source text clearly belongs to that script. Does not invent names — only reuses
 * existing stored values so display fallback can prefer Myanmar before English
 * transliteration.
 */
export function enrichTransportStopPrimaryNames(args: {
    name_mm: string | null | undefined;
    name_en: string | null | undefined;
    name_und: string | null | undefined;
    canonical_name: string | null | undefined;
}): { name_mm: string | null; name_en: string | null } {
    let name_mm = trimName(args.name_mm);
    let name_en = trimName(args.name_en);
    const name_und = trimName(args.name_und);
    const canonical_name = trimName(args.canonical_name);

    if (name_mm === null && name_und !== null && looksMyanmarTransportName(name_und)) {
        name_mm = name_und;
    }
    if (
        name_en === null &&
        name_und !== null &&
        looksLatinTransportName(name_und) &&
        !looksMyanmarTransportName(name_und)
    ) {
        name_en = name_und;
    }

    if (name_mm === null && canonical_name !== null && looksMyanmarTransportName(canonical_name)) {
        name_mm = canonical_name;
    }
    if (
        name_en === null &&
        canonical_name !== null &&
        looksLatinTransportName(canonical_name) &&
        !looksMyanmarTransportName(canonical_name)
    ) {
        name_en = canonical_name;
    }

    return { name_mm, name_en };
}
