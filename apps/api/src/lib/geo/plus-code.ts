import { encode } from "pluscodes";

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
