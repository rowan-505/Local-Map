import type { PrismaClient } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { pickEffectiveString } from "./import-review-effective-values.js";
import {
    BUILDING_TYPE_FALLBACK_CODES,
    IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM,
    IMPORT_REVIEW_CONFIDENCE_DEFAULT_FAMILIES,
    IMPORT_REVIEW_DEFAULT_CONFIDENCE_SCORE,
    IMPORT_REVIEW_ESSENTIAL_FIELD_RULES,
    POI_CATEGORY_FALLBACK_CODES,
    ROAD_CLASS_FALLBACK_CODES,
    type ImportReviewEssentialFieldRule,
} from "./import-review-essential-fields.js";
import type { ImportReviewEssentialCandidateContext } from "./import-review-essential-defaults.repo.js";
import { ImportReviewEssentialDefaultsRepository } from "./import-review-essential-defaults.repo.js";
import {
    deriveImportedNameEn,
    deriveImportedNameMm,
    normPick,
    pickEffectiveNameEn,
    pickEffectiveNameMm,
    trimString,
    type ImportReviewNameCandidate,
} from "./import-review-name-fields.js";
import { ImportReviewReferenceOptionsRepository } from "./import-review-reference-options.repo.js";

export type ImportReviewEssentialDefaultsOutcome = {
    overridesPatch: Record<string, unknown>;
    applyConfidenceDefault: boolean;
};

function nameSourceFromContext(ctx: ImportReviewEssentialCandidateContext): ImportReviewNameCandidate {
    return {
        canonical_name: ctx.canonical_name,
        normalized_data: ctx.normalized_data,
        class_code: ctx.class_code,
        review_overrides: ctx.review_overrides,
    };
}

function mergedOverrides(
    ctx: ImportReviewEssentialCandidateContext,
    incomingPatch: Record<string, unknown>
): Record<string, unknown> {
    return { ...ctx.review_overrides, ...incomingPatch };
}

function parseBigintId(value: unknown): bigint | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return BigInt(value);
    }
    const s = String(value).trim();
    return /^\d+$/.test(s) ? BigInt(s) : null;
}

function normBigintPick(data: unknown, key: string): bigint | null {
    return parseBigintId(normPick(data, key));
}

async function resolveAdminAreaId(
    family: ImportReviewEntityFamilySlug,
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>,
    essentialRepo: ImportReviewEssentialDefaultsRepository
): Promise<bigint | null> {
    const fromOverride = parseBigintId(overrides.admin_area_id);
    if (fromOverride !== null) {
        return fromOverride;
    }
    if (ctx.admin_area_id !== null) {
        return ctx.admin_area_id;
    }
    const fromNorm = normBigintPick(ctx.normalized_data, "admin_area_id");
    if (fromNorm !== null) {
        return fromNorm;
    }
    if (!ctx.has_geometry) {
        return null;
    }
    return essentialRepo.inferAdminAreaIdFromCandidateGeometry(family, ctx.review_batch_id, ctx.id);
}

async function resolvePoiCategoryId(
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>,
    refRepo: ImportReviewReferenceOptionsRepository
): Promise<bigint | null> {
    const explicit =
        parseBigintId(overrides.poi_category_id) ??
        parseBigintId(overrides.category_id) ??
        ctx.category_id ??
        normBigintPick(ctx.normalized_data, "category_id") ??
        normBigintPick(ctx.normalized_data, "poi_category_id");
    if (explicit !== null) {
        return explicit;
    }

    const classCode =
        pickEffectiveString("class_code", overrides, ctx.class_code, normPick(ctx.normalized_data, "class_code")) ??
        trimString(normPick(ctx.normalized_data, "category_code"));
    if (classCode) {
        const byCode = await refRepo.findPoiCategoryIdByCode(classCode);
        if (byCode !== null) {
            return byCode;
        }
    }

    return refRepo.findFirstPoiCategoryIdByCodes(POI_CATEGORY_FALLBACK_CODES);
}

