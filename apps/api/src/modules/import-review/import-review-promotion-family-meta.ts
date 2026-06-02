import type { ImportReviewPromotionAllowedFamily } from "./import-review-promotion-config.js";
import {
    getImportReviewPromotionTarget,
    isHighRiskPromotionFamily,
    isNormalPromotionFamily,
} from "./import-review-promotion-config.js";

export type ImportReviewPromotionRiskLevel = "normal" | "high_risk";

const FAMILY_LABELS: Record<ImportReviewPromotionAllowedFamily, string> = {
    buildings: "Buildings",
    places: "Places",
    landuse: "Land use",
    water_lines: "Water lines",
    water_polygons: "Water polygons",
    roads: "Roads",
    addresses: "Addresses",
    admin_areas: "Admin areas",
    routing_barriers: "Routing barriers",
};

export function importReviewPromotionFamilyLabel(family: ImportReviewPromotionAllowedFamily): string {
    return FAMILY_LABELS[family];
}

export function importReviewPromotionFamilyRiskLevel(
    family: ImportReviewPromotionAllowedFamily
): ImportReviewPromotionRiskLevel {
    return isHighRiskPromotionFamily(family) ? "high_risk" : "normal";
}

export function importReviewPromotionFamilyTarget(family: ImportReviewPromotionAllowedFamily): string {
    return getImportReviewPromotionTarget(family);
}

export function isImportReviewPromotionFamilyNormal(family: string): boolean {
    return isNormalPromotionFamily(family);
}
