import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewEntityConfig } from "./import-review-config.js";

/** Families validated by the multi-family publish batch validation runner. */
export const VALIDATABLE_PUBLISH_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
] as const satisfies readonly ImportReviewEntityFamilySlug[];

export type ValidatablePublishEntityFamily = (typeof VALIDATABLE_PUBLISH_FAMILIES)[number];

export function isValidatablePublishFamily(family: string): family is ValidatablePublishEntityFamily {
    return (VALIDATABLE_PUBLISH_FAMILIES as readonly string[]).includes(family);
}

/** Families written to core by the publish batch promotion runner (v1). */
export const PROMOTABLE_PUBLISH_FAMILIES = ["buildings", "places"] as const satisfies readonly ImportReviewEntityFamilySlug[];

export type PromotablePublishEntityFamily = (typeof PROMOTABLE_PUBLISH_FAMILIES)[number];

export function isPromotablePublishFamily(family: string): family is PromotablePublishEntityFamily {
    return (PROMOTABLE_PUBLISH_FAMILIES as readonly string[]).includes(family);
}

export const DEFAULT_PUBLISH_ENTITY_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
] as const satisfies readonly ImportReviewEntityFamilySlug[];

export const HIGH_RISK_PUBLISH_ENTITY_FAMILIES = [
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const satisfies readonly ImportReviewEntityFamilySlug[];

export type PublishEntityFamilyTier = "default" | "high_risk";

export type ImportReviewPublishFamilyConfig = {
    entityFamily: ImportReviewEntityFamilySlug;
    candidateTable: string;
    tableAlias: string;
    coreTargetTable: string;
    tier: PublishEntityFamilyTier;
};

const CORE_TARGETS: Record<ImportReviewEntityFamilySlug, string> = {
    buildings: "core.core_map_buildings",
    places: "core.core_places",
    roads: "core.core_streets",
    bus_stops: "core.core_bus_stops",
    landuse: "core.core_map_landuse",
    water_lines: "core.core_map_water_lines",
    water_polygons: "core.core_map_water_polygons",
    addresses: "core.core_addresses",
    admin_areas: "core.core_admin_areas",
    routing_barriers: "core.core_routing_barriers",
};

function publishFamilyConfig(family: ImportReviewEntityFamilySlug): ImportReviewPublishFamilyConfig {
    const base = getImportReviewEntityConfig(family);
    const tier: PublishEntityFamilyTier = (
        HIGH_RISK_PUBLISH_ENTITY_FAMILIES as readonly string[]
    ).includes(family)
        ? "high_risk"
        : "default";
    return {
        entityFamily: family,
        candidateTable: `import_review.${base.importReviewTable}`,
        tableAlias: base.tableAlias,
        coreTargetTable: CORE_TARGETS[family],
        tier,
    };
}

export const IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG: Record<
    ImportReviewEntityFamilySlug,
    ImportReviewPublishFamilyConfig
> = {
    buildings: publishFamilyConfig("buildings"),
    places: publishFamilyConfig("places"),
    roads: publishFamilyConfig("roads"),
    bus_stops: publishFamilyConfig("bus_stops"),
    landuse: publishFamilyConfig("landuse"),
    water_lines: publishFamilyConfig("water_lines"),
    water_polygons: publishFamilyConfig("water_polygons"),
    addresses: publishFamilyConfig("addresses"),
    admin_areas: publishFamilyConfig("admin_areas"),
    routing_barriers: publishFamilyConfig("routing_barriers"),
};

export function getImportReviewPublishFamilyConfig(
    family: string
): ImportReviewPublishFamilyConfig | null {
    if (family in IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG) {
        return IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[family as ImportReviewEntityFamilySlug];
    }
    return null;
}

export function resolvePublishEntityFamilies(
    requested: string[] | undefined,
    allowHighRisk: boolean
): ImportReviewPublishFamilyConfig[] {
    const families = requested?.length ? requested : ["buildings"];
    const out: ImportReviewPublishFamilyConfig[] = [];
    for (const raw of families) {
        const cfg = getImportReviewPublishFamilyConfig(raw.trim());
        if (!cfg) {
            throw new Error(`Unknown publish entity family: ${raw}`);
        }
        if (cfg.tier === "high_risk" && !allowHighRisk) {
            throw new Error(
                `Entity family ${cfg.entityFamily} requires allow_high_risk_families=true`
            );
        }
        out.push(cfg);
    }
    return out;
}
