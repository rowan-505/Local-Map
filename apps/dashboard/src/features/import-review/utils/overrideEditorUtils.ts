import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import { formatBuildingTypeLabel, normPick } from "./entityPageUtils";

export function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

export function readImportedValue(row: ImportReviewBuildingListItem, def: ImportReviewOverrideFieldDef): string {
    if (def.configKey === "building_type_id") {
        const effective = formatBuildingTypeLabel(row);
        if (effective) {
            return effective;
        }
        if (row.building_type_id) {
            return row.building_type_id;
        }
        return "";
    }
    const key = def.importedKey ?? def.configKey;
    if (def.importedFrom === "normalized") {
        const v = normPick(row.normalized_data, key);
        if (v === null || v === undefined) {
            return "";
        }
        return String(v);
    }
    const raw = (row as Record<string, unknown>)[key];
    if (raw === null || raw === undefined) {
        return "";
    }
    return String(raw);
}

export function readOverrideDraftValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef
): string {
    const ov = asOverrideRecord(row.review_overrides);
    if (def.patchKey in ov) {
        const v = ov[def.patchKey];
        if (v === null || v === undefined) {
            return "";
        }
        if (typeof v === "boolean") {
            return v ? "true" : "false";
        }
        return String(v);
    }
    return readImportedValue(row, def);
}

export function buildInitialOverrideForm(
    row: ImportReviewBuildingListItem,
    defs: ImportReviewOverrideFieldDef[]
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const def of defs) {
        out[def.configKey] = readOverrideDraftValue(row, def);
    }
    return out;
}

function parseFieldValue(def: ImportReviewOverrideFieldDef, raw: string): unknown | undefined {
    const trimmed = raw.trim();
    if (def.type === "boolean") {
        if (trimmed === "") {
            return undefined;
        }
        return trimmed === "true" || trimmed === "1" || trimmed.toLowerCase() === "yes";
    }
    if (def.type === "number") {
        if (trimmed === "") {
            return undefined;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n)) {
            return trimmed;
        }
        if (def.min !== undefined && n < def.min) {
            throw new Error(`${def.label} must be at least ${def.min}`);
        }
        if (def.max !== undefined && n > def.max) {
            throw new Error(`${def.label} must be at most ${def.max}`);
        }
        return n;
    }
    if (trimmed === "") {
        return undefined;
    }
    return trimmed;
}

export function buildOverridePatch(args: {
    defs: ImportReviewOverrideFieldDef[];
    form: Record<string, string>;
    baseline: Record<string, string>;
    clearedKeys: Set<string>;
}): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const def of args.defs) {
        const current = args.form[def.configKey] ?? "";
        const base = args.baseline[def.configKey] ?? "";
        const cleared = args.clearedKeys.has(def.configKey);
        if (!cleared && current === base) {
            continue;
        }
        if (cleared) {
            patch[def.patchKey] = null;
            continue;
        }
        const parsed = parseFieldValue(def, current);
        if (parsed === undefined) {
            continue;
        }
        patch[def.patchKey] = parsed;
    }
    return patch;
}

export function validateOverrideForm(
    defs: ImportReviewOverrideFieldDef[],
    form: Record<string, string>
): string | null {
    try {
        for (const def of defs) {
            if (def.type === "number" || def.type === "boolean") {
                parseFieldValue(def, form[def.configKey] ?? "");
            }
        }
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : "Invalid override values";
    }
}
