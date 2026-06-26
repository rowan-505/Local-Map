import { decode, encode, expand } from "pluscodes";

/**
 * Generate a full Open Location Code (Plus Code) from coordinates.
 *
 * Computed on demand only — never stored. Returns null for out-of-range or
 * non-finite input so callers can omit the field instead of surfacing a bad code.
 */
export function generatePlusCode(lat: number, lng: number): string | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }

    const code = encode({ latitude: lat, longitude: lng });
    return code && code.length > 0 ? code : null;
}

/** Open Location Code digit alphabet (excludes the '+' separator and '0' padding). */
const OLC_DIGITS = "23456789CFGHJMPQRVWX";
const OLC_DIGIT_RE = new RegExp(`^[${OLC_DIGITS}]+$`);
const OLC_HEAD_RE = new RegExp(`^[${OLC_DIGITS}0]+$`);

/** Typed reasons returned when a Plus Code cannot be resolved to coordinates. */
export type PlusCodeResolutionReason = "REFERENCE_REQUIRED" | "INVALID_PLUS_CODE";

export type PlusCodeReference = { lat: number; lng: number };

export type DecodedPlusCode = {
    lat: number;
    lng: number;
    latitudeResolution?: number;
    longitudeResolution?: number;
    normalizedCode: string;
};

export type PlusCodeResolution =
    | (DecodedPlusCode & { ok: true; wasShort: boolean })
    | { ok: false; reason: PlusCodeResolutionReason; normalizedCode: string };

/**
 * Normalize raw user input: trim, remove all whitespace, uppercase.
 * Pure string transform — does not validate. Safe for any input.
 */
export function normalizePlusCodeInput(input: string): string {
    if (typeof input !== "string") return "";
    return input.replace(/\s+/g, "").trim().toUpperCase();
}

/**
 * Structural check: does the input look like an Open Location Code (full or short)?
 * Lenient gate before the authoritative decode()/expand() calls. Never throws.
 */
export function isLikelyPlusCode(input: string): boolean {
    const normalized = normalizePlusCodeInput(input);
    const plusIndex = normalized.indexOf("+");
    if (plusIndex < 0) return false;

    const head = normalized.slice(0, plusIndex);
    const tail = normalized.slice(plusIndex + 1);

    // Head: 2-8 OLC digits, optionally padded with trailing '0' (area codes).
    if (head.length < 2 || head.length > 8) return false;
    if (!OLC_HEAD_RE.test(head)) return false;

    // Tail: 0-7 OLC digits (no padding).
    if (tail.length > 7) return false;
    if (tail.length > 0 && !OLC_DIGIT_RE.test(tail)) return false;

    return true;
}

/**
 * Structural check: does the input look like a SHORT Plus Code (needs a reference)?
 * Short codes drop leading pairs, so the head is < 8 digits and never padded.
 */
export function isLikelyShortPlusCode(input: string): boolean {
    if (!isLikelyPlusCode(input)) return false;

    const normalized = normalizePlusCodeInput(input);
    const head = normalized.slice(0, normalized.indexOf("+"));

    // Padding '0' only appears in full area codes, never in short codes.
    if (head.includes("0")) return false;
    return head.length < 8;
}

/**
 * Decode a FULL Plus Code to coordinates. Returns null for invalid input or for
 * short codes (which require a reference — use expand/decodeOrExpand instead).
 * Uses decode() returning null as the source of truth for validity.
 */
export function decodePlusCode(input: string): DecodedPlusCode | null {
    const normalizedCode = normalizePlusCodeInput(input);
    if (normalizedCode.length === 0) return null;
    // Short codes are not directly decodable without a reference location.
    if (isLikelyShortPlusCode(normalizedCode)) return null;

    const decoded = decode(normalizedCode);
    if (!decoded) return null;

    return {
        lat: decoded.latitude,
        lng: decoded.longitude,
        latitudeResolution: decoded.latitudeResolution,
        longitudeResolution: decoded.longitudeResolution,
        normalizedCode,
    };
}

/**
 * Expand a short Plus Code to a full code using a reference location.
 * Returns null for invalid input or a non-finite/out-of-range reference.
 */
export function expandPlusCode(input: string, ref: PlusCodeReference): string | null {
    const normalizedCode = normalizePlusCodeInput(input);
    if (normalizedCode.length === 0) return null;
    if (!isValidReference(ref)) return null;

    const full = expand(normalizedCode, { latitude: ref.lat, longitude: ref.lng });
    return full && full.length > 0 ? normalizePlusCodeInput(full) : null;
}

/**
 * Resolve any Plus Code input to coordinates.
 *
 * - Full codes decode directly (reference ignored).
 * - Short codes require a valid reference; without one returns
 *   { ok: false, reason: "REFERENCE_REQUIRED" }.
 * - Anything unparseable returns { ok: false, reason: "INVALID_PLUS_CODE" }.
 *
 * Never throws for invalid user input.
 */
export function decodeOrExpandPlusCode(
    input: string,
    ref?: PlusCodeReference,
): PlusCodeResolution {
    const normalizedCode = normalizePlusCodeInput(input);

    if (!isLikelyPlusCode(normalizedCode)) {
        return { ok: false, reason: "INVALID_PLUS_CODE", normalizedCode };
    }

    if (isLikelyShortPlusCode(normalizedCode)) {
        if (!ref || !isValidReference(ref)) {
            return { ok: false, reason: "REFERENCE_REQUIRED", normalizedCode };
        }

        const full = expandPlusCode(normalizedCode, ref);
        const decoded = full ? decodePlusCode(full) : null;
        if (!decoded) {
            return { ok: false, reason: "INVALID_PLUS_CODE", normalizedCode };
        }

        return { ok: true, wasShort: true, ...decoded };
    }

    const decoded = decodePlusCode(normalizedCode);
    if (!decoded) {
        return { ok: false, reason: "INVALID_PLUS_CODE", normalizedCode };
    }

    return { ok: true, wasShort: false, ...decoded };
}

function isValidReference(ref: PlusCodeReference | undefined): ref is PlusCodeReference {
    if (!ref) return false;
    if (!Number.isFinite(ref.lat) || !Number.isFinite(ref.lng)) return false;
    return ref.lat >= -90 && ref.lat <= 90 && ref.lng >= -180 && ref.lng <= 180;
}
