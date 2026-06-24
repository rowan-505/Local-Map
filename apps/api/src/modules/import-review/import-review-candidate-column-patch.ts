import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewEntityConfig } from "./import-review-config.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import {
    IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES,
    overrideAllowlistForFamily,
} from "./import-review-overrides-allowlist.js";

/** Override PATCH key → typed candidate column (when different). */
const OVERRIDE_KEY_TO_COLUMN: Readonly<Record<string, string>> = {
    poi_category_id: "category_id",
    waterway_class: "class_code",
    water_class: "class_code",
    parent_admin_area_id: "parent_id",
    ...IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES,
};

const GEOMETRY_COLUMNS = new Set(["geom", "point_geom"]);

export type CandidateColumnPatch = Record<string, unknown>;

export function resolveCandidateColumnForOverrideKey(overrideKey: string): string {
    return OVERRIDE_KEY_TO_COLUMN[overrideKey] ?? overrideKey;
}

/**
 * Map a sanitized override-shaped patch to typed column assignments.
 * Drops keys with no matching column on the candidate table.
 */
export function mapOverridePatchToColumnPatch(
    family: ImportReviewEntityFamilySlug,
    overridesPatch: Record<string, unknown>
): CandidateColumnPatch {
    const config = getImportReviewEntityConfig(family);
    const tableKey = `import_review.${config.importReviewTable}`;
    const writableColumns = STATIC_WRITABLE_COLUMNS_BY_TABLE[tableKey] ?? null;

    const allowlist = overrideAllowlistForFamily(family);
    const out: CandidateColumnPatch = {};

    for (const [overrideKey, value] of Object.entries(overridesPatch)) {
        if (!allowlist.has(overrideKey) && !Object.prototype.hasOwnProperty.call(OVERRIDE_KEY_TO_COLUMN, overrideKey)) {
            continue;
        }
        const column = resolveCandidateColumnForOverrideKey(overrideKey);
        if (writableColumns !== null && !writableColumns.has(column)) {
            continue;
        }
        out[column] = value;
    }

    return out;
}

