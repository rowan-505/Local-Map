import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewEntityConfig } from "./import-review-config.js";

/** Default batch-selection families (normal tier). */
export const NORMAL_PROMOTION_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
] as const satisfies readonly ImportReviewEntityFamilySlug[];

export type NormalPromotionFamily = (typeof NORMAL_PROMOTION_FAMILIES)[number];

/** Requires explicit allow_high_risk_families on batch create. */
export const HIGH_RISK_PROMOTION_FAMILIES = [
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const satisfies readonly ImportReviewEntityFamilySlug[];

export type HighRiskPromotionFamily = (typeof HIGH_RISK_PROMOTION_FAMILIES)[number];

/** Promotion target table per allowed family. */
export const IMPORT_REVIEW_PROMOTION_TARGETS = {
    buildings: "core.core_map_buildings",
    places: "core.core_places",
    landuse: "core.core_map_landuse",
    water_lines: "core.core_map_water_lines",
    water_polygons: "core.core_map_water_polygons",
    roads: "core.core_streets",
    addresses: "core.core_addresses",
    admin_areas: "core.core_admin_areas",
    routing_barriers: "routing.routing_barriers",
} as const satisfies Record<
    NormalPromotionFamily | HighRiskPromotionFamily,
    string
>;

export type ImportReviewPromotionAllowedFamily = keyof typeof IMPORT_REVIEW_PROMOTION_TARGETS;

export const IMPORT_REVIEW_PROMOTION_ALLOWED_FAMILIES = [
    ...NORMAL_PROMOTION_FAMILIES,
    ...HIGH_RISK_PROMOTION_FAMILIES,
] as const satisfies readonly ImportReviewPromotionAllowedFamily[];

export function isImportReviewPromotionAllowedFamily(
    family: string
): family is ImportReviewPromotionAllowedFamily {
    return (IMPORT_REVIEW_PROMOTION_ALLOWED_FAMILIES as readonly string[]).includes(family);
}

export function isHighRiskPromotionFamily(family: string): family is HighRiskPromotionFamily {
    return (HIGH_RISK_PROMOTION_FAMILIES as readonly string[]).includes(family);
}

export function isNormalPromotionFamily(family: string): family is NormalPromotionFamily {
    return (NORMAL_PROMOTION_FAMILIES as readonly string[]).includes(family);
}

export function getImportReviewPromotionTarget(family: ImportReviewPromotionAllowedFamily): string {
    return IMPORT_REVIEW_PROMOTION_TARGETS[family];
}

export function assertImportReviewPromotionFamilyAllowed(family: string): asserts family is ImportReviewPromotionAllowedFamily {
    if (!isImportReviewPromotionAllowedFamily(family)) {
        throw new Error(`Import review promotion is not allowed for entity family: ${family}`);
    }
}

// --- Backward-compatible publish-batch aliases (derive from canonical config) ---

/** @deprecated Prefer {@link NORMAL_PROMOTION_FAMILIES} */
export const DEFAULT_PUBLISH_ENTITY_FAMILIES = NORMAL_PROMOTION_FAMILIES;

/** @deprecated Prefer {@link HIGH_RISK_PROMOTION_FAMILIES} */
export const HIGH_RISK_PUBLISH_ENTITY_FAMILIES = HIGH_RISK_PROMOTION_FAMILIES;

/** Families validated by the multi-family publish batch validation runner. */
export const VALIDATABLE_PUBLISH_FAMILIES = [
    ...IMPORT_REVIEW_PROMOTION_ALLOWED_FAMILIES,
] as const satisfies readonly ImportReviewPromotionAllowedFamily[];

export type ValidatablePublishEntityFamily = (typeof VALIDATABLE_PUBLISH_FAMILIES)[number];

export function isValidatablePublishFamily(family: string): family is ValidatablePublishEntityFamily {
    return (VALIDATABLE_PUBLISH_FAMILIES as readonly string[]).includes(family);
}

/** Families written by the publish batch promotion runner. */
export const PROMOTABLE_PUBLISH_FAMILIES = [
    ...NORMAL_PROMOTION_FAMILIES,
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const satisfies readonly ImportReviewPromotionAllowedFamily[];

export type PromotablePublishEntityFamily = (typeof PROMOTABLE_PUBLISH_FAMILIES)[number];

export function isPromotablePublishFamily(family: string): family is PromotablePublishEntityFamily {
    return (PROMOTABLE_PUBLISH_FAMILIES as readonly string[]).includes(family);
}

export type PublishEntityFamilyTier = "default" | "high_risk";

export type ImportReviewPublishFamilyConfig = {
    entityFamily: ImportReviewPromotionAllowedFamily;
    candidateTable: string;
    tableAlias: string;
    coreTargetTable: string;
    tier: PublishEntityFamilyTier;
};

function publishFamilyConfig(family: ImportReviewPromotionAllowedFamily): ImportReviewPublishFamilyConfig {
    const base = getImportReviewEntityConfig(family);
    const tier: PublishEntityFamilyTier = isHighRiskPromotionFamily(family) ? "high_risk" : "default";
    return {
        entityFamily: family,
        candidateTable: `import_review.${base.importReviewTable}`,
        tableAlias: base.tableAlias,
        coreTargetTable: IMPORT_REVIEW_PROMOTION_TARGETS[family],
        tier,
    };
}

export const IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG: Record<
    ImportReviewPromotionAllowedFamily,
    ImportReviewPublishFamilyConfig
> = {
    buildings: publishFamilyConfig("buildings"),
    places: publishFamilyConfig("places"),
    landuse: publishFamilyConfig("landuse"),
    water_lines: publishFamilyConfig("water_lines"),
    water_polygons: publishFamilyConfig("water_polygons"),
    roads: publishFamilyConfig("roads"),
    addresses: publishFamilyConfig("addresses"),
    admin_areas: publishFamilyConfig("admin_areas"),
    routing_barriers: publishFamilyConfig("routing_barriers"),
};

export function getImportReviewPublishFamilyConfig(
    family: string
): ImportReviewPublishFamilyConfig | null {
    if (!isImportReviewPromotionAllowedFamily(family)) {
        return null;
    }
    return IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[family];
}

/** Candidate table for any import-review family (including disabled promotion families). */
export function getImportReviewPromotionCandidateTable(family: ImportReviewEntityFamilySlug): string {
    const publishCfg = getImportReviewPublishFamilyConfig(family);
    if (publishCfg) {
        return publishCfg.candidateTable;
    }
    const base = getImportReviewEntityConfig(family);
    return `import_review.${base.importReviewTable}`;
}

export function resolvePublishEntityFamilies(
    requested: string[] | undefined,
    allowHighRisk: boolean
): ImportReviewPublishFamilyConfig[] {
    const families = requested?.length ? requested : ["buildings"];
    const out: ImportReviewPublishFamilyConfig[] = [];
    for (const raw of families) {
        const trimmed = raw.trim();
        assertImportReviewPromotionFamilyAllowed(trimmed);
        const cfg = IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[trimmed];
        if (cfg.tier === "high_risk" && !allowHighRisk) {
            throw new Error(
                `Entity family ${cfg.entityFamily} requires allow_high_risk_families=true`
            );
        }
        out.push(cfg);
    }
    return out;
}
