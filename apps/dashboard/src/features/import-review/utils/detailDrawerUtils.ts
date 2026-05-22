import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewEntityConfig } from "../config/types";

export function safeJson(value: unknown): string {
    if (value === null || value === undefined) {
        return "null";
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export function jsonishSignalsPresent(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (typeof value === "object") {
        return Object.keys(value as object).length > 0;
    }
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    return true;
}

function rowFieldValue(row: ImportReviewBuildingListItem, key: string): string | null {
    const raw = (row as Record<string, unknown>)[key];
    if (raw === null || raw === undefined) {
        return null;
    }
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
}

export function resolveDrawerTitle(
    row: ImportReviewBuildingListItem,
    config: Pick<ImportReviewEntityConfig, "detailTitleField" | "label">
): string {
    const effectiveNameEn = rowFieldValue(row, "effective_name_en");
    const effectiveNameMm = rowFieldValue(row, "effective_name_mm");
    const effectiveName = rowFieldValue(row, "effective_name");
    const effectiveCanonical = rowFieldValue(row, "effective_canonical_name");
    const primary = config.detailTitleField ? rowFieldValue(row, config.detailTitleField) : null;
    return (
        effectiveNameEn ??
        effectiveNameMm ??
        effectiveName ??
        effectiveCanonical ??
        primary ??
        `${config.label} ${row.id}`
    );
}

export function resolveDrawerSubtitle(
    row: ImportReviewBuildingListItem,
    config: Pick<ImportReviewEntityConfig, "detailSubtitleField">
): string | null {
    if (config.detailSubtitleField) {
        return rowFieldValue(row, config.detailSubtitleField);
    }
    return rowFieldValue(row, "external_id");
}

export function isImportReviewDetailNotFound(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    const m = err.message.toLowerCase();
    return m.includes("404") || m.includes("not found");
}
