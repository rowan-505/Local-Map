import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { assertStoredReviewOverridesAllowlist } from "./import-review-overrides-sanitize.js";

/** Validate persisted review_overrides before approval or after merge. */
export function assertValidStoredReviewOverrides(
    family: ImportReviewEntityFamilySlug,
    review_overrides: unknown
): void {
    assertStoredReviewOverridesAllowlist(family, review_overrides);
}
