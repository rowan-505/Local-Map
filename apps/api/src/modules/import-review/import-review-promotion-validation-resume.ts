import type { PrismaClient } from "@prisma/client";

import {
    parsePublishItemValidationResult,
    type PublishItemValidationStatus,
} from "./import-review-promotion-publish-item-validation.js";
import type {
    PublishItemSimpleValidationOutcome,
    PublishItemValidationTarget,
} from "./import-review-promotion-simple-batch-validation.js";
import { outcomeStatusFromResult } from "./import-review-promotion-simple-batch-validation.js";
import type { SimplePromotionValidationResult } from "./import-review-promotion-simple-validation.js";

export function publishItemValidationResultIsComplete(value: unknown): boolean {
    const parsed = parsePublishItemValidationResult(value);
    return parsed.status !== null;
}

export function outcomeFromPersistedValidationResult(
    target: PublishItemValidationTarget,
    validationResult: unknown
): PublishItemSimpleValidationOutcome | null {
    const parsed = parsePublishItemValidationResult(validationResult);
    if (parsed.status === null) {
        return null;
    }

    const normalizedStatus: SimplePromotionValidationResult["status"] =
        parsed.status === "valid" || parsed.status === "ready"
            ? "ready"
            : parsed.status === "warning"
              ? "warning"
              : parsed.status === "skipped"
                ? "warning"
                : "blocked";

    const result: SimplePromotionValidationResult = {
        status: normalizedStatus,
        errors: parsed.errors,
        warnings: parsed.warnings,
    };

    const publishStatus: PublishItemValidationStatus =
        parsed.status === "skipped" ? "skipped" : outcomeStatusFromResult(result, false);

    return {
        publish_item_id: target.publish_item_id,
        entity_family: target.entity_family,
        status: publishStatus,
        skipped: parsed.status === "skipped",
        result,
    };
}

export async function partitionPublishItemTargetsForResume(
    prisma: PrismaClient,
    publishBatchId: bigint,
    targets: readonly PublishItemValidationTarget[]
): Promise<{
    pendingTargets: PublishItemValidationTarget[];
    priorOutcomes: PublishItemSimpleValidationOutcome[];
}> {
    if (targets.length === 0) {
        return { pendingTargets: [], priorOutcomes: [] };
    }

    const rows = await prisma.$queryRaw<
        { publish_item_id: bigint; validation_result: unknown }[]
    >`
        SELECT id AS publish_item_id, validation_result
        FROM system.system_publish_items
        WHERE publish_batch_id = ${publishBatchId}
    `;

    const validationByItemId = new Map<string, unknown>();
    for (const row of rows) {
        validationByItemId.set(row.publish_item_id.toString(), row.validation_result);
    }

    const pendingTargets: PublishItemValidationTarget[] = [];
    const priorOutcomes: PublishItemSimpleValidationOutcome[] = [];

    for (const target of targets) {
        const stored = validationByItemId.get(target.publish_item_id.toString());
        if (!publishItemValidationResultIsComplete(stored)) {
            pendingTargets.push(target);
            continue;
        }
        const outcome = outcomeFromPersistedValidationResult(target, stored);
        if (outcome) {
            priorOutcomes.push(outcome);
        } else {
            pendingTargets.push(target);
        }
    }

    return { pendingTargets, priorOutcomes };
}
