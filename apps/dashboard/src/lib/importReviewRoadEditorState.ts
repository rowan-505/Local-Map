import type { StreetGeometry, StreetLineStringGeoJson } from "@/src/lib/api";
import { normalizeLineStringForEditor } from "@/src/features/streets/normalizeStreetLineString";
import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import {
    resolveImportReviewRoadClassValue,
    type ImportReviewRoadClassOptionInput,
} from "@/src/features/import-review/utils/importReviewRoadClassResolver";
import {
    seedRoadEditorNameEn,
    seedRoadEditorNameMm,
    toNameSourceRow,
} from "@/src/features/import-review/utils/importReviewNameFields";

export function typedColumnFields(fields: unknown): Record<string, unknown> {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        return fields as Record<string, unknown>;
    }
    return {};
}

export function strFromUnknown(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    return "";
}

function normPick(data: unknown, key: string): unknown {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

/** @deprecated Use {@link resolveImportReviewRoadClassValue} */
export function pickImportedRoadClassCode(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[] = [],
): string {
    const resolved = resolveImportReviewRoadClassValue(row, roadClassOptions);
    return resolved.roadClassCode ?? resolved.displayLabel ?? "";
}

function surfaceFromNormalized(data: unknown): string {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        const s = (tags as Record<string, unknown>).surface;
        if (typeof s === "string" && s.trim()) {
            return s.trim();
        }
    }
    const direct = normPick(data, "surface");
    if (typeof direct === "string" && direct.trim()) {
        return direct.trim();
    }
    return "";
}

function boolFromUnknown(value: unknown): boolean | null {
    if (value === true || value === "true" || value === 1 || value === "1") {
        return true;
    }
    if (value === false || value === "false" || value === 0 || value === "0") {
        return false;
    }
    return null;
}

export type ImportReviewRoadEditorSeed = {
    nameMm: string;
    nameEn: string;
    roadClassId: string;
    roadClassCode: string | null;
    isOneway: boolean;
    surface: string;
    bridge: boolean;
    tunnel: boolean;
    layer: string;
    access: string;
    speedKph: string;
    line: StreetLineStringGeoJson | null;
    multiLineWarning: string | null;
    geometryLoadNotice: string | null;
    overridesReviewNote: string;
    adminAreaId: string | null;
    roadClassResolutionSource: string | null;
};

export function roadEditorSeedFromRow(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[],
): ImportReviewRoadEditorSeed {
    const ov = typedColumnFields(row);
    const nd = row.normalized_data;
    const nameSource = toNameSourceRow(row);

    const nameMm =
        row.name_mm?.trim() ||
        seedRoadEditorNameMm(row, ov, nameSource);
    const nameEn =
        row.name_en?.trim() ||
        seedRoadEditorNameEn(row, ov, nameSource);

    const resolvedClass = resolveImportReviewRoadClassValue(row, roadClassOptions);

    let isOneway: boolean | null =
        row.road_candidate_is_oneway !== null && row.road_candidate_is_oneway !== undefined
            ? row.road_candidate_is_oneway
            : boolFromUnknown(ov.is_oneway);
    if (isOneway === null) {
        isOneway = boolFromUnknown(normPick(nd, "is_oneway")) ?? false;
    }

    let surface = row.road_candidate_surface?.trim() ?? "";
    if (!surface) {
        surface = strFromUnknown(ov.surface).trim();
    }
    if (!surface) {
        surface = surfaceFromNormalized(nd);
    }

    const bridge =
        boolFromUnknown(ov.bridge) ??
        boolFromUnknown(normPick(nd, "bridge")) ??
        false;
    const tunnel =
        boolFromUnknown(ov.tunnel) ??
        boolFromUnknown(normPick(nd, "tunnel")) ??
        false;
    const layer =
        strFromUnknown(ov.layer).trim() ||
        strFromUnknown(normPick(nd, "layer")).trim();
    const access =
        strFromUnknown(ov.access).trim() ||
        strFromUnknown(normPick(nd, "access")).trim();
    const speedKph =
        strFromUnknown(ov.speed_kph).trim() ||
        strFromUnknown(normPick(nd, "speed_kph")).trim();

    const ovGeom = ov.geom;
    const geomSource: StreetGeometry | null =
        (row.geometry as StreetGeometry | null) ??
        (ovGeom && typeof ovGeom === "object" && !Array.isArray(ovGeom) && "type" in ovGeom
            ? (ovGeom as StreetGeometry)
            : null);

    const norm = normalizeLineStringForEditor(geomSource);
    const geometryLoadNotice =
        norm.unsupportedReason ??
        (norm.parseError ? norm.parseError : null);

    const adminFromColumn =
        row.admin_area_id !== null && row.admin_area_id !== undefined
            ? String(row.admin_area_id).trim()
            : "";
    const adminFromOverride = strFromUnknown(ov.admin_area_id).trim();
    const adminAreaId =
        adminFromColumn ||
        adminFromOverride ||
        (row.effective_admin_area_id ? String(row.effective_admin_area_id).trim() : "") ||
        null;

    return {
        nameMm,
        nameEn,
        roadClassId: resolvedClass.roadClassId ?? "",
        roadClassCode: resolvedClass.roadClassCode,
        adminAreaId: adminAreaId || null,
        isOneway,
        surface,
        bridge,
        tunnel,
        layer,
        access,
        speedKph,
        line: norm.line,
        multiLineWarning: norm.multiLineWarning ?? null,
        geometryLoadNotice,
        overridesReviewNote: (row.review_note ?? "").trim() || strFromUnknown(ov.review_note).trim(),
        roadClassResolutionSource: resolvedClass.resolutionSource,
    };
}

/** Parse bullets from {@link getErrorMessage} formatting (✗ / ⚠ prefixes). */
export function parseValidationBulletsFromApiErrorMessage(message: string): {
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const line of message.split("\n")) {
        const t = line.trim();
        if (t.startsWith("✗ ")) {
            errors.push(t.slice(2).trim());
        } else if (t.startsWith("⚠ ")) {
            warnings.push(t.slice(2).trim());
        }
    }

    return { errors, warnings };
}

export const SAVE_IMPORT_REVIEW_ROAD_ROUTING_WARNINGS_CONFIRM =
    "This road has routing continuity warnings. Save changes anyway?";

export type ResolvedRoadClassForSave =
    | { ok: true; roadClassId: string; roadClassCode: string | null }
    | { ok: false; message: string };

/** Resolve road class for PATCH — never silently clear when a fallback class exists. */
export function resolveRoadClassForSave(args: {
    roadClassId: string;
    row: ImportReviewBuildingListItem;
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[];
    hasGeometry: boolean;
}): ResolvedRoadClassForSave {
    const trimmed = args.roadClassId.trim();
    if (trimmed) {
        return { ok: true, roadClassId: trimmed, roadClassCode: null };
    }

    const resolved = resolveImportReviewRoadClassValue(args.row, args.roadClassOptions);
    if (resolved.roadClassId) {
        return { ok: true, roadClassId: resolved.roadClassId, roadClassCode: null };
    }
    if (resolved.roadClassCode) {
        return { ok: true, roadClassId: "", roadClassCode: resolved.roadClassCode };
    }

    return { ok: true, roadClassId: "", roadClassCode: null };
}
