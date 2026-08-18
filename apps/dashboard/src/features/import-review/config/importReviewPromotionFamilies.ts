/**
 * Display metadata for Import Review publish-batch promotion families.
 * Canonical keys and targets live in API `import-review-promotion-config.ts`.
 */

export type ImportReviewPromotionRiskLevel = "normal" | "high_risk";

export type ImportReviewPromotionFamilyMeta = {
    family: string;
    label: string;
    riskLevel: ImportReviewPromotionRiskLevel;
    targetLabel: string;
};

export const IMPORT_REVIEW_PROMOTION_FAMILY_META: readonly ImportReviewPromotionFamilyMeta[] = [
    {
        family: "buildings",
        label: "Buildings",
        riskLevel: "normal",
        targetLabel: "core.core_buildings",
    },
    {
        family: "places",
        label: "Places",
        riskLevel: "normal",
        targetLabel: "core.core_places",
    },
    {
        family: "land_areas",
        label: "Land area",
        riskLevel: "normal",
        targetLabel: "core.core_land_areas",
    },
    {
        family: "water_lines",
        label: "Water lines",
        riskLevel: "normal",
        targetLabel: "core.core_water_lines",
    },
    {
        family: "water_polygons",
        label: "Water polygons",
        riskLevel: "normal",
        targetLabel: "core.core_water_polygons",
    },
    {
        family: "roads",
        label: "Roads",
        riskLevel: "high_risk",
        targetLabel: "core.core_streets",
    },
    {
        family: "addresses",
        label: "Addresses",
        riskLevel: "high_risk",
        targetLabel: "core.core_addresses",
    },
    {
        family: "admin_areas",
        label: "Admin areas",
        riskLevel: "high_risk",
        targetLabel: "core.core_admin_areas",
    },
    {
        family: "routing_barriers",
        label: "Routing barriers",
        riskLevel: "high_risk",
        targetLabel: "routing.routing_barriers",
    },
] as const;

export const DISABLED_IMPORT_REVIEW_PROMOTION_FAMILY_META: readonly ImportReviewPromotionFamilyMeta[] = [
    {
        family: "bus_routes",
        label: "Bus routes",
        riskLevel: "high_risk",
        targetLabel: "(disabled — use Import transport)",
    },
    {
        family: "bus_route_variants",
        label: "Bus route variants",
        riskLevel: "high_risk",
        targetLabel: "(disabled — use Import transport)",
    },
    {
        family: "bus_route_stops",
        label: "Bus route stops",
        riskLevel: "high_risk",
        targetLabel: "(disabled — use Import transport)",
    },
    {
        family: "bus_stops",
        label: "Bus stops",
        riskLevel: "high_risk",
        targetLabel: "(disabled — use Import transport)",
    },
] as const;

const META_BY_FAMILY = new Map(
    IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => [row.family, row] as const)
);

const DISABLED_META_BY_FAMILY = new Map(
    DISABLED_IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => [row.family, row] as const)
);

export function getImportReviewPromotionFamilyMeta(
    family: string
): ImportReviewPromotionFamilyMeta | undefined {
    const key = family.trim().toLowerCase().replace(/-/g, "_");
    return META_BY_FAMILY.get(key) ?? DISABLED_META_BY_FAMILY.get(key);
}

/** Active (selectable) promotion families only — excludes legacy bus families. */
export const SELECTABLE_IMPORT_REVIEW_PROMOTION_FAMILY_META = IMPORT_REVIEW_PROMOTION_FAMILY_META;

export const NORMAL_IMPORT_REVIEW_PROMOTION_FAMILY_META = IMPORT_REVIEW_PROMOTION_FAMILY_META.filter(
    (row) => row.riskLevel === "normal"
);

export const HIGH_RISK_IMPORT_REVIEW_PROMOTION_FAMILY_META = IMPORT_REVIEW_PROMOTION_FAMILY_META.filter(
    (row) => row.riskLevel === "high_risk"
);
