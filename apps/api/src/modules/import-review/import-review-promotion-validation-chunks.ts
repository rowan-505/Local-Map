import { IMPORT_REVIEW_VALIDATION_CHUNK_SIZE } from "./import-review-promotion-validation.repo.js";
import type { PublishItemValidationTarget } from "./import-review-promotion-simple-batch-validation.js";

/** Validation order: simple polygon/point families first, then lines/high-risk. */
export const PROMOTION_VALIDATION_FAMILY_ORDER = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "roads",
    "admin_areas",
    "routing_barriers",
    "addresses",
] as const;

const SMALL_CHUNK_FAMILIES = new Set<string>([
    "roads",
    "admin_areas",
    "routing_barriers",
    "addresses",
]);

const SIMPLE_FAMILY_CHUNK_CAP = 100;

/** Roads, admin_areas, routing_barriers, addresses use smaller chunks; others use env cap (max 100). */
export function resolvePromotionValidationChunkSize(entityFamily: string): number {
    if (SMALL_CHUNK_FAMILIES.has(entityFamily)) {
        return 25;
    }
    return Math.min(SIMPLE_FAMILY_CHUNK_CAP, IMPORT_REVIEW_VALIDATION_CHUNK_SIZE);
}

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
    if (size <= 0 || items.length === 0) {
        return items.length === 0 ? [] : [Array.from(items)];
    }
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

export function groupPublishItemTargetsByFamilyOrder(
    targets: readonly PublishItemValidationTarget[]
): Map<string, PublishItemValidationTarget[]> {
    const byFamily = new Map<string, PublishItemValidationTarget[]>();
    for (const target of targets) {
        const list = byFamily.get(target.entity_family) ?? [];
        list.push(target);
        byFamily.set(target.entity_family, list);
    }

    const ordered = new Map<string, PublishItemValidationTarget[]>();
    for (const family of PROMOTION_VALIDATION_FAMILY_ORDER) {
        const list = byFamily.get(family);
        if (list && list.length > 0) {
            ordered.set(family, list);
        }
    }
    for (const [family, list] of byFamily) {
        if (!ordered.has(family)) {
            ordered.set(family, list);
        }
    }
    return ordered;
}

export type FamilyValidationChunkPlan = {
    family: string;
    chunkIndex: number;
    chunkSize: number;
    targets: PublishItemValidationTarget[];
};

export function planFamilyValidationChunks(
    targets: readonly PublishItemValidationTarget[]
): FamilyValidationChunkPlan[] {
    const plans: FamilyValidationChunkPlan[] = [];
    const grouped = groupPublishItemTargetsByFamilyOrder(targets);
    for (const [family, familyTargets] of grouped) {
        const chunkSize = resolvePromotionValidationChunkSize(family);
        const chunks = chunkArray(familyTargets, chunkSize);
        chunks.forEach((chunkTargets, chunkIndex) => {
            plans.push({ family, chunkIndex, chunkSize, targets: chunkTargets });
        });
    }
    return plans;
}