async function resolveBuildingTypeId(
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>,
    refRepo: ImportReviewReferenceOptionsRepository
): Promise<bigint | null> {
    const explicit =
        parseBigintId(overrides.building_type_id) ??
        ctx.building_type_id ??
        normBigintPick(ctx.normalized_data, "building_type_id");
    if (explicit !== null) {
        return explicit;
    }

    const classCode =
        pickEffectiveString("class_code", overrides, ctx.class_code, normPick(ctx.normalized_data, "class_code")) ??
        trimString(ctx.building_type) ??
        trimString(normPick(ctx.normalized_data, "building_type"));
    if (classCode) {
        const byCode = await refRepo.findActiveBuildingTypeIdByCode(classCode);
        if (byCode !== null) {
            return byCode;
        }
    }

    return refRepo.findFirstActiveBuildingTypeIdByCodes(BUILDING_TYPE_FALLBACK_CODES);
}

async function resolveRoadClassId(
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>,
    refRepo: ImportReviewReferenceOptionsRepository
): Promise<bigint | null> {
    const explicit =
        parseBigintId(overrides.road_class_id) ??
        ctx.road_class_id ??
        normBigintPick(ctx.normalized_data, "road_class_id");
    if (explicit !== null) {
        return explicit;
    }

    const classCode =
        trimString(ctx.road_class) ??
        pickEffectiveString("class_code", overrides, ctx.class_code, normPick(ctx.normalized_data, "class_code")) ??
        trimString(normPick(ctx.normalized_data, "road_class_code"));
    if (classCode) {
        const byCode = await refRepo.findRoadClassIdByCode(classCode);
        if (byCode !== null) {
            return byCode;
        }
    }

    return refRepo.findFirstRoadClassIdByCodes(ROAD_CLASS_FALLBACK_CODES);
}

function resolveBusStopNameMm(
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>
): string {
    const source = nameSourceFromContext(ctx);
    return (
        deriveImportedNameMm(source) ??
        deriveImportedNameEn(source) ??
        pickEffectiveNameEn(overrides, source) ??
        IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM
    );
}

function resolveClassCode(
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>
): string | null {
    return (
        pickEffectiveString("class_code", overrides, ctx.class_code, normPick(ctx.normalized_data, "class_code")) ??
        trimString(normPick(ctx.normalized_data, "water_class")) ??
        trimString(normPick(ctx.normalized_data, "landuse_class"))
    );
}

