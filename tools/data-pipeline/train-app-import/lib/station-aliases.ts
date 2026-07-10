/**
 * Known spelling variants between yrsmm names and transport.stops names.
 * Keys are normalized English keys (lowercase, no "railway station").
 */

import {
    normalizedEnglishKey,
    normalizedMyanmarKey,
    trimToNull,
} from "./text-normalize.js";

/** English normalized key → preferred DB English/Myanmar search tokens. */
export const TRAIN_STATION_ALIASES_EN: Record<string, string[]> = {
    "toe kyaung ka lay": ["togyaunggalay", "toe kyaung ga lay", "toegyaunggalay"],
    "toungoo": ["taungoo", "taung ngu"],
    "nay pyi taw": ["naypyitaw", "nay pyi taw", "naypyidaw"],
    "mingalardon": ["mingaladon"],
    "mingalardonzay": ["mingaladon zay", "mingaladon market"],
    "puzundaung": ["pazundaung"],
    "nyaung lay pin": ["nyaunglebin", "nyaung le bin"],
    "yae ni": ["ye ni", "yeni"],
    "swar": ["swar", "sua"],
    "yamethin": ["yamethin"],
    "myittha": ["myittha"],
    "ahlone": ["ahlone"],
    "aung san": ["aung san"],
    "pann hlaing": ["pan hlaing", "pannhlaing"],
    "gok teik": ["gokteik", "goteik"],
    "lewe": ["lewe"],
    "sat thwar": ["satthwar", "sat thwar"],
    "taungdwingyi": ["taungdwingyi", "taungdwingyi"],
};

/** Myanmar normalized key → alternate Myanmar tokens. */
export const TRAIN_STATION_ALIASES_MY: Record<string, string[]> = {
    တိုးကြောင်ကလေး: ["တိုးကြောင်းကလေး", "တိုးကြောင်ကလေး"],
    တောင်ငူ: ["တောင်ငူ"],
    နေပြည်တော်: ["နေပြည်တော်"],
};

export function englishAliasKeys(stationNameEn: string | null | undefined): string[] {
    const trimmed = trimToNull(stationNameEn);
    if (!trimmed) {
        return [];
    }
    const primary = normalizedEnglishKey(trimmed);
    const aliases = TRAIN_STATION_ALIASES_EN[primary] ?? [];
    return [primary, ...aliases.map((alias) => normalizedEnglishKey(alias))];
}

export function myanmarAliasKeys(stationNameMy: string | null | undefined): string[] {
    const trimmed = trimToNull(stationNameMy);
    if (!trimmed) {
        return [];
    }
    const primary = normalizedMyanmarKey(trimmed);
    const aliases = TRAIN_STATION_ALIASES_MY[primary] ?? [];
    return [primary, ...aliases.map((alias) => normalizedMyanmarKey(alias))];
}

/** Stable shared key for one physical station across routes. */
export function sharedStationKey(
    stationNameEn: string | null | undefined,
    stationNameMy: string | null | undefined,
): string {
    const en = trimToNull(stationNameEn);
    const my = trimToNull(stationNameMy);
    if (en) {
        return `en:${normalizedEnglishKey(en)}`;
    }
    if (my) {
        return `my:${normalizedMyanmarKey(my)}`;
    }
    return "unknown";
}
