import {
    PROMOTABLE_PUBLISH_FAMILIES,
    type PromotablePublishEntityFamily,
    isPromotablePublishFamily,
} from "./import-review-promotion-config.js";
import { promotionFamilyStagesForBatch } from "./import-review-promotion-promote-api.js";
import { classifyPublishItemsForPromotion } from "./import-review-promotion-execution.js";
import type { PublishItemPromotionGateInput } from "./import-review-promotion-publish-item-validation.js";
import type { PublishItemValidationRow } from "./import-review-promotion-execution.js";

export type PromotionWorkflowStageDef = {
    key: string;
    label: string;
    progressEnd: number;
};

export type PromotionStagePlan = {
    stages: PromotionWorkflowStageDef[];
    familyStages: Array<{
        key: string;
        entityFamily: PromotablePublishEntityFamily;
        label: string;
        progressEnd: number;
    }>;
};

export const PROMOTION_STAGE_PREFLIGHT = "promote_preflight";
export const PROMOTION_STAGE_MARK_IMPORTED = "mark_import_review_promoted";
export const PROMOTION_STAGE_VERIFY_CORE = "verify_core_rows";
export const PROMOTION_STAGE_UPDATE_SUMMARY = "update_batch_summary";
export const PROMOTION_STAGE_FINAL = "promotion_final_response";

const CORE_TAIL_STAGES: Array<{ key: string; label: string; progressEnd: number }> = [
    { key: PROMOTION_STAGE_MARK_IMPORTED, label: "Mark import-review candidates", progressEnd: 82 },
    { key: PROMOTION_STAGE_VERIFY_CORE, label: "Verify promoted core rows", progressEnd: 90 },
    { key: PROMOTION_STAGE_UPDATE_SUMMARY, label: "Write summary", progressEnd: 95 },
    { key: PROMOTION_STAGE_FINAL, label: "Final result", progressEnd: 100 },
];

/**
 * Families with at least one promotable publish item for this run (item-level gate).
 * Excludes families that only have blocked/skipped pending rows.
 */
export function resolvePromotionStageFamilies(
    pendingRows: readonly PublishItemValidationRow[],
    items: ReadonlyArray<{ publish_item_id: bigint; entity_family: string }>,
    gate: PublishItemPromotionGateInput = {}
): PromotablePublishEntityFamily[] {
    const selection = classifyPublishItemsForPromotion(pendingRows, gate);
    const promotableIds = new Set(selection.promotableIds.map((id) => id.toString()));
    const familiesPresent = new Set<string>();

    for (const row of items) {
        if (
            promotableIds.has(row.publish_item_id.toString()) &&
            isPromotablePublishFamily(row.entity_family)
        ) {
            familiesPresent.add(row.entity_family);
        }
    }

    return PROMOTABLE_PUBLISH_FAMILIES.filter((family) => familiesPresent.has(family));
}

/** Build workflow stages seeded for a promotion run (core steps + one stage per promotable family). */
export function buildPromotionStagePlan(
    families: readonly string[]
): PromotionStagePlan {
    const familyStages = promotionFamilyStagesForBatch(families);
    const promoteStart = 5;
    const promoteEnd = 75;
    const familyCount = familyStages.length;
    const step = familyCount > 0 ? (promoteEnd - promoteStart) / familyCount : 0;

    const stages: PromotionWorkflowStageDef[] = [
        { key: PROMOTION_STAGE_PREFLIGHT, label: "Preflight", progressEnd: promoteStart },
    ];

    const familyStagesWithProgress = familyStages.map((familyStage, index) => {
        const progressEnd = Math.round(promoteStart + step * (index + 1));
        const def: PromotionWorkflowStageDef = {
            key: familyStage.key,
            label: familyStage.label,
            progressEnd,
        };
        stages.push(def);
        return {
            ...familyStage,
            progressEnd,
        };
    });

    for (const tail of CORE_TAIL_STAGES) {
        stages.push(tail);
    }

    return { stages, familyStages: familyStagesWithProgress };
}

export function stageByKeyFromPlan(
    plan: PromotionStagePlan,
    key: string
): PromotionWorkflowStageDef {
    const stage = plan.stages.find((s) => s.key === key);
    if (!stage) {
        throw new Error(`Unknown promotion stage: ${key}`);
    }
    return stage;
}

export function previousStageFromPlan(
    plan: PromotionStagePlan,
    key: string
): PromotionWorkflowStageDef | null {
    const index = plan.stages.findIndex((s) => s.key === key);
    if (index <= 0) {
        return null;
    }
    return plan.stages[index - 1] ?? null;
}

export type ImportReviewPublishPromotionStageKey = string;
