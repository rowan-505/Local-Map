import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

export type SplitPromotionOutcome = "promoted" | "would_promote" | "skipped" | "failed";

export type SplitPromotionItemResult = {
    candidate_id: string;
    external_id: string | null;
    outcome: SplitPromotionOutcome;
    reasons: string[];
    core_id: string | null;
    promotion_warnings: AddressValidationIssue[];
    promotion_blockers: AddressValidationIssue[];
};

export type ImportReviewSplitPromotionResponse = {
    dry_run: boolean;
    review_batch_id: string | null;
    candidate_count: number;
    promoted: number;
    skipped: number;
    failed: number;
    warnings: string[];
    items: SplitPromotionItemResult[];
    finished_at: string;
};
