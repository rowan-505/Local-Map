/**
 * Import-review naming helpers — see docs/import-review/naming-contract.md.
 *
 * Typed direct-edit columns (`name_mm`, `name_en`) win over source/legacy names
 * in all dashboard display paths below.
 */

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewEntityConfig } from "../config/types";
import type { ImportReviewTableColumn } from "../config/types";
import { normPick } from "./entityPageUtils";

/** List table columns for bilingual candidate families (typed columns only). */
const IMPORT_REVIEW_NAME_TABLE_COLUMNS: readonly ImportReviewTableColumn[] = [
    { key: "name_mm", label: "Myanmar name", source: "row" },
    { key: "name_en", label: "English name", source: "row" },
] as const;

export type ImportReviewTypedNameKey = "name_mm" | "name_en";

function trimField(row: ImportReviewBuildingListItem, key: string): string | null {
    const raw = (row as Record<string, unknown>)[key];
    if (raw === null || raw === undefined) {
        return null;
    }
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
}

/** Typed reviewer column only — no source, canonical, or effective fallback. */
export function getImportReviewTypedName(
    row: ImportReviewBuildingListItem,
    key: ImportReviewTypedNameKey
): string | null {
    return trimField(row, key);
}

function normTagName(row: ImportReviewBuildingListItem): string | null {
    const tags = normPick(row.normalized_data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        const name = (tags as Record<string, unknown>).name;
        if (name !== null && name !== undefined) {
            const s = String(name).trim();
            if (s.length > 0) {
                return s;
            }
        }
    }
    return null;
}

/**
 * Read-only imported/source label for helper text (naming contract §6).
 * Not used for list cells or form input values.
 */
export function getImportReviewSourceImportedName(row: ImportReviewBuildingListItem): string | null {
    return (
        normTagName(row) ??
        trimField(row, "primary_name") ??
        trimField(row, "display_name") ??
        trimField(row, "canonical_name") ??
        null
    );
}

/**
 * Primary display label for list/detail title (naming contract title priority).
 */
export function getImportReviewDisplayName(
    row: ImportReviewBuildingListItem,
    config?: Pick<ImportReviewEntityConfig, "label">
): string {
    return (
        getImportReviewTypedName(row, "name_mm") ??
        getImportReviewTypedName(row, "name_en") ??
        trimField(row, "canonical_name") ??
        trimField(row, "display_name") ??
        trimField(row, "primary_name") ??
        normTagName(row) ??
        trimField(row, "external_id") ??
        `${config?.label ?? "Candidate"} ${row.id}`
    );
}

/** Table column definitions for Myanmar / English typed name columns. */
export function getImportReviewNameColumns(): readonly ImportReviewTableColumn[] {
    return IMPORT_REVIEW_NAME_TABLE_COLUMNS;
}

export function isImportReviewNameTableColumn(key: string): key is ImportReviewTypedNameKey {
    return key === "name_mm" || key === "name_en";
}

/**
 * Renders a typed name list cell: value or em dash (naming contract list rules).
 */
export function formatCandidateName(
    row: ImportReviewBuildingListItem,
    key: ImportReviewTypedNameKey
): string {
    const value = getImportReviewTypedName(row, key);
    return value ?? "—";
}

/** Alias used by table renderers — same as {@link formatCandidateName}. */
export function renderImportReviewNameTableCell(
    row: ImportReviewBuildingListItem,
    key: ImportReviewTypedNameKey
): string {
    return formatCandidateName(row, key);
}

/** @deprecated Use {@link getImportReviewDisplayName} — see docs/import-review/naming-contract.md */
export const resolveImportReviewDisplayTitle = getImportReviewDisplayName;

/** @deprecated Use {@link getImportReviewSourceImportedName} */
export const resolveImportReviewSourceImportedName = getImportReviewSourceImportedName;

/** @deprecated Use {@link getImportReviewTypedName} */
export const readTypedNameColumn = getImportReviewTypedName;

/** @deprecated Use {@link formatCandidateName} */
export const formatTypedNameTableCell = formatCandidateName;
