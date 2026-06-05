export const PROMOTION_SCOPE_BATCH_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export type PromotionScopeBatchSizeOption =
    | (typeof PROMOTION_SCOPE_BATCH_SIZE_OPTIONS)[number]
    | "all";

export const PROMOTION_SCOPE_NO_READY_MESSAGE =
    "No eligible candidates. Release stale locked items or approve candidates first.";

export function defaultPromotionScopeBatchSize(
    selectedFamilies: readonly string[]
): PromotionScopeBatchSizeOption {
    return selectedFamilies.includes("roads") ? 20 : "all";
}

export function resolvePromotionScopeMaxItems(
    batchSize: PromotionScopeBatchSizeOption
): number | undefined {
    return batchSize === "all" ? undefined : batchSize;
}

export function projectedItemsForBatchSize(args: {
    batchSize: PromotionScopeBatchSizeOption;
    selectedFamilyCount: number;
    readyNowTotal: number;
}): number {
    const perFamily = resolvePromotionScopeMaxItems(args.batchSize);
    if (perFamily === undefined) {
        return args.readyNowTotal;
    }
    return perFamily * Math.max(args.selectedFamilyCount, 1);
}

export function effectiveCreateBatchItemCount(args: {
    batchSize: PromotionScopeBatchSizeOption;
    selectedFamilyCount: number;
    readyNowTotal: number;
}): number {
    const projected = projectedItemsForBatchSize(args);
    return Math.min(projected, args.readyNowTotal);
}

export function createPublishBatchButtonLabel(args: {
    isCreating: boolean;
    creatingLabel: string;
    batchSize: PromotionScopeBatchSizeOption;
    selectedFamilyCount: number;
    readyNowTotal: number;
}): string {
    if (args.isCreating) {
        return args.creatingLabel;
    }
    const count = effectiveCreateBatchItemCount({
        batchSize: args.batchSize,
        selectedFamilyCount: args.selectedFamilyCount,
        readyNowTotal: args.readyNowTotal,
    });
    if (count <= 0) {
        return "Create publish batch";
    }
    return count === 1 ? "Create batch with 1 item" : `Create batch with ${count} items`;
}

export function requiresLargeRoadBatchConfirmation(args: {
    batchSize: PromotionScopeBatchSizeOption;
    selectedFamilies: readonly string[];
}): boolean {
    return args.batchSize === "all" && args.selectedFamilies.includes("roads");
}
