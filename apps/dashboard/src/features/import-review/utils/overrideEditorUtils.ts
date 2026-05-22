import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import { filterOverridePatchForFamily } from "../config/overrideAllowlist";
import { formatBuildingTypeLabel, normPick } from "./entityPageUtils";
import {
    deriveImportedClassCode,
    readEffectiveAdminLevelId,
    readEffectiveClassCode,
    readEffectiveParentAdminAreaId,
} from "./importReviewClassificationFields";
import {
    deriveImportedNameEn,
    deriveImportedNameMm,
    hasStoredNameEnOverride,
    hasStoredNameMmOverride,
    readOverrideNameEn,
    readOverrideNameMm,
    toNameSourceRow,
} from "./importReviewNameFields";

export function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function readAdminAreaImportedId(row: ImportReviewBuildingListItem): string {
    const rawId = row.effective_admin_area_id ?? row.admin_area_id;
    if (rawId === null || rawId === undefined) {
        return "";
    }
    return String(rawId).trim();
}

function readImportedNameValue(row: ImportReviewBuildingListItem, patchKey: string): string {
    const source = toNameSourceRow(row);
    if (patchKey === "name_mm") {
        return deriveImportedNameMm(source) ?? "";
    }
    if (patchKey === "name_en") {
        return deriveImportedNameEn(source) ?? "";
    }
    return "";
}

export function readImportedValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): string {
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
    if (def.patchKey === "landuse_class_id") {
        return row.landuse_class_id ?? row.effective_landuse_class_id ?? "";
    }
    if (def.type === "admin_area" || def.patchKey === "admin_area_id") {
        return readAdminAreaImportedId(row);
    }
    if (def.patchKey === "parent_id") {
        return readEffectiveParentAdminAreaId(row);
    }
    if (def.patchKey === "admin_level_id") {
        return readEffectiveAdminLevelId(row);
    }
    if (def.patchKey === "class_code" && apiFamily) {
        return deriveImportedClassCode(row, apiFamily) ?? "";
    }
    if (def.patchKey === "name_mm" || def.patchKey === "name_en") {
        return readImportedNameValue(row, def.patchKey);
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

function formatOverrideValue(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    return String(value);
}

function hadStoredOverride(
    stored: Record<string, unknown>,
    def: ImportReviewOverrideFieldDef
): boolean {
    if (def.patchKey === "name_mm") {
        return hasStoredNameMmOverride(stored);
    }
    if (def.patchKey === "name_en") {
        return hasStoredNameEnOverride(stored);
    }
    return Object.prototype.hasOwnProperty.call(stored, def.patchKey);
}

export function readOverrideDraftValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): string {
    const ov = asOverrideRecord(row.review_overrides);
    const source = toNameSourceRow(row);

    if (def.patchKey === "name_mm") {
        if (Object.prototype.hasOwnProperty.call(ov, "name_mm")) {
            return readOverrideNameMm(ov, source);
        }
        return row.effective_name_mm ?? readOverrideNameMm(ov, source);
    }
    if (def.patchKey === "name_en") {
        if (Object.prototype.hasOwnProperty.call(ov, "name_en")) {
            return readOverrideNameEn(ov, source);
        }
        return row.effective_name_en ?? readOverrideNameEn(ov, source);
    }

    if (def.patchKey === "class_code" && apiFamily) {
        return readEffectiveClassCode(row, apiFamily);
    }
    if (def.patchKey === "landuse_class_id") {
        const ov = asOverrideRecord(row.review_overrides);
        if (Object.prototype.hasOwnProperty.call(ov, "landuse_class_id")) {
            return formatOverrideValue(ov.landuse_class_id);
        }
        return row.landuse_class_id ?? row.effective_landuse_class_id ?? "";
    }
    if (def.patchKey === "admin_level_id") {
        return readEffectiveAdminLevelId(row);
    }
    if (def.patchKey === "parent_id") {
        return readEffectiveParentAdminAreaId(row);
    }

    if (def.patchKey in ov) {
        return formatOverrideValue(ov[def.patchKey]);
    }
    return readImportedValue(row, def, apiFamily);
}

export function buildInitialOverrideForm(
    row: ImportReviewBuildingListItem,
    defs: ImportReviewOverrideFieldDef[],
    apiFamily?: string
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const def of defs) {
        out[def.configKey] = readOverrideDraftValue(row, def, apiFamily);
    }
    return out;
}

function parseNumericId(raw: string): number | string {
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (Number.isSafeInteger(n) && n > 0) {
        return n;
    }
    return trimmed;
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
            throw new Error(`${def.label} must be a number`);
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
    if (def.type === "admin_area" || def.patchKey === "admin_area_id" || def.patchKey === "parent_id") {
        if (!/^\d+$/.test(trimmed)) {
            throw new Error(`${def.label} must be selected from the admin area list (numeric id).`);
        }
        return parseNumericId(trimmed);
    }
    if (def.type === "select" && def.refSource) {
        if (!/^\d+$/.test(trimmed)) {
            throw new Error(`${def.label} must be selected from the reference list (numeric id).`);
        }
        return parseNumericId(trimmed);
    }
    return trimmed;
}

function finalizeOverridePatch(
    stored: Record<string, unknown>,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const storedKeys = Object.keys(stored);
    if (storedKeys.length === 0) {
        return patch;
    }
    const clearingAll =
        storedKeys.every((key) => patch[key] === null) &&
        Object.values(patch).every((value) => value === null);
    if (clearingAll) {
        return {};
    }
    return patch;
}

/** Build PATCH body leaf: only allowed primitive override keys; null removes a stored override key. */
export function buildOverridePatch(args: {
    defs: ImportReviewOverrideFieldDef[];
    form: Record<string, string>;
    row: ImportReviewBuildingListItem;
    clearedKeys: Set<string>;
    apiFamily: string;
}): Record<string, unknown> {
    const stored = asOverrideRecord(args.row.review_overrides);
    const patch: Record<string, unknown> = {};
    const seenPatchKeys = new Set<string>();

    for (const def of args.defs) {
        if (seenPatchKeys.has(def.patchKey)) {
            continue;
        }
        seenPatchKeys.add(def.patchKey);

        const configKey = def.configKey;
        const patchKey = def.patchKey;
        const current = args.form[configKey] ?? "";
        const imported = readImportedValue(args.row, def, args.apiFamily);
        const hadStored = hadStoredOverride(stored, def);
        const cleared = args.clearedKeys.has(configKey);

        if (cleared) {
            if (hadStored) {
                patch[patchKey] = null;
            }
            continue;
        }

        if (current.trim() === "" && hadStored) {
            patch[patchKey] = null;
            continue;
        }

        if (current === imported && !hadStored) {
            continue;
        }

        const parsed = parseFieldValue(def, current);
        if (parsed === undefined) {
            continue;
        }

        const parsedText = String(parsed);
        if (parsedText === imported && hadStored) {
            patch[patchKey] = null;
            continue;
        }

        patch[patchKey] = parsed;
    }

    return filterOverridePatchForFamily(args.apiFamily, finalizeOverridePatch(stored, patch));
}

export function validateOverrideForm(
    defs: ImportReviewOverrideFieldDef[],
    form: Record<string, string>
): string | null {
    try {
        for (const def of defs) {
            parseFieldValue(def, form[def.configKey] ?? "");
        }
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : "Invalid override values";
    }
}
