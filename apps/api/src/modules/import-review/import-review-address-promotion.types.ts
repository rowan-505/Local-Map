import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

export type AddressPromotionItemOutcome =
    | "promoted"
    | "would_promote"
    | "skipped"
    | "duplicate_review_needed"
    | "failed";

export type AddressPromotionItemResult = {
    address_candidate_id: string;
    external_id: string | null;
    outcome: AddressPromotionItemOutcome;
    reasons: string[];
    core_address_id: string | null;
    promotion_warnings: AddressValidationIssue[];
    promotion_blockers: AddressValidationIssue[];
};

export type ImportReviewAddressPromotionResponse = {
    dry_run: boolean;
    review_batch_id: string | null;
    candidate_count: number;
    promoted: number;
    skipped: number;
    duplicate_review_needed: number;
    failed: number;
    warnings: string[];
    items: AddressPromotionItemResult[];
    finished_at: string;
    disabled_because_env_flag_false?: boolean;
    message?: string;
};
