import {
    chunkArray,
    resolvePromotionValidationChunkSize,
} from "./import-review-promotion-validation-chunks.js";

export { chunkArray, resolvePromotionValidationChunkSize as resolvePromotionChunkSize };

/** Polygon/point families: per-item promote inside chunk; progress once per chunk. */
export const SIMPLE_POLYGON_PROMOTION_FAMILIES = new Set<string>([
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
]);

/** Line/high-risk families: smaller chunks, per-item SQL promote. */
export const PER_ITEM_PROMOTION_FAMILIES = new Set<string>([
    "roads",
    "admin_areas",
    "routing_barriers",
    "addresses",
]);

export function isPerItemOnlyPromotionFamily(entityFamily: string): boolean {
    return PER_ITEM_PROMOTION_FAMILIES.has(entityFamily);
}

export function usesSimplePolygonPromotionPath(entityFamily: string): boolean {
    return SIMPLE_POLYGON_PROMOTION_FAMILIES.has(entityFamily);
}

export type FamilyPromotionIdChunkPlan = {
    family: string;
    chunkIndex: number;
    chunkSize: number;
    publishItemIds: bigint[];
};

export function chunkPublishItemIdsForFamily(
    publishItemIds: readonly bigint[],
    entityFamily: string
): bigint[][] {
    return chunkArray(publishItemIds, resolvePromotionValidationChunkSize(entityFamily));
}

export function planFamilyPromotionIdChunks(
    family: string,
    publishItemIds: readonly bigint[]
): FamilyPromotionIdChunkPlan[] {
    const chunkSize = resolvePromotionValidationChunkSize(family);
    return chunkPublishItemIdsForFamily(publishItemIds, family).map((ids, chunkIndex) => ({
        family,
        chunkIndex,
        chunkSize,
        publishItemIds: ids,
    }));
}