/** Build review_overrides patch entries for missing essential values (does not overwrite explicit overrides). */
export async function buildEssentialDefaultOverridesPatch(
    prisma: PrismaClient,
    family: ImportReviewEntityFamilySlug,
    ctx: ImportReviewEssentialCandidateContext,
    incomingPatch: Record<string, unknown> = {}
): Promise<ImportReviewEssentialDefaultsOutcome> {
    const refRepo = new ImportReviewReferenceOptionsRepository(prisma);
    const essentialRepo = new ImportReviewEssentialDefaultsRepository(prisma);
    const overrides = mergedOverrides(ctx, incomingPatch);
    const patch: Record<string, unknown> = {};

    if (family === "bus_stops") {
        if (!pickEffectiveNameMm(overrides, nameSourceFromContext(ctx))) {
            patch.name_mm = resolveBusStopNameMm(ctx, overrides);
        }
        const adminId = await resolveAdminAreaId(family, ctx, overrides, essentialRepo);
        if (adminId !== null && parseBigintId(overrides.admin_area_id) === null && ctx.admin_area_id === null) {
            patch.admin_area_id = adminId.toString();
        }
    }

    if (family === "places") {
        const nameMm = pickEffectiveNameMm(overrides, nameSourceFromContext(ctx));
        const nameEn = pickEffectiveNameEn(overrides, nameSourceFromContext(ctx));
        if (!nameMm && !nameEn) {
            const importedMm = deriveImportedNameMm(nameSourceFromContext(ctx));
            const importedEn = deriveImportedNameEn(nameSourceFromContext(ctx));
            if (importedMm) {
                patch.name_mm = importedMm;
            } else if (importedEn) {
                patch.name_en = importedEn;
            }
        }
        const categoryId = await resolvePoiCategoryId(ctx, overrides, refRepo);
        if (
            categoryId !== null &&
            parseBigintId(overrides.category_id) === null &&
            parseBigintId(overrides.poi_category_id) === null &&
            ctx.category_id === null
        ) {
            patch.category_id = Number(categoryId) <= Number.MAX_SAFE_INTEGER
                ? Number(categoryId)
                : categoryId.toString();
        }
        const adminId = await resolveAdminAreaId(family, ctx, overrides, essentialRepo);
        if (adminId !== null && parseBigintId(overrides.admin_area_id) === null && ctx.admin_area_id === null) {
            patch.admin_area_id = adminId.toString();
        }
    }

    if (family === "buildings") {
        const buildingTypeId = await resolveBuildingTypeId(ctx, overrides, refRepo);
        if (
            buildingTypeId !== null &&
            parseBigintId(overrides.building_type_id) === null &&
            ctx.building_type_id === null
        ) {
            patch.building_type_id = buildingTypeId.toString();
        }
        const adminId = await resolveAdminAreaId(family, ctx, overrides, essentialRepo);
        if (adminId !== null && parseBigintId(overrides.admin_area_id) === null && ctx.admin_area_id === null) {
            patch.admin_area_id = adminId.toString();
        }
    }

    if (family === "roads") {
        const roadClassId = await resolveRoadClassId(ctx, overrides, refRepo);
        if (
            roadClassId !== null &&
            parseBigintId(overrides.road_class_id) === null &&
            ctx.road_class_id === null
        ) {
            patch.road_class_id = Number(roadClassId);
        }
        if (!Object.prototype.hasOwnProperty.call(overrides, "is_oneway")) {
            patch.is_oneway = false;
        }
        const adminId = await resolveAdminAreaId(family, ctx, overrides, essentialRepo);
        if (adminId !== null && parseBigintId(overrides.admin_area_id) === null) {
            patch.admin_area_id = Number(adminId);
        }
    }

    if (family === "landuse" || family === "water_lines" || family === "water_polygons") {
        if (!resolveClassCode(ctx, overrides)) {
            const imported =
                trimString(ctx.class_code) ?? trimString(normPick(ctx.normalized_data, "class_code"));
            if (imported) {
                patch.class_code = imported;
            }
        }
    }

    return {
        overridesPatch: patch,
        applyConfidenceDefault:
            IMPORT_REVIEW_CONFIDENCE_DEFAULT_FAMILIES.has(family) && ctx.confidence_score === null,
    };
}

function fieldLabel(key: string): string {
    switch (key) {
        case "poi_category_id":
            return "category_id";
        case "name_mm":
            return "Myanmar name (name_mm)";
        case "name_en":
            return "English name (name_en)";
        default:
            return key;
    }
}

async function effectiveValueForField(
    family: ImportReviewEntityFamilySlug,
    rule: Extract<ImportReviewEssentialFieldRule, { kind: "field" }>,
    ctx: ImportReviewEssentialCandidateContext,
    overrides: Record<string, unknown>,
    prisma: PrismaClient
): Promise<unknown> {
    const refRepo = new ImportReviewReferenceOptionsRepository(prisma);
    const essentialRepo = new ImportReviewEssentialDefaultsRepository(prisma);

    switch (rule.key) {
        case "name_mm":
            return pickEffectiveNameMm(overrides, nameSourceFromContext(ctx));
        case "name_en":
            return pickEffectiveNameEn(overrides, nameSourceFromContext(ctx));
        case "admin_area_id":
            return await resolveAdminAreaId(family, ctx, overrides, essentialRepo);
        case "category_id":
            return await resolvePoiCategoryId(ctx, overrides, refRepo);
        case "building_type_id":
            return await resolveBuildingTypeId(ctx, overrides, refRepo);
        case "road_class_id":
            return await resolveRoadClassId(ctx, overrides, refRepo);
        case "class_code":
            return resolveClassCode(ctx, overrides);
        default:
            return pickEffectiveString(rule.key, overrides, normPick(ctx.normalized_data, rule.key));
    }
}

