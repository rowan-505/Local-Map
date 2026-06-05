export const PROMOTION_SCOPE_ELIGIBILITY_DEBOUNCE_MS = 300;

/** Scope page loads counts only when the user selects at least one family. */
export function shouldFetchPromotionScopeEligibility(selectedFamilies: readonly string[]): boolean {
    return selectedFamilies.length > 0;
}

/** Failed eligibility loads require an explicit Retry click — no automatic retry loop. */
export function shouldAutoRetryPromotionScopeEligibility(hasError: boolean): boolean {
    return !hasError;
}

/** Create publish batch must include only the families the user selected. */
export function buildCreatePublishBatchFamilies(selectedFamilies: readonly string[]): string[] {
    return [...selectedFamilies];
}
