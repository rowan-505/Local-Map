/**
 * Station name normalization for train stop matching.
 */

export type ParsedTrainTitle = {
    train_number: string | null;
    direction_text: string | null;
};

const MYANMAR_DIGITS: Record<string, string> = {
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

const LATIN_TO_MYANMAR_DIGIT: Record<string, string> = {
    "0": "၀",
    "1": "၁",
    "2": "၂",
    "3": "၃",
    "4": "၄",
    "5": "၅",
    "6": "၆",
    "7": "၇",
    "8": "၈",
    "9": "၉",
};

/** Matches "141 (Up)", "၈၃ (အဆန်)", "Za-1 (Up)". */
const COMBINED_TRAIN_TITLE_RE =
    /^([၀-၉\dA-Za-z]+(?:-[၀-၉\dA-Za-z]+)?)\s*\(([^)]+)\)$/;

/** Plain train number tokens including urban codes like Za-1. */
const TRAIN_NUMBER_TOKEN_RE = /^(?:[၀-၉\d]{1,4}|[A-Za-z]{1,6}-[၀-၉\d]{1,4})$/;

const EN_STATION_SUFFIX_RE = /\brailway\s+station\b/gi;
const MY_STATION_SUFFIX_RE = /ဘူတာကြီး|ဘူတာ/g;

export function normalizeDigits(value: string): string {
    return value
        .split("")
        .map((char) => MYANMAR_DIGITS[char] ?? char)
        .join("");
}

/** Convert ASCII digits in a token to Myanmar numerals; leave letters and punctuation unchanged. */
export function latinDigitsToMyanmar(value: string): string {
    return value
        .split("")
        .map((char) => LATIN_TO_MYANMAR_DIGIT[char] ?? char)
        .join("");
}

/** Short Myanmar place label for route display names (drops ဘူတာ / ဘူတာကြီး). */
export function formatMyanmarPlaceNameForDisplay(value: string): string {
    return normalizeExactKey(value.replace(MY_STATION_SUFFIX_RE, " "));
}

export function parseCombinedTrainTitle(text: string): ParsedTrainTitle | null {
    const match = text.trim().match(COMBINED_TRAIN_TITLE_RE);
    if (!match?.[1] || !match[2]) {
        return null;
    }

    return {
        train_number: normalizeDigits(match[1]),
        direction_text: match[2].trim(),
    };
}

export function parseTrainNumberToken(text: string): string | null {
    const trimmed = text.trim();
    const combined = parseCombinedTrainTitle(trimmed);
    if (combined?.train_number) {
        return combined.train_number;
    }
    if (TRAIN_NUMBER_TOKEN_RE.test(trimmed)) {
        return normalizeDigits(trimmed);
    }
    return null;
}

export function trimToNull(value: string | null | undefined): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeExactKey(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

export function normalizeExactEnglishKey(value: string): string {
    return normalizeExactKey(value).toLowerCase();
}

export function normalizeExactMyanmarKey(value: string): string {
    return normalizeExactKey(value);
}

/** English: drop "Railway Station", punctuation, extra spaces. */
export function normalizeEnglishStationName(value: string): string {
    return normalizeExactKey(
        value
            .replace(EN_STATION_SUFFIX_RE, " ")
            .replace(/[^a-z0-9\s]/gi, " ")
            .replace(/\s+/g, " "),
    ).toLowerCase();
}

/** Myanmar: drop "ဘူတာ", "ဘူတာကြီး", punctuation, extra spaces. */
export function normalizeMyanmarStationName(value: string): string {
    return normalizeExactKey(
        value
            .replace(MY_STATION_SUFFIX_RE, " ")
            .replace(/[^\u1000-\u109F0-9\s]/g, " ")
            .replace(/\s+/g, " "),
    );
}

export function normalizedEnglishKey(value: string): string {
    const normalized = normalizeEnglishStationName(value);
    return normalized.length > 0 ? normalized : normalizeExactEnglishKey(value);
}

export function normalizedMyanmarKey(value: string): string {
    const normalized = normalizeMyanmarStationName(value);
    return normalized.length > 0 ? normalized : normalizeExactMyanmarKey(value);
}
