import type { ImportReviewGeoJson } from "@/src/lib/api";

export function strOrNull(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed || null;
}

export function boolOrNull(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

export function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function geometryOrNull(value: unknown): ImportReviewGeoJson | null {
    if (!value || typeof value !== "object" || !("type" in value)) {
        return null;
    }
    return value as ImportReviewGeoJson;
}
