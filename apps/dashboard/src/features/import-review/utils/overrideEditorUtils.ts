import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import { filterOverridePatchForFamily } from "../config/overrideAllowlist";
import { normPick } from "./entityPageUtils";
import {
    deriveImportedClassCode,
    readEffectiveAdminLevelId,
    readEffectiveClassCode,
    readEffectiveParentAdminAreaId,
} from "./importReviewClassificationFields";
import type { DashboardEssentialFieldRule } from "../config/essentialFields";
import {
    hasStoredNameEnOverride,
    hasStoredNameMmOverride,
    toNameSourceRow,
} from "./importReviewNameFields";

export function typedColumnFields(fields: unknown): Record<string, unknown> {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        return fields as Record<string, unknown>;
    }
    return {};
}

function readAdminAreaImportedId(row: ImportReviewBuildingListItem): string {
    const rawId =
        row.admin_area_id ??
        row.effective_admin_area_id ??
        row.matched_admin_area_id;
    if (rawId === null || rawId === undefined) {
        return "";
    }
    return String(rawId).trim();
}

function readBuildingTypeImportedId(row: ImportReviewBuildingListItem): string {
    const fromColumn = row.building_type_id?.trim();
    if (fromColumn) {
        return fromColumn;
    }
    const fromNorm = normPick(row.normalized_data, "building_type_id");
    if (fromNorm !== null && fromNorm !== undefined) {
        return String(fromNorm).trim();
    }
    return "";
}

function readRoadClassImportedId(row: ImportReviewBuildingListItem): string {
    const rowRecord = row as Record<string, unknown>;
    const fromColumn = typeof rowRecord.road_class_id === "string" ? rowRecord.road_class_id.trim() : "";
    const fromCandidate = row.road_candidate_road_class_id?.trim() ?? "";
    const merged = fromColumn || fromCandidate;
    if (merged) {
        return merged;
    }
    const fromNorm = normPick(row.normalized_data, "road_class_id");
    if (fromNorm !== null && fromNorm !== undefined) {
        return String(fromNorm).trim();
    }
    return "";
}

function readLanduseClassImportedId(row: ImportReviewBuildingListItem): string {
    const fromColumn = row.landuse_class_id?.trim();
    if (fromColumn) {
        return fromColumn;
    }
    const fromEffective = row.effective_landuse_class_id?.trim();
    if (fromEffective) {
        return fromEffective;
    }
    const fromNorm = normPick(row.normalized_data, "landuse_class_id");
    if (fromNorm !== null && fromNorm !== undefined) {
        return String(fromNorm).trim();
    }
    return "";
}