/** SQL assignment for geometry columns (value = GeoJSON object or null). */
export function buildCandidateColumnGeometrySetSql(
    family: ImportReviewEntityFamilySlug,
    column: "geom" | "point_geom",
    geoJson: unknown
): Prisma.Sql {
    if (geoJson === null || geoJson === undefined) {
        return Prisma.sql`${Prisma.raw(column)} = NULL`;
    }
    if (typeof geoJson !== "object" || Array.isArray(geoJson)) {
        throw new ImportReviewDecisionRuleError(`${column} must be a GeoJSON object or null`);
    }
    const payload = JSON.stringify(geoJson);

    if (family === "roads" && column === "geom") {
        const geomExpr = Prisma.sql`ST_Multi(ST_LineMerge(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${payload}::json), 4326)), 2)))`;
        return Prisma.sql`geom = ${geomExpr}, length_m = ROUND(ST_Length(${geomExpr}::geography)::numeric, 2)`;
    }

    const geomExpr = Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${payload}::json), 4326)`;
    return Prisma.sql`${Prisma.raw(column)} = ${geomExpr}`;
}

export function isGeometryColumnKey(column: string): column is "geom" | "point_geom" {
    return GEOMETRY_COLUMNS.has(column);
}

function normalizePatchedNameValue(value: unknown): string | null | undefined {
    if (value === null) {
        return null;
    }
    if (value === undefined) {
        return undefined;
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

export function resolveFinalPatchedPlaceNames(args: {
    existingNameMm: string | null | undefined;
    existingNameEn: string | null | undefined;
    incomingPatch: Record<string, unknown>;
}): { nameMm: string | null; nameEn: string | null } {
    const hasIncomingMm = Object.prototype.hasOwnProperty.call(args.incomingPatch, "name_mm");
    const hasIncomingEn = Object.prototype.hasOwnProperty.call(args.incomingPatch, "name_en");

    const existingMm = args.existingNameMm?.trim() ? args.existingNameMm.trim() : null;
    const existingEn = args.existingNameEn?.trim() ? args.existingNameEn.trim() : null;

    const patchedMmRaw = hasIncomingMm
        ? normalizePatchedNameValue(args.incomingPatch.name_mm)
        : existingMm;
    const patchedEnRaw = hasIncomingEn
        ? normalizePatchedNameValue(args.incomingPatch.name_en)
        : existingEn;
    const patchedMm = patchedMmRaw === undefined ? existingMm : patchedMmRaw;
    const patchedEn = patchedEnRaw === undefined ? existingEn : patchedEnRaw;

    return { nameMm: patchedMm, nameEn: patchedEn };
}

export function assertFinalPatchedPlaceNameState(args: {
    existingNameMm: string | null | undefined;
    existingNameEn: string | null | undefined;
    incomingPatch: Record<string, unknown>;
}): void {
    const finalNames = resolveFinalPatchedPlaceNames(args);
    if (!finalNames.nameMm && !finalNames.nameEn) {
        throw new ImportReviewDecisionRuleError(
            "At least one name is required (Myanmar name (name_mm) or English name (name_en))."
        );
    }
}

/** Allowed `import_review.review_candidate_edits.edit_type` for typed column PATCH. */
export const IMPORT_REVIEW_CANDIDATE_COLUMN_EDIT_TYPE = "override_update" as const;

/**
 * Reject direct PATCH when client fields do not map to any writable typed column.
 * Prevents 200 responses that only touch review_note / updated_at.
 */
export function assertPersistableDirectColumnPatch(
    family: ImportReviewEntityFamilySlug,
    userPatch: Record<string, unknown>,
    columnPatch: CandidateColumnPatch
): void {
    const userKeys = Object.keys(userPatch);
    if (userKeys.length === 0) {
        throw new ImportReviewDecisionRuleError(
            "PATCH fields must include at least one column update."
        );
    }
    const columnKeys = Object.keys(columnPatch);
    if (columnKeys.length === 0) {
        throw new ImportReviewDecisionRuleError(
            `None of the supplied fields persist to typed columns for ${family}: ${userKeys.join(", ")}.`
        );
    }
}

/** JSON text safe for `::jsonb` audit columns (BigInt-safe). */
export function stringifyColumnAuditSnapshot(snapshot: Record<string, unknown>): string {
    return JSON.stringify(snapshot, (_key, value) => {
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        return value;
    });
}

/** Snapshot JSON for review_candidate_edits (column values only). */
export function pickColumnSnapshot(
    row: Record<string, unknown>,
    columns: readonly string[]
): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    for (const col of columns) {
        if (Object.prototype.hasOwnProperty.call(row, col)) {
            snap[col] = toJsonSafeValue(row[col] ?? null);
        }
    }
    return snap;
}

function toJsonSafeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toJsonSafeValue(entry));
    }
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
                continue;
            }
            out[key] = toJsonSafeValue(entry);
        }
        return out;
    }
    return String(value);
}

const STATIC_WRITABLE_COLUMNS_BY_TABLE: Record<string, ReadonlySet<string>> = {
    "import_review.building_candidates": new Set([
        "name_mm",
        "name_en",
        "building_type_id",
        "admin_area_id",
        "levels",
        "height_m",
        "confidence_score",
        "geom",
        "review_note",
    ]),
    "import_review.place_candidates": new Set([
        "name_mm",
        "name_en",
        "primary_name",
        "display_name",
        "category_id",
        "admin_area_id",
        "confidence_score",
        "importance_score",
        "popularity_score",
        "point_geom",
        "review_note",
    ]),
    "import_review.road_candidates": new Set([
        "name_mm",
        "name_en",
        "canonical_name",
        "road_class_id",
        "road_class",
        "admin_area_id",
        "surface",
        "is_oneway",
        "bridge",
        "tunnel",
        "layer",
        "access",
        "speed_kph",
        "confidence_score",
        "geom",
        "length_m",
        "validation_warnings",
        "validation_errors",
        "review_note",
    ]),
    "import_review.landuse_candidates": new Set([
        "name_mm",
        "name_en",
        "class_code",
        "landuse_class_id",
        "confidence_score",
        "geom",
        "review_note",
    ]),
    "import_review.water_line_candidates": new Set([
        "name_mm",
        "name_en",
        "class_code",
        "confidence_score",
        "geom",
        "review_note",
    ]),
    "import_review.water_polygon_candidates": new Set([
        "name_mm",
        "name_en",
        "class_code",
        "confidence_score",
        "geom",
        "review_note",
    ]),
    "import_review.admin_area_candidates": new Set([
        "name_mm",
        "name_en",
        "admin_level_id",
        "parent_id",
        "slug",
        "geom",
        "review_note",
    ]),
    "import_review.address_candidates": new Set([
        "full_address",
        "house_number",
        "street_name",
        "street_id",
        "quarter",
        "township",
        "city",
        "postcode",
        "plus_code",
        "admin_area_id",
        "point_geom",
        "geom",
        "review_note",
    ]),
    "import_review.routing_barrier_candidates": new Set([
        "barrier_type",
        "class_code",
        "confidence_score",
        "point_geom",
        "geom",
        "review_note",
    ]),
};
