import type { StreetGeometry, StreetLineStringGeoJson } from "@/src/lib/api";
import { normalizeLineStringForEditor } from "@/src/features/streets/normalizeStreetLineString";
import type { ImportReviewBuildingListItem } from "@/src/lib/api";

export function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
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

function highwayFromNormalized(data: unknown): string {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        const hw = (tags as Record<string, unknown>).highway;
        if (typeof hw === "string" && hw.trim()) {
            return hw.trim();
        }
    }
    const direct = normPick(data, "highway");
    if (typeof direct === "string" && direct.trim()) {
        return direct.trim();
    }
    return "";
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

function generatedLabelFromNormalized(data: unknown): string {
    const gl = normPick(data, "generated_label");
    if (typeof gl === "string" && gl.trim()) {
        return gl.trim();
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
    canonicalName: string;
    roadClassId: string;
    isOneway: boolean;
    surface: string;
    line: StreetLineStringGeoJson | null;
    multiLineWarning: string | null;
    geometryLoadNotice: string | null;
    overridesReviewNote: string;
};

export function roadEditorSeedFromRow(
    row: ImportReviewBuildingListItem,
    roadClassIdByCode: Map<string, string>,
): ImportReviewRoadEditorSeed {
    const ov = asOverrideRecord(row.review_overrides);
    const nd = row.normalized_data;

    let canonicalName = strFromUnknown(ov.canonical_name).trim();
    if (!canonicalName) {
        canonicalName = (row.canonical_name ?? "").trim();
    }
    if (!canonicalName) {
        canonicalName = generatedLabelFromNormalized(nd);
    }

    let roadClassId = strFromUnknown(ov.road_class_id).trim();
    if (!roadClassId && row.road_candidate_road_class_id) {
        roadClassId = String(row.road_candidate_road_class_id).trim();
    }
    if (!roadClassId) {
        const code =
            strFromUnknown(ov.road_class_code).trim() ||
            (row.class_code ?? "").trim() ||
            highwayFromNormalized(nd);
        if (code) {
            roadClassId = roadClassIdByCode.get(code.toLowerCase()) ?? "";
        }
    }

    let isOneway = boolFromUnknown(ov.is_oneway);
    if (isOneway === null && row.road_candidate_is_oneway !== null && row.road_candidate_is_oneway !== undefined) {
        isOneway = row.road_candidate_is_oneway;
    }
    if (isOneway === null) {
        isOneway = boolFromUnknown(normPick(nd, "is_oneway")) ?? false;
    }

    let surface = strFromUnknown(ov.surface).trim();
    if (!surface && row.road_candidate_surface) {
        surface = row.road_candidate_surface.trim();
    }
    if (!surface) {
        surface = surfaceFromNormalized(nd);
    }

    const ovGeom = ov.geom;
    const geomSource: StreetGeometry | null =
        ovGeom && typeof ovGeom === "object" && !Array.isArray(ovGeom) && "type" in ovGeom
            ? (ovGeom as StreetGeometry)
            : (row.geometry as StreetGeometry | null);

    const norm = normalizeLineStringForEditor(geomSource);
    const geometryLoadNotice =
        norm.unsupportedReason ??
        (norm.parseError ? norm.parseError : null);

    return {
        canonicalName,
        roadClassId,
        isOneway,
        surface,
        line: norm.line,
        multiLineWarning: norm.multiLineWarning ?? null,
        geometryLoadNotice,
        overridesReviewNote: strFromUnknown(ov.review_note).trim() || (row.review_note ?? "").trim(),
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
    "This road has routing continuity warnings. Save overrides anyway?";