export function readImportedValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): string {
    if (def.configKey === "building_type_id") {
        return readBuildingTypeImportedId(row);
    }
    if (def.patchKey === "landuse_class_id") {
        return readLanduseClassImportedId(row);
    }
    if (def.patchKey === "road_class_id") {
        return readRoadClassImportedId(row);
    }
    if (def.patchKey === "category_id") {
        const fromColumn = (row as Record<string, unknown>).category_id;
        if (fromColumn !== null && fromColumn !== undefined && String(fromColumn).trim()) {
            return String(fromColumn).trim();
        }
        const fromNorm =
            normPick(row.normalized_data, "category_id") ??
            normPick(row.normalized_data, "poi_category_id");
        if (fromNorm !== null && fromNorm !== undefined) {
            return String(fromNorm).trim();
        }
        return "";
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
    if (def.patchKey === "barrier_type") {
        const barrierTyped = (row as Record<string, unknown>).barrier_type;
        if (barrierTyped !== null && barrierTyped !== undefined && String(barrierTyped).trim()) {
            return String(barrierTyped).trim();
        }
        const effective = row.effective_barrier_type?.trim();
        if (effective) {
            return effective;
        }
        const fromNorm = normPick(row.normalized_data, "barrier_type");
        if (fromNorm !== null && fromNorm !== undefined && String(fromNorm).trim()) {
            return String(fromNorm).trim();
        }
        return deriveImportedClassCode(row, "routing_barriers") ?? "";
    }
    if (def.patchKey === "name_mm" || def.patchKey === "name_en") {
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

/** Current typed column value for the edit form (not effective / fields merge). */
export function readColumnDraftValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): string {
    if (def.patchKey === "name_mm") {
        return row.name_mm?.trim() ?? "";
    }
    if (def.patchKey === "name_en") {
        return row.name_en?.trim() ?? "";
    }
    if (def.configKey === "building_type_id") {
        return row.building_type_id?.trim() ?? "";
    }
    if (def.patchKey === "landuse_class_id") {
        return row.landuse_class_id?.trim() ?? "";
    }
    if (def.patchKey === "road_class_id") {
        const rawRoad = (row as Record<string, unknown>).road_class_id;
        if (rawRoad !== null && rawRoad !== undefined && String(rawRoad).trim()) {
            return String(rawRoad).trim();
        }
        return row.road_candidate_road_class_id?.trim() ?? "";
    }
    if (def.patchKey === "category_id") {
        const rawCategory = (row as Record<string, unknown>).category_id;
        if (rawCategory !== null && rawCategory !== undefined && String(rawCategory).trim()) {
            return String(rawCategory).trim();
        }
        return "";
    }
    if (def.type === "admin_area" || def.patchKey === "admin_area_id") {
        const raw = row.admin_area_id;
        if (raw === null || raw === undefined) {
            return "";
        }
        return String(raw).trim();
    }
    if (def.patchKey === "parent_id") {
        const raw = (row as Record<string, unknown>).parent_id;
        if (raw === null || raw === undefined) {
            return "";
        }
        return String(raw).trim();
    }
    if (def.patchKey === "admin_level_id") {
        const raw = (row as Record<string, unknown>).admin_level_id;
        if (raw === null || raw === undefined) {
            return "";
        }
        return String(raw).trim();
    }
    if (def.patchKey === "class_code" && apiFamily) {
        return row.class_code?.trim() ?? "";
    }
    if (def.patchKey === "barrier_type") {
        const rawBarrier = (row as Record<string, unknown>).barrier_type;
        if (rawBarrier !== null && rawBarrier !== undefined && String(rawBarrier).trim()) {
            return String(rawBarrier).trim();
        }
        return "";
    }
    const key = def.importedKey ?? def.configKey;
    const raw = (row as Record<string, unknown>)[key];
    if (raw === null || raw === undefined) {
        return "";
    }
    if (typeof raw === "boolean") {
        return raw ? "true" : "false";
    }
    return String(raw).trim();
}

export function columnValuePresent(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): boolean {
    return readColumnDraftValue(row, def, apiFamily).trim() !== "";
}

export function readOverrideDraftValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): string {
    const ov = typedColumnFields(row);
    const source = toNameSourceRow(row);

    if (def.patchKey === "name_mm" || def.patchKey === "name_en") {
        return readColumnDraftValue(row, def, apiFamily);
    }

    if (def.patchKey === "class_code" && apiFamily) {
        return readEffectiveClassCode(row, apiFamily);
    }
    if (def.patchKey === "landuse_class_id") {
        const ov = typedColumnFields(row);
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

/**
 * Draft input value: typed column first (naming contract).
 * Name fields do not prefill from source — use getImportReviewSourceImportedName() for helper text.
 */
export function readDirectEditDraftValue(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily?: string
): string {
    const column = readColumnDraftValue(row, def, apiFamily);
    if (column.trim() !== "") {
        return column;
    }
    return readImportedValue(row, def, apiFamily);
}

export function isDirectEditPrefilledFromSource(
    row: ImportReviewBuildingListItem,
    def: ImportReviewOverrideFieldDef,
    apiFamily: string | undefined,
    draftValue: string
): boolean {
    if (readColumnDraftValue(row, def, apiFamily).trim() !== "") {
        return false;
    }
    const imported = readImportedValue(row, def, apiFamily);
    return imported.trim() !== "" && draftValue.trim() === imported.trim();
}

export type DirectEditFormState = {
    form: Record<string, string>;
    prefilledFromSourceKeys: Set<string>;
};

export function buildInitialDirectEditForm(
    row: ImportReviewBuildingListItem,
    defs: ImportReviewOverrideFieldDef[],
    apiFamily?: string
): DirectEditFormState {
    const form: Record<string, string> = {};
    const prefilledFromSourceKeys = new Set<string>();
    for (const def of defs) {
        const draft = readDirectEditDraftValue(row, def, apiFamily);
        form[def.configKey] = draft;
        if (isDirectEditPrefilledFromSource(row, def, apiFamily, draft)) {
            prefilledFromSourceKeys.add(def.configKey);
        }
    }
    return { form, prefilledFromSourceKeys };
}

export function buildInitialOverrideForm(
    row: ImportReviewBuildingListItem,
    defs: ImportReviewOverrideFieldDef[],
    apiFamily?: string
): Record<string, string> {
    return buildInitialDirectEditForm(row, defs, apiFamily).form;
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

export type ColumnPatchBuildResult = {
    patch: Record<string, unknown>;
    /** Patch keys the reviewer changed (excludes essential-field auto-fill). */
    changedPatchKeys: Set<string>;
};

/** Build PATCH `fields` body: only changed typed columns; null clears a stored column value. */
export function buildColumnPatch(args: {
    defs: ImportReviewOverrideFieldDef[];
    form: Record<string, string>;
    row: ImportReviewBuildingListItem;
    clearedKeys: Set<string>;
    userEditedConfigKeys?: Set<string>;
    apiFamily: string;
}): ColumnPatchBuildResult {
    const patch: Record<string, unknown> = {};
    const changedPatchKeys = new Set<string>();
    const seenPatchKeys = new Set<string>();

    for (const def of args.defs) {
        if (seenPatchKeys.has(def.patchKey)) {
            continue;
        }
        seenPatchKeys.add(def.patchKey);

        const configKey = def.configKey;
        const patchKey = def.patchKey;
        const current = args.form[configKey] ?? "";
        const columnValue = readColumnDraftValue(args.row, def, args.apiFamily);
        const hadColumn = columnValuePresent(args.row, def, args.apiFamily);
        const cleared = args.clearedKeys.has(configKey);
        const userEdited = args.userEditedConfigKeys?.has(configKey) ?? false;

        if (cleared) {
            if (hadColumn) {
                patch[patchKey] = null;
                changedPatchKeys.add(patchKey);
            }
            continue;
        }

        if (current.trim() === "") {
            continue;
        }

        const isReferenceId =
            def.type === "admin_area" ||
            def.patchKey === "admin_area_id" ||
            def.patchKey === "parent_id" ||
            (def.type === "select" && Boolean(def.refSource));

        const importedValue = readImportedValue(args.row, def, args.apiFamily).trim();
        const unchangedTyped = hadColumn && current === columnValue;
        if (unchangedTyped && !userEdited) {
            continue;
        }

        const prefilledOnly =
            isReferenceId &&
            !userEdited &&
            !hadColumn &&
            current.trim() !== "" &&
            current.trim() === importedValue;

        if (prefilledOnly || (unchangedTyped && userEdited && isReferenceId)) {
            continue;
        }

        const parsed = parseFieldValue(def, current);
        if (parsed === undefined) {
            continue;
        }

        patch[patchKey] = parsed;
        changedPatchKeys.add(patchKey);
    }

    const filtered = filterOverridePatchForFamily(args.apiFamily, patch);
    includeEssentialCurrentValues(args.apiFamily, args.defs, args.form, filtered);
    return { patch: filtered, changedPatchKeys };
}

/** @deprecated Use {@link buildColumnPatch} for dashboard candidate edits. */
export function buildOverridePatch(args: {
    defs: ImportReviewOverrideFieldDef[];
    form: Record<string, string>;
    row: ImportReviewBuildingListItem;
    clearedKeys: Set<string>;
    userEditedConfigKeys?: Set<string>;
    apiFamily: string;
}): Record<string, unknown> {
    return buildColumnPatch(args).patch;
}

export function validateOverrideForm(
    defs: ImportReviewOverrideFieldDef[],
    form: Record<string, string>,
    apiFamily?: string
): string | null {
    try {
        for (const def of defs) {
            parseFieldValue(def, form[def.configKey] ?? "");
        }
        if (apiFamily) {
            const rules = essentialRulesForApiFamily(apiFamily);
            for (const rule of rules) {
                if (rule.kind === "geometry") {
                    continue;
                }
                if (rule.kind === "field") {
                    const value = form[rule.key] ?? "";
                    if (value.trim() === "") {
                        return `${rule.key} is required.`;
                    }
                }
                if (rule.kind === "at_least_one") {
                    const hasAny = rule.keys.some((key) => (form[key] ?? "").trim() !== "");
                    if (!hasAny) {
                        return `At least one of ${rule.keys.join(" / ")} is required.`;
                    }
                }
            }
        }
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : "Invalid field values";
    }
}

function includeEssentialCurrentValues(
    apiFamily: string,
    defs: ImportReviewOverrideFieldDef[],
    form: Record<string, string>,
    patch: Record<string, unknown>
): void {
    const defByPatchKey = new Map(defs.map((def) => [def.patchKey, def]));
    const rules = essentialRulesForApiFamily(apiFamily);
    for (const rule of rules) {
        if (rule.kind === "geometry") {
            continue;
        }
        if (rule.kind === "field") {
            const def = defByPatchKey.get(rule.key);
            if (!def || Object.prototype.hasOwnProperty.call(patch, def.patchKey)) {
                continue;
            }
            const raw = form[def.configKey] ?? "";
            if (raw.trim() !== "") {
                const parsed = parseFieldValue(def, raw);
                if (parsed !== undefined) {
                    patch[def.patchKey] = parsed;
                }
            }
        }
        if (rule.kind === "at_least_one") {
            const anyAlready = rule.keys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
            if (anyAlready) {
                continue;
            }
            for (const key of rule.keys) {
                const def = defByPatchKey.get(key);
                if (!def) {
                    continue;
                }
                const raw = form[def.configKey] ?? "";
                if (raw.trim() === "") {
                    continue;
                }
                const parsed = parseFieldValue(def, raw);
                if (parsed !== undefined) {
                    patch[def.patchKey] = parsed;
                    break;
                }
            }
        }
    }
}

function essentialRulesForApiFamily(apiFamily: string): readonly DashboardEssentialFieldRule[] {
    switch (apiFamily) {
        case "buildings":
            return [
                { kind: "field", key: "building_type_id" },
                { kind: "field", key: "admin_area_id" },
                { kind: "geometry" },
            ];
        case "places":
            return [
                { kind: "at_least_one", keys: ["name_mm", "name_en"] },
                { kind: "field", key: "category_id" },
                { kind: "field", key: "admin_area_id" },
                { kind: "geometry" },
            ];
        case "roads":
            return [
                { kind: "field", key: "road_class_id" },
                { kind: "field", key: "admin_area_id" },
                { kind: "geometry" },
            ];
        case "landuse":
            return [{ kind: "field", key: "landuse_class_id" }, { kind: "geometry" }];
        case "water_lines":
            return [{ kind: "field", key: "class_code" }, { kind: "geometry" }];
        case "water_polygons":
            return [{ kind: "field", key: "class_code" }, { kind: "geometry" }];
        default:
            return [];
    }
}