/** Throws ImportReviewDecisionRuleError when essentials cannot be satisfied even after defaults. */
export async function assertImportReviewEssentialFieldsMet(
    prisma: PrismaClient,
    family: ImportReviewEntityFamilySlug,
    ctx: ImportReviewEssentialCandidateContext,
    incomingPatch: Record<string, unknown> = {}
): Promise<void> {
    const rules = IMPORT_REVIEW_ESSENTIAL_FIELD_RULES[family];
    if (!rules || rules.length === 0) {
        return;
    }

    const defaults = await buildEssentialDefaultOverridesPatch(prisma, family, ctx, incomingPatch);
    const overrides = mergedOverrides(ctx, { ...defaults.overridesPatch, ...incomingPatch });
    const errors: string[] = [];

    for (const rule of rules) {
        if (rule.kind === "geometry") {
            if (!ctx.has_geometry) {
                errors.push("Point/geometry location is required but missing on this candidate.");
            }
            continue;
        }

        if (rule.kind === "at_least_one") {
            const values = await Promise.all(
                rule.keys.map(async (key) =>
                    effectiveValueForField(
                        family,
                        { kind: "field", key },
                        ctx,
                        overrides,
                        prisma
                    )
                )
            );
            if (!values.some((v) => v !== null && v !== undefined && String(v).trim() !== "")) {
                errors.push(
                    `At least one name is required (${rule.keys.map(fieldLabel).join(" or ")}).`
                );
            }
            continue;
        }

        const value = await effectiveValueForField(family, rule, ctx, overrides, prisma);
        if (value === null || value === undefined || String(value).trim() === "") {
            if (rule.key === "admin_area_id") {
                errors.push(
                    "Admin area is required but could not be resolved from import data or geometry. Set admin_area_id manually."
                );
            } else if (rule.key === "category_id") {
                errors.push(
                    "POI category is required but could not be mapped to ref.ref_poi_categories. Set category_id or a mappable class_code."
                );
            } else if (rule.key === "building_type_id") {
                errors.push(
                    "Building type is required but could not be mapped to ref.ref_building_types. Set building_type_id or a mappable class_code."
                );
            } else if (rule.key === "road_class_id") {
                errors.push(
                    "Road class is required but could not be mapped to ref.ref_road_classes. Set road_class_id or a mappable class_code."
                );
            } else if (rule.key === "class_code") {
                errors.push("Class/type code is required but missing on this candidate.");
            } else if (rule.key === "name_mm") {
                errors.push("Myanmar name (name_mm) is required but missing.");
            } else {
                errors.push(`${fieldLabel(rule.key)} is required but missing.`);
            }
        }
    }

    if (errors.length > 0) {
        throw new ImportReviewDecisionRuleError(errors.join(" "));
    }
}

export async function applyImportReviewEssentialDefaults(
    prisma: PrismaClient,
    family: ImportReviewEntityFamilySlug,
    ctx: ImportReviewEssentialCandidateContext,
    incomingPatch: Record<string, unknown> = {}
): Promise<ImportReviewEssentialDefaultsOutcome> {
    const outcome = await buildEssentialDefaultOverridesPatch(prisma, family, ctx, incomingPatch);
    if (outcome.applyConfidenceDefault) {
        const essentialRepo = new ImportReviewEssentialDefaultsRepository(prisma);
        await essentialRepo.applyConfidenceDefaultIfMissing(
            family,
            ctx.review_batch_id,
            ctx.id,
            IMPORT_REVIEW_DEFAULT_CONFIDENCE_SCORE
        );
    }
    return outcome;
}
