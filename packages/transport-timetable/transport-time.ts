/** Display placeholder for missing transport clock times. */
export const TRANSPORT_TIME_EMPTY_DISPLAY = "—";

const SOURCE_TIME_12H_PATTERN = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const CANONICAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MINUTES_PER_DAY = 24 * 60;

export type CanonicalTimeCalculation = {
    /** UI clock label such as "05:26 AM". */
    readonly displayTime: string;
    /** Whole-day offset from the anchor day (negative when seconds move before midnight). */
    readonly dayOffset: number;
    /** Canonical HH:mm on the display day after wrapping. */
    readonly canonical: string;
};

function canonicalToMinutes(canonical: string): number {
    const [hours, minutes] = canonical.split(":").map(Number);
    return hours! * 60 + minutes!;
}

function minutesToCanonical(totalMinutes: number): string {
    const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours = Math.floor(wrapped / 60);
    const minutes = wrapped % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function minutesToDisplay(totalMinutes: number): string {
    const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours24 = Math.floor(wrapped / 60);
    const minutes = wrapped % 60;
    const isPm = hours24 >= 12;
    const hours12 = hours24 % 12 || 12;
    return `${String(hours12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${isPm ? "PM" : "AM"}`;
}

/**
 * Parses imported 12-hour source clock text to canonical HH:mm storage format.
 * Rejects malformed values; never guesses.
 */
export function parseSourceTimeToCanonical(source: string): string | null {
    const trimmed = source.trim();
    if (!trimmed) {
        return null;
    }

    const match = trimmed.match(SOURCE_TIME_12H_PATTERN);
    if (!match) {
        return null;
    }

    const hours12 = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3]!.toUpperCase();
    if (
        !Number.isFinite(hours12) ||
        !Number.isFinite(minutes) ||
        hours12 < 1 ||
        hours12 > 12 ||
        minutes > 59
    ) {
        return null;
    }

    let hours24 = hours12 % 12;
    if (meridiem === "PM") {
        hours24 += 12;
    }

    return minutesToCanonical(hours24 * 60 + minutes);
}

/** True only for strict canonical HH:mm values from 00:00 through 23:59. */
export function validateCanonicalTime(value: string): boolean {
    const trimmed = value.trim();
    if (!CANONICAL_TIME_PATTERN.test(trimmed)) {
        return false;
    }
    const [hours, minutes] = trimmed.split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) && hours! <= 23 && minutes! <= 59;
}

/** Formats canonical HH:mm for UI display; null and invalid values become —. */
export function formatCanonicalTimeForDisplay(value: string | null | undefined): string {
    if (value === null || value === undefined) {
        return TRANSPORT_TIME_EMPTY_DISPLAY;
    }
    const trimmed = value.trim();
    if (!trimmed || !validateCanonicalTime(trimmed)) {
        return TRANSPORT_TIME_EMPTY_DISPLAY;
    }
    return minutesToDisplay(canonicalToMinutes(trimmed));
}

/**
 * Adds seconds to a canonical anchor time.
 * Supports midnight crossing via dayOffset.
 */
export function addSecondsToCanonicalTime(
    anchor: string,
    seconds: number,
): CanonicalTimeCalculation | null {
    const trimmed = anchor.trim();
    if (!validateCanonicalTime(trimmed) || !Number.isFinite(seconds)) {
        return null;
    }

    const baseMinutes = canonicalToMinutes(trimmed);
    const totalMinutes = baseMinutes + Math.round(seconds / 60);
    const dayOffset = Math.trunc(totalMinutes / MINUTES_PER_DAY);
    const wrappedMinutes =
        ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const canonical = minutesToCanonical(wrappedMinutes);

    return {
        displayTime: minutesToDisplay(wrappedMinutes),
        dayOffset,
        canonical,
    };
}

/**
 * Resolves canonical storage time or imported 12-hour source text to HH:mm.
 * Used by timetable offset math and user-input normalization.
 */
export function resolveTimeAnchorToCanonical(anchor: string): string | null {
    const trimmed = anchor.trim();
    if (!trimmed) {
        return null;
    }
    if (validateCanonicalTime(trimmed)) {
        return trimmed;
    }
    return parseSourceTimeToCanonical(trimmed);
}

/** Normalizes user input or source text to canonical HH:mm when parseable. */
export function parseTimeInputToCanonical(text: string): string | null {
    return resolveTimeAnchorToCanonical(text);
}

/** True when text is canonical HH:mm or a valid 12-hour source value. */
export function isValidTransportTimeInput(text: string): boolean {
    return resolveTimeAnchorToCanonical(text) !== null;
}

/**
 * Returns the editable variant departure anchor when stored as strict canonical HH:mm.
 * Does not fall back to imported route_stop source_time_text.
 */
export function resolveVariantDepartureAnchor(
    departureTimeText: string | null | undefined,
): string | null {
    const trimmed = departureTimeText?.trim();
    if (!trimmed || !validateCanonicalTime(trimmed)) {
        return null;
    }
    return trimmed;
}

/** True when normalized_data.departure_time_text is stored as a canonical editable anchor. */
export function hasExplicitVariantDepartureTime(
    departureTimeText: string | null | undefined,
): boolean {
    return resolveVariantDepartureAnchor(departureTimeText) !== null;
}
